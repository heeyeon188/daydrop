import React from 'react';

import { getLatestDisconnectedCouple, getMyCouple, type MyCouple } from '@/services/couple';
import type { Couple } from '@/types/daydrop';

export function useMyCouple(enabled: boolean) {
  const [couple, setCouple] = React.useState<MyCouple | null>(null);
  const [latestDisconnectedCouple, setLatestDisconnectedCouple] = React.useState<Couple | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!enabled) {
      setCouple(null);
      setLatestDisconnectedCouple(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextCouple, nextDisconnectedCouple] = await Promise.all([getMyCouple(), getLatestDisconnectedCouple()]);
      setCouple(nextCouple);
      setLatestDisconnectedCouple(nextDisconnectedCouple);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load couple details.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  const selectOptimistic = React.useCallback((coupleId: string) => {
    setCouple((current) => {
      const selected = current?.availableCouples.find((option) => option.couple.id === coupleId);
      if (!current || !selected) {
        return current;
      }

      return {
        ...selected,
        availableCouples: current.availableCouples,
      };
    });
  }, []);

  return {
    couple,
    latestDisconnectedCouple,
    loading,
    error,
    refetch,
    selectOptimistic,
  };
}
