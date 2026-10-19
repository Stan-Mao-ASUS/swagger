import { useEffect } from 'react';
import { create } from 'zustand';
import { useMutation } from '@tanstack/react-query';
import { jsonBody, privateKey, queryClient, request } from './query-client.ts';
import { usePreferences, useSession } from './queries.ts';
import type { Theme } from '../../shared/types.ts';

const CACHE = 'workbench-theme';
const themes: Theme[] = ['light', 'dark', 'system'];
function cached(): Theme { try { const value = localStorage.getItem(CACHE) as Theme; return themes.includes(value) ? value : 'system'; } catch { return 'system'; } }
// The account preference wins once loaded; this browser cache only covers first paint and guests.
const useLocalTheme = create<{ theme: Theme }>()(() => ({ theme: cached() }));

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  try { localStorage.setItem(CACHE, theme); } catch { /* Theme still works when storage is disabled. */ }
}

export function useTheme() {
  const { user } = useSession();
  const preferences = usePreferences();
  const local = useLocalTheme(state => state.theme);
  const change = useMutation({
    mutationFn: async (theme: Theme) => user ? (await request<{ theme: Theme }>('/api/preferences', jsonBody('PATCH', { theme }))).theme : theme,
    onSuccess: theme => { if (user) queryClient.setQueryData(privateKey(user.id, 'preferences'), { theme }); useLocalTheme.setState({ theme }); },
  });
  const theme = (user && preferences.data?.theme) || local;
  const busy = (!!user && preferences.isPending) || change.isPending;
  return {
    theme, busy, error: change.error?.message || (user && preferences.error?.message) || '',
    changeTheme: (value: Theme) => { if (!busy && themes.includes(value)) change.mutate(value); },
  };
}

export function useApplyTheme() {
  const { theme } = useTheme();
  useEffect(() => {
    apply(theme); useLocalTheme.setState({ theme });
    const media = matchMedia('(prefers-color-scheme: dark)'), sync = () => apply(theme);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [theme]);
}
