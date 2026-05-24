import React from 'react';

import { supabase } from '@/lib/supabase';
import { getOrCreateTodayDrop, getRecentDrops } from '@/services/drops';
import type { RecentDrop, TodayDropPayload } from '@/types/daydrop';

type RefetchResult = {
  recentDrops: RecentDrop[];
  today: TodayDropPayload;
} | null;

export function useTodayDrop(enabled: boolean, selectedCoupleId?: string | null) {
  const [today, setToday] = React.useState<TodayDropPayload | null>(null);
  const [recentDrops, setRecentDrops] = React.useState<RecentDrop[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(
    async (isRefresh = false): Promise<RefetchResult> => {
      if (!enabled) {
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
        console.error('load today drop failed', nextError);
        setError('네트워크 상태를 확인하고 다시 시도해주세요.');
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [enabled, selectedCoupleId]
  );

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    const coupleId = today?.daily_drop.couple_id;
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
  }, [today?.daily_drop.couple_id, refetch]);

  return {
    today,
    recentDrops,
    loading,
    refreshing,
    error,
    refetch,
  };
}
