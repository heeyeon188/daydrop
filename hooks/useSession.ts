import type { Session } from '@supabase/supabase-js';
import React from 'react';

import { supabase, supabaseConfigError } from '@/lib/supabase';

export function useSession() {
  const [session, setSession] = React.useState<Session | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;

    if (supabaseConfigError) {
      setLoading(false);
      return;
    }

    async function loadSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (mounted) {
          setSession(data.session);
        }
      } catch {
        // Keep the existing null session state when the initial session lookup fails.
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) {
        return;
      }
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    loading,
    user: session?.user ?? null,
    configError: supabaseConfigError,
  };
}
