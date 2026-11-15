// src/components/Settings/HosterRegexEditor.tsx
//
// Milestone 7 — Éditeur de patterns regex pour les hosters built-in +
// création/suppression de hosters personnalisés. Section pliable dans
// `SourcePriorityPanel` (global aux 2 catégories : custom hosters et
// patternOverrides sont partagés moviesTv ⇄ anime).
//
// Fonctionnalités :
//   - Section "Hosters built-in" : sous-accordéon par hoster, affichage des
//     patterns built-in (non-supprimables, badge `built-in`) + patterns perso
//     de `patternOverrides[id]` (badge `perso`, bouton ✕). Ajout d'un pattern
//     via input inline avec validation regex live (`new RegExp(value, 'i')`).
//     Limite `MAX_PATTERNS = 20` par hoster (toast Sonner sur dépassement).
//   - Section "Hosters personnalisés" : liste des `customHosters` avec
//     leurs patterns. Bouton ➕ ouvre un Dialog (nom + 1er pattern), slug
//     auto `custom_<slug>`, collision check. À la création, le custom hoster
//     est ajouté en BAS de `hosterOrder` pour moviesTv ET anime. La suppression
//     passe par une AlertDialog (ici un Dialog stylé en alerte, inliné comme
//     pour Tabs/Switch en M5/M6) qui purge `customHosters`, `hosterOrder` et
//     tous les `overrides` des 2 catégories.
//
// Choix d'implémentation (pas de nouveaux wrappers Radix) :
//   - Collapsible = `<details>/<summary>` natif HTML (a11y correcte par
//     défaut, keyboard-friendly, aucun dep). On perd l'anim data-state Radix
//     mais le gain en simplicité justifie le compromis pour une section
//     "avancée" pliée par défaut.
//   - AlertDialog = `Dialog` Radix existant stylé en alerte (2 boutons
//     Annuler/Supprimer). Identique UX à AlertDialog Radix.
import React, { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import ReusableModal from '../ui/reusable-modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ChevronDown, Plus, X, Trash2, RotateCcw, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  BUILTIN_HOSTER_PATTERNS, HOSTER_LABELS, isHosterCustomized,
} from '../../utils/hosterRegistry';
import {
  getSourcePriorityPrefs, setSourcePriorityPrefs, subscribeToPriorityChanges,
  resetCustomHostersAndPatterns, restoreCustomHostersAndPatterns,
} from '../../utils/sourcePriorityPrefs';
import type {
  SourcePriorityPrefs, BuiltinHosterId, CustomHoster,
} from '../../types/sourcePriority';
import { BUILTIN_HOSTER_IDS } from '../../types/sourcePriority';

const MAX_PATTERNS = 20;

/**
 * Discriminated error so the component can render a translated message.
 * `empty` = missing input, `invalid` = regex compilation failure. The raw
 * JS error message from the invalid branch is kept for the i18n fallback
 * (some locales may want to show it verbatim).
 */
type RegexError =
  | { kind: 'empty' }
  | { kind: 'invalid'; raw: string };

function validateRegexError(p: string): RegexError | null {
  if (!p.trim()) return { kind: 'empty' };
  try { new RegExp(p, 'i'); return null; }
  catch (e) {
    return { kind: 'invalid', raw: e instanceof Error ? e.message : 'Regex invalide' };
  }
}

/**
 * Collapsible animé (replace des `<details>` natifs qui n'animaient pas).
 * Height + opacity via framer-motion `AnimatePresence`, ease outExpo, ~250ms.
 *
 * API : `summary` est une fonction qui reçoit l'état `open` pour permettre
 * aux consommateurs d'animer un chevron ou un badge côté header. Les boutons
 * internes qui ne doivent PAS déclencher le toggle doivent appeler
 * `e.stopPropagation()` (pattern déjà en place dans l'existant).
 *
 * a11y : `role="button"` + `aria-expanded` + keyboard Enter/Space sur le
 * header. `data-state="open|closed"` exposé pour un styling éventuel.
 */
interface AnimatedCollapsibleProps {
  summary: (open: boolean) => ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  defaultOpen?: boolean;
}
const AnimatedCollapsible: React.FC<AnimatedCollapsibleProps> = ({
  summary, children, className, summaryClassName, defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => setOpen((o) => !o);
  return (
    <div className={className} data-state={open ? 'open' : 'closed'}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        }}
        className={summaryClassName}
      >
        {summary(open)}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: 'hidden' }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AnimatedChevron: React.FC<{ open: boolean; size?: number; className?: string }> = ({
  open, size = 16, className,
}) => (
  <ChevronDown
    size={size}
    className={`transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className ?? ''}`}
  />
);

/**
 * Ligne pattern éditable : affiche le pattern en `<code>`, avec 2 boutons
 * (édition + suppression) qui n'apparaissent qu'au hover (ou quand focus).
 *
 * En mode édition : `<Input>` avec validation live, Entrée=sauver, Échap=annuler.
 *
 * Min-1 guard : si `canDelete=false`, le ✕ est désactivé avec tooltip
 * explicite — l'utilisateur ne peut pas vider complètement la liste d'un
 * hoster (utilise "Réinitialiser" pour revenir aux défauts, ou supprime le
 * hoster custom entier).
 */
interface PatternRowProps {
  pattern: string;
  canDelete: boolean;
  onSave: (newPattern: string) => boolean;
  onDelete: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}
const PatternRow: React.FC<PatternRowProps> = ({ pattern, canDelete, onSave, onDelete, t }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pattern);
  const [localError, setLocalError] = useState<string | null>(null);

  const validate = (v: string): string | null => {
    if (!v.trim()) return t('settings.sourcePriority.patternEmpty');
    try { new RegExp(v, 'i'); return null; }
    catch (e) { return e instanceof Error ? e.message : t('settings.sourcePriority.patternInvalid'); }
  };

  const cancel = () => {
    setEditing(false);
    setDraft(pattern);
    setLocalError(null);
  };

  const save = () => {
    const err = validate(draft);
    if (err) { setLocalError(err); return; }
    if (onSave(draft)) {
      setEditing(false);
      setLocalError(null);
    }
  };

  if (editing) {
    return (
      <div className="space-y-1 pt-1">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setLocalError(validate(e.target.value));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            }}
            className={localError ? 'border-red-500' : ''}
          />
          <Button size="sm" onClick={save} disabled={!!localError || !draft.trim()}>
            {t('settings.sourcePriority.confirmOk')}
          </Button>
          <Button size="sm" variant="outline" onClick={cancel}>
            {t('settings.sourcePriority.confirmCancel')}
          </Button>
        </div>
        {localError && <p className="text-xs text-red-400">{localError}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 text-sm group/row">
      <code className="text-xs bg-neutral-800 text-white/80 px-1.5 py-0.5 rounded break-all flex-1">
        {pattern}
      </code>
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded group/icon"
          onClick={() => setEditing(true)}
          aria-label={t('settings.sourcePriority.editPattern', { pattern })}
          title={t('settings.sourcePriority.editPatternTitle')}
        >
          <Pencil className="text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded group/icon"
          onClick={onDelete}
          disabled={!canDelete}
          aria-label={t('settings.sourcePriority.removePattern', { pattern })}
          title={canDelete
            ? t('settings.sourcePriority.removePatternTitle')
            : t('settings.sourcePriority.removePatternDisabledHint')}
        >
          <X className="text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" size={12} />
        </Button>
      </div>
    </div>
  );
};

export const HosterRegexEditor: React.FC = () => {
  const { t } = useTranslation();

  /**
   * Translate a `RegexError` to its user-facing message. The invalid-regex
   * path keeps the raw engine error so locales can choose to show it
   * (helpful for debugging malformed regex), but translates the label.
   */
  const regexErrorMessage = (err: RegexError | null): string | null => {
    if (!err) return null;
    if (err.kind === 'empty') return t('settings.sourcePriority.patternEmpty');
    return `${t('settings.sourcePriority.patternInvalid')}: ${err.raw}`;
  };

  // Abonnement aux changements : ré-render immédiat à chaque ajout/suppr
  // (garantit que la liste custom & les patterns reflètent le store).
  const [prefs, setPrefs] = useState<SourcePriorityPrefs>(() => getSourcePriorityPrefs());
  React.useEffect(() => subscribeToPriorityChanges(setPrefs), []);

  // État de l'input "Ajouter un pattern" (partagé entre tous les hosters :
  // un seul input inline visible à la fois, identifié par `addPatternFor`).
  const [addPatternFor, setAddPatternFor] = useState<BuiltinHosterId | string | null>(null);
  const [newPattern, setNewPattern] = useState('');
  const [newPatternError, setNewPatternError] = useState<RegexError | null>(null);

  // État du Dialog "Ajouter un hoster personnalisé".
  // `customError` mêle 2 origines : erreur regex (RegexError) ou "nom requis" /
  // "collision" (string). On garde un discriminant explicite pour le mapping i18n.
  type CustomError =
    | { kind: 'nameRequired' }
    | { kind: 'collision' }
    | { kind: 'regex'; err: RegexError };
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customFirstPattern, setCustomFirstPattern] = useState('');
  const [customError, setCustomError] = useState<CustomError | null>(null);

  const customErrorMessage = (err: CustomError | null): string | null => {
    if (!err) return null;
    if (err.kind === 'nameRequired') return t('settings.sourcePriority.customHosterNameRequired');
    if (err.kind === 'collision') return t('settings.sourcePriority.customHosterCollision');
    return regexErrorMessage(err.err);
  };

  // Id du custom hoster en attente de confirmation de suppression.
  const [deleteCustomId, setDeleteCustomId] = useState<string | null>(null);

  const resetAddPatternUI = () => {
    setAddPatternFor(null);
    setNewPattern('');
    setNewPatternError(null);
  };

  const resetAddCustomUI = () => {
    setCustomName('');
    setCustomFirstPattern('');
    setCustomError(null);
  };

  /**
   * Liste effective des patterns pour un built-in (override si présent,
   * sinon snapshot des built-ins). Utilisé pour matérialiser l'override à
   * la première édition.
   */
  const getEffectiveBuiltinList = (id: BuiltinHosterId): string[] => {
    return prefs.patternOverrides[id] ?? [...BUILTIN_HOSTER_PATTERNS[id]];
  };

  /**
   * Ajoute un pattern. Pour un built-in : matérialise l'override s'il n'existe
   * pas encore (copie des built-ins + nouveau pattern). Pour un custom hoster :
   * append à `customHoster.patterns`. Limite `MAX_PATTERNS` appliquée à la
   * liste EFFECTIVE (pas uniquement aux extras).
   */
  const handleAddPattern = (id: BuiltinHosterId | string) => {
    const err = validateRegexError(newPattern);
    if (err) { setNewPatternError(err); return; }
    const trimmed = newPattern.trim();

    if ((BUILTIN_HOSTER_IDS as readonly string[]).includes(id)) {
      const hosterId = id as BuiltinHosterId;
      const effective = getEffectiveBuiltinList(hosterId);
      if (effective.length >= MAX_PATTERNS) {
        toast.error(t('settings.sourcePriority.maxPatternsReached', { max: MAX_PATTERNS }));
        return;
      }
      if (effective.includes(trimmed)) {
        toast.error(t('settings.sourcePriority.patternAlreadyExists'));
        return;
      }
      setSourcePriorityPrefs({
        ...prefs,
        patternOverrides: {
          ...prefs.patternOverrides,
          [hosterId]: [...effective, trimmed],
        },
      });
    } else {
      const target = prefs.customHosters.find((c) => c.id === id);
      if (!target) return;
      if (target.patterns.length >= MAX_PATTERNS) {
        toast.error(t('settings.sourcePriority.maxPatternsReached', { max: MAX_PATTERNS }));
        return;
      }
      if (target.patterns.includes(trimmed)) {
        toast.error(t('settings.sourcePriority.patternAlreadyExists'));
        return;
      }
      setSourcePriorityPrefs({
        ...prefs,
        customHosters: prefs.customHosters.map((c) =>
          c.id === id ? { ...c, patterns: [...c.patterns, trimmed] } : c,
        ),
      });
    }
    resetAddPatternUI();
  };

  /**
   * Retire un pattern. Pour un built-in : matérialise l'override à la
   * première suppression et enlève le pattern. Guard min 1 : on n'enlève
   * jamais le dernier pattern (le UI désactive le bouton ✕ dans ce cas ;
   * safety net ici).
   */
  const handleRemovePattern = (id: BuiltinHosterId | string, pattern: string) => {
    if ((BUILTIN_HOSTER_IDS as readonly string[]).includes(id)) {
      const hosterId = id as BuiltinHosterId;
      const effective = getEffectiveBuiltinList(hosterId);
      if (effective.length <= 1) return; // Safety net : au moins 1 pattern requis.
      const next = effective.filter((p) => p !== pattern);
      setSourcePriorityPrefs({
        ...prefs,
        patternOverrides: {
          ...prefs.patternOverrides,
          [hosterId]: next,
        },
      });
    } else {
      setSourcePriorityPrefs({
        ...prefs,
        customHosters: prefs.customHosters.map((c) =>
          c.id === id ? { ...c, patterns: c.patterns.filter((p) => p !== pattern) } : c,
        ),
      });
    }
  };

  /**
   * Remplace un pattern existant par une nouvelle valeur. Valide la regex,
   * refuse les doublons (sauf si identique à l'ancien = no-op). Pour un
   * built-in, matérialise l'override à la première édition.
   */
  const handleEditPattern = (
    id: BuiltinHosterId | string,
    oldPattern: string,
    rawNewPattern: string,
  ): boolean => {
    const err = validateRegexError(rawNewPattern);
    if (err) {
      toast.error(t('settings.sourcePriority.patternInvalid'));
      return false;
    }
    const trimmed = rawNewPattern.trim();
    if (trimmed === oldPattern) return true; // no-op

    if ((BUILTIN_HOSTER_IDS as readonly string[]).includes(id)) {
      const hosterId = id as BuiltinHosterId;
      const effective = getEffectiveBuiltinList(hosterId);
      if (effective.includes(trimmed)) {
        toast.error(t('settings.sourcePriority.patternAlreadyExists'));
        return false;
      }
      const next = effective.map((p) => (p === oldPattern ? trimmed : p));
      setSourcePriorityPrefs({
        ...prefs,
        patternOverrides: {
          ...prefs.patternOverrides,
          [hosterId]: next,
        },
      });
    } else {
      const target = prefs.customHosters.find((c) => c.id === id);
      if (!target) return false;
      if (target.patterns.includes(trimmed)) {
        toast.error(t('settings.sourcePriority.patternAlreadyExists'));
        return false;
      }
      setSourcePriorityPrefs({
        ...prefs,
        customHosters: prefs.customHosters.map((c) =>
          c.id === id
            ? { ...c, patterns: c.patterns.map((p) => (p === oldPattern ? trimmed : p)) }
            : c,
        ),
      });
    }
    return true;
  };

  /**
   * Supprime l'override user d'un built-in → retour à la liste dynamique
   * des built-ins. L'utilisateur retrouve le comportement par défaut (et
   * profitera des nouveaux built-ins ajoutés dans les versions futures).
   */
  const handleResetHoster = (id: BuiltinHosterId) => {
    if (!prefs.patternOverrides[id]) return;
    const nextOverrides = { ...prefs.patternOverrides };
    delete nextOverrides[id];
    setSourcePriorityPrefs({ ...prefs, patternOverrides: nextOverrides });
    toast.success(t('settings.sourcePriority.resetHosterToast', { name: HOSTER_LABELS[id] }));
  };

  /**
   * Crée un custom hoster. Slug = `custom_<name.lowercase.slugified>`, collision
   * check contre les customHosters existants ET les ids built-in (protection
   * forte même si le préfixe `custom_` rend la collision peu probable). À la
   * création, le nouveau hoster est append en BAS de `hosterOrder` pour les 2
   * catégories (moviesTv + anime). L'utilisateur peut ensuite le draguer vers le
   * haut ou le pin.
   */
  const handleCreateCustom = () => {
    if (!customName.trim()) { setCustomError({ kind: 'nameRequired' }); return; }
    const regexErr = validateRegexError(customFirstPattern);
    if (regexErr) { setCustomError({ kind: 'regex', err: regexErr }); return; }
    const slug = `custom_${customName.trim().toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    if (prefs.customHosters.some((c) => c.id === slug)
      || (BUILTIN_HOSTER_IDS as readonly string[]).includes(slug)) {
      setCustomError({ kind: 'collision' });
      return;
    }
    const newHoster: CustomHoster = {
      id: slug,
      name: customName.trim(),
      patterns: [customFirstPattern.trim()],
    };
    setSourcePriorityPrefs({
      ...prefs,
      customHosters: [...prefs.customHosters, newHoster],
      categories: {
        moviesTv: {
          ...prefs.categories.moviesTv,
          hosterOrder: [...prefs.categories.moviesTv.hosterOrder, slug],
        },
        anime: {
          ...prefs.categories.anime,
          hosterOrder: [...prefs.categories.anime.hosterOrder, slug],
        },
      },
    });
    resetAddCustomUI();
    setAddCustomOpen(false);
    toast.success(t('settings.sourcePriority.customHosterCreated', { name: newHoster.name }));
  };

  /**
   * Supprime un custom hoster :
   *   - retire de `customHosters`
   *   - purge de `hosterOrder` (moviesTv + anime)
   *   - purge de toutes les entrées `overrides` des 2 catégories (l'id
   *     peut apparaître dans un override par-source/par-langue)
   *
   * Le pin éventuel sur ce hoster (`pinnedHoster.id === id`) est aussi
   * nettoyé : si le hoster pinné est supprimé, on lève le flag pour éviter
   * un pin orphelin (le snapshot aurait encore l'id, mais l'unpin le
   * re-matérialiserait dans `hosterOrder`).
   */
  const handleDeleteCustom = (id: string) => {
    const purgeOverrides = <K extends string>(o: Partial<Record<K, string[]>>) =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [k, (v as string[] | undefined)?.filter((h) => h !== id) ?? []]),
      ) as Partial<Record<K, string[]>>;

    const moviesTv = prefs.categories.moviesTv;
    const anime = prefs.categories.anime;

    setSourcePriorityPrefs({
      ...prefs,
      customHosters: prefs.customHosters.filter((c) => c.id !== id),
      categories: {
        moviesTv: {
          ...moviesTv,
          hosterOrder: moviesTv.hosterOrder.filter((h) => h !== id),
          overrides: purgeOverrides(moviesTv.overrides),
          pinnedHoster: moviesTv.pinnedHoster?.id === id ? null : moviesTv.pinnedHoster,
        },
        anime: {
          ...anime,
          hosterOrder: anime.hosterOrder.filter((h) => h !== id),
          overrides: purgeOverrides(anime.overrides),
          pinnedHoster: anime.pinnedHoster?.id === id ? null : anime.pinnedHoster,
        },
      },
    });
    setDeleteCustomId(null);
    toast.success(t('settings.sourcePriority.customHosterDeleted'));
  };

  // Nom du hoster affiché dans la modale de confirmation de suppression.
  const deleteTarget = deleteCustomId
    ? prefs.customHosters.find((c) => c.id === deleteCustomId)
    : null;

  /**
   * M8 — Reset des hosters personnalisés et patternOverrides avec undo toast.
   * Même pattern que dans `SourcePriorityPanel.doResetWithUndo`. Placé ici
   * pour éviter une prop drilling (helper local au composant). Le restore
   * remet les customHosters + patternOverrides via setSourcePriorityPrefs.
   */
  const handleResetCustomAndPatterns = () => {
    const snapshot = resetCustomHostersAndPatterns();
    toast(t('settings.sourcePriority.resetCustomToast'), {
      action: {
        label: t('settings.sourcePriority.undoToastAction'),
        onClick: () => restoreCustomHostersAndPatterns(snapshot),
      },
      duration: 5000,
    });
  };

  // Désactive le bouton Reset quand il n'y a rien à reset (évite un toast
  // inutile sur un state déjà vide).
  const hasCustomOrPatterns =
    prefs.customHosters.length > 0
    || Object.values(prefs.patternOverrides).some((arr) => (arr?.length ?? 0) > 0);

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.02]">
      <AnimatedCollapsible
        summaryClassName="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none hover:bg-white/5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        summary={(open) => (
          <>
            <div className="flex flex-col">
              <span className="text-white font-medium">{t('settings.sourcePriority.sectionAdvanced')}</span>
              <span className="text-xs text-white/50">
                {t('settings.sourcePriority.sectionAdvancedDescription')}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasCustomOrPatterns && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-white/60 hover:text-white group/icon"
                  // Empêche le toggle du collapsible parent.
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleResetCustomAndPatterns();
                  }}
                  title={t('settings.sourcePriority.resetCustomTitle')}
                >
                  <RotateCcw size={12} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" /> {t('settings.sourcePriority.resetSectionShort')}
                </Button>
              )}
              <AnimatedChevron open={open} />
            </div>
          </>
        )}
      >
        <div className="space-y-5 px-4 pb-4 pt-1">
          {/* ─── Hosters built-in ─── */}
          <section>
            <h5 className="font-medium mb-2 text-sm text-white">
              {t('settings.sourcePriority.sectionBuiltinHosters')}
            </h5>
            <p className="text-xs text-white/50 mb-2">
              {t('settings.sourcePriority.sectionBuiltinHostersDescription')}
            </p>
            <div className="space-y-2">
              {BUILTIN_HOSTER_IDS.map((id) => {
                // Liste effective (override user si présent, sinon built-ins dynamiques)
                const effective = prefs.patternOverrides[id] ?? BUILTIN_HOSTER_PATTERNS[id];
                const customized = isHosterCustomized(id, prefs.patternOverrides);
                const total = effective.length;
                const canDelete = total > 1; // Guard min 1
                const isAdding = addPatternFor === id;
                return (
                  <AnimatedCollapsible
                    key={id}
                    className="rounded-md border border-white/10 bg-white/[0.03]"
                    summaryClassName="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none hover:bg-white/5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                    summary={(open) => (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <AnimatedChevron open={open} size={14} className="text-white opacity-50 shrink-0" />
                          <span className="text-sm text-white truncate">{HOSTER_LABELS[id]}</span>
                          {customized && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0"
                              title={t('settings.sourcePriority.hosterCustomizedTitle')}
                            >
                              {t('settings.sourcePriority.hosterCustomized')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {customized && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs text-white/60 hover:text-white group/icon"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleResetHoster(id);
                              }}
                              title={t('settings.sourcePriority.resetHosterTitle')}
                            >
                              <RotateCcw size={11} className="mr-1 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                              {t('settings.sourcePriority.resetHoster')}
                            </Button>
                          )}
                          <span className="text-xs text-white/50">
                            {t('settings.sourcePriority.patternsCount', { count: total })}
                          </span>
                        </div>
                      </>
                    )}
                  >
                    <div className="pl-3 pr-3 pb-3 pt-1 space-y-1">
                      {effective.map((p) => (
                        <PatternRow
                          key={`${id}-${p}`}
                          pattern={p}
                          canDelete={canDelete}
                          onSave={(newP) => handleEditPattern(id, p, newP)}
                          onDelete={() => handleRemovePattern(id, p)}
                          t={t}
                        />
                      ))}
                      {isAdding ? (
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center gap-2">
                            <Input
                              autoFocus
                              value={newPattern}
                              onChange={(e) => {
                                setNewPattern(e.target.value);
                                setNewPatternError(validateRegexError(e.target.value));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !newPatternError && newPattern.trim()) {
                                  e.preventDefault(); handleAddPattern(id);
                                }
                                if (e.key === 'Escape') { e.preventDefault(); resetAddPatternUI(); }
                              }}
                              placeholder={t('settings.sourcePriority.patternPlaceholder')}
                              className={newPatternError ? 'border-red-500' : ''}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleAddPattern(id)}
                              disabled={!!newPatternError || !newPattern.trim()}
                            >
                              {t('settings.sourcePriority.confirmOk')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={resetAddPatternUI}>
                              {t('settings.sourcePriority.confirmCancel')}
                            </Button>
                          </div>
                          {newPatternError && (
                            <p className="text-xs text-red-400">{regexErrorMessage(newPatternError)}</p>
                          )}
                        </div>
                      ) : (
                        <Button className="group/icon"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAddPatternFor(id);
                            setNewPattern('');
                            setNewPatternError(null);
                          }}
                        >
                          <Plus size={12} className="mr-1 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> {t('settings.sourcePriority.addPattern')}
                        </Button>
                      )}
                    </div>
                  </AnimatedCollapsible>
                );
              })}
            </div>
          </section>

          {/* ─── Hosters personnalisés ─── */}
          <section>
            <h5 className="font-medium mb-2 text-sm text-white">
              {t('settings.sourcePriority.sectionCustomHosters')}
            </h5>
            <p className="text-xs text-amber-400/80 mb-2">
              {t('settings.sourcePriority.customHostersWarning')}
            </p>
            <div className="space-y-2">
              {prefs.customHosters.length === 0 && (
                <p className="text-xs text-white/40 italic">
                  {t('settings.sourcePriority.customHosterEmpty')}
                </p>
              )}
              {prefs.customHosters.map((c) => {
                const isAdding = addPatternFor === c.id;
                return (
                  <AnimatedCollapsible
                    key={c.id}
                    className="rounded-md border border-white/10 bg-white/[0.03]"
                    summaryClassName="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none hover:bg-white/5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                    summary={(open) => (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <AnimatedChevron open={open} size={14} className="text-white opacity-50 shrink-0" />
                          <span className="text-sm text-white truncate">{c.name}</span>
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 shrink-0"
                            title={t('settings.sourcePriority.customHosterBadgeIframeTitle')}
                          >
                            [{t('settings.sourcePriority.customHosterBadgeIframe')}]
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-white/50">
                            {t('settings.sourcePriority.patternsCount', { count: c.patterns.length })}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded group/icon"
                            onClick={(e) => {
                              // Empêche le toggle du collapsible parent quand on clique sur Trash.
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteCustomId(c.id);
                            }}
                            aria-label={t('settings.sourcePriority.customHosterRemoveAria', { name: c.name })}
                          >
                            <Trash2 className="text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" size={14} />
                          </Button>
                        </div>
                      </>
                    )}
                  >
                    <div className="pl-3 pr-3 pb-3 pt-1 space-y-1">
                      {c.patterns.map((p) => (
                        <PatternRow
                          key={`${c.id}-${p}`}
                          pattern={p}
                          canDelete={c.patterns.length > 1}
                          onSave={(newP) => handleEditPattern(c.id, p, newP)}
                          onDelete={() => handleRemovePattern(c.id, p)}
                          t={t}
                        />
                      ))}
                      {isAdding ? (
                        <div className="space-y-1 pt-1">
                          <div className="flex items-center gap-2">
                            <Input
                              autoFocus
                              value={newPattern}
                              onChange={(e) => {
                                setNewPattern(e.target.value);
                                setNewPatternError(validateRegexError(e.target.value));
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !newPatternError && newPattern.trim()) {
                                  e.preventDefault(); handleAddPattern(c.id);
                                }
                                if (e.key === 'Escape') { e.preventDefault(); resetAddPatternUI(); }
                              }}
                              placeholder={t('settings.sourcePriority.customHosterPatternPlaceholder')}
                              className={newPatternError ? 'border-red-500' : ''}
                            />
                            <Button
                              size="sm"
                              onClick={() => handleAddPattern(c.id)}
                              disabled={!!newPatternError || !newPattern.trim()}
                            >
                              {t('settings.sourcePriority.confirmOk')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={resetAddPatternUI}>
                              {t('settings.sourcePriority.confirmCancel')}
                            </Button>
                          </div>
                          {newPatternError && (
                            <p className="text-xs text-red-400">{regexErrorMessage(newPatternError)}</p>
                          )}
                        </div>
                      ) : (
                        <Button className="group/icon"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAddPatternFor(c.id);
                            setNewPattern('');
                            setNewPatternError(null);
                          }}
                        >
                          <Plus size={12} className="mr-1 text-white opacity-70 group-hover/icon:opacity-100 transition-opacity duration-200" /> {t('settings.sourcePriority.addPattern')}
                        </Button>
                      )}
                    </div>
                  </AnimatedCollapsible>
                );
              })}

              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  resetAddCustomUI();
                  setAddCustomOpen(true);
                }}
              >
                <Plus size={14} className="mr-1" /> {t('settings.sourcePriority.addCustomHoster')}
              </Button>
            </div>
          </section>
        </div>
      </AnimatedCollapsible>

      {/* ─── Popup : créer un hoster custom ─── */}
      <ReusableModal
        isOpen={addCustomOpen}
        onClose={() => { setAddCustomOpen(false); resetAddCustomUI(); }}
        title={t('settings.sourcePriority.customHosterDialogTitle')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-white/60">
            {t('settings.sourcePriority.customHosterDialogDescription')}
          </p>
          <Input
            placeholder={t('settings.sourcePriority.customHosterNamePlaceholder')}
            value={customName}
            onChange={(e) => {
              setCustomName(e.target.value);
              if (customError?.kind === 'nameRequired' && e.target.value.trim()) {
                setCustomError(null);
              }
            }}
          />
          <Input
            placeholder={t('settings.sourcePriority.customHosterPatternPlaceholder')}
            value={customFirstPattern}
            onChange={(e) => {
              setCustomFirstPattern(e.target.value);
              const err = validateRegexError(e.target.value);
              setCustomError(err ? { kind: 'regex', err } : null);
            }}
            className={customError && customError.kind !== 'nameRequired' ? 'border-red-500' : ''}
          />
          {customError && <p className="text-xs text-red-400">{customErrorMessage(customError)}</p>}
          <p className="text-xs text-amber-400/80">
            {t('settings.sourcePriority.customHosterWarning')}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-white/10 mt-2">
            <Button
              variant="outline"
              onClick={() => { setAddCustomOpen(false); resetAddCustomUI(); }}
            >
              {t('settings.sourcePriority.confirmCancel')}
            </Button>
            <Button
              onClick={handleCreateCustom}
              disabled={!customName.trim() || !customFirstPattern.trim() || !!customError}
            >
              {t('settings.sourcePriority.customHosterCreate')}
            </Button>
          </div>
        </div>
      </ReusableModal>

      {/* ─── Popup confirmation suppression hoster custom ─── */}
      <ReusableModal
        isOpen={!!deleteCustomId}
        onClose={() => setDeleteCustomId(null)}
        title={t('settings.sourcePriority.customHosterDeleteConfirmTitle')}
        className="max-w-md"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-white/80 leading-relaxed">
            {deleteTarget
              ? t('settings.sourcePriority.customHosterDeleteConfirmDescriptionNamed', { name: deleteTarget.name })
              : t('settings.sourcePriority.customHosterDeleteConfirmDescription')}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3 border-t border-white/10">
            <Button variant="outline" onClick={() => setDeleteCustomId(null)}>
              {t('settings.sourcePriority.customHosterDeleteConfirmCancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteCustomId && handleDeleteCustom(deleteCustomId)}
            >
              {t('settings.sourcePriority.customHosterDeleteConfirmAction')}
            </Button>
          </div>
        </div>
      </ReusableModal>
    </section>
  );
};

export default HosterRegexEditor;
