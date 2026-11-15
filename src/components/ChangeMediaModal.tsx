import React, { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Film, Tv, Star, Calendar, Loader2, ArrowRight, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import ReusableModal from './ui/reusable-modal';
import { getTmdbLanguage } from '../i18n';

const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';

interface SearchResult {
  id: number;
  title?: string;
  name?: string;
  media_type: 'movie' | 'tv';
  poster_path: string | null;
  backdrop_path?: string | null;
  vote_average: number;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  number_of_seasons?: number;
}

interface Season {
  season_number: number;
  name: string;
  episode_count: number;
}

interface Episode {
  episode_number: number;
  name: string;
  still_path: string | null;
  overview?: string;
}

interface ChangeMediaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (media: {
    title: string;
    poster: string;
    mediaType: 'movie' | 'tv';
    mediaId: string;
    seasonNumber?: number;
    episodeNumber?: number;
  }) => void;
}

const ChangeMediaModal: React.FC<ChangeMediaModalProps> = ({ isOpen, onClose, onSelect }) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedShow, setSelectedShow] = useState<SearchResult | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [loadingSeasons, setLoadingSeasons] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);
  const [step, setStep] = useState<'search' | 'season' | 'episode'>('search');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchTMDB = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await axios.get('https://api.themoviedb.org/3/search/multi', {
        params: { api_key: TMDB_API_KEY, language: getTmdbLanguage(), query: q, page: 1 }
      });
      setResults(
        res.data.results
          .filter((r: any) => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path)
          .slice(0, 12)
      );
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchTMDB(val), 400);
  };

  const selectMovie = (item: SearchResult) => {
    onSelect({
      title: item.title || item.name || '',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : '',
      mediaType: 'movie',
      mediaId: String(item.id),
    });
    resetAndClose();
  };

  const selectShow = async (item: SearchResult) => {
    setSelectedShow(item);
    setStep('season');
    setLoadingSeasons(true);
    try {
      const res = await axios.get(`https://api.themoviedb.org/3/tv/${item.id}`, {
        params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
      });
      setSeasons(
        (res.data.seasons || []).filter((s: Season) => s.season_number > 0 && s.episode_count > 0)
      );
    } catch { setSeasons([]); }
    finally { setLoadingSeasons(false); }
  };

  const selectSeason = async (seasonNum: number) => {
    if (!selectedShow) return;
    setSelectedSeason(seasonNum);
    setStep('episode');
    setLoadingEpisodes(true);
    try {
      const res = await axios.get(`https://api.themoviedb.org/3/tv/${selectedShow.id}/season/${seasonNum}`, {
        params: { api_key: TMDB_API_KEY, language: getTmdbLanguage() }
      });
      setEpisodes(res.data.episodes || []);
    } catch { setEpisodes([]); }
    finally { setLoadingEpisodes(false); }
  };

  const selectEpisode = (ep: Episode) => {
    if (!selectedShow || selectedSeason === null) return;
    onSelect({
      title: `${selectedShow.name} - S${String(selectedSeason).padStart(2, '0')}E${String(ep.episode_number).padStart(2, '0')}`,
      poster: selectedShow.poster_path ? `https://image.tmdb.org/t/p/w500${selectedShow.poster_path}` : '',
      mediaType: 'tv',
      mediaId: String(selectedShow.id),
      seasonNumber: selectedSeason,
      episodeNumber: ep.episode_number,
    });
    resetAndClose();
  };

  const goBack = () => {
    if (step === 'episode') { setStep('season'); setEpisodes([]); }
    else if (step === 'season') { setStep('search'); setSelectedShow(null); setSeasons([]); }
  };

  const resetAndClose = () => {
    setQuery('');
    setResults([]);
    setSelectedShow(null);
    setSeasons([]);
    setEpisodes([]);
    setSelectedSeason(null);
    setStep('search');
    onClose();
  };

  return (
    <ReusableModal isOpen={isOpen} onClose={resetAndClose} title={t('watchParty.changeMedia')} className="max-w-2xl">
      <div className="space-y-4">
        {/* Step indicator */}
        {step !== 'search' && (
          <div className="flex items-center gap-2 text-xs text-white/40">
            <button onClick={() => { setStep('search'); setSelectedShow(null); }} className="hover:text-white transition-colors">
              {t('watchParty.search')}
            </button>
            {step === 'season' && selectedShow && (
              <>
                <ArrowRight className="w-3 h-3 text-white opacity-40" />
                <span className="text-white/70">{selectedShow.name}</span>
              </>
            )}
            {step === 'episode' && selectedShow && (
              <>
                <ArrowRight className="w-3 h-3 text-white opacity-40" />
                <button onClick={goBack} className="hover:text-white transition-colors">{selectedShow.name}</button>
                <ArrowRight className="w-3 h-3 text-white opacity-40" />
                <span className="text-white/70">{t('watchParty.season')} {selectedSeason}</span>
              </>
            )}
          </div>
        )}

        {/* Search step */}
        {step === 'search' && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white opacity-30" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder={t('watchParty.searchPlaceholder')}
                className="w-full pl-10 pr-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:border-red-500/50 transition-colors"
                autoFocus
              />
              {query && (
                <button onClick={() => { setQuery(''); setResults([]); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white group/icon">
                  <X className="w-4 h-4 text-white opacity-30 group-hover/icon:opacity-100" />
                </button>
              )}
            </div>

            {loading && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
              <AnimatePresence>
                {results.map((item, i) => (
                  <motion.button
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => item.media_type === 'movie' ? selectMovie(item) : selectShow(item)}
                    className="group relative rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-red-500/40 transition-all text-left"
                  >
                    <img
                      src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                      alt={item.title || item.name}
                      className="w-full aspect-[2/3] object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="absolute bottom-0 left-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <p className="text-xs font-semibold text-white line-clamp-2">{item.title || item.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex items-center gap-0.5">
                          <Star className="w-3 h-3 text-yellow-400" fill="currentColor" />
                          <span className="text-[10px] text-white/70">{item.vote_average?.toFixed(1)}</span>
                        </div>
                        <span className="text-[10px] text-white/50">
                          {item.media_type === 'movie' ? <Film className="w-3 h-3 inline text-white opacity-50" /> : <Tv className="w-3 h-3 inline text-white opacity-50" />}
                        </span>
                      </div>
                    </div>
                    {/* Type badge */}
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] font-bold uppercase text-white/70">
                      {item.media_type === 'movie' ? 'Film' : 'Série'}
                    </span>
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>

            {!loading && query && results.length === 0 && (
              <p className="text-center text-white/30 text-sm py-8">{t('watchParty.noSearchResults')}</p>
            )}
          </>
        )}

        {/* Season selection step */}
        {step === 'season' && (
          <>
            {loadingSeasons ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {seasons.map((s, i) => (
                  <motion.button
                    key={s.season_number}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => selectSeason(s.season_number)}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-red-500/40 hover:bg-white/10 transition-all text-left"
                  >
                    <p className="text-sm font-semibold text-white">{s.name}</p>
                    <p className="text-xs text-white/40 mt-1">{s.episode_count} {t('watchParty.episodes')}</p>
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Episode selection step */}
        {step === 'episode' && (
          <>
            {loadingEpisodes ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-red-500 animate-spin" />
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[400px] overflow-y-auto custom-scrollbar">
                {episodes.map((ep, i) => (
                  <motion.button
                    key={ep.episode_number}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => selectEpisode(ep)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-red-500/40 hover:bg-white/10 transition-all text-left group"
                  >
                    {ep.still_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w185${ep.still_path}`}
                        alt={ep.name}
                        className="w-20 h-12 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-20 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Film className="w-4 h-4 text-white opacity-20" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white group-hover:text-red-400 transition-colors">
                        <span className="text-white/40 mr-1">E{String(ep.episode_number).padStart(2, '0')}</span>
                        {ep.name}
                      </p>
                      {ep.overview && (
                        <p className="text-xs text-white/30 line-clamp-1 mt-0.5">{ep.overview}</p>
                      )}
                    </div>
                    <ArrowRight className="w-4 h-4 text-white opacity-20 group-hover:text-red-400 group-hover:opacity-100 transition-[color,opacity] flex-shrink-0" />
                  </motion.button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </ReusableModal>
  );
};

export default ChangeMediaModal;
