import { analyzeSource } from './lib/analyze-source.js';
self.onmessage = event => { const { id, source } = event.data; self.postMessage({ id, result: analyzeSource(source) }); };
