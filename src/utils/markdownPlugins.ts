import { useEffect, useState } from 'react';
import type remarkGfm from 'remark-gfm';

const hasRegexLookbehindSupport = (() => {
  try {
    // Utiliser le résultat : le minifieur supprimait le constructeur inutilisé
    // et transformait tout le try en `return true` dans le bundle de production.
    return new RegExp('(?<=a)b').test('ab');
  } catch {
    return false;
  }
})();

type RemarkGfmPlugin = typeof remarkGfm;

// Module-level cache so every component shares the same plugin instance once loaded.
let cachedRemarkGfm: RemarkGfmPlugin | null = null;
let pendingLoad: Promise<RemarkGfmPlugin | null> | null = null;

function loadRemarkGfm(): Promise<RemarkGfmPlugin | null> {
  if (!hasRegexLookbehindSupport) return Promise.resolve(null);
  if (cachedRemarkGfm) return Promise.resolve(cachedRemarkGfm);
  if (!pendingLoad) {
    pendingLoad = import('remark-gfm')
      .then((mod) => {
        cachedRemarkGfm = mod.default;
        return cachedRemarkGfm;
      })
      .catch(() => null);
  }
  return pendingLoad;
}

// remark-gfm transitively imports mdast-util-gfm-autolink-literal, whose
// email-autolink regex uses a positive lookbehind. Safari < 16.4 throws
// "Invalid regular expression: invalid group specifier name" while *parsing*
// that regex literal at module-load — before any try/catch can run. Gating
// `import 'remark-gfm'` behind a runtime feature probe + dynamic import is the
// only way to keep older Safari from evaluating the offending module.
export function useSafeRemarkGfm(): RemarkGfmPlugin | null {
  const [plugin, setPlugin] = useState<RemarkGfmPlugin | null>(() => cachedRemarkGfm);

  useEffect(() => {
    if (!hasRegexLookbehindSupport || cachedRemarkGfm) return;
    let cancelled = false;
    loadRemarkGfm().then((p) => {
      if (!cancelled) setPlugin(() => p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return plugin;
}
