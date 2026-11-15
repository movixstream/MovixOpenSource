import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import axios from 'axios';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { encodeId } from '../utils/idEncoder';
import { ArrowLeft, Shuffle, ClipboardList, Sparkles, RefreshCw, ArrowRight, Star, Users, Calendar, Film, Tv, ChevronLeft, ChevronRight } from 'lucide-react';
import { getTmdbLanguage } from '../i18n';
import { SquareBackground } from '../components/ui/square-background';
import BlurText from '../components/ui/blur-text';
import ShinyText from '../components/ui/shiny-text';
import AnimatedBorderCard from '../components/ui/animated-border-card';
import { Button } from '../components/ui/button';

// Questions for the questionnaire mode - labels are i18n keys
const questions = [
  {
    id: 'mood',
    textKey: 'suggestionPage.q.mood',
    options: [
      { value: 'happy', labelKey: 'suggestionPage.q.moodHappy', genres: [35, 12, 16] },
      { value: 'sad', labelKey: 'suggestionPage.q.moodSad', genres: [18, 10749] },
      { value: 'relaxed', labelKey: 'suggestionPage.q.moodRelaxed', genres: [35, 10751, 99] },
      { value: 'excited', labelKey: 'suggestionPage.q.moodExcited', genres: [28, 12, 53] },
    ],
  },
  {
    id: 'company',
    textKey: 'suggestionPage.q.company',
    options: [
      { value: 'alone', labelKey: 'suggestionPage.q.companyAlone', genres: [53, 9648, 27, 878] },
      { value: 'partner', labelKey: 'suggestionPage.q.companyPartner', genres: [10749, 35, 18] },
      { value: 'friends', labelKey: 'suggestionPage.q.companyFriends', genres: [35, 28, 12, 27] },
      { value: 'family', labelKey: 'suggestionPage.q.companyFamily', genres: [10751, 16, 12, 14] },
    ],
  },
  {
    id: 'genres',
    textKey: 'suggestionPage.q.genres',
    multiSelect: true,
    options: [
      { value: 'action', labelKey: 'suggestionPage.q.genreAction', genres: [28] },
      { value: 'adventure', labelKey: 'suggestionPage.q.genreAdventure', genres: [12] },
      { value: 'animation', labelKey: 'suggestionPage.q.genreAnimation', genres: [16] },
      { value: 'comedy', labelKey: 'suggestionPage.q.genreComedy', genres: [35] },
      { value: 'crime', labelKey: 'suggestionPage.q.genreCrime', genres: [80] },
      { value: 'documentary', labelKey: 'suggestionPage.q.genreDocumentary', genres: [99] },
      { value: 'drama', labelKey: 'suggestionPage.q.genreDrama', genres: [18] },
      { value: 'family', labelKey: 'suggestionPage.q.genreFamily', genres: [10751] },
      { value: 'fantasy', labelKey: 'suggestionPage.q.genreFantasy', genres: [14] },
      { value: 'history', labelKey: 'suggestionPage.q.genreHistory', genres: [36] },
      { value: 'horror', labelKey: 'suggestionPage.q.genreHorror', genres: [27] },
      { value: 'music', labelKey: 'suggestionPage.q.genreMusic', genres: [10402] },
      { value: 'mystery', labelKey: 'suggestionPage.q.genreMystery', genres: [9648] },
      { value: 'romance', labelKey: 'suggestionPage.q.genreRomance', genres: [10749] },
      { value: 'scifi', labelKey: 'suggestionPage.q.genreScifi', genres: [878] },
      { value: 'thriller', labelKey: 'suggestionPage.q.genreThriller', genres: [53] },
      { value: 'war', labelKey: 'suggestionPage.q.genreWar', genres: [10752] },
      { value: 'western', labelKey: 'suggestionPage.q.genreWestern', genres: [37] },
    ],
  },
  {
    id: 'duration',
    textKey: 'suggestionPage.q.duration',
    options: [
      { value: 'any', labelKey: 'suggestionPage.q.durationAny', preference: 'any' },
      { value: 'short', labelKey: 'suggestionPage.q.durationShort', preference: 'short' },
      { value: 'medium', labelKey: 'suggestionPage.q.durationMedium', preference: 'medium' },
      { value: 'long', labelKey: 'suggestionPage.q.durationLong', preference: 'long' },
      { value: 'series', labelKey: 'suggestionPage.q.durationSeries', preference: 'series' },
    ],
  },
  {
    id: 'era',
    textKey: 'suggestionPage.q.era',
    options: [
      { value: 'recent', labelKey: 'suggestionPage.q.eraRecent', yearRange: { min: 2020, max: 2024 } },
      { value: 'modern', labelKey: 'suggestionPage.q.eraModern', yearRange: { min: 2010, max: 2019 } },
      { value: '2000s', labelKey: 'suggestionPage.q.era2000s', yearRange: { min: 2000, max: 2009 } },
      { value: '90s', labelKey: 'suggestionPage.q.era90s', yearRange: { min: 1990, max: 1999 } },
      { value: '80s', labelKey: 'suggestionPage.q.era80s', yearRange: { min: 1980, max: 1989 } },
      { value: 'classic', labelKey: 'suggestionPage.q.eraClassic', yearRange: { min: 1900, max: 1979 } },
      { value: 'any', labelKey: 'suggestionPage.q.eraAny', yearRange: null },
    ],
  },
  {
    id: 'intention',
    textKey: 'suggestionPage.q.intention',
    options: [
      { value: 'learn', labelKey: 'suggestionPage.q.intentionLearn', genres: [99, 36, 878] },
      { value: 'escape', labelKey: 'suggestionPage.q.intentionEscape', genres: [14, 12, 878, 10752] },
      { value: 'laugh', labelKey: 'suggestionPage.q.intentionLaugh', genres: [35, 10402] },
      { value: 'netflix', labelKey: 'suggestionPage.q.intentionChill', genres: [10749, 18, 53] },
    ],
  },
];

const SuggestionPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<'initial' | 'random' | 'questionnaire'>('initial');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  // We'll fetch genres for the UI display
  const [, setGenreCache] = useState<Record<number, string>>({});
  
  // Direction d'animation pour la navigation entre questions
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  
  // Garder une trace des suggestions déjà montrées pour éviter les doublons
  const [previousSuggestions, setPreviousSuggestions] = useState<Set<string>>(new Set());

  // API key from environment
  const API_KEY = import.meta.env.VITE_TMDB_API_KEY || '';
  
  // Masquer le footer et le header seulement
  useEffect(() => { return undefined;
    // Masquer le footer immédiatement
    
    // Supprimer le masquage du header pour le garder visible
    // const header = document.querySelector('header');
    // if (header) {
    //   header.style.display = 'none';
    // }

    // Permettre le défilement sur mobile, mais garder le style approprié
    
    // Nettoyage au démontage
  }, []);
  
  // Double sécurité avec useEffect pour s'assurer que le footer reste masqué
  useEffect(() => { return undefined;
  }, []);

  useEffect(() => {
    // Fetch genre list to have genre names for display
    const fetchGenres = async () => {
      try {
        const response = await axios.get(
          `https://api.themoviedb.org/3/genre/movie/list?api_key=${API_KEY}&language=${getTmdbLanguage()}`
        );
        const genreMap: Record<number, string> = {};
        response.data.genres.forEach((genre: { id: number; name: string }) => {
          genreMap[genre.id] = genre.name;
        });
        // Store genre cache for potential future use
        setGenreCache(genreMap);
      } catch (error) {
        console.error('Error fetching genres:', error);
      }
    };

    fetchGenres();
  }, []);

  // Vérifie si un contenu est valide selon nos critères
  const isValidContent = (content: any) => {
    // Doit avoir un overview non vide
    if (!content.overview || content.overview.trim() === '') {
      return false;
    }
    
    // Doit avoir une date de sortie
    if (!content.release_date && !content.first_air_date) {
      return false;
    }
    
    // Pas de contenu pas encore sorti
    const releaseDate = new Date(content.release_date || content.first_air_date);
    const now = new Date();
    if (releaseDate > now) {
      return false;
    }
    
    // Doit avoir une note
    if (!content.vote_average || content.vote_average === 0) {
      return false;
    }
    
    // Doit avoir un certain nombre de votes pour être pertinent
    if (!content.vote_count || content.vote_count < 20) {
      return false;
    }
    
    // Éviter les titres avec caractères non latins (pour éviter les films/séries en chinois, etc.)
    const title = content.title || content.name || '';
    // Expression régulière qui détecte si plus de 30% des caractères sont non-latins
    const nonLatinChars = title.replace(/[\u0000-\u007F\u00A0-\u00FF\u0100-\u017F\u0180-\u024F]/g, '');
    if (nonLatinChars.length > title.length * 0.3) {
      return false;
    }
    
    return true;
  };

  const fetchRandomSuggestion = async (isTV = false) => {
    setLoading(true);
    try {
      let validContentFound = false;
      let attempts = 0;
      const maxAttempts = 5;
      
      while (!validContentFound && attempts < maxAttempts) {
        attempts++;
        
        // Get a random page between 1 and 20
        const randomPage = Math.floor(Math.random() * 20) + 1;
        // Get a random media type (movie or tv)
        const mediaType = isTV ? 'tv' : 'movie';
        
        const response = await axios.get(
          `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${API_KEY}&language=${getTmdbLanguage()}&sort_by=popularity.desc&include_adult=false&vote_count.gte=50&page=${randomPage}`
        );
        
        // Filtrer les résultats pour ne garder que les contenus valides
        const validResults = response.data.results.filter(isValidContent);
        
        if (validResults.length > 0) {
          // Get a random item from filtered results
          const randomIndex = Math.floor(Math.random() * validResults.length);
          const randomItem = validResults[randomIndex];
          
          // Fetch more details about the item
          const detailsResponse = await axios.get(
            `https://api.themoviedb.org/3/${mediaType}/${randomItem.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
          );
          
          const detailedContent = detailsResponse.data;
          
          // Vérifier à nouveau avec les données détaillées
          if (isValidContent(detailedContent)) {
            // Vérifier si cette suggestion a déjà été montrée
            const suggestionId = `${mediaType}_${detailedContent.id}`;
            if (!previousSuggestions.has(suggestionId)) {
              setSuggestion({
                ...detailedContent,
                media_type: mediaType
              });
              // Ajouter cette suggestion à l'historique
              setPreviousSuggestions(prev => new Set([...prev, suggestionId]));
              validContentFound = true;
            }
          }
        }
      }
      
      // Si aucun contenu valide n'a été trouvé après plusieurs tentatives, utiliser une approche différente
      if (!validContentFound) {
        // Utiliser les films/séries les mieux notés comme solution de secours
        const mediaType = isTV ? 'tv' : 'movie';
        const fallbackResponse = await axios.get(
          `https://api.themoviedb.org/3/${mediaType}/top_rated?api_key=${API_KEY}&language=${getTmdbLanguage()}&page=1`
        );
        
        if (fallbackResponse.data.results.length > 0) {
          const randomIndex = Math.floor(Math.random() * Math.min(10, fallbackResponse.data.results.length));
          const randomItem = fallbackResponse.data.results[randomIndex];
          
          const detailsResponse = await axios.get(
            `https://api.themoviedb.org/3/${mediaType}/${randomItem.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
          );
          
          setSuggestion({
            ...detailsResponse.data,
            media_type: mediaType
          });
        }
      }
    } catch (error) {
      console.error('Error fetching random suggestion:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchBasedOnPreferences = async () => {
    setLoading(true);
    try {
      // Collect all genres from answers
      let preferredGenres: number[] = [];

      // Traiter les réponses pour collecter les genres
      Object.entries(answers).forEach(([questionId, answer]: [string, any]) => {
        if (questionId === 'genres' && Array.isArray(answer)) {
          // Pour la question des genres (sélection multiple)
          answer.forEach((genreAnswer: any) => {
            if (genreAnswer.genres) {
              preferredGenres = [...preferredGenres, ...genreAnswer.genres];
            }
          });
        } else if (answer && answer.genres) {
          // Pour les autres questions avec des genres
          preferredGenres = [...preferredGenres, ...answer.genres];
        }
      });

      // Count frequency of each genre
      const genreCounts: Record<number, number> = {};
      preferredGenres.forEach(genre => {
        genreCounts[genre] = (genreCounts[genre] || 0) + 1;
      });

      // Sort genres by frequency
      const sortedGenres = Object.entries(genreCounts)
        .sort((a, b) => b[1] - a[1])
        .map(entry => parseInt(entry[0]));

      // Get top 3 genres or all if less than 3
      const topGenres = sortedGenres.slice(0, 3);

      // Determine if user prefers movie or TV show
      const mediaType = answers.duration?.preference === 'series' ? 'tv' : 'movie';

      // Determine runtime filter for movies
      let runtimeFilter = '';
      if (mediaType === 'movie' && answers.duration?.preference && answers.duration.preference !== 'any') {
        switch (answers.duration.preference) {
          case 'short':
            runtimeFilter = '&with_runtime.lte=90';
            break;
          case 'medium':
            runtimeFilter = '&with_runtime.gte=90&with_runtime.lte=120';
            break;
          case 'long':
            runtimeFilter = '&with_runtime.gte=120';
            break;
        }
      }

      // Determine year filter based on era preference
      let yearFilter = '';
      if (answers.era?.yearRange) {
        const { min, max } = answers.era.yearRange;
        if (mediaType === 'movie') {
          yearFilter = `&primary_release_date.gte=${min}-01-01&primary_release_date.lte=${max}-12-31`;
        } else {
          yearFilter = `&first_air_date.gte=${min}-01-01&first_air_date.lte=${max}-12-31`;
        }
      }
      
      let validContentFound = false;
      let attempts = 0;
      const maxAttempts = 3;
      
      while (!validContentFound && attempts < maxAttempts) {
        attempts++;
        const page = attempts; // Essayer différentes pages à chaque tentative
        
        // Make API request with gathered preferences and qualité filters
        const response = await axios.get(
          `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${API_KEY}&language=${getTmdbLanguage()}&sort_by=popularity.desc&include_adult=false&vote_count.gte=50&with_genres=${topGenres.join(',')}&page=${page}${runtimeFilter}${yearFilter}`
        );
        
        // Filtrer les résultats pour ne garder que les contenus valides
        const validResults = response.data.results.filter(isValidContent);
        
        if (validResults.length > 0) {
          // Pick a random result from filtered results
          const randomIndex = Math.floor(Math.random() * validResults.length);
          const randomItem = validResults[randomIndex];
          
          // Fetch details
          const detailsResponse = await axios.get(
            `https://api.themoviedb.org/3/${mediaType}/${randomItem.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
          );
          
          const detailedContent = detailsResponse.data;
          
          // Vérifier à nouveau avec les données détaillées
          if (isValidContent(detailedContent)) {
            // Vérifier si cette suggestion a déjà été montrée
            const suggestionId = `${mediaType}_${detailedContent.id}`;
            if (!previousSuggestions.has(suggestionId)) {
              setSuggestion({
                ...detailedContent,
                media_type: mediaType
              });
              // Ajouter cette suggestion à l'historique
              setPreviousSuggestions(prev => new Set([...prev, suggestionId]));
              validContentFound = true;
              break;
            }
          }
        }
      }
      
      // Si aucun contenu valide n'a été trouvé, utiliser une recherche plus large
      if (!validContentFound) {
        // Essayer avec juste un genre au lieu de tous
        if (topGenres.length > 0) {
          const singleGenre = topGenres[0];
          const singleGenreResponse = await axios.get(
            `https://api.themoviedb.org/3/discover/${mediaType}?api_key=${API_KEY}&language=${getTmdbLanguage()}&sort_by=popularity.desc&include_adult=false&vote_count.gte=100&with_genres=${singleGenre}&page=1${runtimeFilter}${yearFilter}`
          );
          
          const validResults = singleGenreResponse.data.results.filter(isValidContent);
          
          if (validResults.length > 0) {
            const randomIndex = Math.floor(Math.random() * validResults.length);
            const randomItem = validResults[randomIndex];
            
            const detailsResponse = await axios.get(
              `https://api.themoviedb.org/3/${mediaType}/${randomItem.id}?api_key=${API_KEY}&language=${getTmdbLanguage()}`
            );
            
            if (isValidContent(detailsResponse.data)) {
              // Vérifier si cette suggestion a déjà été montrée
              const suggestionId = `${mediaType}_${detailsResponse.data.id}`;
              if (!previousSuggestions.has(suggestionId)) {
                setSuggestion({
                  ...detailsResponse.data,
                  media_type: mediaType
                });
                // Ajouter cette suggestion à l'historique
                setPreviousSuggestions(prev => new Set([...prev, suggestionId]));
                return;
              }
            }
          }
        }
        
        // Si toujours rien, fallback au random avec nos critères de qualité
        fetchRandomSuggestion(mediaType === 'tv');
      }
    } catch (error) {
      console.error('Error fetching suggestion based on preferences:', error);
      // Fallback to random if there was an error
      fetchRandomSuggestion();
    } finally {
      setLoading(false);
    }
  };

  const handleModeSelect = (selectedMode: 'random' | 'questionnaire') => {
    setMode(selectedMode);
    if (selectedMode === 'random') {
      fetchRandomSuggestion();
    }
  };

  const goToNextQuestion = () => {
    if (currentQuestion < questions.length - 1) {
      setDirection('forward');
      setCurrentQuestion(prev => prev + 1);
    } else {
      fetchBasedOnPreferences();
    }
  };

  const goToPreviousQuestion = () => {
    if (currentQuestion > 0) {
      setDirection('backward');
      setCurrentQuestion(prev => prev - 1);
    }
  };

  const handleAnswerSelect = (questionId: string, answer: any) => {
    const currentQuestionData = questions[currentQuestion];

    if (currentQuestionData.multiSelect) {
      // Pour les questions à sélection multiple, gérer un tableau de réponses
      setAnswers(prev => {
        const currentAnswers = prev[questionId] || [];
        const answerValue = answer.value;

        // Vérifier si la réponse est déjà sélectionnée
        const existingIndex = currentAnswers.findIndex((a: any) => a.value === answerValue);

        if (existingIndex >= 0) {
          // Retirer la réponse si elle est déjà sélectionnée
          return {
            ...prev,
            [questionId]: currentAnswers.filter((_: any, index: number) => index !== existingIndex)
          };
        } else {
          // Ajouter la nouvelle réponse
          return {
            ...prev,
            [questionId]: [...currentAnswers, answer]
          };
        }
      });
    } else {
      // Pour les questions à sélection unique
      setAnswers(prev => ({
        ...prev,
        [questionId]: answer,
      }));

      // Move to next question or get suggestion
      goToNextQuestion();
    }
  };



  const tryAgain = () => {
    // Ne pas réinitialiser l'historique des suggestions, seulement effacer la suggestion actuelle.
    // On met `loading` à true dans la même passe que `setSuggestion(null)` pour éviter que
    // l'écran du questionnaire ne réapparaisse brièvement avant le résultat suivant.
    setLoading(true);
    setSuggestion(null);
    if (mode === 'random') {
      fetchRandomSuggestion();
    } else {
      fetchBasedOnPreferences();
    }
  };
  
  const resetQuestionnaire = () => {
    // Réinitialiser aussi l'historique des suggestions
    setCurrentQuestion(0);
    setAnswers({});
    setSuggestion(null);
    setMode('initial');
    setPreviousSuggestions(new Set());
  };

  return (
    <SquareBackground squareSize={48} borderColor="rgba(168, 85, 247, 0.15)" className="min-h-screen bg-black text-white">
      <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10 h-full overflow-y-auto">
        {/* Back Button */}
        <Link to="/" className="inline-flex items-center text-white/50 hover:text-white transition-colors mb-8 group/icon">
          <ArrowLeft className="w-5 h-5 mr-2 text-white opacity-50 group-hover/icon:opacity-100 transition-[color,opacity]" />
          {t('common.backToHome')}
        </Link>

        {/* Hero Section */}
        <div className="max-w-4xl mx-auto text-center mb-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 relative"
          >
            <div className="inline-flex items-center justify-center p-3 bg-purple-500/10 rounded-full mb-4 ring-1 ring-purple-500/50">
              <Sparkles className="w-8 h-8 text-purple-500" />
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight mb-4">
              <ShinyText text={t('suggestionPage.findYourNext')} speed={3} color="#ffffff" shineColor="#a855f7" className="block" />
              <ShinyText text={t('suggestionPage.obsession')} speed={2} color="#a855f7" shineColor="#ffffff" className="block mt-2" />
            </h1>
            <BlurText
              text={t('suggestionPage.letUsGuide')}
              delay={150}
              className="text-lg text-white/60 max-w-2xl mx-auto justify-center"
            />
          </motion.div>
        </div>

        {mode === 'initial' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl mx-auto"
          >
            <AnimatedBorderCard
              highlightColor="168 85 247"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 text-center space-y-6 backdrop-blur-sm"
            >
              <BlurText
                text={t('suggestionPage.howToFind')}
                delay={100}
                className="text-xl sm:text-2xl font-semibold text-white justify-center"
              />
              
              <div className="grid gap-4 sm:grid-cols-2">
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <AnimatedBorderCard
                    highlightColor="239 68 68"
                    backgroundColor="15 15 15"
                    className="p-5 cursor-pointer h-full"
                    onClick={() => handleModeSelect('random')}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-lg bg-red-500/10">
                        <Shuffle className="w-8 h-8 text-red-500" />
                      </div>
                      <ShinyText text={t('suggestionPage.randomMode')} speed={2} color="#ef4444" shineColor="#ffffff" className="text-lg font-bold" />
                      <p className="text-sm text-white/50">{t('suggestionPage.letChanceDecide')}</p>
                    </div>
                  </AnimatedBorderCard>
                </motion.div>
                
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <AnimatedBorderCard
                    highlightColor="59 130 246"
                    backgroundColor="15 15 15"
                    className="p-5 cursor-pointer h-full"
                    onClick={() => handleModeSelect('questionnaire')}
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="p-3 rounded-lg bg-blue-500/10">
                        <ClipboardList className="w-8 h-8 text-blue-500" />
                      </div>
                      <ShinyText text={t('suggestionPage.questionnaire')} speed={2} color="#3b82f6" shineColor="#ffffff" className="text-lg font-bold" />
                      <p className="text-sm text-white/50">{t('suggestionPage.answerQuestions')}</p>
                    </div>
                  </AnimatedBorderCard>
                </motion.div>
              </div>
            </AnimatedBorderCard>
          </motion.div>
        )}

        {mode === 'questionnaire' && !suggestion && !loading && (
          <motion.div 
            key={`question-${currentQuestion}`}
            initial={{ x: direction === 'forward' ? 100 : -100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direction === 'forward' ? -100 : 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="max-w-3xl mx-auto"
          >
            <AnimatedBorderCard
              highlightColor="59 130 246"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 backdrop-blur-sm"
            >
              {/* Progress indicator */}
              <div className="flex justify-center mb-6">
                <div className="flex items-center gap-2">
                  {questions.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => {
                        if (index < currentQuestion) {
                          setDirection('backward');
                          setCurrentQuestion(index);
                        }
                      }}
                      className={`h-2 rounded-full cursor-pointer transition-all duration-300 ${
                        currentQuestion === index 
                          ? 'bg-blue-500 w-8' 
                          : index < currentQuestion 
                            ? 'bg-blue-700 w-2 hover:bg-blue-600' 
                            : 'bg-white/20 w-2'
                      }`}
                    />
                  ))}
                </div>
              </div>
              
              <BlurText
                text={t(questions[currentQuestion].textKey)}
                delay={50}
                className="text-xl sm:text-2xl font-semibold mb-6 text-white justify-center text-center"
              />
              
              <div className={`grid gap-3 ${questions[currentQuestion].multiSelect ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {questions[currentQuestion].options.map((option) => {
                  const currentQuestionData = questions[currentQuestion];
                  let isSelected = false;

                  if (currentQuestionData.multiSelect) {
                    const currentAnswers = answers[currentQuestionData.id] || [];
                    isSelected = currentAnswers.some((a: any) => a.value === option.value);
                  } else {
                    isSelected = answers[currentQuestionData.id]?.value === option.value;
                  }

                  return (
                    <motion.button
                      key={option.value}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`relative p-4 rounded-xl text-left transition-all duration-200 border ${
                        isSelected 
                          ? 'bg-blue-500/20 border-blue-500 text-white' 
                          : 'bg-white/5 border-white/10 hover:border-white/30 text-white/80 hover:text-white'
                      }`}
                      onClick={() => handleAnswerSelect(currentQuestionData.id, option)}
                    >
                      {currentQuestionData.multiSelect && isSelected && (
                        <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      <span className="text-sm sm:text-base font-medium">{t(option.labelKey)}</span>
                    </motion.button>
                  );
                })}
              </div>
              
              {/* Navigation */}
              <div className="mt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex gap-3">
                  {currentQuestion > 0 && (
                    <Button
                      variant="ghost"
                      onClick={goToPreviousQuestion}
                      className="text-white/70 hover:text-white group/icon"
                    >
                      <ChevronLeft className="h-4 w-4 mr-1 text-white opacity-70 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                      {t('common.back')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={resetQuestionnaire}
                    className="text-white/50 hover:text-white"
                  >
                    {t('suggestionPage.restart')}
                  </Button>
                </div>

                {(() => {
                  const currentQuestionData = questions[currentQuestion];
                  const hasAnswer = currentQuestionData.multiSelect
                    ? (answers[currentQuestionData.id] || []).length > 0
                    : answers[currentQuestionData.id];

                  if (hasAnswer && currentQuestion < questions.length - 1) {
                    return (
                      <Button
                        onClick={goToNextQuestion}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                      >
                        {t('common.next')}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    );
                  } else if (hasAnswer && currentQuestion === questions.length - 1) {
                    return (
                      <Button
                        onClick={goToNextQuestion}
                        className="bg-green-600 hover:bg-green-700 text-white px-6"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        {t('suggestionPage.getSuggestion')}
                      </Button>
                    );
                  }
                  return null;
                })()}
              </div>
            </AnimatedBorderCard>
          </motion.div>
        )}

        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16"
          >
            <div className="relative">
              {/* radial-gradient au lieu de blur-[60px] sur un loader qui tourne — le blur
                  réappliqué à 60fps derrière un spinner est particulièrement coûteux. */}
              <div
                className="absolute inset-0 rounded-full pointer-events-none scale-150"
                style={{ background: 'radial-gradient(circle, rgba(168, 85, 247, 0.45) 0%, transparent 70%)' }}
              />
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                className="relative w-16 h-16 border-3 border-purple-500/30 border-t-purple-500 rounded-full"
              />
            </div>
            <BlurText
              text={t('suggestionPage.searchingPerfect')}
              delay={100}
              className="mt-6 text-xl text-white/80 justify-center"
            />
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: '100%' }}
              transition={{ duration: 2, ease: 'easeInOut' }}
              className="h-1 bg-gradient-to-r from-purple-500 via-pink-500 to-purple-500 rounded-full mt-6 max-w-xs"
            />
          </motion.div>
        )}

        {suggestion && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="max-w-4xl mx-auto"
          >
            <AnimatedBorderCard
              highlightColor="168 85 247"
              backgroundColor="10 10 10"
              className="p-6 sm:p-8 backdrop-blur-sm"
            >
              <div className="flex flex-col md:flex-row gap-6 sm:gap-8">
                {/* Poster */}
                <div className="w-full md:w-1/3 flex-shrink-0">
                  <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.2 }}
                    className="relative rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10"
                  >
                    <img 
                      src={`https://image.tmdb.org/t/p/w500${suggestion.poster_path}`} 
                      alt={suggestion.title || suggestion.name}
                      className="w-full h-auto object-cover"
                    />
                    {/* Media type badge */}
                    <div className="absolute top-3 left-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/70 backdrop-blur-sm text-sm font-medium">
                        {suggestion.media_type === 'movie' ? (
                          <>
                            <Film className="w-4 h-4 text-purple-400" />
                            <span className="text-white">{t('common.film')}</span>
                          </>
                        ) : (
                          <>
                            <Tv className="w-4 h-4 text-purple-400" />
                            <span className="text-white">{t('common.tvSeries')}</span>
                          </>
                        )}
                      </span>
                    </div>
                  </motion.div>
                </div>
                
                {/* Details */}
                <div className="w-full md:w-2/3 flex flex-col">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <ShinyText 
                      text={suggestion.title || suggestion.name}
                      speed={3}
                      color="#ffffff"
                      shineColor="#a855f7"
                      className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4"
                    />
                  </motion.div>
                  
                  {/* Genres */}
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.4 }}
                    className="flex flex-wrap gap-2 mb-4"
                  >
                    {suggestion.genres?.map((genre: { id: number; name: string }) => (
                      <span key={genre.id} className="px-3 py-1 bg-white/10 rounded-full text-sm text-white/80 border border-white/10">
                        {genre.name}
                      </span>
                    ))}
                    
                    {suggestion.vote_count > 1000 && (
                      <span className="px-3 py-1 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-full text-sm font-semibold flex items-center gap-1.5 border border-yellow-500/30">
                        <Sparkles className="h-4 w-4 text-yellow-500" />
                        <span className="text-yellow-500">{t('suggestionPage.popular')}</span>
                      </span>
                    )}
                  </motion.div>
                  
                  {/* Overview */}
                  <motion.p 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="text-white/70 mb-6 text-sm sm:text-base leading-relaxed"
                  >
                    {suggestion.overview || t('suggestionPage.noSummary')}
                  </motion.p>
                  
                  {/* Stats */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.55 }}
                    className="flex flex-wrap gap-4 sm:gap-6 mb-6 text-sm"
                  >
                    {suggestion.vote_average > 0 && (
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                        <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                        <span className="font-bold text-white">{suggestion.vote_average.toFixed(1)}</span>
                        <span className="text-white/50">/ 10</span>
                      </div>
                    )}
                    
                    {suggestion.vote_count > 0 && (
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                        <Users className="h-5 w-5 text-purple-400" />
                        <span className="text-white/80">{suggestion.vote_count.toLocaleString()} votes</span>
                      </div>
                    )}
                    
                    {(suggestion.release_date || suggestion.first_air_date) && (
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                        <Calendar className="h-5 w-5 text-purple-400" />
                        <span className="text-white/80">
                          {new Date(suggestion.release_date || suggestion.first_air_date).toLocaleDateString(i18n.language, {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    )}
                  </motion.div>
                  
                  {/* Actions */}
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                    className="mt-auto flex flex-wrap gap-3"
                  >
                    <Link to={suggestion.media_type === 'movie' ? `/movie/${encodeId(suggestion.id)}` : `/tv/${encodeId(suggestion.id)}`}>
                      <Button className="bg-purple-600 hover:bg-purple-700 text-white px-6 h-11">
                        {t('suggestionPage.viewDetails')}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Button>
                    </Link>
                    
                    <Button
                      variant="ghost"
                      onClick={tryAgain}
                      className="border border-white/20 hover:border-white/40 text-white h-11 px-5"
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      {t('suggestionPage.anotherSuggestion')}
                    </Button>
                    
                    <Button
                      variant="ghost"
                      onClick={resetQuestionnaire}
                      className="text-white/60 hover:text-white h-11 group/icon"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2 text-white opacity-60 group-hover/icon:opacity-100 transition-[color,opacity] duration-200" />
                      {t('suggestionPage.restart')}
                    </Button>
                  </motion.div>
                </div>
              </div>
            </AnimatedBorderCard>
          </motion.div>
        )}
      </div>
    </SquareBackground>
  );
};

export default SuggestionPage;
