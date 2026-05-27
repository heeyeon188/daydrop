import { Feather } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { getTranslations, normalizeLanguage } from '@/lib/i18n';
import { signInWithAppleIdToken, signInWithGoogle, signUpWithEmail } from '@/services/auth';

function isAppleAuthCanceled(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_REQUEST_CANCELED';
}

export default function SignupScreen() {
  const params = useLocalSearchParams<{ language?: string }>();
  const language = normalizeLanguage(params.language);
  const t = getTranslations(language);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [passwordConfirm, setPasswordConfirm] = React.useState('');
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

  const goBackToLogin = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  };

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

    if (password !== passwordConfirm) {
      authSubmittingRef.current = false;
      Alert.alert(t.confirm, language === 'ko' ? '비밀번호가 일치하지 않아요.' : 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await signUpWithEmail(email.trim(), password);
      Alert.alert(t.completeSignup, t.signupPrompt, [{ text: t.confirm, onPress: goBackToLogin }]);
    } catch (error) {
      console.error('signup failed', error);
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
        <View style={styles.header}>
          <Pressable accessibilityLabel={language === 'ko' ? '로그인으로 돌아가기' : 'Back to login'} disabled={isSubmitting} onPress={goBackToLogin} style={styles.backButton}>
            <Feather name="chevron-left" size={26} color="#111111" />
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text allowFontScaling={false} style={styles.title}>
            {language === 'ko' ? '계정 만들기' : 'Create account'}
          </Text>
          <Text allowFontScaling={false} style={styles.subtitle}>
            {language === 'ko' ? 'DAYDROP을 시작해보세요' : 'Start DAYDROP'}
          </Text>

          <View style={styles.form}>
            <TextInput autoCapitalize="none" editable={!isSubmitting} keyboardType="email-address" onChangeText={setEmail} placeholder="email@example.com" style={styles.input} value={email} />
            <TextInput editable={!isSubmitting} onChangeText={setPassword} placeholder={t.password} secureTextEntry style={styles.input} value={password} />
            <TextInput
              editable={!isSubmitting}
              onChangeText={setPasswordConfirm}
              placeholder={language === 'ko' ? '비밀번호 확인' : 'Confirm password'}
              secureTextEntry
              style={styles.input}
              value={passwordConfirm}
            />
            <Pressable disabled={isSubmitting} onPress={submit} style={[styles.primaryButton, isSubmitting && styles.disabledButton]}>
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text allowFontScaling={false} style={styles.primaryButtonText}>
                  {language === 'ko' ? '회원가입' : 'Sign up'}
                </Text>
              )}
            </Pressable>
          </View>

          <View style={styles.socialAuthGroup}>
            <Pressable disabled={isSubmitting} onPress={handleGoogleSignIn} style={[styles.socialAuthButton, isSubmitting && styles.disabledButton]}>
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
              <Pressable disabled={isSubmitting} onPress={handleAppleSignIn} style={[styles.socialAuthButton, styles.appleAuthButton, isSubmitting && styles.disabledButton]}>
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

          <Pressable disabled={isSubmitting} onPress={goBackToLogin} style={styles.loginPrompt}>
            <Text allowFontScaling={false} style={styles.loginPromptText}>
              {language === 'ko' ? '이미 계정이 있나요? ' : 'Already have an account? '}
              <Text style={styles.loginPromptLink}>{t.login}</Text>
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#FFFDF9',
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  header: {
    height: 58,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 36,
    paddingHorizontal: 24,
  },
  title: {
    color: '#050505',
    fontSize: 31,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    color: '#777777',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 28,
  },
  form: {
    gap: 12,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E3E3E3',
    borderRadius: 10,
    borderWidth: 1,
    color: '#111111',
    fontSize: 16,
    height: 52,
    paddingHorizontal: 14,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 10,
    elevation: 2,
    height: 56,
    justifyContent: 'center',
    marginTop: 4,
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
  socialAuthGroup: {
    gap: 10,
    marginTop: 22,
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
  loginPrompt: {
    alignItems: 'center',
    marginTop: 24,
  },
  loginPromptText: {
    color: '#6A6A6A',
    fontSize: 15,
    fontWeight: '700',
  },
  loginPromptLink: {
    color: '#111111',
    fontWeight: '800',
  },
});
