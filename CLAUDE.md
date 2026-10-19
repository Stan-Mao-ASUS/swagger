# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Swagger/OpenAPI YAML workbench: a React 19 frontend and a Cloudflare Worker backend (Auth.js Core with Google, D1, R2), deployed to `swagger.stanmao.com`. README.md is the detailed feature and API spec. It is mostly in Traditional Chinese, and so are the user-facing strings and error messages in the code.

## Commands

```sh
npm ci                      # Node 24 recommended
npm run build               # required before tests and dev; see "Build pipeline"
npm test                    # node --test tests/*.test.mjs
node --test tests/editor.test.mjs                      # one file
node --test --test-name-pattern="mock" tests/*.test.mjs # by test name
npm run dev                 # Miniflare on http://localhost:4173, reads .env
node tests/browser-preview.mjs   # loopback-only QA server on 4173 with fake accounts at /__qa (stop dev first)
npm run db:generate         # drizzle-kit: new migration from db/schema.ts
npm run deploy              # applies remote D1 migrations, then wrangler deploy (which runs build)
npm audit --omit=dev
```

There is no linter and no hot reload. After any change to `src/`, `worker/`, `shared/` or `public/`, run `npm run build` again and restart `npm run dev`. The Miniflare-based tests also load `dist/server/index.js`, so they test the last build, not the source.

## Build pipeline

`scripts/build.mjs` creates one self-contained Worker file:

1. `scripts/compile-validators.mjs` precompiles the official Swagger 2.0 / OpenAPI 3.0 / 3.1 schemas and the JSON Schema 2020-12 metaschema into standalone Ajv code at `.sites-runtime/validators.js`. This avoids `eval`/`new Function` at runtime. `shared/validation.js` imports this generated file, so a fresh checkout cannot run tests until it builds.
2. esbuild bundles `src/main.jsx` → `app.js` and `src/validation-worker.js` (the browser Web Worker), then inlines them and every file in `public/` into `.sites-runtime/assets.js` as a path→text map.
3. esbuild bundles `worker/index.js` (which imports `assets.js`) → `dist/server/index.js`. `wrangler.jsonc` sets `no_bundle: true`, so wrangler uploads this file unchanged.
4. `scripts/verify-build.mjs` fails unless `dist/` contains only `server/index.js`.

`.sites-runtime/` is gitignored. It holds the generated build inputs and the local Miniflare D1/R2 state. The name is historical and has nothing to do with any hosting platform.

## Architecture

**Code shared by frontend and backend (`shared/`).** The browser editor and the Worker's formal saves use the same parser (`shared/openapi.js`: 5 MB limit, js-yaml JSON_SCHEMA, limits on alias expansion) and the same validator (`shared/validation.js`: schema checks plus semantic checks for refs, path parameters, operationIds and security). The mock generator (`shared/mock.js`) also lives here. When you change validation rules, both sides change.

**Worker (`worker/`).** `index.js` is the only router. It checks Origin/CSRF centrally: every `/api/*` request that is not GET or HEAD must have `origin === SITE_ORIGIN` and must not be `sec-fetch-site: cross-site`. It also resolves the session user, then dispatches to the modules below. Each module takes `(request, env, user)` and parses its own sub-path:
- `documents.js`: document CRUD and versions. It also exports the shared helpers `json`, `HttpError`, `boundedText`, `readJson`, `validName` and `initialVersion`.
- `drafts.js`, `publications.js`, `mocks.js`, `library-settings.js` (categories and preferences).
- `auth.js`: Auth.js with database sessions through the D1 adapter. Only Google accounts with `email_verified` are accepted.

Throw `HttpError(status, message)` for errors that users should see. Any other exception becomes a generic 503.

**Storage model.** D1 holds metadata and ownership; R2 holds the raw YAML/JSON content. Rules the security tests depend on:
- Ownership always comes from the server-side session `user.id`. Ignore any user ID the client sends.
- Check D1 ownership before every R2 access.
- Every version is an immutable R2 object. Saves and restores send the expected version, and a D1 batch checks it atomically; a conflict returns 409.
- Deleting a document first writes a tombstone (`deleted_at`), then deletes from R2, then from D1. Retrying DELETE finishes a partial cleanup.
- Publications and mocks point to one immutable version, not to the document's current state.
- Drafts use revision checks plus a tombstone revision, so a stale tab cannot bring back a discarded draft.

**Diagnostics come in three severities.** `error` blocks saving and marks the preview stale, and `warning` flags unverified external references; both come from `shared/validation.js`. `info` is a style suggestion from `src/lib/lint.js`, which uses a rule registry. `analyzeSource` returns style suggestions in a separate `style` array, so they never block anything, and the API never runs the lint rules. Code that counts errors must check `severity === 'error'` or use `diagnostics` only.

**Library content search.** `worker/search.js` builds `documents.search_text` on every save and restore. Each line is a control-character kind marker followed by a value, and queries containing control characters are rejected, so a SQL `instr` match can only hit values. Rows saved before this column existed are indexed the first time they are opened with `GET /api/documents/:id`.

**Mocks.** `shared/mock.js` holds response generation (`mockResponse`), request validation (`validateMockRequest`, structural checks only: no `format` or `pattern`), the `__*` query controls (`mockControls`) and request samples (`sampleRequest`). The mock dialog uses the same code for its local preview, so the preview and `/mock/*` behave the same.

**Migrations.** Edit `db/schema.ts`, run `npm run db:generate`, and commit the new `drizzle/NNNN_*.sql`. Never edit a migration that has already been applied; migrations must be additive. `npm run dev` and the tests apply the SQL files themselves, splitting on `--> statement-breakpoint`. Production uses `wrangler d1 migrations apply`.

**Frontend (`src/`).** `hooks/useWorkbench.js` holds most of the app state: session, editor content, preview, library, saving and history. `hooks/useCloudDraft.js` autosaves after 800 ms. Every private request goes through `lib/session-client.js`, which uses a generation counter so that a slow response arriving after logout or a 401 is discarded. The editor is CodeMirror 6. Validation runs off the main thread in `validation-worker.js` → `lib/analyze-source.js`, which maps JSON Pointer issue paths to line and column. Swagger UI comes from `public/vendor/`, and a new instance is mounted for each document so that auth state from the previous document is cleared.

## Tests

The tests use `node:test` and real Miniflare D1/R2 in temporary directories. They create Auth.js sessions directly through the D1 adapter and send requests with a `__Secure-authjs.session-token` cookie and a matching `origin` header. `oauth.test.mjs` simulates the Google callback with a locally signed ID token. Passing tests are not proof that real Google OAuth login works.

`oauth.test.mjs` imports `jose`, which is not a direct dependency. It is installed only as a dependency of `@auth/core`.

## Conventions

- The code is plain ESM JavaScript and JSX, with no TypeScript; the only `.ts` files are `db/schema.ts` and `drizzle.config.ts`. Statements are dense, often several per line, and comments are rare: they explain a constraint, never what the code does. Write new code in the same style.
- Messages shown to users, including `HttpError` messages and frontend errors, are in Traditional Chinese.
- `public/vendor/` holds the vendored Swagger UI and js-yaml builds along with their licenses. Do not edit those files. README mentions a generated `public/app.js`, but the current build never writes it to disk: `app.js` exists only as an entry in `.sites-runtime/assets.js`.

## Configuration

`SITE_ORIGIN` is a plain var in `wrangler.jsonc`, with no path. If it changes, the Google OAuth redirect URI `<SITE_ORIGIN>/api/auth/callback/google` must change too. `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` and `AUTH_SECRET` are Worker secrets in production and come from `.env` locally. If any of them is missing, login is disabled; anonymous users can still preview but cannot save.
