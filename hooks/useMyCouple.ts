import React from 'react';

import { getMyCouple, type MyCouple } from '@/services/couple';

export function useMyCouple(enabled: boolean) {
  const [couple, setCouple] = React.useState<MyCouple | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!enabled) {
      setCouple(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setCouple(await getMyCouple());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '커플 정보를 불러오지 못했어요.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    couple,
    loading,
    error,
    refetch,
  };
}
