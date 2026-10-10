import { useEffect, useState } from 'react';
import { AccountBar } from './components/AccountBar.jsx';
import { EditorWorkspace } from './components/EditorWorkspace.jsx';
import { DocumentLibrary } from './components/DocumentLibrary.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import { SharedArea } from './components/SharedArea.jsx';
import { useWorkbench } from './hooks/useWorkbench.js';
const routeFromUrl = () => { const query = new URLSearchParams(window.location.search); return { shared: query.get('view') === 'shared' || query.has('share'), shareId: query.get('share') || null }; };
export default function App() {
  const workbench = useWorkbench(); const [libraryOpen, setLibraryOpen] = useState(false);
  const [route, setRoute] = useState(routeFromUrl);
  useEffect(() => { const sync = () => setRoute(routeFromUrl()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  function navigate(shared, shareId = null) {
    window.history.pushState(null, '', shared ? shareId ? '?share=' + encodeURIComponent(shareId) : '?view=shared' : workbench.selectedId ? '?doc=' + encodeURIComponent(workbench.selectedId) : '/');
    setRoute({ shared, shareId });
  }
  return <ThemeProvider user={workbench.session.user} request={workbench.request}>
    <AccountBar shared={route.shared} onWorkspace={() => navigate(false)} onShared={() => navigate(true)} session={workbench.session} busy={workbench.busy} onSignOut={workbench.signOut} onLibrary={() => { navigate(false); setLibraryOpen(true); }} />
    {route.shared ? <SharedArea shareId={route.shareId} onOpen={id => navigate(true, id)} onBrowse={() => navigate(true)} /> : <EditorWorkspace workbench={workbench} onLibrary={() => { navigate(false); setLibraryOpen(true); }} />}
    {libraryOpen && workbench.session.user && <DocumentLibrary key={workbench.session.user.id} workbench={workbench} onClose={() => setLibraryOpen(false)} />}
  </ThemeProvider>;
}
