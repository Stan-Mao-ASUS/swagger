# Swagger YAML Workbench

A browser workbench for Swagger 2.0 and OpenAPI 3.0 / 3.1 documents. You edit YAML or JSON with live validation and a Swagger UI preview. Signed-in users keep a versioned document library, publish read-only shares, and run mock APIs. It runs on your own Cloudflare account (Workers, D1 and R2), configured in `wrangler.jsonc`.

The user interface is in Traditional Chinese.

## Features

### Editor and preview

- CodeMirror 6 editor with line numbers, folding, YAML key suggestions, find and replace, undo and redo, line wrapping, and YAML ⇄ JSON conversion. Conversion warns that YAML comments and anchors are lost, and you can undo it.
- Live Swagger UI preview, updated 350 ms after you stop typing. If an edit is invalid, the last valid preview stays visible and is marked as stale.
- Open documents by upload, drag and drop, or paste, or load the built-in example. The size limit is 5 MB. **Authorize** and **Try it out** work as in Swagger UI, subject to the target server's CORS policy.
- Keyboard: Cmd/Ctrl+Enter saves and Cmd/Ctrl+F searches. The pane separator responds to the arrow keys, Home and End. On narrow screens the panes stack, and the Edit and Preview buttons show one pane at a time.

### Validation

- The official Swagger 2.0, OpenAPI 3.0 and OpenAPI 3.1 structure schemas, plus the JSON Schema 2020-12 metaschema, are compiled at build time. Nothing runs `eval`, and no document is sent to an external validator.
- Semantic checks cover local `$ref` targets, duplicate operation IDs, path templates and their parameters, and security scheme names.
- Validation runs in a browser Web Worker while you edit, and again in the API on every formal save. Each issue links to its line and column. At most 100 diagnostics are shown.
- External references, references scoped by an independent `$id`, and custom JSON Schema dialects are reported as "unverified" warnings. The workbench does not claim that their remote contents are valid.
- YAML alias bombs are rejected: cyclic aliases are refused, and expansion depth, node count and text size are limited. Ordinary aliases and OpenAPI `$ref` still work.
- **Style rules** add optional suggestions: operationId present and camelCase, summary, tags, declared tags, a success response, kebab-case paths, and no trailing slash. They never block saving or the preview, and the API ignores them. You can turn each rule off. That choice is stored in your browser.

### Document library (signed in)

- Each upload, paste or example import creates a new document. Saving an open document creates a new version, and **Save as new document** creates a separate one.
- **My documents** supports custom names, one category per document, sorting (newest, recently modified, name), creation-date ranges (local dates, end day inclusive) and pagination.
- Search matches names, original file names, and the current version's paths, operationIds, tags, schema names and summaries. Each result shows what matched. Documents saved before content search existed are indexed the first time they are opened.
- You can create, rename and remove categories. Removing a category moves its documents to "Uncategorized" and keeps their content.

### Versions, comparison and export

- Each version keeps its own content, file name, API title, timestamp and an optional note. Restoring an old version creates a new version, and nothing is overwritten.
- Compare any two versions line by line. You also get a rule-based summary of parameter, request, response, schema, security and server changes, which you can filter by "possibly breaking", "needs review" and "other". This helps a review but does not prove compatibility. Large or complex specs show a warning, and at most 500 summary items are shown.
- Copy or download the comparison as a Markdown changelog grouped by risk.
- Export the current preview or any version as the original file (comments and formatting kept), as JSON, as a self-contained offline HTML page (no scripts, CDN or network requests), or as TypeScript declarations (`.d.ts`). The `.d.ts` export turns named schemas into `export type` and puts each endpoint's parameters, request body and responses in a `paths` interface. Formats, patterns and other runtime constraints are not represented.
- Comparisons stop at 800,000 characters or 12,000 lines in total. The version viewer shows at most 500,000 characters, and downloads are always complete.

### Sharing

- Each document is private, unlisted (anyone with the link) or public (listed in the **Shared area** at `/?view=shared`). Share links look like `/?share=<publication-id>`.
- A share points to one immutable saved version. Later saves do not change it until you update the share. Shares can expire, and expiry is checked on every anonymous read.
- Changing the audience, rotating the link or renewing an expired share issues a new link. Revoking a share removes access, but it cannot recall copies readers already downloaded.
- A share exposes only that version's content, the file name, the public title and the summary. It never exposes the private document ID, category, other versions, version notes or the owner's Google profile. **Try it out** is disabled on shared pages.

### Mock API

- Turn any saved version into a mock API at `/mock/<random-id>/<path from the spec>`, with no `servers` or `basePath` prefix. You confirm that the content may be public, and the mock expires after 1, 7 or 30 days. Mocks are managed separately from shares. Updating a mock issues a new URL, and disabling it, letting it expire or deleting the document stops it immediately.
- Responses come from response or media examples first, then from bounded schema samples. Local JSON Pointers are supported for Swagger 2 and OpenAPI 3. Supported response types are JSON, `text/plain` and empty responses. CORS is open, but credentials are not allowed.
- Requests are checked against the spec: path, query and header parameters, and JSON request bodies, for type, required fields, enums, lengths, ranges and unexpected properties. A request that fails returns 400 with a list of issues. `format` and `pattern` are not checked, because a regex from the spec could stall the Worker. Request bodies are limited to 256 KB, checked in memory, and never stored.
- Query controls:

  | Parameter | Effect |
  |---|---|
  | `__status=404` | Choose the response status |
  | `__example=name` | Choose a named example |
  | `__validate=off` | Skip request validation |
  | `__delay=ms` | Delay the response by 0–5000 ms |
  | `__fail=0.2` | Return an error with this probability (0–1) |
  | `__failStatus=503` | Status for injected errors (400–599, default 500) |

- Mocks never call upstream servers, store requests, keep CRUD state or enforce the spec's security. Do not send real tokens or personal data. External references and examples, binary and streaming responses are not supported. Generated samples do not guarantee every pattern, combination, uniqueness or range constraint. Responses are limited to 256 KB, with a generation depth of 12, 1,000 nodes and at most 5 array items.

### Accounts and drafts

- Sign in with Google through Auth.js with database sessions. Only accounts with `email_verified` are accepted, and only the `openid email profile` scopes are requested. Without a sign-in, the editor and preview work, and the UI says that nothing is saved.
- While you are signed in, unsaved edits autosave to a cloud draft 800 ms after you stop typing. When a draft differs from the opened version, you can restore or discard it. Drafts never become versions or shares by themselves. Revision checks reject stale writes from another tab, and the editor warns before you leave with unsynced changes.
- The account menu shows your Google avatar, or your initial if the picture fails to load. It offers light, dark and system themes, stored with your account.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript (TSX), CodeMirror 6, Swagger UI (vendored in `public/vendor/`) |
| Frontend state | TanStack Query 5 for server data, Zustand 5 for editor and draft state |
| Backend | Cloudflare Workers, Auth.js Core with the Google provider and the D1 adapter |
| Storage | D1 (SQLite) for metadata and ownership, R2 for document content |
| Build | esbuild bundles the frontend and the Worker. Wrangler only deploys and runs migrations |

Everything is strict TypeScript. `tsc` only type-checks (`npm run typecheck`): esbuild strips types for the bundles, and Node 24 runs the tests and scripts directly from `.ts`. The API contract shared by the Worker and the frontend is in `shared/types.ts`, and the parser, validator and mock engine in `shared/` run in both places.

### Security model

- Every private API resolves the user from the server-side session and ignores any user ID the client sends. Ownership is checked in the SQL query itself, before any R2 read, write or delete.
- Every non-GET API request must come from `SITE_ORIGIN` and must not be cross-site. Auth.js handles CSRF, state, PKCE and nonce. Callback URLs are pinned to `SITE_ORIGIN`, and forwarded host headers are ignored.
- Versions are immutable R2 objects. Saves and restores send the expected version, and a D1 batch checks it atomically, so a concurrent write returns 409 and keeps your edit.
- Deleting a document first hides it with a tombstone, then deletes its versions, drafts and blobs from R2, then deletes it from D1. If R2 fails, the document stays unreadable and a retried DELETE finishes the cleanup. Its shares and mocks stop working immediately.
- Request bodies are read with streaming limits: 5 MB for documents and 16 KiB for JSON settings. Invalid UTF-8 returns 400.
- After a sign-out or an expired session, the frontend drops all private cached data and ignores any slower response that arrives later.

## Getting started

Requires Node.js 24.

```sh
npm ci
cp .env.example .env
npm run build
npm run dev
```

Open http://localhost:4173. `npm run dev` runs the built Worker in Miniflare, with local D1 and R2 data in the gitignored `.sites-runtime/` folder. That data is separate from production. Rebuild and restart after code changes. A plain static file server does not work, because it has no sign-in or document API.

To sign in locally, fill in the three `AUTH_*` values in `.env` and add `http://localhost:4173/api/auth/callback/google` to your Google OAuth client.

For UI testing without Google, stop the dev server and run `node tests/browser-preview.ts`. It is a loopback-only QA server, and `/__qa` lets you pick one of two fake accounts. It is never bundled or deployed, and the production Worker has no QA sign-in.

## Testing

```sh
npm run build
npm test            # npm run typecheck, then node --test
npm run test:e2e    # headless Chrome regression run (needs Chrome; set CHROME_PATH if it is not in the default location)
npm audit --omit=dev
```

- Unit and integration tests use the real Auth.js D1 adapter and Miniflare D1/R2, with sessions created directly. They cover anonymous and spoofed identities, cross-account isolation, CSRF, size limits, versions and conflicts, sharing, drafts, mocks, migrations and persistence across restarts.
- `tests/oauth.test.ts` simulates the full Google OAuth callback and its error paths with a locally signed ID token. Passing it does not prove that a real Google sign-in works.
- `tests/e2e/browser.ts` drives the UI through Chrome DevTools: paste, typing, draft autosave and recovery, save, a version conflict, restore, library management, sharing, theme, mocks, session expiry, account isolation and sign-out.

## Deployment

### Google OAuth setup

1. In Google Cloud (Google Auth Platform), create or choose a project and configure the OAuth consent screen: app name, contact email and audience.
2. Create an OAuth client with the **Web application** type.
3. Set the authorized redirect URI to exactly `<SITE_ORIGIN>/api/auth/callback/google`. If the console asks for authorized JavaScript origins, use `<SITE_ORIGIN>`.
4. If the app is in Testing mode, add your test accounts as test users.
5. Store the credentials as Worker secrets (`npx wrangler secret put <NAME>`):
   - `AUTH_GOOGLE_ID`: the client ID.
   - `AUTH_GOOGLE_SECRET`: the client secret.
   - `AUTH_SECRET`: generate it with `openssl rand -base64 33`. Changing it later signs everyone out.

`SITE_ORIGIN` is not a secret. It is set in `wrangler.jsonc` under `vars`, without a path. Secrets apply to the deployed Worker immediately, but changes to `vars` need `npm run deploy`. If any Google credential is missing, the sign-in button is disabled and the API does not fall back to anonymous storage.

Never paste the client secret into chat, commit it, or put it in `public/`.

References: [Google OAuth for web servers](https://developers.google.com/identity/protocols/oauth2/web-server), [Auth.js Google provider](https://authjs.dev/getting-started/providers/google), [Auth.js D1 adapter](https://authjs.dev/getting-started/adapters/d1).

### First deployment

```sh
npx wrangler login
npx wrangler d1 create swagger-yaml-workbench   # put the printed database_id in wrangler.jsonc
npx wrangler r2 bucket create swagger-yaml-workbench
# set SITE_ORIGIN in wrangler.jsonc to your workers.dev or custom domain, then complete the Google OAuth setup
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET
npx wrangler secret put AUTH_SECRET
npm run deploy
```

### Later deployments

Run `npm run deploy`. It applies pending D1 migrations to production, then `wrangler deploy` runs `npm run build` and uploads `dist/server/index.js` unchanged.

### Migrations

To change the schema, edit `db/schema.ts`, run `npm run db:generate`, and commit the new file in `drizzle/`. Never edit a migration that has already been applied, and keep migrations additive. Production records applied migrations in D1's `d1_migrations` table. After changing `wrangler.jsonc`, run `npm run types` to regenerate `worker-configuration.d.ts`.

## API reference

All private endpoints require a session cookie. All writes require a same-site `Origin`. Responses are `private, no-store`.

| Method and path | Purpose |
|---|---|
| `GET /api/me` | Current user and whether Google sign-in is configured |
| `/api/auth/*` | Auth.js sign-in, callback, session, CSRF and sign-out |
| `GET /api/documents` | List documents. Query: `q`, `category` (id or `uncategorized`), `from`, `to` (ISO timestamps), `sort` (`created`, `updated`, `name`), `offset` |
| `POST /api/documents` | Create a document. The body is the YAML/JSON text, with headers `x-source-type` (`upload`, `paste`, `import`) and `x-file-name` |
| `GET` / `DELETE /api/documents/:id` | Read the current content, or delete the document and everything attached to it |
| `PATCH /api/documents/:id` | Set `displayName` and/or `categoryId` |
| `GET /api/documents/:id/versions` | List versions (`offset`) |
| `GET /api/documents/:id/versions/:version` | Read one version |
| `PUT /api/documents/:id/content` | Save a new version. Headers: `x-expected-version` and an optional `x-version-note` |
| `POST /api/documents/:id/restore` | Restore `{ version, expectedVersion }` as a new version |
| `GET` / `PUT` / `DELETE /api/documents/:id/publication` | Read, publish or update (`version`, `title`, `summary`, `visibility`, `expiresAt`, `rotateLink`, `confirmPublic: true`), or revoke a share |
| `GET` / `PUT` / `DELETE /api/documents/:id/mock` | Read, enable (`version`, `expiresInDays`: 1, 7 or 30, `confirmPublic: true`) or disable the mock |
| `GET` / `PUT` / `DELETE /api/drafts/:id` | The cloud draft for a document, or `new` for an unsaved one. Writes send `x-draft-revision` |
| `GET` / `PATCH /api/preferences` | The theme preference |
| `GET` / `POST /api/categories`, `PATCH` / `DELETE /api/categories/:id` | Manage categories |
| `GET /api/shared` | Public shares (`q`, `offset`). No sign-in required |
| `GET /api/shared/:publicationId` | One public or unlisted share. No sign-in required |
| `ANY /mock/:mockId/<path>` | A mock response. No sign-in required |

## Project structure

| Path | Contents |
|---|---|
| `src/main.tsx`, `src/App.tsx` | React entry point and app shell |
| `src/components/` | Account bar, editor, preview, library, version history, share and mock dialogs |
| `src/state/` | TanStack Query client and query hooks (`query-client.ts`, `queries.ts`), plus Zustand stores for the editor (`workbench.ts`) and cloud drafts (`cloud-draft.ts`), validation and theme |
| `src/lib/` | API client, session client, OpenAPI helpers, diff, changelog, lint rules, exports and TypeScript generation |
| `shared/` | Code used by both frontend and Worker: parser, validator, mock engine and API types |
| `worker/` | HTTP router (`index.ts`), auth, documents and versions, drafts, publications, mocks, categories and preferences, search index |
| `public/` | HTML entry, CSS, and vendored Swagger UI and js-yaml with their licenses |
| `db/schema.ts`, `drizzle/` | Schema and migrations |
| `scripts/` | Build, validator precompilation, build verification and the local dev server |
| `tests/` | Unit, integration and OAuth tests, the QA server and the end-to-end browser run |
| `tsconfig.*.json` | Type-check projects for the app (DOM), the Worker and Node |
| `worker-configuration.d.ts` | Workers runtime and binding types generated by `npm run types` |
| `wrangler.jsonc` | Worker name, `SITE_ORIGIN`, routes and D1 / R2 bindings |

## Limitations

- External `$ref` targets and **Try it out** requests go to the URLs in the document and are subject to CORS. Google sign-in only identifies you. It does not authorize the third-party APIs described in your documents.
- The breaking-change summary and generated types are aids, not guarantees. Review the raw diff and the spec itself.
