import { supabase } from '@/lib/supabase';
import * as AuthSession from 'expo-auth-session';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_OAUTH_CALLBACK_PATH = 'auth/callback';
const GOOGLE_OAUTH_NATIVE_REDIRECT = 'daydrop://auth/callback';
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
  return data;
}

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    throw error;
  }

  return data;
}

export async function signInWithGoogle() {
  const redirectTo = resolveGoogleRedirectUri();
  console.log('[Google OAuth] start', {
    appScheme: Constants.expoConfig?.scheme,
    executionEnvironment: Constants.executionEnvironment,
    hostUri: Constants.expoConfig?.hostUri,
    isExpoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
    linkingUri: Constants.linkingUri,
    platform: Platform.OS,
    redirectTo,
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.url) {
    throw new Error('Missing OAuth URL');
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.log('[Google OAuth] auth session result', result);
  if (result.type !== 'success' || !result.url) {
    return false;
  }

  await completeOAuthSession(result.url);
  return true;
}

export async function signInWithAppleIdToken(identityToken: string) {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

function resolveGoogleRedirectUri() {
  const redirectTo = AuthSession.makeRedirectUri({
    native: GOOGLE_OAUTH_NATIVE_REDIRECT,
    path: GOOGLE_OAUTH_CALLBACK_PATH,
    scheme: 'daydrop',
  });

  if (!shouldUseExpoGoFallback(redirectTo)) {
    return redirectTo;
  }

  const fallbackRedirectTo = buildExpoGoRedirectFallback();
  if (fallbackRedirectTo) {
    return fallbackRedirectTo;
  }

  console.error('[Google OAuth] Unable to resolve a non-local Expo Go redirect URI', {
    experienceUrl: Constants.experienceUrl,
    hostUri: Constants.expoConfig?.hostUri,
    linkingUri: Constants.linkingUri,
    redirectTo,
  });

  throw new Error('google_oauth_redirect_unavailable');
}

function shouldUseExpoGoFallback(redirectTo: string) {
  if (Platform.OS === 'web') {
    return false;
  }

  if (Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
    return false;
  }

  return isLocalhostRedirectUri(redirectTo);
}

function buildExpoGoRedirectFallback() {
  const redirectCandidates = [
    buildRedirectUriFromHostUri(Constants.expoConfig?.hostUri),
    buildRedirectUriFromExpoUrl(Constants.linkingUri),
    buildRedirectUriFromExpoUrl(Constants.experienceUrl),
  ];

  for (const candidate of redirectCandidates) {
    if (candidate && !isLocalhostRedirectUri(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildRedirectUriFromHostUri(hostUri?: string | null) {
  if (!hostUri) {
    return null;
  }

  const normalizedHost = hostUri
    .replace(/^exp(s)?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .split(/[/?#]/, 1)[0];

  if (!normalizedHost) {
    return null;
  }

  return `exp://${normalizedHost}/--/${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

function buildRedirectUriFromExpoUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  const directMatch = url.match(/^(exp|exps):\/\/([^/]+)/i);
  if (!directMatch) {
    return null;
  }

  const protocol = directMatch[1];
  const host = directMatch[2];
  if (!protocol || !host) {
    return null;
  }

  return `${protocol}://${host}/--/${GOOGLE_OAUTH_CALLBACK_PATH}`;
}

function isLocalhostRedirectUri(redirectTo: string) {
  try {
    const hostname = new URL(redirectTo).hostname.toLowerCase();
    return LOCALHOST_HOSTS.has(hostname);
  } catch {
    return /localhost|127\.0\.0\.1|\[::1\]/i.test(redirectTo);
  }
}

async function completeOAuthSession(url: string) {
  console.log('[Google OAuth] callback URL', url);

  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);

  if (parsed.hash) {
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    hashParams.forEach((value, key) => params.set(key, value));
  }

  const code = params.get('code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[Google OAuth] exchangeCodeForSession failed', error);
      throw error;
    }
    console.log('[Google OAuth] exchangeCodeForSession succeeded');
    return;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('missing_oauth_tokens');
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) {
    console.error('[Google OAuth] setSession failed', error);
    throw error;
  }
  console.log('[Google OAuth] setSession succeeded');
}
