import { Euro, Globe, Info, Puzzle, Scale, Shield, Smartphone, type LucideIcon, type LucideProps } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useLightMode } from '@/context/LightModeContext';
import telegramLogo from 'bootstrap-icons/icons/telegram.svg';
import githubLogo from 'bootstrap-icons/icons/github.svg';
import reactLogo from '@/assets/technology-logos/react.svg';
import typescriptLogo from '@/assets/technology-logos/typescript.svg';
import tailwindLogo from '@/assets/technology-logos/tailwindcss.svg';
import viteLogo from '@/assets/technology-logos/vite.svg';
import motionLogo from '@/assets/technology-logos/motion.svg';
import nodeLogo from '@/assets/technology-logos/nodedotjs.svg';
import expressLogo from '@/assets/technology-logos/express.svg';
import pythonLogo from '@/assets/technology-logos/python.svg';
import mysqlLogo from '@/assets/technology-logos/mysql.svg';
import redisLogo from '@/assets/technology-logos/redis.svg';
import socketLogo from '@/assets/technology-logos/socketdotio.svg';
import rustLogo from '@/assets/technology-logos/rust.svg';
import webassemblyLogo from '@/assets/technology-logos/webassembly.svg';
import { MovixWordmark } from './brand/MovixWordmark';
import './Footer.css';

// Développé avec ❤️ par @mysticsaba, projet commencé à 14 ans.
const createFooterMaskIcon = (logo: string) => ({ className, size = 20 }: LucideProps) => (
  <span
    className={`footer-mask-icon ${className ?? ''}`}
    aria-hidden="true"
    style={{ width: size, height: size, backgroundColor: 'currentColor', maskImage: `url("${logo}")`, WebkitMaskImage: `url("${logo}")` }}
  />
);

const TelegramIcon = createFooterMaskIcon(telegramLogo);
const GithubIcon = createFooterMaskIcon(githubLogo);

type FooterLink = {
  label: string;
  icon: LucideIcon | typeof TelegramIcon;
} & ({ to: string; href?: never } | { href: string; to?: never });

const linkGroups: { title: string; links: FooterLink[] }[] = [
  {
    title: 'footer.movix',
    links: [
      { label: 'footer.about', to: '/about', icon: Info },
      { label: 'footer.application', to: '/app', icon: Smartphone },
      { label: 'nav.extension', to: '/extension', icon: Puzzle },
    ],
  },
  {
    title: 'footer.community',
    links: [
      { label: 'footer.telegram', href: 'https://t.me/ix_annonces', icon: TelegramIcon },
      { label: 'footer.sourceCode', href: 'https://github.com/movixstream/MovixOpenSource', icon: GithubIcon },
      { label: 'costs.navLabel', to: '/frais', icon: Euro },
    ],
  },
  {
    title: 'footer.information',
    links: [
      { label: 'nav.privacy', to: '/privacy', icon: Shield },
      { label: 'auth.termsOfService', to: '/terms-of-service', icon: Scale },
      { label: 'footer.ourUrls', href: 'https://movix.online', icon: Globe },
    ],
  },
];

const technologies = [
  { name: 'React', href: 'https://react.dev/', logo: reactLogo },
  { name: 'TypeScript', href: 'https://www.typescriptlang.org/', logo: typescriptLogo },
  { name: 'Tailwind CSS', href: 'https://tailwindcss.com/', logo: tailwindLogo, wide: true },
  { name: 'Vite', href: 'https://vite.dev/', logo: viteLogo },
  { name: 'Framer Motion', href: 'https://motion.dev/docs/react', logo: motionLogo, wide: true },
  { name: 'Node.js', href: 'https://nodejs.org/', logo: nodeLogo },
  { name: 'Express', href: 'https://expressjs.com/', logo: expressLogo },
  { name: 'Python', href: 'https://www.python.org/', logo: pythonLogo },
  { name: 'MySQL', href: 'https://www.mysql.com/', logo: mysqlLogo },
  { name: 'Redis', href: 'https://redis.io/', logo: redisLogo },
  { name: 'Socket.IO', href: 'https://socket.io/', logo: socketLogo },
  { name: 'Rust', href: 'https://www.rust-lang.org/', logo: rustLogo },
  { name: 'WebAssembly', href: 'https://webassembly.org/', logo: webassemblyLogo },
];

const linkClassName = 'inline-flex min-h-11 items-center gap-2.5 rounded-sm py-2 text-sm text-gray-400 transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400 motion-reduce:transition-none';

const Footer = () => {
  const { t } = useTranslation();
  const { effectivePrefs } = useLightMode();

  return (
    <footer className="relative z-10 border-t border-gray-800 bg-black py-8 text-gray-300 sm:py-10">
      <div className="mx-auto max-w-6xl px-6 text-left sm:px-10 lg:px-12">
        <nav aria-label={t('footer.navigation')} className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 sm:gap-x-10">
          {linkGroups.map((group, index) => (
            <div key={group.title} className={`min-w-0 ${index === 2 ? 'col-span-2 sm:col-span-1' : ''}`}>
              <h2 className="mb-2 text-base font-semibold text-white">
                {/* La colonne Movix porte le logo long, à la hauteur d'une ligne de titre. */}
                {group.title === 'footer.movix' ? <MovixWordmark className="block h-6 w-auto" /> : t(group.title)}
              </h2>
              <ul>
                {group.links.map(({ label, icon: Icon, to, href }) => (
                  <li key={label}>
                    {to !== undefined ? (
                      <Link to={to} className={`footer-navigation-link ${linkClassName}`}>
                        <Icon size={20} absoluteStrokeWidth className="footer-navigation-icon shrink-0" aria-hidden="true" />
                        <span>{t(label)}</span>
                      </Link>
                    ) : (
                      <a href={href} target="_blank" rel="noopener noreferrer" className={`footer-navigation-link ${linkClassName}`}>
                        <Icon size={20} absoluteStrokeWidth className="footer-navigation-icon shrink-0" aria-hidden="true" />
                        <span>{t(label)}</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section aria-labelledby="footer-technologies" className="mt-7 border-t border-gray-800 pt-6">
          <h2 id="footer-technologies" className="text-sm font-semibold text-gray-300">{t('footer.builtWith')}</h2>
          <ul className="mt-2 flex flex-wrap gap-x-5">
            {technologies.map(({ name, href, logo, wide }) => (
              <li key={name}>
                <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
                  <img
                    src={logo}
                    alt=""
                    width={wide ? 32 : 24}
                    height={24}
                    className="footer-technology-logo"
                    data-wide={wide || undefined}
                    aria-hidden="true"
                    decoding="async"
                  />
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="footer-content" className="mt-6 max-w-prose">
          <h2 id="footer-content" className="mb-2 text-sm font-semibold text-gray-300">{t('footer.contentTitle')}</h2>
          <p className="text-sm leading-relaxed text-gray-400">{t('footer.contentText')}</p>
        </section>

        <div className="mt-7 border-t border-gray-800 pt-6 text-sm leading-relaxed text-gray-400">
          <p>{t('footer.copyright', { year: new Date().getFullYear() })}</p>
          <p className="mt-2">
            <Trans
              t={t}
              i18nKey="footer.credits"
              components={{
                author: (
                  <a
                    href="https://mysticsaba.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-sm text-indigo-400 underline-offset-4 hover:text-indigo-300 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400"
                  />
                ),
              }}
            />
          </p>
          <p className="mt-2 font-semibold">
            <span className="footer-vibe-text" data-animated={effectivePrefs.bgAnimations}>
              ✨ {t('footer.vibeCoded')} ✨
            </span>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
