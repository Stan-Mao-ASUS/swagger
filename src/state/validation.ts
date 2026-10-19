import { useEffect, useRef } from 'react';
import { useWorkbench } from './workbench.ts';
import type { ValidationRequest, ValidationResponse } from '../lib/analyze-source.ts';

// An unchanged source keeps the current preview object, so Swagger UI is not remounted.
export function useValidation() {
  const editor = useWorkbench(state => state.editor), styleOff = useWorkbench(state => state.styleRulesOff);
  const worker = useRef<Worker | null>(null), sequence = useRef(0);
  useEffect(() => {
    const instance = new Worker('/validation-worker.js'); worker.current = instance;
    return () => { instance.terminate(); worker.current = null; };
  }, []);
  useEffect(() => {
    useWorkbench.setState({ validating: true });
    const id = ++sequence.current, instance = worker.current!;
    const receive = (event: MessageEvent<ValidationResponse>) => {
      if (event.data.id !== id) return;
      const { result } = event.data;
      useWorkbench.setState(state => ({
        diagnostics: result.diagnostics, style: result.style, validating: false,
        preview: result.spec ? (state.preview?.source === editor.source && state.preview.fileName === editor.fileName ? state.preview : { spec: result.spec, source: editor.source, fileName: editor.fileName }) : state.preview,
      }));
    };
    const failed = () => useWorkbench.setState({ style: [], diagnostics: [{ path: '', line: 1, column: 1, severity: 'error', message: '驗證元件載入失敗，請重新整理。' }], validating: false });
    instance.addEventListener('message', receive); instance.addEventListener('error', failed);
    const timer = setTimeout(() => instance.postMessage({ id, source: editor.source, styleOff } satisfies ValidationRequest), 350);
    return () => { clearTimeout(timer); instance.removeEventListener('message', receive); instance.removeEventListener('error', failed); };
  }, [editor, styleOff]);
}
