import { supabase } from '@/lib/supabase';
import { notifyPartnerPhotoSubmitted } from '@/services/notifications';
import { createPhotoSignedUrl, uploadDropImage } from '@/services/storage';
import type { DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const RECENT_DROPS_LIMIT = 10;
const RECENT_DROPS_QUERY_LIMIT = 30;

export async function getOrCreateTodayDrop(): Promise<TodayDropPayload> {
  const { data, error } = await supabase.rpc('get_or_create_today_drop');
  if (error) {
    throw error;
  }
  const payload = data as TodayDropPayload;
  console.log('[today_drop] selected mission', {
    coupleId: payload.daily_drop.couple_id,
    missionType: payload.mission?.mission_type ?? null,
    relationshipType: payload.couple?.partner_type ?? null,
  });
  return signTodayPhotoUrls(payload);
}

export async function submitDropPhoto({
  base64,
  coupleId,
  dropId,
  fileInfo,
  userId,
}: {
  base64: string;
  coupleId: string;
  dropId: string;
  fileInfo?: {
    base64Used?: boolean;
    capturedUri?: string;
    compressApplied?: boolean;
    height: number;
    originalHeight?: number;
    originalWidth?: number;
    reencodeApplied?: boolean;
    resizeApplied?: boolean;
    uploadUri?: string;
    uri: string;
    width: number;
  };
  userId: string;
}) {
  console.log('[photo] submit drop photo', {
    coupleId,
    dropId,
    userId,
    fileInfo,
  });

  const uploaded = await uploadDropImage({
    base64,
    coupleId,
    dropId,
    fileInfo: fileInfo
      ? {
          base64Used: fileInfo.base64Used,
          capturedUri: fileInfo.capturedUri ?? fileInfo.uri,
          compressApplied: fileInfo.compressApplied,
          height: fileInfo.height,
          originalHeight: fileInfo.originalHeight,
          originalWidth: fileInfo.originalWidth,
          reencodeApplied: fileInfo.reencodeApplied,
          resizeApplied: fileInfo.resizeApplied,
          uploadUri: fileInfo.uploadUri ?? fileInfo.uri,
          width: fileInfo.width,
        }
      : undefined,
    userId,
  });

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

  console.log('[photo] drop submission saved', {
    id: data.id,
    storagePath: uploaded.storagePath,
    imageUrl: uploaded.imageUrl,
    fileInfo,
  });

  void notifyPartnerPhotoSubmitted({
    coupleId,
    dropSubmissionId: data.id,
  });

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

  const { data, error } = await supabase.rpc(getTargetRpcName);

  if (error) {
    console.error('deleteMyTodayDropPhoto rpc failed', error, { currentDropId, currentUserId });
    throw error;
  }

  const target = data as DeleteMyTodayDropPhotoTarget | null;
  const storagePath = target?.storage_path;

  if (!storagePath) {
    throw new Error('missing_storage_path');
  }

  const { data: removeData, error: removeError } = await supabase.storage.from('daydrop-photos').remove([storagePath]);

  if (removeError) {
    console.error('[delete] storage remove failed', removeError, removeData);
    throw removeError;
  }

  const deleteRowRpcName = 'delete_my_today_drop_photo_row';
  const deleteRowRpcParams = { target_storage_path: storagePath };
  const { data: deleteData, error: deleteError } = await supabase.rpc(deleteRowRpcName, deleteRowRpcParams);

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
    .limit(RECENT_DROPS_QUERY_LIMIT);

  if (error) {
    throw error;
  }

  const dropsWithPhotos = ((data ?? []) as RecentDrop[])
    .map((drop) => ({
      ...drop,
      drop_submissions: drop.drop_submissions.filter(hasSubmissionPhoto),
    }))
    .filter((drop) => drop.drop_submissions.length > 0)
    .slice(0, RECENT_DROPS_LIMIT);

  return Promise.all(dropsWithPhotos.map(signRecentPhotoUrls));
}

async function signTodayPhotoUrls(payload: TodayDropPayload) {
  return {
    ...payload,
    submissions: await signSubmissionUrls(payload.submissions),
  };
}

async function signRecentPhotoUrls(drop: RecentDrop) {
  return {
    ...drop,
    drop_submissions: await signSubmissionUrls(drop.drop_submissions),
  };
}

function hasSubmissionPhoto(submission: Pick<DropSubmission, 'image_url' | 'storage_path'>) {
  return Boolean(submission.image_url?.trim() || submission.storage_path?.trim());
}

async function signSubmissionUrls<T extends { storage_path: string; image_url: string }>(submissions: T[]) {
  const signedUrlByPath = new Map<string, Promise<string>>();

  return Promise.all(
    submissions.map((submission) => {
      if (!submission.storage_path?.trim()) {
        return submission;
      }

      if (!signedUrlByPath.has(submission.storage_path)) {
        signedUrlByPath.set(submission.storage_path, createPhotoSignedUrl(submission.storage_path));
      }
      return signSubmissionUrl(submission, signedUrlByPath.get(submission.storage_path)!);
    })
  );
}

async function signSubmissionUrl<T extends { storage_path: string; image_url: string }>(submission: T, signedUrl: Promise<string>) {
  try {
    return {
      ...submission,
      image_url: await signedUrl,
    };
  } catch {
    return submission;
  }
}
