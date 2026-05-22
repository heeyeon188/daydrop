import React from 'react';

import { supabase } from '@/lib/supabase';
import { getOrCreateTodayDrop, getRecentDrops } from '@/services/drops';
import type { RecentDrop, TodayDropPayload } from '@/types/daydrop';

export function useTodayDrop(coupleId: string | null) {
  const [today, setToday] = React.useState<TodayDropPayload | null>(null);
  const [recentDrops, setRecentDrops] = React.useState<RecentDrop[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(
    async (isRefresh = false) => {
      if (!coupleId) {
        setToday(null);
        setRecentDrops([]);
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const nextToday = await getOrCreateTodayDrop();
        setToday(nextToday);
        setRecentDrops(await getRecentDrops(nextToday.daily_drop.couple_id));
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : '오늘의 Drop을 불러오지 못했어요.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [coupleId]
  );

  React.useEffect(() => {
    refetch();
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
          refetch(true);
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
