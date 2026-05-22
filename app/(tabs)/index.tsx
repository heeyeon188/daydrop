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

import { useMyCouple } from '@/hooks/useMyCouple';
import { useSession } from '@/hooks/useSession';
import { useTodayDrop } from '@/hooks/useTodayDrop';
import { signInWithEmail, signOut, signUpWithEmail } from '@/services/auth';
import { createCoupleInvite, joinCoupleByInviteCode } from '@/services/couple';
import { submitDropPhoto } from '@/services/drops';
import { registerPushToken } from '@/services/notifications';
import { pickImageFromLibrary } from '@/services/storage';
import type { CoupleMember, DropState, DropSubmission, RecentDrop, TodayDropPayload } from '@/types/daydrop';

const DEFAULT_CITY_PAIR = ['Seoul', 'New York'];
const MOSAIC_BLOCKS = Array.from({ length: 28 }, (_, index) => index);

type FullImage = {
  image?: string;
  label: 'Him' | 'Me';
  mission: string;
};

type DropDetail = {
  drop: RecentDrop;
  state: DropState;
};

export default function MissionScreen() {
  const { user, loading: sessionLoading, configError } = useSession();
  const myCouple = useMyCouple(Boolean(user));

  React.useEffect(() => {
    if (user) {
      registerPushToken(user.id);
    }
  }, [user]);

  if (sessionLoading) {
    return <CenteredState text="Daydrop을 준비하는 중이에요." />;
  }

  if (configError) {
    return <CenteredState text={configError} />;
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (myCouple.loading) {
    return <CenteredState text="커플 정보를 불러오는 중이에요." />;
  }

  if (!myCouple.couple) {
    return (
      <CoupleConnectScreen
        inviteCode={null}
        pending={false}
        onConnected={myCouple.refetch}
        onLogout={signOut}
      />
    );
  }

  const couple = myCouple.couple.couple;
  const coupleReady = couple.status === 'active' && myCouple.couple.members.length >= 2;

  if (!coupleReady) {
    return (
      <CoupleConnectScreen
        inviteCode={couple.invite_code}
        pending
        onConnected={myCouple.refetch}
        onLogout={signOut}
      />
    );
  }

  return (
    <MissionContent
      coupleId={couple.id}
      coupleStatus={couple.status}
      myEmail={user.email ?? 'No email'}
      myUserId={user.id}
      onLogout={signOut}
    />
  );
}

function MissionContent({
  coupleId,
  coupleStatus,
  myEmail,
  myUserId,
  onLogout,
}: {
  coupleId: string;
  coupleStatus: 'pending' | 'active';
  myEmail: string;
  myUserId: string;
  onLogout: () => Promise<void>;
}) {
  const { today, recentDrops, loading, refreshing, error, refetch } = useTodayDrop(coupleId);
  const [uploading, setUploading] = React.useState(false);
  const [fullImage, setFullImage] = React.useState<FullImage | null>(null);
  const [allDropsVisible, setAllDropsVisible] = React.useState(false);
  const [dropDetail, setDropDetail] = React.useState<DropDetail | null>(null);
  const [profileVisible, setProfileVisible] = React.useState(false);

  const state = getDropState(today, myUserId);
  const stateCopy = getStateCopy(state);
  const meta = today ? buildMeta(today.members, today.daily_drop.day_count) : 'Seoul <-> New York';
  const missionTitle = today?.mission.prompt_ko ?? "Today's Mission";

  const handleUpload = async () => {
    if (!today || state === 'meOnly' || state === 'both' || uploading) {
      return;
    }

    try {
      const picked = await pickImageFromLibrary();
      if (!picked) {
        return;
      }

      setUploading(true);
      await submitDropPhoto({
        base64: picked.base64 ?? '',
        coupleId: today.daily_drop.couple_id,
        dropId: today.daily_drop.id,
        userId: myUserId,
      });
      await refetch(true);
    } catch (nextError) {
      Alert.alert('업로드 실패', nextError instanceof Error ? nextError.message : '사진을 올리지 못했어요.');
    } finally {
      setUploading(false);
    }
  };

  const openLockedPartner = () => {
    Alert.alert('잠긴 Drop', '내 하루를 보내면 함께 열 수 있어요.');
  };

  if (loading && !today) {
    return <CenteredState text="오늘의 Mission을 불러오는 중이에요." />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refetch(true)} />}
        contentContainerStyle={styles.scrollContent}>
        <Header onMenuPress={() => setProfileVisible(true)} />

        <Text allowFontScaling={false} style={styles.sectionTitle}>
          Mission
        </Text>

        {error ? <InlineMessage text={error} /> : null}

        {today ? (
          <>
            <View style={styles.missionCard}>
              <Text allowFontScaling={false} style={styles.dropLabel}>
                {"Today's Drop"}
              </Text>
              <Text allowFontScaling={false} style={styles.missionTitle}>
                {missionTitle}
              </Text>
              <Text allowFontScaling={false} style={styles.missionMeta}>
                {meta}
              </Text>
              <View style={styles.photoPair}>
                <TodayDropPair
                  myUserId={myUserId}
                  onLockedPartnerPress={openLockedPartner}
                  onOpenImage={setFullImage}
                  onUploadPress={handleUpload}
                  state={state}
                  today={today}
                />
              </View>
            </View>

            <Text allowFontScaling={false} style={styles.stateMessage}>
              {stateCopy.message}
            </Text>

            <Pressable
              disabled={state === 'meOnly' || state === 'both' || uploading}
              onPress={handleUpload}
              style={[styles.primaryButton, (state === 'meOnly' || state === 'both' || uploading) && styles.disabledButton]}>
              {uploading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text
                  allowFontScaling={false}
                  style={[styles.primaryButtonText, (state === 'meOnly' || state === 'both') && styles.disabledButtonText]}>
                  {stateCopy.button}
                </Text>
              )}
            </Pressable>

            {stateCopy.secondary ? (
              <Text allowFontScaling={false} style={styles.secondaryAction}>
                {stateCopy.secondary}
              </Text>
            ) : null}
          </>
        ) : null}

        <View style={styles.recentHeader}>
          <Text allowFontScaling={false} style={styles.recentTitle}>
            Recent Drops
          </Text>
          <Pressable style={styles.viewAll} onPress={() => setAllDropsVisible(true)}>
            <Text allowFontScaling={false} style={styles.viewAllText}>
              모두 보기
            </Text>
            <Feather name="chevron-right" size={20} color="#111111" />
          </Pressable>
        </View>

        <View style={styles.recentList}>
          {recentDrops.length === 0 ? (
            <InlineMessage text="아직 지난 Drop이 없어요." />
          ) : (
            recentDrops.map((drop) => (
              <RecentDropRow
                key={drop.id}
                drop={drop}
                myUserId={myUserId}
                onPress={() => setDropDetail({ drop, state: getRecentDropState(drop, myUserId) })}
              />
            ))
          )}
        </View>
      </ScrollView>

      <FullImageModal image={fullImage} onClose={() => setFullImage(null)} />
      <AllDropsModal
        drops={recentDrops}
        myUserId={myUserId}
        onClose={() => setAllDropsVisible(false)}
        onOpenDrop={(drop) => setDropDetail({ drop, state: getRecentDropState(drop, myUserId) })}
        visible={allDropsVisible}
      />
      <DropDetailModal detail={dropDetail} myUserId={myUserId} onClose={() => setDropDetail(null)} />
      <ProfileSheet
        coupleId={coupleId}
        coupleStatus={coupleStatus}
        email={myEmail}
        todayDate={today?.daily_drop.drop_date}
        userId={myUserId}
        visible={profileVisible}
        onClose={() => setProfileVisible(false)}
        onLogout={onLogout}
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
  myUserId,
  onLockedPartnerPress,
  onOpenImage,
  onUploadPress,
  state,
  today,
}: {
  myUserId: string;
  onLockedPartnerPress: () => void;
  onOpenImage: (image: FullImage) => void;
  onUploadPress: () => void;
  state: DropState;
  today: TodayDropPayload;
}) {
  const mine = today.submissions.find((submission) => submission.user_id === myUserId);
  const partner = today.submissions.find((submission) => submission.user_id !== myUserId);
  const mission = today.mission.prompt_ko;

  if (state === 'both') {
    return (
      <>
        <PhotoSlot image={partner?.image_url} label="Him" side="left" onPress={() => onOpenImage({ image: partner?.image_url, label: 'Him', mission })} />
        <PhotoSlot image={mine?.image_url} label="Me" side="right" onPress={() => onOpenImage({ image: mine?.image_url, label: 'Me', mission })} />
      </>
    );
  }

  if (state === 'meOnly') {
    return (
      <>
        <WaitingSlot />
        <PhotoSlot image={mine?.image_url} label="Me" side="right" onPress={() => onOpenImage({ image: mine?.image_url, label: 'Me', mission })} />
      </>
    );
  }

  if (state === 'partnerOnly') {
    return (
      <>
        <LockedPhotoSlot image={partner?.image_url} label="Him" onPress={onLockedPartnerPress} />
        <SendSlot onPress={onUploadPress} />
      </>
    );
  }

  return (
    <>
      <EmptySlot label="Him" icon="upload-cloud" message="아직 보내지 않았어요" tone="blue" side="left" />
      <EmptySlot label="Me" icon="camera" message="눌러서 사진 보내기" tone="sand" side="right" onPress={onUploadPress} />
    </>
  );
}

function getDropState(today: TodayDropPayload | null, myUserId: string): DropState {
  const submissions = today?.submissions ?? [];
  return getSubmissionState(submissions, myUserId);
}

function getRecentDropState(drop: RecentDrop, myUserId: string): DropState {
  return getSubmissionState(drop.drop_submissions, myUserId);
}

function getSubmissionState(submissions: DropSubmission[], myUserId: string): DropState {
  const mine = submissions.some((submission) => submission.user_id === myUserId);
  const partner = submissions.some((submission) => submission.user_id !== myUserId);

  if (mine && partner) {
    return 'both';
  }
  if (mine) {
    return 'meOnly';
  }
  if (partner) {
    return 'partnerOnly';
  }
  return 'none';
}

function getStateCopy(state: DropState) {
  switch (state) {
    case 'both':
      return {
        message: '오늘의 우리가 열렸어요.\n서로의 하루를 함께 볼 수 있어요.',
        button: '오늘의 카드 열림',
      };
    case 'meOnly':
      return {
        message: '내 하루를 보냈어요.\n상대의 Daydrop을 기다리는 중이에요.',
        button: '보내기 완료',
      };
    case 'partnerOnly':
      return {
        message: '상대가 오늘의 사진을 보냈어요.\n당신의 하루를 보내면 함께 열 수 있어요.',
        button: '내 하루 보내고 함께 열기',
      };
    default:
      return {
        message: '아직 아무도 오늘의 사진을 보내지 않았어요.\n먼저 하루를 보내고 오늘의 카드를 시작해보세요.',
        button: '오늘의 사진 보내기',
        secondary: '나중에 할게요',
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
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.dropSlot, styles.dashedSlot, toneStyle, sideRadius(side)]}>
      <Feather name={icon} size={38} color={toneColor} strokeWidth={1.75} />
      <Text allowFontScaling={false} style={styles.emptyLabel}>
        {label}
      </Text>
      <Text allowFontScaling={false} style={styles.emptyMessage}>
        {message}
      </Text>
    </Pressable>
  );
}

function WaitingSlot() {
  return (
    <View style={[styles.dropSlot, styles.dashedSlot, styles.waitingSlot, sideRadius('left')]}>
      <View style={styles.waitingContent}>
        <Feather name="refresh-cw" size={40} color="#858585" strokeWidth={1.65} />
        <Text allowFontScaling={false} style={styles.waitingText}>
          상대가 보내는 중...
        </Text>
      </View>
      <Text allowFontScaling={false} style={styles.bottomLabelMuted}>
        Him
      </Text>
    </View>
  );
}

function PhotoSlot({ image, label, onPress, side }: { image?: string; label: 'Him' | 'Me'; onPress: () => void; side: 'left' | 'right' }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.imageSlot, sideRadius(side)]}>
      <SafeImage image={image} label={label} />
      <Text allowFontScaling={false} style={styles.photoLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function LockedPhotoSlot({ image, label, onPress }: { image?: string; label: 'Him'; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.imageSlot, sideRadius('left')]}>
      <SafeImage blurRadius={20} image={image} label={label} />
      <MosaicOverlay />
      <View style={styles.lockContent}>
        <Feather name="lock" size={36} color="#FFFFFF" strokeWidth={2} />
        <Text allowFontScaling={false} style={styles.lockTitle}>
          상대가 보냈어요
        </Text>
        <Text allowFontScaling={false} style={styles.lockHint}>
          내 하루를 보내면 열려요
        </Text>
      </View>
      <Text allowFontScaling={false} style={styles.photoLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function SendSlot({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.dropSlot, styles.sendSlot, sideRadius('right')]}>
      <View style={styles.innerDashedSlot}>
        <View style={styles.plusCircle}>
          <Feather name="plus" size={30} color="#FFFFFF" strokeWidth={2.5} />
        </View>
        <Text allowFontScaling={false} style={styles.sendText}>
          내 하루 보내기
        </Text>
        <Text allowFontScaling={false} style={styles.bottomLabelMuted}>
          Me
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

function RecentDropRow({ drop, myUserId, onPress }: { drop: RecentDrop; myUserId: string; onPress: () => void }) {
  const mine = drop.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = Boolean(mine && partner);

  return (
    <Pressable onPress={onPress} style={styles.recentRow}>
      <View style={styles.recentThumbs}>
        <RecentThumb image={partner?.image_url} locked={!isOpen && Boolean(partner)} side="left" />
        <RecentThumb image={mine?.image_url} locked={!isOpen && Boolean(mine)} side="right" />
      </View>
      <View style={styles.recentInfo}>
        <Text allowFontScaling={false} style={styles.recentDate}>
          {formatDate(drop.drop_date)}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.recentMission}>
          {drop.mission?.prompt_ko ?? "Today's Mission"}
        </Text>
        <Text allowFontScaling={false} style={styles.recentMeta}>
          {drop.day_count ? `D+${drop.day_count}` : 'D+-'}
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

function FullImageModal({ image, onClose }: { image: FullImage | null; onClose: () => void }) {
  return (
    <Modal animationType="fade" transparent visible={Boolean(image)} onRequestClose={onClose}>
      <View style={styles.fullModal}>
        <Pressable hitSlop={12} onPress={onClose} style={styles.closeButton}>
          <Feather name="x" size={28} color="#FFFFFF" />
        </Pressable>
        {image?.image ? <Image resizeMode="contain" source={{ uri: image.image }} style={styles.fullImage} /> : null}
        <View style={styles.fullCaption}>
          <Text allowFontScaling={false} style={styles.fullLabel}>
            {image?.label}
          </Text>
          <Text allowFontScaling={false} style={styles.fullMission}>
            {image?.mission}
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function AllDropsModal({
  drops,
  myUserId,
  onClose,
  onOpenDrop,
  visible,
}: {
  drops: RecentDrop[];
  myUserId: string;
  onClose: () => void;
  onOpenDrop: (drop: RecentDrop) => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.modalHeader}>
          <Text allowFontScaling={false} style={styles.modalTitle}>
            All Drops
          </Text>
          <Pressable hitSlop={12} onPress={onClose}>
            <Feather name="x" size={26} color="#111111" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.allDropsContent}>
          {drops.length === 0 ? (
            <InlineMessage text="아직 볼 수 있는 Drop이 없어요." />
          ) : (
            drops.map((drop) => (
              <AllDropRow
                key={drop.id}
                drop={drop}
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

function AllDropRow({ drop, myUserId, onPress }: { drop: RecentDrop; myUserId: string; onPress: () => void }) {
  const mine = drop.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = Boolean(mine && partner);

  return (
    <Pressable onPress={onPress} style={styles.allDropRow}>
      <View style={styles.allDropInfo}>
        <Text allowFontScaling={false} style={styles.recentDate}>
          {formatDate(drop.drop_date)}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.recentMission}>
          {drop.mission?.prompt_ko ?? "Today's Mission"}
        </Text>
        <Text allowFontScaling={false} style={styles.recentMeta}>
          {drop.day_count ? `D+${drop.day_count}` : 'D+-'}
        </Text>
      </View>
      <View style={styles.allDropThumbs}>
        <RecentThumb image={partner?.image_url} locked={!isOpen && Boolean(partner)} side="left" />
        <RecentThumb image={mine?.image_url} locked={!isOpen && Boolean(mine)} side="right" />
      </View>
    </Pressable>
  );
}

function DropDetailModal({ detail, myUserId, onClose }: { detail: DropDetail | null; myUserId: string; onClose: () => void }) {
  const drop = detail?.drop;
  const mine = drop?.drop_submissions.find((submission) => submission.user_id === myUserId);
  const partner = drop?.drop_submissions.find((submission) => submission.user_id !== myUserId);
  const isOpen = detail?.state === 'both';

  return (
    <Modal animationType="slide" transparent visible={Boolean(detail)} onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.detailSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.detailHeader}>
            <View style={styles.flex}>
              <Text allowFontScaling={false} style={styles.detailTitle}>
                {drop?.mission?.prompt_ko ?? "Today's Mission"}
              </Text>
              <Text allowFontScaling={false} style={styles.detailMeta}>
                {drop ? `${formatDate(drop.drop_date)} · ${drop.day_count ? `D+${drop.day_count}` : 'D+-'}` : ''}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={onClose}>
              <Feather name="x" size={24} color="#111111" />
            </Pressable>
          </View>
          <View style={styles.detailPhotos}>
            <DetailPhoto image={partner?.image_url} label="Him" locked={!isOpen && Boolean(partner)} />
            <DetailPhoto image={mine?.image_url} label="Me" locked={!isOpen && Boolean(mine)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DetailPhoto({ image, label, locked }: { image?: string; label: 'Him' | 'Me'; locked: boolean }) {
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
      <Text allowFontScaling={false} style={styles.photoLabel}>
        {label}
      </Text>
    </View>
  );
}

function ProfileSheet({
  coupleId,
  coupleStatus,
  email,
  onClose,
  onLogout,
  todayDate,
  userId,
  visible,
}: {
  coupleId: string;
  coupleStatus: 'pending' | 'active';
  email: string;
  onClose: () => void;
  onLogout: () => Promise<void>;
  todayDate?: string;
  userId: string;
  visible: boolean;
}) {
  const connectionText = coupleStatus === 'active' ? '연결됨' : coupleStatus === 'pending' ? '대기 중' : '연결 안 됨';

  const handleLogout = () => {
    Alert.alert('로그아웃', 'Daydrop에서 로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
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
          <InfoLine label="Email" value={email} />
          <InfoLine label="User" value={shortId(userId)} />
          <InfoLine label="Couple" value={connectionText} />
          <InfoLine label="Couple ID" value={shortId(coupleId)} />
          <InfoLine label="Mission Date" value={todayDate ?? '-'} />
          <Pressable onPress={handleLogout} style={styles.logoutButton}>
            <Feather name="log-out" size={19} color="#FFFFFF" />
            <Text allowFontScaling={false} style={styles.logoutText}>
              로그아웃
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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

function AuthScreen() {
  const [mode, setMode] = React.useState<'login' | 'signup'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    if (!email.trim() || password.length < 6) {
      Alert.alert('확인해주세요', '이메일과 6자리 이상의 비밀번호가 필요해요.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password);
        Alert.alert('회원가입 완료', '이메일 확인이 켜져 있다면 인증 후 로그인해주세요.');
      }
    } catch (error) {
      Alert.alert('Auth 오류', error instanceof Error ? error.message : '다시 시도해주세요.');
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
            {mode === 'login' ? '로그인' : '회원가입'}
          </Text>
          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="email@example.com"
            style={styles.input}
            value={email}
          />
          <TextInput onChangeText={setPassword} placeholder="password" secureTextEntry style={styles.input} value={password} />
          <Pressable disabled={loading} onPress={submit} style={[styles.primaryButton, loading && styles.disabledButton]}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text allowFontScaling={false} style={styles.primaryButtonText}>
                {mode === 'login' ? '로그인' : '회원가입'}
              </Text>
            )}
          </Pressable>
          <Pressable onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
            <Text allowFontScaling={false} style={styles.secondaryAction}>
              {mode === 'login' ? '계정 만들기' : '이미 계정이 있어요'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CoupleConnectScreen({
  inviteCode,
  onConnected,
  onLogout,
  pending,
}: {
  inviteCode: string | null;
  onConnected: () => Promise<void>;
  onLogout: () => Promise<void>;
  pending: boolean;
}) {
  const [code, setCode] = React.useState('');
  const [createdCode, setCreatedCode] = React.useState(inviteCode);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setCreatedCode(inviteCode);
  }, [inviteCode]);

  const createInvite = async () => {
    setLoading(true);
    try {
      const nextCode = await createCoupleInvite();
      setCreatedCode(nextCode);
      await onConnected();
    } catch (error) {
      Alert.alert('초대 코드 오류', error instanceof Error ? error.message : '초대 코드를 만들지 못했어요.');
    } finally {
      setLoading(false);
    }
  };

  const joinInvite = async () => {
    if (!code.trim()) {
      Alert.alert('초대 코드', '초대 코드를 입력해주세요.');
      return;
    }

    setLoading(true);
    try {
      await joinCoupleByInviteCode(code);
      await onConnected();
    } catch (error) {
      Alert.alert('참여 오류', error instanceof Error ? error.message : '초대 코드로 참여하지 못했어요.');
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
          Couple
        </Text>
        <View style={styles.missionCard}>
          <Text allowFontScaling={false} style={styles.dropLabel}>
            Invite Code
          </Text>
          <Text allowFontScaling={false} style={styles.connectTitle}>
            둘만의 Daydrop을 시작해보세요.
          </Text>
          <Text allowFontScaling={false} style={styles.connectBody}>
            한 명이 초대 코드를 만들고, 다른 한 명이 그 코드를 입력하면 오늘의 Mission이 열려요.
          </Text>

          {createdCode ? (
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(createdCode);
                Alert.alert('복사 완료', '초대 코드가 복사되었어요.');
              }}
              style={styles.inviteCodeBox}>
              <Text allowFontScaling={false} style={styles.inviteCode}>
                {createdCode}
              </Text>
              <Text allowFontScaling={false} style={styles.inviteHint}>
                눌러서 복사
              </Text>
            </Pressable>
          ) : (
            <Pressable disabled={loading} onPress={createInvite} style={[styles.primaryButton, loading && styles.disabledButton]}>
              <Text allowFontScaling={false} style={styles.primaryButtonText}>
                초대 코드 만들기
              </Text>
            </Pressable>
          )}

          {pending ? <InlineMessage text="상대가 참여하면 Mission 화면이 열려요." /> : null}

          <TextInput autoCapitalize="characters" onChangeText={setCode} placeholder="초대 코드 입력" style={styles.input} value={code} />
          <Pressable disabled={loading} onPress={joinInvite} style={[styles.outlineButton, loading && styles.disabledButton]}>
            <Text allowFontScaling={false} style={styles.outlineButtonText}>
              코드로 참여하기
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

function buildMeta(members: CoupleMember[], dayCount: number | null) {
  const cities = members.map((member) => member.city).filter(Boolean) as string[];
  const [first, second] = [cities[0] ?? DEFAULT_CITY_PAIR[0], cities[1] ?? DEFAULT_CITY_PAIR[1]];
  return `${first} <-> ${second}${dayCount ? ` · D+${dayCount}` : ''}`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function shortId(value: string) {
  return value ? value.slice(0, 8) : '-';
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
    marginBottom: 18,
    padding: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
  },
  dropLabel: {
    color: '#777777',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 12,
  },
  missionTitle: {
    color: '#050505',
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 30,
    marginBottom: 8,
  },
  missionMeta: {
    color: '#737373',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 16,
  },
  photoPair: {
    flexDirection: 'row',
    height: 220,
  },
  dropSlot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dashedSlot: {
    borderColor: '#D6D6D6',
    borderStyle: 'dashed',
    borderWidth: 1.3,
  },
  blueSlot: {
    backgroundColor: '#F7FAFE',
    borderColor: '#C4D2E4',
  },
  sandSlot: {
    backgroundColor: '#FFFDF8',
    borderColor: '#DCCDBA',
  },
  waitingSlot: {
    backgroundColor: '#FFFFFF',
  },
  waitingContent: {
    alignItems: 'center',
    gap: 14,
    transform: [{ translateY: -6 }],
  },
  waitingText: {
    color: '#353535',
    fontSize: 14,
    fontWeight: '500',
  },
  imageSlot: {
    backgroundColor: '#EAEAEA',
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
  emptyLabel: {
    color: '#050505',
    fontSize: 21,
    fontWeight: '800',
    marginTop: 16,
  },
  emptyMessage: {
    color: '#727272',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
    textAlign: 'center',
  },
  bottomLabelMuted: {
    bottom: 20,
    color: '#858585',
    fontSize: 21,
    fontWeight: '800',
    position: 'absolute',
  },
  photoLabel: {
    bottom: 18,
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: '800',
    position: 'absolute',
    textShadowColor: 'rgba(0, 0, 0, 0.44)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E3E3',
    borderWidth: 1,
    padding: 10,
  },
  innerDashedSlot: {
    alignItems: 'center',
    borderColor: '#CFCFCF',
    borderRadius: 14,
    borderStyle: 'dashed',
    borderWidth: 1.3,
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  plusCircle: {
    alignItems: 'center',
    backgroundColor: '#A7A7A7',
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    marginBottom: 14,
    width: 48,
  },
  sendText: {
    color: '#6E6E6E',
    fontSize: 15,
    fontWeight: '700',
  },
  stateMessage: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
    marginBottom: 16,
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
    fontSize: 18,
    fontWeight: '800',
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
    top: 58,
    zIndex: 2,
  },
  fullImage: {
    height: '76%',
    width: '100%',
  },
  fullCaption: {
    bottom: 42,
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
  logoutButton: {
    alignItems: 'center',
    backgroundColor: '#111111',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    height: 52,
    justifyContent: 'center',
    marginTop: 18,
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
  },
  outlineButtonText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '800',
  },
});
