import React from 'react';

import { supabase } from '@/lib/supabase';
import { getOrCreateTodayDrop, getRecentDrops } from '@/services/drops';
import type { RecentDrop, TodayDropPayload } from '@/types/daydrop';

type RefetchResult = {
  recentDrops: RecentDrop[];
  today: TodayDropPayload;
} | null;

export function useTodayDrop(coupleId: string | null) {
  const [today, setToday] = React.useState<TodayDropPayload | null>(null);
  const [recentDrops, setRecentDrops] = React.useState<RecentDrop[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(
    async (isRefresh = false): Promise<RefetchResult> => {
      if (!coupleId) {
        setToday(null);
        setRecentDrops([]);
        return null;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const nextToday = await getOrCreateTodayDrop();
        const nextRecentDrops = await getRecentDrops(nextToday.daily_drop.couple_id);
        setToday(nextToday);
        setRecentDrops(nextRecentDrops);
        return {
          recentDrops: nextRecentDrops,
          today: nextToday,
        };
      } catch (nextError) {
        const message =
          nextError instanceof Error
            ? nextError.message
            : typeof nextError === 'object' && nextError !== null && 'message' in nextError && typeof nextError.message === 'string'
              ? nextError.message
              : 'Could not load today\'s Drop.';
        setError(message);
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [coupleId]
  );

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    if (!coupleId) {
      return undefined;
    }

    const channel = supabase
      .channel(`drop-submissions-${coupleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'drop_submissions',
          filter: `couple_id=eq.${coupleId}`,
        },
        () => {
          void refetch(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [coupleId, refetch]);

  return {
    today,
    recentDrops,
    loading,
    refreshing,
    error,
    refetch,
  };
}
