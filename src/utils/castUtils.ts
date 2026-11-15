// Utility functions for Chromecast and AirPlay functionality

// AirPlay interfaces
export interface AirPlayMediaInfo {
  contentId: string;
  contentType: string;
  streamType: string;
  currentTime?: number;
  metadata?: {
    metadataType: number;
    title?: string;
    images?: Array<{
      url: string;
      height?: number;
      width?: number;
    }>;
  };
  customData?: {
    currentTime: number;
  };
}

export interface AirPlayState {
  isAvailable: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error?: string;
}

const isIOSBrowser = (): boolean => typeof navigator !== 'undefined' && (
  /iPad|iPhone|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

export const isWebCastSupported = (): boolean => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || isIOSBrowser()) return false;
  const cast = (window as Window & { chrome?: { cast?: { isAvailable?: boolean } } }).chrome?.cast;
  return !!cast || /Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);
};

export const getCastUnavailableReason = (sdkUnavailable: boolean): string => {
  if (isIOSBrowser()) return 'watch.castUnavailableIOS';
  if (!isWebCastSupported()) return 'watch.castUnavailableUnsupportedBrowser';
  const cast = (window as Window & { chrome?: { cast?: { isAvailable?: boolean } } }).chrome?.cast;
  if (!cast?.isAvailable) {
    return sdkUnavailable ? 'watch.castUnavailableSdkUnavailable' : 'watch.castSdkLoading';
  }
  return 'watch.castUnavailableNoDevices';
};

export interface RemotePlaybackState {
  type: 'chromecast' | 'airplay' | null;
  state: 'disconnected' | 'connecting' | 'connected';
  error?: string;
}

// Unified casting interface
export interface UnifiedCastAdapter {
  type: 'chromecast' | 'airplay';
  isSupported: () => boolean;
  isAvailable: () => boolean;
  isConnected: () => boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  loadMedia: (mediaInfo: CastMediaInfo | AirPlayMediaInfo) => Promise<void>;
  getState: () => RemotePlaybackState;
}

// Extend Window interface for AirPlay
declare global {
  interface Window {
    WebKitPlaybackTargetAvailabilityEvent?: any;
  }
}

// Extend HTMLVideoElement for WebKit AirPlay APIs
interface HTMLVideoElementWithAirPlay extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  webkitWirelessVideoPlaybackDisabled?: boolean;
}

export interface M3u8Stream {
  url: string;
  language?: string;
  quality?: string;
  subtitles?: any;
}

export interface Mp4Stream {
  url: string;
  language?: string;
  quality?: string;
}

export type MediaStream = M3u8Stream | Mp4Stream;

export type MediaType = 'm3u8' | 'mp4';

export interface CastMediaInfo {
  contentId: string;
  contentType: string;
  streamType: string;
  metadata?: {
    metadataType: number;
    title?: string;
    images?: Array<{
      url: string;
      height?: number;
      width?: number;
    }>;
  };
  customData?: any;
  // Populated by loadMediaOnCastWithFallback when external subtitle tracks are
  // attached. Each entry is a `chrome.cast.media.Track` instance.
  tracks?: any[];
  // Default rendering style for the receiver's text track UI.
  textTrackStyle?: any;
}

/**
 * External subtitle track to attach to a cast media load. Shape kept tiny so
 * callers don't need to import chrome.cast types — we build the SDK Track
 * objects internally inside loadMediaOnCastWithFallback.
 */
export interface CastSubtitleTrack {
  url: string;       // Direct WebVTT URL accessible from the receiver's network
  contentType?: string;
  language: string;  // BCP-47 code (e.g. 'fr', 'en', 'es')
  label: string;     // Human-readable name shown in the receiver's track menu
}

/**
 * Detect media type from URL
 */
export const detectMediaType = (url: string): MediaType | 'html' => {
  if (url.includes('.m3u8') || url.includes('m3u8')) {
    return 'm3u8';
  }
  if (url.includes('.mp4') || url.includes('mp4')) {
    return 'mp4';
  }

  // Uqload sert soit du HLS (master.m3u8) soit du MP4 (v.mp4) — le check
  // .m3u8/.mp4 ci-dessus suffit. Fallback mp4 pour URLs uqload sans extension claire.
  if (url.includes('uqload')) {
    return 'mp4';
  }

  // Check for HTML embed pages
  if (url.includes('.html') || url.includes('/embed-')) {
    return 'html';
  }

  // Default to m3u8 for unknown types
  return 'm3u8';
};

/**
 * Parse M3U8 manifest to extract streams and subtitles
 */
export const parseM3u8Manifest = async (m3u8Url: string): Promise<M3u8Stream[]> => {
  try {
    const response = await fetch(m3u8Url);
    const content = await response.text();
    const lines = content.split('\n');
    
    const streams: M3u8Stream[] = [];
    let currentStream: Partial<M3u8Stream> = {};
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        // Parse stream info
        const streamInfo = parseStreamInfo(line);
        currentStream = {
          quality: streamInfo.resolution,
          language: streamInfo.language,
          subtitles: []
        };

      } else if (line && !line.startsWith('#') && currentStream.quality) {
        // This is a stream URL
        currentStream.url = line.startsWith('http') ? line : new URL(line, m3u8Url).href;
        streams.push(currentStream as M3u8Stream);
        currentStream = {};
      }
    }
    
    return streams;
  } catch (error) {
    console.error('Error parsing M3U8 manifest:', error);
    return [];
  }
};

/**
 * Parse stream information from EXT-X-STREAM-INF line
 */
const parseStreamInfo = (line: string) => {
  const resolution = line.match(/RESOLUTION=(\d+x\d+)/)?.[1];
  const language = line.match(/LANGUAGE="([^"]+)"/)?.[1];
  
  return { resolution, language };
};



/**
 * Select the best stream based on language preference (French first)
 */
export const selectBestStream = (streams: MediaStream[]): MediaStream | null => {
  if (streams.length === 0) return null;
  
  // Priority order: French, English, then others
  const languagePriority = ['fr', 'fre', 'fra', 'en', 'eng', 'en-US', 'en-GB'];
  
  // First, try to find a French stream
  for (const priority of languagePriority) {
    const frenchStream = streams.find(stream => 
      stream.language?.toLowerCase().includes(priority.toLowerCase())
    );
    if (frenchStream) return frenchStream;
  }
  
  // If no French stream found, return the first available
  return streams[0];
};

/**
 * Prefer French audio variant for providers that encode audio track id in the variant URL (e.g., darkibox: index-v1-a1.m3u8 vs index-v1-a2.m3u8)
 * - Reads the master manifest to find the French AUDIO URI and infer the audio id (a1/a2/...)
 * - Rewrites the provided variant URL to point to the French audio id when available
 */
export const preferFrenchAudioVariant = async (
  variantUrl: string,
  masterManifestUrl: string
): Promise<string> => {
  try {
    // Only attempt for providers that follow the -aN pattern
    if (!/\-a\d+\.m3u8(\?|$)/.test(variantUrl)) {
      return variantUrl;
    }

    const response = await fetch(masterManifestUrl);
    const content = await response.text();

    // Find AUDIO French line and capture its URI to infer aN id
    // Example line: TYPE=AUDIO,...,LANGUAGE="fr",...,URI=".../index-a2.m3u8"
    const audioLines = content.split('\n').filter(l => l.includes('TYPE=AUDIO'));
    const frenchLine = audioLines.find(l => /LANGUAGE="fr"/i.test(l));
    if (!frenchLine) return variantUrl;

    const uriMatch = frenchLine.match(/URI="([^"]+)"/);
    if (!uriMatch) return variantUrl;

    const frenchUri = uriMatch[1];
    const audioIdMatch = frenchUri.match(/\-a(\d+)\.m3u8/);
    if (!audioIdMatch) return variantUrl;

    const frenchAudioId = audioIdMatch[1]; // e.g., "2"

    // Replace existing -aX.m3u8 in the variant URL with the French one
    const updated = variantUrl.replace(/\-a\d+\.m3u8/, `-a${frenchAudioId}.m3u8`);
    return updated;
  } catch (e) {
    console.warn('preferFrenchAudioVariant failed, using original variant:', e);
    return variantUrl;
  }
};

/**
 * Prepare media info for Chromecast with proper language selection
 */
export const prepareCastMediaInfo = (
  mediaUrl: string,
  title: string,
  poster?: string,
  currentTime: number = 0,
  streamType: string = 'BUFFERED'
): CastMediaInfo => {
  // Detect media type
  const mediaType = detectMediaType(mediaUrl);

  const castUrl = mediaUrl;

  // Set appropriate content type based on media type
  let contentType: string;
  if (mediaType === 'mp4') {
    contentType = 'video/mp4';
  } else if (mediaType === 'html') {
    contentType = 'text/html';
  } else {
    contentType = 'application/x-mpegURL';
  }

  const mediaInfo: CastMediaInfo = {
    contentId: castUrl,
    contentType: contentType,
    streamType,
    metadata: {
      metadataType: 1, // Movie metadata
      title: title,
      images: poster ? [{
        url: poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w500${poster}`,
        height: 480,
        width: 320
      }] : undefined
    },
    customData: {
      currentTime: currentTime,
    }
  };

  return mediaInfo;
};

/**
 * Load media on AirPlay with proper video URL handling
 */
/**
 * Prepare video element for AirPlay playback
 * 
 * IMPORTANT: For AirPlay to work with HLS streams, you must use Safari's native HLS support.
 * This means you should NOT use HLS.js when AirPlay is active.
 * Safari has built-in HLS support and AirPlay works seamlessly with it.
 * 
 * @param videoElement - The video element to configure
 * @param mediaUrl - URL of the media (can be HLS or MP4)
 * @param useNativePlayback - If true, will set src directly (for Safari native HLS)
 */
export const prepareVideoForAirPlay = (
  videoElement: HTMLVideoElement,
  mediaUrl: string,
  useNativePlayback: boolean = true
): void => {
  if (!isAirPlaySupported()) {
    console.warn('[AirPlay] Not supported on this device/browser');
    return;
  }

  const video = videoElement as HTMLVideoElementWithAirPlay;
  
  console.log('[AirPlay] Preparing video element', {
    url: mediaUrl,
    useNativePlayback
  });
  
  // Configure video element for AirPlay
  video.setAttribute('x-webkit-airplay', 'allow');
  
  if (typeof video.webkitWirelessVideoPlaybackDisabled !== 'undefined') {
    video.webkitWirelessVideoPlaybackDisabled = false;
  }
  
  if ('disableRemotePlayback' in video) {
    (video as any).disableRemotePlayback = false;
  }
  
  // If using native playback (recommended for AirPlay with HLS)
  // The caller should set video.src directly and destroy HLS.js instance
  if (useNativePlayback && mediaUrl) {
    console.log('[AirPlay] Setting up native playback for AirPlay');

    // For Safari, we can set src directly for both HLS and MP4
    // Safari has native HLS support
    video.src = mediaUrl;
  }
  
  console.log('[AirPlay] Video element prepared successfully');
};

/**
 * @deprecated Use prepareVideoForAirPlay instead
 * This function is kept for backward compatibility but should not be used
 * as it interferes with HLS.js
 */
export const loadMediaOnAirPlay = async (
  videoElement: HTMLVideoElement,
  mediaUrl: string,
  _title: string,
  _poster?: string,
  currentTime: number = 0
): Promise<void> => {
  console.warn('[AirPlay] loadMediaOnAirPlay is deprecated. Use prepareVideoForAirPlay instead.');
  
  if (!isAirPlaySupported()) {
    throw new Error('AirPlay is not supported on this device');
  }

  try {
    prepareVideoForAirPlay(videoElement, mediaUrl, true);
    
    if (currentTime > 0) {
      videoElement.currentTime = currentTime;
    }
    
    console.log('[AirPlay] Media prepared for AirPlay:', mediaUrl);
  } catch (error) {
    console.error('[AirPlay] Failed to prepare media:', error);
    throw error;
  }
};

// ============================================================================
// Unified Cast Adapter
// ============================================================================

/**
 * Create a unified adapter for both Chromecast and AirPlay
 */
export const createUnifiedCastAdapter = (
  videoElement: HTMLVideoElement,
  onStateChange?: (state: RemotePlaybackState) => void
): {
  chromecast: UnifiedCastAdapter | null;
  airplay: UnifiedCastAdapter | null;
  getBestAvailable: () => UnifiedCastAdapter | null;
} => {
  let chromecastSession: any = null;
  let airplayCleanup: (() => void) | null = null;

  // Chromecast adapter
  const chromecastAdapter: UnifiedCastAdapter | null = (() => {
    if (typeof window === 'undefined' || !(window as any).chrome?.cast?.isAvailable) {
      return null;
    }

    return {
      type: 'chromecast',
      isSupported: () => !!(window as any).chrome?.cast?.isAvailable,
      isAvailable: () => !!(window as any).chrome?.cast?.isAvailable,
      isConnected: () => !!chromecastSession,
      
      connect: async () => {
        try {
          onStateChange?.({ type: 'chromecast', state: 'connecting' });
          chromecastSession = await requestCastSession();
          onStateChange?.({ type: 'chromecast', state: 'connected' });
        } catch (error) {
          onStateChange?.({ 
            type: 'chromecast', 
            state: 'disconnected', 
            error: error instanceof Error ? error.message : 'Connection failed' 
          });
          throw error;
        }
      },
      
      disconnect: async () => {
        if (chromecastSession) {
          chromecastSession.stop();
          chromecastSession = null;
        }
        onStateChange?.({ type: 'chromecast', state: 'disconnected' });
      },
      
      loadMedia: async (mediaInfo) => {
        if (!chromecastSession) {
          throw new Error('No active Chromecast session');
        }
        await loadMediaOnCast(chromecastSession, mediaInfo as CastMediaInfo);
      },
      
      getState: () => ({
        type: 'chromecast' as const,
        state: chromecastSession ? 'connected' : 'disconnected'
      })
    };
  })();

  // AirPlay adapter
  const airplayAdapter: UnifiedCastAdapter | null = (() => {
    if (!isAirPlaySupported()) {
      return null;
    }

    let isConnected = false;

    return {
      type: 'airplay',
      isSupported: () => isAirPlaySupported(),
      isAvailable: () => isAirPlayAvailable(videoElement),
      isConnected: () => isConnected,
      
      connect: async () => {
        try {
          onStateChange?.({ type: 'airplay', state: 'connecting' });
          
          // Initialize AirPlay if not already done
          if (!airplayCleanup) {
            airplayCleanup = initializeAirPlay(videoElement, (state) => {
              isConnected = state.isConnected;
              onStateChange?.({
                type: 'airplay',
                state: state.isConnected ? 'connected' : 'disconnected',
                error: state.error
              });
            });
          }
          
          await requestAirPlay(videoElement);
          // Note: AirPlay connection state will be updated via event listeners
        } catch (error) {
          onStateChange?.({ 
            type: 'airplay', 
            state: 'disconnected', 
            error: error instanceof Error ? error.message : 'Connection failed' 
          });
          throw error;
        }
      },
      
      disconnect: async () => {
        // AirPlay disconnection is typically handled by the system
        // We can only clean up our event listeners
        if (airplayCleanup) {
          airplayCleanup();
          airplayCleanup = null;
        }
        isConnected = false;
        onStateChange?.({ type: 'airplay', state: 'disconnected' });
      },
      
      loadMedia: async (mediaInfo) => {
        // For AirPlay, media loading is handled automatically when connecting
        // The video element's src should be set to the media URL
        const airplayInfo = mediaInfo as AirPlayMediaInfo;
        videoElement.src = airplayInfo.contentId;
        if (airplayInfo.currentTime) {
          videoElement.currentTime = airplayInfo.currentTime;
        }
      },
      
      getState: () => ({
        type: 'airplay' as const,
        state: isConnected ? 'connected' : 'disconnected'
      })
    };
  })();

  return {
    chromecast: chromecastAdapter,
    airplay: airplayAdapter,
    getBestAvailable: () => {
      // Prefer Chromecast if available, fallback to AirPlay
      if (chromecastAdapter?.isAvailable()) {
        return chromecastAdapter;
      }
      if (airplayAdapter?.isAvailable()) {
        return airplayAdapter;
      }
      return null;
    }
  };
};

/**
 * Simple unified function to request casting (auto-detects best option)
 */
export const requestUnifiedCast = async (
  videoElement: HTMLVideoElement,
  mediaUrl: string,
  title: string,
  poster?: string,
  currentTime: number = 0
): Promise<{ type: 'chromecast' | 'airplay'; adapter: UnifiedCastAdapter }> => {
  const adapters = createUnifiedCastAdapter(videoElement);
  const bestAdapter = adapters.getBestAvailable();
  
  if (!bestAdapter) {
    throw new Error('No casting options available on this device');
  }

  // Prepare appropriate media info
  const mediaInfo = bestAdapter.type === 'chromecast' 
    ? prepareCastMediaInfo(mediaUrl, title, poster, currentTime)
    : prepareAirPlayMediaInfo(mediaUrl, title, poster, currentTime);

  // Connect and load media
  await bestAdapter.connect();
  await bestAdapter.loadMedia(mediaInfo);

  return { type: bestAdapter.type, adapter: bestAdapter };
};

/**
 * Check what casting options are available
 */
export const getAvailableCastOptions = (videoElement?: HTMLVideoElement): {
  chromecast: boolean;
  airplay: boolean;
  any: boolean;
} => {
  const chromecastAvailable = !!(window as any).chrome?.cast?.isAvailable;
  const airplayAvailable = isAirPlaySupported() && (videoElement ? isAirPlayAvailable(videoElement) : true);
  
  return {
    chromecast: chromecastAvailable,
    airplay: airplayAvailable,
    any: chromecastAvailable || airplayAvailable
  };
};



/**
 * Initialize Chromecast API
 */
const getCastFrameworkContext = () => {
  const castFramework = (window as any).cast?.framework;
  if (!castFramework?.CastContext || !(window as any).chrome?.cast?.AutoJoinPolicy) {
    return null;
  }

  return castFramework.CastContext.getInstance();
};

const getDefaultCastReceiverApplicationId = (): string => {
  return (window as any).chrome?.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || '';
};

export const initializeCastApi = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (
      typeof window === 'undefined'
      || !(window as any).chrome?.cast?.isAvailable
      || !getDefaultCastReceiverApplicationId()
    ) {
      resolve(false);
      return;
    }

    try {
      const castContext = getCastFrameworkContext();
      const receiverApplicationId = getDefaultCastReceiverApplicationId();
      if (castContext) {
        castContext.setOptions({
          receiverApplicationId,
          autoJoinPolicy: (window as any).chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        console.log('Cast Framework initialized successfully');
        resolve(true);
        return;
      }

      const sessionRequest = new (window as any).chrome.cast.SessionRequest(receiverApplicationId);
      const apiConfig = new (window as any).chrome.cast.ApiConfig(
        sessionRequest,
        () => {
          console.log('Cast session started');
        },
        (availability: string) => {
          console.log('Cast availability:', availability);
        }
      );
      
      (window as any).chrome.cast.initialize(apiConfig, () => {
        console.log('Cast API initialized successfully');
        resolve(true);
      }, (error: any) => {
        console.error('Cast API initialization failed:', error);
        resolve(false);
      });
    } catch (error) {
      console.error('Error initializing Cast API:', error);
      resolve(false);
    }
  });
};

/**
 * Request a cast session
 */
export const requestCastSession = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !(window as any).chrome?.cast) {
      reject(new Error('Cast API not available'));
      return;
    }

    const castContext = getCastFrameworkContext();
    if (castContext?.requestSession) {
      castContext.requestSession()
        .then(() => {
          const frameworkSession = castContext.getCurrentSession?.();
          const sessionObj = frameworkSession?.getSessionObj?.();

          if (sessionObj) {
            resolve(sessionObj);
            return;
          }

          reject(new Error('Cast session unavailable after request'));
        })
        .catch((error: any) => reject(error));
      return;
    }

    (window as any).chrome.cast.requestSession(
      (session: any) => resolve(session),
      (error: any) => reject(error)
    );
  });
};

/**
 * Load media on cast device
 */
export const loadMediaOnCast = async (
  session: any,
  mediaInfo: CastMediaInfo,
  currentTime: number = 0,
  autoplay: boolean = true,
  activeTrackIds?: number[],
): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!session || !(window as any).chrome?.cast?.media) {
      reject(new Error('Invalid session or Cast media API not available'));
      return;
    }

    const request = new (window as any).chrome.cast.media.LoadRequest(mediaInfo);
    request.currentTime = currentTime;
    request.autoplay = autoplay;
    if (activeTrackIds && activeTrackIds.length > 0) {
      request.activeTrackIds = activeTrackIds;
    }

    session.loadMedia(request, () => {
      console.log('Media loaded on cast device');
      resolve();
    }, (error: any) => {
      console.error('Failed to load media on cast device:', error);
      reject(error);
    });
  });
};

/**
 * Candidate Content-Type values to try when loading an HLS stream onto a
 * Chromecast receiver. Different receivers (Default Media Receiver, Built-in
 * Cast on Android TVs, older 1st-gen Chromecasts, custom CAFv3 receivers) all
 * normalise the MIME slightly differently and a single hard-coded value can
 * fail on some hardware. Order: most-spec-compliant first.
 */
export const getHLSContentTypes = (_url: string): string[] => [
  'application/vnd.apple.mpegurl', // RFC 8216, broadest receiver support
  'application/x-mpegurl',         // older Apple variant, lowercase
  'application/x-mpegURL',         // mixed-case, what Movix used historically
];

/**
 * Get candidate content types for a given media URL — HLS gets multiple,
 * other formats get exactly one.
 */
const getCastContentTypes = (mediaUrl: string, explicitContentType?: string): string[] => {
  const normalizedExplicitType = explicitContentType?.trim().toLowerCase();
  if (normalizedExplicitType === 'video/mp4') return ['video/mp4'];
  if (normalizedExplicitType === 'text/html') return ['text/html'];
  const hlsContentTypes = getHLSContentTypes(mediaUrl);
  if (normalizedExplicitType && hlsContentTypes.some(type => type.toLowerCase() === normalizedExplicitType)) {
    return [
      explicitContentType!,
      ...hlsContentTypes.filter(type => type !== explicitContentType),
    ];
  }
  const mediaType = detectMediaType(mediaUrl);
  if (mediaType === 'm3u8') return hlsContentTypes;
  if (mediaType === 'mp4')  return ['video/mp4'];
  if (mediaType === 'html') return ['text/html'];
  return ['application/x-mpegURL'];
};

/**
 * Load media on a cast session, retrying with alternative content-types if the
 * first attempt fails. Mirrors what cinepulse.ac's ChromecastService does — a
 * single hard-coded Content-Type fails on receivers that disagree with our MIME
 * choice; iterating gives the cast a real chance to succeed.
 *
 * Throws the LAST error if every content-type was rejected by the receiver.
 */
export const loadMediaOnCastWithFallback = async (
  session: any,
  mediaUrl: string,
  title: string,
  poster?: string,
  currentTime: number = 0,
  autoplay: boolean = true,
  subtitles: CastSubtitleTrack[] = [],
  enableSubtitlesInitially: boolean = false,
  streamType: string = 'BUFFERED',
  explicitContentType?: string,
): Promise<void> => {
  const contentTypes = getCastContentTypes(mediaUrl, explicitContentType);
  const baseMediaInfo = prepareCastMediaInfo(mediaUrl, title, poster, currentTime, streamType);

  // Attach external subtitle tracks if any. The Default Media Receiver only
  // handles WebVTT — SRT URLs will land but won't render. We still send them
  // so the cast itself isn't blocked; user can pick another source.
  let activeTrackIds: number[] | undefined;
  const castMediaApi = (window as any).chrome?.cast?.media;
  if (subtitles.length > 0 && castMediaApi?.Track) {
    try {
      const tracks = subtitles.map((sub, idx) => {
        const track = new castMediaApi.Track(idx + 1, castMediaApi.TrackType?.TEXT ?? 'TEXT');
        track.trackContentId = sub.url;
        track.trackContentType = sub.contentType || 'text/vtt';
        track.subtype = castMediaApi.TextTrackType?.SUBTITLES ?? 'SUBTITLES';
        track.name = sub.label;
        track.language = sub.language;
        return track;
      });
      baseMediaInfo.tracks = tracks;

      // Default styling — readable on most TV backgrounds.
      if (typeof castMediaApi.TextTrackStyle === 'function') {
        const style = new castMediaApi.TextTrackStyle();
        style.backgroundColor = '#00000080'; // 50% black behind glyphs
        style.foregroundColor = '#FFFFFFFF';
        style.fontScale = 1.0;
        style.edgeColor = '#000000FF';
        style.edgeType = castMediaApi.TextTrackEdgeType?.OUTLINE ?? 'OUTLINE';
        baseMediaInfo.textTrackStyle = style;
      }

      if (enableSubtitlesInitially) {
        activeTrackIds = [tracks[0].trackId];
      }
    } catch (err) {
      console.warn('[Cast] Could not build subtitle tracks (cast SDK shape mismatch?):', err);
    }
  }

  let lastError: any = null;
  for (const contentType of contentTypes) {
    const mediaInfo: CastMediaInfo = { ...baseMediaInfo, contentType };
    try {
      console.log('[Cast] Trying contentType:', contentType, 'subs:', subtitles.length, 'active:', !!activeTrackIds);
      await loadMediaOnCast(session, mediaInfo, currentTime, autoplay, activeTrackIds);
      console.log('[Cast] Loaded successfully with contentType:', contentType);
      return;
    } catch (error) {
      console.warn(`[Cast] contentType ${contentType} rejected:`, error);
      lastError = error;
    }
  }
  throw lastError ?? new Error('All cast content types rejected by receiver');
};

// ============================================================================
// AirPlay Functions
// ============================================================================

/**
 * Check if AirPlay is supported on the current device
 */
/**
 * Check if AirPlay is supported by the browser (Safari only)
 */
export const isAirPlaySupported = (): boolean => {
  if (typeof window === 'undefined') return false;

  // Check for WebKit AirPlay API - only available in Safari
  const video = document.createElement('video') as any;
  return typeof video.webkitShowPlaybackTargetPicker === 'function';
};

/**
 * Check whether the W3C Remote Playback API is usable as an AirPlay-like
 * fallback signal. Skipped when WebKit AirPlay is already available (Safari)
 * or when the Cast SDK is already loaded (Chrome/Edge with cast.framework) —
 * those paths handle device discovery natively, so doubling up would only
 * confuse the picker UX.
 *
 * Use case: Firefox / Edge with cast extension blocked / Brave with shields
 * blocking gstatic.com. These browsers lose the cast.framework path but still
 * expose `HTMLMediaElement.prototype.remote`, which gives us cross-browser
 * availability detection and a programmatic picker (`remote.prompt()`).
 */
export const isRemotePlaybackSupported = (videoElement?: HTMLVideoElement): boolean => {
  if (typeof window === 'undefined') return false;
  // Already covered by chrome.cast.framework — don't dispatch a competing picker.
  if ((window as any).chrome?.cast) return false;
  // Already covered by WebKit AirPlay APIs — same reason.
  if (isAirPlaySupported()) return false;
  const video = (videoElement ?? document.createElement('video')) as any;
  return !!video.remote && typeof video.remote.watchAvailability === 'function';
};

/**
 * Check if AirPlay is currently available (devices detected)
 * This is a best-effort check as WebKit doesn't expose device availability directly
 */
export const isAirPlayAvailable = (videoElement?: HTMLVideoElement): boolean => {
  if (!isAirPlaySupported() || !videoElement) return false;
  
  const video = videoElement as HTMLVideoElementWithAirPlay;
  
  // AirPlay is available if wireless playback is not explicitly disabled
  // Note: This doesn't guarantee devices are present, only that AirPlay is enabled
  return video.webkitWirelessVideoPlaybackDisabled !== true;
};

/**
 * Check if currently connected to AirPlay
 */
export const isAirPlayConnected = (videoElement?: HTMLVideoElement): boolean => {
  if (!videoElement) return false;
  
  const video = videoElement as HTMLVideoElementWithAirPlay;
  return video.webkitCurrentPlaybackTargetIsWireless === true;
};

/**
 * Observe AirPlay availability and connection state for a video element.
 * Keep the playback engine's remote-playback flags until an explicit request.
 * 
 * @returns Cleanup function to remove event listeners
 */
export const initializeAirPlay = (
  videoElement: HTMLVideoElement,
  onStateChange?: (state: AirPlayState) => void
): (() => void) => {
  const video = videoElement as HTMLVideoElementWithAirPlay;
  
  // Check if AirPlay is supported
  const isSupported = isAirPlaySupported();

  if (!isSupported) {
    // No WebKit AirPlay — try the W3C Remote Playback API as a fallback so
    // browsers without cast.framework AND without WebKit AirPlay (Firefox,
    // Edge with cast blocked, Brave with shields) still get device discovery
    // and a working picker via `video.remote`.
    if (isRemotePlaybackSupported(video)) {
      console.log('[RemotePlayback] Initializing as AirPlay-like fallback');
      const remote = (video as any).remote;

      let availabilityCallbackId: number | null = null;
      let lastAvailable = false;
      const dispatch = () => onStateChange?.({
        isAvailable: lastAvailable,
        isConnected: remote.state === 'connected',
        isConnecting: remote.state === 'connecting',
      });
      const handleConnecting = () => onStateChange?.({ isAvailable: lastAvailable, isConnected: false, isConnecting: true });
      const handleConnect    = () => onStateChange?.({ isAvailable: lastAvailable, isConnected: true,  isConnecting: false });
      const handleDisconnect = () => onStateChange?.({ isAvailable: lastAvailable, isConnected: false, isConnecting: false });

      remote.addEventListener('connecting', handleConnecting);
      remote.addEventListener('connect',    handleConnect);
      remote.addEventListener('disconnect', handleDisconnect);

      Promise.resolve(remote.watchAvailability((available: boolean) => {
        lastAvailable = available;
        dispatch();
      }))
        .then((id: number) => { availabilityCallbackId = id; })
        .catch((err: unknown) => console.warn('[RemotePlayback] watchAvailability failed:', err));

      // Initial state — availability not known yet, just report current connection state.
      dispatch();

      return () => {
        remote.removeEventListener('connecting', handleConnecting);
        remote.removeEventListener('connect',    handleConnect);
        remote.removeEventListener('disconnect', handleDisconnect);
        if (availabilityCallbackId !== null && typeof remote.cancelWatchAvailability === 'function') {
          try { remote.cancelWatchAvailability(availabilityCallbackId); } catch { /* swallow — page tearing down */ }
        }
      };
    }

    console.log('[AirPlay] Not supported on this device/browser');
    onStateChange?.({ isAvailable: false, isConnected: false, isConnecting: false });
    return () => {}; // Return empty cleanup function
  }

  console.log('[AirPlay] Initializing...');

  // Sur iPhone, Hls.js désactive la sortie distante pour ouvrir
  // ManagedMediaSource sans source AirPlay alternative. Au remontage du
  // lecteur, cet observateur s'exécute après l'attachement HLS : réactiver
  // AirPlay ici bloque le média à 0:00. Seul requestAirPlay doit le faire.

  /**
   * Handle changes in AirPlay device availability
   * Fired when AirPlay devices become available or unavailable
   */
  const handleTargetAvailabilityChange = (event: any) => {
    const isAvailable = event.availability === 'available';
    const isConnected = video.webkitCurrentPlaybackTargetIsWireless || false;
    
    console.log('[AirPlay] Device availability changed:', {
      availability: event.availability,
      isAvailable,
      isConnected
    });
    
    onStateChange?.({
      isAvailable,
      isConnected,
      isConnecting: false
    });
  };

  /**
   * Handle changes in wireless playback target
   * Fired when connecting/disconnecting to/from AirPlay device
   */
  const handleWirelessTargetChange = () => {
    const isConnected = video.webkitCurrentPlaybackTargetIsWireless || false;
    
    console.log('[AirPlay] Wireless target changed:', {
      isConnected,
      readyState: video.readyState,
      paused: video.paused
    });
    
    onStateChange?.({
      isAvailable: isSupported,
      isConnected,
      isConnecting: false
    });
  };

  // Add event listeners for AirPlay state changes
  video.addEventListener('webkitplaybacktargetavailabilitychanged', handleTargetAvailabilityChange);
  video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessTargetChange);

  // Report initial state
  const initialIsConnected = video.webkitCurrentPlaybackTargetIsWireless || false;
  onStateChange?.({
    isAvailable: isSupported,
    isConnected: initialIsConnected,
    isConnecting: false
  });

  console.log('[AirPlay] Initialized successfully', {
    isConnected: initialIsConnected
  });

  // Return cleanup function to remove event listeners
  return () => {
    console.log('[AirPlay] Cleaning up event listeners');
    video.removeEventListener('webkitplaybacktargetavailabilitychanged', handleTargetAvailabilityChange);
    video.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', handleWirelessTargetChange);
  };
};

/**
 * Show AirPlay device picker
 * Note: This must be triggered by a user gesture (e.g., button click)
 */
export const requestAirPlay = async (videoElement: HTMLVideoElement): Promise<void> => {
  const video = videoElement as HTMLVideoElementWithAirPlay;

  // Prefer the WebKit-native picker on Safari — full AirPlay UX, returns
  // synchronously after showing the system sheet.
  if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
    try {
      console.log('[AirPlay] Showing WebKit device picker...');
      video.setAttribute('x-webkit-airplay', 'allow');
      if (typeof video.webkitWirelessVideoPlaybackDisabled !== 'undefined') {
        video.webkitWirelessVideoPlaybackDisabled = false;
      }
      video.disableRemotePlayback = false;
      video.webkitShowPlaybackTargetPicker();
      console.log('[AirPlay] WebKit picker shown');
      return;
    } catch (error) {
      console.warn('[AirPlay] WebKit picker failed, will try Remote Playback API:', error);
      // fall through
    }
  }

  // W3C Remote Playback API fallback — only used when neither WebKit AirPlay
  // nor cast.framework picker is available (= isRemotePlaybackSupported() path).
  const remote = (video as any).remote;
  if (remote && typeof remote.prompt === 'function') {
    try {
      console.log('[RemotePlayback] Calling remote.prompt() as AirPlay fallback');
      if ('disableRemotePlayback' in video) (video as any).disableRemotePlayback = false;
      await remote.prompt();
      console.log('[RemotePlayback] Picker shown');
      return;
    } catch (error) {
      console.error('[RemotePlayback] remote.prompt() failed:', error);
      throw error;
    }
  }

  throw new Error('AirPlay/Remote Playback is not supported on this device/browser');
};

/**
 * Prepare media info for AirPlay
 */
export const prepareAirPlayMediaInfo = (
  mediaUrl: string,
  title: string,
  poster?: string,
  currentTime: number = 0
): AirPlayMediaInfo => {
  // Detect media type
  const mediaType = detectMediaType(mediaUrl);

  const airPlayUrl = mediaUrl;

  // For AirPlay, we should avoid modifying M3U8 URLs too much
  // AirPlay handles HLS streams natively and modifying URLs can cause issues
  // Only apply basic proxy if needed, but keep the original structure

  // Set appropriate content type
  let contentType: string;
  if (mediaType === 'mp4') {
    contentType = 'video/mp4';
  } else if (mediaType === 'html') {
    contentType = 'text/html';
  } else {
    contentType = 'application/x-mpegURL';
  }

  const mediaInfo: AirPlayMediaInfo = {
    contentId: airPlayUrl,
    contentType: contentType,
    streamType: 'BUFFERED',
    metadata: {
      metadataType: 1,
      title: title,
      images: poster ? [{
        url: poster.startsWith('http') ? poster : `https://image.tmdb.org/t/p/w500${poster}`,
        height: 480,
        width: 320
      }] : undefined
    },
    customData: {
      currentTime: currentTime
    }
  };

  return mediaInfo;
};
