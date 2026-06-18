import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getInviteCodeFromQueryParams, PENDING_INVITE_CODE_STORAGE_KEY } from '@/lib/inviteLink';

export default function InviteRoute() {
  const params = useLocalSearchParams<{ code?: string | string[]; inviteCode?: string | string[]; invite_code?: string | string[] }>();
  const inviteCode = getInviteCodeFromQueryParams(params);

  React.useEffect(() => {
    let cancelled = false;

    const saveAndGoHome = async () => {
      if (inviteCode) {
        try {
          await AsyncStorage.setItem(PENDING_INVITE_CODE_STORAGE_KEY, inviteCode);
        } catch (error) {
          console.warn('pending invite code save failed', error);
        }
      }

      if (!cancelled) {
        router.replace('/(tabs)');
      }
    };

    void saveAndGoHome();

    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

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
