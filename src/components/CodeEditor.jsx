import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { json } from '@codemirror/lang-json';
import { autocompletion } from '@codemirror/autocomplete';
import { syntaxHighlighting } from '@codemirror/language';
import { classHighlighter } from '@lezer/highlight';
import { setDiagnostics } from '@codemirror/lint';
import { completionFor } from '../lib/editor.js';

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--code)', color: 'var(--text)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '13px', lineHeight: '1.8', overflow: 'auto' },
  '.cm-content': { padding: '16px 0', caretColor: 'var(--text)' },
  '.cm-gutters': { backgroundColor: 'var(--code)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--chip)' },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#85859d44 !important' },
  '.cm-panels, .cm-tooltip': { backgroundColor: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' },
  '.cm-searchMatch': { backgroundColor: '#c59d5144' },
  '.cm-searchMatch-selected': { backgroundColor: '#c59d5188' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--chip)', color: 'var(--text)' },
});
export function CodeEditor({ source, busy, diagnostics, wrap, onChange, onPaste, onSave, editorRef }) {
  const host = useRef(null), viewRef = useRef(null), props = useRef(null);
  props.current = { onChange, onPaste, onSave };
  const configs = useRef({ readOnly: new Compartment(), wrapping: new Compartment(), language: new Compartment() });
  useEffect(() => {
    const c = configs.current;
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: source, extensions: [
      basicSetup, theme, syntaxHighlighting(classHighlighter), c.language.of(source.trimStart().startsWith('{') ? json() : yaml()),
      autocompletion({ override: [completionFor] }),
      c.readOnly.of(EditorState.readOnly.of(busy)), c.wrapping.of(wrap ? EditorView.lineWrapping : []),
      EditorView.contentAttributes.of({ 'aria-label': 'YAML / JSON 編輯器', 'aria-describedby': 'editor-help', spellcheck: 'false' }),
      keymap.of([{ key: 'Mod-Enter', run: () => { props.current.onSave(); return true; } }, indentWithTab]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged || update.transactions.some(t => t.annotation(Transaction.userEvent) === 'external')) return;
        const next = update.state.doc.toString();
        if (update.transactions.some(t => t.isUserEvent('input.paste'))) props.current.onPaste(next);
        else props.current.onChange(next);
      }),
    ] }) });
    viewRef.current = view; editorRef.current = view;
    return () => { view.destroy(); viewRef.current = null; editorRef.current = null; };
  }, []);
  useEffect(() => {
    const view = viewRef.current;
    if (view.state.doc.toString() !== source) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source }, annotations: Transaction.userEvent.of('external') });
  }, [source]);
  const isJson = source.trimStart().startsWith('{');
  useEffect(() => { viewRef.current.dispatch({ effects: configs.current.language.reconfigure(isJson ? json() : yaml()) }); }, [isJson]);
  useEffect(() => { viewRef.current.dispatch({ effects: configs.current.readOnly.reconfigure(EditorState.readOnly.of(busy)) }); }, [busy]);
  useEffect(() => { viewRef.current.dispatch({ effects: configs.current.wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) }); }, [wrap]);
  useEffect(() => {
    const view = viewRef.current;
    view.dispatch(setDiagnostics(view.state, diagnostics.map(d => {
      const line = view.state.doc.line(Math.min(d.line, view.state.doc.lines));
      const from = Math.min(line.to, line.from + d.column - 1);
      return { from, to: Math.min(view.state.doc.length, from + 1), severity: 'error', message: d.message };
    })));
  }, [diagnostics, source]);
  return <div className="code-editor" ref={host} />;
}
