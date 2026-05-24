import { decode } from 'base64-arraybuffer';
import { FlipType, ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

const BUCKET = 'daydrop-photos';
export type CameraFacing = 'front' | 'back';
type PickedImageSource = 'library' | CameraFacing;
export type DaydropPhotoAsset = {
  base64?: string | null;
  exif?: Record<string, unknown> | null;
  height: number;
  mimeType?: string;
  uri: string;
  width: number;
};

type NormalizedPhotoAsset = DaydropPhotoAsset & {
  didFlip?: boolean;
  mirrorMode?: MirrorMode;
};

type MirrorMode = 'none' | 'front-preview-match' | 'exif-mirrored';

const imagePickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  exif: true,
  quality: 0.9,
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
  return normalizePickedImage(asset, source, { flipFrontCameraByDefault: true });
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
    exifOrientation: orientation,
    mirrorMode,
    flipApplied: shouldFlip,
  });

  if (!shouldFlip) {
    return {
      ...asset,
      didFlip: false,
      mirrorMode,
    };
  }

  const image = await ImageManipulator.manipulate(asset.uri).flip(FlipType.Horizontal).renderAsync();
  const saved = await image.saveAsync({
    base64: true,
    compress: 0.9,
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
    didFlip: shouldFlip,
    mirrorMode,
  };

  console.log('[photo] normalized image', {
    source,
    captureSource: source,
    uri: normalized.uri,
    width: normalized.width,
    height: normalized.height,
    exifOrientation: normalized.exif?.Orientation ?? null,
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
  userId,
}: {
  base64: string;
  coupleId: string;
  dropId: string;
  userId: string;
}) {
  const timestamp = Date.now();
  const storagePath = `couples/${coupleId}/drops/${dropId}/${userId}-${timestamp}.jpg`;
  const fileData = decode(base64);

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
  });

  return {
    storagePath,
    imageUrl: await createUploadImageUrl(storagePath),
  };
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
