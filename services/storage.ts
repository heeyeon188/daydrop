import { decode } from 'base64-arraybuffer';
import { File } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

export const DROP_PHOTOS_BUCKET = 'daydrop-photos';
const DISPLAY_MAX_LONG_EDGE = 2048;
const DISPLAY_JPEG_QUALITY = 0.9;
const THUMBNAIL_MAX_LONG_EDGE = 640;
const THUMBNAIL_JPEG_QUALITY = 0.84;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { expiresAt: number; url: string }>();
const signedUrlInFlightCache = new Map<string, Promise<string>>();
export type CameraFacing = 'front' | 'back';
type PickedImageSource = 'library' | CameraFacing;
export type DaydropPhotoAsset = {
  base64?: string | null;
  compressed?: boolean;
  exif?: Record<string, unknown> | null;
  height: number;
  mimeType?: string;
  reencoded?: boolean;
  resized?: boolean;
  uri: string;
  uploadUri?: string;
  width: number;
};

export type DropImageFileInfo = {
  capturedUri?: string;
  height: number;
  mimeType?: string;
  uploadUri?: string;
  width: number;
  originalHeight?: number;
  originalWidth?: number;
  base64Used?: boolean;
  compressApplied?: boolean;
  resizeApplied?: boolean;
  reencodeApplied?: boolean;
};

type NormalizedPhotoAsset = DaydropPhotoAsset & {
  compressed?: boolean;
  didFlip?: boolean;
  mirrorMode?: MirrorMode;
  reencoded?: boolean;
  resized?: boolean;
  uploadUri?: string;
};

type MirrorMode = 'none' | 'front-preview-match' | 'exif-mirrored';

const imagePickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 1,
};

export async function pickImageFromLibrary() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('photo_permission_denied');
  }

  const result = await ImagePicker.launchImageLibraryAsync(imagePickerOptions);

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset?.uri) {
    throw new Error('photo_read_failed');
  }

  return normalizePickedImage(asset, 'library');
}

export async function takePhotoWithCamera(cameraFacing: CameraFacing = 'front') {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('photo_permission_denied');
  }

  const result = await ImagePicker.launchCameraAsync({
    ...imagePickerOptions,
    cameraType: cameraFacing === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
  });

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset?.uri) {
    throw new Error('photo_read_failed');
  }

  return normalizePickedImage(asset, cameraFacing);
}

export async function normalizeCameraPhoto(asset: DaydropPhotoAsset, source: CameraFacing): Promise<NormalizedPhotoAsset> {
  return normalizePickedImage(
    {
      ...asset,
      exif: {
        ...(asset.exif ?? {}),
        daydropMirrorNormalized: source === 'front' ? true : asset.exif?.daydropMirrorNormalized,
      },
    },
    source,
    { flipFrontCameraByDefault: false }
  );
}

async function normalizePickedImage(
  asset: DaydropPhotoAsset,
  source: PickedImageSource,
  options: { flipFrontCameraByDefault: boolean } = { flipFrontCameraByDefault: true }
): Promise<NormalizedPhotoAsset> {
  const orientation = getExifOrientation(asset.exif);
  const alreadyMirrorNormalized = asset.exif?.daydropMirrorNormalized === true;
  const hasMirroredExif = hasMirroredOrientation(asset.exif);
  const shouldFlip =
    source === 'front' && options.flipFrontCameraByDefault && !alreadyMirrorNormalized && !hasMirroredExif;
  const mirrorMode: MirrorMode = shouldFlip ? 'front-preview-match' : hasMirroredExif ? 'exif-mirrored' : 'none';

  if (__DEV__) {
    console.log('[photo] picked image', {
      source,
      captureSource: source,
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      base64Used: Boolean(asset.base64),
      exifOrientation: orientation,
      mirrorMode,
      resizeApplied: false,
      compressApplied: false,
      reencodeApplied: false,
      flipApplied: shouldFlip,
    });
  }

  if (!shouldFlip) {
    return {
      ...asset,
      compressed: false,
      didFlip: false,
      mirrorMode,
      reencoded: false,
      resized: false,
      uploadUri: asset.uri,
    };
  }

  const image = await ImageManipulator.manipulate(asset.uri).flip(FlipType.Horizontal).renderAsync();
  const saved = await image.saveAsync({
    base64: false,
    compress: 1,
    format: SaveFormat.JPEG,
  });

  const normalized = {
    ...asset,
    base64: null,
    exif: {
      ...asset.exif,
      Orientation: 1,
      daydropCaptureSource: source,
      daydropMirrorNormalized: source === 'front',
    },
    height: saved.height,
    mimeType: 'image/jpeg',
    uri: saved.uri,
    width: saved.width,
    compressed: false,
    didFlip: shouldFlip,
    mirrorMode,
    reencoded: true,
    resized: saved.width !== asset.width || saved.height !== asset.height,
    uploadUri: saved.uri,
  };

  if (__DEV__) {
    console.log('[photo] normalized image', {
      source,
      captureSource: source,
      capturedUri: asset.uri,
      uri: normalized.uri,
      originalWidth: asset.width,
      originalHeight: asset.height,
      width: normalized.width,
      height: normalized.height,
      base64Used: Boolean(normalized.base64),
      exifOrientation: normalized.exif?.Orientation ?? null,
      resizeApplied: normalized.resized,
      compressApplied: false,
      reencodeApplied: normalized.reencoded,
      flipApplied: shouldFlip,
    });
  }

  return normalized;
}

function hasMirroredOrientation(exif: DaydropPhotoAsset['exif']) {
  const normalized = getExifOrientation(exif);
  return normalized === 2 || normalized === 4 || normalized === 5 || normalized === 7;
}

function getExifOrientation(exif: DaydropPhotoAsset['exif']) {
  const orientation = exif?.Orientation ?? exif?.orientation;
  const normalized = typeof orientation === 'string' ? Number.parseInt(orientation, 10) : orientation;
  return Number.isFinite(normalized) ? normalized : null;
}

export async function uploadDropImage({
  base64,
  coupleId,
  dropId,
  fileInfo,
  userId,
}: {
  base64?: string | null;
  coupleId: string;
  dropId: string;
  fileInfo?: DropImageFileInfo;
  userId: string;
}) {
  const timestamp = Date.now();
  const storagePath = `couples/${coupleId}/drops/${dropId}/${userId}-${timestamp}.jpg`;
  const displayStoragePath = `couples/${coupleId}/drops/${dropId}/display/${userId}-${timestamp}.jpg`;
  const thumbnailStoragePath = `couples/${coupleId}/drops/${dropId}/thumbnail/${userId}-${timestamp}.jpg`;
  let uploadData: ArrayBuffer | null = null;
  let base64Used = false;

  if (!uploadData && fileInfo?.uploadUri) {
    try {
      uploadData = await readFileAsArrayBuffer(fileInfo.uploadUri);
    } catch (error) {
      console.warn('[photo] original upload image read failed; falling back to original base64', {
        uri: fileInfo.uploadUri,
        error,
      });
    }
  }
  if (!uploadData) {
    if (!base64) {
      throw new Error('photo_read_failed');
    }
    uploadData = decode(base64);
    base64Used = true;
  }
  const finalUploadUri = fileInfo?.uploadUri ?? null;
  const finalUploadWidth = fileInfo?.width ?? null;
  const finalUploadHeight = fileInfo?.height ?? null;
  const originalContentType = getImageContentType(fileInfo?.mimeType);
  const uploadFileSize = finalUploadUri ? await getLocalFileSize(finalUploadUri) : null;

  if (__DEV__) {
    console.log('[photo] upload candidate', {
      capturedUri: fileInfo?.capturedUri ?? finalUploadUri,
      uploadUri: finalUploadUri,
      originalWidth: fileInfo?.originalWidth ?? fileInfo?.width ?? null,
      originalHeight: fileInfo?.originalHeight ?? fileInfo?.height ?? null,
      uploadWidth: finalUploadWidth,
      uploadHeight: finalUploadHeight,
      contentType: originalContentType,
      base64Used,
      compressApplied: false,
      resizeApplied: false,
      reencodeApplied: fileInfo?.reencodeApplied ?? false,
      fileSize: uploadFileSize,
      byteLength: uploadData.byteLength,
    });
  }

  if (__DEV__) {
    console.time('[photo] original storage upload');
  }
  const { error } = await supabase.storage
    .from(DROP_PHOTOS_BUCKET)
    .upload(storagePath, uploadData, {
      contentType: originalContentType,
      upsert: false,
    })
    .finally(() => {
      if (__DEV__) {
        console.timeEnd('[photo] original storage upload');
      }
    });

  if (error) {
    throw error;
  }

  if (__DEV__) {
    console.log('[photo] uploaded image', {
      bucket: DROP_PHOTOS_BUCKET,
      storagePath,
      contentType: originalContentType,
      byteLength: uploadData.byteLength,
      uploadWidth: finalUploadWidth,
      uploadHeight: finalUploadHeight,
      compressApplied: false,
      resizeApplied: false,
      reencodeApplied: fileInfo?.reencodeApplied ?? false,
    });
  }

  return {
    displayStoragePath,
    thumbnailStoragePath,
    storagePath,
    imageUrl: await createUploadImageUrl(storagePath),
  };
}

export async function uploadDropDisplayImage({
  displayStoragePath,
  fileInfo,
}: {
  displayStoragePath: string;
  fileInfo?: DropImageFileInfo;
}) {
  const displayUpload = await uploadOptimizedImage({
    fileInfo,
    maxLongEdge: DISPLAY_MAX_LONG_EDGE,
    quality: DISPLAY_JPEG_QUALITY,
    storagePath: displayStoragePath,
    timerName: 'display',
  });
  if (!displayUpload) {
    return null;
  }

  return {
    displayImageUrl: await createUploadImageUrl(displayUpload.storagePath),
    displayStoragePath: displayUpload.storagePath,
  };
}

export async function uploadDropThumbnailImage({
  fileInfo,
  thumbnailStoragePath,
}: {
  fileInfo?: DropImageFileInfo;
  thumbnailStoragePath: string;
}) {
  const thumbnailUpload = await uploadOptimizedImage({
    fileInfo,
    maxLongEdge: THUMBNAIL_MAX_LONG_EDGE,
    quality: THUMBNAIL_JPEG_QUALITY,
    storagePath: thumbnailStoragePath,
    timerName: 'thumbnail',
  });
  if (!thumbnailUpload) {
    return null;
  }

  return {
    thumbnailImageUrl: await createUploadImageUrl(thumbnailUpload.storagePath),
    thumbnailStoragePath: thumbnailUpload.storagePath,
  };
}

async function uploadOptimizedImage({
  fileInfo,
  maxLongEdge,
  quality,
  storagePath,
  timerName,
}: {
  fileInfo?: DropImageFileInfo;
  maxLongEdge: number;
  quality: number;
  storagePath: string;
  timerName: 'display' | 'thumbnail';
}) {
  const optimizedImage = await prepareOptimizedImage({
    fileInfo,
    maxLongEdge,
    quality,
    timerName,
  });
  if (!optimizedImage) {
    return null;
  }

  const imageData = await readFileAsArrayBuffer(optimizedImage.uri);
  if (__DEV__) {
    console.time(`[photo] ${timerName} upload`);
  }
  const { error } = await supabase.storage
    .from(DROP_PHOTOS_BUCKET)
    .upload(storagePath, imageData, {
      contentType: 'image/jpeg',
      upsert: false,
    })
    .finally(() => {
      if (__DEV__) {
        console.timeEnd(`[photo] ${timerName} upload`);
      }
    });

  if (error) {
    throw error;
  }

  if (__DEV__) {
    console.log(`[photo] uploaded ${timerName} image`, {
      bucket: DROP_PHOTOS_BUCKET,
      storagePath,
      contentType: 'image/jpeg',
      byteLength: imageData.byteLength,
      uploadWidth: optimizedImage.width,
      uploadHeight: optimizedImage.height,
      compressApplied: true,
      resizeApplied: optimizedImage.resizeApplied,
      reencodeApplied: true,
    });
  }

  return { storagePath };
}

async function prepareOptimizedImage({
  fileInfo,
  maxLongEdge,
  quality,
  timerName,
}: {
  fileInfo?: DropImageFileInfo;
  maxLongEdge: number;
  quality: number;
  timerName: 'display' | 'thumbnail';
}) {
  const sourceUri = fileInfo?.uploadUri;
  if (!sourceUri) {
    return null;
  }

  if (__DEV__) {
    console.time(`[photo] ${timerName} image generation`);
  }

  try {
    const longEdge = Math.max(fileInfo.width, fileInfo.height);
    const resizeApplied = longEdge > maxLongEdge;
    const context = ImageManipulator.manipulate(sourceUri);

    if (resizeApplied) {
      if (fileInfo.width >= fileInfo.height) {
        context.resize({ width: maxLongEdge });
      } else {
        context.resize({ height: maxLongEdge });
      }
    }

    const image = await context.renderAsync();
    const saved = await image.saveAsync({
      base64: false,
      compress: quality,
      format: SaveFormat.JPEG,
    });

    return {
      uri: saved.uri,
      width: saved.width,
      height: saved.height,
      compressApplied: true,
      resizeApplied,
      reencodeApplied: true,
    };
  } finally {
    if (__DEV__) {
      console.timeEnd(`[photo] ${timerName} image generation`);
    }
  }
}

function getImageContentType(mimeType?: string | null) {
  const normalized = mimeType?.trim().toLowerCase();
  return normalized?.startsWith('image/') ? normalized : 'image/jpeg';
}

async function readFileAsArrayBuffer(uri: string) {
  return new File(uri).arrayBuffer();
}

async function getLocalFileSize(uri: string) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size ?? null : null;
  } catch (error) {
    console.warn('[photo] file size lookup failed', { uri, error });
    return null;
  }
}

export async function createPhotoSignedUrl(storagePath: string) {
  const cached = signedUrlCache.get(storagePath);
  if (cached && cached.expiresAt - SIGNED_URL_REFRESH_BUFFER_MS > Date.now()) {
    return cached.url;
  }

  const inFlight = signedUrlInFlightCache.get(storagePath);
  if (inFlight) {
    return inFlight;
  }

  const signedUrlTimerLabel = `[photo] signed URL generation ${storagePath}`;
  if (__DEV__) {
    console.time(signedUrlTimerLabel);
  }
  const signedUrl = supabase.storage
    .from(DROP_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    .then(({ data, error }) => {
      if (error) {
        throw error;
      }

      signedUrlCache.set(storagePath, {
        expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
        url: data.signedUrl,
      });

      return data.signedUrl;
    })
    .finally(() => {
      if (__DEV__) {
        console.timeEnd(signedUrlTimerLabel);
      }
      signedUrlInFlightCache.delete(storagePath);
    });

  signedUrlInFlightCache.set(storagePath, signedUrl);
  return signedUrl;
}

export async function deletePhotoStorageFile(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) {
    throw new Error('missing_storage_path');
  }

  const { data, error } = await supabase.storage.from(DROP_PHOTOS_BUCKET).remove([normalizedPath]);
  if (error) {
    console.error('[photo] storage file delete failed', { bucket: DROP_PHOTOS_BUCKET, path: normalizedPath, data, error });
    throw error;
  }

  signedUrlCache.delete(normalizedPath);
  return data;
}

export async function deletePhotoStorageFiles(paths: string[]) {
  const normalizedPaths = Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
  if (!normalizedPaths.length) {
    return [];
  }

  const { data, error } = await supabase.storage.from(DROP_PHOTOS_BUCKET).remove(normalizedPaths);
  if (error) {
    console.error('[photo] storage files batch delete failed', {
      bucket: DROP_PHOTOS_BUCKET,
      paths: normalizedPaths,
      data,
      error,
    });
    throw error;
  }

  normalizedPaths.forEach((path) => signedUrlCache.delete(path));
  return data;
}

export function extractStoragePathFromUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    const marker = `/storage/v1/object/public/${DROP_PHOTOS_BUCKET}/`;
    const markerIndex = parsedUrl.pathname.indexOf(marker);
    if (markerIndex === -1) {
      return null;
    }

    return decodeURIComponent(parsedUrl.pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

async function createUploadImageUrl(storagePath: string) {
  try {
    return await createPhotoSignedUrl(storagePath);
  } catch {
    // Fall through to a public URL for compatibility with older bucket settings.
  }

  return supabase.storage.from(DROP_PHOTOS_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
