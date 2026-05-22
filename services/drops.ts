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

export async function getRecentDrops(coupleId: string): Promise<RecentDrop[]> {
  const { data, error } = await supabase
    .from('daily_drops')
    .select(
      `
      *,
      mission:missions(prompt_ko),
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
