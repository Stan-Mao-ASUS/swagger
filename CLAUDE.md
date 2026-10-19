# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Swagger/OpenAPI YAML workbench: a React 19 frontend and a Cloudflare Worker backend (Auth.js Core with Google, D1, R2), deployed to `swagger.stanmao.com`. README.md (in English) is the detailed feature, security and API reference. The user-facing strings and error messages in the code are in Traditional Chinese.

## Commands

```sh
npm ci                      # Node 24 recommended
npm run build               # required before typecheck, tests and dev; see "Build pipeline"
npm run typecheck           # tsc on the three projects: app, worker, node
npm test                    # typecheck, then node --test tests/*.test.ts
node --test tests/editor.test.ts                       # one file (skips the typecheck)
node --test --test-name-pattern="mock" tests/*.test.ts  # by test name
npm run test:e2e            # headless Chrome UI regression run against the QA server; set CHROME_PATH if needed
npm run dev                 # Miniflare on http://localhost:4173, reads .env
node tests/browser-preview.ts    # loopback-only QA server on 4173 with fake accounts at /__qa (stop dev first)
npm run types               # regenerate worker-configuration.d.ts after changing wrangler.jsonc
npm run db:generate         # drizzle-kit: new migration from db/schema.ts
npm run deploy              # applies remote D1 migrations, then wrangler deploy (which runs build)
npm audit --omit=dev
```

There is no linter and no hot reload. After any change to `src/`, `worker/`, `shared/` or `public/`, run `npm run build` again and restart `npm run dev`. The Miniflare-based tests also load `dist/server/index.js`, so they test the last build, not the source.

## Build pipeline

`scripts/build.ts` creates one self-contained Worker file:

1. `scripts/compile-validators.ts` precompiles the official Swagger 2.0 / OpenAPI 3.0 / 3.1 schemas and the JSON Schema 2020-12 metaschema into standalone Ajv code at `.sites-runtime/validators.js`, with a `.d.ts` beside it. This avoids `eval`/`new Function` at runtime. `shared/validation.ts` imports this generated file, so a fresh checkout cannot typecheck or run tests until it builds.
2. esbuild bundles `src/main.tsx` → `app.js` and `src/validation-worker.ts` (the browser Web Worker), then inlines them and every file in `public/` into `.sites-runtime/assets.js` (plus `assets.d.ts`) as a path→text map.
3. esbuild bundles `worker/index.ts` (which imports `assets.js`) → `dist/server/index.js`. `wrangler.jsonc` sets `no_bundle: true`, so wrangler uploads this file unchanged.
4. `scripts/verify-build.ts` fails unless `dist/` contains only `server/index.js`.

## TypeScript

Everything is strict TypeScript, and nothing is compiled by `tsc`: esbuild strips types for the bundles, and Node 24 runs the scripts and tests directly from `.ts` through its built-in type stripping. That has two consequences:
- Use only erasable syntax (`erasableSyntaxOnly`): no `enum`, `namespace` or constructor parameter properties.
- Relative imports name the real file, `./x.ts` or `./x.tsx`. Type-only imports use `import type`.

The code is checked as three projects because the browser DOM and the Workers runtime declare conflicting globals:
- `tsconfig.app.json`: `src/` and `shared/`, with the DOM.
- `tsconfig.worker.json`: `worker/` and `shared/`, with `worker-configuration.d.ts`. That file holds the Workers runtime types and the `Env` bindings, and `npm run types` generates it from `wrangler.jsonc`.
- `tsconfig.node.json`: `tests/`, `scripts/` and `drizzle.config.ts`, with Node types plus the Worker types for the modules tests import.

`shared/types.ts` defines the API contract (documents, versions, publications, mocks, drafts, users), and both the Worker and the frontend import it. Parsed OpenAPI documents use `SpecNode`, a deliberately loose type: the content is user-supplied YAML, and the code checks every field at runtime.

`.sites-runtime/` is gitignored. It holds the generated build inputs and the local Miniflare D1/R2 state. The name is historical and has nothing to do with any hosting platform.

## Architecture

**Code shared by frontend and backend (`shared/`).** The browser editor and the Worker's formal saves use the same parser (`shared/openapi.ts`: 5 MB limit, js-yaml JSON_SCHEMA, limits on alias expansion) and the same validator (`shared/validation.ts`: schema checks plus semantic checks for refs, path parameters, operationIds and security). The mock generator (`shared/mock.ts`) also lives here. When you change validation rules, both sides change.

**Worker (`worker/`).** `index.ts` is the only router. It checks Origin/CSRF centrally: every `/api/*` request that is not GET or HEAD must have `origin === SITE_ORIGIN` and must not be `sec-fetch-site: cross-site`. It also resolves the session user, then dispatches to the modules below. Each module takes `(request, env, user)` and parses its own sub-path:
- `documents.ts`: document CRUD and versions. It also exports the shared helpers `json`, `HttpError`, `boundedText`, `readJson`, `validName` and `initialVersion`.
- `drafts.ts`, `publications.ts`, `mocks.ts`, `library-settings.ts` (categories and preferences).
- `auth.ts`: Auth.js with database sessions through the D1 adapter. Only Google accounts with `email_verified` are accepted.

Throw `HttpError(status, message)` for errors that users should see. Any other exception becomes a generic 503.

**Storage model.** D1 holds metadata and ownership; R2 holds the raw YAML/JSON content. Rules the security tests depend on:
- Ownership always comes from the server-side session `user.id`. Ignore any user ID the client sends.
- Check D1 ownership before every R2 access.
- Every version is an immutable R2 object. Saves and restores send the expected version, and a D1 batch checks it atomically; a conflict returns 409.
- Deleting a document first writes a tombstone (`deleted_at`), then deletes from R2, then from D1. Retrying DELETE finishes a partial cleanup.
- Publications and mocks point to one immutable version, not to the document's current state.
- Drafts use revision checks plus a tombstone revision, so a stale tab cannot bring back a discarded draft.

**Diagnostics come in three severities.** `error` blocks saving and marks the preview stale, and `warning` flags unverified external references; both come from `shared/validation.ts`. `info` is a style suggestion from `src/lib/lint.ts`, which uses a rule registry. `analyzeSource` returns style suggestions in a separate `style` array, so they never block anything, and the API never runs the lint rules. Code that counts errors must check `severity === 'error'` or use `diagnostics` only.

**Library content search.** `worker/search.ts` builds `documents.search_text` on every save and restore. Each line is a control-character kind marker followed by a value, and queries containing control characters are rejected, so a SQL `instr` match can only hit values. Rows saved before this column existed are indexed the first time they are opened with `GET /api/documents/:id`.

**Mocks.** `shared/mock.ts` holds response generation (`mockResponse`), request validation (`validateMockRequest`, structural checks only: no `format` or `pattern`), the `__*` query controls (`mockControls`) and request samples (`sampleRequest`). The mock dialog uses the same code for its local preview, so the preview and `/mock/*` behave the same.

**Migrations.** Edit `db/schema.ts`, run `npm run db:generate`, and commit the new `drizzle/NNNN_*.sql`. Never edit a migration that has already been applied; migrations must be additive. `npm run dev` and the tests apply the SQL files themselves, splitting on `--> statement-breakpoint`. Production uses `wrangler d1 migrations apply`.

**Frontend state (`src/state/`).** Server data uses TanStack Query, and client state uses Zustand:
- `query-client.ts` defines the `QueryClient` and `request`. Every private request goes through `lib/session-client.ts`, which uses a generation counter so that a slow response arriving after logout or a 401 is discarded. On a 401 or sign-out it removes every `['private', …]` query and resets the workbench. Private query keys start with `['private', userId]`, so one account's cache can never serve another.
- `queries.ts` has one hook per resource: `useSession`, `useDocuments` (infinite query), `useCategories`, `usePreferences`, `useVersions`, `useVersion` (immutable, cached forever), `usePublication`, `useMock` and the shared-area queries. Dialogs mutate with `useMutation` and then write the result into the cache or invalidate it.
- `workbench.ts` is the Zustand store for the editor: source, preview, open document, version, diagnostics, status and the `busy` write lock. Its actions (`save`, `openDocument`, `pasteSource`, `restoreVersion`, `deleteDocument`, `signOut` and others) run one at a time and invalidate the affected queries.
- `cloud-draft.ts` is a Zustand store for the autosaved draft. It keeps one session object per account and document target, and every async result checks it still belongs to that session. `useCloudDraftSync` loads drafts and autosaves 800 ms after typing stops.
- `validation.ts` posts the editor content to `validation-worker.ts` → `lib/analyze-source.ts`, which maps JSON Pointer issue paths to line and column. `theme.ts` combines the account preference with a localStorage cache.

`App.tsx` mounts these hooks once. Components read the stores with selectors (`useShallow` for objects) instead of receiving props. The editor is CodeMirror 6. Swagger UI comes from `public/vendor/`, and a new instance is mounted for each document so that auth state from the previous document is cleared.

## Tests

The tests use `node:test` and real Miniflare D1/R2 in temporary directories. `tests/helpers.ts` provides `JsonResponse`, a response type whose `.json()` returns an untyped value, and `testAdapter`, the D1 adapter typed for creating test users and sessions. They create Auth.js sessions directly through the D1 adapter and send requests with a `__Secure-authjs.session-token` cookie and a matching `origin` header. `oauth.test.ts` simulates the Google callback with a locally signed ID token. Passing tests are not proof that real Google OAuth login works.

`tests/e2e/browser.ts` drives headless Chrome through the DevTools protocol against `tests/browser-preview.ts`. It covers paste, typing, draft autosave and recovery, saving, a 409 conflict, restore, library management, sharing, theme, mocks, session expiry, account isolation and sign-out. Run it after any UI or state change. It reaches the CodeMirror view through `.cm-content`'s `cmTile` property, and it auto-accepts `beforeunload` prompts.

`oauth.test.ts` imports `jose`, which is not a direct dependency. It is installed only as a dependency of `@auth/core`.

## Conventions

- Statements are dense, often several per line, and comments are rare: they explain a constraint, never what the code does. Write new code in the same style.
- Prefer real types over `any`. `any` is acceptable for `SpecNode` traversal and for JSON bodies inside tests.
- Messages shown to users, including `HttpError` messages and frontend errors, are in Traditional Chinese.
- `public/vendor/` holds the vendored Swagger UI and js-yaml builds along with their licenses. Do not edit those files. The build never writes `app.js` to disk: it exists only as an entry in `.sites-runtime/assets.js`.

## Configuration

`SITE_ORIGIN` is a plain var in `wrangler.jsonc`, with no path. If it changes, the Google OAuth redirect URI `<SITE_ORIGIN>/api/auth/callback/google` must change too. `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET` are Worker secrets in production and come from `.env` locally. If any of them is missing, login is disabled; anonymous users can still preview but cannot save.
