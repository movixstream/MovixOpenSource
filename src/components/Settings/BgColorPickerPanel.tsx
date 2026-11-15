import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

interface BgColorPickerPanelProps {
  /** Couleur committée (utilisée pour synchroniser quand un preset est cliqué). */
  committedHex: string;
  /** Hint i18n pour le texte sous le picker. */
  hint: string;
  /** Nom accessible du champ hexadécimal quand plusieurs pickers coexistent. */
  label?: string;
  /**
   * Appelé uniquement après que l'utilisateur arrête de bouger la pipette
   * (debounce ~100ms). Le parent reçoit donc max ~10 updates/sec au lieu
   * de 60+ — fix le lag du re-render de SettingsPage (3440 lignes).
   */
  onCommit: (hex: string) => void;
  /** Permet de forcer un affichage vertical dans les conteneurs étroits. */
  layout?: 'auto' | 'column';
}

/**
 * Picker isolé : possède son propre `draft` state, ce qui empêche le
 * re-render de SettingsPage à chaque pointermove de la pipette.
 * `React.memo` + props stables côté parent → re-render uniquement quand
 * `committedHex` change (sync depuis preset, ou sync localStorage).
 */
export const BgColorPickerPanel = memo(function BgColorPickerPanel({
  committedHex,
  hint,
  label,
  onCommit,
  layout = 'auto',
}: BgColorPickerPanelProps) {
  const [draft, setDraft] = useState(committedHex);
  const commitTimerRef = useRef<number | null>(null);
  const lastCommittedRef = useRef(committedHex);

  // Sync externe → draft : quand le parent change `committedHex` via une
  // source autre que le picker (clic preset, sync depuis un autre device).
  // On ignore les updates qui correspondent à ce qu'on vient de committer
  // pour éviter que le picker saute pendant que l'user drag.
  useEffect(() => {
    if (committedHex !== lastCommittedRef.current) {
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
      lastCommittedRef.current = committedHex;
      setDraft(committedHex);
    }
  }, [committedHex]);

  // Cleanup timer si l'utilisateur navigue ailleurs en plein drag.
  useEffect(() => {
    return () => {
      if (commitTimerRef.current) {
        window.clearTimeout(commitTimerRef.current);
      }
    };
  }, []);

  const scheduleCommit = useCallback((hex: string) => {
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = window.setTimeout(() => {
      lastCommittedRef.current = hex;
      onCommit(hex);
      commitTimerRef.current = null;
    }, 100);
  }, [onCommit]);

  const handlePickerChange = useCallback((hex: string) => {
    setDraft(hex);
    scheduleCommit(hex);
  }, [scheduleCommit]);

  const handleHexInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    const next = '#' + v.toLowerCase();
    setDraft(next);
    // Expanding a three-digit colour while typing would prevent entering six
    // digits once the parent normalises it. Accept short hex on blur instead.
    if (v.length === 6) {
      scheduleCommit(next);
    }
  }, [scheduleCommit]);

  const commitHexInput = () => {
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
    if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(draft)) {
      lastCommittedRef.current = draft;
      if (draft !== committedHex) onCommit(draft);
    } else {
      setDraft(committedHex);
    }
  };

  return (
    <div className={`mt-4 flex gap-4 items-start w-full ${layout === 'column' ? 'flex-col' : 'flex-col sm:flex-row'}`}>
      <div className="settings-color-picker">
        <HexColorPicker color={draft} onChange={handlePickerChange} />
      </div>
      <div className="flex-1 w-full space-y-2">
        <div className="flex items-center gap-2">
          <div
            className="w-10 h-10 rounded-lg border border-white/20 flex-shrink-0"
            style={{ backgroundColor: draft }}
          />
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm select-none pointer-events-none">#</span>
            <input
              type="text"
              aria-label={label ?? hint}
              value={draft.replace('#', '').toUpperCase()}
              onChange={handleHexInput}
              onBlur={commitHexInput}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              placeholder="EF4444"
              maxLength={6}
              className="w-full bg-gray-800/60 border border-gray-700/40 rounded-lg px-6 py-2 text-sm text-white font-mono tracking-wider focus:outline-none focus:border-indigo-500/60"
              style={{ colorScheme: 'dark' }}
            />
          </div>
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed">{hint}</p>
      </div>
    </div>
  );
});
