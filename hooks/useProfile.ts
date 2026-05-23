import React from 'react';

import { getMyProfile } from '@/services/profile';
import type { Profile } from '@/types/daydrop';

export function useProfile(userId?: string | null) {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!userId) {
      setProfile(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setProfile(await getMyProfile(userId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    error,
    loading,
    profile,
    refetch,
    setProfile,
  };
}
