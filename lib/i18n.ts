export type Language = 'ko' | 'en';

type TranslationKey =
  | 'allDrops'
  | 'album'
  | 'authError'
  | 'camera'
  | 'cancel'
  | 'city'
  | 'cityFallbackMe'
  | 'cityFallbackPartner'
  | 'completeSignup'
  | 'confirm'
  | 'connected'
  | 'copyDone'
  | 'copyInvite'
  | 'country'
  | 'couple'
  | 'coupleLoading'
  | 'createInvite'
  | 'dayNotSet'
  | 'deletePhoto'
  | 'deletePhotoBody'
  | 'deletePhotoError'
  | 'deletePhotoTitle'
  | 'dropLocked'
  | 'email'
  | 'english'
  | 'enterInvite'
  | 'enterProfile'
  | 'inviteBody'
  | 'inviteCode'
  | 'inviteCodeError'
  | 'joinByCode'
  | 'joinError'
  | 'korean'
  | 'language'
  | 'loadingApp'
  | 'loadingMission'
  | 'login'
  | 'logout'
  | 'logoutQuestion'
  | 'me'
  | 'mission'
  | 'name'
  | 'noDrops'
  | 'noRecentDrops'
  | 'openAfterSend'
  | 'partner'
  | 'partnerSent'
  | 'password'
  | 'pending'
  | 'photoPermission'
  | 'photoReadError'
  | 'pickPhotoTitle'
  | 'profile'
  | 'profileSaveError'
  | 'profileSaved'
  | 'recentDrops'
  | 'relationshipStartDate'
  | 'save'
  | 'sendDone'
  | 'sendMine'
  | 'settings'
  | 'signup'
  | 'signupPrompt'
  | 'startTogether'
  | 'timezone'
  | 'todayDrop'
  | 'todayOpen'
  | 'retakePhoto'
  | 'unknownError'
  | 'uploadError'
  | 'uploadPhoto'
  | 'viewAll'
  | 'waitingPartner';

const translations: Record<Language, Record<TranslationKey, string>> = {
  ko: {
    allDrops: '전체 Drops',
    album: '앨범에서 선택',
    authError: '인증 오류',
    camera: '사진 찍기',
    cancel: '취소',
    city: '도시',
    cityFallbackMe: '내 도시',
    cityFallbackPartner: '상대 도시',
    completeSignup: '회원가입 완료',
    confirm: '확인해주세요',
    connected: '연결됨',
    copyDone: '복사 완료',
    copyInvite: '눌러서 복사',
    country: '나라',
    couple: '커플',
    coupleLoading: '커플 정보를 불러오는 중이에요.',
    createInvite: '초대 코드 만들기',
    dayNotSet: '시작일 미설정',
    deletePhoto: '사진 삭제',
    deletePhotoBody: '삭제하면 다시 찍어야 해요.',
    deletePhotoError: '사진 삭제 실패',
    deletePhotoTitle: '오늘 사진을 삭제할까요?',
    dropLocked: '잠긴 Drop',
    email: '이메일',
    english: 'English',
    enterInvite: '초대 코드를 입력해주세요.',
    enterProfile: '당신의 정보를 입력해주세요',
    inviteBody: '한 명이 초대 코드를 만들고, 다른 한 명이 그 코드를 입력하면 오늘의 Mission이 열려요.',
    inviteCode: '초대 코드',
    inviteCodeError: '초대 코드 오류',
    joinByCode: '코드로 참여하기',
    joinError: '참여 오류',
    korean: '한국어',
    language: '언어',
    loadingApp: 'Daydrop을 준비하는 중이에요.',
    loadingMission: '오늘의 Mission을 불러오는 중이에요.',
    login: '로그인',
    logout: '로그아웃',
    logoutQuestion: 'Daydrop에서 로그아웃할까요?',
    me: '나',
    mission: 'Mission',
    name: '이름',
    noDrops: '아직 볼 수 있는 Drop이 없어요.',
    noRecentDrops: '아직 지난 Drop이 없어요.',
    openAfterSend: '내 하루를 보내면 함께 열 수 있어요.',
    partner: '상대',
    partnerSent: '상대가 오늘의 사진을 보냈어요.',
    password: '비밀번호',
    pending: '대기 중',
    photoPermission: '사진 접근 권한이 필요해요.',
    photoReadError: '이미지를 읽지 못했어요. 다시 선택해주세요.',
    pickPhotoTitle: '오늘의 사진을 어떻게 보낼까요?',
    profile: '프로필',
    profileSaveError: '프로필 저장 실패',
    profileSaved: '프로필이 저장되었어요.',
    recentDrops: 'Recent Drops',
    relationshipStartDate: 'D+ 시작일',
    save: '저장',
    sendDone: '보내기 완료',
    sendMine: '내 하루 보내기',
    settings: 'Settings',
    signup: '회원가입',
    signupPrompt: '이메일 확인이 켜져 있다면 인증 후 로그인해주세요.',
    startTogether: '둘만의 Daydrop을 시작해보세요.',
    timezone: 'Timezone',
    todayDrop: "Today's Drop",
    todayOpen: '오늘의 우리가 열렸어요.\n서로의 하루를 함께 볼 수 있어요.',
    retakePhoto: '삭제 후 다시 찍기',
    unknownError: '알 수 없는 오류',
    uploadError: '업로드 실패',
    uploadPhoto: '오늘의 사진 보내기',
    viewAll: '모두 보기',
    waitingPartner: '상대가 참여하면 Mission 화면이 열려요.',
  },
  en: {
    allDrops: 'All Drops',
    album: 'Choose from album',
    authError: 'Auth error',
    camera: 'Take photo',
    cancel: 'Cancel',
    city: 'City',
    cityFallbackMe: 'My city',
    cityFallbackPartner: 'Partner city',
    completeSignup: 'Signup complete',
    confirm: 'Please check',
    connected: 'Connected',
    copyDone: 'Copied',
    copyInvite: 'Tap to copy',
    country: 'Country',
    couple: 'Couple',
    coupleLoading: 'Loading couple details.',
    createInvite: 'Create invite code',
    dayNotSet: 'D-day not set',
    deletePhoto: 'Delete photo',
    deletePhotoBody: 'You will need to take it again after deleting.',
    deletePhotoError: 'Could not delete photo',
    deletePhotoTitle: 'Delete today\'s photo?',
    dropLocked: 'Locked Drop',
    email: 'Email',
    english: 'English',
    enterInvite: 'Please enter an invite code.',
    enterProfile: 'Tell us about you',
    inviteBody: 'One of you creates an invite code. The other enters it to open today\'s Mission.',
    inviteCode: 'Invite Code',
    inviteCodeError: 'Invite code error',
    joinByCode: 'Join with code',
    joinError: 'Join error',
    korean: '한국어',
    language: 'Language',
    loadingApp: 'Preparing Daydrop.',
    loadingMission: 'Loading today\'s Mission.',
    login: 'Log in',
    logout: 'Log out',
    logoutQuestion: 'Log out of Daydrop?',
    me: 'Me',
    mission: 'Mission',
    name: 'Name',
    noDrops: 'No Drops yet.',
    noRecentDrops: 'No recent Drops yet.',
    openAfterSend: 'Send your day to open it together.',
    partner: 'Partner',
    partnerSent: 'Your partner sent today\'s photo.',
    password: 'Password',
    pending: 'Waiting',
    photoPermission: 'Photo permission is required.',
    photoReadError: 'Could not read the image. Please try again.',
    pickPhotoTitle: 'How would you like to send today\'s photo?',
    profile: 'Profile',
    profileSaveError: 'Could not save profile',
    profileSaved: 'Profile saved.',
    recentDrops: 'Recent Drops',
    relationshipStartDate: 'D+ start date',
    save: 'Save',
    sendDone: 'Sent',
    sendMine: 'Send my day',
    settings: 'Settings',
    signup: 'Sign up',
    signupPrompt: 'If email confirmation is enabled, verify your email before logging in.',
    startTogether: 'Start your private Daydrop.',
    timezone: 'Timezone',
    todayDrop: "Today's Drop",
    todayOpen: 'Today is open.\nYou can see each other\'s day now.',
    retakePhoto: 'Delete and retake',
    unknownError: 'Unknown error',
    uploadError: 'Upload failed',
    uploadPhoto: 'Send today\'s photo',
    viewAll: 'View all',
    waitingPartner: 'Mission opens when your partner joins.',
  },
};

export function normalizeLanguage(value?: string | null): Language {
  return value === 'en' ? 'en' : 'ko';
}

export function getTranslations(language?: string | null) {
  return translations[normalizeLanguage(language)];
}
