import { ApiError } from './api.ts';

// All private requests in one workbench share an invalidation boundary.
// A slower successful response must not restore private UI after another request expires the session.
export type Send = <T>(path: string, options?: RequestInit) => Promise<T>;
export function createSessionClient(send: Send, onInvalidate: () => void) {
  let generation = 0;
  function invalidate() { generation++; onInvalidate(); }
  async function request<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    const started = generation;
    try {
      const data = await send<T>(path, options);
      if (started !== generation) throw new ApiError('登入狀態已變更，請重新登入。', 401);
      return data;
    } catch (error) {
      if ((error as ApiError).status === 401 && started === generation) invalidate();
      throw error;
    }
  }
  return { request, invalidate };
}
