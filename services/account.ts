import { supabase } from '@/lib/supabase';
import { deletePhotoStorageFiles } from '@/services/storage';

export async function deleteAccount() {
  return invokeDeleteAccountFunction();
}

export async function deleteMyUploadedPhotosForAccountDeletion(userId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error('[account] uploaded photo cleanup auth lookup failed', userError);
    throw userError ?? new Error('not_authenticated');
  }

  if (user.id !== userId) {
    console.error('[account] blocked uploaded photo cleanup for another user', { authUserId: user.id, requestedUserId: userId });
    throw new Error('not_photo_owner');
  }

  const { data, error } = await supabase
    .from('drop_submissions')
    .select('storage_path, display_storage_path, thumbnail_storage_path')
    .eq('user_id', user.id);
  if (error) {
    console.error('[account] uploaded photo path lookup failed', error, { userId: user.id });
    throw error;
  }

  const paths = (data ?? [])
    .flatMap((submission) => [submission.storage_path, submission.display_storage_path, submission.thumbnail_storage_path])
    .filter((path): path is string => Boolean(path));
  await deletePhotoStorageFiles(paths);

  return { deletedStorageFileCount: paths.length };
}

async function invokeDeleteAccountFunction() {
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
