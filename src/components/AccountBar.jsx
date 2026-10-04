import { useEffect, useRef, useState } from 'react';
import { useTheme } from './ThemeProvider.jsx';
export function AccountBar({ session, busy, onSignOut, onLibrary }) {
  const menu = useRef(null); const trigger = useRef(null);
  const [imageFailed, setImageFailed] = useState(false);
  const appearance = useTheme(); const user = session.user;
  useEffect(() => { setImageFailed(false); }, [user?.image]);
  useEffect(() => {
    const close = event => { if (menu.current && !menu.current.contains(event.target)) menu.current.open = false; };
    const escape = event => { if (event.key === 'Escape' && menu.current?.open) { menu.current.open = false; trigger.current?.focus(); } };
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); document.removeEventListener('keydown', escape); };
  }, []);
  return <header className="topbar">
    <a className="brand" href="./"><span className="brand-icon" aria-hidden="true">{'{ }'}</span><span>Swagger <strong>YAML Viewer</strong></span></a>
    <div className="account">
      {session.loading ? <span>讀取登入狀態…</span> : user ? <details className="account-menu" ref={menu}>
        <summary ref={trigger} aria-label="開啟帳號選單" title="帳號與外觀設定"><span className="avatar">{user.image && !imageFailed ? <img src={user.image} alt="" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : (user.name || user.email || '?').slice(0, 1).toUpperCase()}</span><span className="account-label">{user.name || '我的帳號'}</span><span aria-hidden="true">⌄</span></summary>
        <div className="account-dropdown">
          <div className="account-identity"><strong>{user.name || '我的帳號'}</strong><span>{user.email}</span></div>
          <button className="menu-action" type="button" onClick={() => { menu.current.open = false; onLibrary(); }}>我的文件</button>
          <label className="theme-label" htmlFor="theme-select">外觀</label>
          <select id="theme-select" value={appearance.theme} disabled={appearance.busy} onChange={event => appearance.changeTheme(event.target.value)}><option value="system">跟隨系統</option><option value="light">淺色</option><option value="dark">深色</option></select>
          {appearance.error && <p className="error" role="alert">{appearance.error}</p>}
          <button id="sign-out" className="menu-action" type="button" disabled={busy} onClick={() => { menu.current.open = false; onSignOut(); }}>登出</button>
        </div>
      </details> : <button id="sign-in" className="button primary" type="button" disabled={!session.configured || busy} onClick={() => window.location.assign('/api/auth/signin')}>使用 Google 登入</button>}
    </div>
  </header>;
}
