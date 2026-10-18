// Couleurs thémables : Tailwind les lit dans des variables CSS, posées sur
// :root avec les valeurs Tailwind d'origine (plugin en bas de fichier). Sans
// thème, le rendu ne change donc pas. Le thème Halloween
// (src/styles/halloween.css) redéfinit ces variables.
// Pas de valeur de repli dans var() : Tailwind ne saurait plus lire la
// couleur et passerait la fin des dégradés en blanc transparent.
const THEMABLE_COLORS = {
  black: "0 0 0",
  "gray-700": "55 65 81",
  "gray-800": "31 41 55",
  "gray-900": "17 24 39",
  "gray-950": "3 7 18",
  "red-50": "254 242 242",
  "red-100": "254 226 226",
  "red-200": "254 202 202",
  "red-300": "252 165 165",
  "red-400": "248 113 113",
  "red-500": "239 68 68",
  "red-600": "220 38 38",
  "red-700": "185 28 28",
  "red-800": "153 27 27",
  "red-900": "127 29 29",
  "red-950": "69 10 10",
};
const themable = (name) => `rgb(var(--movix-${name}) / <alpha-value>)`;
const shades = (family, steps) => Object.fromEntries(steps.map((step) => [step, themable(`${family}-${step}`)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./BOTINDEXSECURITY.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        black: themable("black"),
        gray: shades("gray", [700, 800, 900, 950]),
        red: shades("red", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
      },
      animation: {
        fadeIn: "fadeIn 0.5s ease-in-out",
        fadeOut: "fadeOut 0.5s ease-in-out",
        "skeleton-fade": "skeletonFade 0.3s ease-out",
        "card-enter": "cardEnter 0.3s ease-out both",
        "ad-content-enter": "adContentEnter 250ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "ad-easter-egg-enter": "adEasterEggEnter 250ms cubic-bezier(0.23, 1, 0.32, 1) both",
        "ad-unlocked-glow": "adUnlockedGlow 650ms cubic-bezier(0.23, 1, 0.32, 1) both",
      },
      keyframes: {
        adContentEnter: {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        adEasterEggEnter: {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        adUnlockedGlow: {
          "0%": { opacity: "0" },
          "20%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(-20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeOut: {
          "0%": { opacity: "1", transform: "translateY(0)" },
          "100%": { opacity: "0", transform: "translateY(-20px)" },
        },
        skeletonFade: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        cardEnter: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Valeurs par défaut des couleurs thémables, émises avec `@tailwind base`.
    ({ addBase }) => addBase({
      ":root": Object.fromEntries(Object.entries(THEMABLE_COLORS).map(([name, rgb]) => [`--movix-${name}`, rgb])),
    }),
  ],
};
