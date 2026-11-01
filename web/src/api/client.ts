import type { Profile, RegisterInput, TokenPair, Transaction, Wallet } from './types';

const BASE = '/api/v1';
const ACCESS_KEY = 'pp.access';
const REFRESH_KEY = 'pp.refresh';

/** Erreur d'API : porte le code métier du back-end (ex. INVALID_CREDENTIALS) et le statut HTTP. */
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

let accessToken = localStorage.getItem(ACCESS_KEY) || '';
let refreshToken = localStorage.getItem(REFRESH_KEY) || '';
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function setTokens(t: TokenPair) {
  accessToken = t.accessToken;
  refreshToken = t.refreshToken;
  try {
    localStorage.setItem(ACCESS_KEY, accessToken);
    localStorage.setItem(REFRESH_KEY, refreshToken);
  } catch {
    /* mode privé : on garde les jetons en mémoire */
  }
  emit();
}

function clearTokens() {
  accessToken = '';
  refreshToken = '';
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function send(method: string, path: string, body?: unknown, withAuth = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  return res;
}

/** Rafraîchit le jeton d'accès une seule fois à la fois. */
let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = (async () => {
      const res = await send('POST', '/auth/refresh', { refreshToken }, false);
      if (!res.ok) {
        clearTokens();
        return false;
      }
      setTokens((await parse(res)) as TokenPair);
      return true;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, withAuth = true): Promise<T> {
  let res = await send(method, path, body, withAuth);
  if (res.status === 401 && withAuth && (await tryRefresh())) {
    res = await send(method, path, body, withAuth);
  }
  const data = await parse(res);
  if (!res.ok) {
    const d = data as { code?: string; details?: unknown } | undefined;
    throw new ApiError(d?.code || `HTTP_${res.status}`, res.status, d?.details);
  }
  return data as T;
}

export const api = {
  get isAuthed() {
    return Boolean(accessToken);
  },
  /** S'abonner aux changements d'authentification (connexion / déconnexion / expiration). */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  // Appels génériques pour les pages de jeux.
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),

  // Authentification
  requestOtp: (email: string, purpose: 'register' | 'reset_password') =>
    request<void>('POST', '/auth/otp', { email, purpose }, false),
  async register(input: RegisterInput) {
    setTokens(await request<TokenPair>('POST', '/auth/register', input, false));
  },
  async login(email: string, password: string) {
    setTokens(await request<TokenPair>('POST', '/auth/login', { email, password }, false));
  },
  async logout() {
    try {
      if (refreshToken) await request<void>('POST', '/auth/logout', { refreshToken }, false);
    } catch {
      /* on déconnecte localement de toute façon */
    }
    clearTokens();
  },
  resetPassword: (phone: string, otp: string, newPassword: string) =>
    request<void>('POST', '/auth/reset-password', { phone, otp, newPassword }, false),

  // Compte et portefeuille
  me: () => request<Profile>('GET', '/me'),
  wallet: () => request<Wallet>('GET', '/wallet'),
  transactions: (limit = 50) => request<{ items: Transaction[] } | Transaction[]>('GET', `/wallet/transactions?limit=${limit}`),
};
