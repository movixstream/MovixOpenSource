package com.movix.app.dns

import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory

/**
 * VPN local qui ne capte QUE les requêtes DNS et les envoie chiffrées
 * (DNS-over-HTTPS) à Cloudflare. Le reste du trafic réseau n'est PAS affecté.
 *
 * Le système reçoit un serveur DNS virtuel (VIRTUAL_DNS), seule adresse routée
 * dans le tunnel. Chaque question y est lue, puis posée en HTTPS à
 * 1.1.1.1/dns-query : un opérateur qui lit ou détourne le DNS en clair (port
 * 53) ne voit plus le domaine demandé. Le DNS en clair ne sert plus qu'en
 * dernier recours, si le HTTPS est injoignable.
 */
class DnsVpnService : VpnService() {

    private var vpnInterface: ParcelFileDescriptor? = null
    @Volatile private var isRunning = false
    private var readerThread: Thread? = null
    private var workers: ExecutorService? = null
    private var httpClient: OkHttpClient? = null
    @Volatile private var dohPausedUntil = 0L

    companion object {
        var primaryDns: String = "1.1.1.1"
        var secondaryDns: String = "1.0.0.1"
        @Volatile var isActive: Boolean = false
            private set

        private const val TAG = "MovixDns"
        private const val VPN_ADDRESS = "10.215.173.1"
        private const val VIRTUAL_DNS = "10.215.173.2"

        // Points d'accès DoH joignables par IP : pas besoin d'un DNS pour
        // trouver le serveur DNS. Un serveur absent de la liste n'a que l'UDP.
        private val DOH_ENDPOINTS = mapOf(
            "1.1.1.1" to "https://1.1.1.1/dns-query",
            "1.0.0.1" to "https://1.0.0.1/dns-query",
        )
        private val DNS_MESSAGE = "application/dns-message".toMediaType()

        // Après un échec DoH complet, on reste en UDP un moment au lieu de
        // payer un délai d'attente à chaque requête.
        private const val DOH_PAUSE_MS = 30_000L
        private const val UDP_TIMEOUT_MS = 3_000
        private const val WORKER_COUNT = 8
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopVpn()
            return START_NOT_STICKY
        }

        intent?.getStringExtra(EXTRA_PRIMARY_DNS)?.let { primaryDns = it }
        intent?.getStringExtra(EXTRA_SECONDARY_DNS)?.let { secondaryDns = it }

        startVpn()
        return START_STICKY
    }

    private fun startVpn() {
        if (isRunning) return

        try {
            val builder = Builder()
                .setSession("Movix DNS")
                .addAddress(VPN_ADDRESS, 32)
                .addDnsServer(VIRTUAL_DNS)
                // Seul le serveur DNS virtuel passe par le tunnel. Les vraies
                // IP de Cloudflare restent hors du tunnel : nos requêtes DoH
                // n'y bouclent pas et les autres apps qui parlent à 1.1.1.1
                // (DoH, DoT) ne sont pas coupées.
                .addRoute(VIRTUAL_DNS, 32)
                .setMtu(1500)
                .setBlocking(true)

            // Sans ça, Android 10+ considère tout VPN comme une connexion
            // limitée en données, même en Wi-Fi.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                builder.setMetered(false)
            }

            // NE PAS exclure l'app du VPN : sinon le WebView bypass le DNS custom
            // et résout via le DNS système (ce qui fait échouer les requêtes vers
            // les domaines bloqués par le FAI). Nos propres sockets vers Cloudflare
            // sont protégées une à une via protect().

            vpnInterface = builder.establish()

            Log.i(TAG, "Tunnel ${if (vpnInterface != null) "monté" else "refusé par Android"} (DNS $primaryDns, $secondaryDns)")
            if (vpnInterface != null) {
                httpClient = buildHttpClient()
                workers = Executors.newFixedThreadPool(WORKER_COUNT)
                isRunning = true
                isActive = true
                startDnsForwarding()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            stopVpn()
        }
    }

    private fun buildHttpClient(): OkHttpClient =
        OkHttpClient.Builder()
            .socketFactory(ProtectedSocketFactory())
            .connectTimeout(3, TimeUnit.SECONDS)
            .readTimeout(3, TimeUnit.SECONDS)
            .writeTimeout(3, TimeUnit.SECONDS)
            .callTimeout(4, TimeUnit.SECONDS)
            .build()

    private fun startDnsForwarding() {
        val fd = vpnInterface?.fileDescriptor ?: return
        val output = FileOutputStream(fd)
        readerThread = Thread {
            val input = FileInputStream(fd)
            val buffer = ByteArray(32767)

            while (isRunning) {
                try {
                    val length = input.read(buffer)
                    if (length <= 0) continue

                    // Le reste (sondes DNS-over-TLS d'Android vers le port 853,
                    // paquets IPv6 du noyau) est ignoré : Android repasse alors
                    // de lui-même au DNS classique.
                    val ipHeaderLength = dnsQueryHeaderLength(buffer, length) ?: continue
                    val packet = buffer.copyOf(length)
                    // Une requête lente ne doit pas bloquer les suivantes : le
                    // WebView en lance des dizaines en parallèle au chargement.
                    workers?.execute { answer(packet, ipHeaderLength, output) }
                } catch (_: Exception) {
                    if (!isRunning) break
                }
            }

            try { input.close() } catch (_: Exception) {}
            try { output.close() } catch (_: Exception) {}
        }.also { it.start() }
    }

    /** Longueur de l'en-tête IP si le paquet est une requête DNS IPv4/UDP, sinon null. */
    private fun dnsQueryHeaderLength(packet: ByteArray, length: Int): Int? {
        if (length < 20) return null
        if ((packet[0].toInt() shr 4) and 0x0F != 4) return null
        val ipHeaderLength = (packet[0].toInt() and 0x0F) * 4
        if (ipHeaderLength < 20 || length < ipHeaderLength + 8 + 12) return null
        if (packet[9].toInt() and 0xFF != 17) return null // UDP seulement
        val dstPort = ((packet[ipHeaderLength + 2].toInt() and 0xFF) shl 8) or
            (packet[ipHeaderLength + 3].toInt() and 0xFF)
        return if (dstPort == 53) ipHeaderLength else null
    }

    private fun answer(packet: ByteArray, ipHeaderLength: Int, output: FileOutputStream) {
        try {
            val query = packet.copyOfRange(ipHeaderLength + 8, packet.size)
            val response = resolve(query) ?: return
            if (response.size < 12) return
            // Le résolveur système apparie la réponse par son identifiant.
            response[0] = query[0]
            response[1] = query[1]
            val responsePacket = buildResponsePacket(packet, ipHeaderLength, response) ?: return
            synchronized(output) {
                if (isRunning) output.write(responsePacket)
            }
        } catch (_: Exception) {
            // Sans réponse, le résolveur système réessaie de lui-même.
        }
    }

    private fun resolve(query: ByteArray): ByteArray? {
        val upstreams = listOf(primaryDns, secondaryDns).distinct()
        val dohUrls = upstreams.mapNotNull { DOH_ENDPOINTS[it] }
        val started = SystemClock.elapsedRealtime()

        if (dohUrls.isNotEmpty() && System.currentTimeMillis() >= dohPausedUntil) {
            for (url in dohUrls) {
                queryDoh(url, query)?.let { return it }
            }
            dohPausedUntil = System.currentTimeMillis() + DOH_PAUSE_MS
            Log.w(TAG, "DoH en échec : UDP seul pendant ${DOH_PAUSE_MS / 1000} s")
        }

        for (server in upstreams) {
            queryUdp(server, query)?.let {
                Log.d(TAG, "UDP $server ok en ${SystemClock.elapsedRealtime() - started} ms")
                return it
            }
        }
        Log.w(TAG, "Aucune réponse après ${SystemClock.elapsedRealtime() - started} ms")
        return null
    }

    private fun queryDoh(url: String, query: ByteArray): ByteArray? {
        val client = httpClient ?: return null
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/dns-message")
            .post(query.toRequestBody(DNS_MESSAGE))
            .build()
        val started = SystemClock.elapsedRealtime()
        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "DoH $url : HTTP ${response.code}")
                    return null
                }
                response.body?.bytes()
            }
        } catch (e: Exception) {
            Log.w(TAG, "DoH $url : échec en ${SystemClock.elapsedRealtime() - started} ms (${e.javaClass.simpleName}: ${e.message})")
            null
        }
    }

    private fun queryUdp(server: String, query: ByteArray): ByteArray? {
        return try {
            DatagramSocket().use { socket ->
                socket.soTimeout = UDP_TIMEOUT_MS
                protect(socket)
                socket.send(DatagramPacket(query, query.size, InetAddress.getByName(server), 53))
                val responseBuffer = ByteArray(4096)
                val responsePacket = DatagramPacket(responseBuffer, responseBuffer.size)
                socket.receive(responsePacket)
                responseBuffer.copyOf(responsePacket.length)
            }
        } catch (e: Exception) {
            Log.w(TAG, "UDP $server : échec (${e.javaClass.simpleName}: ${e.message})")
            null
        }
    }

    /**
     * Crée des sockets TCP qui contournent le tunnel, pour que les requêtes
     * DoH partent par le vrai réseau quelles que soient les routes du VPN.
     */
    private inner class ProtectedSocketFactory : SocketFactory() {
        override fun createSocket(): Socket {
            val socket = Socket()
            // Lire une option force la création du descripteur, sans quoi
            // protect() n'a rien à protéger (même astuce que Network.bindSocket).
            socket.reuseAddress
            protect(socket)
            return socket
        }

        override fun createSocket(host: String, port: Int): Socket =
            createSocket().apply { connect(InetSocketAddress(host, port)) }

        override fun createSocket(host: String, port: Int, localHost: InetAddress, localPort: Int): Socket =
            createSocket().apply {
                bind(InetSocketAddress(localHost, localPort))
                connect(InetSocketAddress(host, port))
            }

        override fun createSocket(host: InetAddress, port: Int): Socket =
            createSocket().apply { connect(InetSocketAddress(host, port)) }

        override fun createSocket(address: InetAddress, port: Int, localAddress: InetAddress, localPort: Int): Socket =
            createSocket().apply {
                bind(InetSocketAddress(localAddress, localPort))
                connect(InetSocketAddress(address, port))
            }
    }

    private fun buildResponsePacket(originalPacket: ByteArray, ipHeaderLength: Int, dnsResponse: ByteArray): ByteArray? {
        try {
            val totalLength = ipHeaderLength + 8 + dnsResponse.size
            if (totalLength > 0xFFFF) return null
            val response = ByteArray(totalLength)

            // Copie le header IP
            System.arraycopy(originalPacket, 0, response, 0, ipHeaderLength)
            // Swap src/dst IP
            System.arraycopy(originalPacket, 12, response, 16, 4)
            System.arraycopy(originalPacket, 16, response, 12, 4)
            // Total length
            response[2] = ((totalLength shr 8) and 0xFF).toByte()
            response[3] = (totalLength and 0xFF).toByte()

            // UDP Header — swap ports
            response[ipHeaderLength] = originalPacket[ipHeaderLength + 2]
            response[ipHeaderLength + 1] = originalPacket[ipHeaderLength + 3]
            response[ipHeaderLength + 2] = originalPacket[ipHeaderLength]
            response[ipHeaderLength + 3] = originalPacket[ipHeaderLength + 1]
            val udpLength = 8 + dnsResponse.size
            response[ipHeaderLength + 4] = ((udpLength shr 8) and 0xFF).toByte()
            response[ipHeaderLength + 5] = (udpLength and 0xFF).toByte()
            response[ipHeaderLength + 6] = 0
            response[ipHeaderLength + 7] = 0

            // DNS payload
            System.arraycopy(dnsResponse, 0, response, ipHeaderLength + 8, dnsResponse.size)

            // Recalcul checksum IP
            response[10] = 0
            response[11] = 0
            var checksum = 0
            for (i in 0 until ipHeaderLength step 2) {
                checksum += ((response[i].toInt() and 0xFF) shl 8) or (response[i + 1].toInt() and 0xFF)
            }
            checksum = (checksum shr 16) + (checksum and 0xFFFF)
            checksum += checksum shr 16
            checksum = checksum.inv() and 0xFFFF
            response[10] = ((checksum shr 8) and 0xFF).toByte()
            response[11] = (checksum and 0xFF).toByte()

            return response
        } catch (_: Exception) {
            return null
        }
    }

    private fun stopVpn() {
        if (isRunning) Log.i(TAG, "Tunnel arrêté")
        isRunning = false
        isActive = false
        readerThread?.interrupt()
        readerThread = null
        workers?.shutdownNow()
        workers = null
        httpClient?.let { client ->
            // Fermer une connexion TLS écrit sur le réseau : interdit sur le
            // thread principal (NetworkOnMainThreadException faisait planter
            // l'app à la désactivation du DNS).
            Thread {
                try {
                    client.dispatcher.executorService.shutdown()
                    client.connectionPool.evictAll()
                } catch (_: Exception) {}
            }.start()
        }
        httpClient = null
        try { vpnInterface?.close() } catch (_: Exception) {}
        vpnInterface = null
        stopSelf()
    }

    override fun onDestroy() {
        stopVpn()
        super.onDestroy()
    }

    override fun onRevoke() {
        stopVpn()
        super.onRevoke()
    }
}

const val ACTION_STOP = "com.movix.app.dns.STOP"
const val EXTRA_PRIMARY_DNS = "primary_dns"
const val EXTRA_SECONDARY_DNS = "secondary_dns"
