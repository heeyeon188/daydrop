import { supabase } from '@/lib/supabase';

export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account');

  if (error) {
    console.error('delete-account function failed', error);
    throw new Error(error.message || 'delete_account_failed');
  }

  if (!data || (typeof data === 'object' && 'ok' in data && !data.ok)) {
    throw new Error('delete_account_failed');
  }

  return data as { ok: true };
}
