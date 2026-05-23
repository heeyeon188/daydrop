import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { displayDayCount } from '@/lib/dayCount';
import { getTranslations, normalizeLanguage, type Language } from '@/lib/i18n';
import { useMyCouple } from '@/hooks/useMyCouple';
import { useProfile } from '@/hooks/useProfile';
import { useSession } from '@/hooks/useSession';
import { useTodayDrop } from '@/hooks/useTodayDrop';
import { signInWithEmail, signOut, signUpWithEmail } from '@/services/auth';
import { createCoupleInvite, joinCoupleByInviteCode, type MyCouple } from '@/services/couple';
import { deleteMyTodayDropPhoto, submitDropPhoto } from '@/services/drops';
import { registerPushToken } from '@/services/notifications';
import { completeProfile, updatePreferredLanguage, type ProfileInput } from '@/services/profile';
import { pickImageFromLibrary, takePhotoWithCamera } from '@/services/storage';
import type { CoupleMember, DropState, DropSubmission, Profile, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const MOSAIC_BLOCKS = Array.from({ length: 28 }, (_, index) => index);

type Copy = ReturnType<typeof getTranslations>;
type FullImage = { canDelete?: boolean; image?: string; label: string; mission: string };
type DropDetail = { drop: RecentDrop; state: DropState };

export default function MissionScreen() {
  const { user, loading: sessionLoading, configError } = useSession();
  const profileState = useProfile(user?.id);
  const myCouple = useMyCouple(Boolean(user));
  const language = normalizeLanguage(profileState.profile?.preferred_language);
  const t = getTranslations(language);

  React.useEffect(() => {
    if (user) {
      registerPushToken(user.id);
    }
  }, [user]);

  if (sessionLoading) {
    return <CenteredState text={t.loadingApp} />;
  }

  if (configError) {
    return <CenteredState text={configError} />;
  }

  if (!user) {
    return <AuthScreen language={language} />;
  }

  if (profileState.loading || (myCouple.loading && profileState.profile?.profile_completed)) {
    return <CenteredState text={profileState.loading ? t.loadingApp : t.coupleLoading} />;
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

  if (!myCouple.couple) {
    return (
      <CoupleConnectScreen
        language={language}
        inviteCode={null}
        onConnected={myCouple.refetch}
        onLogout={signOut}
        pending={false}
        profile={profileState.profile}
      />
    );
  }

  const couple = myCouple.couple.couple;
  const coupleReady = couple.status === 'active' && myCouple.couple.members.length >= 2;

  if (!coupleReady) {
    return (
      <CoupleConnectScreen
        language={language}
        inviteCode={couple.invite_code}
        onConnected={myCouple.refetch}
        onLogout={signOut}
        pending
        profile={profileState.profile}
      />
    );
  }

  return (
    <MissionContent
      language={language}
      myCouple={myCouple.couple}
      myEmail={user.email ?? 'No email'}
      myUserId={user.id}
      onLanguageChanged={profileState.setProfile}
      onLogout={signOut}
      onProfileSaved={async (profile) => {
        profileState.setProfile(profile);
        await myCouple.refetch();
      }}
      profile={profileState.profile}
    />
  );
}

function MissionContent({
  language,
  myCouple,
  myEmail,
  myUserId,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  profile,
}: {
  language: Language;
  myCouple: MyCouple;
  myEmail: string;
  myUserId: string;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const { today, recentDrops, loading, refreshing, error, refetch } = useTodayDrop(myCouple.couple.id);
  const [deletingPhoto, setDeletingPhoto] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [fullImage, setFullImage] = React.useState<FullImage | null>(null);
  const [allDropsVisible, setAllDropsVisible] = React.useState(false);
  const [dropDetail, setDropDetail] = React.useState<DropDetail | null>(null);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const members = splitMembers(today?.members ?? myCouple.members, myUserId);
  const state = getDropState(today, myUserId);
  const stateCopy = getStateCopy(state, t);
  const dayLabel = today
    ? displayDayCount(today.daily_drop.day_count, today.couple.relationship_start_date, today.daily_drop.drop_date)
    : displayDayCount(null, myCouple.couple.relationship_start_date);
  const meta = buildMeta(members, dayLabel, t);
  const missionTitle = getMissionPrompt(today?.mission, language);

  const uploadPickedPhoto = async (picker: () => ReturnType<typeof pickImageFromLibrary>) => {
    if (!today || state === 'meOnly' || state === 'both' || uploading || deletingPhoto) {
      return;
    }

    try {
      setUploading(true);
      const picked = await picker();
      if (!picked) {
        return;
      }

      await submitDropPhoto({
        base64: picked.base64 ?? '',
        coupleId: today.daily_drop.couple_id,
        dropId: today.daily_drop.id,
        userId: myUserId,
      });
      await refetch(true);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : '';
      Alert.alert(
        t.uploadError,
        message === 'photo_permission_denied' ? t.photoPermission : message === 'photo_read_failed' ? t.photoReadError : message || t.photoReadError
      );
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = () => {
    if (deletingPhoto) {
      return;
    }

    Alert.alert(t.pickPhotoTitle, undefined, [
      { text: t.camera, onPress: () => uploadPickedPhoto(takePhotoWithCamera) },
      { text: t.album, onPress: () => uploadPickedPhoto(pickImageFromLibrary) },
      { text: t.cancel, style: 'cancel' },
    ]);
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
      const refetchResult = await refetch(true);
      console.log(
        'refetch result',
        refetchResult
          ? {
              currentState: getDropState(refetchResult.today, myUserId),
              currentSubmissionCount: refetchResult.today.submissions.length,
              dropId: refetchResult.today.daily_drop.id,
            }
          : null
      );
    } catch (nextError) {
      console.error('deleteMyTodayDropPhoto failed', nextError);
      console.log('refetch result', 'skipped because delete failed');
      const message = getErrorMessage(nextError);
      Alert.alert(t.deletePhotoError, message || t.unknownError);
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

        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {t.mission}
        </Text>

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
              disabled={state === 'meOnly' || state === 'both' || uploading || deletingPhoto}
              onPress={handleUpload}
              style={[styles.primaryButton, (state === 'meOnly' || state === 'both' || uploading || deletingPhoto) && styles.disabledButton]}>
              {uploading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  allowFontScaling={false}
                  style={[styles.primaryButtonText, (state === 'meOnly' || state === 'both' || deletingPhoto) && styles.disabledButtonText]}>
                  {stateCopy.button}
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
                language={language}
                myUserId={myUserId}
                relationshipStartDate={today?.couple.relationship_start_date ?? myCouple.couple.relationship_start_date}
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
        language={language}
        myUserId={myUserId}
        relationshipStartDate={today?.couple.relationship_start_date ?? myCouple.couple.relationship_start_date}
        t={t}
        onClose={() => setAllDropsVisible(false)}
        onOpenDrop={(drop) => setDropDetail({ drop, state: getRecentDropState(drop, myUserId) })}
        visible={allDropsVisible}
      />
      <DropDetailModal
        detail={dropDetail}
        language={language}
        myUserId={myUserId}
        relationshipStartDate={today?.couple.relationship_start_date ?? myCouple.couple.relationship_start_date}
        t={t}
        onClose={() => setDropDetail(null)}
      />
      <SettingsSheet
        couple={myCouple}
        email={myEmail}
        language={language}
        profile={profile}
        t={t}
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onLanguageChanged={onLanguageChanged}
        onLogout={onLogout}
        onProfileSaved={onProfileSaved}
      />
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

function TodayDropPair({
  deletingPhoto,
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
  const mine = today.submissions.find((submission) => submission.user_id === myUserId);
  const partner = today.submissions.find((submission) => submission.user_id !== myUserId);
  const myLabel = displayMemberName(members.me, t.me);
  const partnerLabel = displayMemberName(members.partner, t.partner);
  const mission = getMissionPrompt(today.mission, language);

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
  const mine = submissions.some((submission) => submission.user_id === myUserId);
  const partner = submissions.some((submission) => submission.user_id !== myUserId);

  if (mine && partner) return 'both';
  if (mine) return 'meOnly';
  if (partner) return 'partnerOnly';
  return 'none';
}

function getStateCopy(state: DropState, t: Copy) {
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
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.dropSlot, toneStyle, sideRadius(side)]}>
      <Feather name={icon} size={30} color={toneColor} strokeWidth={1.6} />
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
    <View style={[styles.dropSlot, styles.waitingSlot, sideRadius('left')]}>
      <View style={styles.waitingContent}>
        <Feather name="refresh-cw" size={40} color="#858585" strokeWidth={1.65} />
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
      <SafeImage image={image} label={label} />
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
      <SafeImage image={image} label={label} />
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.photoLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function LockedPhotoSlot({ image, label, onPress, t }: { image?: string; label: string; onPress: () => void; t: Copy }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.imageSlot, sideRadius('left')]}>
      <SafeImage blurRadius={24} image={image} label={label} />
      <View pointerEvents="none" style={styles.partnerLockVeil} />
      <View style={[styles.lockContent, styles.partnerLockContent]}>
        <Feather name="lock" size={26} color="#FFFFFF" strokeWidth={2.1} />
        <Text allowFontScaling={false} numberOfLines={2} style={styles.partnerLockText}>
          {t.partnerSent}
        </Text>
      </View>
    </Pressable>
  );
}

function SendSlot({ label, onPress, t }: { label: string; onPress: () => void; t: Copy }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.sendSlot, sideRadius('right')]}>
      <View style={styles.innerDashedSlot}>
        <View style={styles.plusCircle}>
          <Feather name="plus" size={22} color="#FFFFFF" strokeWidth={2.2} />
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

function SafeImage({ blurRadius = 0, image, label }: { blurRadius?: number; image?: string; label: string }) {
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
      resizeMode="cover"
      source={{ uri: image }}
      style={styles.slotImage}
      onError={(event) => {
        console.warn(`Daydrop image failed to load (${label})`, event.nativeEvent.error);
        setFailed(true);
      }}
    />
  );
}

function MosaicOverlay() {
  return (
    <View pointerEvents="none" style={styles.mosaicOverlay}>
      {MOSAIC_BLOCKS.map((block) => (
        <View
          key={block}
          style={[
            styles.mosaicBlock,
            {
              left: `${(block % 7) * 14.3}%`,
              opacity: block % 2 === 0 ? 0.28 : 0.16,
              top: `${Math.floor(block / 7) * 25}%`,
            },
          ]}
        />
      ))}
    </View>
  );
}

function RecentDropRow({
  drop,
  language,
  myUserId,
  onPress,
  relationshipStartDate,
}: {
  drop: RecentDrop;
  language: Language;
  myUserId: string;
  onPress: () => void;
  relationshipStartDate?: string | null;
}) {
  const mine = drop.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = Boolean(mine && partner);
  const dayLabel = displayDayCount(drop.day_count, relationshipStartDate, drop.drop_date);

  return (
    <Pressable onPress={onPress} style={styles.recentRow}>
      <View style={styles.recentThumbs}>
        <RecentThumb image={partner?.image_url} locked={!isOpen && Boolean(partner)} side="left" />
        <RecentThumb image={mine?.image_url} locked={!isOpen && Boolean(mine)} side="right" />
      </View>
      <View style={styles.recentInfo}>
        <Text allowFontScaling={false} style={styles.recentDate}>
          {formatDate(drop.drop_date, language)}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.recentMission}>
          {getMissionPrompt(drop.mission, language)}
        </Text>
        <Text allowFontScaling={false} style={styles.recentMeta}>
          {dayLabel ?? getTranslations(language).dayNotSet}
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color="#777777" />
    </Pressable>
  );
}

function RecentThumb({ image, locked, side }: { image?: string; locked: boolean; side: 'left' | 'right' }) {
  return (
    <View style={[styles.recentThumb, side === 'left' ? styles.recentThumbLeft : styles.recentThumbRight]}>
      {image ? <SafeImage blurRadius={locked ? 12 : 0} image={image} label={`recent-${side}`} /> : <View style={styles.recentPlaceholder} />}
      {locked ? (
        <>
          <MosaicOverlay />
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

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return '';
}

function AllDropsModal({
  drops,
  language,
  myUserId,
  onClose,
  onOpenDrop,
  relationshipStartDate,
  t,
  visible,
}: {
  drops: RecentDrop[];
  language: Language;
  myUserId: string;
  onClose: () => void;
  onOpenDrop: (drop: RecentDrop) => void;
  relationshipStartDate?: string | null;
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
                language={language}
                myUserId={myUserId}
                relationshipStartDate={relationshipStartDate}
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
  language,
  myUserId,
  onPress,
  relationshipStartDate,
}: {
  drop: RecentDrop;
  language: Language;
  myUserId: string;
  onPress: () => void;
  relationshipStartDate?: string | null;
}) {
  const mine = drop.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = Boolean(mine && partner);

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
          {displayDayCount(drop.day_count, relationshipStartDate, drop.drop_date) ?? getTranslations(language).dayNotSet}
        </Text>
      </View>
      <View style={styles.allDropThumbs}>
        <RecentThumb image={partner?.image_url} locked={!isOpen && Boolean(partner)} side="left" />
        <RecentThumb image={mine?.image_url} locked={!isOpen && Boolean(mine)} side="right" />
      </View>
    </Pressable>
  );
}

function DropDetailModal({
  detail,
  language,
  myUserId,
  onClose,
  relationshipStartDate,
  t,
}: {
  detail: DropDetail | null;
  language: Language;
  myUserId: string;
  onClose: () => void;
  relationshipStartDate?: string | null;
  t: Copy;
}) {
  const drop = detail?.drop;
  const mine = drop?.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop?.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = detail?.state === 'both';
  const dayLabel = drop ? displayDayCount(drop.day_count, relationshipStartDate, drop.drop_date) : null;

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
                {drop ? `${formatDate(drop.drop_date, language)} · ${dayLabel ?? t.dayNotSet}` : ''}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}>
              <Feather name="x" size={24} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.detailPhotos}>
            <DetailPhoto image={partner?.image_url} label={t.partner} locked={!isOpen && Boolean(partner)} />
            <DetailPhoto image={mine?.image_url} label={t.me} locked={!isOpen && Boolean(mine)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailPhoto({ image, label, locked }: { image?: string; label: string; locked: boolean }) {
  return (
    <View style={styles.detailPhoto}>
      {image ? <SafeImage blurRadius={locked ? 16 : 0} image={image} label={`detail-${label}`} /> : <View style={styles.detailPlaceholder} />}
      {locked ? (
        <>
          <MosaicOverlay />
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

function SettingsSheet({
  couple,
  email,
  language,
  onClose,
  onLanguageChanged,
  onLogout,
  onProfileSaved,
  profile,
  t,
  visible,
}: {
  couple: MyCouple;
  email: string;
  language: Language;
  onClose: () => void;
  onLanguageChanged: (profile: Profile) => void;
  onLogout: () => Promise<void>;
  onProfileSaved: (profile: Profile) => Promise<void>;
  profile: Profile;
  t: Copy;
  visible: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [savingLanguage, setSavingLanguage] = React.useState(false);
  const dayLabel = displayDayCount(null, couple.couple.relationship_start_date);
  const connectionText = couple.couple.status === 'active' ? t.connected : t.pending;

  const changeLanguage = async (nextLanguage: Language) => {
    if (nextLanguage === language || savingLanguage) {
      return;
    }
    setSavingLanguage(true);
    try {
      onLanguageChanged(await updatePreferredLanguage(nextLanguage));
    } catch (error) {
      Alert.alert(t.profileSaveError, error instanceof Error ? error.message : t.photoReadError);
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

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.profileSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.profileTop}>
            <Text allowFontScaling={false} style={styles.profileTitle}>
              Daydrop
            </Text>
            <Pressable hitSlop={12} onPress={onClose}>
              <Feather name="x" size={24} color="#111111" />
            </Pressable>
          </View>

          {editing ? (
            <ProfileForm
              initialLanguage={language}
              profile={profile}
              t={t}
              onCancel={() => setEditing(false)}
              onSaved={async (nextProfile) => {
                await onProfileSaved(nextProfile);
                setEditing(false);
              }}
            />
          ) : (
            <>
              <InfoLine label={t.name} value={profile.display_name ?? '-'} />
              <InfoLine label={t.email} value={email} />
              <InfoLine label={`${t.country} / ${t.city}`} value={[profile.city, profile.country].filter(Boolean).join(', ') || '-'} />
              <InfoLine label={t.timezone} value={profile.timezone ?? '-'} />
              <InfoLine label={t.couple} value={connectionText} />
              <InfoLine label={t.relationshipStartDate} value={couple.couple.relationship_start_date ? `${couple.couple.relationship_start_date} · ${dayLabel}` : t.dayNotSet} />
              <View style={styles.languageRow}>
                <Text allowFontScaling={false} style={styles.infoLabel}>
                  {t.language}
                </Text>
                <View style={styles.segment}>
                  <LanguageButton active={language === 'ko'} disabled={savingLanguage} label={t.korean} onPress={() => changeLanguage('ko')} />
                  <LanguageButton active={language === 'en'} disabled={savingLanguage} label={t.english} onPress={() => changeLanguage('en')} />
                </View>
              </View>
              <Pressable onPress={() => setEditing(true)} style={styles.outlineButton}>
                <Text allowFontScaling={false} style={styles.outlineButtonText}>
                  {t.profile}
                </Text>
              </Pressable>
              <Pressable onPress={handleLogout} style={styles.logoutButton}>
                <Feather name="log-out" size={19} color="#FFFFFF" />
                <Text allowFontScaling={false} style={styles.logoutText}>
                  {t.logout}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
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

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text allowFontScaling={false} style={styles.infoLabel}>
        {label}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

function AuthScreen({ language }: { language: Language }) {
  const t = getTranslations(language);
  const [mode, setMode] = React.useState<'login' | 'signup'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
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
      Alert.alert(t.authError, error instanceof Error ? error.message : t.confirm);
    } finally {
      setLoading(false);
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
          <TextInput autoCapitalize="none" keyboardType="email-address" onChangeText={setEmail} placeholder="email@example.com" style={styles.input} value={email} />
          <TextInput onChangeText={setPassword} placeholder={t.password} secureTextEntry style={styles.input} value={password} />
          <Pressable disabled={loading} onPress={submit} style={[styles.primaryButton, loading && styles.disabledButton]}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text allowFontScaling={false} style={styles.primaryButtonText}>
                {mode === 'login' ? t.login : t.signup}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
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
      <ScrollView contentContainerStyle={styles.scrollContent}>
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
          <ProfileForm initialLanguage={language} profile={profile} t={t} onSaved={onSaved} />
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
  t,
}: {
  initialLanguage: Language;
  onCancel?: () => void;
  onSaved: (profile: Profile) => Promise<void>;
  profile: Profile | null;
  t: Copy;
}) {
  const [displayName, setDisplayName] = React.useState(profile?.display_name ?? '');
  const [country, setCountry] = React.useState(profile?.country ?? '');
  const [city, setCity] = React.useState(profile?.city ?? '');
  const [timezone, setTimezone] = React.useState(profile?.timezone ?? getDeviceTimezone());
  const [preferredLanguage, setPreferredLanguage] = React.useState<Language>(normalizeLanguage(profile?.preferred_language ?? initialLanguage));
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!displayName.trim() || !country.trim() || !city.trim() || !timezone.trim()) {
      Alert.alert(t.confirm, `${t.name}, ${t.country}, ${t.city}, ${t.timezone}`);
      return;
    }

    const input: ProfileInput = {
      displayName,
      country,
      city,
      timezone,
      preferredLanguage,
    };

    setSaving(true);
    try {
      await onSaved(await completeProfile(input));
    } catch (error) {
      Alert.alert(t.profileSaveError, error instanceof Error ? error.message : t.confirm);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <TextInput onChangeText={setDisplayName} placeholder={t.name} style={styles.input} value={displayName} />
      <TextInput onChangeText={setCountry} placeholder={t.country} style={styles.input} value={country} />
      <TextInput onChangeText={setCity} placeholder={t.city} style={styles.input} value={city} />
      <TextInput autoCapitalize="none" onChangeText={setTimezone} placeholder={t.timezone} style={styles.input} value={timezone} />
      <View style={styles.languageRow}>
        <Text allowFontScaling={false} style={styles.infoLabel}>
          {t.language}
        </Text>
        <View style={styles.segment}>
          <LanguageButton active={preferredLanguage === 'ko'} disabled={saving} label={t.korean} onPress={() => setPreferredLanguage('ko')} />
          <LanguageButton active={preferredLanguage === 'en'} disabled={saving} label={t.english} onPress={() => setPreferredLanguage('en')} />
        </View>
      </View>
      <Pressable disabled={saving} onPress={save} style={[styles.primaryButton, saving && styles.disabledButton]}>
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text allowFontScaling={false} style={styles.primaryButtonText}>
            {t.save}
          </Text>
        )}
      </Pressable>
      {onCancel ? (
        <Pressable onPress={onCancel} style={styles.outlineButton}>
          <Text allowFontScaling={false} style={styles.outlineButtonText}>
            {t.cancel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function CoupleConnectScreen({
  inviteCode,
  language,
  onConnected,
  onLogout,
  pending,
  profile,
}: {
  inviteCode: string | null;
  language: Language;
  onConnected: () => Promise<void>;
  onLogout: () => Promise<void>;
  pending: boolean;
  profile: Profile;
}) {
  const t = getTranslations(language);
  const [code, setCode] = React.useState('');
  const [createdCode, setCreatedCode] = React.useState(inviteCode);
  const [relationshipStartDate, setRelationshipStartDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setCreatedCode(inviteCode);
  }, [inviteCode]);

  const createInvite = async () => {
    setLoading(true);
    try {
      const nextCode = await createCoupleInvite(relationshipStartDate);
      setCreatedCode(nextCode);
      await onConnected();
    } catch (error) {
      Alert.alert(t.inviteCodeError, error instanceof Error ? error.message : t.confirm);
    } finally {
      setLoading(false);
    }
  };

  const joinInvite = async () => {
    if (!code.trim()) {
      Alert.alert(t.inviteCode, t.enterInvite);
      return;
    }

    setLoading(true);
    try {
      await joinCoupleByInviteCode(code);
      await onConnected();
    } catch (error) {
      Alert.alert(t.joinError, error instanceof Error ? error.message : t.confirm);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text allowFontScaling={false} style={styles.logo}>
            DAYDROP
          </Text>
          <Pressable hitSlop={12} onPress={onLogout}>
            <Feather name="log-out" size={25} color="#050505" />
          </Pressable>
        </View>
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          {t.couple}
        </Text>
        <View style={styles.missionCard}>
          <Text allowFontScaling={false} style={styles.dropLabel}>
            {t.inviteCode}
          </Text>
          <Text allowFontScaling={false} style={styles.connectTitle}>
            {t.startTogether}
          </Text>
          <Text allowFontScaling={false} style={styles.connectBody}>
            {t.inviteBody}
          </Text>
          <InfoLine label={t.profile} value={[profile.display_name, profile.city, profile.country].filter(Boolean).join(' · ')} />

          {createdCode ? (
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(createdCode);
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
          ) : (
            <>
              <TextInput
                autoCapitalize="none"
                onChangeText={setRelationshipStartDate}
                placeholder="YYYY-MM-DD"
                style={styles.input}
                value={relationshipStartDate}
              />
              <Pressable disabled={loading} onPress={createInvite} style={[styles.primaryButton, loading && styles.disabledButton]}>
                <Text allowFontScaling={false} style={styles.primaryButtonText}>
                  {t.createInvite}
                </Text>
              </Pressable>
            </>
          )}

          {pending ? <InlineMessage text={t.waitingPartner} /> : null}

          <TextInput autoCapitalize="characters" onChangeText={setCode} placeholder={t.enterInvite} style={styles.input} value={code} />
          <Pressable disabled={loading} onPress={joinInvite} style={[styles.outlineButton, loading && styles.disabledButton]}>
            <Text allowFontScaling={false} style={styles.outlineButtonText}>
              {t.joinByCode}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
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

function splitMembers(members: CoupleMember[], myUserId: string): SplitMembers {
  return {
    me: members.find((member) => member.user_id === myUserId) ?? null,
    partner: members.find((member) => member.user_id !== myUserId) ?? null,
  };
}

function displayMemberName(member: CoupleMember | null, fallback: string) {
  return member?.display_name?.trim() || fallback;
}

function buildMeta(members: SplitMembers, dayLabel: string | null, t: Copy) {
  const partnerLocation = formatLocation(members.partner, t.cityFallbackPartner);
  const myLocation = formatLocation(members.me, t.cityFallbackMe);
  return `${partnerLocation} ↔ ${myLocation}${dayLabel ? ` · ${dayLabel}` : ` · ${t.dayNotSet}`}`;
}

function formatLocation(member: CoupleMember | null, fallback: string) {
  return [member?.city, member?.country].filter(Boolean).join(', ') || fallback;
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

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
  } catch {
    return 'Asia/Seoul';
  }
}

function sideRadius(side: 'left' | 'right') {
  return side === 'left' ? styles.leftSlotRadius : styles.rightSlotRadius;
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#FEFDFB',
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
  sectionTitle: {
    color: '#050505',
    fontSize: 27,
    fontWeight: '800',
    marginBottom: 14,
  },
  missionCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#ECECEC',
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
    fontSize: 14,
    fontWeight: '400',
    marginBottom: 10,
  },
  photoPair: {
    flexDirection: 'row',
    gap: 0,
    height: 252,
  },
  dropSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  blueSlot: {
    backgroundColor: '#FAFAFA',
  },
  sandSlot: {
    backgroundColor: '#FAFAFA',
  },
  waitingSlot: {
    backgroundColor: '#FAFAFA',
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
    backgroundColor: '#EAEAEA',
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
  mosaicOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  mosaicBlock: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    height: '25%',
    position: 'absolute',
    width: '14.3%',
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
    backgroundColor: '#FAFAFA',
    borderWidth: 0,
    padding: 0,
  },
  innerDashedSlot: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  plusCircle: {
    alignItems: 'center',
    backgroundColor: '#A9A9A9',
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
    color: '#5F5F5F',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 21,
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
    flexDirection: 'row',
    height: 82,
    marginRight: 14,
    overflow: 'hidden',
    width: 138,
  },
  recentThumb: {
    height: '100%',
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
    gap: 10,
    height: 260,
  },
  detailPhoto: {
    backgroundColor: '#EFEFEF',
    borderRadius: 14,
    flex: 1,
    overflow: 'hidden',
  },
  detailPlaceholder: {
    backgroundColor: '#F5F5F5',
    borderColor: '#DDDDDD',
    borderStyle: 'dashed',
    borderWidth: 1,
    height: '100%',
    width: '100%',
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
  infoLine: {
    alignItems: 'center',
    borderBottomColor: '#ECECEC',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  infoLabel: {
    color: '#777777',
    fontSize: 14,
    fontWeight: '600',
  },
  infoValue: {
    color: '#111111',
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    marginLeft: 16,
    textAlign: 'right',
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
  connectTitle: {
    color: '#050505',
    fontSize: 23,
    fontWeight: '800',
    lineHeight: 31,
    marginBottom: 10,
  },
  connectBody: {
    color: '#666666',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 18,
  },
  inviteCodeBox: {
    alignItems: 'center',
    backgroundColor: '#F7F7F7',
    borderColor: '#E1E1E1',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    marginBottom: 18,
    marginTop: 12,
    paddingVertical: 18,
  },
  inviteCode: {
    color: '#050505',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 4,
  },
  inviteHint: {
    color: '#777777',
    fontSize: 13,
    marginTop: 6,
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
