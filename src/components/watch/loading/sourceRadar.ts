// src/components/watch/loading/sourceRadar.ts
//
// Radar des sources de l'écran de chargement des pages Watch.
//
// Les pages Watch interrogent une dizaine de sites en parallèle, puis lancent
// des extractions m3u8 sur les lecteurs que ces sites renvoient. Ce petit
// magasin (sans React) note tout ça au fil de l'eau pour que l'écran de
// chargement montre ce qui se passe vraiment : quel site cherche encore,
// quels lecteurs sont prêts, lesquels sont en cours d'extraction.
//
// Il porte aussi la « coupure » du bouton « Lancer maintenant » : une promesse
// que la page fait courir contre ses requêtes lentes (`race`). Une fois la
// coupure déclenchée, les retardataires rendent leur valeur de repli et la
// page termine son chargement avec ce qu'elle a déjà.

import { HOSTER_LABELS, detectHoster } from '@/utils/hosterRegistry';
import { usesExtensionExtraction, type ExtractionProgress } from '@/utils/extractM3u8';

/** `ready` : extrait, lu par le lecteur Movix. `embed` : lu dans une iframe. */
export type RadarPlayerState = 'extracting' | 'verifying' | 'ready' | 'embed' | 'failed';

export interface RadarSite {
  id: string;
  label: string;
  /** Liens ajoutés par l'équipe Movix (Firebase, MP4). */
  admin: boolean;
  answered: boolean;
}

export interface RadarPlayer {
  key: string;
  site: string;
  host: string;
  lang: string | null;
  state: RadarPlayerState;
  admin: boolean;
}

export interface RadarSnapshot {
  sites: RadarSite[];
  players: RadarPlayer[];
  /** Le bouton « Lancer maintenant » a été pressé. */
  cutoff: boolean;
}

export interface RadarLinkInput {
  url: string;
  /** Nom du lecteur donné par le site, quand l'URL ne suffit pas. */
  name?: string;
  /** Texte où chercher la langue (« VF », « VOSTFR », catégorie…). */
  lang?: string;
  /** Nom affiché imposé (« MP4 direct », « Frembed »…). */
  host?: string;
  state?: RadarPlayerState;
}

/** Ce que `runExtractionPass` accepte pour tenir le radar à jour. */
export interface RadarPassHooks {
  onProgress: (progress: ExtractionProgress) => void;
  onDone: () => void;
  cutoff: Promise<void>;
}

/**
 * Clé tolérante aux réécritures de domaine (uqload.cx → uqload.is…) : premier
 * label d'hôte + chemin, comme `looseUrlKey` dans `runExtractionPass`.
 */
function linkKey(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').split('.')[0];
    return `${host.toLowerCase()}${parsed.pathname.toLowerCase().replace(/\/+$/, '')}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function hostOf(url: string, name?: string): string {
  const type = detectHoster(url) ?? (name ? detectHoster(name) : null);
  if (type) {
    return (HOSTER_LABELS as Record<string, string | undefined>)[type]
      ?? type.charAt(0).toUpperCase() + type.slice(1);
  }
  const cleaned = (name ?? '').replace(/\s+/g, ' ').trim();
  // Certains sites (SwiftFlow) nomment leurs fichiers par leur poids :
  // « 676.38 MB » ne dit pas ce que c'est, « MP4 · 676 Mo » si.
  const size = /^(\d+(?:[.,]\d+)?)\s*(MB|GB|Mo|Go)$/i.exec(cleaned);
  if (size) {
    const unit = size[2].toUpperCase().startsWith('G') ? 'Go' : 'Mo';
    const value = Number(size[1].replace(',', '.'));
    return `MP4 · ${unit === 'Go' ? value.toFixed(1).replace('.', ',') : Math.round(value)} ${unit}`;
  }
  if (cleaned) return cleaned.length > 22 ? `${cleaned.slice(0, 21)}…` : cleaned;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').split('.')[0];
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    return 'Lecteur';
  }
}

/** Même règle que `languageOf` de `runExtractionPass` : rien plutôt qu'un VF inventé. */
export function radarLanguage(...texts: (string | null | undefined)[]): string | null {
  const haystack = texts.filter((text): text is string => typeof text === 'string').join(' ').toLowerCase();
  if (haystack.includes('vostfr')) return 'VOSTFR';
  if (/\bvfq\b/.test(haystack)) return 'VFQ';
  if (/\bvf[f]?\b/.test(haystack)) return 'VF';
  return null;
}

const FINAL_STATES = new Set<RadarPlayerState>(['ready', 'embed', 'failed']);

// Seuls FStream et SwiftFlux (site « swiftflow ») donnent une langue fiable :
// les autres sites mélangent ou devinent, le radar n'affiche donc rien pour eux.
const SITES_WITH_LANGUAGE = new Set(['fstream', 'swiftflow']);

export interface SourceRadar {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => RadarSnapshot;
  /** Repart de zéro (nouveau film, nouvel épisode). Crée une nouvelle coupure. */
  reset: (sites: { id: string; label: string; admin?: boolean }[]) => void;
  /** Le site a répondu, avec ou sans lecteurs. */
  answer: (siteId: string, links?: RadarLinkInput[]) => void;
  /** Ajoute des lecteurs à un site qui a déjà répondu. */
  addLinks: (siteId: string, links: RadarLinkInput[]) => void;
  /** Change l'état d'un lecteur déjà connu (extraction maison d'une page). */
  setState: (url: string, state: RadarPlayerState) => void;
  /** Branche une passe `runExtractionPass` de ce site sur le radar. */
  pass: (siteId: string) => RadarPassHooks;
  /** Fin du chargement : tout lecteur encore en attente se lit en iframe. */
  settle: () => void;
  /** Fait courir une promesse contre la coupure du bouton « Lancer maintenant ». */
  race: <T>(promise: Promise<T>, fallback: T) => Promise<T>;
  /** Le bouton « Lancer maintenant ». */
  triggerCutoff: () => void;
}

export function createSourceRadar(): SourceRadar {
  const listeners = new Set<() => void>();
  let sites: RadarSite[] = [];
  let players: RadarPlayer[] = [];
  let cutoff = false;
  let snapshot: RadarSnapshot = { sites, players, cutoff };
  let releaseCutoff: () => void = () => {};
  let cutoffPromise: Promise<void> = Promise.resolve();
  // Génération : un résultat qui arrive après un `reset` ne touche plus rien.
  let generation = 0;

  const newCutoff = () => {
    cutoffPromise = new Promise<void>((resolve) => { releaseCutoff = resolve; });
  };
  newCutoff();

  const emit = () => {
    snapshot = { sites, players, cutoff };
    listeners.forEach((listener) => listener());
  };

  const insertLinks = (siteId: string, links: RadarLinkInput[]) => {
    const site = sites.find((entry) => entry.id === siteId);
    const known = new Set(players.map((player) => player.key));
    const added: RadarPlayer[] = [];
    for (const link of links) {
      if (!link || typeof link.url !== 'string' || !link.url) continue;
      const key = linkKey(link.url);
      if (known.has(key)) continue;
      known.add(key);
      added.push({
        key,
        site: siteId,
        host: link.host ?? hostOf(link.url, link.name),
        lang: SITES_WITH_LANGUAGE.has(siteId) ? radarLanguage(link.lang, link.name) : null,
        // Trouvé = jouable dans l'iframe du site, tant qu'une extraction ne
        // dit pas mieux.
        state: link.state ?? 'embed',
        admin: !!site?.admin,
      });
    }
    if (added.length > 0) players = [...players, ...added];
    return added.length > 0;
  };

  // Avec l'extension, on suit chaque lecteur. Sans elle (extraction serveur
  // des VIP), on ne sait pas ce que le serveur essaie : on ne montre que les
  // réussites, jamais « extraction… » ni « raté ».
  let live = false;

  const updateState = (key: string, state: RadarPlayerState) => {
    if (!live && (state === 'extracting' || state === 'failed')) return false;
    let changed = false;
    players = players.map((player) => {
      if (player.key !== key || player.state === state) return player;
      // Un lecteur prêt ne redevient pas « en cours » : la passe générique et
      // l'extraction maison d'une page peuvent passer sur la même URL.
      if (player.state === 'ready' && state !== 'ready') return player;
      changed = true;
      return { ...player, state };
    });
    return changed;
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    reset(nextSites) {
      generation += 1;
      releaseCutoff();
      newCutoff();
      cutoff = false;
      live = usesExtensionExtraction();
      sites = nextSites.map((site) => ({ id: site.id, label: site.label, admin: !!site.admin, answered: false }));
      players = [];
      emit();
    },
    answer(siteId, links = []) {
      sites = sites.map((site) => (site.id === siteId && !site.answered ? { ...site, answered: true } : site));
      insertLinks(siteId, links);
      emit();
    },
    addLinks(siteId, links) {
      if (insertLinks(siteId, links)) emit();
    },
    setState(url, state) {
      if (updateState(linkKey(url), state)) emit();
    },
    pass(siteId) {
      const passGeneration = generation;
      const seen = new Set<string>();
      return {
        cutoff: cutoffPromise,
        onProgress(progress) {
          if (passGeneration !== generation || !progress?.url) return;
          const key = linkKey(progress.url);
          seen.add(key);
          // Lecteur que le site n'avait pas annoncé tel quel : on l'ajoute.
          if (!players.some((player) => player.key === key)) {
            insertLinks(siteId, [{ url: progress.url, name: progress.type }]);
          }
          const state: RadarPlayerState = progress.status === 'success'
            ? (progress.result?.success ? 'ready' : 'failed')
            : progress.status === 'error' ? 'failed' : 'extracting';
          updateState(key, state);
          emit();
        },
        onDone() {
          if (passGeneration !== generation) return;
          // Ce que la passe n'a pas touché n'a pas d'extracteur : il reste
          // jouable dans l'iframe du site.
          let changed = false;
          players = players.map((player) => {
            if (player.site !== siteId || seen.has(player.key) || FINAL_STATES.has(player.state) || player.state === 'verifying') return player;
            changed = true;
            return { ...player, state: 'embed' };
          });
          if (changed) emit();
        },
      };
    },
    settle() {
      let changed = false;
      sites = sites.map((site) => {
        if (site.answered) return site;
        changed = true;
        return { ...site, answered: true };
      });
      // En attente : sans extracteur, il se lit dans l'iframe du site. Une
      // vérification pas finie (SwiftFlux) reste jouable : sa porte la refera.
      players = players.map((player) => {
        if (FINAL_STATES.has(player.state)) return player;
        changed = true;
        return { ...player, state: player.state === 'verifying' ? 'ready' : 'embed' };
      });
      if (changed) emit();
    },
    race(promise, fallback) {
      const raceGeneration = generation;
      return Promise.race([
        promise,
        cutoffPromise.then(() => (raceGeneration === generation ? fallback : promise)),
      ]);
    },
    triggerCutoff() {
      if (cutoff) return;
      cutoff = true;
      releaseCutoff();
      emit();
    },
  };
}

/** Lecteurs jouables : extraits ou en iframe. */
export function countPlayable(players: RadarPlayer[]): number {
  return players.filter((player) => player.state === 'ready' || player.state === 'embed').length;
}
