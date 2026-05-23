import { supabase } from '@/lib/supabase';
import { notifyPartnerPhotoSubmitted } from '@/services/notifications';
import { createPhotoSignedUrl, uploadDropImage } from '@/services/storage';
import type { DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

export async function getOrCreateTodayDrop(): Promise<TodayDropPayload> {
  const { data, error } = await supabase.rpc('get_or_create_today_drop');
  if (error) {
    throw error;
  }
  return signTodayPhotoUrls(data as TodayDropPayload);
}

export async function submitDropPhoto({
  base64,
  coupleId,
  dropId,
  userId,
}: {
  base64: string;
  coupleId: string;
  dropId: string;
  userId: string;
}) {
  const uploaded = await uploadDropImage({ base64, coupleId, dropId, userId });

  const { data, error } = await supabase
    .from('drop_submissions')
    .insert({
      drop_id: dropId,
      couple_id: coupleId,
      user_id: userId,
      image_url: uploaded.imageUrl,
      storage_path: uploaded.storagePath,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  await notifyPartnerPhotoSubmitted(coupleId, userId);

  return data as DropSubmission;
}

type DeleteMyTodayDropPhotoResult = {
  deleted: boolean;
  drop_id?: string;
  storage_path?: string;
};

type DeleteMyTodayDropPhotoTarget = {
  drop_id: string;
  storage_path: string;
};

export async function deleteMyTodayDropPhoto({
  currentDropId,
  currentUserId,
}: {
  currentDropId?: string | null;
  currentUserId?: string | null;
} = {}) {
  const getTargetRpcName = 'get_my_today_drop_photo_to_delete';
  const getTargetRpcParams = null;

  console.log('deleteMyTodayDropPhoto start');
  console.log('current drop id', currentDropId ?? null);
  console.log('current user id', currentUserId ?? null);
  console.log('deleteMyTodayDropPhoto rpc name', getTargetRpcName);
  console.log('deleteMyTodayDropPhoto rpc params', getTargetRpcParams);

  const { data, error } = await supabase.rpc(getTargetRpcName);

  console.log('rpc result', data ?? null);
  console.log('rpc error', error ?? null);

  if (error) {
    console.error('deleteMyTodayDropPhoto rpc failed', error);
    throw error;
  }

  const target = data as DeleteMyTodayDropPhotoTarget | null;
  const storagePath = target?.storage_path;

  if (!storagePath) {
    throw new Error('missing_storage_path');
  }

  console.log('[delete] target storage path', storagePath);

  const { data: removeData, error: removeError } = await supabase.storage.from('daydrop-photos').remove([storagePath]);

  console.log('[delete] storage remove result', removeData ?? null, removeError ?? null);

  if (removeError) {
    console.error('[delete] storage remove failed', removeError);
    throw removeError;
  }

  const deleteRowRpcName = 'delete_my_today_drop_photo_row';
  const deleteRowRpcParams = { target_storage_path: storagePath };
  const { data: deleteData, error: deleteError } = await supabase.rpc(deleteRowRpcName, deleteRowRpcParams);

  console.log('[delete] db delete result', deleteData ?? null, deleteError ?? null);

  if (deleteError) {
    console.error('[delete] db delete failed', deleteError);
    throw deleteError;
  }

  return (deleteData ?? { deleted: false, drop_id: target?.drop_id, storage_path: storagePath }) as DeleteMyTodayDropPhotoResult;
}

export async function getRecentDrops(coupleId: string): Promise<RecentDrop[]> {
  const { data, error } = await supabase
    .from('daily_drops')
    .select(
      `
      *,
      mission:missions(prompt_ko, prompt_en),
      drop_submissions(*)
    `
    )
    .eq('couple_id', coupleId)
    .order('drop_date', { ascending: false })
    .limit(10);

  if (error) {
    throw error;
  }

  return Promise.all(((data ?? []) as RecentDrop[]).map(signRecentPhotoUrls));
}

async function signTodayPhotoUrls(payload: TodayDropPayload) {
  return {
    ...payload,
    submissions: await Promise.all(payload.submissions.map(signSubmissionUrl)),
  };
}

async function signRecentPhotoUrls(drop: RecentDrop) {
  return {
    ...drop,
    drop_submissions: await Promise.all(drop.drop_submissions.map(signSubmissionUrl)),
  };
}

async function signSubmissionUrl<T extends { storage_path: string; image_url: string }>(submission: T) {
  try {
    return {
      ...submission,
      image_url: await createPhotoSignedUrl(submission.storage_path),
    };
  } catch {
    return submission;
  }
}
