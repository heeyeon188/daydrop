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

const HOME_RECENT_DROPS_LIMIT = 5;
const REALTIME_REFETCH_DEBOUNCE_MS = 1200;
const IMAGE_PREFETCH_TIMEOUT_MS = 1200;
const prefetchedImageKeys = new Set<string>();
const prefetchingImageKeys = new Set<string>();
let realtimeChannelInstanceId = 0;

export function useTodayDrop(enabled: boolean, selectedCoupleId?: string | null, currentUserId?: string | null) {
  const [today, setToday] = React.useState<TodayDropPayload | null>(null);
  const [recentDrops, setRecentDrops] = React.useState<RecentDrop[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadedOnce, setLoadedOnce] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dropScopeKey = selectedCoupleId ?? 'solo';
  const hasLoaded = !enabled || loadedOnce;
  const dropScopeKeyRef = React.useRef(dropScopeKey);
  const refetchInFlightRef = React.useRef<Promise<RefetchResult> | null>(null);
  const refetchRequestIdRef = React.useRef(0);
  const realtimeRefetchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastExplicitRefreshAtRef = React.useRef(0);

  const refetch = React.useCallback(
    async (isRefresh = false): Promise<RefetchResult> => {
      void dropScopeKey;

      if (isRefresh) {
        lastExplicitRefreshAtRef.current = Date.now();
      }

      if (refetchInFlightRef.current) {
        return refetchInFlightRef.current;
      }

      if (!enabled) {
        setToday(null);
        setRecentDrops([]);
        setLoadedOnce(false);
        return null;
      }

      const requestId = refetchRequestIdRef.current + 1;
      refetchRequestIdRef.current = requestId;
      const nextRefetch = (async () => {
        const requestScopeKey = dropScopeKey;
        const refetchTimerLabel = '[photo] home refetch/signed URL regeneration';
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        try {
          if (__DEV__) {
            console.time(refetchTimerLabel);
          }
          const nextToday = await getOrCreateTodayDrop();
          if (dropScopeKeyRef.current !== requestScopeKey) {
            return null;
          }
          setToday((current) => (areTodayImageUrlsEqual(current, nextToday) ? current : nextToday));

          const nextRecentDrops = await getRecentDrops(nextToday.daily_drop.couple_id, {
            signedDropLimit: HOME_RECENT_DROPS_LIMIT,
            signingMode: 'thumbnail',
          });
          if (dropScopeKeyRef.current !== requestScopeKey) {
            return null;
          }
          setRecentDrops((current) => (areRecentImageUrlsEqual(current, nextRecentDrops) ? current : nextRecentDrops));
          await prefetchDropImageUrls([...collectTodayImageUrls(nextToday), ...collectRecentImageUrls(nextRecentDrops)], isRefresh ? 0 : IMAGE_PREFETCH_TIMEOUT_MS);
          return {
            recentDrops: nextRecentDrops,
            today: nextToday,
          };
        } catch (nextError) {
          if (dropScopeKeyRef.current !== requestScopeKey) {
            return null;
          }
          console.error('load today drop failed', nextError);
          setError('네트워크 상태를 확인하고 다시 시도해주세요.');
          return null;
        } finally {
          if (__DEV__) {
            console.timeEnd(refetchTimerLabel);
          }
          if (dropScopeKeyRef.current === requestScopeKey) {
            setLoadedOnce(true);
          }
          if (refetchRequestIdRef.current === requestId) {
            setLoading(false);
            setRefreshing(false);
            refetchInFlightRef.current = null;
          }
        }
      })();

      refetchInFlightRef.current = nextRefetch;
      return nextRefetch;
    },
    [dropScopeKey, enabled]
  );

  const applyLocalSubmission = React.useCallback((submission: DropSubmission) => {
    setToday((current) => {
      if (!current || current.daily_drop.id !== submission.drop_id) {
        return current;
      }

      const withoutMine = current.submissions.filter((nextSubmission) => nextSubmission.user_id !== submission.user_id);
      const nextToday = {
        ...current,
        submissions: [...withoutMine, submission],
      };
      void prefetchDropImageUrls(collectTodayImageUrls(nextToday), 0);
      return nextToday;
    });
  }, []);

  const removeLocalSubmission = React.useCallback((submissionId: string) => {
    setToday((current) => {
      if (!current) {
        return current;
      }

      const nextSubmissions = current.submissions.filter((submission) => submission.id !== submissionId);
      if (nextSubmissions.length === current.submissions.length) {
        return current;
      }

      return {
        ...current,
        submissions: nextSubmissions,
      };
    });
  }, []);

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
    dropScopeKeyRef.current = dropScopeKey;
    refetchRequestIdRef.current += 1;
    refetchInFlightRef.current = null;
    setLoading(false);
    setRefreshing(false);
    setToday(null);
    setRecentDrops([]);
    setLoadedOnce(false);
  }, [dropScopeKey]);

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

    realtimeChannelInstanceId += 1;
    const channel = supabase.channel(`drop-submissions-${coupleId}-${realtimeChannelInstanceId}`);
    channel.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'drop_submissions',
        filter: `couple_id=eq.${coupleId}`,
      },
      (payload) => {
        if (currentUserId && getRealtimePayloadUserId(payload) === currentUserId) {
          return;
        }
        scheduleRealtimeRefetch();
      }
    );
    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, scheduleRealtimeRefetch, today?.daily_drop.couple_id]);

  return {
    today,
    recentDrops,
    hasLoaded,
    loading,
    refreshing,
    error,
    applyLocalSubmission,
    removeLocalSubmission,
    refetch,
  };
}

function collectTodayImageUrls(today: TodayDropPayload): PrefetchImage[] {
  return collectSubmissionImages(today.submissions, 'display');
}

function collectRecentImageUrls(drops: RecentDrop[]): PrefetchImage[] {
  return drops.slice(0, HOME_RECENT_DROPS_LIMIT).flatMap((drop) => collectSubmissionImages(drop.drop_submissions, 'thumbnail'));
}

function collectSubmissionImages(submissions: DropSubmission[], usage: 'display' | 'thumbnail'): PrefetchImage[] {
  return submissions.reduce<PrefetchImage[]>((images, submission) => {
    const image = usage === 'thumbnail' ? getSubmissionThumbnailImage(submission) : getSubmissionDisplayImage(submission);
    if (image) {
      images.push({
        key: getSubmissionImageCacheKey(submission, usage, image),
        url: image,
      });
    }
    return images;
  }, []);
}

function getSubmissionDisplayImage(submission: DropSubmission) {
  return getNonEmptyString(submission.display_image_url) || getNonEmptyString(submission.thumbnail_image_url) || getNonEmptyString(submission.image_url);
}

function getSubmissionThumbnailImage(submission: DropSubmission) {
  return getNonEmptyString(submission.thumbnail_image_url) || getNonEmptyString(submission.image_url);
}

function getSubmissionImageCacheKey(submission: DropSubmission, usage: 'display' | 'thumbnail', fallbackUrl: string) {
  if (usage === 'thumbnail') {
    return submission.thumbnail_storage_path?.trim() || submission.display_storage_path?.trim() || submission.storage_path?.trim() || fallbackUrl;
  }

  return submission.display_storage_path?.trim() || submission.storage_path?.trim() || fallbackUrl;
}

async function prefetchDropImageUrls(images: PrefetchImage[], timeoutMs: number) {
  const imageByKey = new Map(images.map((image) => [image.key, image.url]));
  const nextImages = [...imageByKey.entries()].filter(([key]) => !prefetchedImageKeys.has(key) && !prefetchingImageKeys.has(key));
  if (nextImages.length === 0) {
    return;
  }

  nextImages.forEach(([key]) => prefetchingImageKeys.add(key));

  const prefetch = ExpoImage.prefetch(
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

  if (timeoutMs <= 0) {
    void prefetch;
    return;
  }

  await Promise.race([prefetch, wait(timeoutMs)]);
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

  return current.every(
    (submission, index) =>
      submission.id === next[index]?.id &&
      submission.image_url === next[index]?.image_url &&
      submission.display_image_url === next[index]?.display_image_url &&
      submission.display_storage_path === next[index]?.display_storage_path &&
      submission.thumbnail_image_url === next[index]?.thumbnail_image_url &&
      submission.thumbnail_storage_path === next[index]?.thumbnail_storage_path
  );
}

function getNonEmptyString(value: string | null | undefined) {
  return value?.trim() || undefined;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRealtimePayloadUserId(payload: { new?: unknown; old?: unknown }) {
  const next = payload.new && typeof payload.new === 'object' ? (payload.new as { user_id?: unknown }).user_id : null;
  if (typeof next === 'string') {
    return next;
  }

  const previous = payload.old && typeof payload.old === 'object' ? (payload.old as { user_id?: unknown }).user_id : null;
  return typeof previous === 'string' ? previous : null;
}
