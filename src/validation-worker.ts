import { analyzeSource, type ValidationRequest, type ValidationResponse } from './lib/analyze-source.ts';
self.onmessage = (event: MessageEvent<ValidationRequest>) => {
  const { id, source, styleOff } = event.data;
  self.postMessage({ id, result: analyzeSource(source, styleOff) } satisfies ValidationResponse);
};
