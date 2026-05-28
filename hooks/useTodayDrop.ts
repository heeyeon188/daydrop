import React from 'react';
import { Image as ExpoImage } from 'expo-image';

import { supabase } from '@/lib/supabase';
import { getOrCreateTodayDrop, getRecentDrops } from '@/services/drops';
import type { DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

type RefetchResult = {
  recentDrops: RecentDrop[];
  today: TodayDropPayload;
} | null;

type PrefetchImage = {
  key: string;
  url: string;
};

const RECENT_PREFETCH_DROP_LIMIT = 4;
const REALTIME_REFETCH_DEBOUNCE_MS = 1200;
const prefetchedImageKeys = new Set<string>();
const prefetchingImageKeys = new Set<string>();

export function useTodayDrop(enabled: boolean, selectedCoupleId?: string | null) {
  const [today, setToday] = React.useState<TodayDropPayload | null>(null);
  const [recentDrops, setRecentDrops] = React.useState<RecentDrop[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const refetchInFlightRef = React.useRef<Promise<RefetchResult> | null>(null);
  const realtimeRefetchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExplicitRefreshAtRef = React.useRef(0);

  const refetch = React.useCallback(
    async (isRefresh = false): Promise<RefetchResult> => {
      if (isRefresh) {
        lastExplicitRefreshAtRef.current = Date.now();
      }

      if (refetchInFlightRef.current) {
        return refetchInFlightRef.current;
      }

      if (!enabled) {
        setToday(null);
        setRecentDrops([]);
        return null;
      }

      const nextRefetch = (async () => {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        try {
          const nextToday = await getOrCreateTodayDrop();
          setToday((current) => (areTodayImageUrlsEqual(current, nextToday) ? current : nextToday));
          prefetchDropImageUrls(collectTodayImageUrls(nextToday));

          const nextRecentDrops = await getRecentDrops(nextToday.daily_drop.couple_id);
          setRecentDrops((current) => (areRecentImageUrlsEqual(current, nextRecentDrops) ? current : nextRecentDrops));
          prefetchDropImageUrls(collectRecentImageUrls(nextRecentDrops));
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
          refetchInFlightRef.current = null;
        }
      })();

      refetchInFlightRef.current = nextRefetch;
      return nextRefetch;
    },
    [enabled, selectedCoupleId]
  );

  const scheduleRealtimeRefetch = React.useCallback(() => {
    if (Date.now() - lastExplicitRefreshAtRef.current < REALTIME_REFETCH_DEBOUNCE_MS) {
      return;
    }

    if (realtimeRefetchTimerRef.current) {
      clearTimeout(realtimeRefetchTimerRef.current);
    }

    realtimeRefetchTimerRef.current = setTimeout(() => {
      realtimeRefetchTimerRef.current = null;
      void refetch(true);
    }, REALTIME_REFETCH_DEBOUNCE_MS);
  }, [refetch]);

  React.useEffect(() => {
    void refetch();
  }, [refetch]);

  React.useEffect(() => {
    return () => {
      if (realtimeRefetchTimerRef.current) {
        clearTimeout(realtimeRefetchTimerRef.current);
        realtimeRefetchTimerRef.current = null;
      }
    };
  }, []);

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
          scheduleRealtimeRefetch();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [scheduleRealtimeRefetch, today?.daily_drop.couple_id]);

  return {
    today,
    recentDrops,
    loading,
    refreshing,
    error,
    refetch,
  };
}

function collectTodayImageUrls(today: TodayDropPayload): PrefetchImage[] {
  return collectSubmissionImages(today.submissions);
}

function collectRecentImageUrls(drops: RecentDrop[]): PrefetchImage[] {
  return drops.slice(0, RECENT_PREFETCH_DROP_LIMIT).flatMap((drop) => collectSubmissionImages(drop.drop_submissions));
}

function collectSubmissionImages(submissions: DropSubmission[]): PrefetchImage[] {
  return submissions.reduce<PrefetchImage[]>((images, submission) => {
    if (isNonEmptyString(submission.image_url)) {
      images.push({
        key: submission.storage_path?.trim() || submission.image_url,
        url: submission.image_url,
      });
    }
    return images;
  }, []);
}

function prefetchDropImageUrls(images: PrefetchImage[]) {
  const imageByKey = new Map(images.map((image) => [image.key, image.url]));
  const nextImages = [...imageByKey.entries()].filter(([key]) => !prefetchedImageKeys.has(key) && !prefetchingImageKeys.has(key));
  if (nextImages.length === 0) {
    return;
  }

  nextImages.forEach(([key]) => prefetchingImageKeys.add(key));

  ExpoImage.prefetch(
    nextImages.map(([, url]) => url),
    'memory-disk'
  )
    .then((prefetched) => {
      if (prefetched) {
        nextImages.forEach(([key]) => prefetchedImageKeys.add(key));
      }
    })
    .catch((error) => {
      console.warn('[photo] image prefetch failed', error);
    })
    .finally(() => {
      nextImages.forEach(([key]) => prefetchingImageKeys.delete(key));
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
