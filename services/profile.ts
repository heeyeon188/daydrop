import { supabase } from '@/lib/supabase';
import { normalizeLanguage, type Language } from '@/lib/i18n';
import type { Profile } from '@/types/daydrop';

export type ProfileInput = {
  displayName: string;
  country: string;
  city: string;
  timezone: string;
  preferredLanguage: Language;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) {
    throw error;
  }
  return data as Profile | null;
}

export async function completeProfile(input: ProfileInput): Promise<Profile> {
  const { data, error } = await supabase.rpc('complete_profile', {
    p_display_name: input.displayName.trim(),
    p_country: input.country.trim(),
    p_city: input.city.trim(),
    p_timezone: input.timezone.trim(),
    p_preferred_language: normalizeLanguage(input.preferredLanguage),
  });

  if (error) {
    throw error;
  }

  return data as Profile;
}

export async function updatePreferredLanguage(language: Language): Promise<Profile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('not_authenticated');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ preferred_language: language, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data as Profile;
}
