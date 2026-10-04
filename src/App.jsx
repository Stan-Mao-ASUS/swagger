import { useState } from 'react';
import { AccountBar } from './components/AccountBar.jsx';
import { SourcePanel } from './components/SourcePanel.jsx';
import { DocumentPreview } from './components/DocumentPreview.jsx';
import { DocumentLibrary } from './components/DocumentLibrary.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import { useWorkbench } from './hooks/useWorkbench.js';
export default function App() {
  const workbench = useWorkbench(); const [libraryOpen, setLibraryOpen] = useState(false);
  return <ThemeProvider user={workbench.session.user} request={workbench.request}>
    <AccountBar session={workbench.session} busy={workbench.busy} onSignOut={workbench.signOut} onLibrary={() => setLibraryOpen(true)} />
    <main className="workspace"><SourcePanel workbench={workbench} onLibrary={() => setLibraryOpen(true)} /><DocumentPreview preview={workbench.preview} /></main>
    {libraryOpen && workbench.session.user && <DocumentLibrary key={workbench.session.user.id} workbench={workbench} onClose={() => setLibraryOpen(false)} />}
  </ThemeProvider>;
}
