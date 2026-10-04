import { ApiError } from './api.js';

// All private requests in one workbench share an invalidation boundary.
// A slower successful response must not restore private UI after another request expires the session.
export function createSessionClient(send, onInvalidate) {
  let generation = 0;
  function invalidate() { generation++; onInvalidate(); }
  async function request(path, options) {
    const started = generation;
    try {
      const data = await send(path, options);
      if (started !== generation) throw new ApiError('登入狀態已變更，請重新登入。', 401);
      return data;
    } catch (error) {
      if (error.status === 401 && started === generation) invalidate();
      throw error;
    }
  }
  return { request, invalidate };
}
