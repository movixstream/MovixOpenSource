package com.movix.extract

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.function
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Test

/** Sonde : comment quickjs-kt convertit octets, nombres et null (sert à écrire le pont). */
class QuickJsProbeTest {
    @Test
    fun conversions() = runBlocking {
        val qjs = QuickJs.create(Dispatchers.Default)
        val seen = StringBuilder()
        qjs.function("probe") { args ->
            args.forEach { seen.append(it?.let { v -> v::class.simpleName + "=" + (if (v is ByteArray) v.toList() else v) } ?: "null").append(" | ") }
            seen.append("\n")
            byteArrayOf(1, 2, 3)
        }
        val r = qjs.evaluate<String>(
            """
            var out = [];
            var b = probe(new Uint8Array([7,8]), 42, 4.5, null, undefined, "s", true, new Uint8Array([9]).buffer);
            out.push(Object.prototype.toString.call(b), b && b.length, b instanceof Uint8Array, b instanceof ArrayBuffer);
            out.join(",")
            """.trimIndent(),
        )
        println("ARGS: $seen")
        println("RET: $r")
        qjs.close()
    }
}
