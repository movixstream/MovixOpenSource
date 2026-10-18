import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useInView } from 'framer-motion';

/*
 * Affichage à palettes du code Downloader, adapté de « SplitFlapText » de
 * React Bits (David Haz, https://github.com/DavidHDev/react-bits,
 * public/r/SplitFlapText-TS-TW.json, commit 14330e69). Licence MIT + Commons
 * Clause : usage libre dans un site, pas de revente des composants eux-mêmes.
 *
 * Adaptations pour Movix :
 * - un seul code, sans boucle : les palettes tournent une fois quand le code
 *   arrive à l'écran, puis s'arrêtent ;
 * - couleurs du site (zinc, blanc, fente sombre), sans `color-mix()` pour
 *   les anciens navigateurs des télés ;
 * - mouvement réduit : le code s'affiche directement ;
 * - le code reste lisible par les lecteurs d'écran et sélectionnable à côté.
 */

interface Tile {
  current: string;
  next: string;
  flipping: boolean;
  tick: number;
}

interface Plan {
  index: number;
  from: string;
  sequence: string[];
  start: number;
  step: number;
  done: boolean;
}

const DIGITS = '0123456789';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
const FLIP_MS = 110;
const STAGGER_MS = 75;
const FLIPS_PER_CHAR = 6;

const styles = `
.tv-flap{gap:var(--tv-flap-gap,6px);font-family:ui-monospace,'SFMono-Regular','Cascadia Code','Roboto Mono',Menlo,monospace;font-size:var(--tv-flap-size,44px);font-weight:760;line-height:1;font-variant-numeric:tabular-nums}
.tv-flap__tile{position:relative;flex:none;width:.78em;height:1.1em;overflow:hidden;border-radius:.14em;background:linear-gradient(180deg,#2a2a2e,#18181b);box-shadow:0 .035em .08em rgba(255,255,255,.08) inset,0 -.05em .1em rgba(0,0,0,.4) inset,0 .18em .4em rgba(0,0,0,.35);perspective:10em;transform-style:preserve-3d;isolation:isolate}
.tv-flap__tile::before{content:'';position:absolute;z-index:8;top:calc(50% - .5px);left:0;width:100%;height:1px;background:rgba(0,0,0,.7);box-shadow:0 1px 0 rgba(255,255,255,.05);pointer-events:none}
.tv-flap__tile::after{content:'';position:absolute;inset:0;z-index:9;border:1px solid rgba(255,255,255,.07);border-radius:inherit;pointer-events:none}
.tv-flap__half,.tv-flap__flap{position:absolute;left:0;width:100%;height:50%;overflow:hidden;background:#232327;backface-visibility:hidden;-webkit-backface-visibility:hidden}
.tv-flap__half--top,.tv-flap__flap--front{top:0}
.tv-flap__half--bottom,.tv-flap__flap--back{bottom:0;background:#1c1c1f}
.tv-flap__char{position:absolute;left:0;width:100%;height:200%;display:flex;align-items:center;justify-content:center;color:#fafafa;text-shadow:0 .09em .16em rgba(0,0,0,.45)}
.tv-flap__half--top .tv-flap__char,.tv-flap__flap--front .tv-flap__char{top:0}
.tv-flap__half--bottom .tv-flap__char,.tv-flap__flap--back .tv-flap__char{bottom:0}
.tv-flap__flap{z-index:6;will-change:transform}
.tv-flap__flap--front{transform-origin:center bottom;animation:tv-flap-front var(--tv-flap-flip,.11s) linear both}
.tv-flap__flap--back{transform-origin:center top;transform:rotateX(90deg);animation:tv-flap-back var(--tv-flap-flip,.11s) linear both}
@keyframes tv-flap-front{0%{transform:rotateX(0deg);filter:brightness(1.06);animation-timing-function:cubic-bezier(.55,.055,.675,.19)}50%,100%{transform:rotateX(-90deg);filter:brightness(.55)}}
@keyframes tv-flap-back{0%,50%{transform:rotateX(90deg);filter:brightness(.6);animation-timing-function:cubic-bezier(.215,.61,.355,1)}100%{transform:rotateX(0deg);filter:brightness(1)}}
@media (prefers-reduced-motion: reduce){.tv-flap__flap{animation:none !important}}
`;

const randomChar = (charset: string) => charset.charAt(Math.floor(Math.random() * charset.length)) || ' ';

const staticTiles = (text: string): Tile[] =>
  text.split('').map((char) => ({ current: char, next: char, flipping: false, tick: 0 }));

interface SplitFlapCodeProps {
  code: string;
  /** Mouvement réduit : pas de rotation, le code est posé tel quel. */
  calm: boolean;
  className?: string;
  style?: CSSProperties;
}

export function SplitFlapCode({ code, calm, className, style }: SplitFlapCodeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inView = useInView(rootRef, { once: true, amount: 0.6 });
  const [tiles, setTiles] = useState<Tile[]>(() => staticTiles(calm ? code : ' '.repeat(code.length)));
  const rafRef = useRef<number | null>(null);
  const playedFor = useRef<string | null>(null);

  useEffect(() => {
    if (calm) {
      setTiles(staticTiles(code));
      playedFor.current = code;
      return undefined;
    }
    if (!inView || playedFor.current === code) return undefined;
    playedFor.current = code;

    const charset = /^\d+$/.test(code) ? DIGITS : ALNUM;
    const plans: Plan[] = code.split('').map((target, index) => {
      const sequence = Array.from({ length: FLIPS_PER_CHAR }, () => randomChar(charset));
      sequence.push(target);
      return { index, from: ' ', sequence, start: index * STAGGER_MS, step: -1, done: false };
    });
    setTiles(staticTiles(' '.repeat(code.length)));
    const startedAt = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      let running = false;
      const updates: Array<{ index: number; current: string; next: string; done: boolean }> = [];

      plans.forEach((plan) => {
        const local = elapsed - plan.start;
        if (local < 0) {
          running = true;
          return;
        }
        const step = Math.floor(local / FLIP_MS);
        if (step < plan.sequence.length) {
          running = true;
          if (step !== plan.step) {
            plan.step = step;
            updates.push({
              index: plan.index,
              current: step === 0 ? plan.from : plan.sequence[step - 1],
              next: plan.sequence[step],
              done: false,
            });
          }
        } else if (!plan.done) {
          plan.done = true;
          const target = plan.sequence[plan.sequence.length - 1];
          updates.push({ index: plan.index, current: target, next: target, done: true });
        }
      });

      if (updates.length > 0) {
        setTiles((previous) => {
          const nextTiles = [...previous];
          updates.forEach((update) => {
            const tile = nextTiles[update.index];
            if (!tile) return;
            nextTiles[update.index] = {
              current: update.current,
              next: update.next,
              flipping: !update.done,
              tick: tile.tick + 1,
            };
          });
          return nextTiles;
        });
      }

      rafRef.current = running ? requestAnimationFrame(tick) : null;
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Interrompu (changement de code, démontage) : on pose le code final.
      playedFor.current = null;
      setTiles(staticTiles(code));
    };
  }, [calm, code, inView]);

  return (
    <>
      <style>{styles}</style>
      <div
        ref={rootRef}
        className={`tv-flap relative inline-flex select-none items-center whitespace-pre ${className ?? ''}`}
        style={{ '--tv-flap-flip': `${FLIP_MS / 1000}s`, ...style } as CSSProperties}
      >
        <span className="sr-only">{code.split('').join(' ')}</span>
        {tiles.map((tile, index) => (
          <span className="tv-flap__tile" aria-hidden="true" key={index}>
            <span className="tv-flap__half tv-flap__half--top">
              <span className="tv-flap__char">{tile.flipping ? tile.next : tile.current}</span>
            </span>
            <span className="tv-flap__half tv-flap__half--bottom">
              <span className="tv-flap__char">{tile.current}</span>
            </span>
            {tile.flipping && (
              <>
                <span className="tv-flap__flap tv-flap__flap--front" key={`front-${tile.tick}`}>
                  <span className="tv-flap__char">{tile.current}</span>
                </span>
                <span className="tv-flap__flap tv-flap__flap--back" key={`back-${tile.tick}`}>
                  <span className="tv-flap__char">{tile.next}</span>
                </span>
              </>
            )}
          </span>
        ))}
      </div>
    </>
  );
}

export default SplitFlapCode;
