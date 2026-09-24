import React from "react";
import { Zap, Palette, Code2, Flame, Waves, Scale, Shield, Smartphone, Github, Euro } from "lucide-react";
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import "./Footer.css";
import { useTranslation } from 'react-i18next';

const Footer: React.FC = () => {
  const { t } = useTranslation();
  return (
  <>
    {/* Barre de délimitation */}
    <div className="relative z-10 w-full h-px bg-gradient-to-r from-transparent via-gray-600 to-transparent"></div>

    <footer className="relative z-10 bg-black text-gray-300 py-8 mt-0">
      <div className="container mx-auto px-6 max-w-6xl">
        {/* Section principale */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-8">

          {/* Disclaimer légal */}
          <div className="lg:col-span-2">
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.legalDisclaimer')}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">
              {t('footer.disclaimerText')}
            </p>
            <a
              href="https://github.com/movixstream/MovixOpenSource"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-sm text-gray-50 font-medium opacity-75 transition-all hover:opacity-100"
            >
              <Github className="size-5" />
              {t('nav.github')}
            </a>
          </div>

          {/* Boutons d'action */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.information')}</h3>
            <div className="space-y-6">
              <a
                href="https://movix.online"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all hover:opacity-100"
              >
                <span className="size-5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="1.25em" height="1.25em" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3a9 9 0 1 0 9 9A9.01 9.01 0 0 0 12 3Zm0 2a7 7 0 0 1 6.32 4H14a1 1 0 0 0 0 2h4.95a7.06 7.06 0 0 1 0 2H14a1 1 0 0 0 0 2h4.32A7 7 0 1 1 12 5Z" />
                  </svg>
                </span>
                {t('footer.ourUrls')}
              </a>
              <a
                href="https://t.me/movix_site"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all hover:opacity-100"
              >
                <span className="size-5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="1.25em" height="1.25em" fill="currentColor" viewBox="0 0 16 16">
                    <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M8.287 5.906q-1.168.486-4.666 2.01-.567.225-.595.442c-.03.243.275.339.69.47l.175.055c.408.133.958.288 1.243.294q.39.01.868-.32 3.269-2.206 3.374-2.23c.05-.012.12-.026.166.016s.042.12.037.141c-.03.129-1.227 1.241-1.846 1.817-.193.18-.33.307-.358.336a8 8 0 0 1-.188.186c-.38.366-.664.64.015 1.088.327.216.589.393.85.571.284.194.568.387.936.629q.14.092.27.187c.331.236.63.448.997.414.214-.02.435-.22.547-.82.265-1.417.786-4.486.906-5.751a1.4 1.4 0 0 0-.013-.315.34.34 0 0 0-.114-.217.53.53 0 0 0-.31-.093c-.3.005-.763.166-2.984 1.09" />
                  </svg>
                </span>
                Telegram
              </a>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/about"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 16v-4"></path>
                  <path d="M12 8h.01"></path>
                </svg>
                {t('nav.whatIsMovix')}
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/privacy"
              >
                <Shield className="size-5" />
                {t('nav.privacy')}
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/terms-of-service"
              >
                <Scale className="size-5" />
                {t('auth.termsOfService')}
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/extension"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5">
                  <path d="M20 7h-9"></path>
                  <path d="M14 17H5"></path>
                  <circle cx="17" cy="17" r="3"></circle>
                  <circle cx="7" cy="7" r="3"></circle>
                </svg>
                {t('nav.extension')}
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/app"
              >
                <Smartphone className="size-5" />
                Application
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/dmca"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-gavel size-5 fill-white">
                  <path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"></path>
                  <path d="m16 16 6-6"></path>
                  <path d="m8 8 6-6"></path>
                  <path d="m9 7 8 8"></path>
                  <path d="m21 11-8-8"></path>
                </svg>
                DMCA
              </Link>

              <Link
                className="flex flex-row items-center gap-3 text-gray-50 font-medium opacity-75 transition-all mt-4 hover:opacity-100"
                to="/frais"
              >
                <Euro className="size-5" />
                {t('costs.navLabel')}
              </Link>
            </div>
          </div>

          {/* Technologies utilisées */}
          <div>
            <h3 className="text-white text-lg font-semibold mb-4">{t('footer.builtWith')}</h3>
            <div className="space-y-2 text-sm">
              <a
                href="https://react.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="2" />
                  <path d="M12 1a11 11 0 0 0 0 22 11 11 0 0 0 0-22zm0 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" transform="rotate(60 12 12)" />
                  <ellipse cx="12" cy="12" rx="11" ry="4" fill="none" stroke="currentColor" strokeWidth="1" transform="rotate(120 12 12)" />
                </svg>
                <span>React 18</span>
              </a>
              <a
                href="https://www.typescriptlang.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Code2 className="w-5 h-5 text-blue-500" />
                <span>TypeScript</span>
              </a>
              <a
                href="https://tailwindcss.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Palette className="w-5 h-5 text-cyan-400" />
                <span>Tailwind CSS</span>
              </a>
              <a
                href="https://vitejs.dev/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Zap className="w-5 h-5 text-yellow-400" />
                <span>Vite</span>
              </a>
              <a
                href="https://www.framer.com/motion/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Waves className="w-5 h-5 text-purple-400" />
                <span>Framer Motion</span>
              </a>
              <a
                href="https://www.mysql.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Flame className="w-5 h-5 text-orange-400" />
                <span>MySQL</span>
              </a>
              <a
                href="https://expressjs.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Zap className="w-5 h-5 text-green-400" />
                <span>Express</span>
              </a>
              <a
                href="https://www.python.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-yellow-300" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969c0 6.18 3.403 5.96 3.403 5.96h2.03v-2.867s-.109-3.42 3.35-3.42h5.766s3.24.052 3.24-3.148V3.202S18.28 0 11.914 0zM8.708 1.85a1.06 1.06 0 1 1 0 2.12 1.06 1.06 0 0 1 0-2.12z" />
                  <path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826h8.123S24 18.211 24 12.031c0-6.18-3.403-5.96-3.403-5.96h-2.03v2.867s.109 3.42-3.35 3.42H9.451s-3.24-.052-3.24 3.148v5.292S5.72 24 12.086 24zm3.206-1.85a1.06 1.06 0 1 1 0-2.12 1.06 1.06 0 0 1 0 2.12z" />
                </svg>
                <span>Python</span>
              </a>
              <a
                href="https://www.rust-lang.org/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <Code2 className="w-5 h-5 text-orange-300" />
                <span>Rust</span>
              </a>
              <a
                href="https://redis.io/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 opacity-75 hover:opacity-100 transition-opacity duration-200"
              >
                <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10.5 2.661l.54.997-1.797.644 2.409.166.54.997-1.797.644 2.409.166.002.009L24 10.064 12 14.994 0 10.064l5.572-2.287 2.409.166.54.997-1.797.644 2.409.166.54.997zm1.5 13.833L24 12.164v3.5L12 19.994 0 15.664v-3.5l12 4.33zm0 5.5L24 17.664v3.5L12 25.494 0 21.164v-3.5l12 4.33z" />
                </svg>
                <span>Redis</span>
              </a>
            </div>
          </div>
        </div>

        {/* Ligne de séparation */}
        <div className="border-t border-gray-800 pt-6">
          <div className="text-center text-sm text-gray-500">
            <p>© {new Date().getFullYear()} Movix. {t('footer.allRightsReserved')}</p>
            <p className="mt-1">
              {t('footer.madeWith')} ❤️ {t('footer.by')}{" "}
              <a
                href="https://mysticsaba.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 hover:text-indigo-300 transition-colors duration-200"
              >
                @mysticsaba
              </a>
              {" - " + t('footer.startedAt14')}
            </p>
            <p className="mt-2">
              <span className="shiny-text">✨ {t('footer.vibeCoded')} ✨</span>
            </p>
          </div>
        </div>
      </div>
    </footer>
  </>
  );
};

export default Footer;
