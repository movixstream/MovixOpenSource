import type { SourceProvider } from '../types.ts';
import { placeholderProviders } from './placeholders.ts';
import { stubProvider } from './stubProvider.ts';
import { swiftflowProvider } from './swiftflowProvider.ts';
import { watchCatalogProvider } from './watchCatalog.ts';

const providers: SourceProvider[] = [
  stubProvider,
  swiftflowProvider,
  watchCatalogProvider,
  ...placeholderProviders,
];

export function listProviders(): SourceProvider[] {
  return [...providers];
}

export function getProvider(id: string): SourceProvider | undefined {
  return providers.find((p) => p.id === id);
}

/** Providers that will actually be called (enabled + optional filter). */
export function selectProviders(filterIds?: string[]): SourceProvider[] {
  if (filterIds && filterIds.length > 0) {
    const want = new Set(filterIds);
    return providers.filter((p) => want.has(p.id));
  }
  return providers.filter((p) => p.enabled);
}
