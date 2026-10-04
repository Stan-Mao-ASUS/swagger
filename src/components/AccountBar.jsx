export function AccountBar({ session, busy, onSignOut }) {
  return <header className="topbar">
    <a className="brand" href="./"><span className="brand-icon" aria-hidden="true">{'{ }'}</span><span>Swagger <strong>YAML Viewer</strong></span></a>
    <div className="account">
      <span id="account-name">{session.loading ? '讀取登入狀態…' : session.user ? session.user.name || session.user.email : '尚未登入'}</span>
      {!session.loading && (session.user
        ? <button id="sign-out" className="button" type="button" disabled={busy} onClick={onSignOut}>登出</button>
        : <button id="sign-in" className="button primary" type="button" disabled={!session.configured || busy} onClick={() => window.location.assign('/api/auth/signin')}>使用 Google 登入</button>)}
    </div>
  </header>;
}
