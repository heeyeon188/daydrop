import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import React from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSession } from '@/hooks/useSession';
import {
  getNotificationPreferences,
  getPushNavigationTarget,
  registerForPushNotificationsAsync,
  saveExpoPushTokenToSupabase,
  selectCoupleFromPushIfNeeded,
} from '@/services/notifications';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { user, loading } = useSession();
  const lastRegisteredUserIdRef = React.useRef<string | null>(null);
  const lastHandledNotificationIdRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    let isMounted = true;

    const handleNotification = async (notification: Notifications.Notification) => {
      const identifier = notification.request.identifier;
      if (lastHandledNotificationIdRef.current === identifier) {
        return;
      }

      const target = getPushNavigationTarget(notification.request.content.data);
      if (!target) {
        return;
      }

      lastHandledNotificationIdRef.current = identifier;
      await selectCoupleFromPushIfNeeded(target.coupleId);
      router.replace('/');
      await Notifications.clearLastNotificationResponseAsync();
      console.log('[Push] Notification tap handled', target.type);
    };

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!isMounted || !response?.notification) {
          return;
        }
        void handleNotification(response.notification);
      })
      .catch((error) => {
        console.warn('[Push] Failed to read last notification response', error);
      });

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotification(response.notification);
    });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  React.useEffect(() => {
    if (loading || !user) {
      if (!user) {
        lastRegisteredUserIdRef.current = null;
      }
      return;
    }

    if (lastRegisteredUserIdRef.current === user.id) {
      return;
    }
    lastRegisteredUserIdRef.current = user.id;

    void (async () => {
      const preferences = await getNotificationPreferences();
      if (!preferences.pushEnabled) {
        return;
      }

      const token = await registerForPushNotificationsAsync();
      if (!token) {
        return;
      }
      await saveExpoPushTokenToSupabase(token);
    })();
  }, [loading, user]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="signup" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
