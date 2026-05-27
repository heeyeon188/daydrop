import { decode } from 'base64-arraybuffer';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

const BUCKET = 'daydrop-photos';
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
  const fileData = decode(base64);
  const uploadFileSize = fileInfo?.uploadUri ? await getLocalFileSize(fileInfo.uploadUri) : null;

  console.log('[photo] upload candidate', {
    capturedUri: fileInfo?.capturedUri ?? fileInfo?.uploadUri ?? null,
    uploadUri: fileInfo?.uploadUri ?? null,
    originalWidth: fileInfo?.originalWidth ?? fileInfo?.width ?? null,
    originalHeight: fileInfo?.originalHeight ?? fileInfo?.height ?? null,
    uploadWidth: fileInfo?.width ?? null,
    uploadHeight: fileInfo?.height ?? null,
    base64Used: fileInfo?.base64Used ?? true,
    compressApplied: fileInfo?.compressApplied ?? false,
    resizeApplied: fileInfo?.resizeApplied ?? false,
    reencodeApplied: fileInfo?.reencodeApplied ?? false,
    fileSize: uploadFileSize,
    byteLength: fileData.byteLength,
  });

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, fileData, {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  console.log('[photo] uploaded image', {
    bucket: BUCKET,
    storagePath,
    contentType: 'image/jpeg',
    byteLength: fileData.byteLength,
    uploadWidth: fileInfo?.width ?? null,
    uploadHeight: fileInfo?.height ?? null,
  });

  return {
    storagePath,
    imageUrl: await createUploadImageUrl(storagePath),
  };
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
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}

async function createUploadImageUrl(storagePath: string) {
  const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24);
  if (signedData?.signedUrl) {
    return signedData.signedUrl;
  }

  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
