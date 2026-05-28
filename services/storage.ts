import { decode } from 'base64-arraybuffer';
import { File } from 'expo-file-system';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

const BUCKET = 'daydrop-photos';
const UPLOAD_MAX_LONG_EDGE = 1440;
const UPLOAD_JPEG_QUALITY = 0.82;
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
  let uploadTransform = await prepareImageForUpload(fileInfo).catch((error) => {
    console.warn('[photo] upload image optimization failed; falling back to original uri', {
      uri: fileInfo?.uploadUri ?? null,
      error,
    });
    return null;
  });
  let uploadData: ArrayBuffer | null = null;
  let base64Used = false;
  if (uploadTransform) {
    try {
      uploadData = await readFileAsArrayBuffer(uploadTransform.uri);
    } catch (error) {
      console.warn('[photo] optimized upload image read failed; falling back to original uri', {
        uri: uploadTransform.uri,
        error,
      });
      uploadTransform = null;
    }
  }
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
  const finalUploadUri = uploadTransform?.uri ?? fileInfo?.uploadUri ?? null;
  const finalUploadWidth = uploadTransform?.width ?? fileInfo?.width ?? null;
  const finalUploadHeight = uploadTransform?.height ?? fileInfo?.height ?? null;
  const uploadFileSize = finalUploadUri ? await getLocalFileSize(finalUploadUri) : null;
  const uploadCompressApplied = uploadTransform?.compressApplied ?? false;
  const uploadResizeApplied = uploadTransform?.resizeApplied ?? false;
  const uploadReencodeApplied = uploadTransform?.reencodeApplied ?? false;

  console.log('[photo] upload candidate', {
    capturedUri: fileInfo?.capturedUri ?? finalUploadUri,
    uploadUri: finalUploadUri,
    originalWidth: fileInfo?.originalWidth ?? fileInfo?.width ?? null,
    originalHeight: fileInfo?.originalHeight ?? fileInfo?.height ?? null,
    uploadWidth: finalUploadWidth,
    uploadHeight: finalUploadHeight,
    base64Used,
    compressApplied: uploadCompressApplied,
    resizeApplied: uploadResizeApplied,
    reencodeApplied: uploadReencodeApplied,
    fileSize: uploadFileSize,
    byteLength: uploadData.byteLength,
  });

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, uploadData, {
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
    byteLength: uploadData.byteLength,
    uploadWidth: finalUploadWidth,
    uploadHeight: finalUploadHeight,
    compressApplied: uploadCompressApplied,
    resizeApplied: uploadResizeApplied,
    reencodeApplied: uploadReencodeApplied,
  });

  return {
    storagePath,
    imageUrl: await createUploadImageUrl(storagePath),
  };
}

async function prepareImageForUpload(fileInfo?: {
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
}) {
  const sourceUri = fileInfo?.uploadUri;
  if (!sourceUri || fileInfo?.compressApplied) {
    return null;
  }

  const longEdge = Math.max(fileInfo.width, fileInfo.height);
  const resizeApplied = longEdge > UPLOAD_MAX_LONG_EDGE;
  const context = ImageManipulator.manipulate(sourceUri);

  if (resizeApplied) {
    if (fileInfo.width >= fileInfo.height) {
      context.resize({ width: UPLOAD_MAX_LONG_EDGE });
    } else {
      context.resize({ height: UPLOAD_MAX_LONG_EDGE });
    }
  }

  const image = await context.renderAsync();
  const saved = await image.saveAsync({
    base64: false,
    compress: UPLOAD_JPEG_QUALITY,
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
