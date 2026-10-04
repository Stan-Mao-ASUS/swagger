import { createContext, useContext, useEffect, useRef, useState } from 'react';
const ThemeContext = createContext(null);
const modes = ['light', 'dark', 'system'];
export const useTheme = () => useContext(ThemeContext);
function cached() { try { const value = localStorage.getItem('workbench-theme'); return modes.includes(value) ? value : 'system'; } catch { return 'system'; } }
function apply(value) {
  document.documentElement.dataset.theme = value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
  try { localStorage.setItem('workbench-theme', value); } catch { /* Theme still works when storage is disabled. */ }
}
export function ThemeProvider({ user, request, children }) {
  const [theme, setTheme] = useState(cached);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false); const generation = useRef(0);
  const userId = user?.id;
  useEffect(() => {
    apply(theme);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => apply(theme);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [theme]);
  useEffect(() => {
    const controller = new AbortController(); const current = ++generation.current;
    setError(''); lock.current = Boolean(userId); setBusy(Boolean(userId));
    if (userId) request('/api/preferences', { signal: controller.signal }).then(data => {
      if (generation.current === current && !controller.signal.aborted) setTheme(data.theme);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    }).finally(() => { if (generation.current === current && !controller.signal.aborted) { lock.current = false; setBusy(false); } });
    return () => controller.abort();
  }, [userId]);
  async function changeTheme(value) {
    if (lock.current || !modes.includes(value)) return;
    lock.current = true; setBusy(true); setError(''); const current = generation.current;
    try {
      if (userId) await request('/api/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ theme: value }) });
      if (generation.current === current) setTheme(value);
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { if (generation.current === current) { lock.current = false; setBusy(false); } }
  }
  return <ThemeContext.Provider value={{ theme, changeTheme, busy, error }}>{children}</ThemeContext.Provider>;
}
