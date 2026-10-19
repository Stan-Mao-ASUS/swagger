import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { queryString, type LibraryFilters } from '../lib/library-query.ts';
import { parseDefinition } from '../lib/openapi.ts';
import { documentKey, fetchMe, meKey, privateKey, request } from './query-client.ts';
import type { Category, DocumentPage, MockConfig, Publication, PublicationPage, SharedPublication, SpecNode, Theme, User, VersionDetail, VersionPage } from '../../shared/types.ts';

export interface Session { loading: boolean; user: User | null; configured: boolean }
export function useSession(): Session {
  const me = useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: Infinity });
  return { loading: me.isPending, user: me.data?.user ?? null, configured: me.data?.googleConfigured ?? false };
}
export const useUserId = () => useSession().user?.id;

const nextOffset = (page: { nextOffset: number | null }) => page.nextOffset ?? undefined;

export function useDocuments(filters: LibraryFilters) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: privateKey(userId, 'documents', filters), enabled: !!userId, initialPageParam: 0, getNextPageParam: nextOffset,
    queryFn: ({ pageParam, signal }) => request<DocumentPage>('/api/documents?' + queryString(filters, pageParam), { signal }),
  });
}
export function useCategories() {
  const userId = useUserId();
  return useQuery({ queryKey: privateKey(userId, 'categories'), enabled: !!userId, queryFn: ({ signal }) => request<{ categories: Category[] }>('/api/categories', { signal }).then(data => data.categories) });
}
export function usePreferences() {
  const userId = useUserId();
  return useQuery({ queryKey: privateKey(userId, 'preferences'), enabled: !!userId, queryFn: ({ signal }) => request<{ theme: Theme }>('/api/preferences', { signal }) });
}

export function useVersions(documentId: string) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: documentKey(userId, documentId, 'versions'), initialPageParam: 0, getNextPageParam: nextOffset,
    queryFn: ({ pageParam, signal }) => request<VersionPage>(`/api/documents/${documentId}/versions${pageParam ? '?offset=' + pageParam : ''}`, { signal }),
  });
}
export type ParsedVersion = VersionDetail & { spec: SpecNode };
export const versionQuery = (userId: string | undefined, documentId: string, version: number | string) => ({
  queryKey: documentKey(userId, documentId, 'version', Number(version)),
  queryFn: ({ signal }: { signal: AbortSignal }) => request<VersionDetail>(`/api/documents/${documentId}/versions/${version}`, { signal }).then((data): ParsedVersion => ({ ...data, spec: parseDefinition(data.source) })),
  staleTime: Infinity,
});
export function useVersion(documentId: string, version: number) {
  return useQuery(versionQuery(useUserId(), documentId, version));
}
export function usePublication(documentId: string) {
  const userId = useUserId();
  return useQuery({ queryKey: documentKey(userId, documentId, 'publication'), queryFn: ({ signal }) => request<{ publication: Publication | null }>(`/api/documents/${documentId}/publication`, { signal }).then(data => data.publication) });
}
export function useMock(documentId: string) {
  const userId = useUserId();
  return useQuery({ queryKey: documentKey(userId, documentId, 'mock'), queryFn: ({ signal }) => request<{ mock: MockConfig | null }>(`/api/documents/${documentId}/mock`, { signal }).then(data => data.mock) });
}

export function useSharedList(query: string, offset: number, enabled: boolean) {
  return useQuery({ queryKey: ['shared', 'list', query, offset], enabled, queryFn: ({ signal }) => api<PublicationPage>('/api/shared?' + new URLSearchParams({ q: query, offset: String(offset) }), { signal }) });
}
export function useSharedDocument(shareId: string | null) {
  return useQuery({
    queryKey: ['shared', 'item', shareId], enabled: !!shareId,
    queryFn: ({ signal }) => api<{ publication: SharedPublication }>('/api/shared/' + encodeURIComponent(shareId!), { signal }).then(data => ({ ...data.publication, spec: parseDefinition(data.publication.source) })),
  });
}
