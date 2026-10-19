// A parsed OpenAPI / Swagger document. It is user-supplied YAML or JSON, so every
// field is checked at runtime before use; static types cannot describe it further.
export type SpecNode = { [key: string]: any };

export type Severity = 'error' | 'warning' | 'info';
export interface Issue { path: string; message: string; severity: Severity; rule?: string }
export interface Diagnostic extends Issue { line: number; column: number }

export type SourceType = 'upload' | 'paste' | 'import';
export type Theme = 'light' | 'dark' | 'system';
export type Visibility = 'public' | 'unlisted';
export type SearchKind = 'path' | 'operationId' | 'tag' | 'schema' | 'summary';

export interface User { id: string; name?: string | null; email?: string | null; image?: string | null }
export interface Me { user: User | null; googleConfigured: boolean }

export interface SearchMatch { kind: SearchKind; value: string }
export interface DocumentSummary {
  id: string; currentVersion: number; title: string; displayName: string; categoryId: string | null;
  fileName: string; sourceType: SourceType; createdAt: string; updatedAt: string; matches?: SearchMatch[];
}
export interface DocumentDetail extends DocumentSummary { source: string }
export interface DocumentPage { documents: DocumentSummary[]; nextOffset: number | null }
export interface DocumentPatch { displayName?: string; categoryId?: string | null }

export interface Category { id: string; name: string }

export interface VersionSummary { version: number; title: string; fileName: string; createdAt: string; note: string }
export interface VersionDetail extends VersionSummary { source: string }
export interface VersionPage { versions: VersionSummary[]; nextOffset: number | null; currentVersion: number }

export interface Publication { id: string; visibility: Visibility; expiresAt: string | null; version: number; title: string; summary: string; createdAt: string; updatedAt: string }
export interface SharedPublication extends Publication { fileName: string; source: string }
export interface PublicationPage { publications: Publication[]; nextOffset: number | null }

export interface MockConfig { id: string; version: number; expiresAt: string; updatedAt: string }

export interface Draft { source: string; fileName: string; sourceType: SourceType; baseVersion: number | null; updatedAt: string }
export interface DraftState { draft: Draft | null; revision: number }
