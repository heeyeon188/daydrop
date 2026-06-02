import { supabase } from '@/lib/supabase';
import { notifyPartnerPhotoSubmitted } from '@/services/notifications';
import {
  createPhotoSignedUrl,
  deletePhotoStorageFiles,
  extractStoragePathFromUrl,
  uploadDropImage,
} from '@/services/storage';
import type { DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const RECENT_DROPS_LIMIT = 10;
const RECENT_DROPS_QUERY_LIMIT = 30;

export async function getOrCreateTodayDrop(): Promise<TodayDropPayload> {
  const { data, error } = await supabase.rpc('get_or_create_today_drop');
  if (error) {
    throw error;
  }
  const payload = data as TodayDropPayload;
  if (__DEV__) {
    console.log('[today_drop] selected mission', {
      coupleId: payload.daily_drop.couple_id,
      missionType: payload.mission?.mission_type ?? null,
      relationshipType: payload.couple?.partner_type ?? null,
    });
  }
  return signTodayPhotoUrls(payload);
}

export async function submitDropPhoto({
  base64,
  coupleId,
  dropId,
  fileInfo,
  shouldNotifyPartner = true,
  userId,
}: {
  base64: string;
  coupleId?: string | null;
  dropId: string;
  fileInfo?: {
    base64Used?: boolean;
    capturedUri?: string;
    compressApplied?: boolean;
    height: number;
    mimeType?: string;
    originalHeight?: number;
    originalWidth?: number;
    reencodeApplied?: boolean;
    resizeApplied?: boolean;
    uploadUri?: string;
    uri: string;
    width: number;
  };
  shouldNotifyPartner?: boolean;
  userId: string;
}) {
  if (!coupleId) {
    throw new Error('missing_couple_id');
  }

  if (__DEV__) {
    console.log('[photo] submit drop photo', {
      coupleId,
      dropId,
      userId,
      fileInfo,
    });
  }

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
          mimeType: fileInfo.mimeType,
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
      display_image_url: uploaded.displayImageUrl,
      display_storage_path: uploaded.displayStoragePath,
      image_url: uploaded.imageUrl,
      storage_path: uploaded.storagePath,
    })
    .select('*')
    .single();

  if (error) {
    await deletePhotoStorageFiles([uploaded.storagePath, uploaded.displayStoragePath].filter((path): path is string => Boolean(path))).catch((cleanupError) => {
      console.error('[photo] uploaded storage cleanup failed after db insert error', {
        displayStoragePath: uploaded.displayStoragePath,
        storagePath: uploaded.storagePath,
        error: cleanupError,
      });
    });
    throw error;
  }

  if (__DEV__) {
    console.log('[photo] drop submission saved', {
      id: data.id,
      displayImageUrl: uploaded.displayImageUrl,
      displayStoragePath: uploaded.displayStoragePath,
      storagePath: uploaded.storagePath,
      imageUrl: uploaded.imageUrl,
      fileInfo,
    });
  }

  if (shouldNotifyPartner) {
    void notifyPartnerPhotoSubmitted({
      coupleId,
      dropSubmissionId: data.id,
    });
  }

  return data as DropSubmission;
}

type DeleteMyTodayDropPhotoResult = {
  deleted: boolean;
  display_storage_path?: string | null;
  drop_id?: string;
  storage_path?: string;
};

type DeleteMyTodayDropPhotoTarget = {
  display_storage_path?: string | null;
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

  await deletePhotoStorageFiles([storagePath, target?.display_storage_path].filter((path): path is string => Boolean(path)));

  const deleteRowRpcName = 'delete_my_today_drop_photo_row';
  const deleteRowRpcParams = { target_storage_path: storagePath };
  const { data: deleteData, error: deleteError } = await supabase.rpc(deleteRowRpcName, deleteRowRpcParams);

  if (deleteError) {
    console.error('[delete] db delete failed', deleteError);
    throw deleteError;
  }

  return (deleteData ?? {
    deleted: false,
    display_storage_path: target?.display_storage_path ?? null,
    drop_id: target?.drop_id,
    storage_path: storagePath,
  }) as DeleteMyTodayDropPhotoResult;
}

export async function deletePhotoSubmission(submissionId: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error('[delete] submission delete auth lookup failed', userError);
    throw userError ?? new Error('not_authenticated');
  }

  const { data: submission, error: lookupError } = await supabase
    .from('drop_submissions')
    .select('id, user_id, storage_path, image_url, display_storage_path')
    .eq('id', submissionId)
    .maybeSingle();

  if (lookupError) {
    console.error('[delete] submission lookup failed', lookupError, { submissionId, userId: user.id });
    throw lookupError;
  }

  if (!submission) {
    throw new Error('photo_not_found');
  }

  if (submission.user_id !== user.id) {
    console.error('[delete] blocked non-owner submission delete', { submissionId, ownerId: submission.user_id, userId: user.id });
    throw new Error('not_photo_owner');
  }

  const storagePath = submission.storage_path?.trim() || extractStoragePathFromUrl(submission.image_url)?.trim();
  if (!storagePath) {
    throw new Error('missing_storage_path');
  }

  await deletePhotoStorageFiles([storagePath, submission.display_storage_path].filter((path): path is string => Boolean(path)));

  const { data: deleteData, error: deleteError } = await supabase.rpc('delete_my_drop_submission_photo_row', {
    target_storage_path: storagePath,
    target_submission_id: submissionId,
  });

  if (deleteError) {
    console.error('[delete] submission row delete failed', deleteError, { submissionId, storagePath, userId: user.id });
    throw deleteError;
  }

  return deleteData as DeleteMyTodayDropPhotoResult;
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

async function signSubmissionUrls<T extends { display_image_url?: string | null; display_storage_path?: string | null; storage_path: string; image_url: string }>(
  submissions: T[]
) {
  const signedUrlByPath = new Map<string, Promise<string>>();

  return Promise.all(
    submissions.map((submission) => {
      if (!submission.storage_path?.trim()) {
        return submission;
      }

      if (!signedUrlByPath.has(submission.storage_path)) {
        signedUrlByPath.set(submission.storage_path, createPhotoSignedUrl(submission.storage_path));
      }
      if (submission.display_storage_path?.trim() && !signedUrlByPath.has(submission.display_storage_path)) {
        signedUrlByPath.set(submission.display_storage_path, createPhotoSignedUrl(submission.display_storage_path));
      }
      return signSubmissionUrl(
        submission,
        signedUrlByPath.get(submission.storage_path)!,
        submission.display_storage_path?.trim() ? signedUrlByPath.get(submission.display_storage_path) : undefined
      );
    })
  );
}

async function signSubmissionUrl<T extends { display_image_url?: string | null; display_storage_path?: string | null; storage_path: string; image_url: string }>(
  submission: T,
  signedUrl: Promise<string>,
  displaySignedUrl?: Promise<string>
) {
  try {
    const imageUrl = await signedUrl;
    let displayImageUrl = submission.display_image_url ?? null;
    if (displaySignedUrl) {
      try {
        displayImageUrl = await displaySignedUrl;
      } catch {
        displayImageUrl = null;
      }
    }

    return {
      ...submission,
      display_image_url: displayImageUrl,
      image_url: imageUrl,
    };
  } catch {
    return submission;
  }
}
