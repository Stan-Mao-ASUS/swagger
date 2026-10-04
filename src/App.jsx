import { AccountBar } from './components/AccountBar.jsx';
import { SourcePanel } from './components/SourcePanel.jsx';
import { DocumentPreview } from './components/DocumentPreview.jsx';
import { useWorkbench } from './hooks/useWorkbench.js';

export default function App() {
  const workbench = useWorkbench();
  return <>
    <AccountBar session={workbench.session} busy={workbench.busy} onSignOut={workbench.signOut} />
    <main className="workspace"><SourcePanel workbench={workbench} /><DocumentPreview preview={workbench.preview} /></main>
  </>;
}
