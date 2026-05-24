import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type NotificationPreferenceKey = 'dailyQuestion' | 'partnerConnected' | 'partnerPhotoUploaded' | 'pushEnabled';

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>;

type CoupleEventPayload =
  | {
      eventType: 'partner_photo_uploaded';
      coupleId: string;
      dropSubmissionId: string;
    }
  | {
      eventType: 'partner_connected';
      coupleId: string;
    };

type PushNavigationTarget = {
  coupleId?: string;
  type: 'daily_question_ready' | 'partner_connected' | 'partner_photo_uploaded';
};

const PUSH_DEVICE_ID_STORAGE_KEY = 'daydrop.push.device_id';
const NOTIFICATION_PREFERENCES_STORAGE_KEY = 'daydrop.notification.preferences.v1';
const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  dailyQuestion: true,
  partnerConnected: true,
  partnerPhotoUploaded: true,
  pushEnabled: true,
};

function getExpoProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDeviceTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    return typeof timezone === 'string' && timezone.length > 0 ? timezone : null;
  } catch {
    return null;
  }
}

async function getOrCreatePushDeviceId(): Promise<string | null> {
  try {
    const existing = await AsyncStorage.getItem(PUSH_DEVICE_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = Crypto.randomUUID();
    await AsyncStorage.setItem(PUSH_DEVICE_ID_STORAGE_KEY, next);
    return next;
  } catch (error) {
    console.warn('[Push] Failed to resolve push device id', error);
    return null;
  }
}

export async function registerForPushNotificationsAsync() {
  try {
    if (!Device.isDevice) {
      console.log('[Push] Skipped token registration: physical device required');
      return null;
    }

    if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      console.log('[Push] Skipped token registration: Android remote push requires a development build');
      return null;
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      finalStatus = requested.status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Push] Permission not granted, skipping token registration');
      return null;
    }

    const projectId = getExpoProjectId();
    if (!projectId) {
      console.warn(
        '[Push] Missing EAS projectId. Check Constants.expoConfig.extra.eas.projectId or Constants.easConfig.projectId.'
      );
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    console.log('[Push] ExpoPushToken', token);
    return token;
  } catch (error) {
    console.warn('[Push] Failed to register ExpoPushToken', error);
    return null;
  }
}

export async function saveExpoPushTokenToSupabase(token: string) {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.warn('[Push] Skipped token save: no authenticated user');
      return false;
    }

    const timezone = getDeviceTimezone();
    const deviceId = await getOrCreatePushDeviceId();

    const { error } = await supabase.from('user_push_tokens').upsert(
      {
        user_id: user.id,
        expo_push_token: token,
        platform: Platform.OS,
        device_id: deviceId,
        timezone,
        enabled: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,expo_push_token' }
    );

    if (error) {
      console.warn('[Push] Failed to save token to Supabase', error.message);
      return false;
    }

    console.log('[Push] Token saved to Supabase');
    return true;
  } catch (error) {
    console.warn('[Push] Failed to save token to Supabase', error);
    return false;
  }
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      dailyQuestion: typeof parsed.dailyQuestion === 'boolean' ? parsed.dailyQuestion : true,
      partnerConnected: typeof parsed.partnerConnected === 'boolean' ? parsed.partnerConnected : true,
      partnerPhotoUploaded: typeof parsed.partnerPhotoUploaded === 'boolean' ? parsed.partnerPhotoUploaded : true,
      pushEnabled: typeof parsed.pushEnabled === 'boolean' ? parsed.pushEnabled : true,
    };
  } catch (error) {
    console.warn('[Push] Failed to read notification preferences', error);
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

export async function saveNotificationPreferences(preferences: NotificationPreferences) {
  await AsyncStorage.setItem(NOTIFICATION_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export async function setCurrentUserPushTokensEnabled(enabled: boolean) {
  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.warn('[Push] Skipped token enabled update: no authenticated user');
      return false;
    }

    const { error } = await supabase
      .from('user_push_tokens')
      .update({
        enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (error) {
      console.warn('[Push] Failed to update token enabled state', error.message);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[Push] Failed to update token enabled state', error);
    return false;
  }
}

export async function disableCurrentPushTokenIfNeeded() {
  // TODO: Mark current device token as enabled = false on logout/device switch.
}

export async function registerPushToken() {
  const preferences = await getNotificationPreferences();
  if (!preferences.pushEnabled) {
    return null;
  }

  const token = await registerForPushNotificationsAsync();
  if (!token) {
    return null;
  }

  const saved = await saveExpoPushTokenToSupabase(token);
  return saved ? token : null;
}

async function invokeCouplePushEvent(payload: CoupleEventPayload) {
  try {
    const { data, error } = await supabase.functions.invoke('notify-couple-event', {
      body: payload,
    });

    if (error) {
      console.warn('[Push] Failed to invoke notify-couple-event', error.message);
      return false;
    }

    if (isRecord(data) && data.ok === false) {
      console.warn('[Push] notify-couple-event returned failure', data);
      return false;
    }

    console.log('[Push] notify-couple-event dispatched', payload.eventType);
    return true;
  } catch (error) {
    console.warn('[Push] Failed to invoke notify-couple-event', error);
    return false;
  }
}

export async function notifyPartnerPhotoSubmitted({
  coupleId,
  dropSubmissionId,
}: {
  coupleId: string;
  dropSubmissionId: string;
}) {
  return invokeCouplePushEvent({
    eventType: 'partner_photo_uploaded',
    coupleId,
    dropSubmissionId,
  });
}

export async function notifyPartnerConnected(coupleId: string) {
  return invokeCouplePushEvent({
    eventType: 'partner_connected',
    coupleId,
  });
}

export function getPushNavigationTarget(data: unknown): PushNavigationTarget | null {
  if (!isRecord(data)) {
    return null;
  }

  const type = data.type;
  if (type !== 'partner_photo_uploaded' && type !== 'partner_connected' && type !== 'daily_question_ready') {
    return null;
  }

  const coupleId = typeof data.coupleId === 'string' ? data.coupleId : undefined;
  return {
    type,
    coupleId,
  };
}

export async function selectCoupleFromPushIfNeeded(coupleId?: string) {
  if (!coupleId) {
    return;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return;
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      selected_couple_id: coupleId,
    })
    .eq('id', user.id);

  if (error) {
    console.warn('[Push] Failed to select couple from push payload', error.message);
  } else {
    console.log('[Push] Selected couple from push payload', coupleId);
  }
}
