import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export async function registerPushToken(userId: string) {
  try {
    if (!Device.isDevice) {
      return null;
    }

    const existing = await Notifications.getPermissionsAsync();
    const finalStatus =
      existing.status === 'granted'
        ? existing.status
        : (await Notifications.requestPermissionsAsync()).status;

    if (finalStatus !== 'granted') {
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        expo_push_token: token,
        platform: Platform.OS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_push_token' }
    );

    if (error) {
      console.warn('Failed to save push token', error.message);
    }

    return token;
  } catch (error) {
    console.warn('Push registration skipped', error);
    return null;
  }
}

export async function notifyPartnerPhotoSubmitted(coupleId: string, myUserId: string) {
  try {
    const { data: partnerMembers, error: memberError } = await supabase
      .from('couple_members')
      .select('user_id')
      .eq('couple_id', coupleId)
      .neq('user_id', myUserId);

    if (memberError) {
      throw memberError;
    }

    const partnerIds = partnerMembers?.map((member) => member.user_id) ?? [];
    if (partnerIds.length === 0) {
      return;
    }

    const { data: tokens, error: tokenError } = await supabase
      .from('push_tokens')
      .select('expo_push_token')
      .in('user_id', partnerIds);

    if (tokenError) {
      throw tokenError;
    }

    const messages =
      tokens?.map((token) => ({
        to: token.expo_push_token,
        sound: 'default',
        title: 'Daydrop',
        body: '상대가 오늘의 사진을 보냈어요. 당신의 하루를 보내면 함께 열 수 있어요.',
      })) ?? [];

    if (messages.length === 0) {
      return;
    }

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (error) {
    console.warn('Push notification skipped', error);
  }
}
