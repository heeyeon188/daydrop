import { decode } from 'base64-arraybuffer';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

const BUCKET = 'daydrop-photos';

const imagePickerOptions: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [4, 5],
  quality: 0.86,
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

  return asset;
}

export async function takePhotoWithCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('photo_permission_denied');
  }

  const result = await ImagePicker.launchCameraAsync(imagePickerOptions);

  if (result.canceled) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset?.base64) {
    throw new Error('photo_read_failed');
  }

  return asset;
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

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, decode(base64), {
    contentType: 'image/jpeg',
    upsert: false,
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60 * 24);

  return {
    storagePath,
    imageUrl: signedData?.signedUrl ?? data.publicUrl,
  };
}

export async function createPhotoSignedUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}
