export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  role: "user" | "superadmin";
  status: "active" | "banned";
  mustChangePassword: boolean;
  onboardingCompleted: boolean;
  avatarUrl: string;
  projectCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface AuthState {
  user: CurrentUser;
  csrfToken: string;
}

let cachedAuth: AuthState | null = null;
let pendingAuth: Promise<AuthState> | null = null;

export async function getCurrentAuth(force = false): Promise<AuthState> {
  if (!force && cachedAuth) return cachedAuth;
  if (!force && pendingAuth) return pendingAuth;
  pendingAuth = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json()) as Partial<AuthState> & { error?: string };
      if (!response.ok || !payload.user || !payload.csrfToken) {
        throw new Error(payload.error ?? "尚未登录");
      }
      cachedAuth = { user: payload.user, csrfToken: payload.csrfToken };
      return cachedAuth;
    })
    .finally(() => {
      pendingAuth = null;
    });
  return pendingAuth;
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const auth = await getCurrentAuth();
  const headers = new Headers(init.headers);
  headers.set("x-csrf-token", auth.csrfToken);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) cachedAuth = null;
  return response;
}

export function setCurrentAuth(auth: AuthState | null) {
  cachedAuth = auth;
}
