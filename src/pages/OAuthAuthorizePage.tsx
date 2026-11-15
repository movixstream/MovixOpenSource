import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Bell, BellPlus, BookmarkMinus, BookmarkPlus, ChevronDown, Crown, ExternalLink, Eye, EyeOff, FilePenLine, FolderPlus, FolderX, Heart, HeartHandshake, HeartOff, History, Library, List, ListChecks, ListMinus, ListPlus, PlayCircle, ShieldCheck, Star, StarOff, UserRound, UserRoundCog } from 'lucide-react';
import { Button } from '../components/ui/button';
import { discordAuth } from '../services/discordAuth';
import { googleAuth } from '../services/googleAuth';
import { broadcastAuthChange, clearPendingAuthAction, clearStoredAuthSession, setPendingAuthAuthorize } from '../utils/accountAuth';
import { useProfile } from '../context/ProfileContext';
import movixIcon from '@/assets/brand/movix.svg';

const API_URL = import.meta.env.VITE_MAIN_API;
const DEFAULT_AVATAR = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';
const MOVIX_LOGO_SRC = movixIcon;

interface OAuthPreviewResponse {
  success: boolean;
  client: {
    clientId: string;
    clientName: string;
    description?: string | null;
    homepageUrl?: string | null;
    logoUrl?: string | null;
    iconUrl?: string | null;
    publicClient: boolean;
    requirePkce: boolean;
    allowedScopes: string[];
    redirectOrigins: string[];
  };
  request: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    requiresPkce: boolean;
    codeChallengeMethod?: string | null;
    codeChallengeProvided: boolean;
    codeExpiresInMs: number;
    accessTokenExpiresInMs: number;
  };
}

interface OAuthPreviewApiPayload {
  success?: boolean;
  error?: string;
  error_description?: string;
  client?: OAuthPreviewResponse['client'];
  request?: OAuthPreviewResponse['request'];
}

interface StoredIdentity {
  username: string;
  avatar: string;
}

function getStoredIdentity(): StoredIdentity | null {
  const authRaw = localStorage.getItem('auth');
  if (authRaw) {
    try {
      const parsed = JSON.parse(authRaw);
      const userProfile = parsed?.userProfile;
      if (userProfile && typeof userProfile === 'object') {
        return {
          username: String(userProfile.username || userProfile.name || 'Movix'),
          avatar: String(userProfile.avatar || DEFAULT_AVATAR),
        };
      }
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  const googleRaw = localStorage.getItem('google_user');
  if (googleRaw) {
    try {
      const parsed = JSON.parse(googleRaw);
      return {
        username: String(parsed?.name || 'Movix'),
        avatar: String(parsed?.picture || DEFAULT_AVATAR),
      };
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  const discordRaw = localStorage.getItem('discord_user');
  if (discordRaw) {
    try {
      const parsed = JSON.parse(discordRaw);
      return {
        username: String(parsed?.username || 'Movix'),
        avatar: String(parsed?.avatar || DEFAULT_AVATAR),
      };
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  return null;
}

function formatTokenLifetime(ms: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    return t('oauthAuthorize.tokenLifetimeDays', { count: days });
  }

  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  return t('oauthAuthorize.tokenLifetimeHours', { count: hours });
}

// ─── Carte humoristique : ce que l'app NE demande PAS ─────────────────────
// Affichée juste après la vraie liste de permissions. Pour rappeler aux gens
// qu'ils donnent uniquement un accès limité — pas tous les droits sur leur
// vie. Les strings vivent dans les fichiers i18n via la clé
// `oauthAuthorize.fakeNotRequested` (array). Le fallback ci-dessous sert si
// le bundle de traduction n'a pas chargé.
const FAKE_NOT_REQUESTED_FALLBACK: string[] = [
  'Hacker la NASA depuis ton frigo connecté',
  'Te révéler les vrais codes de la Matrice',
  'T\'expliquer le sens de la vie (spoiler : 42)',
  'Te dire qui gagnera la Coupe du Monde 2034',
  'Te dévoiler l\'identité réelle de Satoshi Nakamoto',
  'Voler ton chat Pamplemousse à 3h du matin',
  'Repasser ton chien à la vapeur',
  'Dompter un lion adulte dans ton salon',
  'Te faire pousser des dreadlocks en 48h',
  'Te faire passer pour le Pape François',
  'Réparer le télescope Hubble par WhatsApp',
  'T\'envoyer en orbite basse sans casque',
  'Convertir ton grille-pain en mineur de bitcoin',
  'T\'apprendre l\'allemand en 12h chrono',
  'Te masser les épaules pendant ton Zoom RH',
  'Convaincre ton ex que c\'était sa faute',
  'Bloquer ta belle-mère sur Facebook ET LinkedIn',
  'Te désinscrire de tes 47 newsletters dormantes',
  'Cacher ta télécommande dans le frigo',
  'Reprogrammer ta machine à laver en mandarin',
  'Cuire ton riz pendant exactement 17 minutes',
  'Te chanter La Traviata sous la douche',
  'T\'inscrire à Tinder en ton absence',
  'Swiper à droite sur tous les profils de chats',
  'Te faire perdre 5 kg en 2 jours (pas légal)',
  'Te trouver un appart à Paris pour 400€/mois',
  'Te calculer tes impôts en pré-vision 2030',
  'Crier "ALEXAAA" dans tes oreilles à 4h du mat',
  'Te commander 200 cure-dents sur Amazon',
  'Voler les Ferrero Rocher cachés dans ton placard',
  'Te chanter une berceuse en klingon',
  'T\'expliquer pourquoi tes AirPods disparaissent',
  'Régler ton réveil à 3h33 pile chaque nuit',
  'Repeindre ton plafond en rose flashy à 4h du mat',
  'Booter Windows XP sur ton iPhone',
  'Installer Internet Explorer 6 par nostalgie',
  'Mettre à jour Adobe Flash Player une dernière fois',
  'Désinstaller McAfee qui spam depuis 2014',
  'Cracker le WiFi du voisin (« Livebox-3F2A »)',
  'Coller 12 stickers Hello Kitty sur ton frigo',
  'Te faire devenir VIP gratis (jamais. JAMAIS.)',
  'Servir un mojito à ton chat chaque vendredi',
  'Te faire les ongles en gel pendant que tu dors',
  'Couper tes cheveux à la tondeuse pour chien',
  'Choisir ton fond d\'écran à ton insu (un cactus)',
  'Envoyer un sms passif-agressif à ton ex',
  'Te faire un CV avec WordArt 1997',
  'T\'apprendre à tricoter une écharpe en mohair',
  'Te donner la météo précise sur Mars',
  'Te révéler la vérité sur le Père Noël',
  'Décliner tes invitations LinkedIn par insultes',
  'Te désinscrire de TikTok pendant ton sommeil',
  'Te filer un cours de salsa cubaine en visio',
  'Voler la TV 4K de ton voisin silencieusement',
  'Réparer ton aspirateur qui refuse de démarrer',
  'T\'organiser un dîner romantique avec ton boulanger',
  'Cirer ton parquet flottant à la main',
  'Faire ta lessive de noirs un mardi 13',
  'Te commander une pizza 4 fromages à 2h du mat',
  'T\'aider à craquer le code de Vinci',
  'T\'apprendre à siffler en avalant',
  'Te coiffer en hérisson sans gel',
  'Te répondre à ton mail RH compliqué',
  'Te trouver l\'âme sœur sur Vinted',
  'T\'expliquer la blockchain à ta grand-mère',
  'Tatouer "VIP" sur ton avant-bras pendant ta sieste',
  'T\'apprendre à parler aux chats couramment',
  'Te coder un site WordPress en COBOL',
  'Te faire passer ton permis bateau en piscine',
  'T\'envoyer Jeff Bezos en cadeau d\'anniversaire',
  'Te transformer en NFT contre ton gré',
  'T\'apprendre la danse classique pendant la sieste',
  'Te révéler tous les codes du Konami',
  'Te livrer ton café en drone à 6h pile',
  'Te faire pleurer devant un sketch des Inconnus',
  'T\'envoyer une lettre manuscrite en sumérien',
  'Te trouver un job de testeur de matelas chez IKEA',
  'T\'apprendre le solfège en braille inversé',
  'Te faire un calendrier de l\'avent thème pickles',
  'Voler ton vélo et te le rendre vendredi prochain',
  'Te tricoter un pull pour ton aspirateur',
];

const FakePermissionsTeasingCard: React.FC = () => {
  const { t } = useTranslation();
  const fakeListRaw = t('oauthAuthorize.fakeNotRequested', { returnObjects: true });
  const fakeList = Array.isArray(fakeListRaw) && fakeListRaw.length > 0
    ? (fakeListRaw as string[])
    : FAKE_NOT_REQUESTED_FALLBACK;
  const randomIdx = useMemo(
    () => Math.floor(Math.random() * fakeList.length),
    [fakeList.length],
  );
  const randomFake = fakeList[randomIdx] ?? '';
  return (
    <div>
      <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
        🚫 {t('oauthAuthorize.fakeNotRequestedTitle', 'Ce que Movix ne demande pas')}
      </p>
      <div className="mt-2 flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-red-400/70 leading-none">✗</span>
        <p className="min-w-0 flex-1 text-sm italic text-gray-300 leading-snug">{randomFake}</p>
      </div>
    </div>
  );
};

// ─── Accordéon des permissions demandées ────────────────────────────────
// Fermé par défaut (les utilisateurs voient déjà le nombre via le badge),
// ouvert au clic. Animation height + opacity via framer-motion.
interface PermissionsAccordionProps {
  requestedScopes: {
    scope: string;
    icon: typeof UserRound;
    title: string;
    description: string;
  }[];
  label: string;
}

const PermissionsAccordion: React.FC<PermissionsAccordionProps> = ({ requestedScopes, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        <div className="flex items-center gap-2">
          <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
            {label}
          </p>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.6rem] font-semibold text-gray-200">
            {requestedScopes.length}
          </span>
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="text-gray-400"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
              opacity: { duration: 0.18, ease: 'easeOut' },
            }}
            className="overflow-hidden"
          >
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {requestedScopes.map((scopeItem) => {
                const Icon = scopeItem.icon;
                return (
                  <div
                    key={scopeItem.scope}
                    className="flex min-w-0 items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-red-300" />
                    <p className="min-w-0 truncate text-sm font-medium text-white">
                      {scopeItem.title}
                    </p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const OAuthAuthorizePage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [preview, setPreview] = useState<OAuthPreviewResponse | null>(null);
  const [previewClient, setPreviewClient] = useState<OAuthPreviewResponse['client'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authToken = localStorage.getItem('auth_token');
  const accountIdentity = useMemo(() => getStoredIdentity(), []);
  const { currentProfile } = useProfile();
  const displayName = currentProfile?.name || accountIdentity?.username || 'Movix';
  const displayAvatar = currentProfile?.avatar || accountIdentity?.avatar || DEFAULT_AVATAR;
  const returnTo = `${location.pathname}${location.search}`;
  const isAlreadyConnected = Boolean(authToken);

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);
      setPreviewClient(null);

      try {
        const response = await fetch(`${API_URL}/api/oauth/authorize/preview?${searchParams.toString()}`);
        const payload = await response.json() as OAuthPreviewApiPayload;

        if (!response.ok || !payload.success) {
          if (payload.client) {
            setPreviewClient(payload.client);
          }
          throw new Error(payload.error_description || payload.error || t('oauthAuthorize.errors.invalidRequest'));
        }

        if (!cancelled) {
          setPreview(payload as OAuthPreviewResponse);
          if (payload.client) {
            setPreviewClient(payload.client);
          }
        }
      } catch (previewError) {
        if (!cancelled) {
          const message = previewError instanceof Error
            ? previewError.message
            : t('oauthAuthorize.errors.invalidRequest');
          setError(message);
          setPreview(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [searchParams, t]);

  useEffect(() => {
    if (!preview) return;
    setPendingAuthAuthorize(returnTo, preview.client.clientId);
  }, [preview, returnTo]);

  const requestedScopes = useMemo(() => {
    const scopeConfig: Record<string, { icon: typeof UserRound; titleKey: string; descKey: string }> = {
      'profile.read': { icon: UserRound, titleKey: 'oauthAuthorize.scopes.profileRead.title', descKey: 'oauthAuthorize.scopes.profileRead.description' },
      'profile.list': { icon: List, titleKey: 'oauthAuthorize.scopes.profileList.title', descKey: 'oauthAuthorize.scopes.profileList.description' },
      'profile.manage': { icon: UserRoundCog, titleKey: 'oauthAuthorize.scopes.profileManage.title', descKey: 'oauthAuthorize.scopes.profileManage.description' },
      'vip.read': { icon: ShieldCheck, titleKey: 'oauthAuthorize.scopes.vipRead.title', descKey: 'oauthAuthorize.scopes.vipRead.description' },
      'vip.manage': { icon: Crown, titleKey: 'oauthAuthorize.scopes.vipManage.title', descKey: 'oauthAuthorize.scopes.vipManage.description' },
      // Favoris
      'favorites.read':   { icon: Heart,       titleKey: 'oauthAuthorize.scopes.favoritesRead.title',   descKey: 'oauthAuthorize.scopes.favoritesRead.description' },
      'favorites.add':    { icon: HeartHandshake, titleKey: 'oauthAuthorize.scopes.favoritesAdd.title',    descKey: 'oauthAuthorize.scopes.favoritesAdd.description' },
      'favorites.remove': { icon: HeartOff,        titleKey: 'oauthAuthorize.scopes.favoritesRemove.title', descKey: 'oauthAuthorize.scopes.favoritesRemove.description' },
      // Listes personnalisées
      'lists.read':        { icon: Library,      titleKey: 'oauthAuthorize.scopes.listsRead.title',        descKey: 'oauthAuthorize.scopes.listsRead.description' },
      'lists.create':      { icon: FolderPlus,   titleKey: 'oauthAuthorize.scopes.listsCreate.title',      descKey: 'oauthAuthorize.scopes.listsCreate.description' },
      'lists.rename':      { icon: FilePenLine,  titleKey: 'oauthAuthorize.scopes.listsRename.title',      descKey: 'oauthAuthorize.scopes.listsRename.description' },
      'lists.delete':      { icon: FolderX,      titleKey: 'oauthAuthorize.scopes.listsDelete.title',      descKey: 'oauthAuthorize.scopes.listsDelete.description' },
      'lists.add-item':    { icon: ListPlus,     titleKey: 'oauthAuthorize.scopes.listsAddItem.title',     descKey: 'oauthAuthorize.scopes.listsAddItem.description' },
      'lists.remove-item': { icon: ListMinus,    titleKey: 'oauthAuthorize.scopes.listsRemoveItem.title',  descKey: 'oauthAuthorize.scopes.listsRemoveItem.description' },
      // Watchlist
      'watchlist.read':    { icon: ListChecks,    titleKey: 'oauthAuthorize.scopes.watchlistRead.title',    descKey: 'oauthAuthorize.scopes.watchlistRead.description' },
      'watchlist.add':     { icon: BookmarkPlus,  titleKey: 'oauthAuthorize.scopes.watchlistAdd.title',     descKey: 'oauthAuthorize.scopes.watchlistAdd.description' },
      'watchlist.remove':  { icon: BookmarkMinus, titleKey: 'oauthAuthorize.scopes.watchlistRemove.title',  descKey: 'oauthAuthorize.scopes.watchlistRemove.description' },
      // Historique
      'history.read':   { icon: History, titleKey: 'oauthAuthorize.scopes.historyRead.title',   descKey: 'oauthAuthorize.scopes.historyRead.description' },
      'history.add':    { icon: Eye,     titleKey: 'oauthAuthorize.scopes.historyAdd.title',    descKey: 'oauthAuthorize.scopes.historyAdd.description' },
      'history.remove': { icon: EyeOff,  titleKey: 'oauthAuthorize.scopes.historyRemove.title', descKey: 'oauthAuthorize.scopes.historyRemove.description' },
      // Continue watching
      'continue-watching.read': { icon: PlayCircle, titleKey: 'oauthAuthorize.scopes.continueWatchingRead.title', descKey: 'oauthAuthorize.scopes.continueWatchingRead.description' },
      // Alertes
      'alerts.read':   { icon: Bell,     titleKey: 'oauthAuthorize.scopes.alertsRead.title',   descKey: 'oauthAuthorize.scopes.alertsRead.description' },
      'alerts.manage': { icon: BellPlus, titleKey: 'oauthAuthorize.scopes.alertsManage.title', descKey: 'oauthAuthorize.scopes.alertsManage.description' },
      // Ratings (notes personnelles)
      'ratings.read':   { icon: Star,    titleKey: 'oauthAuthorize.scopes.ratingsRead.title',   descKey: 'oauthAuthorize.scopes.ratingsRead.description' },
      'ratings.manage': { icon: StarOff, titleKey: 'oauthAuthorize.scopes.ratingsManage.title', descKey: 'oauthAuthorize.scopes.ratingsManage.description' },
      // Note : `comments.read`, `wishboard.read`, `shared-lists.read`,
      // `live-tv.read`, `vip-invoices.read` ont été retirés car les routes
      // backend correspondantes sont soit publiques (top10, wishboard,
      // shared-lists), soit utilisent un autre scope (vip.manage pour les
      // invoices, x-access-key pour live TV). Les outils MCP marchent toujours
      // — ils n'avaient juste pas besoin de scope OAuth dédié.
    };

    return (preview?.request.scopes || []).map((scope) => {
      const config = scopeConfig[scope] || { icon: ShieldCheck, titleKey: scope, descKey: scope };
      return {
        scope,
        icon: config.icon,
        title: t(config.titleKey),
        description: t(config.descKey),
      };
    });
  }, [preview?.request.scopes, t]);

  const handleProviderLogin = (provider: 'discord' | 'google') => {
    if (provider === 'discord') {
      discordAuth.login({
        mode: 'authorize',
        returnTo,
        clientId: preview?.client.clientId,
      });
      return;
    }

    googleAuth.login({
      mode: 'authorize',
      returnTo,
      clientId: preview?.client.clientId,
    });
  };

  const handleBip39Route = (targetPath: '/login-bip39' | '/create-account') => {
    setPendingAuthAuthorize(returnTo, preview?.client.clientId);
    window.location.replace(targetPath);
  };

  const handleSwitchAccount = () => {
    clearPendingAuthAction();
    clearStoredAuthSession();
    broadcastAuthChange();
    window.location.reload();
  };

  const handleDecision = async (approve: boolean) => {
    if (!preview || !authToken) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/oauth/authorize/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          client_id: preview.request.clientId,
          redirect_uri: preview.request.redirectUri,
          scope: preview.request.scopes.join(' '),
          state: preview.request.state,
          code_challenge_method: searchParams.get('code_challenge_method'),
          code_challenge: searchParams.get('code_challenge'),
          approve,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error_description || payload.error || t('oauthAuthorize.errors.decisionFailed'));
      }

      clearPendingAuthAction();
      window.location.replace(payload.redirectTo);
    } catch (decisionError) {
      const message = decisionError instanceof Error
        ? decisionError.message
        : t('oauthAuthorize.errors.decisionFailed');
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const redirectHost = useMemo(() => {
    try {
      return preview ? new URL(preview.request.redirectUri).origin : null;
    } catch {
      return null;
    }
  }, [preview]);

  return (
    <div className="min-h-[100svh] overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),_transparent_35%),linear-gradient(180deg,_#050505,_#0b0b10_45%,_#111827)] text-white">
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="grid gap-5 lg:grid-cols-[1.5fr_1fr] lg:items-start"
        >
          <section className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-xl backdrop-blur sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <img src={MOVIX_LOGO_SRC} alt="Movix" className="h-4 w-4 object-contain" />
                <span className="text-xs font-medium text-white">Movix OAuth</span>
              </div>
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-200">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-red-300/80">
                {t('oauthAuthorize.eyebrow')}
              </p>
              <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {t('oauthAuthorize.title')}
              </h1>
              <p className="text-sm leading-relaxed text-gray-300">
                {t('oauthAuthorize.subtitle')}
              </p>
            </div>

            {isLoading ? (
              <p className="mt-6 text-sm text-gray-400">
                {t('oauthAuthorize.loading')}
              </p>
            ) : error ? (
              <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                <p className="font-medium">{t('oauthAuthorize.errorTitle')}</p>
                <p className="mt-2 text-red-100/80">{error}</p>
                {previewClient?.homepageUrl && (
                  <a
                    href={previewClient.homepageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {t('oauthAuthorize.visitSite')}
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Link to="/" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-red-200 hover:text-white">
                  {t('oauthAuthorize.backHome')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : preview ? (
              <div className="mt-6 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    {(() => {
                      const iconSrc = preview.client.iconUrl
                        ? `${API_URL}${preview.client.iconUrl}`
                        : preview.client.logoUrl || null;
                      return iconSrc ? (
                        <img src={iconSrc} alt={preview.client.clientName} className="h-full w-full object-cover" />
                      ) : (
                        <ShieldCheck className="h-5 w-5 text-red-300" />
                      );
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
                      {t('oauthAuthorize.appLabel')}
                    </p>
                    <h2 className="truncate text-lg font-semibold text-white">
                      {preview.client.clientName}
                    </h2>
                    {preview.client.description && (
                      <p className="line-clamp-2 text-xs leading-snug text-gray-400">
                        {preview.client.description}
                      </p>
                    )}
                  </div>
                  {preview.client.homepageUrl && (
                    <a
                      href={preview.client.homepageUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('oauthAuthorize.visitSite')}
                      className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white transition hover:bg-white/10 sm:inline-flex"
                    >
                      {t('oauthAuthorize.visitSite')}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>

                <div className="h-px bg-white/[0.06]" />

                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
                      {t('oauthAuthorize.redirectLabel')}
                    </dt>
                    <dd className="mt-1.5 truncate font-medium text-white">
                      {redirectHost || preview.request.redirectUri}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
                      {t('oauthAuthorize.tokenLabel')}
                    </dt>
                    <dd className="mt-1.5 font-medium text-white">
                      {formatTokenLifetime(preview.request.accessTokenExpiresInMs, t)}
                    </dd>
                  </div>
                </dl>

                <div className="h-px bg-white/[0.06]" />

                <PermissionsAccordion requestedScopes={requestedScopes} label={t('oauthAuthorize.permissionsLabel')} />

                <FakePermissionsTeasingCard />

                {authToken ? (
                  <div className="space-y-4 border-t border-white/10 pt-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <img
                        src={displayAvatar}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full border border-emerald-400/30 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-emerald-200/80">
                          {t('oauthAuthorize.signedInAs')}
                        </p>
                        <p className="truncate font-medium text-white">{displayName}</p>
                      </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        variant="outline"
                        onClick={() => handleDecision(false)}
                        disabled={isSubmitting}
                        className="border-white/15 bg-transparent sm:w-auto"
                      >
                        {t('oauthAuthorize.deny')}
                      </Button>
                      <Button
                        onClick={() => handleDecision(true)}
                        disabled={isSubmitting}
                        className="bg-red-600 hover:bg-red-700 sm:w-auto sm:min-w-[10rem]"
                      >
                        {isSubmitting ? t('oauthAuthorize.processing') : t('oauthAuthorize.approve')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                    <p className="text-sm font-medium text-amber-100">
                      {t('oauthAuthorize.loginRequiredTitle')}
                    </p>
                    <p className="mt-1.5 text-sm leading-5 text-amber-50/80">
                      {t('oauthAuthorize.loginRequiredDescription')}
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <aside className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.02] p-5 shadow-xl backdrop-blur sm:p-6">
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-gray-400">
              {isAlreadyConnected ? t('oauthAuthorize.connectedAccount') : t('oauthAuthorize.connectMovix')}
            </p>
            {isAlreadyConnected ? (
              <>
                <div className="mt-4 flex items-center gap-3">
                  <img
                    src={displayAvatar}
                    alt={displayName}
                    className="h-12 w-12 shrink-0 rounded-full border border-emerald-400/30 object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-emerald-200/80">
                      {t('oauthAuthorize.signedInAs')}
                    </p>
                    <p className="truncate text-base font-semibold text-white">{displayName}</p>
                  </div>
                </div>

                <h2 className="mt-5 text-lg font-semibold text-white">
                  {t('oauthAuthorize.notYouPrompt', { username: displayName })}
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-gray-300">
                  {t('oauthAuthorize.switchAccountDescription')}
                </p>

                <Button
                  onClick={handleSwitchAccount}
                  disabled={!preview}
                  className="mt-4 w-full justify-center bg-red-600 hover:bg-red-700"
                >
                  {t('oauthAuthorize.switchAccountCta')}
                </Button>
              </>
            ) : (
              <>
                <h2 className="mt-3 text-xl font-semibold text-white">
                  {t('oauthAuthorize.loginCardTitle')}
                </h2>
                <p className="mt-2 text-sm leading-5 text-gray-300">
                  {t('oauthAuthorize.loginCardDescription')}
                </p>

                <div className="mt-5 space-y-2.5">
                  <Button
                    onClick={() => handleProviderLogin('discord')}
                    disabled={!preview}
                    className="w-full justify-center bg-[#5865F2] py-2.5 hover:bg-[#4752C4]"
                  >
                    {t('auth.loginWithDiscord')}
                  </Button>
                  <Button
                    onClick={() => handleProviderLogin('google')}
                    disabled={!preview}
                    className="w-full justify-center bg-white py-2.5 text-gray-900 hover:bg-gray-100"
                  >
                    {t('auth.loginWithGoogle')}
                  </Button>
                  <Button
                    onClick={() => handleBip39Route('/login-bip39')}
                    disabled={!preview}
                    variant="secondary"
                    className="w-full justify-center py-2.5"
                  >
                    {t('oauthAuthorize.loginWithBip39')}
                  </Button>
                  <Button
                    onClick={() => handleBip39Route('/create-account')}
                    disabled={!preview}
                    variant="outline"
                    className="w-full justify-center border-white/15 bg-transparent py-2.5"
                  >
                    {t('oauthAuthorize.createMovixAccount')}
                  </Button>
                </div>
              </>
            )}

            <div className="mt-6 flex items-start gap-2.5 border-t border-white/10 pt-4">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300 opacity-80" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{t('oauthAuthorize.securityTitle')}</p>
                <p className="mt-1 text-xs leading-4 text-gray-400">
                  {t('oauthAuthorize.securityDescription')}
                </p>
              </div>
            </div>
          </aside>
        </motion.div>
      </div>
    </div>
  );
};

export default OAuthAuthorizePage;
