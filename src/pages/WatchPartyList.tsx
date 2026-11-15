import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RefreshCw, Users, Clock, Film, Tv, ArrowLeft,
  MonitorPlay, Loader2, Play, HelpCircle, Ticket
} from 'lucide-react';
import WatchPartyTutorialModal from '../components/WatchPartyTutorialModal';
import JoinPartyModal from '../components/JoinPartyModal';
import AnimatedBorderCard from '@/components/ui/animated-border-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SquareBackground } from '@/components/ui/square-background';
import { Trans, useTranslation } from 'react-i18next';
import { WATCHPARTY_API } from '../config/runtime';

const MAIN_API = WATCHPARTY_API;

interface PublicWatchParty {
  id: string;
  code: string;
  title: string;
  poster?: string;
  mediaType: 'movie' | 'tv';
  participantCount: number;
  maxParticipants: number;
  createdAt: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

const WatchPartyList: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [publicParties, setPublicParties] = useState<PublicWatchParty[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  const fetchPublicParties = async () => {
    try {
      setIsRefreshing(true);
      setError('');
      const response = await axios.get(`${MAIN_API}/api/watchparty/public`);

      if (response.data.success) {
        setPublicParties(response.data.rooms);
      } else {
        setError(t('watchParty.fetchError'));
      }
    } catch (err) {
      console.error('Error fetching public watch parties:', err);
      setError(t('watchParty.fetchErrorGeneric'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPublicParties();

    // Refresh every 30 seconds
    const intervalId = setInterval(fetchPublicParties, 30000);

    return () => clearInterval(intervalId);
  }, []);

  const handleJoinParty = (code: string) => {
    navigate(`/watchparty/join/${code}`);
  };

  const handleRefresh = () => {
    fetchPublicParties();
  };

  const formatCreationTime = (timestamp: number) => {
    const now = Date.now();
    const diffMs = now - timestamp;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffMins < 60) {
      return t('watchParty.timeAgoMinutes', { count: diffMins });
    } else {
      return t('watchParty.timeAgoHours', { count: diffHours });
    }
  };

  const staggerContainer = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };

  const fadeInUp = {
    hidden: {
      opacity: 0,
      y: 20
    },
    show: {
      opacity: 1,
      y: 0,
      transition: {
        type: "spring",
        stiffness: 100
      }
    }
  };

  return (
    <SquareBackground squareSize={48} borderColor="rgba(99, 102, 241, 0.10)" className="min-h-screen bg-black text-white">


      {/* Back link */}
      <div className="w-full absolute top-28 z-20">
        <div className="container px-6 md:px-10">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-white/70 transition-colors hover:text-white group/icon"
          >
            <ArrowLeft className="h-4 w-4 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity]" />
            {t('watchParty.backToHome')}
          </Link>
        </div>
      </div>

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="pt-40 relative z-10 border-b border-white/10 bg-gradient-to-b from-red-900/10 to-transparent"
      >
        <div className="container px-6 pb-8 md:px-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="flex items-center gap-3 text-3xl font-bold text-white md:text-4xl">
                <Users className="h-8 w-8 text-red-500" />
                {t('watchParty.publicParties')}
              </h1>
              <p className="mt-2 max-w-xl text-white/70">
                {t('watchParty.publicPartiesDesc')}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <AnimatedBorderCard
                onClick={() => setShowJoinModal(true)}
                highlightColor="255 255 255"
                backgroundColor="23 23 23"
                className="inline-flex items-center justify-center h-10 px-4 md:px-6 cursor-pointer hover:scale-105 active:scale-95 transition-all group"
                role="button"
                tabIndex={0}
              >
                <Ticket className="h-4 w-4 mr-2 text-white group-hover:text-red-500 transition-colors" />
                <span className="font-medium text-sm">{t('watchParty.join')}</span>
              </AnimatedBorderCard>

              <Button
                onClick={() => setShowTutorial(true)}
                variant="ghost"
                className="bg-white/5 hover:bg-white/10 text-white h-10 px-4 md:px-6"
                title={t('watchParty.howItWorks')}
              >
                <HelpCircle className="h-4 w-4 md:mr-2" />
                <span className="hidden md:inline">{t('watchParty.helpLabel')}</span>
              </Button>
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="icon"
                className={`border-white/10 bg-white/5 hover:bg-white/10 text-white ${isRefreshing ? 'animate-spin' : ''}`}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="container px-6 md:px-10 py-6 relative z-10">

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="bg-white/5 border border-white/10 rounded-xl p-6 md:p-8 mb-8 backdrop-blur-sm"
        >
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <MonitorPlay className="h-5 w-5 text-red-500" />
            {t('watchParty.howItWorksTitle')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-lg bg-white/5 border border-white/5">
              <div className="flex items-center mb-2 text-red-400">
                <Users className="h-5 w-5 mr-2" />
                <h3 className="font-semibold text-white">{t('watchParty.watchTogether')}</h3>
              </div>
              <p className="text-sm text-white/60">{t('watchParty.watchTogetherDesc')}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/5">
              <div className="flex items-center mb-2 text-red-400">
                <Clock className="h-5 w-5 mr-2" />
                <h3 className="font-semibold text-white">{t('watchParty.sync')}</h3>
              </div>
              <p className="text-sm text-white/60">{t('watchParty.syncDesc')}</p>
            </div>
            <div className="p-4 rounded-lg bg-white/5 border border-white/5">
              <div className="flex items-center mb-2 text-red-400">
                <Film className="h-5 w-5 mr-2" />
                <h3 className="font-semibold text-white">{t('watchParty.hlsPlayersOnly')}</h3>
              </div>
              <p className="text-sm text-white/60">
                {t('watchParty.hlsPlayersOnlyDesc')}
              </p>
              <p className="mt-2 text-sm text-white/60">
                <Trans
                  t={t}
                  i18nKey="watchParty.hlsPlayersCompatibilityNote"
                  components={{
                    extensionLink: <Link to="/extension" className="text-red-400 underline underline-offset-2 hover:text-red-300" />,
                    appLink: <Link to="/app" className="text-red-400 underline underline-offset-2 hover:text-red-300" />,
                  }}
                />
              </p>
            </div>
          </div>
        </motion.div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
          </div>
        ) : error ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 text-center"
          >
            <p className="text-red-400">{error}</p>
          </motion.div>
        ) : publicParties.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-white/5 rounded-lg p-12 text-center border border-white/10"
          >
            <Users className="h-12 w-12 text-white opacity-10 mx-auto mb-4" />
            <p className="text-lg font-medium">{t('watchParty.noPublicParties')}</p>
            <p className="text-sm text-white/50 mt-1">
              {t('watchParty.beFirstToLaunch')}
            </p>
          </motion.div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            <AnimatePresence>
              {publicParties.map((party) => (
                <motion.div
                  key={party.id}
                  variants={fadeInUp}
                  layout
                  className="bg-white/5 rounded-lg border border-white/10 overflow-hidden hover:border-white/20 transition-colors group"
                >
                  <div className="flex items-start gap-4 p-4">
                    {/* Poster */}
                    <div className="relative shrink-0">
                      {party.poster ? (
                        <img
                          src={party.poster.startsWith('http')
                            ? party.poster
                            : `https://image.tmdb.org/t/p/w154${party.poster}`
                          }
                          alt={party.title}
                          className="w-20 h-28 object-cover rounded-lg shadow-lg"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-20 h-28 bg-white/10 rounded-lg flex items-center justify-center">
                          {party.mediaType === 'movie' ? (
                            <Film className="h-8 w-8 text-white opacity-30" />
                          ) : (
                            <Tv className="h-8 w-8 text-white opacity-30" />
                          )}
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <Badge variant={party.mediaType} className="bg-white/10 hover:bg-white/20 text-white border-0">
                          {party.mediaType === 'movie' ? (
                            <><Film className="h-3 w-3 mr-1" /> {t('watchParty.movieLabel')}</>
                          ) : (
                            <><Tv className="h-3 w-3 mr-1" /> {t('watchParty.seriesLabel')}</>
                          )}
                        </Badge>
                        {(party.seasonNumber && party.episodeNumber) && (
                          <Badge variant="default" className="bg-transparent border border-white/20 text-white opacity-80 hover:bg-white/5">
                            S{party.seasonNumber} E{party.episodeNumber}
                          </Badge>
                        )}
                      </div>

                      <h3 className="text-lg font-semibold text-white truncate group-hover:text-red-400 transition-colors">
                        {party.title}
                      </h3>

                      <div className="flex items-center gap-3 mt-2 text-sm text-white/50">
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3 text-white opacity-50" />
                          {party.participantCount}/{party.maxParticipants}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-white opacity-50" />
                          {formatCreationTime(party.createdAt).replace('Il y a ', '')}
                        </span>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div className="text-xs text-white/30 font-mono bg-white/5 px-2 py-1 rounded">
                          {party.code}
                        </div>
                        <Button
                          onClick={() => handleJoinParty(party.code)}
                          size="sm"
                          className="bg-red-600 hover:bg-red-700 text-white border-0"
                        >
                          <Play className="h-3 w-3 mr-1.5" />
                          {t('watchParty.join')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Tutorial Modal */}
      <WatchPartyTutorialModal
        isOpen={showTutorial}
        onClose={() => setShowTutorial(false)}
      />

      {/* Join Party Modal */}
      <JoinPartyModal
        isOpen={showJoinModal}
        onClose={() => setShowJoinModal(false)}
      />
    </SquareBackground>
  );
};

export default WatchPartyList;
