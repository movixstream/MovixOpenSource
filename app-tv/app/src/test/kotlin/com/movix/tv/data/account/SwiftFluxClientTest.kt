package com.movix.tv.data.account

import com.movix.tv.data.movix.Lang
import com.movix.tv.data.movix.Provider
import com.movix.tv.data.movix.SourceParsers
import com.movix.tv.data.movix.StreamKind
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SwiftFluxClientTest {
    @Test
    fun `bloc mp4 lu sans URL`() {
        val root = Json.parseToJsonElement(
            """{"success":true,"mp4":{"available":true,"entries":[
              {"index":0,"label":"1080p · 2.1 GB","quality":"1080p","size":"2.1 GB","language":"VF"},
              {"index":1,"label":"MP4","quality":null,"language":"VOSTFR"}]}}""",
        )
        val list = SourceParsers.swiftfluxEntries(root)
        assertEquals(2, list.size)
        assertEquals(Provider.SWIFTFLUX, list[0].provider)
        assertEquals("SwiftFlux VF - 1080p", list[0].label)
        assertEquals(Lang.VOSTFR, list[1].language)
        assertEquals(1, list[1].mp4Index)
        assertEquals(StreamKind.FILE, list[0].kind)
        assertTrue(list.none { it.playable })
    }

    @Test
    fun `bloc mp4 absent ou vide`() {
        assertTrue(SourceParsers.swiftfluxEntries(Json.parseToJsonElement("""{"success":true}""")).isEmpty())
        assertTrue(SourceParsers.swiftfluxEntries(Json.parseToJsonElement("""{"mp4":{"available":false,"entries":[]}}""")).isEmpty())
    }
}
