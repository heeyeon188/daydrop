import { decode } from 'base64-arraybuffer';
import { File } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

export const DROP_PHOTOS_BUCKET = 'daydrop-photos';
const DISPLAY_MAX_LONG_EDGE = 1600;
const DISPLAY_JPEG_QUALITY = 0.88;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const SIGNED_URL_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const signedUrlCache = new Map<string, { expiresAt: number; url: string }>();
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
  exif: true,
  quality: 1,
  base64: true,
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
  if (!asset?.base64) {
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
  if (!asset?.base64) {
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
    base64: true,
    compress: 1,
    format: SaveFormat.JPEG,
  });

  if (!saved.base64) {
    throw new Error('photo_read_failed');
  }

  const normalized = {
    ...asset,
    base64: saved.base64,
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
  base64: string;
  coupleId: string;
  dropId: string;
  fileInfo?: {
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
  userId: string;
}) {
  const timestamp = Date.now();
  const storagePath = `couples/${coupleId}/drops/${dropId}/${userId}-${timestamp}.jpg`;
  const displayStoragePath = `couples/${coupleId}/drops/${dropId}/display/${userId}-${timestamp}.jpg`;
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

  const { error } = await supabase.storage.from(DROP_PHOTOS_BUCKET).upload(storagePath, uploadData, {
    contentType: originalContentType,
    upsert: false,
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

  const displayUpload = await uploadDisplayImage({
    displayStoragePath,
    fileInfo,
  }).catch((displayError) => {
    console.warn('[photo] display image upload failed; using original image for display fallback', {
      displayStoragePath,
      error: displayError,
    });
    return null;
  });

  return {
    displayImageUrl: displayUpload ? await createUploadImageUrl(displayUpload.storagePath) : null,
    displayStoragePath: displayUpload?.storagePath ?? null,
    storagePath,
    imageUrl: await createUploadImageUrl(storagePath),
  };
}

async function uploadDisplayImage({
  displayStoragePath,
  fileInfo,
}: {
  displayStoragePath: string;
  fileInfo?: {
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
}) {
  const displayImage = await prepareDisplayImage(fileInfo);
  if (!displayImage) {
    return null;
  }

  const displayData = await readFileAsArrayBuffer(displayImage.uri);
  const { error } = await supabase.storage.from(DROP_PHOTOS_BUCKET).upload(displayStoragePath, displayData, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  if (__DEV__) {
    console.log('[photo] uploaded display image', {
      bucket: DROP_PHOTOS_BUCKET,
      storagePath: displayStoragePath,
      contentType: 'image/jpeg',
      byteLength: displayData.byteLength,
      uploadWidth: displayImage.width,
      uploadHeight: displayImage.height,
      compressApplied: true,
      resizeApplied: displayImage.resizeApplied,
      reencodeApplied: true,
    });
  }

  return { storagePath: displayStoragePath };
}

async function prepareDisplayImage(fileInfo?: {
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
}) {
  const sourceUri = fileInfo?.uploadUri;
  if (!sourceUri) {
    return null;
  }

  const longEdge = Math.max(fileInfo.width, fileInfo.height);
  const resizeApplied = longEdge > DISPLAY_MAX_LONG_EDGE;
  const context = ImageManipulator.manipulate(sourceUri);

  if (resizeApplied) {
    if (fileInfo.width >= fileInfo.height) {
      context.resize({ width: DISPLAY_MAX_LONG_EDGE });
    } else {
      context.resize({ height: DISPLAY_MAX_LONG_EDGE });
    }
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    base64: false,
    compress: DISPLAY_JPEG_QUALITY,
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

  const { data, error } = await supabase.storage.from(DROP_PHOTOS_BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (error) {
    throw error;
  }

  signedUrlCache.set(storagePath, {
    expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    url: data.signedUrl,
  });

  return data.signedUrl;
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
