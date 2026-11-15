package com.movix.tv.ui.account

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.movix.tv.R
import com.movix.tv.container
import com.movix.tv.data.account.LinkStart
import com.movix.tv.ui.components.PillButton
import com.movix.tv.ui.theme.Bricolage
import com.movix.tv.ui.theme.MovixColors
import com.movix.tv.ui.theme.MovixType
import io.nayuki.qrcodegen.QrCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * Écran « Connecte ta télé » (maquette 6) : code à 5 caractères et QR vers la
 * page `/tv` du site. Interroge le serveur au rythme qu'il demande ; un
 * nouveau code remplace l'ancien à l'expiration.
 */
@Composable
fun LinkScreen(onLinked: () -> Unit, onUseVipKey: () -> Unit, onLater: () -> Unit) {
    val container = LocalContext.current.container
    var start by remember { mutableStateOf<LinkStart?>(null) }
    var failed by remember { mutableStateOf(false) }
    var remaining by remember { mutableIntStateOf(0) }
    var generation by remember { mutableIntStateOf(0) }
    val first = remember { FocusRequester() }

    // Demande d'un code, puis interrogation jusqu'à la confirmation sur le site.
    LaunchedEffect(generation) {
        start = null
        val s = runCatching { container.accountApi.start(container.accounts.deviceName(), container.accounts.clientId()) }.getOrNull()
        if (s == null) {
            failed = true
            delay(10_000)
            generation++
            return@LaunchedEffect
        }
        failed = false
        val apiHost = runCatching { withContext(Dispatchers.IO) { container.apiHost.current() } }.getOrNull()
        start = if (apiHost != null) s.copy(verificationUrl = onSiteDomain(s, apiHost)) else s
        val expiresAt = System.currentTimeMillis() + s.expiresIn * 1000L
        var interval = s.interval.coerceAtLeast(3) * 1000L
        while (System.currentTimeMillis() < expiresAt) {
            delay(interval)
            val poll = runCatching { container.accountApi.poll(s.deviceCode) }.getOrNull() ?: continue
            when (poll.status) {
                "approved" -> {
                    if (container.accounts.onLinked(poll) != null) {
                        container.sync.onLinked()
                        onLinked()
                    }
                    return@LaunchedEffect
                }
                "slow_down" -> interval += 5_000
                "expired" -> break
            }
        }
        generation++
    }
    LaunchedEffect(start) {
        val s = start ?: return@LaunchedEffect
        val end = System.currentTimeMillis() + s.expiresIn * 1000L
        while (true) {
            remaining = ((end - System.currentTimeMillis()) / 1000).toInt().coerceAtLeast(0)
            if (remaining == 0) break
            delay(1_000)
        }
    }
    LaunchedEffect(Unit) { delay(48); runCatching { first.requestFocus() } }

    Box(
        Modifier.fillMaxSize()
            .background(MovixColors.Ink)
            .background(Brush.radialGradient(listOf(MovixColors.Red.copy(alpha = 0.16f), Color.Transparent), center = Offset(1600f, 540f), radius = 900f)),
    ) {
        Column(Modifier.padding(start = 84.dp, top = 52.dp).width(460.dp)) {
            Image(painterResource(R.drawable.movix_wordmark), contentDescription = null, modifier = Modifier.width(150.dp))
            Spacer(Modifier.height(30.dp))
            Text(stringResource(R.string.link_title), style = MovixType.Title)
            Spacer(Modifier.height(24.dp))
            Step(1, buildAnnotatedString {
                val site = start?.verificationUrl?.substringAfter("://")?.substringBefore("?") ?: "movix.luxe/tv"
                append(stringResource(R.string.link_step1_before))
                withStyle(SpanStyle(color = MovixColors.Text, fontWeight = FontWeight.Bold)) { append(site) }
                append(stringResource(R.string.link_step1_after))
            })
            Spacer(Modifier.height(14.dp))
            Step(2, buildAnnotatedString { append(stringResource(R.string.link_step2)) })
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                val code = start?.userCode ?: "·····"
                code.padEnd(5, '·').take(5).forEach { c ->
                    Box(
                        Modifier.size(62.dp, 76.dp)
                            .background(MovixColors.Panel, RoundedCornerShape(12.dp))
                            .border(1.5.dp, MovixColors.Line, RoundedCornerShape(12.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(c.toString(), style = MovixType.Title.copy(fontFamily = Bricolage, fontSize = 40.sp))
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                when {
                    failed -> stringResource(R.string.link_network)
                    start == null -> stringResource(R.string.link_loading)
                    else -> stringResource(R.string.link_expires, remaining / 60, remaining % 60)
                },
                style = MovixType.Meta.copy(color = if (failed) MovixColors.Red else MovixColors.Muted),
            )
        }

        Column(Modifier.align(Alignment.TopEnd).padding(top = 120.dp, end = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(250.dp).background(MovixColors.Text, RoundedCornerShape(18.dp)).padding(18.dp)) {
                start?.verificationUrl?.let { Qr(it, Modifier.fillMaxSize()) }
            }
            Spacer(Modifier.height(14.dp))
            Text(stringResource(R.string.link_scan), style = MovixType.Meta)
            Spacer(Modifier.height(30.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PillButton(stringResource(R.string.link_use_vip), onUseVipKey, Modifier.focusRequester(first))
                PillButton(stringResource(R.string.link_later), onLater)
            }
        }
    }
}

/**
 * Adresse du QR sur le domaine actuel du site, celui de l'API trouvée via
 * rentry (`api.movix.dog` → `movix.dog`) : un domaine que le FAI de la télé ne
 * bloque pas. Le chemin et le code restent ceux donnés par le serveur.
 */
private fun onSiteDomain(start: LinkStart, apiHost: String): String {
    val site = apiHost.removePrefix("api.")
    if (site == apiHost || !site.contains('.')) return start.verificationUrl
    val url = start.verificationUrl.toHttpUrlOrNull()
        ?: return "https://$site/tv?code=${start.userCode}"
    return url.newBuilder().scheme("https").host(site).port(443).build().toString()
}

@Composable
private fun Step(n: Int, text: androidx.compose.ui.text.AnnotatedString) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(26.dp).border(1.5.dp, MovixColors.Line, CircleShape), contentAlignment = Alignment.Center) {
            Text(n.toString(), style = MovixType.Badge)
        }
        Text(text, style = MovixType.Body.copy(fontSize = 14.5.sp))
    }
}

/** QR dessiné à la main (modules noirs sur la carte claire), recalculé seulement si l'URL change. */
@Composable
private fun Qr(content: String, modifier: Modifier) {
    val qr = remember(content) { runCatching { QrCode.encodeText(content, QrCode.Ecc.MEDIUM) }.getOrNull() } ?: return
    Canvas(modifier) {
        val cell = size.minDimension / qr.size
        for (y in 0 until qr.size) for (x in 0 until qr.size) {
            if (qr.getModule(x, y)) drawRect(MovixColors.Ink, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}
