import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { normalizeInviteCode, PENDING_INVITE_CODE_STORAGE_KEY } from '@/lib/inviteLink';

export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;

  React.useEffect(() => {
    let cancelled = false;

    const saveAndGoHome = async () => {
      const code = normalizeInviteCode(rawCode);
      if (code) {
        try {
          await AsyncStorage.setItem(PENDING_INVITE_CODE_STORAGE_KEY, code);
        } catch (error) {
          console.warn('pending invite code save failed', error);
        }
      }

      if (!cancelled) {
        router.replace('/');
      }
    };

    void saveAndGoHome();

    return () => {
      cancelled = true;
    };
  }, [rawCode]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#111111" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'center',
  },
});
