package com.movix.tv.player

import androidx.compose.runtime.Immutable

@Immutable
data class SubtitleCue(val startMs: Long, val endMs: Long, val text: String)

/**
 * Sous-titres externes (SRT, WebVTT), lus par l'appli et non par Media3 :
 * le décalage réglable dans le panneau est alors un simple calcul, sans
 * recharger le flux. Fichiers de quelques dizaines de Ko.
 */
object Subtitles {
    private val time = Regex("""(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})""")
    private val tags = Regex("""<[^>]+>|\{\\[^}]*\}""") // `}` échappé : l'ICU d'Android refuse un `}` nu (crash à l'ouverture)

    private fun parseTime(s: String): Long? {
        val m = time.find(s.trim()) ?: return null
        val (h, mi, se, ms) = m.destructured
        return ((h.ifEmpty { "0" }.toLong() * 60 + mi.toLong()) * 60 + se.toLong()) * 1000 + ms.padEnd(3, '0').toLong()
    }

    /** Lit un fichier SRT ou VTT ; cues triées par début. Lignes illisibles ignorées. */
    fun parse(raw: String): List<SubtitleCue> {
        val text = raw.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n')
        val cues = ArrayList<SubtitleCue>()
        for (block in text.split(Regex("""\n\s*\n"""))) {
            val lines = block.lines().filter { it.isNotBlank() }
            val idx = lines.indexOfFirst { "-->" in it }
            if (idx < 0) continue
            val (a, b) = lines[idx].split("-->", limit = 2)
            val start = parseTime(a) ?: continue
            val end = parseTime(b.trim().substringBefore(' ')) ?: continue
            val body = lines.drop(idx + 1).joinToString("\n") { it.replace(tags, "").trim() }.trim()
            if (body.isNotEmpty() && end > start) cues += SubtitleCue(start, end, body)
        }
        cues.sortBy { it.startMs }
        return cues
    }

    /** Texte affiché à [positionMs] (plusieurs cues simultanées réunies), ou `null`. */
    fun textAt(cues: List<SubtitleCue>, positionMs: Long): String? {
        if (cues.isEmpty()) return null
        // Dernière cue qui commence avant la position, puis on remonte les chevauchements.
        var lo = 0
        var hi = cues.size - 1
        var last = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (cues[mid].startMs <= positionMs) { last = mid; lo = mid + 1 } else hi = mid - 1
        }
        if (last < 0) return null
        val active = ArrayList<String>(2)
        var i = last
        while (i >= 0 && last - i < 8) {
            val c = cues[i]
            if (positionMs < c.endMs) active.add(0, c.text)
            i--
        }
        return active.takeIf { it.isNotEmpty() }?.joinToString("\n")
    }
}
