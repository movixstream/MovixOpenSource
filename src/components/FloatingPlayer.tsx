import React, { useEffect, useRef, useState } from 'react';
import { X, Maximize2, Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMiniPlayer } from '../context/MiniPlayerContext';
import type Hls from 'hls.js';
import { safePlay } from '../utils/safePlay';
import { isLowLatencyEnabled } from '../utils/lowLatencyPref';
import { loadHlsModule } from '../utils/loadHlsModule';

type HlsCtor = typeof Hls;
let HlsLib: HlsCtor | null = null;
const loadHls = async (): Promise<HlsCtor> => {
  if (HlsLib) return HlsLib;
  const mod = await loadHlsModule();
  HlsLib = mod.default;
  return HlsLib;
};

const FloatingPlayer: React.FC = () => {
  const {
    isMinimized,
    videoSrc,
    videoTitle,
    videoType,
    videoId,
    seasonNumber,
    episodeNumber,
    currentTime,
    duration: contextDuration,
    isPlaying: contextIsPlaying,
    volume: contextVolume,
    poster,
    disableMiniPlayer,
    updateCurrentTime,
    updateDuration,
    updatePlayingState,
    updateVolume,
    returnToPlayer
  } = useMiniPlayer();

  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Video state - initialize from context if available
  const [isPlaying, setIsPlaying] = useState(contextIsPlaying);
  const [volume, setVolume] = useState(() => {
    if (contextVolume > 0) return contextVolume;
    const savedVolume = localStorage.getItem('miniPlayerVolume');
    return savedVolume ? parseFloat(savedVolume) : 1;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(contextDuration);
  const [playbackTime, setPlaybackTime] = useState(currentTime);
  const [hlsLoadError, setHlsLoadError] = useState<Error | null>(null);

  // Position state for drag and drop
  const [position, setPosition] = useState(() => {
    const savedPosition = localStorage.getItem('miniPlayerPosition');
    return savedPosition ? JSON.parse(savedPosition) : { bottom: 20, right: 20 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });

  // Save position to localStorage
  useEffect(() => {
    localStorage.setItem('miniPlayerPosition', JSON.stringify(position));
  }, [position]);

  // Save volume to localStorage
  useEffect(() => {
    localStorage.setItem('miniPlayerVolume', volume.toString());
  }, [volume]);

  // Initialize video player
  useEffect(() => {
    if (!isMinimized || !videoSrc || !videoRef.current) return;

    const video = videoRef.current;

    // Set volume
    video.volume = volume;

    // Set current time if available
    if (currentTime > 0) {
      video.currentTime = currentTime;
    }

    // Check if source is HLS
    const isHLS = videoSrc.includes('.m3u8') || videoSrc.includes('m3u8');

    let cancelled = false;

    if (isHLS) {
      void (async () => {
        const Hls = await loadHls();
        if (cancelled) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: isLowLatencyEnabled('movies'), // mini-lecteur = même scope que films/séries
            backBufferLength: 90,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });

          hls.loadSource(videoSrc);
          hls.attachMedia(video);
          hlsRef.current = hls;

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            safePlay(video).catch(e => console.error('Autoplay failed:', e));
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Native HLS support (Safari)
          video.src = videoSrc;
          safePlay(video).catch(e => console.error('Autoplay failed:', e));
        }
      })().catch((error: unknown) => {
        if (!cancelled) {
          setHlsLoadError(error instanceof Error ? error : new Error(String(error)));
        }
      });
    } else {
      // Direct MP4 or other formats
      video.src = videoSrc;
      safePlay(video).catch(e => console.error('Autoplay failed:', e));
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isMinimized, videoSrc, currentTime, volume]);

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      setPlaybackTime(video.currentTime);
      updateCurrentTime(video.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(video.duration);
      updateDuration(video.duration);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      updatePlayingState(true);
    };

    const handlePause = () => {
      setIsPlaying(false);
      updatePlayingState(false);
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [updateCurrentTime, updateDuration, updatePlayingState]);

  // Close mini player when returning to watch page
  useEffect(() => {
    if (location.pathname.startsWith('/watch/')) {
      // If we're on a watch page, check if it matches our current video
      const isCurrentVideo =
        (videoType === 'movie' && location.pathname === `/watch/movie/${videoId}`) ||
        (videoType === 'tv' && location.pathname === `/watch/tv/${videoId}/s/${seasonNumber}/e/${episodeNumber}`);

      if (isCurrentVideo) {
        disableMiniPlayer();
      }
    }
  }, [location.pathname, videoType, videoId, seasonNumber, episodeNumber, disableMiniPlayer]);

  // Handle drag start
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;

    // Don't start drag if clicking on buttons
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;

    e.preventDefault();
    setIsDragging(true);

    const rect = containerRef.current.getBoundingClientRect();
    dragStartPos.current = {
      x: e.clientX - (window.innerWidth - rect.right),
      y: e.clientY - (window.innerHeight - rect.bottom),
    };
  };

  // Handle drag move and release
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newRight = window.innerWidth - e.clientX - dragStartPos.current.x;
      const newBottom = window.innerHeight - e.clientY - dragStartPos.current.y;

      // Constrain to window bounds
      const playerWidth = 380;
      const playerHeight = 280;
      const maxRight = window.innerWidth - playerWidth;
      const maxBottom = window.innerHeight - playerHeight;

      setPosition({
        right: Math.max(10, Math.min(newRight, maxRight)),
        bottom: Math.max(10, Math.min(newBottom, maxBottom)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Handle maximize (return to full player)
  const handleMaximize = () => {
    if (videoType === 'movie') {
      navigate(`/watch/movie/${videoId}`);
    } else if (videoType === 'tv') {
      navigate(`/watch/tv/${videoId}/s/${seasonNumber}/e/${episodeNumber}`);
    }
    returnToPlayer();
  };

  // Video controls
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      video.muted = false;
      setIsMuted(false);
    } else {
      video.muted = true;
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = parseFloat(e.target.value);
    video.volume = newVolume;
    setVolume(newVolume);
    updateVolume(newVolume);

    if (newVolume > 0 && isMuted) {
      video.muted = false;
      setIsMuted(false);
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = parseFloat(e.target.value);
    video.currentTime = newTime;
    setPlaybackTime(newTime);
    updateCurrentTime(newTime);
  };

  // Format time helper
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isMinimized || !videoSrc) return null;
  if (hlsLoadError) throw hlsLoadError;

  return (
    <div
      ref={containerRef}
      className="fixed shadow-2xl rounded-lg overflow-hidden bg-black border border-gray-800"
      style={{
        right: `${position.right}px`,
        bottom: `${position.bottom}px`,
        width: '380px',
        zIndex: 9999,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Video container */}
      <div className="relative bg-black group">
        <video
          ref={videoRef}
          className="w-full h-full"
          playsInline
          style={{ aspectRatio: '16/9', pointerEvents: 'none' }}
        />

        {/* Overlay controls - shown on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {/* Top buttons */}
          <div className="absolute top-0 left-0 right-0 p-3 flex items-start justify-between">
            <button
              onClick={handleMaximize}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-white hover:bg-white/20 rounded p-1.5 transition-colors"
              title={t('watch.enlarge')}
            >
              <Maximize2 size={20} />
            </button>
            <button
              onClick={disableMiniPlayer}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-white hover:bg-white/20 rounded p-1.5 transition-colors"
              title={t('common.close')}
            >
              <X size={20} />
            </button>
          </div>

          {/* Center play/pause button */}
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              onClick={togglePlay}
              onMouseDown={(e) => e.stopPropagation()}
              className="text-white hover:bg-white/20 rounded-full p-3 transition-all transform hover:scale-110"
            >
              {isPlaying ? <Pause size={32} fill="white" /> : <Play size={32} fill="white" />}
            </button>
          </div>

          {/* Bottom controls */}
          <div className="absolute bottom-0 left-0 right-0 p-3 space-y-2">
            {/* Progress bar */}
            <div className="w-full">
              <input
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={playbackTime}
                onChange={handleProgressChange}
                onMouseDown={(e) => e.stopPropagation()}
                className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-600 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-red-600 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer hover:[&::-webkit-slider-thumb]:bg-red-500 hover:[&::-moz-range-thumb]:bg-red-500"
                style={{
                  background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${(playbackTime / (duration || 1)) * 100}%, #4b5563 ${(playbackTime / (duration || 1)) * 100}%, #4b5563 100%)`
                }}
              />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3">
              {/* Play/Pause */}
              <button
                onClick={togglePlay}
                onMouseDown={(e) => e.stopPropagation()}
                className="text-white hover:bg-white/20 rounded p-1 transition-colors"
              >
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>

              {/* Volume */}
              <div className="flex items-center gap-2 group/volume">
                <button
                  onClick={toggleMute}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="text-white hover:bg-white/20 rounded p-1 transition-colors"
                >
                  {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={volume}
                  onChange={handleVolumeChange}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="w-0 group-hover/volume:w-16 transition-all duration-200 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-0"
                />
              </div>

              {/* Time display */}
              <div className="flex-1 text-white text-xs font-medium">
                {formatTime(playbackTime)} / {formatTime(duration)}
              </div>
            </div>
          </div>
        </div>

        {/* Title bar - always visible */}
        <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-black/60 to-transparent p-3 pt-12">
          <p className="text-white text-sm font-medium truncate drop-shadow-lg">{videoTitle}</p>
        </div>
      </div>
    </div>
  );
};

export default FloatingPlayer;
