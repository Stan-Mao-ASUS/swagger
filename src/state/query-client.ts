import { QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { createSessionClient } from '../lib/session-client.ts';
import type { Me } from '../../shared/types.ts';

// Failed requests surface to the user as-is; retrying a 401 or 409 would hide them.
export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

const invalidationHandlers = new Set<() => void>();
export const onSessionInvalidated = (handler: () => void) => { invalidationHandlers.add(handler); };
const session = createSessionClient(api, () => {
  queryClient.removeQueries({ queryKey: ['private'] });
  queryClient.setQueryData<Me>(meKey, previous => ({ googleConfigured: previous?.googleConfigured ?? true, user: null }));
  for (const handler of invalidationHandlers) handler();
});
export const request = session.request;
export const invalidateSession = session.invalidate;

export const meKey = ['me'] as const;
export const fetchMe = ({ signal }: { signal?: AbortSignal } = {}) => request<Me>('/api/me', { signal });
export const currentUser = () => queryClient.getQueryData<Me>(meKey)?.user ?? null;
// Private data is keyed by account, so a later sign-in never reads another account's cache.
export const privateKey = (userId: string | undefined, ...parts: unknown[]) => ['private', userId, ...parts] as const;
export const documentKey = (userId: string | undefined, documentId: string, ...parts: unknown[]) => privateKey(userId, 'document', documentId, ...parts);
export const invalidateLibrary = () => queryClient.invalidateQueries({ queryKey: ['private'], predicate: query => isLibraryQuery(query.queryKey) });
export const invalidateDocument = (documentId: string) => queryClient.invalidateQueries({ queryKey: ['private'], predicate: query => query.queryKey[2] === 'document' && query.queryKey[3] === documentId && query.queryKey[4] !== 'version' });
export const jsonBody = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const isLibraryQuery = (key: readonly unknown[]) => key[2] === 'documents' || key[2] === 'categories';
export const resetLibrary = () => queryClient.resetQueries({ queryKey: ['private'], predicate: query => isLibraryQuery(query.queryKey) });
