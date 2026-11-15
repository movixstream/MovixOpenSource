import { selectAudioTrackIndex } from './hlsQuality.ts';

interface NativeAudioTrack {
  label: string;
  language: string;
  enabled: boolean;
}

interface NativeAudioTrackList extends EventTarget, ArrayLike<NativeAudioTrack> {}

export interface PlayerAudioTrack {
  id: number;
  name: string;
  language: string;
  groupId: string;
}

const getAudioTracks = (video: HTMLVideoElement): NativeAudioTrackList | undefined => (
  video as HTMLVideoElement & { audioTracks?: NativeAudioTrackList }
).audioTracks;

export function selectNativeAudioTrack(video: HTMLVideoElement, index: number): boolean {
  const tracks = getAudioTracks(video);
  if (!tracks || !Number.isInteger(index) || index < 0 || index >= tracks.length) return false;

  // Activer la nouvelle piste avant de couper l'ancienne évite un passage muet.
  tracks[index].enabled = true;
  Array.from(tracks).forEach((track, trackIndex) => {
    if (trackIndex !== index && track.enabled) track.enabled = false;
  });
  return true;
}

export function observeNativeAudioTracks(
  video: HTMLVideoElement,
  getPreference: () => { language: string; name: string } | null,
  onChange: (tracks: PlayerAudioTrack[], selectedIndex: number) => void,
): () => void {
  let observed: NativeAudioTrackList | undefined;

  const sync = (restorePreference: boolean) => {
    const tracks = Array.from(getAudioTracks(video) ?? []);
    const options = tracks.map((track, index) => ({
      id: index,
      name: track.label || `Audio ${index + 1}`,
      language: track.language || 'unknown',
      groupId: '',
    }));
    if (restorePreference) {
      const preferred = selectAudioTrackIndex(options, getPreference());
      if (preferred >= 0 && !tracks[preferred].enabled) selectNativeAudioTrack(video, preferred);
    }
    onChange(options, tracks.findIndex(track => track.enabled));
  };
  const handleChange = () => sync(false);
  const handleTracks = () => {
    const tracks = getAudioTracks(video);
    if (tracks !== observed) {
      detach();
      observed = tracks;
      observed?.addEventListener('addtrack', handleTracks);
      observed?.addEventListener('removetrack', handleTracks);
      observed?.addEventListener('change', handleChange);
    }
    sync(true);
  };
  const detach = () => {
    observed?.removeEventListener('addtrack', handleTracks);
    observed?.removeEventListener('removetrack', handleTracks);
    observed?.removeEventListener('change', handleChange);
  };

  video.addEventListener('loadedmetadata', handleTracks);
  handleTracks();
  return () => {
    video.removeEventListener('loadedmetadata', handleTracks);
    detach();
  };
}
