package com.movix.extract

/**
 * Seules retouches du userscript amont, faites au chargement (le fichier
 * reste celui de MovixOpenSource). Une retouche qui ne trouve plus sa cible
 * est signalée et ignorée : l'extraction concernée échoue proprement.
 */
object UserscriptPatcher {
    data class Patch(val name: String, val find: String, val replace: String)

    val PATCHES = listOf(
        // Fsvid / Vidzy : QuickJS natif au lieu du QuickJS WebAssembly de jsDelivr.
        Patch(
            name = "quickjs-natif",
            find = "quickJsApi = await loadFsvidVidzyQuickJsFromCdn();",
            replace = "quickJsApi = globalThis.__movixNativeQJS || await loadFsvidVidzyQuickJsFromCdn();",
        ),
    )

    class Result(val source: String, val missing: List<String>)

    fun apply(source: String): Result {
        var out = source
        val missing = ArrayList<String>()
        for (p in PATCHES) {
            if (out.contains(p.find)) out = out.replace(p.find, p.replace) else missing += p.name
        }
        return Result(out, missing)
    }
}
