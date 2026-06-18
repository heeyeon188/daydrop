import { supabase } from '@/lib/supabase';
import { normalizeLanguage, type Language } from '@/lib/i18n';
import type { Profile } from '@/types/daydrop';

export type ProfileInput = {
  displayName: string;
  country: string;
  city: string;
  preferredLanguage: Language;
};

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) {
    throw error;
  }
  return data as Profile | null;
}

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

export async function completeProfile(input: ProfileInput): Promise<Profile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('not_authenticated');
  }

  const appleUser = isAppleUser(user.app_metadata);
  const metadataDisplayName = typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name.trim() : '';
  const displayName = input.displayName.trim() || (appleUser ? metadataDisplayName || 'User' : '');
  const country = input.country.trim();
  const city = input.city.trim();
  const timezone = getDeviceTimezone();
  const preferredLanguage = normalizeLanguage(input.preferredLanguage);

  if (!displayName && !appleUser) {
    throw new Error('display_name_required');
  }

  if (!country) {
    throw new Error('country_required');
  }

  if (!city) {
    throw new Error('city_required');
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        city,
        country,
        display_name: displayName,
        id: user.id,
        preferred_language: preferredLanguage,
        profile_completed: true,
        timezone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  const profile = data as Profile;

  const { data: members, error: memberLookupError } = await supabase.from('couple_members').select('id').eq('user_id', user.id);

  if (memberLookupError) {
    console.warn(memberLookupError.message);
    return profile;
  }

  if (!members?.length) {
    return profile;
  }

  const { error: memberUpdateError } = await supabase
    .from('couple_members')
    .update({
      city: profile.city,
      country: profile.country,
      display_name: profile.display_name,
      timezone: profile.timezone ?? null,
    })
    .eq('user_id', user.id);

  if (memberUpdateError) {
    console.warn(memberUpdateError.message);
  }

  return profile;
}

function isAppleUser(appMetadata: Record<string, unknown>) {
  const providers = appMetadata.providers;
  return appMetadata.provider === 'apple' || (Array.isArray(providers) && providers.includes('apple'));
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
