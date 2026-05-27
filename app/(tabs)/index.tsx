import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import { CameraView, type CameraType, useCameraPermissions } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import * as ExpoLinking from 'expo-linking';
import * as MediaLibrary from 'expo-media-library';
import * as Notifications from 'expo-notifications';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '@/constants/appConfig';
import { getTranslations, normalizeLanguage, type Language } from '@/lib/i18n';
import { findCountryOption, getCountryLabel, searchCountryOptions } from '@/lib/locations';
import { useMyCouple } from '@/hooks/useMyCouple';
import { useProfile } from '@/hooks/useProfile';
import { useSession } from '@/hooks/useSession';
import { useTodayDrop } from '@/hooks/useTodayDrop';
import { deleteAccount } from '@/services/account';
import { signInWithAppleIdToken, signInWithEmail, signInWithGoogle, signOut, signUpWithEmail } from '@/services/auth';
import { createCoupleInvite, joinCoupleByInviteCode, selectCouple, type MyCouple, type MyCoupleOption } from '@/services/couple';
import { deleteMyTodayDropPhoto, submitDropPhoto } from '@/services/drops';
import {
  getNotificationPreferences,
  registerPushToken,
  saveNotificationPreferences,
  setCurrentUserPushTokensEnabled,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '@/services/notifications';
import { completeProfile, updatePreferredLanguage, type ProfileInput } from '@/services/profile';
import { normalizeCameraPhoto, type CameraFacing, type DaydropPhotoAsset } from '@/services/storage';
import type { CoupleMember, DropState, DropSubmission, PartnerType, Profile, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const EMPTY_MEMBERS: CoupleMember[] = [];
const PERMISSION_INTRO_STORAGE_KEY = 'daydrop.hasSeenPermissionIntro';
const PENDING_INVITE_CODE_STORAGE_KEY = 'daydrop.pendingInviteCode';
const DEFAULT_PHOTO_PAIR_HEIGHT = 292;
const SHARE_IMAGE_MAX_HEIGHT = 1600;
const RECENT_THUMB_GROUP_WIDTH = 138;
const RECENT_THUMB_SLOT_WIDTH = RECENT_THUMB_GROUP_WIDTH / 2;
const RECENT_THUMB_DEFAULT_HEIGHT = 82;
const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  dailyQuestion: true,
  partnerConnected: true,
  partnerPhotoUploaded: true,
  pushEnabled: true,
};

type Copy = ReturnType<typeof getTranslations>;
type FeatherIconName = React.ComponentProps<typeof Feather>['name'];
type FullImage = { canDelete?: boolean; image?: string; label: string; mission: string };
type DropDetail = { drop: RecentDrop; state: DropState };
type ImageSize = { height: number; width: number };
type SharePhotoPair = { leftUri: string; rightUri: string };
type ShareCanvasLayout = {
  height: number;
  key: number;
  left: ImageSize;
  leftUri: string;
  right: ImageSize;
  rightUri: string;
  width: number;
};
type SafeImageResizeMode = React.ComponentProps<typeof Image>['resizeMode'];

const ULTRA_WIDE_BACK_LENS_PATTERNS = ['ultra', '0.5', '초광각'];
const NON_DEFAULT_BACK_LENS_PATTERNS = [
  'tele',
  'dual',
  'triple',
  'lidar',
  'depth',
  'true',
  'desk',
  'continuity',
  '망원',
  '듀얼',
  '트리플',
  '심도',
];
const DEFAULT_BACK_LENS_PATTERNS = ['wide angle', 'wide-angle', 'wide', 'back camera', 'camera', '광각', '후면', '카메라'];

function selectDefaultBackLens(lenses: string[]) {
  const nonUltraWideBackLenses = lenses.filter((lens) => {
    const normalized = lens.toLowerCase();
    return !ULTRA_WIDE_BACK_LENS_PATTERNS.some((pattern) => normalized.includes(pattern));
  });
  const preferredBackLenses = nonUltraWideBackLenses.filter((lens) => {
    const normalized = lens.toLowerCase();
    return !NON_DEFAULT_BACK_LENS_PATTERNS.some((pattern) => normalized.includes(pattern));
  });

  return preferredBackLenses.find((lens) => {
    const normalized = lens.toLowerCase();
    return DEFAULT_BACK_LENS_PATTERNS.some((pattern) => normalized.includes(pattern));
  }) ?? preferredBackLenses[0] ?? nonUltraWideBackLenses[0];
}

export default function MissionScreen() {
  const { user, loading: sessionLoading, configError } = useSession();
  const profileState = useProfile(user?.id);
  const myCouple = useMyCouple(Boolean(user));
  const language = normalizeLanguage(profileState.profile?.preferred_language);
  const t = getTranslations(language);
  const [pendingInviteCode, setPendingInviteCode] = React.useState<string | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const savePendingInviteCode = async (url: string | null) => {
      const nextCode = getInviteCodeFromURL(url);
      if (!nextCode) {
        return;
      }

      setPendingInviteCode(nextCode);
      try {
        await AsyncStorage.setItem(PENDING_INVITE_CODE_STORAGE_KEY, nextCode);
      } catch (nextError) {
        console.warn('pending invite code save failed', nextError);
      }
    };

    ExpoLinking.getInitialURL()
      .then((url) => {
        if (mounted) {
          void savePendingInviteCode(url);
        }
      })
      .catch((nextError) => {
        console.warn('initial invite link lookup failed', nextError);
      });

    const subscription = ExpoLinking.addEventListener('url', ({ url }) => {
      void savePendingInviteCode(url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (sessionLoading) {
    return <CenteredState text={t.loadingApp} />;
  }

  if (configError) {
    return <CenteredState text={configError} />;
  }

  if (!user) {
    return <AuthScreen language={language} />;
  }

  if (profileState.loading) {
    return <CenteredState text={t.loadingApp} />;
  }

  if (!profileState.profile?.profile_completed) {
    return (
      <ProfileSetupScreen
        language={language}
        onLogout={signOut}
        onSaved={async (profile) => {
          profileState.setProfile(profile);
          await myCouple.refetch();
        }}
        profile={profileState.profile}
      />
    );
  }

  return (
    <MissionContent
      language={language}
      myCouple={myCouple.couple}
      myUserId={user.id}
      onCoupleChanged={myCouple.refetch}
      onPendingInviteCodeHandled={() => setPendingInviteCode(null)}
      onLanguageChanged={profileState.setProfile}
      onLogout={signOut}
      onProfileSaved={async (profile) => {
        profileState.setProfile(profile);
        await myCouple.refetch();
      }}
      pendingInviteCode={pendingInviteCode}
      profile={profileState.profile}
    />
  );
}

function MissionContent({
  language,
  myCouple,
  myUserId,
  onCoupleChanged,
  onPendingInviteCodeHandled,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  pendingInviteCode,
  profile,
}: {
  language: Language;
  myCouple: MyCouple | null;
  myUserId: string;
  onCoupleChanged: () => Promise<void>;
  onPendingInviteCodeHandled: () => void;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  pendingInviteCode: string | null;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const { today, recentDrops, loading, refreshing, error, refetch } = useTodayDrop(true, myCouple?.couple.id);
  const [deletingPhoto, setDeletingPhoto] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [fullImage, setFullImage] = React.useState<FullImage | null>(null);
  const [allDropsVisible, setAllDropsVisible] = React.useState(false);
  const [cameraVisible, setCameraVisible] = React.useState(false);
  const [connectVisible, setConnectVisible] = React.useState(false);
  const [dropDetail, setDropDetail] = React.useState<DropDetail | null>(null);
  const [partnerMenuVisible, setPartnerMenuVisible] = React.useState(false);
  const [permissionIntroVisible, setPermissionIntroVisible] = React.useState(false);
  const [shareSheetVisible, setShareSheetVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [storedPendingInviteCode, setStoredPendingInviteCode] = React.useState<string | null>(null);
  const activePendingInviteCode = pendingInviteCode ?? storedPendingInviteCode;
  const activeMembers = today?.members ?? myCouple?.members ?? EMPTY_MEMBERS;
  const members = React.useMemo(() => splitMembers(activeMembers, myUserId), [activeMembers, myUserId]);
  const state = React.useMemo(() => getDropState(today, myUserId), [today, myUserId]);
  const sharePhotoPair = React.useMemo(() => {
    if (!today || state !== 'both') {
      return null;
    }

    const { mine, partner } = splitSubmissions(today.submissions, myUserId);
    if (!mine?.image_url || !partner?.image_url) {
      return null;
    }

    return {
      leftUri: partner.image_url,
      rightUri: mine.image_url,
    };
  }, [myUserId, state, today]);
  const hasPartner = Boolean(today?.couple.status === 'active' && members.partner);
  const isTodayUnlocked = hasPartner && state === 'both';
  const mainButtonDisabled = hasPartner ? (state === 'meOnly' || uploading || deletingPhoto) : uploading || deletingPhoto;
  const stateCopy = React.useMemo(() => getStateCopy(state, t, hasPartner), [hasPartner, state, t]);
  const meta = React.useMemo(() => buildMeta(members, language, t), [language, members, t]);
  const missionTitle = React.useMemo(() => getMissionPrompt(today?.mission, language), [language, today?.mission]);
  const inviteCode = myCouple?.couple.status === 'pending' ? myCouple.couple.invite_code : null;
  const coupleOptions = React.useMemo(() => myCouple?.availableCouples ?? [], [myCouple?.availableCouples]);
  const partnerOptions = React.useMemo(
    () => coupleOptions.filter((option) => option.couple.status === 'active' && option.members.some((member) => member.user_id !== myUserId)),
    [coupleOptions, myUserId]
  );
  const partnerCount = partnerOptions.length;
  const canAddPartner = partnerCount < 4;

  React.useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(PERMISSION_INTRO_STORAGE_KEY)
      .then((value) => {
        if (mounted && value !== 'true') {
          setPermissionIntroVisible(true);
        }
      })
      .catch((nextError) => {
        console.warn('permission intro lookup failed', nextError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(PENDING_INVITE_CODE_STORAGE_KEY)
      .then((value) => {
        if (mounted && value) {
          setStoredPendingInviteCode(normalizeInviteCode(value));
        }
      })
      .catch((nextError) => {
        console.warn('pending invite code lookup failed', nextError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    if (activePendingInviteCode) {
      setConnectVisible(true);
    }
  }, [activePendingInviteCode]);

  const clearPendingInviteCode = React.useCallback(() => {
    setStoredPendingInviteCode(null);
    onPendingInviteCodeHandled();
    AsyncStorage.removeItem(PENDING_INVITE_CODE_STORAGE_KEY).catch((nextError) => {
      console.warn('pending invite code clear failed', nextError);
    });
  }, [onPendingInviteCodeHandled]);

  const dismissPermissionIntro = async () => {
    setPermissionIntroVisible(false);
    try {
      await AsyncStorage.setItem(PERMISSION_INTRO_STORAGE_KEY, 'true');
    } catch (nextError) {
      console.warn('permission intro save failed', nextError);
    }
  };

  const submitPhotoAsset = async (asset: DaydropPhotoAsset, source: CameraFacing) => {
    if (!today || state === 'meOnly' || state === 'both' || uploading || deletingPhoto) {
      return;
    }

    try {
      setUploading(true);
      const picked = await normalizeCameraPhoto(asset, source);

      await submitDropPhoto({
        base64: picked.base64 ?? '',
        coupleId: today.daily_drop.couple_id,
        dropId: today.daily_drop.id,
        fileInfo: {
          height: picked.height,
          uri: picked.uri,
          width: picked.width,
        },
        userId: myUserId,
      });
      await refetch(true);
      setCameraVisible(false);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '';
      if (message === 'photo_permission_denied') {
        Alert.alert(t.photoPermission, language === 'ko' ? '설정에서 카메라 권한을 허용해주세요.' : 'Please allow camera access in Settings.', [
          { text: t.cancel, style: 'cancel' },
          { text: language === 'ko' ? '설정 열기' : 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
      } else {
        console.error('submitDropPhoto failed', nextError);
        Alert.alert(t.uploadError, message === 'photo_read_failed' ? t.photoReadError : t.unknownError);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => {
    if (!today || deletingPhoto || uploading || state === 'meOnly' || state === 'both') {
      return;
    }

    setCameraVisible(true);
  };

  const handleDeleteMyPhoto = async () => {
    if (!today || deletingPhoto) {
      return;
    }

    try {
      setDeletingPhoto(true);
      await deleteMyTodayDropPhoto({
        currentDropId: today.daily_drop.id,
        currentUserId: myUserId,
      });
      setFullImage(null);
      await refetch(true);
    } catch (nextError) {
      console.error('deleteMyTodayDropPhoto failed', nextError);
      Alert.alert(t.deletePhotoError, t.unknownError);
    } finally {
      setDeletingPhoto(false);
    }
  };

  const confirmDeleteMyPhoto = () => {
    if (!today || deletingPhoto) {
      return;
    }

    Alert.alert(t.deletePhotoTitle, t.deletePhotoBody, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.deletePhoto,
        style: 'destructive',
        onPress: () => {
          void handleDeleteMyPhoto();
        },
      },
    ]);
  };

  const openLockedPartner = () => {
    Alert.alert(t.dropLocked, t.openAfterSend);
  };

  const openAddPartner = () => {
    if (!canAddPartner) {
      Alert.alert(t.partnerLimitTitle, t.partnerLimitBody);
      return;
    }
    setPartnerMenuVisible(false);
    setSettingsVisible(false);
    setConnectVisible(true);
  };

  const handleSelectPartner = async (coupleId: string) => {
    if (coupleId === myCouple?.couple.id) {
      setPartnerMenuVisible(false);
      return;
    }

    try {
      setPartnerMenuVisible(false);
      await selectCouple(coupleId);
      await onCoupleChanged();
      await refetch(true);
    } catch (nextError) {
      console.error('select couple failed', nextError);
      Alert.alert(t.partnerSelectError, t.unknownError);
    }
  };

  if (loading && !today) {
    return <CenteredState text={t.loadingMission} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refetch(true)} />}
        contentContainerStyle={styles.scrollContent}>
        <Header onMenuPress={() => setSettingsVisible(true)} />

        <View style={styles.missionHeader}>
          <Text allowFontScaling={false} style={[styles.sectionTitle, styles.missionHeaderTitle]}>
            {t.mission}
          </Text>
          <PartnerPill count={partnerCount} onPress={() => setPartnerMenuVisible(true)} />
        </View>

        {error ? <InlineMessage text={error} /> : null}

        {today ? (
          <>
            <View style={styles.missionCard}>
              <Text allowFontScaling={false} style={styles.dropLabel}>
                {t.todayDrop}
              </Text>
              <Text allowFontScaling={false} style={styles.missionTitle}>
                {missionTitle}
              </Text>
              <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.missionMeta}>
                {meta}
              </Text>
              <View style={styles.photoPair}>
                <TodayDropPair
                  language={language}
                  members={members}
                  myUserId={myUserId}
                  onLockedPartnerPress={openLockedPartner}
                  onOpenImage={setFullImage}
                  onUploadPress={handleUpload}
                  deletingPhoto={deletingPhoto}
                  hasPartner={hasPartner}
                  state={state}
                  t={t}
                  today={today}
                />
              </View>
            </View>

            <Text allowFontScaling={false} style={styles.stateMessage}>
              {stateCopy.message}
            </Text>

            <Pressable
              disabled={mainButtonDisabled}
              onPress={isTodayUnlocked ? () => setShareSheetVisible(true) : hasPartner ? handleUpload : openAddPartner}
              style={[
                styles.primaryButton,
                mainButtonDisabled && styles.disabledButton,
              ]}>
              {uploading && hasPartner ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.primaryButtonText,
                    mainButtonDisabled && styles.disabledButtonText,
                  ]}>
                  {isTodayUnlocked ? t.share : stateCopy.button}
                </Text>
              )}
            </Pressable>
          </>
        ) : null}

        <View style={styles.recentHeader}>
          <Text allowFontScaling={false} style={styles.recentTitle}>
            {t.recentDrops}
          </Text>
          <Pressable style={styles.viewAll} onPress={() => setAllDropsVisible(true)}>
            <Text allowFontScaling={false} style={styles.viewAllText}>
              {t.viewAll}
            </Text>
            <Feather name="chevron-right" size={20} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.recentList}>
          {recentDrops.length === 0 ? (
            <InlineMessage text={t.noRecentDrops} />
          ) : (
            recentDrops.map((drop) => (
              <RecentDropRow
                key={drop.id}
                drop={drop}
                hasPartner={hasPartner}
                language={language}
                myUserId={myUserId}
                onPress={() => setDropDetail({ drop, state: getRecentDropState(drop, myUserId) })}
              />
            ))
          )}
        </View>
      </ScrollView>

      <FullImageModal
        deleting={deletingPhoto}
        image={fullImage}
        onClose={() => setFullImage(null)}
        onDeletePress={confirmDeleteMyPhoto}
        t={t}
      />
      <AllDropsModal
        drops={recentDrops}
        hasPartner={hasPartner}
        language={language}
        myUserId={myUserId}
        t={t}
        onClose={() => setAllDropsVisible(false)}
        onOpenDrop={(drop) => setDropDetail({ drop, state: getRecentDropState(drop, myUserId) })}
        visible={allDropsVisible}
      />
      <DropDetailModal
        detail={dropDetail}
        hasPartner={hasPartner}
        language={language}
        myUserId={myUserId}
        t={t}
        onClose={() => setDropDetail(null)}
      />
      <TodayShareSheet language={language} photoPair={sharePhotoPair} t={t} visible={shareSheetVisible} onClose={() => setShareSheetVisible(false)} />
      <SettingsSheet
        language={language}
        profile={profile}
        t={t}
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onLanguageChanged={onLanguageChanged}
        onLogout={onLogout}
        onProfileSaved={onProfileSaved}
      />
      <PermissionIntroModal language={language} onClose={dismissPermissionIntro} visible={permissionIntroVisible} />
      <DaydropCameraModal
        language={language}
        mission={missionTitle}
        onClose={() => setCameraVisible(false)}
        onUsePhoto={submitPhotoAsset}
        submitting={uploading}
        visible={cameraVisible}
      />
      <PartnerDropdown
        canAddPartner={canAddPartner}
        currentCoupleId={myCouple?.couple.id ?? null}
        language={language}
        myUserId={myUserId}
        onAddPartner={openAddPartner}
        onClose={() => setPartnerMenuVisible(false)}
        onSelectPartner={handleSelectPartner}
        options={partnerOptions}
        t={t}
        visible={partnerMenuVisible}
      />
      <Modal animationType="slide" visible={connectVisible} onRequestClose={() => setConnectVisible(false)}>
        <CoupleConnectScreen
          currentPartnerType={myCouple?.couple.partner_type ?? null}
          initialInviteCode={activePendingInviteCode}
          inviteCode={inviteCode}
          language={language}
          onConnected={async () => {
            await onCoupleChanged();
            await refetch(true);
          }}
          onClose={() => setConnectVisible(false)}
          onInviteCodeHandled={clearPendingInviteCode}
          onLogout={onLogout}
          pending={Boolean(inviteCode)}
          profile={profile}
        />
      </Modal>
    </SafeAreaView>
  );
}

function Header({ onMenuPress }: { onMenuPress: () => void }) {
  return (
    <View style={styles.header}>
      <Text allowFontScaling={false} style={styles.logo}>
        DAYDROP
      </Text>
      <View style={styles.headerActions}>
        <Feather name="search" size={29} color="#050505" strokeWidth={2.35} />
        <Pressable hitSlop={12} onPress={onMenuPress}>
          <Feather name="more-vertical" size={30} color="#050505" strokeWidth={2.35} />
        </Pressable>
      </View>
    </View>
  );
}

function DaydropCameraModal({
  language,
  mission,
  onClose,
  onUsePhoto,
  submitting,
  visible,
}: {
  language: Language;
  mission: string;
  onClose: () => void;
  onUsePhoto: (asset: DaydropPhotoAsset, source: CameraFacing) => Promise<void>;
  submitting: boolean;
  visible: boolean;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = React.useState<CameraType>('back');
  const [flash, setFlash] = React.useState<'off' | 'on'>('off');
  const [captured, setCaptured] = React.useState<(DaydropPhotoAsset & { didFlip?: boolean; mirrorMode?: string; source: CameraFacing }) | null>(null);
  const [cameraReady, setCameraReady] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const [defaultBackLens, setDefaultBackLens] = React.useState<string | undefined>(undefined);
  const cameraRef = React.useRef<CameraView>(null);
  const hasPermission = permission?.granted === true;
  const shutterDisabled = !hasPermission || !cameraReady || capturing || submitting;
  const selectedLens = Platform.OS === 'ios' && facing === 'back' ? defaultBackLens : undefined;

  React.useEffect(() => {
    if (!visible) {
      setCaptured(null);
      setCapturing(false);
      setCameraReady(false);
      setFlash('off');
      setFacing('back');
    }
  }, [visible]);

  React.useEffect(() => {
    if (!visible || captured) {
      return;
    }

    console.log('[DaydropCamera] state', {
      facing,
      hasPermission,
      cameraReady,
      isCapturing: capturing,
      hasCameraRef: Boolean(cameraRef.current),
      shutterDisabled,
    });
  }, [cameraReady, captured, capturing, facing, hasPermission, shutterDisabled, visible]);

  const updateDefaultBackLens = React.useCallback((lenses: string[]) => {
    const nextLens = selectDefaultBackLens(lenses);
    if (nextLens) {
      setDefaultBackLens((current) => (current === nextLens ? current : nextLens));
    }
  }, []);

  const capturePhoto = async () => {
    const camera = cameraRef.current;
    const captureFacing: CameraFacing = facing === 'front' ? 'front' : 'back';

    if (!camera || shutterDisabled) {
      console.log('[DaydropCamera] capture blocked', {
        facing: captureFacing,
        hasPermission,
        cameraReady,
        isCapturing: capturing,
        hasCameraRef: Boolean(camera),
        shutterDisabled,
      });
      return;
    }

    try {
      setCapturing(true);
      console.log('[DaydropCamera] capture start', { facing: captureFacing });
      const photo = await camera.takePictureAsync({
        base64: true,
        exif: true,
        quality: 0.9,
      });

      if (!photo?.base64) {
        throw new Error('photo_read_failed');
      }

      const normalized = await normalizeCameraPhoto(
        {
          base64: photo.base64,
          exif: {
            ...(photo.exif ?? {}),
            daydropCaptureSource: captureFacing,
          },
          height: photo.height,
          mimeType: 'image/jpeg',
          uri: photo.uri,
          width: photo.width,
        },
        captureFacing
      );

      console.log('[DaydropCamera] captured', {
        facing: captureFacing,
        width: normalized.width,
        height: normalized.height,
        orientation: normalized.exif?.Orientation ?? normalized.exif?.orientation ?? null,
        mirrorMode: normalized.mirrorMode ?? 'none',
        didFlip: normalized.didFlip === true,
      });

      setCaptured({ ...normalized, source: captureFacing });
    } catch (nextError) {
      console.error('[DaydropCamera] capture error', { facing: captureFacing, error: nextError });
      console.error('custom camera capture failed', nextError);
      Alert.alert(language === 'ko' ? '사진을 찍지 못했어요.' : 'Could not take photo', language === 'ko' ? '다시 시도해주세요.' : 'Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  const usePhoto = async () => {
    if (!captured || submitting) {
      return;
    }

    await onUsePhoto(
      {
        base64: captured.base64,
        exif: {
          ...(captured.exif ?? {}),
          daydropCaptureSource: captured.source,
        },
        height: captured.height,
        mimeType: 'image/jpeg',
        uri: captured.uri,
        width: captured.width,
      },
      captured.source
    );
  };

  const requestOrOpenSettings = async () => {
    if (permission?.canAskAgain === false) {
      await Linking.openSettings();
      return;
    }
    await requestPermission();
  };

  const toggleFacing = () => {
    setCameraReady(false);
    setCapturing(false);
    setFacing((current) => (current === 'front' ? 'back' : 'front'));
  };

  const topMission = mission || (language === 'ko' ? '오늘의 Mission' : "Today's Mission");
  const permissionText = language === 'ko' ? '사진을 보내려면 카메라 권한이 필요해요.' : 'Camera permission is needed to send a photo.';
  const permissionButtonText = language === 'ko' ? '카메라 권한 허용하기' : 'Allow camera permission';

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <SafeAreaView style={styles.cameraScreen}>
        <View style={styles.cameraHeader}>
          <Pressable hitSlop={12} onPress={onClose} style={styles.cameraIconButton}>
            <Feather name="chevron-down" size={32} color="#FFFFFF" strokeWidth={2.3} />
          </Pressable>
          <View style={styles.cameraTitleWrap}>
            <Text allowFontScaling={false} style={styles.cameraBrand}>
              DAYDROP
            </Text>
            <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.cameraMission}>
              {topMission}
            </Text>
          </View>
          <View style={styles.cameraIconButton} />
        </View>

        {!permission ? (
          <View style={styles.cameraCentered}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.cameraPermission}>
            <Text allowFontScaling={false} style={styles.cameraPermissionText}>
              {permissionText}
            </Text>
            <Pressable onPress={requestOrOpenSettings} style={styles.cameraPermissionButton}>
              <Text allowFontScaling={false} style={styles.cameraPermissionButtonText}>
                {permissionButtonText}
              </Text>
            </Pressable>
            {permission.canAskAgain === false ? (
              <Pressable hitSlop={8} onPress={() => Linking.openSettings()}>
                <Text allowFontScaling={false} style={styles.cameraSettingsText}>
                  {language === 'ko' ? '설정 열기' : 'Open Settings'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <>
            <View style={styles.cameraPreviewShell}>
              {captured ? (
                <Image resizeMode="cover" source={{ uri: captured.uri }} style={styles.cameraPreview} />
              ) : (
                <CameraView
                  key={`daydrop-camera-${facing}`}
                  ref={cameraRef}
                  active={visible && !captured}
                  animateShutter
                  facing={facing}
                  flash={flash}
                  mirror={facing === 'front'}
                  mode="picture"
                  selectedLens={selectedLens}
                  onAvailableLensesChanged={({ lenses }) => {
                    if (facing === 'back') {
                      updateDefaultBackLens(lenses);
                    }
                  }}
                  onCameraReady={() => {
                    console.log('[DaydropCamera] ready', { facing });
                    setCameraReady(true);
                    if (facing === 'back') {
                      void cameraRef.current?.getAvailableLensesAsync().then(updateDefaultBackLens).catch(() => undefined);
                    }
                  }}
                  style={styles.cameraPreview}
                />
              )}
            </View>

            {captured ? (
              <View style={styles.cameraConfirmBar}>
                <Pressable
                  disabled={submitting}
                  onPress={() => {
                    setCameraReady(false);
                    setCaptured(null);
                  }}
                  style={styles.cameraTextButton}>
                  <Text allowFontScaling={false} style={styles.cameraTextButtonLabel}>
                    {language === 'ko' ? '다시 찍기' : 'Retake'}
                  </Text>
                </Pressable>
                <Pressable disabled={submitting} onPress={usePhoto} style={[styles.cameraUseButton, submitting && styles.cameraControlDisabled]}>
                  {submitting ? (
                    <ActivityIndicator color="#111111" />
                  ) : (
                    <Text allowFontScaling={false} style={styles.cameraUseButtonText}>
                      {language === 'ko' ? '사진 사용' : 'Use Photo'}
                    </Text>
                  )}
                </Pressable>
              </View>
            ) : (
              <View style={styles.cameraControls}>
                <Pressable onPress={() => setFlash((current) => (current === 'on' ? 'off' : 'on'))} style={styles.cameraRoundButton}>
                  <Feather name={flash === 'on' ? 'zap' : 'zap-off'} size={22} color="#FFFFFF" strokeWidth={2.1} />
                </Pressable>
                <Pressable
                  disabled={shutterDisabled}
                  onPress={capturePhoto}
                  style={[styles.shutterButton, shutterDisabled && styles.cameraControlDisabled]}>
                  <View style={styles.shutterInner} />
                </Pressable>
                <Pressable onPress={toggleFacing} style={styles.cameraRoundButton}>
                  <Feather name="refresh-cw" size={25} color="#FFFFFF" strokeWidth={2.1} />
                </Pressable>
              </View>
            )}
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function PartnerPill({ count, onPress }: { count: number; onPress: () => void }) {
  const label = count === 1 ? '1 Partner' : `${count} Partners`;

  return (
    <Pressable onPress={onPress} style={styles.partnerPill}>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.partnerPillText}>
        {label}
      </Text>
      <Feather name="chevron-down" size={16} color="#555555" />
    </Pressable>
  );
}

function PartnerDropdown({
  canAddPartner,
  currentCoupleId,
  language,
  myUserId,
  onAddPartner,
  onClose,
  onSelectPartner,
  options,
  t,
  visible,
}: {
  canAddPartner: boolean;
  currentCoupleId: string | null;
  language: Language;
  myUserId: string;
  onAddPartner: () => void;
  onClose: () => void;
  onSelectPartner: (coupleId: string) => void;
  options: MyCoupleOption[];
  t: Copy;
  visible: boolean;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.dropdownBackdrop} onPress={onClose}>
        <Pressable style={styles.partnerDropdown}>
          {options.length === 0 ? (
            <Text allowFontScaling={false} style={styles.partnerEmptyText}>
              {t.beforePartner}
            </Text>
          ) : (
            options.map((option) => {
              const partner = option.members.find((member) => member.user_id !== myUserId) ?? null;
              const name = displayMemberName(partner, option.couple.status === 'pending' ? t.pending : t.partner);
              const isSelected = option.couple.id === currentCoupleId;
              const location = formatLocation(partner, language, '');

              return (
                <Pressable key={option.couple.id} onPress={() => onSelectPartner(option.couple.id)} style={styles.partnerOption}>
                  <View style={styles.partnerAvatar}>
                    <Text allowFontScaling={false} style={styles.partnerAvatarText}>
                      {name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.partnerOptionTextWrap}>
                    <Text allowFontScaling={false} numberOfLines={1} style={styles.partnerOptionName}>
                      {name}
                    </Text>
                    {location ? (
                      <Text allowFontScaling={false} numberOfLines={1} style={styles.partnerOptionMeta}>
                        {location}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected ? <Feather name="check" size={20} color="#111111" /> : null}
                </Pressable>
              );
            })
          )}

          <View style={styles.partnerDivider} />
          <Pressable onPress={onAddPartner} style={[styles.partnerOption, !canAddPartner && styles.partnerOptionDisabled]}>
            <View style={styles.addPartnerCircle}>
              <Feather name="plus" size={20} color={canAddPartner ? '#555555' : '#A3A3A3'} />
            </View>
            <Text allowFontScaling={false} style={[styles.addPartnerText, !canAddPartner && styles.disabledButtonText]}>
              Add partner
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TodayDropPair({
  deletingPhoto,
  hasPartner,
  language,
  members,
  myUserId,
  onLockedPartnerPress,
  onOpenImage,
  onUploadPress,
  state,
  t,
  today,
}: {
  deletingPhoto: boolean;
  hasPartner: boolean;
  language: Language;
  members: SplitMembers;
  myUserId: string;
  onLockedPartnerPress: () => void;
  onOpenImage: (image: FullImage) => void;
  onUploadPress: () => void;
  state: DropState;
  t: Copy;
  today: TodayDropPayload;
}) {
  const submissions = React.useMemo(() => splitSubmissions(today.submissions, myUserId), [myUserId, today.submissions]);
  const { mine, partner } = submissions;
  const myLabel = displayMemberName(members.me, t.me);
  const partnerLabel = displayMemberName(members.partner, t.partner);
  const mission = getMissionPrompt(today.mission, language);

  if (!hasPartner) {
    return (
      <>
        <PrePartnerSlot t={t} />
        {mine ? (
          <EditablePhotoSlot
            deleting={deletingPhoto}
            image={mine.image_url}
            label={myLabel}
            onOpenImage={() => onOpenImage({ canDelete: true, image: mine.image_url, label: myLabel, mission })}
            side="right"
          />
        ) : (
          <SendSlot label={myLabel} message={getSoloSendMessage(today.mission, language)} onPress={onUploadPress} t={t} />
        )}
      </>
    );
  }

  if (state === 'both') {
    return (
      <>
        <PhotoSlot
          image={partner?.image_url}
          label={partnerLabel}
          side="left"
          onPress={() => onOpenImage({ canDelete: false, image: partner?.image_url, label: partnerLabel, mission })}
        />
        <EditablePhotoSlot
          deleting={deletingPhoto}
          image={mine?.image_url}
          label={myLabel}
          onOpenImage={() => onOpenImage({ canDelete: true, image: mine?.image_url, label: myLabel, mission })}
          side="right"
        />
      </>
    );
  }

  if (state === 'meOnly') {
    return (
      <>
        <WaitingSlot label={partnerLabel} t={t} />
        <EditablePhotoSlot
          deleting={deletingPhoto}
          image={mine?.image_url}
          label={myLabel}
          onOpenImage={() => onOpenImage({ canDelete: true, image: mine?.image_url, label: myLabel, mission })}
          side="right"
        />
      </>
    );
  }

  if (state === 'partnerOnly') {
    return (
      <>
        <LockedPhotoSlot image={partner?.image_url} label={partnerLabel} onPress={onLockedPartnerPress} t={t} />
        <SendSlot label={myLabel} onPress={onUploadPress} t={t} />
      </>
    );
  }

  return (
    <>
      <EmptySlot label={partnerLabel} icon="upload-cloud" message={language === 'ko' ? '아직 보내지 않았어요' : 'Not sent yet'} tone="blue" side="left" />
      <EmptySlot label={myLabel} icon="camera" message={language === 'ko' ? '눌러서 사진 보내기' : 'Tap to send a photo'} tone="sand" side="right" onPress={onUploadPress} />
    </>
  );
}

function getDropState(today: TodayDropPayload | null, myUserId: string): DropState {
  return getSubmissionState(today?.submissions ?? [], myUserId);
}

function getRecentDropState(drop: RecentDrop, myUserId: string): DropState {
  return getSubmissionState(drop.drop_submissions, myUserId);
}

function getSubmissionState(submissions: DropSubmission[], myUserId: string): DropState {
  const { mine, partner } = splitSubmissions(submissions, myUserId);

  if (mine && partner) return 'both';
  if (mine) return 'meOnly';
  if (partner) return 'partnerOnly';
  return 'none';
}

function getStateCopy(state: DropState, t: Copy, hasPartner: boolean) {
  if (!hasPartner) {
    return {
      message: t.soloTodayHint,
      button: t.connectPartnerFirst,
    };
  }

  switch (state) {
    case 'both':
      return { message: t.todayOpen, button: t.todayOpen };
    case 'meOnly':
      return {
        message: t.waitingPartner,
        button: t.sendDone,
      };
    case 'partnerOnly':
      return {
        message: `${t.partnerSent}\n${t.openAfterSend}`,
        button: t.sendMine,
      };
    default:
      return {
        message: t.openAfterSend,
        button: t.uploadPhoto,
      };
  }
}

function PrePartnerSlot({ t }: { t: Copy }) {
  return (
    <View style={[styles.dropSlot, styles.prePartnerSlot, sideRadius('left')]}>
      <Feather name="users" size={46} color="#8B8B8B" strokeWidth={1.45} />
      <Text allowFontScaling={false} style={styles.prePartnerTitle}>
        {t.beforePartner}
      </Text>
      <Text allowFontScaling={false} style={styles.prePartnerBody}>
        {t.beforePartnerBody}
      </Text>
    </View>
  );
}

function EmptySlot({
  icon,
  label,
  message,
  onPress,
  side,
  tone,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  message: string;
  onPress?: () => void;
  side: 'left' | 'right';
  tone: 'blue' | 'sand';
}) {
  const toneStyle = tone === 'blue' ? styles.blueSlot : styles.sandSlot;
  const toneColor = tone === 'blue' ? '#7890AE' : '#9B8D77';

  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.dropSlot, toneStyle, styles.emptyPhotoSlot, sideRadius(side)]}>
      <Feather name={icon} size={24} color={toneColor} strokeWidth={1.6} />
      <Text allowFontScaling={false} style={styles.emptyMessage}>
        {message}
      </Text>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.bottomLabelMuted}>
        {label}
      </Text>
    </Pressable>
  );
}

function WaitingSlot({ label, t }: { label: string; t: Copy }) {
  return (
    <View style={[styles.dropSlot, styles.waitingSlot, styles.emptyPhotoSlot, sideRadius('left')]}>
      <View style={styles.waitingContent}>
        <Feather name="refresh-cw" size={31} color="#858585" strokeWidth={1.65} />
        <Text allowFontScaling={false} style={styles.waitingText}>
          {t.waitingPartner}
        </Text>
      </View>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.bottomLabelMuted}>
        {label}
      </Text>
    </View>
  );
}

function PhotoSlot({ image, label, onPress, side }: { image?: string; label: string; onPress: () => void; side: 'left' | 'right' }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.imageSlot, sideRadius(side)]}>
      <SafeImage image={image} label={label} resizeMode="cover" />
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.photoLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function EditablePhotoSlot({
  deleting,
  image,
  label,
  onOpenImage,
  side,
}: {
  deleting: boolean;
  image?: string;
  label: string;
  onOpenImage: () => void;
  side: 'left' | 'right';
}) {
  return (
    <Pressable disabled={deleting} onPress={onOpenImage} style={[styles.dropSlot, styles.imageSlot, sideRadius(side)]}>
      <SafeImage image={image} label={label} resizeMode="cover" />
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.photoLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function LockedPhotoSlot({ image, label, onPress, t }: { image?: string; label: string; onPress: () => void; t: Copy }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.imageSlot, sideRadius('left')]}>
      <SafeImage blurRadius={24} image={image} label={label} resizeMode="cover" />
      <View pointerEvents="none" style={styles.partnerLockVeil} />
      <View style={[styles.lockContent, styles.partnerLockContent]}>
        <Feather name="lock" size={24} color="#FFFFFF" strokeWidth={2.1} />
        <Text allowFontScaling={false} numberOfLines={2} style={styles.partnerLockText}>
          {t.partnerSent}
        </Text>
      </View>
    </Pressable>
  );
}

function SendSlot({ label, message, onPress, t }: { label: string; message?: string; onPress: () => void; t: Copy }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.sendSlot, styles.emptyPhotoSlot, sideRadius('right')]}>
      <View style={styles.innerDashedSlot}>
        <View style={styles.plusCircle}>
          <Feather name="plus" size={20} color="#FFFFFF" strokeWidth={2.2} />
        </View>
        <Text allowFontScaling={false} style={styles.sendText}>
          {message ?? t.sendMine}
        </Text>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.bottomLabelMuted}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SafeImage({ blurRadius = 0, image, label, resizeMode = 'contain' }: { blurRadius?: number; image?: string; label: string; resizeMode?: SafeImageResizeMode }) {
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    setFailed(false);
  }, [image]);

  if (!image || failed) {
    return (
      <View style={styles.imageFallback}>
        <Feather name="image" size={26} color="#9A9A9A" />
      </View>
    );
  }

  return (
    <Image
      blurRadius={blurRadius}
      resizeMode={resizeMode}
      source={{ uri: image }}
      style={styles.slotImage}
      onError={(event) => {
        console.warn(`Daydrop image failed to load (${label})`, event.nativeEvent.error);
        setFailed(true);
      }}
    />
  );
}

function RecentDropRow({
  drop,
  hasPartner,
  language,
  myUserId,
  onPress,
}: {
  drop: RecentDrop;
  hasPartner: boolean;
  language: Language;
  myUserId: string;
  onPress: () => void;
}) {
  const { mine, partner } = React.useMemo(() => splitSubmissions(drop.drop_submissions, myUserId), [drop.drop_submissions, myUserId]);
  const shouldLock = hasPartner && !mine && Boolean(partner);
  const mineSize = useImageSize(mine?.image_url);
  const partnerSize = useImageSize(partner?.image_url);
  const mineHeight = calculateImageHeight(RECENT_THUMB_SLOT_WIDTH, mineSize, RECENT_THUMB_DEFAULT_HEIGHT);
  const partnerHeight = calculateImageHeight(RECENT_THUMB_SLOT_WIDTH, partnerSize, RECENT_THUMB_DEFAULT_HEIGHT);
  const thumbHeight = Math.max(mine ? mineHeight : 0, partner ? partnerHeight : 0, RECENT_THUMB_DEFAULT_HEIGHT);

  return (
    <Pressable onPress={onPress} style={[styles.recentRow, { minHeight: Math.max(88, thumbHeight + 6) }]}>
      <View style={[styles.recentThumbs, { height: thumbHeight }]}>
        <RecentThumb height={partner ? partnerHeight : thumbHeight} image={partner?.image_url} locked={shouldLock} side="left" />
        <RecentThumb height={mine ? mineHeight : thumbHeight} image={mine?.image_url} locked={false} side="right" />
      </View>
      <View style={styles.recentInfo}>
        <Text allowFontScaling={false} style={styles.recentDate}>
          {formatDate(drop.drop_date, language)}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.recentMission}>
          {getMissionPrompt(drop.mission, language)}
        </Text>
        <Text allowFontScaling={false} style={styles.recentMeta}>
          {formatDate(drop.drop_date, language)}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color="#777777" />
    </Pressable>
  );
}

function RecentThumb({ height = RECENT_THUMB_DEFAULT_HEIGHT, image, locked, side }: { height?: number; image?: string; locked: boolean; side: 'left' | 'right' }) {
  return (
    <View style={[styles.recentThumb, side === 'left' ? styles.recentThumbLeft : styles.recentThumbRight, { height }]}>
      {image ? <SafeImage blurRadius={locked ? 12 : 0} image={image} label={`recent-${side}`} /> : <View style={styles.recentPlaceholder} />}
      {locked ? (
        <>
          <View style={styles.recentLock}>
            <Feather name="lock" size={18} color="#FFFFFF" />
          </View>
        </>
      ) : null}
    </View>
  );
}

function FullImageModal({
  deleting,
  image,
  onClose,
  onDeletePress,
  t,
}: {
  deleting: boolean;
  image: FullImage | null;
  onClose: () => void;
  onDeletePress: () => void;
  t: Copy;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal animationType="fade" transparent visible={Boolean(image)} onRequestClose={onClose}>
      <View style={styles.fullModal}>
        <Pressable hitSlop={12} onPress={onClose} style={[styles.closeButton, { top: Math.max(insets.top + 12, 22) }]}>
          <Feather name="x" size={28} color="#FFFFFF" />
        </Pressable>
        {image?.image ? <Image resizeMode="contain" source={{ uri: image.image }} style={styles.fullImage} /> : null}
        <View style={[styles.fullCaption, { bottom: image?.canDelete ? Math.max(insets.bottom + 88, 96) : Math.max(insets.bottom + 26, 42) }]}>
          <Text allowFontScaling={false} style={styles.fullLabel}>
            {image?.label}
          </Text>
          <Text allowFontScaling={false} style={styles.fullMission}>
            {image?.mission}
          </Text>
        </View>
        {image?.canDelete ? (
          <Pressable
            disabled={deleting}
            onPress={onDeletePress}
            style={[styles.fullDeleteButton, { bottom: Math.max(insets.bottom + 18, 26) }, deleting && styles.fullDeleteButtonDisabled]}>
            {deleting ? (
              <ActivityIndicator color="#111111" size="small" />
            ) : (
              <Text allowFontScaling={false} style={styles.fullDeleteButtonText}>
                {t.deletePhoto}
              </Text>
            )}
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

function AllDropsModal({
  drops,
  hasPartner,
  language,
  myUserId,
  onClose,
  onOpenDrop,
  t,
  visible,
}: {
  drops: RecentDrop[];
  hasPartner: boolean;
  language: Language;
  myUserId: string;
  onClose: () => void;
  onOpenDrop: (drop: RecentDrop) => void;
  t: Copy;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modalHeader}>
          <Text allowFontScaling={false} style={styles.modalTitle}>
            {t.allDrops}
          </Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <Feather name="x" size={26} color="#111111" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.allDropsContent}>
          {drops.length === 0 ? (
            <InlineMessage text={t.noDrops} />
          ) : (
            drops.map((drop) => (
              <AllDropRow
                key={drop.id}
                drop={drop}
                hasPartner={hasPartner}
                language={language}
                myUserId={myUserId}
                onPress={() => {
                  onClose();
                  onOpenDrop(drop);
                }}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function AllDropRow({
  drop,
  hasPartner,
  language,
  myUserId,
  onPress,
}: {
  drop: RecentDrop;
  hasPartner: boolean;
  language: Language;
  myUserId: string;
  onPress: () => void;
}) {
  const { mine, partner } = React.useMemo(() => splitSubmissions(drop.drop_submissions, myUserId), [drop.drop_submissions, myUserId]);
  const shouldLock = hasPartner && !mine && Boolean(partner);

  return (
    <Pressable onPress={onPress} style={styles.allDropRow}>
      <View style={styles.allDropInfo}>
        <Text allowFontScaling={false} style={styles.recentDate}>
          {formatDate(drop.drop_date, language)}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.recentMission}>
          {getMissionPrompt(drop.mission, language)}
        </Text>
        <Text allowFontScaling={false} style={styles.recentMeta}>
          {formatDate(drop.drop_date, language)}
        </Text>
      </View>
      <View style={styles.allDropThumbs}>
        <RecentThumb image={partner?.image_url} locked={shouldLock} side="left" />
        <RecentThumb image={mine?.image_url} locked={false} side="right" />
      </View>
    </Pressable>
  );
}

function DropDetailModal({
  detail,
  hasPartner,
  language,
  myUserId,
  onClose,
  t,
}: {
  detail: DropDetail | null;
  hasPartner: boolean;
  language: Language;
  myUserId: string;
  onClose: () => void;
  t: Copy;
}) {
  const drop = detail?.drop;
  const submissions = React.useMemo(() => (drop ? splitSubmissions(drop.drop_submissions, myUserId) : { mine: null, partner: null }), [drop, myUserId]);
  const { mine, partner } = submissions;
  const shouldLock = hasPartner && detail?.state === 'partnerOnly' && Boolean(partner);

  return (
    <Modal animationType="slide" transparent visible={Boolean(detail)} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.detailSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.detailHeader}>
            <View style={styles.flex}>
              <Text allowFontScaling={false} style={styles.detailTitle}>
                {getMissionPrompt(drop?.mission, language)}
              </Text>
              <Text allowFontScaling={false} style={styles.detailMeta}>
                {drop ? formatDate(drop.drop_date, language) : ''}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}>
              <Feather name="x" size={24} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.detailPhotos}>
            <DetailPhoto image={partner?.image_url} label={t.partner} locked={shouldLock} side="left" />
            <DetailPhoto image={mine?.image_url} label={t.me} locked={false} side="right" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TodayShareSheet({
  language,
  onClose,
  photoPair,
  t,
  visible,
}: {
  language: Language;
  onClose: () => void;
  photoPair: SharePhotoPair | null;
  t: Copy;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const captureViewRef = React.useRef<View>(null);
  const imageLoadCountRef = React.useRef(0);
  const imageLoadRejectRef = React.useRef<((error: Error) => void) | null>(null);
  const imageLoadResolveRef = React.useRef<(() => void) | null>(null);
  const [canvasLayout, setCanvasLayout] = React.useState<ShareCanvasLayout | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!visible) {
      setCanvasLayout(null);
      setSaving(false);
    }
  }, [visible]);

  const handleCanvasImageLoad = () => {
    imageLoadCountRef.current += 1;
    if (imageLoadCountRef.current >= 2) {
      imageLoadResolveRef.current?.();
      imageLoadResolveRef.current = null;
      imageLoadRejectRef.current = null;
    }
  };

  const handleCanvasImageError = () => {
    imageLoadRejectRef.current?.(new Error('photo_read_failed'));
    imageLoadResolveRef.current = null;
    imageLoadRejectRef.current = null;
  };

  const handleSavePhoto = async () => {
    if (saving) {
      return;
    }

    if (!photoPair) {
      Alert.alert(t.savePhoto, t.photoReadError);
      return;
    }

    try {
      setSaving(true);
      const available = await MediaLibrary.isAvailableAsync();
      if (!available) {
        throw new Error('media_library_unavailable');
      }

      const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!permission.granted) {
        Alert.alert(t.photoPermission, language === 'ko' ? '앨범 저장 권한을 허용해주세요.' : 'Please allow photo saving access.');
        return;
      }

      const [leftSize, rightSize] = await Promise.all([getRemoteImageSize(photoPair.leftUri), getRemoteImageSize(photoPair.rightUri)]);
      const nextLayout = createShareCanvasLayout(photoPair, leftSize, rightSize);
      const imageLoadPromise = new Promise<void>((resolve, reject) => {
        imageLoadCountRef.current = 0;
        imageLoadResolveRef.current = resolve;
        imageLoadRejectRef.current = reject;
      });

      setCanvasLayout(nextLayout);
      await imageLoadPromise;
      await waitForNextFrame();

      if (!captureViewRef.current) {
        throw new Error('capture_view_missing');
      }

      const pixelRatio = PixelRatio.get();
      const savedUri = await captureRef(captureViewRef, {
        format: 'png',
        height: nextLayout.height / pixelRatio,
        quality: 1,
        result: 'tmpfile',
        width: nextLayout.width / pixelRatio,
      });

      await MediaLibrary.saveToLibraryAsync(savedUri);
      setCanvasLayout(null);
      onClose();
      Alert.alert(t.savePhoto, language === 'ko' ? '앨범에 저장했어요.' : 'Saved to your album.');
    } catch (nextError) {
      console.error('save today drop photo failed', nextError);
      Alert.alert(t.savePhoto, nextError instanceof Error && nextError.message === 'photo_read_failed' ? t.photoReadError : t.unknownError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.shareSheet, { paddingBottom: Math.max(insets.bottom + 18, 28) }]}>
          <View style={styles.sheetHandle} />
          <Text allowFontScaling={false} style={styles.shareSheetTitle}>
            {t.share}
          </Text>
          <Text allowFontScaling={false} style={styles.shareSheetBody}>
            {t.shareDropBody}
          </Text>
          <View style={styles.shareOptions}>
            <Pressable style={styles.shareOption}>
              <View style={styles.shareOptionIcon}>
                <Feather name="instagram" size={21} color="#111111" />
              </View>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.shareOptionText}>
                {t.shareToInstagramStory}
              </Text>
            </Pressable>
            <Pressable disabled={saving} onPress={handleSavePhoto} style={[styles.shareOption, saving && styles.shareOptionDisabled]}>
              <View style={styles.shareOptionIcon}>
                {saving ? <ActivityIndicator color="#111111" /> : <Feather name="download" size={21} color="#111111" />}
              </View>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.shareOptionText}>
                {t.savePhoto}
              </Text>
            </Pressable>
          </View>
          {canvasLayout ? (
            <View
              collapsable={false}
              ref={captureViewRef}
              style={[
                styles.shareCaptureCanvas,
                {
                  height: canvasLayout.height / PixelRatio.get(),
                  width: canvasLayout.width / PixelRatio.get(),
                },
              ]}>
              <Image
                key={`left-${canvasLayout.key}`}
                onError={handleCanvasImageError}
                onLoad={handleCanvasImageLoad}
                resizeMode="contain"
                source={{ uri: canvasLayout.leftUri }}
                style={{
                  height: canvasLayout.left.height / PixelRatio.get(),
                  width: canvasLayout.left.width / PixelRatio.get(),
                }}
              />
              <Image
                key={`right-${canvasLayout.key}`}
                onError={handleCanvasImageError}
                onLoad={handleCanvasImageLoad}
                resizeMode="contain"
                source={{ uri: canvasLayout.rightUri }}
                style={{
                  height: canvasLayout.right.height / PixelRatio.get(),
                  width: canvasLayout.right.width / PixelRatio.get(),
                }}
              />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailPhoto({ image, label, locked, side }: { image?: string; label: string; locked: boolean; side: 'left' | 'right' }) {
  return (
    <View style={[styles.detailPhoto, !image && styles.emptyPhotoSlot, !image && styles.detailEmptyPhotoSlot, sideRadius(side)]}>
      {image ? <SafeImage blurRadius={locked ? 16 : 0} image={image} label={`detail-${label}`} resizeMode="cover" /> : <View style={styles.detailPlaceholder} />}
      {locked ? (
        <>
          <View style={styles.lockContent}>
            <Feather name="lock" size={28} color="#FFFFFF" />
          </View>
        </>
      ) : null}
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.photoLabel}>
        {label}
      </Text>
    </View>
  );
}

function PermissionIntroModal({ language, onClose, visible }: { language: Language; onClose: () => void; visible: boolean }) {
  const title = language === 'ko' ? '카메라/사진 권한 안내' : 'Camera & Photos';
  const body =
    language === 'ko'
      ? '사진을 찍고 공유하려면 카메라/사진 권한이 필요해요. 권한 요청은 사진을 보내거나 찍을 때만 표시됩니다.'
      : 'Daydrop needs camera/photos access to take and share daily photos. The native permission prompt appears only when you send or take a photo.';

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.centerModalBackdrop}>
        <View style={styles.centerModalCard}>
          <Feather name="camera" size={30} color="#111111" />
          <Text allowFontScaling={false} style={styles.deleteTitle}>
            {title}
          </Text>
          <Text allowFontScaling={false} style={styles.privacyText}>
            {body}
          </Text>
          <Pressable onPress={onClose} style={styles.primaryButton}>
            <Text allowFontScaling={false} style={styles.primaryButtonText}>
              {language === 'ko' ? '확인' : 'OK'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SettingsSheet({
  language,
  onClose,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  profile,
  t,
  visible,
}: {
  language: Language;
  onClose: () => void;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  profile: Profile;
  t: Copy;
  visible: boolean;
}) {
  const [mode, setMode] = React.useState<
    'menu' | 'edit' | 'language' | 'notifications' | 'notices' | 'deleteIntro' | 'deleteFinal'
  >('menu');
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
  const [deletingAccount, setDeletingAccount] = React.useState(false);
  const [savingLanguage, setSavingLanguage] = React.useState(false);
  const [notificationPermission, setNotificationPermission] = React.useState<'checking' | 'granted' | 'denied' | 'undetermined'>(
    'checking'
  );
  const [notificationPreferences, setNotificationPreferences] =
    React.useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [loadingNotificationPreferences, setLoadingNotificationPreferences] = React.useState(false);
  const [requestingNotificationPermission, setRequestingNotificationPermission] = React.useState(false);
  const [clearingCache, setClearingCache] = React.useState(false);
  const languageLabel = language === 'ko' ? t.korean : t.english;
  const accountSubtitle = language === 'ko' ? '이름, 국가, 도시, 언어' : 'Name, country, city, language';
  const pushEnabled = notificationPreferences.pushEnabled;
  const notificationDisabledBySystem = notificationPermission === 'denied';
  const notificationStatusText = !pushEnabled
    ? language === 'ko'
      ? '꺼짐'
      : 'Off'
    : notificationPermission === 'granted'
      ? language === 'ko'
        ? '켜짐'
        : 'On'
      : notificationPermission === 'denied'
        ? language === 'ko'
          ? '권한 필요'
          : 'Needs permission'
        : notificationPermission === 'undetermined'
          ? language === 'ko'
            ? '권한 필요'
            : 'Needs permission'
          : language === 'ko'
            ? '확인 중'
            : 'Checking';

  React.useEffect(() => {
    if (visible) {
      setMode('menu');
      setDeleteConfirmText('');
    }
  }, [visible]);

  const refreshNotificationPermission = React.useCallback(async () => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      const granted =
        settings.granted ||
        settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
        settings.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;

      if (granted) {
        setNotificationPermission('granted');
      } else if (settings.status === 'denied' || settings.canAskAgain === false) {
        setNotificationPermission('denied');
      } else {
        setNotificationPermission('undetermined');
      }
    } catch (error) {
      console.warn('notification permission check failed', error);
      setNotificationPermission('undetermined');
    }
  }, []);

  React.useEffect(() => {
    if (!visible) {
      return;
    }
    void refreshNotificationPermission();
  }, [refreshNotificationPermission, visible]);

  React.useEffect(() => {
    if (!visible) {
      return;
    }

    let mounted = true;
    setLoadingNotificationPreferences(true);
    getNotificationPreferences()
      .then((preferences) => {
        if (mounted) {
          setNotificationPreferences(preferences);
        }
      })
      .catch((error) => {
        console.warn('notification preferences load failed', error);
      })
      .finally(() => {
        if (mounted) {
          setLoadingNotificationPreferences(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [visible]);

  const changeLanguage = async (nextLanguage: Language) => {
    if (nextLanguage === language || savingLanguage) {
      return;
    }
    setSavingLanguage(true);
    try {
      onLanguageChanged(await updatePreferredLanguage(nextLanguage));
    } catch (error) {
      console.error('language update failed', error);
      Alert.alert(t.profileSaveError, t.unknownError);
    } finally {
      setSavingLanguage(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(t.logout, t.logoutQuestion, [
      { text: t.cancel, style: 'cancel' },
      {
        text: t.logout,
        style: 'destructive',
        onPress: async () => {
          onClose();
          await onLogout();
        },
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount || !isDeleteConfirmText(deleteConfirmText)) {
      return;
    }

    setDeletingAccount(true);
    try {
      await deleteAccount();
      await onLogout();
      onClose();
    } catch (error) {
      console.error('delete account failed', error);
      Alert.alert(t.deleteAccountError, t.unknownError);
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleRequestNotificationPermission = async () => {
    if (requestingNotificationPermission) {
      return;
    }
    setRequestingNotificationPermission(true);
    try {
      await registerPushToken();
    } catch (error) {
      console.warn('notification permission request failed', error);
    } finally {
      await refreshNotificationPermission();
      setRequestingNotificationPermission(false);
    }
  };

  const handleNotificationToggle = async (key: NotificationPreferenceKey, value: boolean) => {
    const nextPreferences = {
      ...notificationPreferences,
      [key]: value,
    };
    setNotificationPreferences(nextPreferences);

    try {
      await saveNotificationPreferences(nextPreferences);

      if (key === 'pushEnabled') {
        if (value) {
          await handleRequestNotificationPermission();
        } else {
          await setCurrentUserPushTokensEnabled(false);
        }
      }
    } catch (error) {
      console.warn('notification preferences save failed', error);
      setNotificationPreferences(notificationPreferences);
      Alert.alert(
        language === 'ko' ? '알림 설정' : 'Notification Settings',
        language === 'ko' ? '알림 설정을 저장하지 못했어요. 다시 시도해주세요.' : 'Could not save notification settings. Please try again.'
      );
    }
  };

  const handleOpenNotificationSettings = async () => {
    try {
      await Linking.openSettings();
    } catch (error) {
      console.warn('open settings failed', error);
      Alert.alert(language === 'ko' ? '알림 설정' : 'Notification Settings', language === 'ko' ? '설정을 열 수 없어요.' : 'Could not open Settings.');
    }
  };

  const clearLocalCache = async () => {
    if (clearingCache) {
      return;
    }

    setClearingCache(true);
    try {
      const cacheRoot = FileSystem.cacheDirectory;
      if (!cacheRoot) {
        throw new Error('cache directory is not available');
      }

      const entries = await FileSystem.readDirectoryAsync(cacheRoot);
      await Promise.all(
        entries.map(async (entry) => {
          const target = `${cacheRoot}${entry}`;
          try {
            await FileSystem.deleteAsync(target, { idempotent: true });
          } catch (error) {
            console.warn('cache delete skipped', target, error);
          }
        })
      );
      Alert.alert(language === 'ko' ? '캐시를 지웠어요.' : 'Cache cleared.');
    } catch (error) {
      console.warn('clear cache failed', error);
      Alert.alert(
        language === 'ko' ? '캐시를 지우지 못했어요. 다시 시도해주세요.' : 'Could not clear the cache. Please try again.'
      );
    } finally {
      setClearingCache(false);
    }
  };

  const handleClearCache = async () => {
    if (clearingCache) {
      return;
    }

    Alert.alert(
      language === 'ko' ? '캐시를 지울까요?' : 'Clear cache?',
      language === 'ko'
        ? '저장된 임시 이미지와 캐시가 삭제됩니다. 필요한 사진은 다시 불러와야 할 수 있어요.'
        : 'Saved temporary images and cache will be deleted. Some photos may need to be loaded again.',
      [
        { text: language === 'ko' ? '취소' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ko' ? '캐시 지우기' : 'Clear Cache',
          style: 'destructive',
          onPress: () => {
            void clearLocalCache();
          },
        },
      ]
    );
  };

  const handleOpenSupportEmail = async () => {
    const subject = '[Daydrop Support]';
    const body = [
      'App: Daydrop',
      `Version: ${Application.nativeApplicationVersion ?? 'unknown'} (${Application.nativeBuildVersion ?? 'unknown'})`,
      `Platform: ${Platform.OS} ${String(Platform.Version)}`,
      `Device: ${Device.modelName ?? 'unknown'}`,
      '',
      language === 'ko' ? '문의 내용을 작성해주세요.' : 'Please describe your issue here.',
    ].join('\n');

    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        throw new Error('mailto not supported');
      }
      await Linking.openURL(url);
    } catch (error) {
      console.warn('open mail app failed', error);
      Alert.alert(
        language === 'ko' ? '문의 이메일' : 'Support Email',
        language === 'ko'
          ? `메일 앱을 열 수 없어요.\n${SUPPORT_EMAIL}`
          : `Could not open the mail app.\n${SUPPORT_EMAIL}`
      );
    }
  };

  const openPrivacyPolicy = async () => {
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch (error) {
      console.warn('open privacy policy failed', error);
      Alert.alert(
        language === 'ko' ? '개인정보 처리방침' : 'Privacy Policy',
        language === 'ko'
          ? `브라우저를 열 수 없어요.\n${PRIVACY_POLICY_URL}`
          : `Could not open the browser.\n${PRIVACY_POLICY_URL}`
      );
    }
  };

  const title =
    mode === 'edit'
      ? t.editProfile
      : mode === 'notifications'
        ? language === 'ko'
          ? '알림 설정'
          : 'Notification Settings'
        : mode === 'notices'
          ? language === 'ko'
            ? '공지사항'
            : 'Notices'
        : mode === 'language'
          ? t.language
          : mode === 'deleteIntro' || mode === 'deleteFinal'
            ? t.deleteAccount
            : t.settings;


  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={styles.settingsScreen}>
        <View style={styles.settingsHeader}>
          <Pressable hitSlop={12} onPress={mode === 'menu' ? onClose : () => setMode('menu')} style={styles.settingsBackButton}>
            <Feather name="chevron-left" size={28} color="#111111" />
          </Pressable>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.settingsTitle}>
            {title}
          </Text>
          <View style={styles.settingsHeaderSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.settingsContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {mode === 'edit' ? (
            <View style={styles.settingsDetail}>
              <ProfileForm
                initialLanguage={language}
                profile={profile}
                onCancel={() => setMode('menu')}
                onSaved={async (nextProfile) => {
                  await onProfileSaved(nextProfile);
                  setMode('menu');
                }}
              />
            </View>
          ) : mode === 'language' ? (
            <View style={styles.settingsDetail}>
              <View style={styles.settingsLanguageSheet}>
                <Pressable
                  disabled={savingLanguage}
                  onPress={() => changeLanguage('ko')}
                  style={[styles.languageChoiceRow, language === 'ko' && styles.languageChoiceRowActive]}>
                  <Text allowFontScaling={false} style={styles.languageChoiceText}>
                    {t.korean}
                  </Text>
                  {language === 'ko' ? <Feather name="check" size={20} color="#111111" /> : null}
                </Pressable>
                <Pressable
                  disabled={savingLanguage}
                  onPress={() => changeLanguage('en')}
                  style={[styles.languageChoiceRow, styles.languageChoiceRowLast, language === 'en' && styles.languageChoiceRowActive]}>
                  <Text allowFontScaling={false} style={styles.languageChoiceText}>
                    {t.english}
                  </Text>
                  {language === 'en' ? <Feather name="check" size={20} color="#111111" /> : null}
                </Pressable>
              </View>
            </View>
          ) : mode === 'notifications' ? (
            <View style={styles.settingsDetail}>
              <View style={styles.notificationIntro}>
                <Text allowFontScaling={false} style={styles.notificationIntroText}>
                  {language === 'ko'
                    ? 'Daydrop은 오늘의 질문, 파트너의 사진 업로드, 파트너 연결 소식을 알려드려요.'
                    : "Daydrop sends updates for today's question, partner photo uploads, and partner connections."}
                </Text>
              </View>

              {notificationDisabledBySystem ? (
                <View style={styles.notificationPermissionBox}>
                  <Text allowFontScaling={false} style={styles.notificationPermissionTitle}>
                    {language === 'ko' ? 'iPhone 설정에서 Daydrop 알림을 켜주세요.' : 'Turn on Daydrop notifications in iPhone Settings.'}
                  </Text>
                  <Pressable onPress={handleOpenNotificationSettings} style={styles.notificationSettingsButton}>
                    <Text allowFontScaling={false} style={styles.notificationSettingsButtonText}>
                      {language === 'ko' ? '설정 열기' : 'Open Settings'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              {notificationPermission === 'undetermined' ? (
                <Pressable
                  disabled={requestingNotificationPermission}
                  onPress={handleRequestNotificationPermission}
                  style={[styles.notificationSettingsButton, styles.notificationPermissionRequestButton, requestingNotificationPermission && styles.disabledButton]}>
                  {requestingNotificationPermission ? (
                    <ActivityIndicator color="#111111" />
                  ) : (
                    <Text allowFontScaling={false} style={styles.notificationSettingsButtonText}>
                      {language === 'ko' ? '알림 권한 허용하기' : 'Allow Notifications'}
                    </Text>
                  )}
                </Pressable>
              ) : null}

              <SettingsSection title={language === 'ko' ? 'PUSH NOTIFICATIONS' : 'PUSH NOTIFICATIONS'}>
                <NotificationToggleRow
                  disabled={loadingNotificationPreferences}
                  title={language === 'ko' ? '푸시 알림' : 'Push Notifications'}
                  subtitle={
                    language === 'ko'
                      ? 'Daydrop의 모든 푸시 알림을 켜거나 꺼요.'
                      : 'Turn all Daydrop push notifications on or off.'
                  }
                  value={pushEnabled}
                  onValueChange={(value) => void handleNotificationToggle('pushEnabled', value)}
                />
                <NotificationToggleRow
                  disabled={!pushEnabled || loadingNotificationPreferences}
                  title={language === 'ko' ? '오늘 질문 알림' : "Today's Question"}
                  subtitle={
                    language === 'ko'
                      ? '새로운 오늘의 질문이 준비되면 알려드려요. 기기 시간대 기준 오후 12시에 도착해요.'
                      : "Get notified when today's question is ready. It arrives at 12:00 PM in your device timezone."
                  }
                  value={notificationPreferences.dailyQuestion}
                  onValueChange={(value) => void handleNotificationToggle('dailyQuestion', value)}
                />
                <NotificationToggleRow
                  disabled={!pushEnabled || loadingNotificationPreferences}
                  title={language === 'ko' ? '파트너 사진 업로드 알림' : 'Partner Photo Uploads'}
                  subtitle={
                    language === 'ko'
                      ? '파트너가 오늘의 사진을 올리면 알려드려요.'
                      : "Get notified when your partner uploads today's photo."
                  }
                  value={notificationPreferences.partnerPhotoUploaded}
                  onValueChange={(value) => void handleNotificationToggle('partnerPhotoUploaded', value)}
                />
                <NotificationToggleRow
                  disabled={!pushEnabled || loadingNotificationPreferences}
                  showDivider={false}
                  title={language === 'ko' ? '파트너 연결 알림' : 'Partner Connections'}
                  subtitle={
                    language === 'ko'
                      ? '새 파트너 연결이 완료되면 알려드려요.'
                      : 'Get notified when a new partner connection is complete.'
                  }
                  value={notificationPreferences.partnerConnected}
                  onValueChange={(value) => void handleNotificationToggle('partnerConnected', value)}
                />
              </SettingsSection>

              {!pushEnabled ? (
                <Text allowFontScaling={false} style={styles.notificationMutedHint}>
                  {language === 'ko' ? '푸시 알림이 꺼져 있어 하위 알림도 비활성화되어 있어요.' : 'Push notifications are off, so the options below are disabled.'}
                </Text>
              ) : null}
            </View>
          ) : mode === 'notices' ? (
            <View style={styles.settingsDetail}>
              <Text allowFontScaling={false} style={styles.noticeVersion}>
                {Application.nativeApplicationVersion ? `Daydrop v${Application.nativeApplicationVersion}` : 'Daydrop'}
              </Text>
              <Text allowFontScaling={false} style={styles.privacyText}>
                {language === 'ko'
                  ? '앱 업데이트, 점검 안내, 중요한 변경 사항을 이곳에서 확인할 수 있어요.'
                  : 'App updates, maintenance notices, and important changes will appear here.'}
              </Text>
              <Text allowFontScaling={false} style={styles.privacyHint}>
                {language === 'ko' ? '현재 등록된 공지사항은 없어요.' : 'There are no notices right now.'}
              </Text>
            </View>
          ) : mode === 'deleteIntro' ? (
            <View style={styles.settingsDetail}>
              <Text allowFontScaling={false} style={styles.deleteTitle}>
                {t.deleteAccountTitle}
              </Text>
              <Text allowFontScaling={false} style={styles.privacyText}>
                {t.deleteAccountBody}
              </Text>
              <Pressable onPress={() => setMode('deleteFinal')} style={styles.dangerButton}>
                <Text allowFontScaling={false} style={styles.logoutText}>
                  {language === 'ko' ? '계속' : 'Continue'}
                </Text>
              </Pressable>
              <Pressable onPress={() => setMode('menu')} style={styles.outlineButton}>
                <Text allowFontScaling={false} style={styles.outlineButtonText}>
                  {t.cancel}
                </Text>
              </Pressable>
            </View>
          ) : mode === 'deleteFinal' ? (
            <View style={styles.settingsDetail}>
              <Text allowFontScaling={false} style={styles.privacyText}>
                {t.deleteAccountFinalBody}
              </Text>
              <TextInput
                autoCapitalize="characters"
                editable={!deletingAccount}
                onChangeText={setDeleteConfirmText}
                placeholder={t.deleteAccountFinalPlaceholder}
                style={styles.input}
                value={deleteConfirmText}
              />
              <Pressable
                disabled={deletingAccount || !isDeleteConfirmText(deleteConfirmText)}
                onPress={handleDeleteAccount}
                style={[
                  styles.dangerButton,
                  (deletingAccount || !isDeleteConfirmText(deleteConfirmText)) && styles.disabledButton,
                ]}>
                {deletingAccount ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text allowFontScaling={false} style={styles.logoutText}>
                    {t.deleteAccountConfirm}
                  </Text>
                )}
              </Pressable>
              <Pressable disabled={deletingAccount} onPress={() => setMode('menu')} style={styles.outlineButton}>
                <Text allowFontScaling={false} style={styles.outlineButtonText}>
                  {t.cancel}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <SettingsSection title="Account">
                <SettingsRow
                  icon="user"
                  title="My Account"
                  subtitle={accountSubtitle}
                  onPress={() => setMode('edit')}
                  showDivider={false}
                />
              </SettingsSection>

              <SettingsSection title="App Settings">
                <SettingsRow icon="globe" title={t.language} rightValue={languageLabel} onPress={() => setMode('language')} />
                <SettingsRow
                  icon="bell"
                  title={language === 'ko' ? '알림 설정' : 'Notification Settings'}
                  rightValue={notificationStatusText}
                  onPress={() => setMode('notifications')}
                />
                <SettingsRow
                  icon="trash-2"
                  title={language === 'ko' ? '캐시 지우기' : 'Clear Cache'}
                  rightValue={clearingCache ? (language === 'ko' ? '정리 중' : 'Clearing') : undefined}
                  onPress={handleClearCache}
                  showDivider={false}
                />
              </SettingsSection>

              <SettingsSection title="Support">
                <SettingsRow
                  icon="volume-2"
                  title={language === 'ko' ? '공지사항' : 'Notices'}
                  onPress={() => setMode('notices')}
                />
                <SettingsRow
                  icon="mail"
                  title={language === 'ko' ? '문의 / 지원' : 'Contact / Support'}
                  onPress={handleOpenSupportEmail}
                />
                <SettingsRow icon="shield" title={t.privacyPolicy} onPress={openPrivacyPolicy} showDivider={false} />
              </SettingsSection>

              <SettingsSection title="Danger Zone">
                <SettingsRow danger icon="user-x" title={t.deleteAccount} onPress={() => setMode('deleteIntro')} showDivider={false} />
              </SettingsSection>

              <Pressable accessibilityRole="button" onPress={handleLogout} style={styles.settingsFooterButton}>
                <Text allowFontScaling={false} style={styles.settingsFooterButtonText}>
                  {t.logout}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.settingsSection}>
      <Text allowFontScaling={false} style={styles.settingsSectionTitle}>
        {title}
      </Text>
      <View style={styles.settingsList}>{children}</View>
    </View>
  );
}

function SettingsRow({
  danger,
  icon,
  onPress,
  rightValue,
  showDivider = true,
  subtitle,
  title,
}: {
  danger?: boolean;
  icon?: FeatherIconName;
  onPress: () => void;
  rightValue?: string;
  showDivider?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.settingsRow, !showDivider && styles.settingsRowLast]}>
      {icon ? (
        <View style={[styles.settingsRowIcon, danger && styles.settingsRowDangerIcon]}>
          <Feather name={icon} size={18} color={danger ? '#C9342C' : '#4A4A4D'} />
        </View>
      ) : null}
      <View style={styles.settingsRowTextWrap}>
        <Text allowFontScaling={false} numberOfLines={1} style={[styles.settingsRowTitle, danger && styles.settingsRowDangerText]}>
          {title}
        </Text>
        {subtitle ? (
          <Text allowFontScaling={false} numberOfLines={1} style={styles.settingsRowSubtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightValue ? (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.settingsRowValue}>
          {rightValue}
        </Text>
      ) : null}
      <Feather name="chevron-right" size={19} color="#C7C7CC" style={styles.settingsRowChevron} />
    </Pressable>
  );
}

function NotificationToggleRow({
  disabled,
  onValueChange,
  showDivider = true,
  subtitle,
  title,
  value,
}: {
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
  showDivider?: boolean;
  subtitle: string;
  title: string;
  value: boolean;
}) {
  return (
    <View style={[styles.notificationToggleRow, !showDivider && styles.settingsRowLast, disabled && styles.notificationToggleRowDisabled]}>
      <View style={styles.notificationToggleTextWrap}>
        <Text allowFontScaling={false} style={styles.notificationToggleTitle}>
          {title}
        </Text>
        <Text allowFontScaling={false} style={styles.notificationToggleSubtitle}>
          {subtitle}
        </Text>
      </View>
      <Switch
        disabled={disabled}
        ios_backgroundColor="#D1D1D6"
        onValueChange={onValueChange}
        thumbColor="#FFFFFF"
        trackColor={{ false: '#D1D1D6', true: '#34C759' }}
        value={value}
      />
    </View>
  );
}

function useImageSize(image?: string): ImageSize | null {
  const [size, setSize] = React.useState<ImageSize | null>(null);

  React.useEffect(() => {
    let mounted = true;
    setSize(null);

    if (!image) {
      return;
    }

    Image.getSize(
      image,
      (width, height) => {
        if (mounted) {
          setSize({ height, width });
          console.log('[photo] display image size', { uri: image, width, height });
        }
      },
      (error) => {
        console.warn('[photo] display image size lookup failed', { uri: image, error });
      }
    );

    return () => {
      mounted = false;
    };
  }, [image]);

  return size;
}

function getRemoteImageSize(image: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      image,
      (width, height) => {
        if (width > 0 && height > 0) {
          resolve({ height, width });
        } else {
          reject(new Error('photo_read_failed'));
        }
      },
      () => reject(new Error('photo_read_failed'))
    );
  });
}

function createShareCanvasLayout(pair: SharePhotoPair, leftSize: ImageSize, rightSize: ImageSize): ShareCanvasLayout {
  const targetHeight = Math.max(1, Math.min(SHARE_IMAGE_MAX_HEIGHT, leftSize.height, rightSize.height));
  const leftWidth = Math.max(1, Math.round(leftSize.width * (targetHeight / leftSize.height)));
  const rightWidth = Math.max(1, Math.round(rightSize.width * (targetHeight / rightSize.height)));

  return {
    height: targetHeight,
    key: Date.now(),
    left: {
      height: targetHeight,
      width: leftWidth,
    },
    leftUri: pair.leftUri,
    right: {
      height: targetHeight,
      width: rightWidth,
    },
    rightUri: pair.rightUri,
    width: leftWidth + rightWidth,
  };
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function calculateImageHeight(slotWidth: number, size: ImageSize | null, fallbackHeight: number) {
  if (slotWidth <= 0 || !size || size.width <= 0 || size.height <= 0) {
    return fallbackHeight;
  }

  return slotWidth * (size.height / size.width);
}

function isDeleteConfirmText(value: string) {
  const normalized = value.trim();
  return normalized === 'DELETE' || normalized === '삭제' || normalized === 'ì‚­ì œ';
}

function LanguageButton({ active, disabled, label, onPress }: { active: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.segmentButton, active && styles.segmentButtonActive]}>
      <Text allowFontScaling={false} style={[styles.segmentText, active && styles.segmentTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function AuthScreen({ language }: { language: Language }) {
  const t = getTranslations(language);
  const [mode, setMode] = React.useState<'login' | 'signup'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [socialLoading, setSocialLoading] = React.useState<'google' | 'apple' | null>(null);
  const [appleAvailable, setAppleAvailable] = React.useState(false);
  const authSubmittingRef = React.useRef(false);
  const isSubmitting = loading || Boolean(socialLoading);

  React.useEffect(() => {
    let mounted = true;

    if (Platform.OS !== 'ios') {
      return;
    }

    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) {
          setAppleAvailable(available);
        }
      })
      .catch((error) => {
        console.warn('apple auth availability check failed', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const submit = async () => {
    if (authSubmittingRef.current) {
      return;
    }

    authSubmittingRef.current = true;
    if (!email.trim() || password.length < 6) {
      authSubmittingRef.current = false;
      Alert.alert(t.confirm, language === 'ko' ? '이메일과 6자리 이상의 비밀번호가 필요해요.' : 'Email and a password of at least 6 characters are required.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
        Alert.alert(t.completeSignup, t.signupPrompt);
      }
    } catch (error) {
      console.error('auth failed', error);
      Alert.alert(t.authError, t.unknownError);
    } finally {
      authSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (authSubmittingRef.current) {
      return;
    }

    authSubmittingRef.current = true;
    setSocialLoading('google');
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error('google sign-in failed', error);
      Alert.alert(t.socialSignInFailed, t.tryAgain);
    } finally {
      authSubmittingRef.current = false;
      setSocialLoading(null);
    }
  };

  const handleAppleSignIn = async () => {
    if (authSubmittingRef.current) {
      return;
    }

    authSubmittingRef.current = true;
    setSocialLoading('apple');
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('missing_apple_identity_token');
      }

      await signInWithAppleIdToken(credential.identityToken);
    } catch (error) {
      if (isAppleAuthCanceled(error)) {
        return;
      }

      console.error('apple sign-in failed', error);
      Alert.alert(t.socialSignInFailed, t.tryAgain);
    } finally {
      authSubmittingRef.current = false;
      setSocialLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <View style={styles.authWrap}>
          <Text allowFontScaling={false} style={styles.logo}>
            DAYDROP
          </Text>
          <Text allowFontScaling={false} style={styles.authTitle}>
            {mode === 'login' ? t.login : t.signup}
          </Text>
          <TextInput autoCapitalize="none" editable={!isSubmitting} keyboardType="email-address" onChangeText={setEmail} placeholder="email@example.com" style={styles.input} value={email} />
          <TextInput editable={!isSubmitting} onChangeText={setPassword} placeholder={t.password} secureTextEntry style={styles.input} value={password} />
          <Pressable disabled={isSubmitting} onPress={submit} style={[styles.primaryButton, isSubmitting && styles.disabledButton]}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text allowFontScaling={false} style={styles.primaryButtonText}>
                {mode === 'login' ? t.login : t.signup}
              </Text>
            )}
          </Pressable>
          <View style={styles.socialAuthGroup}>
            <Pressable
              disabled={isSubmitting}
              onPress={handleGoogleSignIn}
              style={[styles.socialAuthButton, isSubmitting && styles.disabledButton]}>
              {socialLoading === 'google' ? (
                <ActivityIndicator color="#111111" />
              ) : (
                <>
                  <Feather name="chrome" size={19} color="#111111" />
                  <Text allowFontScaling={false} style={styles.socialAuthButtonText}>
                    {t.continueWithGoogle}
                  </Text>
                </>
              )}
            </Pressable>
            {appleAvailable ? (
              <Pressable
                disabled={isSubmitting}
                onPress={handleAppleSignIn}
                style={[styles.socialAuthButton, styles.appleAuthButton, isSubmitting && styles.disabledButton]}>
                {socialLoading === 'apple' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Feather name="smartphone" size={19} color="#FFFFFF" />
                    <Text allowFontScaling={false} style={[styles.socialAuthButtonText, styles.appleAuthButtonText]}>
                      {t.continueWithApple}
                    </Text>
                  </>
                )}
              </Pressable>
            ) : null}
          </View>
          <Pressable disabled={isSubmitting} onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            <Text allowFontScaling={false} style={styles.secondaryAction}>
              {mode === 'login' ? (language === 'ko' ? '계정 만들기' : 'Create account') : language === 'ko' ? '이미 계정이 있어요' : 'I already have an account'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileSetupScreen({
  language,
  onLogout,
  onSaved,
  profile,
}: {
  language: Language;
  onLogout: () => Promise<void>;
  onSaved: (profile: Profile) => Promise<void>;
  profile: Profile | null;
}) {
  const t = getTranslations(language);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.logo}>
            DAYDROP
          </Text>
          <Pressable hitSlop={12} onPress={onLogout}>
            <Feather name="log-out" size={25} color="#050505" />
          </Pressable>
        </View>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {t.enterProfile}
        </Text>
        <View style={styles.missionCard}>
          <ProfileForm initialLanguage={language} profile={profile} onSaved={onSaved} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileForm({
  initialLanguage,
  onCancel,
  onSaved,
  profile,
}: {
  initialLanguage: Language;
  onCancel?: () => void;
  onSaved: (profile: Profile) => Promise<void>;
  profile: Profile | null;
}) {
  const initialCountryCode = findCountryOption(profile?.country)?.code ?? null;
  const [displayName, setDisplayName] = React.useState(profile?.display_name ?? '');
  const [countryCode, setCountryCode] = React.useState<string | null>(initialCountryCode);
  const [countryQuery, setCountryQuery] = React.useState(initialCountryCode ? getCountryLabel(initialCountryCode, initialLanguage) : profile?.country ?? '');
  const [countryPickerOpen, setCountryPickerOpen] = React.useState(false);
  const [city, setCity] = React.useState(profile?.city ?? '');
  const [preferredLanguage, setPreferredLanguage] = React.useState<Language>(normalizeLanguage(profile?.preferred_language ?? initialLanguage));
  const [saving, setSaving] = React.useState(false);
  const formT = getTranslations(preferredLanguage);
  const countryOptions = searchCountryOptions(countryQuery);

  React.useEffect(() => {
    if (!countryCode) {
      return;
    }

    setCountryQuery(getCountryLabel(countryCode, preferredLanguage));
  }, [countryCode, preferredLanguage]);

  const save = async () => {
    if (!displayName.trim() || !countryCode || !city.trim()) {
      const missing = [
        !displayName.trim() ? formT.name : null,
        !countryCode ? formT.selectCountry : null,
        !city.trim() ? formT.city : null,
      ]
        .filter(Boolean)
        .join(', ');

      Alert.alert(formT.confirm, missing);
      return;
    }

    const input: ProfileInput = {
      displayName,
      country: countryCode,
      city,
      preferredLanguage,
    };

    setSaving(true);
    try {
      await onSaved(await completeProfile(input));
    } catch (error) {
      console.error('profile save failed', error);
      Alert.alert(formT.profileSaveError, formT.unknownError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <TextInput onChangeText={setDisplayName} placeholder={formT.name} style={styles.input} value={displayName} />
      <View style={styles.countryPickerWrap}>
        <TextInput
          autoCorrect={false}
          onChangeText={(text) => {
            const selectedLabel = countryCode ? getCountryLabel(countryCode, preferredLanguage) : '';

            setCountryQuery(text);
            setCountryPickerOpen(true);

            if (!selectedLabel || text.trim().toLowerCase() !== selectedLabel.trim().toLowerCase()) {
              setCountryCode(null);
            }
          }}
          onFocus={() => setCountryPickerOpen(true)}
          placeholder={formT.searchCountry}
          style={[styles.input, countryPickerOpen && styles.countryInputOpen]}
          value={countryQuery}
        />
        {countryPickerOpen ? (
          <View style={styles.countryList}>
            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.countryListScroll}>
              {countryOptions.length === 0 ? (
                <Text allowFontScaling={false} style={styles.countryEmptyText}>
                  {formT.countryNotFound}
                </Text>
              ) : (
                countryOptions.map((option, index) => {
                  const label = getCountryLabel(option.code, preferredLanguage);
                  const selected = option.code === countryCode;

                  return (
                    <Pressable
                      key={option.code}
                      onPress={() => {
                        setCountryCode(option.code);
                        setCountryQuery(label);
                        setCountryPickerOpen(false);
                      }}
                      style={[styles.countryOption, index === 0 && styles.countryOptionFirst]}>
                      <Text allowFontScaling={false} style={styles.countryOptionText}>
                        {label}
                      </Text>
                      <View style={styles.countryOptionMeta}>
                        <Text allowFontScaling={false} style={styles.countryOptionCode}>
                          {option.code}
                        </Text>
                        {selected ? <Feather name="check" size={16} color="#111111" /> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : null}
      </View>
      <TextInput onChangeText={setCity} placeholder={formT.city} style={styles.input} value={city} />
      <View style={styles.languageRow}>
        <Text allowFontScaling={false} style={styles.infoLabel}>
          {formT.language}
        </Text>
        <View style={styles.segment}>
          <LanguageButton active={preferredLanguage === 'ko'} disabled={saving} label={formT.korean} onPress={() => setPreferredLanguage('ko')} />
          <LanguageButton active={preferredLanguage === 'en'} disabled={saving} label={formT.english} onPress={() => setPreferredLanguage('en')} />
        </View>
      </View>
      <Pressable disabled={saving} onPress={save} style={[styles.primaryButton, saving && styles.disabledButton]}>
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text allowFontScaling={false} style={styles.primaryButtonText}>
            {formT.save}
          </Text>
        )}
      </Pressable>
      {onCancel ? (
        <Pressable onPress={onCancel} style={styles.outlineButton}>
          <Text allowFontScaling={false} style={styles.outlineButtonText}>
            {formT.cancel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CoupleConnectScreen({
  currentPartnerType,
  initialInviteCode,
  inviteCode,
  language,
  onClose,
  onConnected,
  onInviteCodeHandled,
  onLogout,
  pending,
  profile,
}: {
  currentPartnerType: PartnerType | null;
  initialInviteCode: string | null;
  inviteCode: string | null;
  language: Language;
  onClose?: () => void;
  onConnected: () => Promise<void>;
  onInviteCodeHandled: () => void;
  onLogout: () => Promise<void>;
  pending: boolean;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const [code, setCode] = React.useState('');
  const [createdCode, setCreatedCode] = React.useState(inviteCode);
  const [createdPartnerType, setCreatedPartnerType] = React.useState(currentPartnerType);
  const [loading, setLoading] = React.useState(false);
  const [partnerType, setPartnerType] = React.useState<PartnerType | null>(null);
  const processedInviteCodeRef = React.useRef<string | null>(null);
  const canShowCreatedCode = Boolean(createdCode && createdPartnerType);
  const displayPartnerType = canShowCreatedCode ? createdPartnerType : partnerType ?? currentPartnerType ?? null;
  const connectionLabel = displayPartnerType === 'friend' ? t.partnerTypeFriend : t.partnerTypeLover;
  const connectTitle = getConnectTitle(displayPartnerType, language);
  const connectBody = getConnectBody(displayPartnerType, language);
  const displayName = profile.display_name?.trim() || t.me;

  React.useEffect(() => {
    setCreatedCode(inviteCode);
    setCreatedPartnerType(currentPartnerType);
    setPartnerType(null);
  }, [currentPartnerType, inviteCode]);

  const createInvite = async () => {
    if (!partnerType) {
      Alert.alert(t.confirm, t.partnerTypeRequired);
      return;
    }

    setLoading(true);
    try {
      const nextCode = await createCoupleInvite(partnerType);
      setCreatedCode(nextCode);
      setCreatedPartnerType(partnerType);
      await onConnected();
    } catch (error) {
      console.error('create invite failed', error);
      Alert.alert(t.inviteCodeError, t.unknownError);
    } finally {
      setLoading(false);
    }
  };

  const shareInvite = async () => {
    if (!createdCode || !createdPartnerType) {
      return;
    }

    const label = createdPartnerType === 'friend' ? t.partnerTypeFriend : t.partnerTypeLover;
    const inviteUrl = ExpoLinking.createURL('invite', {
      queryParams: { code: createdCode },
    });
    const message =
      language === 'ko'
        ? `${displayName}님이 Daydrop에 ${label}로 초대했어요.\n초대 코드: ${createdCode}\nDaydrop에서 코드를 입력하면 바로 연결돼요.`
        : `${displayName} invited you to Daydrop as ${label}.\nInvite code: ${createdCode}\nEnter this code in Daydrop to connect.`;

    try {
      await Share.share({
        message: `${message}\n${inviteUrl}`,
        title: language === 'ko' ? 'Daydrop 초대' : 'Daydrop Invite',
      });
    } catch (error) {
      console.error('share invite failed', error);
      await Clipboard.setStringAsync(createdCode);
      Alert.alert(t.copyDone, t.inviteCode);
    }
  };

  const joinInvite = React.useCallback(async (nextCode = code) => {
    const normalizedCode = normalizeInviteCode(nextCode);
    if (!normalizedCode) {
      Alert.alert(t.inviteCode, t.enterInvite);
      return;
    }

    setCode(normalizedCode);
    setLoading(true);
    try {
      await joinCoupleByInviteCode(normalizedCode);
      await onConnected();
      onClose?.();
    } catch (error) {
      console.error('join invite failed', error);
      Alert.alert(t.joinError, t.unknownError);
    } finally {
      setLoading(false);
    }
  }, [code, onClose, onConnected, t.enterInvite, t.inviteCode, t.joinError, t.unknownError]);

  React.useEffect(() => {
    const nextCode = normalizeInviteCode(initialInviteCode);
    if (!nextCode || processedInviteCodeRef.current === nextCode) {
      return;
    }

    processedInviteCodeRef.current = nextCode;
    setCode(nextCode);
    onInviteCodeHandled();
    void joinInvite(nextCode);
  }, [initialInviteCode, joinInvite, onInviteCodeHandled]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.logo}>
            DAYDROP
          </Text>
          <Pressable hitSlop={12} onPress={onClose ?? onLogout}>
            <Feather name={onClose ? 'x' : 'log-out'} size={25} color="#050505" />
          </Pressable>
        </View>
        <Text allowFontScaling={false} style={styles.connectSectionTitle}>
          {connectionLabel}
        </Text>
        <View style={styles.connectCard}>
          <Text allowFontScaling={false} style={styles.connectEyebrow}>
            {t.inviteCode}
          </Text>
          <Text allowFontScaling={false} style={styles.connectTitle}>
            {connectTitle}
          </Text>
          <Text allowFontScaling={false} style={styles.connectBody}>
            {connectBody}
          </Text>
          <View style={styles.connectProfileRow}>
            <View style={styles.connectAvatar}>
              <Text allowFontScaling={false} style={styles.connectAvatarText}>
                {displayName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <View style={styles.connectProfileTextWrap}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.connectProfileLabel}>
                {t.profile}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.connectProfileValue}>
                {[displayName, formatLocationValue(profile.city, profile.country, language)].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </View>

          {canShowCreatedCode ? (
            <View style={styles.inviteReadyWrap}>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(createdCode!);
                  Alert.alert(t.copyDone, t.inviteCode);
                }}
                style={styles.inviteCodeBox}>
                <Text allowFontScaling={false} style={styles.inviteCode}>
                  {createdCode}
                </Text>
                <Text allowFontScaling={false} style={styles.inviteHint}>
                  {t.copyInvite}
                </Text>
              </Pressable>
              <View style={styles.inviteActionRow}>
                <Pressable disabled={loading} onPress={shareInvite} style={[styles.inviteShareButton, loading && styles.disabledButton]}>
                  <Feather name="share-2" size={18} color="#FFFFFF" />
                  <Text allowFontScaling={false} style={styles.inviteShareButtonText}>
                    {language === 'ko' ? '초대 공유하기' : 'Share invite'}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={loading}
                  onPress={async () => {
                    await Clipboard.setStringAsync(createdCode!);
                    Alert.alert(t.copyDone, t.inviteCode);
                  }}
                  style={[styles.inviteCopyButton, loading && styles.disabledButton]}>
                  <Feather name="copy" size={18} color="#111111" />
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <PartnerTypeSelector
                disabled={loading}
                partnerType={partnerType}
                setPartnerType={setPartnerType}
                t={t}
              />
              <Pressable disabled={loading || !partnerType} onPress={createInvite} style={[styles.primaryButton, (loading || !partnerType) && styles.disabledButton]}>
                <Text allowFontScaling={false} style={[styles.primaryButtonText, !partnerType && styles.disabledButtonText]}>
                  {t.createInvite}
                </Text>
              </Pressable>
            </>
          )}

          {pending ? <InlineMessage text={language === 'ko' ? '초대한 사람이 코드를 입력하면 연결돼요.' : 'Share the code so your person can connect.'} /> : null}

          <View style={styles.joinSection}>
            <Text allowFontScaling={false} style={styles.joinLabel}>
              {language === 'ko' ? '받은 코드가 있나요?' : 'Have an invite code?'}
            </Text>
            <TextInput
              autoCapitalize="characters"
              onChangeText={setCode}
              placeholder={t.enterInvite}
              placeholderTextColor="#A6A6A6"
              style={styles.connectInput}
              value={code}
            />
          </View>
          <Pressable disabled={loading} onPress={() => joinInvite()} style={[styles.outlineButton, loading && styles.disabledButton]}>
            <Text allowFontScaling={false} style={styles.outlineButtonText}>
              {t.joinByCode}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getConnectTitle(partnerType: PartnerType | null, language: Language) {
  if (partnerType === 'friend') {
    return language === 'ko' ? '친구와 Daydrop을 시작해보세요.' : 'Start Daydrop with a friend.';
  }

  return language === 'ko' ? '둘만의 Daydrop을 시작해보세요.' : 'Start your private Daydrop.';
}

function normalizeInviteCode(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getInviteCodeFromURL(url: string | null) {
  if (!url) {
    return '';
  }

  const parsed = ExpoLinking.parse(url);
  const code = parsed.queryParams?.code;
  return normalizeInviteCode(Array.isArray(code) ? code[0] : code);
}

function getConnectBody(partnerType: PartnerType | null, language: Language) {
  if (partnerType === 'friend') {
    return language === 'ko'
      ? '초대 코드를 공유하면 친구와 같은 Mission을 열고 서로의 하루를 볼 수 있어요.'
      : 'Share an invite code to open the same Mission and see each other\'s day.';
  }

  return language === 'ko'
    ? '한 명이 초대 코드를 만들고, 다른 한 명이 그 코드를 입력하면 오늘의 Mission이 열려요.'
    : 'One of you creates an invite code. The other enters it to open today\'s Mission.';
}

function isAppleAuthCanceled(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
}

function PartnerTypeSelector({
  disabled,
  partnerType,
  setPartnerType,
  t,
}: {
  disabled: boolean;
  partnerType: PartnerType | null;
  setPartnerType: (partnerType: PartnerType) => void;
  t: Copy;
}) {
  return (
    <View style={styles.partnerTypeWrap}>
      <Text allowFontScaling={false} style={styles.partnerTypeLabel}>
        {t.partnerTypePrompt}
      </Text>
      <View style={styles.partnerTypeSegment}>
        <PartnerTypeButton
          active={partnerType === 'couple'}
          disabled={disabled}
          label={t.partnerTypeLover}
          onPress={() => setPartnerType('couple')}
        />
        <PartnerTypeButton
          active={partnerType === 'friend'}
          disabled={disabled}
          label={t.partnerTypeFriend}
          onPress={() => setPartnerType('friend')}
        />
      </View>
    </View>
  );
}

function PartnerTypeButton({
  active,
  disabled,
  label,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.partnerTypeButton, active && styles.partnerTypeButtonActive]}>
      <Text allowFontScaling={false} style={[styles.partnerTypeButtonText, active && styles.partnerTypeButtonTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CenteredState({ text }: { text: string }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.centeredState}>
        <ActivityIndicator color="#111111" />
        <Text allowFontScaling={false} style={styles.centeredText}>
          {text}
        </Text>
      </View>
    </SafeAreaView>
  );
}

function InlineMessage({ text }: { text: string }) {
  return (
    <Text allowFontScaling={false} style={styles.inlineMessage}>
      {text}
    </Text>
  );
}

type SplitMembers = {
  me: CoupleMember | null;
  partner: CoupleMember | null;
};

type SplitSubmissions<T extends DropSubmission> = {
  mine: T | null;
  partner: T | null;
};

function splitMembers(members: CoupleMember[], myUserId: string): SplitMembers {
  return {
    me: members.find((member) => member.user_id === myUserId) ?? null,
    partner: members.find((member) => member.user_id !== myUserId) ?? null,
  };
}

function splitSubmissions<T extends DropSubmission>(submissions: T[], myUserId: string): SplitSubmissions<T> {
  let mine: T | null = null;
  let partner: T | null = null;

  for (const submission of submissions) {
    if (!mine && submission.user_id === myUserId) {
      mine = submission;
    } else if (!partner && submission.user_id !== myUserId) {
      partner = submission;
    }

    if (mine && partner) {
      break;
    }
  }

  return { mine, partner };
}

function displayMemberName(member: CoupleMember | null, fallback: string) {
  return member?.display_name?.trim() || fallback;
}

function buildMeta(members: SplitMembers, language: Language, t: Copy) {
  const partnerLocation = formatLocation(members.partner, language, t.cityFallbackPartner);
  const myLocation = formatLocation(members.me, language, t.cityFallbackMe);
  if (!members.partner) {
    return myLocation;
  }
  return `${partnerLocation} ↔ ${myLocation}`;
}
function formatLocation(member: CoupleMember | null, language: Language, fallback: string) {
  return formatLocationValue(member?.city, member?.country, language) || fallback;
}

function getMissionPrompt(mission: Pick<TodayDropPayload['mission'], 'prompt_ko' | 'prompt_en'> | null | undefined, language: Language) {
  if (!mission) {
    return language === 'ko' ? '오늘의 Mission' : "Today's Mission";
  }
  return language === 'en' ? mission.prompt_en || mission.prompt_ko : mission.prompt_ko || mission.prompt_en || "Today's Mission";
}

function getSoloSendMessage(mission: Pick<TodayDropPayload['mission'], 'prompt_ko' | 'prompt_en'> | null | undefined, language: Language) {
  const prompt = getMissionPrompt(mission, language);
  return language === 'ko' ? prompt.replace(/[.ã€‚!?ï¼ï¼Ÿ]+$/u, '') : prompt;
}

function formatDate(value: string, language: Language) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatLocationValue(city: string | null | undefined, country: string | null | undefined, language: Language) {
  const countryLabel = getCountryLabel(country, language);
  return [city?.trim(), countryLabel].filter(Boolean).join(', ');
}

function sideRadius(side: 'left' | 'right') {
  return side === 'left' ? styles.leftSlotRadius : styles.rightSlotRadius;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#FFFCF7',
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 28,
    paddingHorizontal: 18,
    paddingTop: 22,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 34,
  },
  logo: {
    color: '#050505',
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: 9,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 25,
  },
  cameraScreen: {
    backgroundColor: '#000000',
    flex: 1,
  },
  cameraHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  cameraIconButton: {
    alignItems: 'center',
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  cameraTitleWrap: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 10,
  },
  cameraBrand: {
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  cameraMission: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 7,
    maxWidth: 260,
  },
  cameraCentered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  cameraPermission: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  cameraPermissionText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 23,
    marginBottom: 20,
    textAlign: 'center',
  },
  cameraPermissionButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  cameraPermissionButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '800',
  },
  cameraSettingsText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 18,
  },
  cameraPreviewShell: {
    borderRadius: 34,
    flex: 1,
    marginBottom: 24,
    marginHorizontal: 16,
    marginTop: 24,
    maxHeight: 620,
    overflow: 'hidden',
  },
  cameraPreview: {
    backgroundColor: '#111111',
    flex: 1,
    height: '100%',
    width: '100%',
  },
  cameraControls: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 30,
    paddingHorizontal: 42,
  },
  cameraRoundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  shutterButton: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 5,
    height: 86,
    justifyContent: 'center',
    width: 86,
  },
  shutterInner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    height: 66,
    width: 66,
  },
  cameraControlDisabled: {
    opacity: 0.55,
  },
  cameraConfirmBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 34,
    paddingHorizontal: 24,
  },
  cameraTextButton: {
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  cameraTextButtonLabel: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  cameraUseButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    minHeight: 52,
    justifyContent: 'center',
    minWidth: 128,
    paddingHorizontal: 20,
  },
  cameraUseButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '800',
  },
  sectionTitle: {
    color: '#050505',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 14,
  },
  missionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    position: 'relative',
    zIndex: 1,
  },
  missionHeaderTitle: {
    marginBottom: 0,
  },
  partnerPill: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E7E7E7',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    maxWidth: 150,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  partnerPillText: {
    color: '#555555',
    fontSize: 15,
    fontWeight: '600',
  },
  dropdownBackdrop: {
    flex: 1,
  },
  partnerDropdown: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECECEC',
    borderRadius: 15,
    borderWidth: 1,
    elevation: 8,
    padding: 12,
    position: 'absolute',
    right: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.13,
    shadowRadius: 24,
    top: 176,
    width: 258,
  },
  partnerOption: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 6,
  },
  partnerOptionDisabled: {
    opacity: 0.6,
  },
  partnerAvatar: {
    alignItems: 'center',
    backgroundColor: '#F1F1F1',
    borderColor: '#E0E0E0',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginRight: 12,
    width: 36,
  },
  partnerAvatarText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '800',
  },
  partnerOptionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  partnerOptionName: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '600',
  },
  partnerOptionMeta: {
    color: '#8A8A8A',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 3,
  },
  partnerDivider: {
    backgroundColor: '#ECECEC',
    height: 1,
    marginHorizontal: 6,
    marginVertical: 8,
  },
  addPartnerCircle: {
    alignItems: 'center',
    borderColor: '#D0D0D0',
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    marginRight: 12,
    width: 36,
  },
  addPartnerText: {
    color: '#6A6A6A',
    fontSize: 16,
    fontWeight: '600',
  },
  partnerEmptyText: {
    color: '#777777',
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 14,
  },
  missionCard: {
    backgroundColor: '#FFFDF9',
    borderColor: '#EFEAE2',
    borderRadius: 15,
    borderWidth: 1,
    elevation: 3,
    marginBottom: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
  },
  dropLabel: {
    color: '#777777',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 8,
  },
  missionTitle: {
    color: '#050505',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 6,
  },
  missionMeta: {
    color: '#777777',
    fontSize: 13,
    fontWeight: '400',
    marginBottom: 10,
  },
  photoPair: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 0,
    height: DEFAULT_PHOTO_PAIR_HEIGHT,
    overflow: 'hidden',
    width: '100%',
  },
  dropSlot: {
    alignItems: 'center',
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    minWidth: 0,
    overflow: 'hidden',
  },
  emptyPhotoSlot: {
    borderStyle: 'dashed',
    borderWidth: 1,
  },
  blueSlot: {
    backgroundColor: '#F5FAFF',
    borderColor: '#C8D8EA',
  },
  sandSlot: {
    backgroundColor: '#FFF9EE',
    borderColor: '#DED1BD',
  },
  waitingSlot: {
    backgroundColor: '#F5FAFF',
    borderColor: '#C8D8EA',
  },
  prePartnerSlot: {
    backgroundColor: '#FAFAFA',
    borderRightColor: '#ECECEC',
    borderRightWidth: 1,
    paddingHorizontal: 18,
  },
  prePartnerTitle: {
    color: '#4F4F4F',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    textAlign: 'center',
  },
  prePartnerBody: {
    color: '#777777',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 12,
    textAlign: 'center',
  },
  waitingContent: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    transform: [{ translateY: -6 }],
  },
  waitingText: {
    color: '#353535',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  imageSlot: {
    backgroundColor: 'transparent',
  },
  fillPressable: {
    flex: 1,
    width: '100%',
  },
  leftSlotRadius: {
    borderBottomLeftRadius: 15,
    borderTopLeftRadius: 15,
  },
  rightSlotRadius: {
    borderBottomRightRadius: 15,
    borderTopRightRadius: 15,
  },
  slotImage: {
    height: '100%',
    width: '100%',
  },
  imageFallback: {
    alignItems: 'center',
    backgroundColor: '#EFEFEF',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  emptyMessage: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginTop: 12,
    maxWidth: '76%',
    textAlign: 'center',
  },
  bottomLabelMuted: {
    bottom: 16,
    color: '#777777',
    fontSize: 16,
    fontWeight: '500',
    left: 12,
    position: 'absolute',
    right: 12,
    textAlign: 'center',
  },
  photoLabel: {
    bottom: 16,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    left: 12,
    position: 'absolute',
    right: 12,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.18)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  lockContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  partnerLockVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.12)',
  },
  partnerLockContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 0,
    paddingHorizontal: 28,
  },
  partnerLockText: {
    color: 'rgba(255, 255, 255, 0.94)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
  lockTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 10,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  lockHint: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
    textAlign: 'center',
  },
  sendSlot: {
    backgroundColor: '#FFF9EE',
    borderColor: '#DED1BD',
    borderWidth: 0,
    padding: 0,
  },
  innerDashedSlot: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flex: 1,
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  plusCircle: {
    alignItems: 'center',
    backgroundColor: '#A99B85',
    borderRadius: 19,
    height: 38,
    justifyContent: 'center',
    marginBottom: 10,
    width: 38,
  },
  sendText: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  stateMessage: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 19,
    marginBottom: 12,
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 10,
    elevation: 2,
    height: 56,
    justifyContent: 'center',
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  disabledButton: {
    backgroundColor: '#F0F0F0',
    shadowOpacity: 0,
  },
  disabledButtonText: {
    color: '#A3A3A3',
  },
  secondaryAction: {
    color: '#6A6A6A',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 28,
    marginTop: -6,
    textAlign: 'center',
  },
  recentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 2,
  },
  recentTitle: {
    color: '#050505',
    fontSize: 22,
    fontWeight: '800',
  },
  viewAll: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  viewAllText: {
    color: '#3C3C3C',
    fontSize: 16,
    fontWeight: '500',
  },
  recentList: {
    gap: 10,
  },
  recentRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EEEEEE',
    borderRadius: 14,
    borderWidth: 1,
    elevation: 2,
    flexDirection: 'row',
    minHeight: 88,
    overflow: 'hidden',
    paddingRight: 14,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.07,
    shadowRadius: 12,
  },
  recentThumbs: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    marginRight: 14,
    overflow: 'hidden',
    width: RECENT_THUMB_GROUP_WIDTH,
  },
  recentThumb: {
    overflow: 'hidden',
    width: '50%',
  },
  recentThumbLeft: {
    borderBottomLeftRadius: 12,
    borderTopLeftRadius: 12,
  },
  recentThumbRight: {
    borderBottomRightRadius: 12,
    borderTopRightRadius: 12,
  },
  recentPlaceholder: {
    backgroundColor: '#F5F5F5',
    borderColor: '#DDDDDD',
    borderStyle: 'dashed',
    borderWidth: 1,
    height: '100%',
    width: '100%',
  },
  recentLock: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentInfo: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  recentDate: {
    color: '#777777',
    fontSize: 13,
    fontWeight: '500',
  },
  recentMission: {
    color: '#050505',
    fontSize: 16,
    fontWeight: '800',
  },
  recentMeta: {
    color: '#777777',
    fontSize: 13,
    fontWeight: '500',
  },
  centeredState: {
    alignItems: 'center',
    flex: 1,
    gap: 14,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centeredText: {
    color: '#333333',
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
  },
  inlineMessage: {
    color: '#555555',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'center',
  },
  fullModal: {
    alignItems: 'center',
    backgroundColor: '#050505',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  closeButton: {
    position: 'absolute',
    right: 22,
    zIndex: 2,
  },
  fullImage: {
    height: '76%',
    width: '100%',
  },
  fullCaption: {
    gap: 8,
    left: 24,
    position: 'absolute',
    right: 24,
  },
  fullLabel: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  fullMission: {
    color: '#D8D8D8',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 21,
  },
  fullDeleteButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderColor: 'rgba(17, 17, 17, 0.08)',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 9,
    position: 'absolute',
    right: 22,
  },
  fullDeleteButtonDisabled: {
    opacity: 0.82,
  },
  fullDeleteButtonText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  modalTitle: {
    color: '#050505',
    fontSize: 27,
    fontWeight: '800',
  },
  allDropsContent: {
    gap: 10,
    padding: 20,
  },
  allDropRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EEEEEE',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    minHeight: 104,
    padding: 12,
  },
  allDropInfo: {
    flex: 1,
    gap: 7,
    minWidth: 0,
  },
  allDropThumbs: {
    borderRadius: 11,
    flexDirection: 'row',
    height: 76,
    overflow: 'hidden',
    width: 118,
  },
  settingsScreen: {
    backgroundColor: '#FFFFFF',
    flex: 1,
  },
  settingsHeader: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#EFEFF4',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 16,
  },
  settingsBackButton: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  settingsHeaderSpacer: {
    height: 40,
    width: 40,
  },
  settingsTitle: {
    color: '#111111',
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  settingsContent: {
    paddingBottom: 48,
    paddingHorizontal: 0,
    paddingTop: 20,
  },
  settingsDetail: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  settingsSection: {
    marginBottom: 26,
  },
  settingsSectionTitle: {
    color: '#8E8E93',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 7,
    marginLeft: 24,
    textTransform: 'uppercase',
  },
  settingsList: {
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#EFEFF4',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFF4',
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  settingsRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#EFEFF4',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  settingsRowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  settingsRowIcon: {
    alignItems: 'center',
    height: 26,
    justifyContent: 'center',
    marginRight: 14,
    width: 26,
  },
  settingsRowDangerIcon: {
    opacity: 0.95,
  },
  settingsRowTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '500',
  },
  settingsRowDangerText: {
    color: '#C9342C',
  },
  settingsRowSubtitle: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 4,
  },
  settingsRowValue: {
    color: '#8E8E93',
    fontSize: 15,
    fontWeight: '400',
    marginLeft: 12,
    maxWidth: 140,
    textAlign: 'right',
  },
  settingsRowChevron: {
    marginLeft: 7,
  },
  settingsLanguageSheet: {
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#EFEFF4',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFF4',
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  languageChoiceRow: {
    alignItems: 'center',
    borderBottomColor: '#E5E5EA',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16,
  },
  languageChoiceRowLast: {
    borderBottomWidth: 0,
  },
  languageChoiceRowActive: {
    backgroundColor: '#F8F8FA',
  },
  languageChoiceText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '400',
  },
  settingsFooterButton: {
    alignItems: 'center',
    marginHorizontal: 20,
    paddingVertical: 14,
  },
  settingsFooterButtonText: {
    color: '#6D6D72',
    fontSize: 15,
    fontWeight: '600',
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#D8D8D8',
    borderRadius: 99,
    height: 4,
    marginBottom: 18,
    width: 44,
  },
  detailSheet: {
    backgroundColor: '#FEFDFB',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    paddingBottom: 28,
  },
  shareSheet: {
    backgroundColor: '#FEFDFB',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  shareSheetTitle: {
    color: '#050505',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 6,
  },
  shareSheetBody: {
    color: '#666666',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 16,
  },
  shareOptions: {
    gap: 8,
  },
  shareOption: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#EAEAEA',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: 14,
  },
  shareOptionDisabled: {
    opacity: 0.6,
  },
  shareOptionIcon: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginRight: 12,
    width: 28,
  },
  shareOptionText: {
    color: '#111111',
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
  shareCaptureCanvas: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    left: -10000,
    overflow: 'hidden',
    position: 'absolute',
    top: -10000,
  },
  detailHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  detailTitle: {
    color: '#050505',
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 28,
  },
  detailMeta: {
    color: '#777777',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 5,
  },
  detailPhotos: {
    flexDirection: 'row',
    height: 260,
    overflow: 'hidden',
  },
  detailPhoto: {
    backgroundColor: '#EFEFEF',
    flex: 1,
    overflow: 'hidden',
  },
  detailPlaceholder: {
    backgroundColor: '#F5F5F5',
    height: '100%',
    width: '100%',
  },
  detailEmptyPhotoSlot: {
    borderColor: '#D8D8D8',
  },
  profileSheet: {
    backgroundColor: '#FEFDFB',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '92%',
    padding: 20,
    paddingBottom: 30,
  },
  profileTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  profileTitle: {
    color: '#050505',
    fontSize: 24,
    fontWeight: '800',
  },
  centerModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.34)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  centerModalCard: {
    backgroundColor: '#FEFDFB',
    borderRadius: 18,
    gap: 14,
    padding: 20,
    width: '100%',
  },
  privacyText: {
    color: '#555555',
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
    marginBottom: 14,
  },
  privacyHint: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    textAlign: 'center',
  },
  notificationIntro: {
    backgroundColor: '#F7F7F9',
    borderRadius: 8,
    marginBottom: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  notificationIntroText: {
    color: '#3A3A3C',
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 21,
  },
  notificationPermissionBox: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 16,
    padding: 14,
  },
  notificationPermissionTitle: {
    color: '#9A3412',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    marginBottom: 12,
  },
  notificationSettingsButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: '#D1D1D6',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 14,
  },
  notificationPermissionRequestButton: {
    alignSelf: 'stretch',
    marginBottom: 18,
  },
  notificationSettingsButtonText: {
    color: '#1C1C1E',
    fontSize: 14,
    fontWeight: '700',
  },
  notificationToggleRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#EFEFF4',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 14,
    minHeight: 76,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  notificationToggleRowDisabled: {
    opacity: 0.45,
  },
  notificationToggleTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  notificationToggleTitle: {
    color: '#1C1C1E',
    fontSize: 16,
    fontWeight: '500',
  },
  notificationToggleSubtitle: {
    color: '#8E8E93',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 4,
  },
  notificationMutedHint: {
    color: '#8E8E93',
    fontSize: 13,
    lineHeight: 19,
    marginTop: -16,
    paddingHorizontal: 8,
  },
  noticeVersion: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 10,
  },
  deleteTitle: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 27,
  },
  infoLabel: {
    color: '#777777',
    fontSize: 14,
    fontWeight: '600',
  },
  languageRow: {
    alignItems: 'center',
    borderBottomColor: '#ECECEC',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
    minHeight: 56,
  },
  segment: {
    backgroundColor: '#EFEFEF',
    borderRadius: 10,
    flexDirection: 'row',
    padding: 3,
  },
  segmentButton: {
    borderRadius: 8,
    minWidth: 86,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  segmentButtonActive: {
    backgroundColor: '#111111',
  },
  segmentText: {
    color: '#555555',
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
    marginTop: 12,
  },
  logoutText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  authWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  authTitle: {
    color: '#050505',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 22,
    marginTop: 42,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E3E3',
    borderRadius: 10,
    borderWidth: 1,
    color: '#111111',
    fontSize: 16,
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  socialAuthGroup: {
    gap: 10,
    marginTop: 14,
  },
  socialAuthButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DCDCDC',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  socialAuthButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '800',
  },
  appleAuthButton: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  appleAuthButtonText: {
    color: '#FFFFFF',
  },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#B42318',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
    marginTop: 12,
  },
  dangerOutlineButton: {
    alignItems: 'center',
    borderColor: '#B42318',
    borderRadius: 10,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    marginBottom: 12,
  },
  dangerText: {
    color: '#B42318',
    fontSize: 17,
    fontWeight: '800',
  },
  countryPickerWrap: {
    marginBottom: 0,
  },
  countryInputOpen: {
    marginBottom: 8,
  },
  countryList: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E3E3',
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
    maxHeight: 224,
    overflow: 'hidden',
  },
  countryListScroll: {
    maxHeight: 224,
  },
  countryEmptyText: {
    color: '#777777',
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  countryOption: {
    alignItems: 'center',
    borderTopColor: '#F0F0F0',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  countryOptionFirst: {
    borderTopWidth: 0,
  },
  countryOptionText: {
    color: '#111111',
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  countryOptionMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginLeft: 12,
  },
  countryOptionCode: {
    color: '#8B8B8B',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  connectSectionTitle: {
    color: '#050505',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 16,
  },
  connectCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECE8DF',
    borderRadius: 14,
    borderWidth: 1,
    elevation: 4,
    marginBottom: 12,
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
  },
  connectEyebrow: {
    color: '#8A8A8A',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  connectTitle: {
    color: '#050505',
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 32,
    marginBottom: 10,
  },
  connectBody: {
    color: '#5F5F5F',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20,
  },
  connectProfileRow: {
    alignItems: 'center',
    borderBottomColor: '#EEEEEE',
    borderBottomWidth: 1,
    borderTopColor: '#EEEEEE',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
    paddingVertical: 14,
  },
  connectAvatar: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  connectAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  connectProfileTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  connectProfileLabel: {
    color: '#8A8A8A',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  connectProfileValue: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '800',
  },
  partnerTypeWrap: {
    marginBottom: 14,
  },
  partnerTypeLabel: {
    color: '#444444',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  partnerTypeSegment: {
    backgroundColor: '#F3F3F3',
    borderColor: '#E9E9E9',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 4,
  },
  partnerTypeButton: {
    alignItems: 'center',
    borderRadius: 9,
    flex: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  partnerTypeButtonActive: {
    backgroundColor: '#111111',
  },
  partnerTypeButtonText: {
    color: '#555555',
    fontSize: 15,
    fontWeight: '800',
  },
  partnerTypeButtonTextActive: {
    color: '#FFFFFF',
  },
  inviteReadyWrap: {
    gap: 12,
    marginBottom: 18,
  },
  inviteCodeBox: {
    alignItems: 'center',
    backgroundColor: '#F7F7F4',
    borderColor: '#DAD7CE',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    paddingVertical: 20,
  },
  inviteCode: {
    color: '#050505',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 4,
  },
  inviteHint: {
    color: '#777777',
    fontSize: 13,
    marginTop: 6,
  },
  inviteActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  inviteShareButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 10,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  inviteShareButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  inviteCopyButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DADADA',
    borderRadius: 10,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    width: 56,
  },
  joinSection: {
    marginTop: 4,
  },
  joinLabel: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 10,
  },
  connectInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCDCDC',
    borderRadius: 10,
    borderWidth: 1,
    color: '#111111',
    fontSize: 16,
    height: 54,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  outlineButton: {
    alignItems: 'center',
    borderColor: '#111111',
    borderRadius: 10,
    borderWidth: 1,
    height: 54,
    justifyContent: 'center',
    marginBottom: 12,
  },
  outlineButtonText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '800',
  },
});
