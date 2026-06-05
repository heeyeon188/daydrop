import { supabase } from '@/lib/supabase';
import { notifyPartnerPhotoSubmitted } from '@/services/notifications';
import {
  createPhotoSignedUrl,
  deletePhotoStorageFiles,
  extractStoragePathFromUrl,
  uploadDropDisplayImage,
  uploadDropImage,
  uploadDropThumbnailImage,
  type DropImageFileInfo,
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
  onDisplayImageReady,
  shouldNotifyPartner = true,
  userId,
}: {
  base64?: string | null;
  coupleId?: string | null;
  dropId: string;
  fileInfo?: DropImageFileInfo & { uri: string };
  onDisplayImageReady?: (submission: DropSubmission) => void;
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

  if (__DEV__) {
    console.time('[photo] DB insert');
  }
  const insertResult = await (async () => {
    try {
      return await supabase
        .from('drop_submissions')
        .insert({
          drop_id: dropId,
          couple_id: coupleId,
          user_id: userId,
          display_image_url: null,
          display_storage_path: null,
          image_url: uploaded.imageUrl,
          storage_path: uploaded.storagePath,
          thumbnail_image_url: null,
          thumbnail_storage_path: null,
        })
        .select('*')
        .single();
    } finally {
      if (__DEV__) {
        console.timeEnd('[photo] DB insert');
      }
    }
  })();
  const { data, error } = insertResult;

  if (error) {
    await deletePhotoStorageFiles([uploaded.storagePath]).catch((cleanupError) => {
      console.error('[photo] uploaded storage cleanup failed after db insert error', {
        storagePath: uploaded.storagePath,
        error: cleanupError,
      });
    });
    throw error;
  }

  if (__DEV__) {
    console.log('[photo] drop submission saved', {
      id: data.id,
      displayImageUrl: null,
      displayStoragePath: null,
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

  void uploadAndAttachOptimizedImages({
    displayStoragePath: uploaded.displayStoragePath,
    fileInfo,
    onDisplayImageReady,
    submission: data as DropSubmission,
    thumbnailStoragePath: uploaded.thumbnailStoragePath,
  });

  return data as DropSubmission;
}

async function uploadAndAttachOptimizedImages({
  displayStoragePath,
  fileInfo,
  onDisplayImageReady,
  submission,
  thumbnailStoragePath,
}: {
  displayStoragePath: string;
  fileInfo?: DropImageFileInfo;
  onDisplayImageReady?: (submission: DropSubmission) => void;
  submission: DropSubmission;
  thumbnailStoragePath: string;
}) {
  let uploadedDisplay: Awaited<ReturnType<typeof uploadDropDisplayImage>> = null;
  let uploadedThumbnail: Awaited<ReturnType<typeof uploadDropThumbnailImage>> = null;

  try {
    const [displayResult, thumbnailResult] = await Promise.allSettled([
      uploadDropDisplayImage({
        displayStoragePath,
        fileInfo,
      }),
      uploadDropThumbnailImage({
        fileInfo,
        thumbnailStoragePath,
      }),
    ]);

    if (displayResult.status === 'fulfilled') {
      uploadedDisplay = displayResult.value;
    } else {
      console.warn('[photo] display image upload failed; using original image for display fallback', {
        displayStoragePath,
        error: displayResult.reason,
      });
    }

    if (thumbnailResult.status === 'fulfilled') {
      uploadedThumbnail = thumbnailResult.value;
    } else {
      console.warn('[photo] thumbnail image upload failed; using display/original image for thumbnail fallback', {
        thumbnailStoragePath,
        error: thumbnailResult.reason,
      });
    }

    if (!uploadedDisplay && !uploadedThumbnail) {
      return;
    }

    if (__DEV__) {
      console.time('[photo] DB optimized image update');
    }
    const updateResult = await (async () => {
      try {
        return await supabase
          .from('drop_submissions')
          .update({
            display_image_url: uploadedDisplay?.displayImageUrl ?? submission.display_image_url ?? null,
            display_storage_path: uploadedDisplay?.displayStoragePath ?? submission.display_storage_path ?? null,
            thumbnail_image_url: uploadedThumbnail?.thumbnailImageUrl ?? submission.thumbnail_image_url ?? null,
            thumbnail_storage_path: uploadedThumbnail?.thumbnailStoragePath ?? submission.thumbnail_storage_path ?? null,
          })
          .eq('id', submission.id)
          .select('*')
          .maybeSingle();
      } finally {
        if (__DEV__) {
          console.timeEnd('[photo] DB optimized image update');
        }
      }
    })();
    const { data, error } = updateResult;

    if (error) {
      throw error;
    }

    if (!data) {
      await deletePhotoStorageFiles(
        [uploadedDisplay?.displayStoragePath, uploadedThumbnail?.thumbnailStoragePath].filter((path): path is string => Boolean(path))
      );
      return;
    }

    onDisplayImageReady?.(data as DropSubmission);
  } catch (optimizedError) {
    console.warn('[photo] optimized image background update failed; using original image fallbacks', {
      displayStoragePath,
      thumbnailStoragePath,
      error: optimizedError,
    });
    const cleanupPaths = [uploadedDisplay?.displayStoragePath, uploadedThumbnail?.thumbnailStoragePath].filter((path): path is string => Boolean(path));
    if (cleanupPaths.length) {
      await deletePhotoStorageFiles(cleanupPaths).catch((cleanupError) => {
        console.error('[photo] optimized image cleanup failed after background update error', {
          paths: cleanupPaths,
          error: cleanupError,
        });
      });
    }
  }
}

type DeleteMyTodayDropPhotoResult = {
  deleted: boolean;
  display_storage_path?: string | null;
  drop_id?: string;
  storage_path?: string;
  thumbnail_storage_path?: string | null;
};

type DeleteMyTodayDropPhotoTarget = {
  display_storage_path?: string | null;
  drop_id: string;
  storage_path: string;
  thumbnail_storage_path?: string | null;
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

  await deletePhotoStorageFiles([storagePath, target?.display_storage_path, target?.thumbnail_storage_path].filter((path): path is string => Boolean(path)));

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
    thumbnail_storage_path: target?.thumbnail_storage_path ?? null,
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
    .select('id, user_id, storage_path, image_url, display_storage_path, thumbnail_storage_path')
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

  await deletePhotoStorageFiles([storagePath, submission.display_storage_path, submission.thumbnail_storage_path].filter((path): path is string => Boolean(path)));

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
    submissions: await signSubmissionUrls(payload.submissions, { signOriginal: 'always' }),
  };
}

async function signRecentPhotoUrls(drop: RecentDrop) {
  return {
    ...drop,
    drop_submissions: await signSubmissionUrls(drop.drop_submissions, { signOriginal: 'fallback' }),
  };
}

function hasSubmissionPhoto(submission: Pick<DropSubmission, 'image_url' | 'storage_path'>) {
  return Boolean(submission.image_url?.trim() || submission.storage_path?.trim());
}

async function signSubmissionUrls<
  T extends {
    display_image_url?: string | null;
    display_storage_path?: string | null;
    image_url: string;
    storage_path: string;
    thumbnail_image_url?: string | null;
    thumbnail_storage_path?: string | null;
  },
>(
  submissions: T[],
  options: { signOriginal: 'always' | 'fallback' }
) {
  const signedUrlByPath = new Map<string, Promise<string>>();

  return Promise.all(
    submissions.map((submission) => {
      const displayPath = submission.display_storage_path?.trim();
      const thumbnailPath = submission.thumbnail_storage_path?.trim();
      const shouldSignOriginal = options.signOriginal === 'always' || (!displayPath && !thumbnailPath);

      if (!shouldSignOriginal && !displayPath && !thumbnailPath) {
        return submission;
      }

      const storagePath = submission.storage_path?.trim();
      if (shouldSignOriginal && storagePath && !signedUrlByPath.has(storagePath)) {
        signedUrlByPath.set(storagePath, createPhotoSignedUrl(storagePath));
      }
      if (displayPath && !signedUrlByPath.has(displayPath)) {
        signedUrlByPath.set(displayPath, createPhotoSignedUrl(displayPath));
      }
      if (thumbnailPath && !signedUrlByPath.has(thumbnailPath)) {
        signedUrlByPath.set(thumbnailPath, createPhotoSignedUrl(thumbnailPath));
      }
      return signSubmissionUrl(
        submission,
        shouldSignOriginal && storagePath ? signedUrlByPath.get(storagePath) : undefined,
        displayPath ? signedUrlByPath.get(displayPath) : undefined,
        thumbnailPath ? signedUrlByPath.get(thumbnailPath) : undefined
      );
    })
  );
}

async function signSubmissionUrl<
  T extends {
    display_image_url?: string | null;
    display_storage_path?: string | null;
    image_url: string;
    storage_path: string;
    thumbnail_image_url?: string | null;
    thumbnail_storage_path?: string | null;
  },
>(
  submission: T,
  signedUrl?: Promise<string>,
  displaySignedUrl?: Promise<string>,
  thumbnailSignedUrl?: Promise<string>
) {
  try {
    let imageUrl = submission.image_url;
    let displayImageUrl = submission.display_image_url ?? null;
    let thumbnailImageUrl = submission.thumbnail_image_url ?? null;
    if (signedUrl) {
      imageUrl = await signedUrl;
    }
    if (displaySignedUrl) {
      try {
        displayImageUrl = await displaySignedUrl;
      } catch {
        displayImageUrl = null;
      }
    }
    if (thumbnailSignedUrl) {
      try {
        thumbnailImageUrl = await thumbnailSignedUrl;
      } catch {
        thumbnailImageUrl = null;
      }
    }

    return {
      ...submission,
      display_image_url: displayImageUrl,
      image_url: imageUrl,
      thumbnail_image_url: thumbnailImageUrl,
    };
  } catch {
    return submission;
  }
}
