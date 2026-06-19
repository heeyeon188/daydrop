import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Application from 'expo-application';
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system/legacy';
import { Image as ExpoImage } from 'expo-image';
import * as ExpoLinking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  Image as RNImage,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { captureRef } from 'react-native-view-shot';

import { PRIVACY_POLICY_URL, SUPPORT_EMAIL } from '@/constants/appConfig';
import { useMyCouple } from '@/hooks/useMyCouple';
import { useProfile } from '@/hooks/useProfile';
import { useSession } from '@/hooks/useSession';
import { useTodayDrop } from '@/hooks/useTodayDrop';
import { getPreferredOrDeviceLanguage, getTranslations, normalizeLanguage, type Language } from '@/lib/i18n';
import { getInviteCodeFromQueryParams, normalizeInviteCode, PENDING_INVITE_CODE_STORAGE_KEY } from '@/lib/inviteLink';
import { findCountryOption, getCountryLabel, searchCountryOptions } from '@/lib/locations';
import { deleteAccount } from '@/services/account';
import { logAppleSignInError, signInWithAppleIdToken, signInWithEmail, signInWithGoogle, signOut } from '@/services/auth';
import { createCoupleInvite, disconnectPartnerConnection, joinCoupleByInviteCode, selectCouple, type MyCouple, type MyCoupleOption } from '@/services/couple';
import { deleteMyTodayDropPhoto, signRecentDropForDisplay, signRecentDropsForThumbnails, submitDropPhoto } from '@/services/drops';
import {
  getNotificationPermissionState,
  getNotificationPreferences,
  registerPushToken,
  saveNotificationPreferences,
  setCurrentUserPushTokensEnabled,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '@/services/notifications';
import { completeProfile, updatePreferredLanguage, type ProfileInput } from '@/services/profile';
import { createPhotoSignedUrl, normalizeCameraPhoto, type CameraFacing, type DaydropPhotoAsset } from '@/services/storage';
import type { AuthUser, Couple, CoupleMember, DropState, DropSubmission, PartnerType, Profile, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const EMPTY_MEMBERS: CoupleMember[] = [];
const PERMISSION_INTRO_STORAGE_KEY = 'daydrop.hasSeenPermissionIntro';
const DEFAULT_PHOTO_PAIR_HEIGHT = 292;
const STORY_TEMPLATE_BASE_WIDTH = 360;
const STORY_TEMPLATE_BASE_HEIGHT = 640;
const STORY_TEMPLATE_PHOTO_WIDTH = 320;
const STORY_TEMPLATE_PHOTO_HEIGHT = 294;
const RECENT_THUMB_GROUP_WIDTH = 138;
const RECENT_THUMB_DEFAULT_HEIGHT = 82;
const HOME_RECENT_DROPS_LIMIT = 5;
const LOCKED_PHOTO_BLUR_RADIUS = 320;
const LOCKED_THUMBNAIL_PHOTO_BLUR_RADIUS = 340;
const HOME_IMAGE_TRANSITION_MS = 180;
const TODAY_DROP_PENDING_TEXT_COLOR = '#666666';
const TODAY_DROP_PENDING_ICON_COLOR = '#7890AE';
const INVITE_LINK_SAVE_DEDUPE_MS = 3000;
const inviteCodesInFlight = new Set<string>();
const handledInviteCodes = new Set<string>();
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
type ShareStoryData = SharePhotoPair & {
  date: string;
  leftLocation: string;
  leftName: string;
  leftOriginalStoragePath?: string | null;
  leftOriginalUri: string;
  mission: string;
  rightLocation: string;
  rightName: string;
  rightOriginalStoragePath?: string | null;
  rightOriginalUri: string;
};
type PhotoPreviewLayout = SharePhotoPair & {
  height: number;
  key: number;
  left: ImageSize;
  right: ImageSize;
  width: number;
};
type ShareStoryLayout = ShareStoryData & {
  height: number;
  key: number;
  leftPhoto: ImageSize;
  photoHeight: number;
  photoWidth: number;
  rightPhoto: ImageSize;
  width: number;
};
type SafeImageResizeMode = React.ComponentProps<typeof RNImage>['resizeMode'];

const imageSizeCache = new Map<string, ImageSize>();
const imageSizeInFlight = new Map<string, Promise<ImageSize>>();
const IOS_BACK_WIDE_LENS = 'builtInWideAngleCamera';
const IOS_BACK_WIDE_LENS_ALIASES = [IOS_BACK_WIDE_LENS, 'AVCaptureDeviceTypeBuiltInWideAngleCamera'];
const UNSAFE_DEFAULT_BACK_LENSES = new Set([
  'AVCaptureDeviceTypeBuiltInDualCamera',
  'AVCaptureDeviceTypeBuiltInDualWideCamera',
  'AVCaptureDeviceTypeBuiltInTripleCamera',
  'AVCaptureDeviceTypeBuiltInUltraWideCamera',
  'builtInDualCamera',
  'builtInDualWideCamera',
  'builtInTripleCamera',
  'builtInUltraWideCamera',
]);

type BackLensSelection = {
  lens: string;
  reason: string;
  rejected: { lens: string; reason: string }[];
  safeCandidates: string[];
};

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

function normalizeLensName(lens: string) {
  return lens.toLowerCase().replace(/[\s._-]+/g, '');
}

function getUnsafeBackLensReason(lens: string) {
  const normalized = lens.toLowerCase();
  const compact = normalizeLensName(lens);
  const unsafePatterns = [
    ...ULTRA_WIDE_BACK_LENS_PATTERNS,
    ...NON_DEFAULT_BACK_LENS_PATTERNS,
    'ultra',
    'ultrawide',
    'ultra-wide',
    'superwide',
    'super-wide',
    '0.5',
    '0,5',
    '0 5',
    '05x',
    'tele',
    'telephoto',
    'dual',
    'dualwide',
    'dual-wide',
    'triple',
    'lidar',
    'depth',
    'true',
    'truedepth',
    'true-depth',
    'desk',
    'continuity',
    '초광각',
    '울트라',
    '망원',
    '듀얼',
    '트리플',
    '심도',
  ];

  if (UNSAFE_DEFAULT_BACK_LENSES.has(lens)) {
    return 'known-non-1x-device-type';
  }

  const unsafePattern = unsafePatterns.find((pattern) => {
    const normalizedPattern = pattern.toLowerCase();
    return normalized.includes(normalizedPattern) || compact.includes(normalizeLensName(pattern));
  });

  return unsafePattern ? `matched-unsafe-pattern:${unsafePattern}` : null;
}

function matchesDefaultBackWideLens(lens: string) {
  const normalized = lens.toLowerCase();
  const compact = normalizeLensName(lens);
  const defaultPatterns = [...DEFAULT_BACK_LENS_PATTERNS, 'wideangle', 'wide camera', 'widecamera', 'backcamera', '광각', '와이드', '후면 카메라', '후면카메라'];

  return IOS_BACK_WIDE_LENS_ALIASES.some((candidate) => lens === candidate || compact === normalizeLensName(candidate)) || defaultPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()) || compact.includes(normalizeLensName(pattern)));
}

function selectDefaultBackLens(lenses: string[]): BackLensSelection {
  const rejected: BackLensSelection['rejected'] = [];
  const exactWideLens = IOS_BACK_WIDE_LENS_ALIASES.find((candidate) => lenses.includes(candidate));

  if (exactWideLens) {
    return {
      lens: exactWideLens,
      reason: 'exact-wide-device-type',
      rejected,
      safeCandidates: lenses.filter((lens) => !getUnsafeBackLensReason(lens)),
    };
  }

  const safeBackLenses = lenses.filter((lens) => {
    const unsafeReason = getUnsafeBackLensReason(lens);
    if (unsafeReason) {
      rejected.push({ lens, reason: unsafeReason });
      return false;
    }
    return true;
  });
  const namedWideLens = safeBackLenses.find(matchesDefaultBackWideLens);

  if (namedWideLens) {
    return {
      lens: namedWideLens,
      reason: 'safe-named-wide-lens',
      rejected,
      safeCandidates: safeBackLenses,
    };
  }

  if (safeBackLenses.length === 1) {
    return {
      lens: safeBackLenses[0],
      reason: 'single-safe-back-lens',
      rejected,
      safeCandidates: safeBackLenses,
    };
  }

  return {
    lens: IOS_BACK_WIDE_LENS,
    reason: 'expo-wide-default-fallback',
    rejected,
    safeCandidates: safeBackLenses,
  };
}

export default function MissionScreen() {
  const { user, loading: sessionLoading, configError } = useSession();
  const profileState = useProfile(user?.id);
  const myCouple = useMyCouple(Boolean(user));
  const language = getPreferredOrDeviceLanguage(profileState.profile?.preferred_language);
  const [pendingInviteCode, setPendingInviteCode] = React.useState<string | null>(null);
  const lastSavedInviteCodeRef = React.useRef<{ code: string; savedAt: number } | null>(null);

  React.useEffect(() => {
    let mounted = true;

    const savePendingInviteCode = async (url: string | null) => {
      const nextCode = getInviteCodeFromURL(url);
      const now = Date.now();
      const lastSaved = lastSavedInviteCodeRef.current;
      if (
        !mounted ||
        !nextCode ||
        inviteCodesInFlight.has(nextCode) ||
        handledInviteCodes.has(nextCode) ||
        (lastSaved?.code === nextCode && now - lastSaved.savedAt < INVITE_LINK_SAVE_DEDUPE_MS)
      ) {
        return;
      }

      lastSavedInviteCodeRef.current = { code: nextCode, savedAt: now };
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
      if (mounted) {
        void savePendingInviteCode(url);
      }
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  if (sessionLoading) {
    return <AppLoadingScreen language={language} />;
  }

  if (configError) {
    return <CenteredState text={configError} />;
  }

  if (!user) {
    return <AuthScreen language={language} />;
  }

  if (!profileState.hasLoaded) {
    return <AppLoadingScreen language={language} />;
  }

  if (!myCouple.hasLoaded) {
    return <AppLoadingScreen language={language} />;
  }

  if (!profileState.profile?.profile_completed) {
    return (
      <ProfileSetupScreen
        isAppleUser={isAppleUser(user)}
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
      latestDisconnectedCouple={myCouple.latestDisconnectedCouple}
      onCoupleChanged={myCouple.refetch}
      onCoupleSelected={myCouple.selectOptimistic}
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
  latestDisconnectedCouple,
  myCouple,
  myUserId,
  onCoupleChanged,
  onCoupleSelected,
  onPendingInviteCodeHandled,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  pendingInviteCode,
  profile,
}: {
  language: Language;
  latestDisconnectedCouple: Couple | null;
  myCouple: MyCouple | null;
  myUserId: string;
  onCoupleChanged: () => Promise<void>;
  onCoupleSelected: (coupleId: string) => void;
  onPendingInviteCodeHandled: () => void;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  pendingInviteCode: string | null;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const { today, recentDrops, hasLoaded: todayDropHasLoaded, loading: todayDropLoading, refreshing, error, applyLocalSubmission, removeLocalSubmission, refetch } = useTodayDrop(true, myCouple?.couple.id, myUserId);
  const [deletingPhoto, setDeletingPhoto] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [fullImage, setFullImage] = React.useState<FullImage | null>(null);
  const [allDropsForModal, setAllDropsForModal] = React.useState<RecentDrop[]>([]);
  const [allDropsVisible, setAllDropsVisible] = React.useState(false);
  const [cameraVisible, setCameraVisible] = React.useState(false);
  const [connectVisible, setConnectVisible] = React.useState(false);
  const [dropDetail, setDropDetail] = React.useState<DropDetail | null>(null);
  const [partnerMenuVisible, setPartnerMenuVisible] = React.useState(false);
  const [permissionIntroVisible, setPermissionIntroVisible] = React.useState(false);
  const [shareSheetVisible, setShareSheetVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [storedPendingInviteCode, setStoredPendingInviteCode] = React.useState<string | null>(null);
  const [partnerDisconnectedNoticeVisible, setPartnerDisconnectedNoticeVisible] = React.useState(false);
  const mountedRef = React.useRef(true);
  const inviteProcessingRef = React.useRef(false);
  const processedInviteLinkRef = React.useRef<string | null>(null);
  const allDropsSigningRequestRef = React.useRef(0);
  const currentCoupleId = myCouple?.couple.id ?? null;
  const scopedToday = React.useMemo(() => {
    if (!currentCoupleId) {
      return today;
    }

    return today?.daily_drop.couple_id === currentCoupleId ? today : null;
  }, [currentCoupleId, today]);
  const isTodayScopeStale = Boolean(today && !scopedToday);
  const scopedRecentDrops = React.useMemo(() => {
    if (!currentCoupleId) {
      return recentDrops;
    }

    return recentDrops.filter((drop) => drop.couple_id === currentCoupleId);
  }, [currentCoupleId, recentDrops]);
  const activePendingInviteCode = pendingInviteCode ?? storedPendingInviteCode;
  const activeMembers = scopedToday?.members ?? myCouple?.members ?? EMPTY_MEMBERS;
  const members = React.useMemo(() => splitMembers(activeMembers, myUserId), [activeMembers, myUserId]);
  const state = React.useMemo(() => getDropState(scopedToday, myUserId), [scopedToday, myUserId]);
  const sharePhotoPair = React.useMemo(() => {
    if (!scopedToday || state !== 'both') {
      return null;
    }

    const { mine, partner } = splitSubmissions(scopedToday.submissions, myUserId);
    const mineDisplayImage = getSubmissionDisplayImage(mine);
    const partnerDisplayImage = getSubmissionDisplayImage(partner);
    if (!mineDisplayImage || !partnerDisplayImage || !mine?.image_url || !partner?.image_url) {
      return null;
    }

    return {
      date: formatStoryDate(scopedToday.daily_drop.drop_date),
      leftLocation: formatLocation(members.partner, language, t.cityFallbackPartner),
      leftName: displayMemberName(members.partner, t.partner),
      leftOriginalStoragePath: partner.storage_path,
      leftOriginalUri: partner.image_url,
      leftUri: partnerDisplayImage,
      mission: getMissionPrompt(scopedToday.mission, language),
      rightLocation: formatLocation(members.me, language, t.cityFallbackMe),
      rightName: displayMemberName(members.me, t.me),
      rightOriginalStoragePath: mine.storage_path,
      rightOriginalUri: mine.image_url,
      rightUri: mineDisplayImage,
    };
  }, [language, members.me, members.partner, myUserId, scopedToday, state, t.cityFallbackMe, t.cityFallbackPartner, t.me, t.partner]);
  const hasPartner = Boolean(scopedToday?.couple.status === 'active' && members.partner);
  const shouldShowDisconnectedNotice = !hasPartner && (partnerDisconnectedNoticeVisible || Boolean(latestDisconnectedCouple));
  const isTodayUnlocked = hasPartner && state === 'both';
  const mainButtonDisabled = hasPartner ? (state === 'meOnly' || uploading || deletingPhoto) : uploading || deletingPhoto;
  const stateCopy = React.useMemo(() => getStateCopy(state, t, hasPartner), [hasPartner, state, t]);
  const meta = React.useMemo(() => buildMeta(members, language, t), [language, members, t]);
  const missionTitle = React.useMemo(() => getMissionPrompt(scopedToday?.mission, language), [language, scopedToday?.mission]);
  const coupleOptions = React.useMemo(() => myCouple?.availableCouples ?? [], [myCouple?.availableCouples]);
  const pendingInviteCouple = React.useMemo(() => coupleOptions.find((option) => option.couple.status === 'pending') ?? null, [coupleOptions]);
  const inviteCode = pendingInviteCouple?.couple.invite_code ?? null;
  const partnerOptions = React.useMemo(
    () => coupleOptions.filter((option) => option.couple.status === 'active' && option.members.some((member) => member.user_id !== myUserId)),
    [coupleOptions, myUserId]
  );
  const partnerCount = partnerOptions.length;
  const canAddPartner = partnerCount < 4;
  const visibleRecentDrops = React.useMemo(() => scopedRecentDrops.slice(0, HOME_RECENT_DROPS_LIMIT), [scopedRecentDrops]);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const requestId = allDropsSigningRequestRef.current + 1;
    allDropsSigningRequestRef.current = requestId;

    if (!allDropsVisible) {
      setAllDropsForModal([]);
      return;
    }

    setAllDropsForModal(scopedRecentDrops);
    signRecentDropsForThumbnails(scopedRecentDrops)
      .then((signedDrops) => {
        if (allDropsSigningRequestRef.current === requestId) {
          setAllDropsForModal(signedDrops);
        }
      })
      .catch((nextError) => {
        console.warn('[photo] all drops thumbnail signing failed; using existing URL fallbacks', nextError);
      });
  }, [allDropsVisible, scopedRecentDrops]);

  const openDropDetail = React.useCallback(
    async (drop: RecentDrop) => {
      const signedDrop = await signRecentDropForDisplay(drop);
      setDropDetail({ drop: signedDrop, state: getRecentDropState(signedDrop, myUserId) });
    },
    [myUserId]
  );

  const openAllDropsModal = React.useCallback(() => {
    setAllDropsForModal(scopedRecentDrops);
    setAllDropsVisible(true);
  }, [scopedRecentDrops]);

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

  const clearPendingInviteCode = React.useCallback(() => {
    if (mountedRef.current) {
      setStoredPendingInviteCode(null);
      onPendingInviteCodeHandled();
    }
    AsyncStorage.removeItem(PENDING_INVITE_CODE_STORAGE_KEY).catch((nextError) => {
      console.warn('pending invite code clear failed', nextError);
    });
  }, [onPendingInviteCodeHandled]);

  React.useEffect(() => {
    const nextCode = normalizeInviteCode(activePendingInviteCode);
    if (!nextCode) {
      return;
    }
    if (
      inviteProcessingRef.current ||
      processedInviteLinkRef.current === nextCode ||
      inviteCodesInFlight.has(nextCode) ||
      handledInviteCodes.has(nextCode)
    ) {
      clearPendingInviteCode();
      return;
    }

    inviteProcessingRef.current = true;
    processedInviteLinkRef.current = nextCode;
    inviteCodesInFlight.add(nextCode);
    handledInviteCodes.add(nextCode);
    clearPendingInviteCode();
    if (mountedRef.current) {
      setConnectVisible(false);
    }

    const connectFromInviteLink = async () => {
      let shouldShowSuccess = false;

      try {
        const connectedCoupleId = await joinCoupleByInviteCode(nextCode);
        if (mountedRef.current) {
          setFullImage(null);
          setDropDetail(null);
          setAllDropsVisible(false);
          setShareSheetVisible(false);
          setSettingsVisible(false);
          setPartnerMenuVisible(false);
          setCameraVisible(false);
          setPartnerDisconnectedNoticeVisible(false);
        }
        if (connectedCoupleId) {
          await selectCouple(connectedCoupleId);
        }
        await onCoupleChanged();
        shouldShowSuccess = true;
      } catch (nextError) {
        const inviteErrorType = getJoinInviteErrorType(nextError);
        if (inviteErrorType === 'unknown') {
          console.error('join invite failed', nextError);
        }
        if (inviteErrorType === 'alreadyConnected') {
          await onCoupleChanged();
        }
        if (mountedRef.current) {
          Alert.alert(t.joinError, getJoinInviteErrorMessage(nextError, t));
        }
      } finally {
        inviteProcessingRef.current = false;
        inviteCodesInFlight.delete(nextCode);
        if (mountedRef.current) {
          router.replace('/(tabs)');
          if (shouldShowSuccess) {
            Alert.alert(t.partnerAddedSuccess);
          }
        }
      }
    };

    void connectFromInviteLink();
  }, [activePendingInviteCode, clearPendingInviteCode, onCoupleChanged, refetch, t]);

  const dismissPermissionIntro = async () => {
    setPermissionIntroVisible(false);
    try {
      await AsyncStorage.setItem(PERMISSION_INTRO_STORAGE_KEY, 'true');
    } catch (nextError) {
      console.warn('permission intro save failed', nextError);
    }
  };

  const submitPhotoAsset = async (asset: DaydropPhotoAsset, source: CameraFacing) => {
    const alreadySubmitted = state === 'both' || (hasPartner && state === 'meOnly');
    if (!scopedToday || alreadySubmitted || uploading || deletingPhoto) {
      return;
    }

    const coupleId = scopedToday.daily_drop.couple_id ?? scopedToday.couple?.id;
    if (!coupleId) {
      Alert.alert(t.uploadError, t.unknownError);
      return;
    }

    let localSubmission: DropSubmission | null = null;
    let normalizeTimerStarted = false;
    let uploadTimerStarted = false;

    try {
      setUploading(true);
      if (__DEV__) {
        console.time('[photo] local preview after use');
      }
      localSubmission = createLocalPhotoSubmission({
        asset,
        coupleId,
        dropId: scopedToday.daily_drop.id,
        userId: myUserId,
      });
      applyLocalSubmission(localSubmission);
      setCameraVisible(false);
      if (__DEV__) {
        console.timeEnd('[photo] local preview after use');
        console.time('[photo] normalize before upload');
        normalizeTimerStarted = true;
      }
      const picked = await normalizeCameraPhoto(asset, source);
      if (__DEV__) {
        console.timeEnd('[photo] normalize before upload');
        normalizeTimerStarted = false;
        console.time('[photo] upload and db save');
        uploadTimerStarted = true;
      }

      const submission = await submitDropPhoto({
        base64: picked.base64,
        coupleId,
        dropId: scopedToday.daily_drop.id,
        fileInfo: {
          base64Used: Boolean(picked.base64),
          capturedUri: asset.uri,
          compressApplied: picked.compressed === true,
          height: picked.height,
          mimeType: picked.mimeType,
          originalHeight: asset.height,
          originalWidth: asset.width,
          reencodeApplied: picked.reencoded === true,
          resizeApplied: picked.resized === true,
          uploadUri: picked.uploadUri ?? picked.uri,
          uri: picked.uri,
          width: picked.width,
        },
        onDisplayImageReady: applyLocalSubmission,
        userId: myUserId,
        shouldNotifyPartner: hasPartner,
      });
      if (__DEV__) {
        console.timeEnd('[photo] upload and db save');
        uploadTimerStarted = false;
      }
      applyLocalSubmission(submission);
    } catch (nextError) {
      if (__DEV__) {
        if (normalizeTimerStarted) {
          console.timeEnd('[photo] normalize before upload');
        }
        if (uploadTimerStarted) {
          console.timeEnd('[photo] upload and db save');
        }
      }
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
      if (localSubmission) {
        removeLocalSubmission(localSubmission.id);
      }
      void refetch(true);
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => {
    const alreadySubmitted = state === 'both' || (hasPartner && state === 'meOnly');
    if (!scopedToday || deletingPhoto || uploading || alreadySubmitted) {
      return;
    }

    setCameraVisible(true);
  };

  const handleDeleteMyPhoto = async () => {
    if (!scopedToday || deletingPhoto) {
      return;
    }

    try {
      setDeletingPhoto(true);
      await deleteMyTodayDropPhoto({
        currentDropId: scopedToday.daily_drop.id,
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
    if (!scopedToday || deletingPhoto) {
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
      setFullImage(null);
      setDropDetail(null);
      setShareSheetVisible(false);
      setAllDropsVisible(false);
      setAllDropsForModal([]);
      onCoupleSelected(coupleId);
      await selectCouple(coupleId);
      await onCoupleChanged();
    } catch (nextError) {
      console.error('select couple failed', nextError);
      await onCoupleChanged();
      Alert.alert(t.partnerSelectError, t.unknownError);
    }
  };

  const handleDisconnectPartner = async (coupleId: string) => {
    await disconnectPartnerConnection(coupleId);
    setFullImage(null);
    setDropDetail(null);
    setAllDropsVisible(false);
    setShareSheetVisible(false);
    setPartnerDisconnectedNoticeVisible(true);
    await onCoupleChanged();
    await refetch(true);
  };

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
        {shouldShowDisconnectedNotice ? <InlineMessage text={t.disconnectPartnerNotice} /> : null}
        {!scopedToday && (isTodayScopeStale || !todayDropHasLoaded || todayDropLoading) ? <InlineMessage text={t.loadingMission} /> : null}

        {scopedToday ? (
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
                  deletingPhoto={deletingPhoto || uploading}
                  hasPartner={hasPartner}
                  state={state}
                  t={t}
                  today={scopedToday}
                />
              </View>
            </View>

            <Text allowFontScaling={false} style={styles.stateMessage}>
              {stateCopy.message}
            </Text>

            <Pressable
              disabled={mainButtonDisabled}
              onPress={isTodayUnlocked ? () => setShareSheetVisible(true) : hasPartner ? handleUpload : state === 'none' ? handleUpload : openAddPartner}
              style={[
                styles.primaryButton,
                mainButtonDisabled && styles.disabledButton,
              ]}>
              {uploading ? (
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
          <Pressable style={styles.viewAll} onPress={openAllDropsModal}>
            <Text allowFontScaling={false} style={styles.viewAllText}>
              {t.viewAll}
            </Text>
            <Feather name="chevron-right" size={20} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.recentList}>
          {scopedRecentDrops.length === 0 ? (
            <InlineMessage text={shouldShowDisconnectedNotice ? t.disconnectedHistoryHidden : t.noRecentDrops} />
          ) : (
            visibleRecentDrops.map((drop) => (
              <RecentDropRow
                key={drop.id}
                drop={drop}
                hasPartner={hasPartner}
                language={language}
                myUserId={myUserId}
                onPress={() => {
                  void openDropDetail(drop);
                }}
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
        drops={allDropsForModal}
        hasPartner={hasPartner}
        language={language}
        myUserId={myUserId}
        t={t}
        onClose={() => setAllDropsVisible(false)}
        onOpenDrop={(drop) => {
          void openDropDetail(drop);
        }}
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
      <TodayShareSheet language={language} shareData={sharePhotoPair} t={t} visible={shareSheetVisible} onClose={() => setShareSheetVisible(false)} />
      <SettingsSheet
        language={language}
        profile={profile}
        t={t}
        visible={settingsVisible}
        myCouple={myCouple}
        onClose={() => setSettingsVisible(false)}
        onDisconnectPartner={handleDisconnectPartner}
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
          initialInviteCode={null}
          inviteCode={inviteCode}
          invitePartnerType={pendingInviteCouple?.couple.partner_type ?? null}
          language={language}
          onConnected={async () => {
            await onCoupleChanged();
            Alert.alert(t.partnerAddedSuccess);
          }}
          onClose={() => setConnectVisible(false)}
          onInviteCreated={onCoupleChanged}
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
  const [defaultBackLens, setDefaultBackLens] = React.useState(IOS_BACK_WIDE_LENS);
  const [previewLayout, setPreviewLayout] = React.useState<ImageSize | null>(null);
  const insets = useSafeAreaInsets();
  const cameraRef = React.useRef<CameraView>(null);
  const defaultBackLensRef = React.useRef(defaultBackLens);
  const hasPermission = permission?.granted === true;
  const shutterDisabled = !hasPermission || !cameraReady || capturing || submitting;
  const cameraControlsPaddingBottom = Math.max(30, insets.bottom + 12);
  const selectedLens = Platform.OS === 'ios' && facing === 'back' ? defaultBackLens : undefined;

  React.useEffect(() => {
    defaultBackLensRef.current = defaultBackLens;
  }, [defaultBackLens]);

  React.useEffect(() => {
    if (!visible) {
      setCaptured(null);
      setCapturing(false);
      setCameraReady(false);
      setFlash('off');
      setFacing('back');
      defaultBackLensRef.current = IOS_BACK_WIDE_LENS;
      setDefaultBackLens(IOS_BACK_WIDE_LENS);
      setPreviewLayout(null);
    }
  }, [visible]);

  React.useEffect(() => {
    if (!visible || captured) {
      return;
    }

    if (__DEV__) {
      console.log('[DaydropCamera] state', {
        facing,
        hasPermission,
        cameraReady,
        isCapturing: capturing,
        hasCameraRef: Boolean(cameraRef.current),
        selectedLens,
        shutterDisabled,
        zoom: 0,
      });
    }
  }, [cameraReady, captured, capturing, facing, hasPermission, selectedLens, shutterDisabled, visible]);

  const updateDefaultBackLens = React.useCallback((lenses: string[], source: string) => {
    const selection = selectDefaultBackLens(lenses);

    if (__DEV__) {
      console.log('[DaydropCamera] back lens selection', {
        finalLens: selection.lens,
        lenses,
        rejected: selection.rejected,
        reason: selection.reason,
        safeCandidates: selection.safeCandidates,
        source,
        zoom: 0,
      });
    }

    if (defaultBackLensRef.current !== selection.lens) {
      defaultBackLensRef.current = selection.lens;
      setDefaultBackLens(selection.lens);
    }
  }, []);

  const handlePreviewLayout = React.useCallback(
    (event: LayoutChangeEvent) => {
      const { height, width } = event.nativeEvent.layout;
      setPreviewLayout((current) => (current && Math.round(current.width) === Math.round(width) && Math.round(current.height) === Math.round(height) ? current : { height, width }));

      if (__DEV__) {
        console.log('[DaydropCamera] preview layout', {
          facing,
          height,
          mode: captured ? 'post-capture' : 'camera',
          ratio: width > 0 && height > 0 ? width / height : null,
          width,
        });
      }
    },
    [captured, facing]
  );

  const capturePhoto = async () => {
    const camera = cameraRef.current;
    const captureFacing: CameraFacing = facing === 'front' ? 'front' : 'back';
    let captureTimerStarted = false;

    if (!camera || shutterDisabled) {
      if (__DEV__) {
        console.log('[DaydropCamera] capture blocked', {
          facing: captureFacing,
          hasPermission,
          cameraReady,
          isCapturing: capturing,
          hasCameraRef: Boolean(camera),
          shutterDisabled,
        });
      }
      return;
    }

    try {
      setCapturing(true);
      if (__DEV__) {
        console.log('[DaydropCamera] capture start', { facing: captureFacing });
      }
      if (__DEV__) {
        console.time('[DaydropCamera] takePictureAsync');
        captureTimerStarted = true;
      }
      const photo = await camera.takePictureAsync({
        exif: true,
        quality: 1,
      });
      if (__DEV__) {
        console.timeEnd('[DaydropCamera] takePictureAsync');
        captureTimerStarted = false;
      }

      if (!photo?.uri) {
        throw new Error('photo_read_failed');
      }

      const capturedPhoto: DaydropPhotoAsset & { didFlip?: boolean; mirrorMode?: string; source: CameraFacing } = {
        base64: null,
        exif: {
          ...(photo.exif ?? {}),
          daydropCaptureSource: captureFacing,
          daydropMirrorNormalized: captureFacing === 'front',
        },
        height: photo.height,
        mimeType: 'image/jpeg',
        uri: photo.uri,
        uploadUri: photo.uri,
        width: photo.width,
        source: captureFacing,
        compressed: false,
        didFlip: false,
        mirrorMode: 'none',
        reencoded: false,
        resized: false,
      };

      setCaptured(capturedPhoto);
      if (__DEV__) {
        void getLocalFileSize(capturedPhoto.uploadUri ?? capturedPhoto.uri).then((fileSize) => {
          console.log('[DaydropCamera] captured', {
            facing: captureFacing,
            capturedUri: photo.uri,
            uploadUri: capturedPhoto.uploadUri ?? capturedPhoto.uri,
            originalWidth: photo.width,
            originalHeight: photo.height,
            width: capturedPhoto.width,
            height: capturedPhoto.height,
            base64Used: false,
            orientation: getExifOrientation(photo.exif),
            mirrorMode: capturedPhoto.mirrorMode ?? 'none',
            resizeApplied: false,
            compressApplied: false,
            reencodeApplied: false,
            didFlip: false,
            fileSize,
          });
        });
      }
    } catch (nextError) {
      if (__DEV__ && captureTimerStarted) {
        console.timeEnd('[DaydropCamera] takePictureAsync');
      }
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
  const cameraPermissionDenied = permission?.canAskAgain === false;
  const permissionText = cameraPermissionDenied
    ? language === 'ko'
      ? '카메라 접근이 꺼져 있어요. 설정에서 카메라 접근을 켜면 사진을 촬영할 수 있어요.'
      : 'Camera access is turned off. You can enable camera access in Settings.'
    : language === 'ko'
      ? '사진을 촬영하고 보내려면 카메라 접근이 필요해요.'
      : 'Camera access is needed to take and send a photo.';
  const permissionButtonText = cameraPermissionDenied
    ? language === 'ko'
      ? '설정 열기'
      : 'Open Settings'
    : language === 'ko'
      ? '계속'
      : 'Continue';
  const capturedAspectRatio = captured?.width && captured.height ? captured.width / captured.height : null;
  const previewAspectRatio = previewLayout?.width && previewLayout.height ? previewLayout.width / previewLayout.height : null;

  React.useEffect(() => {
    if (!__DEV__ || !captured || !previewLayout) {
      return;
    }

    console.log('[DaydropCamera] post-capture display', {
      contentFit: 'cover',
      imageHeight: captured.height,
      imageRatio: capturedAspectRatio,
      imageWidth: captured.width,
      previewHeight: previewLayout.height,
      previewRatio: previewAspectRatio,
      previewWidth: previewLayout.width,
      uri: captured.uri,
    });
  }, [captured, capturedAspectRatio, previewAspectRatio, previewLayout]);

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
          </View>
        ) : (
          <>
            <View onLayout={handlePreviewLayout} style={styles.cameraPreviewShell}>
              {captured ? (
                <RNImage
                  onLoad={({ nativeEvent }) => {
                    if (__DEV__) {
                      console.log('[DaydropCamera] post-capture image load', {
                        displayFit: 'cover',
                        sourceHeight: nativeEvent.source.height,
                        sourceRatio: nativeEvent.source.width > 0 && nativeEvent.source.height > 0 ? nativeEvent.source.width / nativeEvent.source.height : null,
                        sourceWidth: nativeEvent.source.width,
                      });
                    }
                  }}
                  resizeMode="cover"
                  source={{ uri: captured.uri }}
                  style={styles.cameraPreview}
                />
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
                  responsiveOrientationWhenOrientationLocked
                  selectedLens={selectedLens}
                  zoom={0}
                  onAvailableLensesChanged={({ lenses }) => {
                    if (facing === 'back') {
                      updateDefaultBackLens(lenses, 'available-lenses-changed');
                    } else if (__DEV__) {
                      console.log('[DaydropCamera] available lenses', {
                        facing,
                        lenses,
                        selectedLens,
                        zoom: 0,
                      });
                    }
                  }}
                  onCameraReady={() => {
                    if (__DEV__) {
                      console.log('[DaydropCamera] ready', { facing, selectedLens, zoom: 0 });
                    }
                    setCameraReady(true);
                    if (facing === 'back') {
                      void cameraRef.current?.getAvailableLensesAsync().then((lenses) => updateDefaultBackLens(lenses, 'camera-ready')).catch(() => undefined);
                    }
                    if (__DEV__) {
                      void logAvailablePictureSizes(cameraRef.current, facing);
                    }
                  }}
                  onResponsiveOrientationChanged={({ orientation }) => {
                    if (__DEV__) {
                      console.log('[DaydropCamera] responsive orientation', { facing, orientation });
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
              <View style={[styles.cameraControls, { paddingBottom: cameraControlsPaddingBottom }]}>
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

async function logAvailablePictureSizes(camera: CameraView | null, facing: CameraType) {
  if (!camera) {
    return;
  }

  try {
    const sizes = await camera.getAvailablePictureSizesAsync();
    if (__DEV__) {
      console.log('[DaydropCamera] available picture sizes', {
        facing,
        sizes,
        selectedPictureSize: null,
        applied: false,
        reason: 'pictureSize changes capture ratio and can affect preview framing, so it is logged only',
      });
    }
  } catch (error) {
    console.warn('[DaydropCamera] picture size lookup failed', { facing, error });
  }
}

function getExifOrientation(exif?: Record<string, unknown> | null) {
  const orientation = exif?.Orientation ?? exif?.orientation;
  const normalized = typeof orientation === 'string' ? Number.parseInt(orientation, 10) : orientation;
  return typeof normalized === 'number' && Number.isFinite(normalized) ? normalized : null;
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
  const mineDisplayImage = getSubmissionDisplayImage(mine);
  const partnerDisplayImage = getSubmissionDisplayImage(partner);

  if (!hasPartner) {
    return (
      <>
        <PrePartnerSlot t={t} />
        {mine ? (
          <EditablePhotoSlot
            deleting={deletingPhoto}
            image={mineDisplayImage}
            label={myLabel}
            onOpenImage={() => onOpenImage({ canDelete: true, image: mineDisplayImage, label: myLabel, mission })}
            side="right"
          />
        ) : (
          <SendSlot label={myLabel} onPress={onUploadPress} t={t} />
        )}
      </>
    );
  }

  if (state === 'both') {
    return (
      <>
        <PhotoSlot
          image={partnerDisplayImage}
          label={partnerLabel}
          side="left"
          onPress={() => onOpenImage({ canDelete: false, image: partnerDisplayImage, label: partnerLabel, mission })}
        />
        <EditablePhotoSlot
          deleting={deletingPhoto}
          image={mineDisplayImage}
          label={myLabel}
          onOpenImage={() => onOpenImage({ canDelete: true, image: mineDisplayImage, label: myLabel, mission })}
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
          image={mineDisplayImage}
          label={myLabel}
          onOpenImage={() => onOpenImage({ canDelete: true, image: mineDisplayImage, label: myLabel, mission })}
          side="right"
        />
      </>
    );
  }

  if (state === 'partnerOnly') {
    return (
      <>
        <LockedPhotoSlot image={partnerDisplayImage} label={partnerLabel} onPress={onLockedPartnerPress} t={t} />
        <SendSlot label={myLabel} onPress={onUploadPress} t={t} />
      </>
    );
  }

  return (
    <>
      <EmptySlot label={partnerLabel} icon="upload-cloud" message={language === 'ko' ? '아직 보내지 않았어요' : 'Not sent yet'} tone="blue" side="left" />
      <SendSlot label={myLabel} onPress={onUploadPress} t={t} />
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

function getSubmissionDisplayImage(submission: DropSubmission | null | undefined) {
  return getNonEmptyString(submission?.display_image_url) || getNonEmptyString(submission?.thumbnail_image_url) || getNonEmptyString(submission?.image_url);
}

function getSubmissionThumbnailImage(submission: DropSubmission | null | undefined) {
  return getNonEmptyString(submission?.thumbnail_image_url) || getNonEmptyString(submission?.image_url);
}

function getNonEmptyString(value: string | null | undefined) {
  return value?.trim() || undefined;
}

function createLocalPhotoSubmission({
  asset,
  coupleId,
  dropId,
  userId,
}: {
  asset: DaydropPhotoAsset;
  coupleId: string;
  dropId: string;
  userId: string;
}): DropSubmission {
  const submittedAt = new Date().toISOString();
  const localPath = `local://${dropId}/${userId}/${Date.now()}`;

  return {
    id: localPath,
    drop_id: dropId,
    couple_id: coupleId,
    user_id: userId,
    display_image_url: asset.uri,
    display_storage_path: localPath,
    image_url: asset.uri,
    storage_path: localPath,
    thumbnail_image_url: asset.uri,
    thumbnail_storage_path: localPath,
    note: null,
    submitted_at: submittedAt,
  };
}

function getStateCopy(state: DropState, t: Copy, hasPartner: boolean) {
  if (!hasPartner) {
    return {
      message: t.soloTodayHint,
      button: state === 'none' ? t.uploadPhoto : t.connectPartnerFirst,
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
    <View style={[styles.dropSlot, styles.blueSlot, styles.emptyPhotoSlot, styles.prePartnerSlot, sideRadius('left')]}>
      <Feather name="users" size={46} color="#8B8B8B" strokeWidth={1.45} />
      <Text allowFontScaling={false} adjustsFontSizeToFit numberOfLines={1} style={styles.prePartnerTitle}>
        {t.beforePartner}
      </Text>
      <Text allowFontScaling={false} numberOfLines={3} style={styles.prePartnerBody}>
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
  const toneColor = tone === 'blue' ? TODAY_DROP_PENDING_ICON_COLOR : '#9B8D77';

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
        <Feather name="refresh-cw" size={31} color={TODAY_DROP_PENDING_ICON_COLOR} strokeWidth={1.65} />
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
      <SafeImage blurRadius={LOCKED_PHOTO_BLUR_RADIUS} image={image} label={label} resizeMode="cover" />
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

function SendSlot({ label, onPress, t }: { label: string; onPress: () => void; t: Copy }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.sendSlot, styles.emptyPhotoSlot, sideRadius('right')]}>
      <View style={styles.innerDashedSlot}>
        <View style={styles.plusCircle}>
          <Feather name="plus" size={20} color="#FFFFFF" strokeWidth={2.2} />
        </View>
        <Text allowFontScaling={false} style={styles.sendText}>
          {t.sendMine}
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
  const locked = blurRadius > 0;
  const lockedBlurRadius = Math.max(blurRadius, LOCKED_PHOTO_BLUR_RADIUS);

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

  if (locked) {
    return (
      <View style={styles.lockedImageWrap}>
        <ExpoImage
          blurRadius={lockedBlurRadius}
          cachePolicy="memory-disk"
          contentFit={toImageContentFit(resizeMode)}
          priority="high"
          source={image}
          style={styles.slotImage}
          transition={HOME_IMAGE_TRANSITION_MS}
          onError={(event) => {
            console.warn(`Daydrop image failed to load (${label})`, event.error);
            setFailed(true);
          }}
        />
      </View>
    );
  }

  return (
    <ExpoImage
      cachePolicy="memory-disk"
      contentFit={toImageContentFit(resizeMode)}
      priority="high"
      source={image}
      style={styles.slotImage}
      transition={HOME_IMAGE_TRANSITION_MS}
      onError={(event) => {
        console.warn(`Daydrop image failed to load (${label})`, event.error);
        setFailed(true);
      }}
    />
  );
}

function toImageContentFit(resizeMode: SafeImageResizeMode): React.ComponentProps<typeof ExpoImage>['contentFit'] {
  switch (resizeMode) {
    case 'cover':
      return 'cover';
    case 'stretch':
      return 'fill';
    case 'center':
      return 'none';
    case 'contain':
    default:
      return 'contain';
  }
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
  const mineImage = getSubmissionThumbnailImage(mine);
  const partnerImage = getSubmissionThumbnailImage(partner);
  const thumbHeight = RECENT_THUMB_DEFAULT_HEIGHT;

  return (
    <Pressable onPress={onPress} style={styles.recentRow}>
      <View style={[styles.recentThumbs, { height: thumbHeight }]}>
        <RecentThumb height={thumbHeight} image={partnerImage} locked={shouldLock} side="left" />
        <RecentThumb height={thumbHeight} image={mineImage} locked={false} side="right" />
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
      {image ? (
        <SafeImage blurRadius={locked ? LOCKED_THUMBNAIL_PHOTO_BLUR_RADIUS : 0} image={image} label={`recent-${side}`} resizeMode="cover" />
      ) : (
        <View style={styles.recentPlaceholder} />
      )}
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
        {image?.image ? <ExpoImage cachePolicy="memory-disk" contentFit="contain" source={image.image} style={styles.fullImage} /> : null}
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
  if (!visible) {
    return null;
  }

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
  const mineImage = getSubmissionThumbnailImage(mine);
  const partnerImage = getSubmissionThumbnailImage(partner);

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
        <RecentThumb image={partnerImage} locked={shouldLock} side="left" />
        <RecentThumb image={mineImage} locked={false} side="right" />
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
  const mineImage = getSubmissionDisplayImage(mine);
  const partnerImage = getSubmissionDisplayImage(partner);

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
            <DetailPhoto image={partnerImage} label={t.partner} locked={shouldLock} side="left" />
            <DetailPhoto image={mineImage} label={t.me} locked={false} side="right" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function TodayShareSheet({
  language,
  onClose,
  shareData,
  t,
  visible,
}: {
  language: Language;
  onClose: () => void;
  shareData: ShareStoryData | null;
  t: Copy;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const windowDimensions = useWindowDimensions();
  const storyCaptureViewRef = React.useRef<View>(null);
  const storyImageLoadCountRef = React.useRef(0);
  const storyReadyRejectRef = React.useRef<((error: Error) => void) | null>(null);
  const storyReadyResolveRef = React.useRef<(() => void) | null>(null);
  const storyTemplateLaidOutRef = React.useRef(false);
  const [photoPreviewLayout, setPhotoPreviewLayout] = React.useState<PhotoPreviewLayout | null>(null);
  const [photoPreviewLoading, setPhotoPreviewLoading] = React.useState(false);
  const [storyLayout, setStoryLayout] = React.useState<ShareStoryLayout | null>(null);
  const [sharingStory, setSharingStory] = React.useState(false);

  React.useEffect(() => {
    if (!visible) {
      setPhotoPreviewLayout(null);
      setPhotoPreviewLoading(false);
      setStoryLayout(null);
      storyImageLoadCountRef.current = 0;
      storyReadyRejectRef.current = null;
      storyReadyResolveRef.current = null;
      storyTemplateLaidOutRef.current = false;
      setSharingStory(false);
    }
  }, [visible]);

  const resolveStoryTemplateIfReady = () => {
    if (storyTemplateLaidOutRef.current && storyImageLoadCountRef.current >= 2) {
      storyReadyResolveRef.current?.();
      storyReadyResolveRef.current = null;
      storyReadyRejectRef.current = null;
    }
  };

  const handleStoryTemplateLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    console.log('[share] story template onLayout width/height', { height, width });
    storyTemplateLaidOutRef.current = width > 0 && height > 0;
    resolveStoryTemplateIfReady();
  };

  const handleStoryImageLoad = (side: 'left' | 'right') => {
    storyImageLoadCountRef.current += 1;
    console.log(side === 'left' ? '[share] left image loaded' : '[share] right image loaded');
    resolveStoryTemplateIfReady();
  };

  const handleStoryImageError = () => {
    storyReadyRejectRef.current?.(new Error('photo_read_failed'));
    storyReadyResolveRef.current = null;
    storyReadyRejectRef.current = null;
  };

  const handleViewPhoto = async () => {
    if (photoPreviewLoading) {
      return;
    }

    if (!shareData) {
      Alert.alert(t.photoView, t.photoReadError);
      return;
    }

    try {
      setPhotoPreviewLoading(true);
      const originalShareData = await prepareOriginalShareData(shareData);
      const [leftSize, rightSize] = await Promise.all([getRemoteImageSize(originalShareData.leftUri), getRemoteImageSize(originalShareData.rightUri)]);
      setPhotoPreviewLayout(createPhotoPreviewLayout(originalShareData, leftSize, rightSize, windowDimensions.width, windowDimensions.height, insets));
    } catch (nextError) {
      console.error('view today drop photo failed', nextError);
      Alert.alert(t.photoView, nextError instanceof Error && nextError.message === 'photo_read_failed' ? t.photoReadError : t.unknownError);
    } finally {
      setPhotoPreviewLoading(false);
    }
  };

  const handleShareInstagramStory = async () => {
    if (sharingStory) {
      return;
    }

    if (!shareData) {
      Alert.alert(t.share, t.photoReadError);
      return;
    }

    try {
      setSharingStory(true);
      const originalShareData = await prepareOriginalShareData(shareData);
      const [leftSize, rightSize] = await Promise.all([getRemoteImageSize(originalShareData.leftUri), getRemoteImageSize(originalShareData.rightUri)]);
      const nextLayout = createShareStoryLayout(originalShareData, leftSize, rightSize, language);
      let templateReadyTimeout: ReturnType<typeof setTimeout> | null = null;
      const templateReadyPromise = new Promise<void>((resolve, reject) => {
        storyImageLoadCountRef.current = 0;
        storyReadyResolveRef.current = () => {
          if (templateReadyTimeout) {
            clearTimeout(templateReadyTimeout);
            templateReadyTimeout = null;
          }
          resolve();
        };
        storyReadyRejectRef.current = reject;
        storyTemplateLaidOutRef.current = false;
        templateReadyTimeout = setTimeout(() => reject(new Error('story_template_not_ready')), 8000);
      });

      setStoryLayout(nextLayout);
      await templateReadyPromise;
      await waitForNextFrame();

      if (!storyCaptureViewRef.current) {
        throw new Error('capture_view_missing');
      }

      console.log('[share] story template capture start', {
        height: nextLayout.height,
        photoHeight: nextLayout.photoHeight,
        photoWidth: nextLayout.photoWidth,
        width: nextLayout.width,
      });
      const storyUri = await captureRef(storyCaptureViewRef, {
        format: 'png',
        height: nextLayout.height,
        quality: 1,
        result: 'tmpfile',
        width: nextLayout.width,
      });
      console.log('[share] captured uri', storyUri);

      const shareUri = await prepareCapturedStoryFile(storyUri);
      await shareStoryFileFallback(shareUri, language);
      setStoryLayout(null);
      onClose();
    } catch (nextError) {
      console.error('share instagram story failed', nextError);
      Alert.alert(t.share, nextError instanceof Error && nextError.message === 'photo_read_failed' ? t.photoReadError : t.unknownError);
    } finally {
      setSharingStory(false);
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
            <Pressable disabled={sharingStory} onPress={handleShareInstagramStory} style={[styles.shareOption, sharingStory && styles.shareOptionDisabled]}>
              <View style={styles.shareOptionIcon}>
                {sharingStory ? <ActivityIndicator color="#111111" /> : <Feather name="share-2" size={21} color="#111111" />}
              </View>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.shareOptionText}>
                {t.shareToInstagramStory}
              </Text>
            </Pressable>
            <Pressable disabled={photoPreviewLoading} onPress={handleViewPhoto} style={[styles.shareOption, photoPreviewLoading && styles.shareOptionDisabled]}>
              <View style={styles.shareOptionIcon}>
                {photoPreviewLoading ? <ActivityIndicator color="#111111" /> : <Feather name="image" size={21} color="#111111" />}
              </View>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.shareOptionText}>
                {t.photoView}
              </Text>
            </Pressable>
          </View>
          <PhotoPreviewModal layout={photoPreviewLayout} onClose={() => setPhotoPreviewLayout(null)} visible={Boolean(photoPreviewLayout)} />
          {storyLayout ? (
            <View
              collapsable={false}
              onLayout={handleStoryTemplateLayout}
              ref={storyCaptureViewRef}
              style={[
                styles.storyCaptureCanvas,
                {
                  height: storyLayout.height,
                  width: storyLayout.width,
                },
              ]}>
              <Text allowFontScaling={false} style={styles.storyEyebrow}>
                {"Today's Drop"}
              </Text>
              <Text allowFontScaling={false} style={styles.storyMission}>
                {storyLayout.mission}
              </Text>
              <View style={[styles.storyPhotoShadow, { height: storyLayout.photoHeight, width: storyLayout.photoWidth }]}>
                <View style={[styles.storyPhotoRow, { height: storyLayout.photoHeight, width: storyLayout.photoWidth }]}>
                  <RNImage
                    key={`story-left-${storyLayout.key}`}
                    onError={handleStoryImageError}
                    onLoad={() => handleStoryImageLoad('left')}
                    resizeMode="contain"
                    source={{ uri: storyLayout.leftUri }}
                    style={{
                      height: storyLayout.leftPhoto.height,
                      width: storyLayout.leftPhoto.width,
                    }}
                  />
                  <RNImage
                    key={`story-right-${storyLayout.key}`}
                    onError={handleStoryImageError}
                    onLoad={() => handleStoryImageLoad('right')}
                    resizeMode="contain"
                    source={{ uri: storyLayout.rightUri }}
                    style={{
                      height: storyLayout.rightPhoto.height,
                      width: storyLayout.rightPhoto.width,
                    }}
                  />
                </View>
              </View>
              <View style={[styles.storyNameRow, { width: Math.max(1, storyLayout.photoWidth - 28) }]}>
                <View style={styles.storyPersonBlock}>
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={1} style={styles.storyName}>
                    {storyLayout.leftName}
                  </Text>
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.storyLocation}>
                    {storyLayout.leftLocation}
                  </Text>
                </View>
                <Text allowFontScaling={false} style={styles.storyOrnament}>
                  {'< - - -  ✦  - - - >'}
                </Text>
                <View style={styles.storyPersonBlock}>
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.68} numberOfLines={1} style={styles.storyName}>
                    {storyLayout.rightName}
                  </Text>
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={styles.storyLocation}>
                    {storyLayout.rightLocation}
                  </Text>
                </View>
              </View>
              <View style={[styles.storyDivider, { width: Math.max(1, storyLayout.photoWidth - 34) }]}>
                <View style={styles.storyDividerLine} />
                <View style={styles.storyDividerDot} />
                <View style={styles.storyDividerLine} />
              </View>
              <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.storyDate}>
                {storyLayout.date}
              </Text>
              <Text allowFontScaling={false} style={styles.storyBrand}>
                DAYDROP
              </Text>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PhotoPreviewModal({ layout, onClose, visible }: { layout: PhotoPreviewLayout | null; onClose: () => void; visible: boolean }) {
  const scale = useSharedValue(1);
  const startScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startTranslateX = useSharedValue(0);
  const startTranslateY = useSharedValue(0);

  React.useEffect(() => {
    scale.value = 1;
    startScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    startTranslateX.value = 0;
    startTranslateY.value = 0;
  }, [layout?.key, scale, startScale, startTranslateX, startTranslateY, translateX, translateY, visible]);

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.max(1, Math.min(startScale.value * event.scale, 5));
    })
    .onEnd(() => {
      startScale.value = scale.value;
      if (scale.value <= 1) {
        translateX.value = 0;
        translateY.value = 0;
        startTranslateX.value = 0;
        startTranslateY.value = 0;
      }
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (scale.value <= 1) {
        translateX.value = 0;
        translateY.value = 0;
        return;
      }

      translateX.value = startTranslateX.value + event.translationX;
      translateY.value = startTranslateY.value + event.translationY;
    })
    .onEnd(() => {
      startTranslateX.value = translateX.value;
      startTranslateY.value = translateY.value;
    });

  const previewGesture = Gesture.Simultaneous(pinchGesture, panGesture);
  const previewAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.photoPreviewBackdrop}>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.photoPreviewClose}>
          <Feather name="x" size={24} color="#FFFFFF" />
        </Pressable>
        {layout ? (
          <GestureDetector gesture={previewGesture}>
            <Animated.View style={[styles.photoPreviewRow, { height: layout.height, width: layout.width }, previewAnimatedStyle]}>
              <RNImage
                key={`preview-left-${layout.key}`}
                resizeMode="contain"
                source={{ uri: layout.leftUri }}
                style={{ height: layout.left.height, width: layout.left.width }}
              />
              <RNImage
                key={`preview-right-${layout.key}`}
                resizeMode="contain"
                source={{ uri: layout.rightUri }}
                style={{ height: layout.right.height, width: layout.right.width }}
              />
            </Animated.View>
          </GestureDetector>
        ) : null}
      </View>
    </Modal>
  );
}

function DetailPhoto({ image, label, locked, side }: { image?: string; label: string; locked: boolean; side: 'left' | 'right' }) {
  return (
    <View style={[styles.detailPhoto, !image && styles.emptyPhotoSlot, !image && styles.detailEmptyPhotoSlot, sideRadius(side)]}>
      {image ? <SafeImage blurRadius={locked ? LOCKED_PHOTO_BLUR_RADIUS : 0} image={image} label={`detail-${label}`} resizeMode="cover" /> : <View style={styles.detailPlaceholder} />}
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
              {language === 'ko' ? '계속' : 'Continue'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SettingsSheet({
  language,
  myCouple,
  onClose,
  onDisconnectPartner,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  profile,
  t,
  visible,
}: {
  language: Language;
  myCouple: MyCouple | null;
  onClose: () => void;
  onDisconnectPartner: (coupleId: string) => Promise<void>;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  profile: Profile;
  t: Copy;
  visible: boolean;
}) {
  const [mode, setMode] = React.useState<
    'menu' | 'edit' | 'language' | 'notifications' | 'notices' | 'disconnectPartner' | 'deleteIntro' | 'deleteFinal'
  >('menu');
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
  const [deletingAccount, setDeletingAccount] = React.useState(false);
  const [disconnectingPartner, setDisconnectingPartner] = React.useState(false);
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
  const activePartnerOptions = React.useMemo(
    () => getActivePartnerOptions(myCouple, profile.id),
    [myCouple, profile.id]
  );

  React.useEffect(() => {
    if (visible) {
      setMode('menu');
      setDeleteConfirmText('');
    }
  }, [visible]);

  const refreshNotificationPermission = React.useCallback(async () => {
    try {
      const settings = await Notifications.getPermissionsAsync();
      setNotificationPermission(getNotificationPermissionState(settings));
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

  const confirmDisconnectPartner = (option: MyCoupleOption) => {
    if (disconnectingPartner) {
      return;
    }

    const partner = option.members.find((member) => member.user_id !== profile.id) ?? null;
    const partnerName = displayMemberName(partner, t.partner);

    Alert.alert(
      language === 'ko' ? `${partnerName}님과의 연결을 해제할까요?` : `Disconnect from ${partnerName}?`,
      language === 'ko'
        ? '연결을 해제해도 내 계정과 내가 올린 기록은 유지됩니다.'
        : 'Your account and the records you uploaded will be kept after disconnecting.',
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.disconnectPartnerConfirm,
          style: 'destructive',
          onPress: async () => {
            setDisconnectingPartner(true);
            try {
              await onDisconnectPartner(option.couple.id);
              setMode('menu');
              Alert.alert(t.disconnectPartnerSuccess);
            } catch (error) {
              console.error('disconnect partner failed', error);
              Alert.alert(t.disconnectPartnerError, t.unknownError);
            } finally {
              setDisconnectingPartner(false);
            }
          },
        },
      ]
    );
  };

  const handleDisconnectPartner = () => {
    if (disconnectingPartner) {
      return;
    }

    if (activePartnerOptions.length === 0) {
      Alert.alert(t.disconnectPartner, language === 'ko' ? '현재 연결된 파트너가 없어요.' : 'No partner is currently connected.');
      return;
    }

    if (activePartnerOptions.length === 1) {
      confirmDisconnectPartner(activePartnerOptions[0]);
      return;
    }

    setMode('disconnectPartner');
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

  const handleOpenReportEmail = async () => {
    const subject = '[Daydrop Report] 문제 신고';
    const body = [
      '신고 유형:',
      '',
      '* 불쾌한 사진',
      '* 메시지 문제',
      '* 파트너 연결 문제',
      '* 기타',
      '',
      '문제 내용:',
      '발생 시간:',
      '상대 닉네임 또는 계정 정보:',
    ].join('\n');

    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        throw new Error('mailto not supported');
      }
      await Linking.openURL(url);
    } catch (error) {
      console.warn('open report mail app failed', error);
      Alert.alert(
        language === 'ko' ? '문제 신고' : 'Report an Issue',
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
          : mode === 'disconnectPartner'
            ? t.disconnectPartner
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
          ) : mode === 'disconnectPartner' ? (
            <View style={styles.settingsDetail}>
              <Text allowFontScaling={false} style={styles.deleteTitle}>
                {language === 'ko' ? '연결 해제할 파트너를 선택해주세요.' : 'Choose a partner to disconnect.'}
              </Text>
              <Text allowFontScaling={false} style={styles.privacyText}>
                {language === 'ko'
                  ? '선택한 파트너 1명과의 연결만 해제됩니다.'
                  : 'Only the selected partner connection will be disconnected.'}
              </Text>
              <View style={styles.settingsList}>
                {activePartnerOptions.map((option, index) => {
                  const partner = option.members.find((member) => member.user_id !== profile.id) ?? null;
                  const name = displayMemberName(partner, t.partner);
                  const location = formatLocation(partner, language, '');
                  const relationship = option.couple.partner_type === 'friend' ? t.partnerTypeFriend : t.partnerTypeLover;

                  return (
                    <SettingsRow
                      key={option.couple.id}
                      danger
                      icon="user-minus"
                      title={name}
                      subtitle={[relationship, location].filter(Boolean).join(' · ')}
                      rightValue={disconnectingPartner ? (language === 'ko' ? '처리 중' : 'Working') : undefined}
                      onPress={() => confirmDisconnectPartner(option)}
                      showDivider={index < activePartnerOptions.length - 1}
                    />
                  );
                })}
              </View>
              <Pressable disabled={disconnectingPartner} onPress={() => setMode('menu')} style={styles.outlineButton}>
                <Text allowFontScaling={false} style={styles.outlineButtonText}>
                  {t.cancel}
                </Text>
              </Pressable>
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

              <SettingsSection title={language === 'ko' ? 'Help & Safety' : 'Help & Safety'}>
                <SettingsRow
                  danger
                  icon="user-minus"
                  title={t.disconnectPartner}
                  subtitle={t.disconnectPartnerBody}
                  rightValue={disconnectingPartner ? (language === 'ko' ? '처리 중' : 'Working') : undefined}
                  onPress={handleDisconnectPartner}
                />
                <SettingsRow
                  icon="flag"
                  title={t.reportIssue}
                  subtitle={t.reportIssueBody}
                  onPress={handleOpenReportEmail}
                  showDivider={false}
                />
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
          <Text allowFontScaling={false} numberOfLines={2} style={styles.settingsRowSubtitle}>
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

function getRemoteImageSize(image: string): Promise<ImageSize> {
  return getCachedRemoteImageSize(image);
}

function getCachedRemoteImageSize(image: string): Promise<ImageSize> {
  const cachedSize = imageSizeCache.get(image);
  if (cachedSize) {
    return Promise.resolve(cachedSize);
  }

  const inFlightSize = imageSizeInFlight.get(image);
  if (inFlightSize) {
    return inFlightSize;
  }

  const nextSize = loadRemoteImageSize(image)
    .then((size) => {
      imageSizeCache.set(image, size);
      return size;
    })
    .finally(() => {
      imageSizeInFlight.delete(image);
    });

  imageSizeInFlight.set(image, nextSize);
  return nextSize;
}

function loadRemoteImageSize(image: string): Promise<ImageSize> {
  return new Promise((resolve, reject) => {
    RNImage.getSize(
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

async function prepareOriginalShareData(data: ShareStoryData): Promise<ShareStoryData> {
  const [leftUri, rightUri] = await Promise.all([
    getOriginalShareUri(data.leftOriginalUri, data.leftOriginalStoragePath),
    getOriginalShareUri(data.rightOriginalUri, data.rightOriginalStoragePath),
  ]);

  return {
    ...data,
    leftUri,
    rightUri,
  };
}

async function getOriginalShareUri(originalUri: string, storagePath?: string | null) {
  const normalizedPath = storagePath?.trim();
  if (!normalizedPath || normalizedPath.startsWith('local://')) {
    return originalUri;
  }

  try {
    return await createPhotoSignedUrl(normalizedPath);
  } catch (error) {
    console.warn('[share] original image signing failed; using existing URL fallback', { storagePath: normalizedPath, error });
    return originalUri;
  }
}

function createPhotoPreviewLayout(
  pair: SharePhotoPair,
  leftSize: ImageSize,
  rightSize: ImageSize,
  windowWidth: number,
  windowHeight: number,
  insets: { bottom: number; top: number }
): PhotoPreviewLayout {
  const leftRatio = leftSize.width / leftSize.height;
  const rightRatio = rightSize.width / rightSize.height;
  const maxWidth = Math.max(1, windowWidth);
  const maxHeight = Math.max(1, windowHeight - insets.top - insets.bottom - 108);
  const targetHeight = Math.max(1, Math.min(maxHeight, maxWidth / (leftRatio + rightRatio)));
  const leftWidth = Math.max(1, Math.round(targetHeight * leftRatio));
  const rightWidth = Math.max(1, Math.round(targetHeight * rightRatio));

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

function createShareStoryLayout(data: ShareStoryData, leftSize: ImageSize, rightSize: ImageSize, language: Language): ShareStoryLayout {
  const leftRatio = leftSize.width / leftSize.height;
  const rightRatio = rightSize.width / rightSize.height;
  const photoHeight = Math.max(1, Math.min(STORY_TEMPLATE_PHOTO_HEIGHT, STORY_TEMPLATE_PHOTO_WIDTH / (leftRatio + rightRatio)));
  const leftWidth = Math.max(1, Math.round(photoHeight * leftRatio));
  const rightWidth = Math.max(1, Math.round(photoHeight * rightRatio));
  const photoWidth = leftWidth + rightWidth;

  return {
    ...data,
    height: STORY_TEMPLATE_BASE_HEIGHT,
    key: Date.now(),
    leftPhoto: {
      height: photoHeight,
      width: leftWidth,
    },
    mission: formatStoryMission(data.mission, language),
    photoHeight,
    photoWidth,
    rightPhoto: {
      height: photoHeight,
      width: rightWidth,
    },
    width: STORY_TEMPLATE_BASE_WIDTH,
  };
}

function formatStoryMission(value: string, language: Language) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.includes('\n')) {
    return normalized;
  }

  if (language === 'ko') {
    return splitBalancedKoreanMission(normalized);
  }

  return splitBalancedWordMission(normalized);
}

function splitBalancedKoreanMission(value: string) {
  const weightedLength = Array.from(value).reduce((total, char) => total + (/[ -~]/.test(char) ? 0.55 : 1), 0);
  if (weightedLength <= 11) {
    return value;
  }

  const chars = Array.from(value);
  const target = weightedLength / 2;
  let bestIndex = Math.ceil(chars.length / 2);
  let bestScore = Number.POSITIVE_INFINITY;
  let leftWeight = 0;

  chars.forEach((char, index) => {
    leftWeight += /[ -~]/.test(char) ? 0.55 : 1;
    if (index < 3 || index > chars.length - 5) {
      return;
    }

    const nextChar = chars[index + 1];
    const boundaryBonus = char === ' ' || nextChar === ' ' ? -1.6 : 0;
    const score = Math.abs(leftWeight - target) + boundaryBonus;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index + 1;
    }
  });

  return `${chars.slice(0, bestIndex).join('').trim()}\n${chars.slice(bestIndex).join('').trim()}`;
}

function splitBalancedWordMission(value: string) {
  const words = value.split(' ');
  if (words.length < 4 || value.length <= 24) {
    return value;
  }

  const target = value.length / 2;
  let bestIndex = Math.ceil(words.length / 2);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const left = words.slice(0, index).join(' ');
    const score = Math.abs(left.length - target);
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return `${words.slice(0, bestIndex).join(' ')}\n${words.slice(bestIndex).join(' ')}`;
}

async function prepareCapturedStoryFile(uri: string) {
  const capturedInfo = await FileSystem.getInfoAsync(uri);
  console.log('[share] captured file exists', capturedInfo.exists);
  console.log('[share] captured file size', capturedInfo.exists ? capturedInfo.size ?? 0 : 0);

  if (!capturedInfo.exists || !capturedInfo.size || capturedInfo.size <= 0) {
    throw new Error('capture_file_empty');
  }

  if (!FileSystem.cacheDirectory) {
    return uri;
  }

  const shareUri = `${FileSystem.cacheDirectory}daydrop.png`;
  await FileSystem.deleteAsync(shareUri, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: shareUri });
  const shareInfo = await FileSystem.getInfoAsync(shareUri);
  console.log('[share] captured file exists', shareInfo.exists);
  console.log('[share] captured file size', shareInfo.exists ? shareInfo.size ?? 0 : 0);

  if (!shareInfo.exists || !shareInfo.size || shareInfo.size <= 0) {
    throw new Error('capture_file_empty');
  }

  return shareUri;
}

async function shareStoryFileFallback(uri: string, language: Language) {
  console.log('[share] fallback share attempt', { uri });
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      dialogTitle: language === 'ko' ? '공유하기' : 'Share',
      mimeType: 'image/png',
      UTI: 'public.png',
    });
    return;
  }

  await Share.share({
    message: language === 'ko' ? 'Daydrop 스토리 이미지' : 'Daydrop story image',
    url: uri,
  });
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

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function isDeleteConfirmText(value: string) {
  const normalized = value.trim();
  return normalized === 'DELETE' || normalized === '삭제' || normalized === '삭제';
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
      await signInWithEmail(email.trim(), password);
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

      await signInWithAppleIdToken(credential.identityToken, credential.fullName);
    } catch (error) {
      if (isAppleAuthCanceled(error)) {
        return;
      }

      logAppleSignInError(error, { stage: 'AuthScreen.handleAppleSignIn.catch' });
      Alert.alert(t.socialSignInFailed, t.tryAgain);
    } finally {
      authSubmittingRef.current = false;
      setSocialLoading(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.authWrap} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text allowFontScaling={false} style={styles.logo}>
            DAYDROP
          </Text>
          <Text allowFontScaling={false} style={styles.authTitle}>
            {t.login}
          </Text>
          <TextInput autoCapitalize="none" editable={!isSubmitting} keyboardType="email-address" onChangeText={setEmail} placeholder="email@example.com" style={styles.input} value={email} />
          <TextInput editable={!isSubmitting} onChangeText={setPassword} placeholder={t.password} secureTextEntry style={styles.input} value={password} />
          <Pressable disabled={isSubmitting} onPress={submit} style={[styles.primaryButton, isSubmitting && styles.disabledButton]}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text allowFontScaling={false} style={styles.primaryButtonText}>
                {t.login}
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
          <Pressable disabled={isSubmitting} onPress={() => router.push({ pathname: '/signup', params: { language } })} style={styles.authLinkWrap}>
            <Text allowFontScaling={false} style={styles.secondaryAction}>
              {language === 'ko' ? '계정 만들기' : 'Create account'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ProfileSetupScreen({
  isAppleUser,
  language,
  onLogout,
  onSaved,
  profile,
}: {
  isAppleUser: boolean;
  language: Language;
  onLogout: () => Promise<void>;
  onSaved: (profile: Profile) => Promise<void>;
  profile: Profile | null;
}) {
  const [selectedLanguage, setSelectedLanguage] = React.useState(language);
  const t = getTranslations(selectedLanguage);

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
          <ProfileForm
            hideDisplayName={isAppleUser}
            initialLanguage={language}
            onLanguageChange={setSelectedLanguage}
            profile={profile}
            onSaved={onSaved}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileForm({
  hideDisplayName = false,
  initialLanguage,
  onCancel,
  onLanguageChange,
  onSaved,
  profile,
}: {
  hideDisplayName?: boolean;
  initialLanguage: Language;
  onCancel?: () => void;
  onLanguageChange?: (language: Language) => void;
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
    if ((!hideDisplayName && !displayName.trim()) || !countryCode || !city.trim()) {
      const missing = [
        !hideDisplayName && !displayName.trim() ? formT.name : null,
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
      {!hideDisplayName ? <TextInput onChangeText={setDisplayName} placeholder={formT.name} style={styles.input} value={displayName} /> : null}
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
          <LanguageButton
            active={preferredLanguage === 'ko'}
            disabled={saving}
            label={formT.korean}
            onPress={() => {
              setPreferredLanguage('ko');
              onLanguageChange?.('ko');
            }}
          />
          <LanguageButton
            active={preferredLanguage === 'en'}
            disabled={saving}
            label={formT.english}
            onPress={() => {
              setPreferredLanguage('en');
              onLanguageChange?.('en');
            }}
          />
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
  invitePartnerType,
  language,
  onClose,
  onConnected,
  onInviteCreated,
  onInviteCodeHandled,
  onLogout,
  pending,
  profile,
}: {
  currentPartnerType: PartnerType | null;
  initialInviteCode: string | null;
  inviteCode: string | null;
  invitePartnerType: PartnerType | null;
  language: Language;
  onClose?: () => void;
  onConnected: () => Promise<void>;
  onInviteCreated: () => Promise<void>;
  onInviteCodeHandled: () => void;
  onLogout: () => Promise<void>;
  pending: boolean;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const [code, setCode] = React.useState('');
  const [createdCode, setCreatedCode] = React.useState(inviteCode);
  const [createdPartnerType, setCreatedPartnerType] = React.useState(invitePartnerType ?? currentPartnerType);
  const [pendingAction, setPendingAction] = React.useState<'create' | 'join' | 'regenerate' | null>(null);
  const [partnerType, setPartnerType] = React.useState<PartnerType | null>(null);
  const processedInviteCodeRef = React.useRef<string | null>(null);
  const canShowCreatedCode = Boolean(createdCode && createdPartnerType);
  const displayPartnerType = canShowCreatedCode ? createdPartnerType : partnerType ?? currentPartnerType ?? null;
  const connectionLabel = displayPartnerType === 'friend' ? t.partnerTypeFriend : t.partnerTypeLover;
  const connectTitle = getConnectTitle(displayPartnerType, language);
  const connectBody = getConnectBody(displayPartnerType, language);
  const displayName = profile.display_name?.trim() || t.me;
  const isRegeneratingInvite = pendingAction === 'regenerate';

  React.useEffect(() => {
    if (inviteCode) {
      setCreatedCode(inviteCode);
      setCreatedPartnerType(invitePartnerType ?? currentPartnerType);
      setPartnerType(null);
      return;
    }

    setCreatedCode((currentCode) => currentCode ?? null);
    setCreatedPartnerType((currentPartnerTypeValue) => currentPartnerTypeValue ?? invitePartnerType ?? currentPartnerType);
  }, [currentPartnerType, inviteCode, invitePartnerType]);

  const createInvite = async () => {
    if (!partnerType) {
      Alert.alert(t.confirm, t.partnerTypeRequired);
      return;
    }

    setPendingAction('create');
    try {
      const nextCode = await createCoupleInvite(partnerType);
      setCreatedCode(nextCode);
      setCreatedPartnerType(partnerType);
      await onInviteCreated();
    } catch (error) {
      console.error('create invite failed', error);
      Alert.alert(t.inviteCodeError, t.unknownError);
    } finally {
      setPendingAction(null);
    }
  };

  const regenerateInvite = async () => {
    const nextPartnerType = partnerType ?? createdPartnerType;
    if (!nextPartnerType || pendingAction === 'regenerate') {
      return;
    }

    setPendingAction('regenerate');
    try {
      const nextCode = await createCoupleInvite(nextPartnerType);
      setCreatedCode(nextCode);
      setCreatedPartnerType(nextPartnerType);
      await onInviteCreated();
    } catch (error) {
      console.error('regenerate invite failed', error);
      Alert.alert(t.inviteCodeError, t.unknownError);
    } finally {
      setPendingAction(null);
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
    setPendingAction('join');
    try {
      await joinCoupleByInviteCode(normalizedCode);
      await onConnected();
      onClose?.();
    } catch (error) {
      console.error('join invite failed', error);
      Alert.alert(t.joinError, getJoinInviteErrorMessage(error, t));
    } finally {
      setPendingAction(null);
    }
  }, [code, onClose, onConnected, t]);

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
              <PartnerTypeSelector
                disabled={isRegeneratingInvite}
                partnerType={partnerType ?? createdPartnerType}
                setPartnerType={setPartnerType}
                t={t}
              />
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
                <Pressable onPress={shareInvite} style={[styles.inviteActionButton, styles.inviteShareButton]}>
                  <Feather name="share-2" size={17} color="#FFFFFF" style={styles.inviteActionIcon} />
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={[styles.inviteActionText, styles.inviteActionTextPrimary]}>
                    {language === 'ko' ? '초대 공유하기' : 'Share invite'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await Clipboard.setStringAsync(createdCode!);
                    Alert.alert(t.copyDone, t.inviteCode);
                  }}
                  style={[styles.inviteActionButton, styles.inviteCopyButton]}>
                  <Feather name="copy" size={16} color="#111111" style={styles.inviteActionIcon} />
                  <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.inviteActionText}>
                    {language === 'ko' ? '복사하기' : 'Copy'}
                  </Text>
                </Pressable>
              </View>
              <Pressable disabled={isRegeneratingInvite} onPress={regenerateInvite} style={[styles.inviteRegenerateButton, isRegeneratingInvite && styles.inviteRegenerateButtonLoading]}>
                {isRegeneratingInvite ? <ActivityIndicator color="#111111" size="small" /> : <Feather name="refresh-cw" size={15} color="#111111" style={styles.inviteActionIcon} />}
                <Text allowFontScaling={false} adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.inviteRegenerateText}>
                  {language === 'ko' ? '새 코드 만들기' : 'New code'}
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <PartnerTypeSelector
                disabled={pendingAction === 'create'}
                partnerType={partnerType}
                setPartnerType={setPartnerType}
                t={t}
              />
              <Pressable disabled={pendingAction === 'create' || !partnerType} onPress={createInvite} style={[styles.primaryButton, (pendingAction === 'create' || !partnerType) && styles.disabledButton]}>
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
          <Pressable disabled={pendingAction === 'join'} onPress={() => joinInvite()} style={[styles.outlineButton, pendingAction === 'join' && styles.disabledButton]}>
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

function getJoinInviteErrorMessage(error: unknown, t: ReturnType<typeof getTranslations>) {
  const errorType = getJoinInviteErrorType(error);

  if (errorType === 'alreadyConnected') {
    return t.alreadyConnectedPartner;
  }

  if (errorType === 'selfInvite') {
    return t.selfInviteCode;
  }

  if (errorType === 'invalid') {
    return t.invalidInviteCode;
  }

  if (errorType === 'expired') {
    return t.expiredInviteCode;
  }

  return t.unknownError;
}

type JoinInviteErrorType = 'alreadyConnected' | 'expired' | 'invalid' | 'selfInvite' | 'unknown';

function getJoinInviteErrorType(error: unknown): JoinInviteErrorType {
  let message = '';
  if (error instanceof Error || typeof error === 'string') {
    message = error instanceof Error ? error.message : error;
  } else if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    message = error.message;
  }

  if (message.includes('already_connected_partner') || message.includes('already_in_couple')) {
    return 'alreadyConnected';
  }

  if (message.includes('expired_invite_code')) {
    return 'expired';
  }

  if (message.includes('invalid_invite_code')) {
    return 'invalid';
  }

  if (message.includes('self_invite_code')) {
    return 'selfInvite';
  }

  return 'unknown';
}

function getInviteCodeFromURL(url: string | null) {
  if (!url) {
    return '';
  }

  try {
    const parsed = ExpoLinking.parse(url);
    return getInviteCodeFromQueryParams(parsed.queryParams);
  } catch (error) {
    console.warn('invite link parse failed', error);
    return '';
  }
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

function isAppleUser(user: AuthUser) {
  const provider = user.app_metadata?.provider;
  const providers = user.app_metadata?.providers;

  return provider === 'apple' || (Array.isArray(providers) && providers.includes('apple'));
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

function AppLoadingScreen({ language: preferredLanguage }: { language?: Language }) {
  const language = getPreferredOrDeviceLanguage(preferredLanguage);
  const subtitle = language === 'ko' ? '\uC624\uB298\uC744 \uACF5\uC720\uD558\uB294 \uAC00\uC7A5 \uC26C\uC6B4 \uBC29\uBC95' : 'The easiest way to share your day';

  return (
    <SafeAreaView style={styles.appLoadingScreen}>
      <View style={styles.appLoadingContent}>
        <Text allowFontScaling={false} style={styles.appLoadingLogo}>
          DAYDROP
        </Text>
        <View style={styles.appLoadingSubtitleWrap}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.appLoadingSubtitle, language === 'ko' ? styles.appLoadingSubtitleKo : styles.appLoadingSubtitleEn]}>
            {subtitle}
          </Text>
        </View>
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

function getActivePartnerOptions(myCouple: MyCouple | null, myUserId: string) {
  return (myCouple?.availableCouples ?? []).filter(
    (option) => option.couple.status === 'active' && option.members.some((member) => member.user_id !== myUserId)
  );
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

function formatDate(value: string, language: Language) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat(language === 'ko' ? 'ko-KR' : 'en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatStoryDate(value: string) {
  const [year, month, day] = value.split('-');
  if (year && month && day) {
    return `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')}`;
  }

  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatLocationValue(city: string | null | undefined, country: string | null | undefined, language: Language) {
  const countryLabel = getCountryLabel(country, language);
  return [city?.trim(), countryLabel].filter(Boolean).join(', ');
}

function sideRadius(side: 'left' | 'right') {
  return side === 'left' ? styles.leftSlotRadius : styles.rightSlotRadius;
}

const styles = StyleSheet.create({
  appLoadingScreen: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
  },
  appLoadingContent: {
    alignItems: 'center',
    height: 92,
    justifyContent: 'flex-start',
    transform: [{ translateY: -56 }],
    width: '100%',
  },
  appLoadingLogo: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 10,
    paddingLeft: 10,
  },
  appLoadingSubtitleWrap: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginTop: 14,
    width: '100%',
  },
  appLoadingSubtitle: {
    color: 'rgba(255, 255, 255, 0.62)',
    fontWeight: '400',
    lineHeight: 21,
    paddingHorizontal: 24,
    textAlign: 'center',
  },
  appLoadingSubtitleKo: {
    fontSize: 15,
  },
  appLoadingSubtitleEn: {
    fontSize: 14,
  },
  hidden: {
    display: 'none',
  },
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
    color: '#333333',
    fontSize: 21,
    fontWeight: '700',
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
    color: '#111111',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 24,
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
    flexBasis: 0,
    flexShrink: 1,
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
    backgroundColor: '#F5FAFF',
  },
  prePartnerTitle: {
    color: '#4F4F4F',
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  prePartnerBody: {
    color: '#777777',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: 12,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  waitingContent: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    transform: [{ translateY: -6 }],
  },
  waitingText: {
    color: TODAY_DROP_PENDING_TEXT_COLOR,
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
  lockedImageWrap: {
    height: '100%',
    overflow: 'hidden',
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
    color: TODAY_DROP_PENDING_TEXT_COLOR,
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
    textAlign: 'center',
  },
  authLinkWrap: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 26,
  },
  recentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 2,
  },
  recentTitle: {
    color: '#333333',
    fontSize: 20,
    fontWeight: '700',
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
    columnGap: 0,
    flexDirection: 'row',
    gap: 0,
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
  photoPreviewBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    flex: 1,
    justifyContent: 'center',
  },
  photoPreviewClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 18,
    top: 58,
    width: 44,
    zIndex: 2,
  },
  photoPreviewRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  storyCaptureCanvas: {
    alignItems: 'center',
    backgroundColor: '#F7F6F2',
    justifyContent: 'flex-start',
    left: -10000,
    overflow: 'hidden',
    position: 'absolute',
    top: -10000,
  },
  storyEyebrow: {
    color: '#979189',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
    marginBottom: 13,
    marginTop: 80,
    textAlign: 'center',
  },
  storyMission: {
    color: '#050505',
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 27,
    marginBottom: 18,
    textAlign: 'center',
    width: 286,
  },
  storyPhotoShadow: {
    backgroundColor: '#F7F6F2',
    borderRadius: 8,
    elevation: 2,
    marginBottom: 17,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  storyPhotoRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  storyNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  storyPersonBlock: {
    alignItems: 'center',
    width: 104,
  },
  storyName: {
    color: '#111111',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
    textAlign: 'center',
    width: '100%',
  },
  storyLocation: {
    color: '#928E87',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 13,
    marginTop: 1,
    textAlign: 'center',
    width: '100%',
  },
  storyOrnament: {
    color: '#AAA59E',
    display: 'none',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 2,
    textAlign: 'center',
  },
  storyDivider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 25,
  },
  storyDividerLine: {
    backgroundColor: '#D9D4CB',
    flex: 1,
    height: 1,
  },
  storyDividerDot: {
    backgroundColor: '#BDB6AA',
    borderRadius: 1.5,
    height: 3,
    width: 3,
  },
  storyDate: {
    color: '#8F8A83',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    lineHeight: 16,
    marginBottom: 23,
    textAlign: 'center',
    width: STORY_TEMPLATE_PHOTO_WIDTH,
  },
  storyBrand: {
    color: '#050505',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 6,
    lineHeight: 18,
    paddingLeft: 6,
    textAlign: 'center',
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
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
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
    marginTop: 18,
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
    gap: 8,
  },
  inviteActionButton: {
    alignItems: 'center',
    borderColor: '#E4E0D8',
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    height: 46,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  inviteShareButton: {
    backgroundColor: '#111111',
    borderColor: '#111111',
    flex: 1.45,
  },
  inviteCopyButton: {
    backgroundColor: '#FFFFFF',
    flex: 0.8,
  },
  inviteActionIcon: {
    marginTop: 1,
  },
  inviteActionText: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '700',
  },
  inviteActionTextPrimary: {
    color: '#FFFFFF',
  },
  inviteRegenerateButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E2DED6',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    minWidth: 128,
    paddingHorizontal: 14,
  },
  inviteRegenerateButtonLoading: {
    opacity: 0.72,
  },
  inviteRegenerateText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '700',
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
