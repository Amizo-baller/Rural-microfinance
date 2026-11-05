import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { resolveApiUrl } from './api-config';

const apiUrl = resolveApiUrl({
  platform: Platform.OS,
  configuredUrl: Constants.expoConfig?.extra?.apiUrl ?? process.env.EXPO_PUBLIC_API_URL,
  metroHost: Constants.expoConfig?.hostUri,
  webHostname: typeof window === 'undefined' ? undefined : window.location?.hostname,
});
export const SESSION_STORAGE_KEY = 'auth_session_v2';
const LEGACY_ACCESS_KEY = 'auth_access_token';
const LEGACY_REFRESH_KEY = 'auth_refresh_token';
const PUBLIC_AUTH = new Set([
  '/auth/registration-groups',
  '/auth/login',
  '/auth/google',
  '/auth/wallet/challenge',
  '/auth/wallet/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/refresh',
  '/auth/logout',
]);
type SessionTokens = { accessToken: string; refreshToken: string };
type RequestOptions = { body?: object; token?: string; method?: string; retryAuth?: boolean };
type ErrorPayload = {
  message?: string | string[];
  error?: string | { message?: string | string[]; error?: string };
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly validationErrors: string[] = [],
    readonly cancelled = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
let sessionVersion = 0;
let refreshInFlight: Promise<string | null> | null = null;
let onAuthFailure: (() => void) | undefined;
let storageQueue: Promise<void> = Promise.resolve();

function storageTask<T>(task: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(task);
  storageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
function readValue(key: string): Promise<string | null> {
  if (Platform.OS === 'web')
    return Promise.resolve(
      typeof window === 'undefined' ? null : window.sessionStorage.getItem(key),
    );
  return SecureStore.getItemAsync(key);
}
async function writeValue(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.sessionStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
async function deleteValue(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
function validTokens(value: unknown): value is SessionTokens {
  if (!value || typeof value !== 'object') return false;
  const tokens = value as Partial<SessionTokens>;
  return (
    typeof tokens.accessToken === 'string' &&
    !!tokens.accessToken.trim() &&
    typeof tokens.refreshToken === 'string' &&
    !!tokens.refreshToken.trim()
  );
}
function assertSession(version: number) {
  if (version !== sessionVersion)
    throw new ApiError('Your session changed. Please try again.', 0, [], true);
}
export function setAuthFailureHandler(handler?: () => void) {
  onAuthFailure = handler;
}

export function getStoredTokens(): Promise<{
  accessToken: string | null;
  refreshToken: string | null;
}> {
  return storageTask(async () => {
    const saved = await readValue(SESSION_STORAGE_KEY);
    if (saved) {
      try {
        const tokens: unknown = JSON.parse(saved);
        if (validTokens(tokens)) return tokens;
      } catch {
        /* Discard a corrupt local session. */
      }
      await deleteValue(SESSION_STORAGE_KEY);
      await Promise.all([deleteValue(LEGACY_ACCESS_KEY), deleteValue(LEGACY_REFRESH_KEY)]);
      return { accessToken: null, refreshToken: null };
    }
    const [accessToken, refreshToken] = await Promise.all([
      readValue(LEGACY_ACCESS_KEY),
      readValue(LEGACY_REFRESH_KEY),
    ]);
    if (accessToken && refreshToken) {
      await writeValue(SESSION_STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
      await Promise.all([deleteValue(LEGACY_ACCESS_KEY), deleteValue(LEGACY_REFRESH_KEY)]);
      return { accessToken, refreshToken };
    }
    if (accessToken || refreshToken)
      await Promise.all([deleteValue(LEGACY_ACCESS_KEY), deleteValue(LEGACY_REFRESH_KEY)]);
    return { accessToken: null, refreshToken: null };
  });
}
export async function storeTokens(accessToken: string, refreshToken: string) {
  if (!validTokens({ accessToken, refreshToken }))
    throw new ApiError('The server returned an invalid session response.', 0);
  const version = ++sessionVersion;
  await storageTask(async () => {
    assertSession(version);
    await writeValue(SESSION_STORAGE_KEY, JSON.stringify({ accessToken, refreshToken }));
  });
}
export async function clearTokens() {
  sessionVersion += 1;
  await storageTask(async () => {
    await Promise.all([
      deleteValue(SESSION_STORAGE_KEY),
      deleteValue(LEGACY_ACCESS_KEY),
      deleteValue(LEGACY_REFRESH_KEY),
    ]);
  });
}

function responseError(payload: ErrorPayload | undefined, status: number) {
  const nested = typeof payload?.error === 'object' ? payload.error : undefined;
  const raw = payload?.message ?? nested?.message;
  const validation = Array.isArray(raw) ? raw : [];
  const message =
    validation.join('\n') ||
    (typeof raw === 'string' ? raw : undefined) ||
    (typeof payload?.error === 'string' ? payload.error : undefined) ||
    nested?.error ||
    `Request failed (${status})`;
  return new ApiError(message, status, validation);
}
async function send(
  path: string,
  options: RequestInit,
): Promise<{ response: Response; payload: unknown }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new ApiError(
          'The server took too long to respond. Check your connection and try again.',
          0,
        ),
      );
    }, 20000);
  });
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const response = await fetch(`${apiUrl}${path}`, { ...options, signal: controller.signal });
        if (response.status === 204) return { response, payload: undefined };
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          if (response.ok)
            throw new ApiError(
              'The server returned invalid data. Refresh and try again.',
              response.status,
            );
        }
        if (response.ok && payload === undefined)
          throw new ApiError(
            'The server returned no data. Refresh and try again.',
            response.status,
          );
        return { response, payload };
      })(),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('Could not connect to the server. Check your connection and try again.', 0);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    const version = sessionVersion;
    const flight = (async () => {
      const { refreshToken } = await getStoredTokens();
      assertSession(version);
      if (!refreshToken) return null;
      const { response, payload } = await send('/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      assertSession(version);
      if (response.status === 401 || response.status === 403) return null;
      if (!response.ok) throw responseError(payload as ErrorPayload | undefined, response.status);
      if (!validTokens(payload))
        throw new ApiError('The server returned an invalid session response.', response.status);
      await storageTask(async () => {
        assertSession(version);
        await writeValue(SESSION_STORAGE_KEY, JSON.stringify(payload));
      });
      assertSession(version);
      return payload.accessToken;
    })();
    refreshInFlight = flight;
    void flight
      .finally(() => {
        if (refreshInFlight === flight) refreshInFlight = null;
      })
      .catch(() => undefined);
  }
  return refreshInFlight;
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://'))
    throw new ApiError('Invalid API request path.', 0);
  const version = sessionVersion;
  const publicRequest = PUBLIC_AUTH.has(path.split('?')[0]);
  const token = publicRequest
    ? undefined
    : (options.token ?? (await getStoredTokens()).accessToken);
  assertSession(version);
  const { response, payload } = await send(path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  assertSession(version);
  if (response.status === 401 && token && !publicRequest) {
    const stored = await getStoredTokens();
    assertSession(version);
    const renewed = options.retryAuth
      ? null
      : stored.accessToken && stored.accessToken !== token
        ? stored.accessToken
        : await refreshAccessToken();
    assertSession(version);
    if (renewed) return request<T>(path, { ...options, token: renewed, retryAuth: true });
    await clearTokens();
    onAuthFailure?.();
  }
  if (!response.ok) throw responseError(payload as ErrorPayload | undefined, response.status);
  return payload as T;
}
