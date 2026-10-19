import { useEffect, useState } from 'react';
import { AccountBar } from './components/AccountBar.tsx';
import { EditorWorkspace } from './components/EditorWorkspace.tsx';
import { DocumentLibrary } from './components/DocumentLibrary.tsx';
import { SharedArea } from './components/SharedArea.tsx';
import { useWorkbench } from './state/workbench.ts';
import { useCloudDraftSync, useCloudDraftView } from './state/cloud-draft.ts';
import { useValidation } from './state/validation.ts';
import { useApplyTheme } from './state/theme.ts';
import { useSession } from './state/queries.ts';

interface Route { shared: boolean; shareId: string | null }
const routeFromUrl = (): Route => { const query = new URLSearchParams(window.location.search); return { shared: query.get('view') === 'shared' || query.has('share'), shareId: query.get('share') || null }; };

function useWindowGuards() {
  const hasEdits = useWorkbench(state => state.hasEdits), { unsynced } = useCloudDraftView();
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    const preventFileNavigation = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('pageshow', onPageShow); window.addEventListener('dragover', preventFileNavigation); window.addEventListener('drop', preventFileNavigation);
    return () => { window.removeEventListener('pageshow', onPageShow); window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation); };
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (hasEdits && unsynced) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [hasEdits, unsynced]);
}

export default function App() {
  const { user } = useSession();
  const selectedId = useWorkbench(state => state.selectedId);
  const [libraryOpen, setLibraryOpen] = useState(false), [route, setRoute] = useState(routeFromUrl);
  useEffect(() => useWorkbench.getState().initialize(), []);
  useEffect(() => { const sync = () => setRoute(routeFromUrl()); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync); }, []);
  useValidation(); useCloudDraftSync(); useApplyTheme(); useWindowGuards();
  function navigate(shared: boolean, shareId: string | null = null) {
    window.history.pushState(null, '', shared ? shareId ? '?share=' + encodeURIComponent(shareId) : '?view=shared' : selectedId ? '?doc=' + encodeURIComponent(selectedId) : '/');
    setRoute({ shared, shareId });
  }
  const openLibrary = () => { navigate(false); setLibraryOpen(true); };
  return <>
    <AccountBar shared={route.shared} onWorkspace={() => navigate(false)} onShared={() => navigate(true)} onLibrary={openLibrary} />
    {route.shared ? <SharedArea shareId={route.shareId} onOpen={id => navigate(true, id)} onBrowse={() => navigate(true)} /> : <EditorWorkspace onLibrary={openLibrary} />}
    {libraryOpen && user && <DocumentLibrary key={user.id} onClose={() => setLibraryOpen(false)} />}
  </>;
}
