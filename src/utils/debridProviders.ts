import type { DebridProvider } from '@/types/debrid';

export const isDebridProvider = (value: unknown): value is DebridProvider =>
  value === 'deepbrid' || value === 'realdebrid' || value === 'debridr';

export const selectAvailableDebridProvider = (
  requested: unknown,
  available: DebridProvider[],
): DebridProvider | undefined =>
  isDebridProvider(requested) && available.includes(requested) ? requested : available[0];
