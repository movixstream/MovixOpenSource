export type DebridProvider = 'deepbrid' | 'realdebrid' | 'debridr';

export interface DebridResult {
  link: string;
  filename: string;
  filesize: number;
  host: string;
  provider: DebridProvider;
}
