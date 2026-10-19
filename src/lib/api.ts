export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error || '無法連線，請稍後再試。', response.status);
  return data;
}
