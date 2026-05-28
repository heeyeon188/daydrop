import React from 'react';
import { Image as ExpoImage } from 'expo-image';

import { supabase } from '@/lib/supabase';
import { getOrCreateTodayDrop, getRecentDrops } from '@/services/drops';
import type { DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

type RefetchResult = {
  recentDrops: RecentDrop[];
  today: TodayDropPayload;
} | null;

const RECENT_PREFETCH_DROP_LIMIT = 4;

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
        prefetchDropImageUrls(collectTodayImageUrls(nextToday));
        setToday((current) => (areTodayImageUrlsEqual(current, nextToday) ? current : nextToday));

        const nextRecentDrops = await getRecentDrops(nextToday.daily_drop.couple_id);
        prefetchDropImageUrls(collectRecentImageUrls(nextRecentDrops));
        setRecentDrops((current) => (areRecentImageUrlsEqual(current, nextRecentDrops) ? current : nextRecentDrops));
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

function collectTodayImageUrls(today: TodayDropPayload) {
  return collectSubmissionImageUrls(today.submissions);
}

function collectRecentImageUrls(drops: RecentDrop[]) {
  return drops.slice(0, RECENT_PREFETCH_DROP_LIMIT).flatMap((drop) => collectSubmissionImageUrls(drop.drop_submissions));
}

function collectSubmissionImageUrls(submissions: DropSubmission[]) {
  return submissions.map((submission) => submission.image_url).filter(isNonEmptyString);
}

function prefetchDropImageUrls(urls: string[]) {
  const uniqueUrls = [...new Set(urls)];
  if (uniqueUrls.length === 0) {
    return;
  }

  ExpoImage.prefetch(uniqueUrls, 'memory-disk').catch((error) => {
    console.warn('[photo] image prefetch failed', error);
  });
}

function areTodayImageUrlsEqual(current: TodayDropPayload | null, next: TodayDropPayload) {
  if (!current) {
    return false;
  }

  return current.daily_drop.id === next.daily_drop.id && areSubmissionImageUrlsEqual(current.submissions, next.submissions);
}

function areRecentImageUrlsEqual(current: RecentDrop[], next: RecentDrop[]) {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((drop, index) => {
    const nextDrop = next[index];
    return drop.id === nextDrop?.id && areSubmissionImageUrlsEqual(drop.drop_submissions, nextDrop.drop_submissions);
  });
}

function areSubmissionImageUrlsEqual(current: DropSubmission[], next: DropSubmission[]) {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((submission, index) => submission.id === next[index]?.id && submission.image_url === next[index]?.image_url);
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}
