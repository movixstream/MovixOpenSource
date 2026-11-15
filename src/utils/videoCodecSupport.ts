// src/utils/videoCodecSupport.ts
//
// Sait si l'appareil décode le HEVC (H.265), le codec des MP4 SwiftFlux.
//
// Chrome, Edge et Brave ne décodent le HEVC qu'avec un décodeur matériel : un
// PC un peu ancien ne l'a pas. Le fichier se charge quand même, le son joue,
// mais l'image reste noire — sans aucune erreur `<video>`. Deux signaux :
// - a priori, ce que le navigateur annonce (`MediaSource.isTypeSupported`) ;
// - a posteriori, le lecteur qui constate une lecture sans image
//   (`markVideoUndecodable`), parce que l'annonce peut mentir.

const HEVC_TYPES = [
  'video/mp4; codecs="hvc1.1.6.L120.90"',
  'video/mp4; codecs="hev1.1.6.L120.90"',
];
const UNDECODABLE_KEY = 'movix:video-undecodable';

let announcedSupport: boolean | null = null;
let undecodableSeen = false;

function browserAnnouncesHevc(): boolean {
  if (announcedSupport !== null) return announcedSupport;
  try {
    const mse = typeof MediaSource !== 'undefined' ? MediaSource : undefined;
    if (mse?.isTypeSupported) {
      announcedSupport = HEVC_TYPES.some((type) => mse.isTypeSupported(type));
    } else {
      // Sans MSE (vieux Safari iOS) : la balise `<video>` reste juge.
      const probe = document.createElement('video');
      announcedSupport = HEVC_TYPES.some((type) => probe.canPlayType(type) !== '');
    }
  } catch {
    // Dans le doute, on ne cache pas la source : le lecteur rattrapera.
    announcedSupport = true;
  }
  return announcedSupport;
}

/** Le lecteur a vu le son avancer sans aucune image décodée. */
export function markVideoUndecodable(): void {
  undecodableSeen = true;
  try { sessionStorage.setItem(UNDECODABLE_KEY, '1'); } catch { /* stockage bloqué */ }
}

function undecodableObserved(): boolean {
  if (undecodableSeen) return true;
  try { return sessionStorage.getItem(UNDECODABLE_KEY) === '1'; } catch { return false; }
}

/** Faut-il proposer une source HEVC (SwiftFlux) à cet appareil ? */
export function isHevcPlayable(): boolean {
  return browserAnnouncesHevc() && !undecodableObserved();
}
