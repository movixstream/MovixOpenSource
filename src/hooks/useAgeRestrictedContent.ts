import { useEffect, useMemo, useState } from 'react';
import { useProfile } from '../context/ProfileContext';
import {
  AgeClassifiableContent,
  filterContentByAge,
  getContentAgeKey,
} from '../utils/contentAgeFilter';

const EMPTY_CONTENT: readonly never[] = [];

interface AgeFilterState {
  requestKey: string;
  allowedKeys: Set<string>;
  isFiltering: boolean;
}

export interface AgeRestrictedContentResult<T> {
  items: T[];
  isFiltering: boolean;
}

/**
 * Hides list items until they have been checked against the selected profile's
 * age ceiling. The synchronous request key guard avoids a one-render leak when
 * the user changes profile.
 */
export const useAgeRestrictedContent = <T extends AgeClassifiableContent>(
  content: readonly T[] | undefined | null,
): AgeRestrictedContentResult<T> => {
  const { currentProfile } = useProfile();
  const items = content ?? EMPTY_CONTENT;
  const ageRestriction = currentProfile?.ageRestriction || 0;
  const contentKey = useMemo(
    () => items.map(getContentAgeKey).join('|'),
    [items],
  );
  const requestKey = `${ageRestriction}:${contentKey}`;
  const [state, setState] = useState<AgeFilterState>({
    requestKey: '',
    allowedKeys: new Set(),
    isFiltering: false,
  });

  useEffect(() => {
    if (!ageRestriction || ageRestriction <= 0) return;

    let cancelled = false;
    setState({ requestKey, allowedKeys: new Set(), isFiltering: true });

    void filterContentByAge(items, ageRestriction).then((allowedItems) => {
      if (cancelled) return;
      setState({
        requestKey,
        allowedKeys: new Set(allowedItems.map(getContentAgeKey)),
        isFiltering: false,
      });
    });

    return () => {
      cancelled = true;
    };
    // `requestKey` deliberately represents the content identity. Consumers
    // often create an inline array; restarting the verification for an
    // unchanged list on every render would otherwise create a render loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ageRestriction, requestKey]);

  // Preserve identity on unrelated renders (carousel arrow state, for example)
  // so consumers do not rebuild every card's progress/watchlist data.
  return useMemo(() => {
    if (!ageRestriction || ageRestriction <= 0) {
      return { items: [...items], isFiltering: false };
    }

    // Never expose the previous profile's cards while its replacement loads.
    if (state.requestKey !== requestKey) {
      return { items: [], isFiltering: true };
    }

    return {
      items: items.filter((item) => state.allowedKeys.has(getContentAgeKey(item))),
      isFiltering: state.isFiltering,
    };
  }, [items, ageRestriction, state, requestKey]);
};
