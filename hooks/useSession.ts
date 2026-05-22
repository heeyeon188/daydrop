import type { Session } from '@supabase/supabase-js';
import React from 'react';

import { supabase, supabaseConfigError } from '@/lib/supabase';

export function useSession() {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return {
    session,
    loading,
    user: session?.user ?? null,
    configError: supabaseConfigError,
  };
}
