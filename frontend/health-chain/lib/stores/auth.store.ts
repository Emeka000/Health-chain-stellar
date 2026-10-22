/**
 * Auth Store - Zustand store with sessionStorage persistence
 * Manages authentication state including tokens and user profile
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  [key: string]: unknown;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
}

interface AuthActions {
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  clearAuth: () => void;
  updateAccessToken: (accessToken: string) => void;
}

type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  user: null,
  isAuthenticated: false,
};

function syncAuthCookie(isAuthenticated: boolean, accessToken: string | null): void {
  if (typeof window === 'undefined') return;
  if (isAuthenticated && accessToken) {
    const value = encodeURIComponent(
      JSON.stringify({ state: { isAuthenticated: true, accessToken } })
    );
    document.cookie = `auth-storage=${value}; path=/; SameSite=Lax`;
  } else {
    document.cookie = 'auth-storage=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';
  }
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      ...initialState,

      setTokens: (accessToken: string, refreshToken: string) => {
        set({ accessToken, refreshToken, isAuthenticated: true });
        syncAuthCookie(true, accessToken);
      },

      setUser: (user: User) => {
        set({ user });
      },

      updateAccessToken: (accessToken: string) => {
        set({ accessToken });
        syncAuthCookie(true, accessToken);
      },

      clearAuth: () => {
        set(initialState);
        syncAuthCookie(false, null);
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => sessionStorage), // sessionStorage for security
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
