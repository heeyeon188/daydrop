export type Language = 'ko' | 'en';

type TranslationKey =
  | 'allDrops'
  | 'album'
  | 'authError'
  | 'beforePartner'
  | 'beforePartnerBody'
  | 'camera'
  | 'cancel'
  | 'city'
  | 'cityFallbackMe'
  | 'cityFallbackPartner'
  | 'completeSignup'
  | 'confirm'
  | 'connectPartnerFirst'
  | 'connectPartner'
  | 'connected'
  | 'continueWithApple'
  | 'continueWithGoogle'
  | 'copyDone'
  | 'copyInvite'
  | 'country'
  | 'countryNotFound'
  | 'couple'
  | 'coupleLoading'
  | 'createInvite'
  | 'dataPurpose'
  | 'dataPurposeBody'
  | 'deletePhoto'
  | 'deletePhotoBody'
  | 'deletePhotoError'
  | 'deletePhotoTitle'
  | 'deleteAccount'
  | 'deleteAccountBody'
  | 'deleteAccountConfirm'
  | 'deleteAccountError'
  | 'deleteAccountFinalBody'
  | 'deleteAccountFinalPlaceholder'
  | 'deleteAccountTitle'
  | 'dropLocked'
  | 'editProfile'
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
  | 'partnerTypeCommon'
  | 'partnerTypeFriend'
  | 'partnerTypeFriendOnly'
  | 'partnerTypeLover'
  | 'partnerTypeLoverOnly'
  | 'partnerTypePrompt'
  | 'partnerTypeRequired'
  | 'partnerLimitBody'
  | 'partnerLimitTitle'
  | 'partnerSelectError'
  | 'partners'
  | 'privacyAndData'
  | 'privacyDataUsed'
  | 'privacyDataUsedBody'
  | 'privacyPolicy'
  | 'privacyPolicyTodo'
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
  | 'save'
  | 'sendDone'
  | 'sendMine'
  | 'settings'
  | 'selectCountry'
  | 'searchCountry'
  | 'signup'
  | 'signupPrompt'
  | 'soloTodayHint'
  | 'startTogether'
  | 'socialSignInFailed'
  | 'todayDrop'
  | 'todayOpen'
  | 'retakePhoto'
  | 'tryAgain'
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
    beforePartner: '파트너 연결 전',
    beforePartnerBody: '파트너를 연결하면 함께 볼 수 있어요.',
    camera: '사진 찍기',
    cancel: '취소',
    city: '도시',
    cityFallbackMe: '내 도시',
    cityFallbackPartner: '상대 도시',
    completeSignup: '회원가입 완료',
    confirm: '확인해주세요',
    connectPartnerFirst: '파트너를 연결해주세요',
    connectPartner: '파트너 연결하기',
    connected: '연결됨',
    continueWithApple: 'Apple로 계속하기',
    continueWithGoogle: 'Google로 계속하기',
    copyDone: '복사 완료',
    copyInvite: '눌러서 복사',
    country: '나라',
    countryNotFound: '검색 결과가 없어요.',
    couple: '커플',
    coupleLoading: '커플 정보를 불러오는 중이에요.',
    createInvite: '초대 코드 만들기',
    dataPurpose: '데이터 사용 목적',
    dataPurposeBody: '로그인, 오늘의 사진 저장, 파트너와 Daydrop 공유, 알림 전송에 사용해요.',
    deletePhoto: '사진 삭제',
    deletePhotoBody: '삭제하면 다시 찍어야 해요.',
    deletePhotoError: '사진을 삭제하지 못했어요.',
    deletePhotoTitle: '오늘 사진을 삭제할까요?',
    deleteAccount: '계정 삭제',
    deleteAccountBody: '계정을 삭제하면 프로필, 오늘의 사진, 연결 정보, 푸시 토큰이 삭제됩니다. 이 작업은 되돌릴 수 없어요.',
    deleteAccountConfirm: '삭제',
    deleteAccountError: '계정을 삭제하지 못했어요.',
    deleteAccountFinalBody: '마지막 확인을 위해 DELETE 또는 삭제를 입력해주세요.',
    deleteAccountFinalPlaceholder: 'DELETE 또는 삭제',
    deleteAccountTitle: '계정을 삭제할까요?',
    dropLocked: '잠긴 Drop',
    editProfile: '프로필 수정',
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
    partnerTypeCommon: '공통',
    partnerTypeFriend: '친구',
    partnerTypeFriendOnly: '친구에게만',
    partnerTypeLover: '커플',
    partnerTypeLoverOnly: '커플에게만',
    partnerTypePrompt: '어떤 관계로 연결할까요?',
    partnerTypeRequired: '관계 타입을 선택해주세요.',
    partnerLimitBody: '파트너는 최대 4명까지 추가할 수 있어요.',
    partnerLimitTitle: '파트너 추가 제한',
    partnerSelectError: '파트너 선택 실패',
    partners: 'Partners',
    privacyAndData: '개인정보 및 데이터',
    privacyDataUsed: 'Daydrop이 사용하는 데이터',
    privacyDataUsedBody: '이메일, 이름, 국가/도시, 업로드한 사진, 파트너 연결 정보, push token',
    privacyPolicy: '개인정보 처리방침',
    privacyPolicyTodo: 'App Store 제출 전 실제 개인정보 처리방침 URL이 필요해요.',
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
    save: '저장',
    searchCountry: '나라 검색',
    sendDone: '보내기 완료',
    sendMine: '내 하루 보내기',
    settings: 'Settings',
    selectCountry: '나라를 선택해주세요.',
    signup: '회원가입',
    signupPrompt: '이메일 확인이 켜져 있다면 인증 후 로그인해주세요.',
    soloTodayHint: '오늘의 질문은 먼저 받을 수 있어요.\n사진을 올리고 파트너를 연결해보세요.',
    startTogether: '둘만의 Daydrop을 시작해보세요.',
    socialSignInFailed: '소셜 로그인에 실패했어요.',
    todayDrop: "Today's Drop",
    todayOpen: '오늘의 우리가 열렸어요.\n서로의 하루를 함께 볼 수 있어요.',
    retakePhoto: '삭제 후 다시 찍기',
    tryAgain: '다시 시도해주세요.',
    unknownError: '다시 시도해주세요.',
    uploadError: '사진을 업로드하지 못했어요.',
    uploadPhoto: '오늘의 사진 보내기',
    viewAll: '모두 보기',
    waitingPartner: '상대가 참여하면 Mission 화면이 열려요.',
  },
  en: {
    allDrops: 'All Drops',
    album: 'Choose from album',
    authError: 'Auth error',
    beforePartner: 'Before partner',
    beforePartnerBody: 'Connect a partner to view together.',
    camera: 'Take photo',
    cancel: 'Cancel',
    city: 'City',
    cityFallbackMe: 'My city',
    cityFallbackPartner: 'Partner city',
    completeSignup: 'Signup complete',
    confirm: 'Please check',
    connectPartnerFirst: 'Connect a partner first',
    connectPartner: 'Connect partner',
    connected: 'Connected',
    continueWithApple: 'Continue with Apple',
    continueWithGoogle: 'Continue with Google',
    copyDone: 'Copied',
    copyInvite: 'Tap to copy',
    country: 'Country',
    countryNotFound: 'No countries found.',
    couple: 'Couple',
    coupleLoading: 'Loading couple details.',
    createInvite: 'Create invite code',
    dataPurpose: 'How data is used',
    dataPurposeBody: 'Login, saving today\'s photo, sharing Daydrop with partners, and sending notifications.',
    deletePhoto: 'Delete photo',
    deletePhotoBody: 'You will need to take it again after deleting.',
    deletePhotoError: 'Could not delete photo',
    deletePhotoTitle: 'Delete today\'s photo?',
    deleteAccount: 'Delete Account',
    deleteAccountBody: 'Deleting your account removes your profile, today\'s photos, connections, and push tokens. This cannot be undone.',
    deleteAccountConfirm: 'Delete',
    deleteAccountError: 'Could not delete your account.',
    deleteAccountFinalBody: 'Type DELETE or 삭제 to confirm.',
    deleteAccountFinalPlaceholder: 'DELETE or 삭제',
    deleteAccountTitle: 'Delete your account?',
    dropLocked: 'Locked Drop',
    editProfile: 'Edit Profile',
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
    partnerTypeCommon: 'Common',
    partnerTypeFriend: 'Friend',
    partnerTypeFriendOnly: 'Friend only',
    partnerTypeLover: 'Couple',
    partnerTypeLoverOnly: 'Couple only',
    partnerTypePrompt: 'What relationship should this be?',
    partnerTypeRequired: 'Please choose a partner type.',
    partnerLimitBody: 'You can add up to 4 partners.',
    partnerLimitTitle: 'Partner limit',
    partnerSelectError: 'Could not select partner',
    partners: 'Partners',
    privacyAndData: 'Privacy & Data',
    privacyDataUsed: 'Data Daydrop uses',
    privacyDataUsedBody: 'Email, name, country/city, uploaded photos, partner connection info, and push token.',
    privacyPolicy: 'Privacy Policy',
    privacyPolicyTodo: 'A real Privacy Policy URL is required before App Store submission.',
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
    save: 'Save',
    searchCountry: 'Search country',
    sendDone: 'Sent',
    sendMine: 'Send my day',
    settings: 'Settings',
    selectCountry: 'Please select a country.',
    signup: 'Sign up',
    signupPrompt: 'If email confirmation is enabled, verify your email before logging in.',
    soloTodayHint: 'You can receive today\'s question first.\nUpload a photo, then connect your partner.',
    startTogether: 'Start your private Daydrop.',
    socialSignInFailed: 'Social sign-in failed.',
    todayDrop: "Today's Drop",
    todayOpen: 'Today is open.\nYou can see each other\'s day now.',
    retakePhoto: 'Delete and retake',
    tryAgain: 'Please try again.',
    unknownError: 'Please try again.',
    uploadError: 'Could not upload photo',
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
