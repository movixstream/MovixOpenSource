import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useWebHaptics } from 'web-haptics/react';
import { useTranslation } from 'react-i18next';
import { useIntro } from '../context/IntroContext';

interface IntroAnimationProps {
  onAnimationComplete: () => void;
}

/* ============================================================
   Intro « les crochets claquent » (≈ 3,2 s), faite avec les
   tracés exacts de MovixWordmark :
   - 0,04 s : les lettres montent une à une ;
   - 0,6 s « tu » : les crochets arrivent des bords et claquent
     sur le mot ;
   - 1,04 s « DUM » : le point carré tombe sur le i, onde carrée
     et petite secousse ;
   - 2,1 s : le mot s'écrase, les crochets forment un petit écran
     16:9 où le site s'allume ;
   - 2,58 s : les crochets s'ouvrent comme un rideau sur le site.

   Toute la chronologie est en CSS (délais, aucun setTimeout) :
   elle tourne hors du fil principal pendant que le site charge
   derrière. Les tailles sont en unités de conteneur (cq*) de
   l'overlay. La fin est lue sur animationend de mx-vl (ou mx-out
   en mouvement réduit), les vibrations sur animationstart de
   mx-kick (« tu ») et mx-wave (« DUM »).

   L'overlay est rendu dans un portail en fin de <body>, au z-index
   maximal : rien de la page (barre de chargement, toasts, bannières)
   ne passe devant pendant que le site charge derrière.
   ============================================================ */

const BRACKET_LEFT =
  'M40.5 23.75L13.5 23.75L13.5 96.75L40.5 96.75L40.5 89.75L20.5 89.75L20.5 30.75L40.5 30.75ZM16 37.42H18A0.7 0.7 0 0 1 18.7 38.12V40.52A0.7 0.7 0 0 1 18 41.22H16A0.7 0.7 0 0 1 15.3 40.52V38.12A0.7 0.7 0 0 1 16 37.42ZM16 47.88H18A0.7 0.7 0 0 1 18.7 48.58V50.98A0.7 0.7 0 0 1 18 51.68H16A0.7 0.7 0 0 1 15.3 50.98V48.58A0.7 0.7 0 0 1 16 47.88ZM16 58.35H18A0.7 0.7 0 0 1 18.7 59.05V61.45A0.7 0.7 0 0 1 18 62.15H16A0.7 0.7 0 0 1 15.3 61.45V59.05A0.7 0.7 0 0 1 16 58.35ZM16 68.82H18A0.7 0.7 0 0 1 18.7 69.52V71.92A0.7 0.7 0 0 1 18 72.62H16A0.7 0.7 0 0 1 15.3 71.92V69.52A0.7 0.7 0 0 1 16 68.82ZM16 79.28H18A0.7 0.7 0 0 1 18.7 79.98V82.38A0.7 0.7 0 0 1 18 83.08H16A0.7 0.7 0 0 1 15.3 82.38V79.98A0.7 0.7 0 0 1 16 79.28Z';
const BRACKET_RIGHT =
  'M309.64 23.75L336.64 23.75L336.64 96.75L309.64 96.75L309.64 89.75L329.64 89.75L329.64 30.75L309.64 30.75ZM332.14 37.42H334.14A0.7 0.7 0 0 1 334.84 38.12V40.52A0.7 0.7 0 0 1 334.14 41.22H332.14A0.7 0.7 0 0 1 331.44 40.52V38.12A0.7 0.7 0 0 1 332.14 37.42ZM332.14 47.88H334.14A0.7 0.7 0 0 1 334.84 48.58V50.98A0.7 0.7 0 0 1 334.14 51.68H332.14A0.7 0.7 0 0 1 331.44 50.98V48.58A0.7 0.7 0 0 1 332.14 47.88ZM332.14 58.35H334.14A0.7 0.7 0 0 1 334.84 59.05V61.45A0.7 0.7 0 0 1 334.14 62.15H332.14A0.7 0.7 0 0 1 331.44 61.45V59.05A0.7 0.7 0 0 1 332.14 58.35ZM332.14 68.82H334.14A0.7 0.7 0 0 1 334.84 69.52V71.92A0.7 0.7 0 0 1 334.14 72.62H332.14A0.7 0.7 0 0 1 331.44 71.92V69.52A0.7 0.7 0 0 1 332.14 68.82ZM332.14 79.28H334.14A0.7 0.7 0 0 1 334.84 79.98V82.38A0.7 0.7 0 0 1 334.14 83.08H332.14A0.7 0.7 0 0 1 331.44 82.38V79.98A0.7 0.7 0 0 1 332.14 79.28Z';
const DOT = 'M233.58 13.25L251.58 13.25L251.58 31.25L233.58 31.25Z';

// Une lettre par <svg> (même viewBox) : chaque racine s'anime seule, en composition.
// i : rang d'entrée, dx : décalage du resserrement, a : amplitude de l'ondulation,
// rd : départ de l'ondulation, ox : origine horizontale (ligne de base à 82,95 %).
const LETTERS: readonly { d: string; i: number; dx: number; a?: number; rd?: string; ox: string; isI?: boolean }[] = [
  {
    d: 'M53.98 91.25V27.23H77.62L85.78 52.15Q86.47 54.43 87.35 58.19Q88.23 61.95 89.13 66.24Q89.91 69.94 90.59 73.42Q91.24 69.98 92.01 66.24Q92.87 61.95 93.75 58.21Q94.63 54.47 95.32 52.15L103.36 27.23H127.03V91.25H111.78V63.66Q111.78 61.52 111.86 58.14Q111.95 54.77 112.06 50.82Q112.16 46.86 112.29 42.82Q112.34 41.23 112.34 39.73Q111.95 41.45 111.52 43.25Q110.49 47.34 109.48 51.2Q108.47 55.07 107.54 58.29Q106.62 61.52 105.98 63.66L96.87 91.25H84.19L74.95 63.66Q74.31 61.56 73.36 58.34Q72.42 55.11 71.39 51.25Q70.36 47.38 69.32 43.3Q68.98 41.88 68.64 40.5Q68.64 41.62 68.68 42.74Q68.77 46.73 68.87 50.73Q68.98 54.73 69.09 58.1Q69.2 61.47 69.2 63.66V91.25Z',
    i: 0, dx: -2, a: 0.015, rd: '1.16s', ox: '25.85%',
  },
  {
    d: 'M156.26 92.15Q148.74 92.15 143.32 89.04Q137.91 85.92 135.01 80.36Q132.11 74.79 132.11 67.4Q132.11 59.97 135.01 54.4Q137.91 48.84 143.32 45.72Q148.74 42.61 156.26 42.61Q163.78 42.61 169.19 45.72Q174.61 48.84 177.48 54.4Q180.36 59.97 180.36 67.4Q180.36 74.79 177.48 80.36Q174.61 85.92 169.19 89.04Q163.78 92.15 156.26 92.15ZM156.26 80.68Q159.14 80.68 161.11 79Q163.09 77.33 164.1 74.32Q165.11 71.31 165.11 67.32Q165.11 63.32 164.1 60.33Q163.09 57.35 161.11 55.71Q159.14 54.08 156.26 54.08Q153.38 54.08 151.4 55.71Q149.43 57.35 148.42 60.33Q147.41 63.32 147.41 67.32Q147.41 71.31 148.42 74.32Q149.43 77.33 151.4 79Q153.38 80.68 156.26 80.68Z',
    i: 1, dx: -1, a: 0.02, rd: '1.12s', ox: '44.62%',
  },
  {
    d: 'M197.34 91.25 179.94 43.21H195.75L202.93 66.71Q204.39 71.44 205.46 76.38Q205.85 78.19 206.24 80.08Q206.67 78.19 207.05 76.38Q208.09 71.48 209.5 66.71L216.55 43.21H232.19L214.7 91.25Z',
    i: 2, dx: 0, a: 0.03, rd: '1.08s', ox: '58.85%',
  },
  { d: 'M235.08 91.25V43.21H250.07V91.25Z', i: 3, dx: 1, ox: '69.28%', isI: true },
  {
    d: 'M253.48 91.25 268.39 66.59 254.38 43.21H270.28L273.97 50.09Q275.95 53.82 277.58 57.65Q277.93 58.51 278.31 59.37Q278.66 58.55 279.04 57.69Q280.72 53.82 282.78 50.09L286.65 43.21H302.29L287.89 66.67L302.93 91.25H287.12L282.48 82.91Q280.42 79.18 278.7 75.27Q278.31 74.45 277.97 73.63Q277.62 74.45 277.28 75.27Q275.61 79.18 273.63 82.91L269.07 91.25Z',
    i: 4, dx: 2, a: 0.03, rd: '1.08s', ox: '79.46%',
  },
];

const VIEWBOX = '0 0 350.14 110';
// Filets de sécurité si animationend n'arrive jamais (animations coupées par le navigateur) :
// le premier court depuis le montage, le second repart au premier animationstart, car la
// chronologie CSS peut démarrer plusieurs secondes après le montage sur une page chargée.
const SAFETY_MOUNT_MS = 10000;
const SAFETY_START_MS = 4500;

const IntroAnimation: React.FC<IntroAnimationProps> = ({ onAnimationComplete }) => {
  const { t } = useTranslation();
  const { skipIntro } = useIntro();
  const { trigger: haptic } = useWebHaptics();
  const doneRef = useRef(false);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    document.body.style.overflow = '';
    onAnimationComplete();
  }, [onAnimationComplete]);

  const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  const vibe = useCallback((pattern: number[], strength: 'medium' | 'heavy') => {
    if (canVibrate) navigator.vibrate(pattern);
    else haptic(strength as never);
  }, [canVibrate, haptic]);

  // Verrouillage du scroll pendant l'intro
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const armSafety = useCallback((ms: number) => {
    if (safetyRef.current) clearTimeout(safetyRef.current);
    safetyRef.current = setTimeout(finish, ms);
  }, [finish]);

  useEffect(() => {
    armSafety(SAFETY_MOUNT_MS);
    return () => { if (safetyRef.current) clearTimeout(safetyRef.current); };
  }, [armSafety]);

  const onAnimationStart = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (!startedRef.current) {
      startedRef.current = true;
      armSafety(SAFETY_START_MS);
    }
    // mx-kick (coup de caméra) et mx-wave (onde) n'existent qu'une fois chacun.
    if (e.animationName === 'mx-kick') vibe([40], 'medium');
    else if (e.animationName === 'mx-wave') vibe([90, 40, 130], 'heavy');
  };

  const onAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'mx-vl' || e.animationName === 'mx-out') finish();
  };

  return createPortal(
    <div
      className="mvi fixed inset-0 z-[2147483647] overflow-hidden"
      style={{ height: '100dvh', touchAction: 'none', WebkitTapHighlightColor: 'transparent' }}
      onAnimationStart={onAnimationStart}
      onAnimationEnd={onAnimationEnd}
    >
      <style>{INTRO_CSS}</style>

      {/* Rideau : fond noir, panneaux collés aux crochets, bandes haut/bas. Le site est dessous. */}
      <div className="curtain" aria-hidden="true">
        <i className="flash" />
        <i className="veil" />
        <i className="vl" />
        <i className="vr" />
        <i className="lbt" />
        <i className="lbb" />
      </div>

      <div className="cam" role="img" aria-label="Movix">
        <i className="bloom" />
        <div className="logo">
          <i className="rg" />
          <div className="word">
            {LETTERS.map(({ d, i, dx, a, rd, ox, isI }) => (
              <svg
                key={i}
                className={isI ? 'l li' : 'l'}
                style={{ '--i': i, '--d': dx, '--a': a, '--rd': rd, '--ox': ox } as React.CSSProperties}
                viewBox={VIEWBOX}
                aria-hidden="true"
              >
                <path fill="#F4F4F0" d={d} />
              </svg>
            ))}
          </div>
          <div className="dot">
            <svg className="dt" viewBox={VIEWBOX} aria-hidden="true">
              <path fill="#DC2626" d={DOT} />
            </svg>
          </div>
          <i className="beam" />
          {/* Trous des crochets (evenodd) : on voit le fond à travers. */}
          <div className="bl">
            <svg viewBox={VIEWBOX} aria-hidden="true">
              <path fill="#DC2626" fillRule="evenodd" d={BRACKET_LEFT} />
            </svg>
          </div>
          <div className="br">
            <svg viewBox={VIEWBOX} aria-hidden="true">
              <path fill="#DC2626" fillRule="evenodd" d={BRACKET_RIGHT} />
            </svg>
          </div>
        </div>
      </div>

      {/* Passer */}
      <button
        onClick={() => { haptic('selection'); skipIntro(); }}
        className="absolute top-5 right-5 sm:top-6 sm:right-6 text-white/20 hover:text-white/60 text-[10px] sm:text-xs
                  px-3 py-1.5 sm:px-4 sm:py-2 transition-all duration-300 hover:bg-white/5 rounded
                  border border-white/[0.06] hover:border-white/15 z-[100000] font-mono tracking-widest uppercase"
      >
        {t('introAnimation.skip')}
      </button>
    </div>,
    document.body,
  );
};

/* ============================================================
   CSS. Les courbes à l'intérieur des @keyframes sont écrites en
   dur : Chrome ignore var() dans animation-timing-function d'une
   image clé. Le rideau est calé par calcul sur les crochets
   (--k, --win, --run) : changer la taille du logo ou la durée du
   travelling oblige à recalculer ces constantes.
   ============================================================ */
const INTRO_CSS = `
.mvi{--W:min(96cqmin,84cqw);--k:29.1667%;--win:calc(var(--W) * .149783);--run:calc(52cqw + var(--W) * .12);--eo:cubic-bezier(.23,1,.32,1);--eio:cubic-bezier(.77,0,.175,1);--cur:cubic-bezier(.65,0,.35,1);container-type:size;isolation:isolate}
.mvi *{box-sizing:border-box}
.mvi .curtain,.mvi .cam,.mvi .flash,.mvi .veil{position:absolute;inset:0}
.mvi .flash{background:radial-gradient(50% 70% at 50% 52%,#fff,rgba(244,244,240,.7) 45%,rgba(244,244,240,.25));opacity:0;animation:mx-flash .7s var(--eo) 2.42s}
.mvi .veil,.mvi .vl,.mvi .vr,.mvi .lbt,.mvi .lbb{position:absolute;background:#000}
.mvi .veil{animation:mx-base 1ms linear 2.42s both}
.mvi .vl,.mvi .vr{top:0;bottom:0;width:62%;animation:mx-vl .78s linear 2.42s both}
.mvi .vl{left:-12%}
.mvi .vr{right:-12%;animation-name:mx-vr}
.mvi .lbt,.mvi .lbb{left:0;right:0;animation:mx-lbt .62s var(--cur) 2.58s both}
.mvi .lbt{top:0;height:calc(50% - var(--W) * .069257)}
.mvi .lbb{bottom:0;height:calc(50% - var(--W) * .099245);animation-name:mx-lbb}
.mvi .cam{animation:mx-kick .4s var(--eo) .6s,mx-shake .4s linear 1.04s}
.mvi .bloom{position:absolute;left:50%;top:50%;width:calc(var(--W) * 1.5);height:calc(var(--W) * .7);margin:calc(var(--W) * -.35) 0 0 calc(var(--W) * -.75);background:radial-gradient(closest-side,rgba(220,38,38,.36),rgba(220,38,38,.1) 55%,rgba(220,38,38,0));opacity:0;animation:mx-bloom 1.7s linear .6s}
.mvi .logo{position:absolute;width:var(--W);height:calc(var(--W) * .314163);left:calc(50% - var(--W) / 2);top:calc(50% - var(--W) * .157081);animation:mx-push 1.85s linear both}
.mvi .logo>*{position:absolute}
.mvi .logo>div,.mvi .logo svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.mvi .word{clip-path:inset(-60% 0 15.8% 0);animation:mx-crush .32s var(--eio) 2.1s forwards,mx-wout .176s var(--eo) 2.1s forwards}
.mvi .l{transform-origin:var(--ox) 82.95%;animation:mx-rise .5s var(--eo) calc(.04s + var(--i) * .04s) both,mx-trk .815s linear .04s both,mx-rip .42s var(--eo) var(--rd)}
.mvi .li{animation:mx-rise .5s var(--eo) calc(.04s + var(--i) * .04s) both,mx-trk .815s linear .04s both,mx-isq .42s var(--eo) 1.04s}
.mvi .dot{animation:mx-fall .56s linear .82s both,mx-crush .32s var(--eio) 2.1s forwards,mx-wout .176s var(--eo) 2.1s forwards}
.mvi .dt{transform-origin:69.28% 28.41%;animation:mx-dsq .56s linear .82s both}
.mvi .bl,.mvi .br{animation:mx-inl .4s linear .38s both,mx-sm .4s linear .38s both,mx-cll .32s var(--eio) 2.1s forwards,mx-opl .62s var(--cur) 2.58s forwards}
.mvi .bl{transform-origin:11.567% 54.77%}
.mvi .br{transform-origin:88.433% 54.77%;animation-name:mx-inr,mx-sm,mx-clr,mx-opr}
.mvi .rg{left:69.28%;top:39.28%;width:16%;aspect-ratio:1;margin:-8% 0 0 -8%;border:.4cqmin solid #DC2626;opacity:0;animation:mx-wave .6s var(--eo) 1.04s}
.mvi .beam{left:49.55%;top:27.955%;width:.9%;height:53.636%;background:linear-gradient(90deg,rgba(244,244,240,0),#F4F4F0 30% 70%,rgba(244,244,240,0));opacity:0;animation:mx-beam .5s linear 2.22s}
@keyframes mx-push{from{scale:.955}to{scale:1}}
@keyframes mx-rise{0%{translate:0 62%;opacity:0}40%{opacity:1}100%{translate:0 0;opacity:1}}
@keyframes mx-trk{0%{transform:translateX(calc(var(--d) * 4.57%))}68.712%{transform:translateX(calc(var(--d) * 1.14%));animation-timing-function:cubic-bezier(.23,1,.32,1)}77.914%{transform:translateX(calc(var(--d) * -.37%));animation-timing-function:cubic-bezier(.77,0,.175,1)}100%{transform:translateX(0)}}
@keyframes mx-rip{0%,100%{scale:1}25%{scale:calc(1 + var(--a) * .4) calc(1 - var(--a))}60%{scale:1 calc(1 + var(--a) * .3)}}
@keyframes mx-isq{0%,100%{scale:1}11.67%{scale:1.06 .88}35%{scale:.98 1.04}65%{scale:1.01 .99}}
@keyframes mx-crush{from{scale:1}to{scale:.4 1}}
@keyframes mx-wout{to{opacity:0}}
@keyframes mx-fall{0%{transform:translateY(-60cqh);animation-timing-function:cubic-bezier(.55,0,1,.45)}39.29%{transform:translateY(10.873%);animation-timing-function:cubic-bezier(.23,1,.32,1)}48%{transform:translateY(16%);animation-timing-function:cubic-bezier(.23,1,.32,1)}66%{transform:translateY(-3%);animation-timing-function:cubic-bezier(.77,0,.175,1)}100%{transform:translateY(0)}}
@keyframes mx-dsq{0%,37.5%{scale:.94 1.2}39.29%{scale:1.15 .82;animation-timing-function:cubic-bezier(.23,1,.32,1)}52%{scale:.97 1.05;animation-timing-function:cubic-bezier(.23,1,.32,1)}74%{scale:1.01 .99}100%{scale:1}}
@keyframes mx-inl{0%{translate:calc(-50cqw - 20%)}55%{translate:0;animation-timing-function:cubic-bezier(.23,1,.32,1)}72%{translate:.7%;animation-timing-function:cubic-bezier(.77,0,.175,1)}100%{translate:0}}
@keyframes mx-inr{0%{translate:calc(50cqw + 20%)}55%{translate:0;animation-timing-function:cubic-bezier(.23,1,.32,1)}72%{translate:-.7%;animation-timing-function:cubic-bezier(.77,0,.175,1)}100%{translate:0}}
@keyframes mx-sm{0%,52%{scale:1.5 1}55%{scale:.8 1.03;animation-timing-function:cubic-bezier(.23,1,.32,1)}72%{scale:1.04 .99;animation-timing-function:cubic-bezier(.77,0,.175,1)}100%{scale:1}}
@keyframes mx-cll{from{translate:0}to{translate:var(--k)}}
@keyframes mx-clr{from{translate:0}to{translate:calc(var(--k) * -1)}}
@keyframes mx-opl{from{translate:var(--k)}to{translate:calc(var(--k) - var(--run))}}
@keyframes mx-opr{from{translate:calc(var(--k) * -1)}to{translate:calc(var(--run) - var(--k))}}
@keyframes mx-kick{0%,100%{scale:1}10%{scale:.988}40%{scale:1.004}}
@keyframes mx-shake{0%,100%{translate:0 0}12%{translate:.2cqmin 1.1cqmin}30%{translate:-.15cqmin -.7cqmin}50%{translate:.1cqmin .38cqmin}72%{translate:0 -.14cqmin}}
@keyframes mx-bloom{0%{opacity:0}2.35%{opacity:.5}17.65%,24.71%{opacity:.22}27.65%{opacity:.62}52.94%{opacity:.4}88.24%{opacity:.36}100%{opacity:0}}
@keyframes mx-wave{0%{scale:.5;opacity:0}8%{opacity:.95}100%{scale:2.6;opacity:0}}
@keyframes mx-beam{0%{opacity:0;scale:1 .3;animation-timing-function:cubic-bezier(.23,1,.32,1)}40%{opacity:1;scale:1 1;animation-timing-function:cubic-bezier(.23,1,.32,1)}68%,100%{opacity:0;scale:33 1}}
@keyframes mx-base{from{opacity:1}to{opacity:0}}
@keyframes mx-vl{0%{transform:translateX(0);animation-timing-function:cubic-bezier(.23,1,.32,1)}17.949%,20.513%{transform:translateX(calc(var(--win) * -1));animation-timing-function:cubic-bezier(.65,0,.35,1)}100%{transform:translateX(calc(var(--win) * -1 - var(--run)))}}
@keyframes mx-vr{0%{transform:translateX(0);animation-timing-function:cubic-bezier(.23,1,.32,1)}17.949%,20.513%{transform:translateX(var(--win));animation-timing-function:cubic-bezier(.65,0,.35,1)}100%{transform:translateX(calc(var(--win) + var(--run)))}}
@keyframes mx-lbt{to{transform:translateY(-101%)}}
@keyframes mx-lbb{to{transform:translateY(101%)}}
@keyframes mx-flash{from{opacity:.95}to{opacity:0}}
@keyframes mx-fade{0%{opacity:0}22.73%,81.82%{opacity:1}100%{opacity:0}}
@keyframes mx-out{from{opacity:1}to{opacity:0}}
/* Mouvement réduit : IntroContext ne monte pas l'intro dans ce cas ; cette
   branche reste un filet (deux fondus : logo, puis rideau). Les !important plus
   précis l'emportent sur la règle globale d'index.css qui ramène toutes les
   durées à 0,01 ms. */
@media (prefers-reduced-motion:reduce){
.mvi *{animation:none!important}
.mvi .logo{animation:mx-fade 2.2s linear both!important}
.mvi .curtain{animation:mx-out .6s var(--eo) 2.25s both!important}
}
`;

export default IntroAnimation;
