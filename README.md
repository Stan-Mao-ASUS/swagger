# Swagger YAML Viewer

部署在自己的 Cloudflare 帳號（Workers + D1 + R2），設定在 `wrangler.jsonc`。

沿用原站 Swagger UI、YAML / JSON 解析與版面。支援 Swagger 2.0、OpenAPI 3.0 / 3.1、5 MB 檔案、貼上、拖曳、範例匯入、Authorize 與 Try it out。

## 技術架構

前端已轉為 React 19 + JSX，使用 Hooks 管理登入狀態、編輯內容、非同步儲存與文件歷史。既有 CSS 與 Swagger UI 保留，Swagger UI 由獨立 React 元件掛載，每次切換文件都建立新實例以清除先前的 API 授權狀態。

後端仍是 Cloudflare Workers、Auth.js Core / Google Provider、D1（SQLite）與 R2。React 只透過原有 API 操作資料，所有 ownership、Origin、OAuth 與 session 驗證繼續由後端處理。esbuild 分別打包前端與 Worker，沒有加入 Next.js；wrangler 只負責部署與 migrations，不重新打包。

## 新增功能

- Google 登入：Auth.js Core + Google Provider + 官方 D1 adapter，資料庫 session。
- 使用者登入後，每次上傳、貼上有效的 YAML 或載入範例，都建立獨立紀錄。開啟文件後按儲存會新增該文件的版本，也可另存為新文件。
- D1 保存 title、fileName、sourceType、createdAt、updatedAt 及擁有者；R2 保存原始內容。
- 個人歷史可分頁、重新整理、重新開啟、刪除。重新開啟不會新增紀錄，編輯後儲存會新增版本。
- 未登入可使用原有預覽；介面會明確提示未儲存。個人文件 API 拒絕匿名存取。
- 查詢、讀取、刪除使用由伺服器驗證的 session user id；R2 存取前必須通過 D1 ownership 查詢。忽略客戶端傳入的 user id。
- 寫入及刪除驗證 Origin，Auth.js 處理 CSRF、state、PKCE、nonce、Google 回傳身份。只允許 email_verified 的 Google 帳號。
- 刪除先以 tombstone 隱藏紀錄，再刪 R2、D1；R2 失敗時仍不可讀取該紀錄，可重試 DELETE 完成清理。

## 頭像、外觀與文件管理

右上角使用 Google 頭像，照片無法載入時顯示姓名首字。選單提供「我的文件」、淺色／深色／跟隨系統及登出。登入後的 theme 儲存於 D1 preferences；localStorage 僅快取顯示偏好，頁面啟動後以帳號設定為準。

「我的文件」支援自訂名稱、單一分類、名稱／原始檔名搜尋、建立日期區間、最近新增／最近修改／名稱排序、分頁、開啟及刪除。日期區間依瀏覽器當地時間轉成 UTC，結束日包含當天。桌機表格與手機卡片共用資料。

- 文件新增 nullable display_name、category_id；舊文件名稱 fallback 到 title，預設未分類，不改原 YAML、fileName 或 createdAt。
- 分類可新增、改名、移除；移除分類將文件移至未分類並更新 updatedAt，保留 R2 內容。
- 新 API：GET/PATCH /api/preferences、GET/POST /api/categories、PATCH/DELETE /api/categories/:id、PATCH /api/documents/:id。
- 文件列表 API 支援 q、category、from、to、sort、offset，全部由後端依 session user id 篩選。
- 修改文件時，SQL 同時檢查文件與分類 ownership，前端傳入的 owner 或日期欄位會被拒絕。
- 本次 schema 使用新增的 0001 migration；0000 保持原樣。正式 Google OAuth credentials 和 redirect URI 不變。

20 項自動測試涵蓋原有功能、跨帳號 metadata/classification/theme、搜尋日期排序、分類移除保留內容及舊資料 migration。本機 UI 已測試頭像選單、主題切換、文件改名／分類、刷新保存、搜尋空結果與不同帳號的文件／分類隔離。

## Google OAuth 設定（正式登入前必做）

此專案不是 Next.js，因此直接使用 Web Request / Response 相容的 Auth.js Core，搭配 Cloudflare Worker。

1. 在 Google Cloud / Google Auth Platform 建立或選擇專案，設定 OAuth consent screen 的 app 名稱、聯絡 email、audience。
2. 建立 OAuth client，Application type 選 **Web application**。
3. Authorized redirect URI 必須完全一致：

   `<SITE_ORIGIN>/api/auth/callback/google`

4. 如 Google Console 要求 Authorized JavaScript origins，填 `<SITE_ORIGIN>`（`wrangler.jsonc` 的 `vars.SITE_ORIGIN`）。

5. 若 OAuth app 處於 Testing，在 test users 加入兩個實測 Google 帳號。本功能只使用 `openid email profile`，不要求 Drive 或 Gmail 權限。
6. 以 Worker secrets 設定（`npx wrangler secret put <NAME>`）：

   - `AUTH_GOOGLE_ID`：Google Client ID。
   - `AUTH_GOOGLE_SECRET`：Google Client Secret。
   - `AUTH_SECRET`：以 `openssl rand -base64 33` 產生；之後不要隨意更換，否則所有 session 失效。

   `SITE_ORIGIN` 不是 secret，寫在 `wrangler.jsonc` 的 `vars`，不加路徑。

7. `wrangler secret put` 會立即套用到已部署的 Worker；改 `vars` 則要重新 `npm run deploy`。
8. Google credentials 缺少時，登入按鈕停用，API 不會降級成匿名文件儲存。

**不要將 Client Secret 貼到聊天、commit 到 Git，或放進 public/。**

Google 官方說明：https://developers.google.com/identity/protocols/oauth2/web-server
Auth.js Google：https://authjs.dev/getting-started/providers/google
Auth.js D1：https://authjs.dev/getting-started/adapters/d1

## 部署到 Cloudflare

第一次部署：

```sh
npx wrangler login
npx wrangler d1 create swagger-yaml-workbench   # 把輸出的 database_id 填進 wrangler.jsonc
npx wrangler r2 bucket create swagger-yaml-workbench
# 把 wrangler.jsonc 的 SITE_ORIGIN 改成實際網址（workers.dev 子網域或自訂網域），再完成上方 Google OAuth 設定
npx wrangler secret put AUTH_GOOGLE_ID
npx wrangler secret put AUTH_GOOGLE_SECRET
npx wrangler secret put AUTH_SECRET
npm run deploy
```

之後每次部署只要 `npm run deploy`：先對正式 D1 套用尚未執行的 migrations，再由 `wrangler deploy` 執行 `npm run build` 並上傳 `dist/server/index.js`。

## 本機執行

Node.js 24 建議。

```sh
npm ci
cp .env.example .env
npm run build
npm run dev
```

開啟 http://localhost:4173 。本機登入請將 `.env` 的三個 AUTH 值補齊，Google OAuth client 另加 `http://localhost:4173/api/auth/callback/google`。本機與正式資料庫分開。

`npm run dev` 使用 Miniflare 模擬 D1/R2，資料保存在忽略提交的 `.sites-runtime/`（目錄名沿用舊名，與 Sites 平台無關）。修改程式後重新 build、重啟 dev。請勿用 `python -m http.server`，它不提供登入或文件 API。

## 測試

```sh
npm run build
npm test
npm audit --omit=dev
```

測試使用真正的 Auth.js D1 adapter 與持久化 Miniflare D1/R2，但直接建立測試 session；**不代表已完成 Google OAuth 實際登入**。涵蓋匿名／偽造 user id 拒絕、三種來源新增、metadata、跨帳號 list/read/delete、CSRF、無效文件／大小上限、重新啟動持久化、新 session 還原歷史、刪除資料與 R2 內容、登出撤銷 session、缺少設定時拒絕登入。

`node tests/browser-preview.mjs` 提供僅限 loopback 的本機 QA。`/__qa` 可選兩個假資料帳號，驗證頁面操作。這個測試程式不會被打包／發布；正式 Worker 沒有 QA 登入入口。使用前先停止其他占用 4173 的 dev server。

自動測試使用獨立測試 session。`tests/oauth.test.mjs` 另外模擬完整 Google OAuth 回呼及錯誤路徑，不能取代 Google 實際登入驗證。

## 程式結構

- `src/main.jsx`、`src/App.jsx`：React 入口與主畫面。
- `src/components/`：登入列、YAML 編輯區、文件歷史與 Swagger 預覽元件。
- `src/hooks/useWorkbench.js`：登入、編輯、匯入、保存、歷史開啟與刪除流程。
- `src/lib/`：API client、YAML / OpenAPI 解析及錯誤格式。
- `public/`：HTML 入口、原 CSS、Swagger UI vendor 與授權。`app.js` 由建置產生，不直接編輯。
- `worker/auth.js`：Google Provider、D1 session、固定來源與身份驗證。
- `worker/documents.js`：文件 CRUD、ownership、D1 metadata、R2 內容。
- `worker/index.js`：HTTP 路由、Origin 驗證與公開資源。
- `db/schema.ts`、`drizzle/`：可追蹤的 schema 及 migrations。
- `scripts/build.mjs`：產生 Worker ESM（內含前端與 `public/`）。
- `wrangler.jsonc`：Worker 名稱、`SITE_ORIGIN` 與 D1 / R2 bindings。

正式 migrations 由 `npm run deploy`（`wrangler d1 migrations apply DB --remote`）套用，紀錄在 D1 的 `d1_migrations` 表。不要修改已套用 migrations；schema 後續修改請新增 migration。

外部 $ref 與 Try it out 會連至文件指定網址，仍受 CORS 限制。Google 登入只識別使用者，不會替你授權文件中的第三方 API。

## 2026-10-04 Code review 修正

- 共用 `shared/openapi.js`，前端預覽與後端保存使用同一組檢查；拒絕循環 YAML alias，限制展開深度、節點及文字量，正常 alias 與 OpenAPI `$ref` 保留。
- 只修改分類時不重送未變更的名稱，避免原 API title 長於 200 字而無法分類。
- 驗證實際存在的日期和日期範圍；日期轉換例外進入錯誤提示，避免視窗崩潰。
- 無效 UTF-8 回傳 400；設定 API 在串流讀取時套用 16 KiB 上限。
- 所有 workbench 請求共用 session 失效邊界，登入過期或登出後忽略之前較慢回來的私人資料。
- 27 項自動測試通過；正式依賴 `npm audit --omit=dev` 為 0 個已知漏洞。本次未變更資料庫 schema 或 Google OAuth 設定。

## 版本歷史與匯出

- 開啟文件後「儲存新版本」會保留原始內容、檔名、API 標題、時間及選填說明。「另存為新文件」仍建立獨立紀錄；貼上、上傳、範例匯入維持新增文件。
- 預覽上方「版本歷史」可分頁讀取、檢視、選擇任意兩版逐行比較，以及將舊版還原為新版本。摘要只比較端點/API 版本，不能當成完整破壞性變更檢查。
- 版本為 D1 metadata + 不可變的獨立 R2 object。舊文件第一次使用版本功能時，保留其原 object 作為 v1；migration 僅新增 schema，不改寫既有文件。
- 儲存與還原須提供目前版本，D1 原子批次檢查版本號。競爭寫入回傳 409，保留編輯內容。刪除文件會刪除全部歷史版本與 blobs。
- API：GET /api/documents/:id/versions?offset=0、GET /api/documents/:id/versions/:version、PUT /api/documents/:id/content（x-expected-version、選填 x-version-note）、POST /api/documents/:id/restore（version、expectedVersion）。全部依登入 session 檢查 ownership，寫入驗證 Origin。
- 「下載／匯出」匯出目前已呈現的預覽；未套用的編輯不包含在內。版本視窗可下載所選歷史版本。原始檔逐字保留註解與格式；JSON 由解析後定義產生；HTML 為自包含唯讀文件，含端點、模型與完整 JSON，沒有遠端 scripts、CDN、網路請求或 API 執行功能。外部 refs 保留文字，未下載內容。
- 大於合計 800,000 字元或 12,000 行、超過差異計算上限的比較會提示下載後本機比較。版本原始內容畫面最多顯示 500,000 字元，下載保留完整檔案。
- 新增 0002 migration；既有 migrations 不變。測試涵蓋舊文件初始版本、並行寫入、還原、跨帳號版本拒絕、重啟保存、完整刪除及匯出注入防護。

## 分享區

- 導覽列「分享區」讓所有訪客搜尋及唯讀瀏覽明確發布的文件。獨立網址使用 `/?share=<publication-id>`；分享區使用 `/?view=shared`。未發布文件保持私人。
- 擁有者開啟自己的文件後，按「發布到分享區」，選擇已儲存版本、公開標題及選填說明，確認完整內容後發布。公開資料包含所選版本的原始 YAML/JSON 和檔名；不包含私人文件 ID、分類、其他版本、版本備註或 Google 個人資料。
- 公開內容固定指向不可變版本。後續儲存、還原或修改私人名稱不會自動改動公開資料；再次按「更新分享內容」才會更新，連結保持相同。
- 撤下會使原連結失效；重新發布會建立新連結。删除或 tombstone 文件時，分享立即無法讀取，正常刪除完成後 publication metadata 一併移除。撤下不能收回讀者已儲存的副本。
- GET `/api/shared`（q、offset）、GET `/api/shared/:publicationId` 可匿名讀取，回應明確列出公開欄位且 no-store。分享頁停用 API Try it out，提供既有三種匯出格式。
- GET/PUT/DELETE `/api/documents/:id/publication` 必須通過 session ownership；PUT 要求 version、title、選填 summary 及 confirmPublic=true。新增/更新 SQL 本身再次驗證該版本與文件 ownership、未刪除狀態；所有寫入保留 Origin 檢查。既有私人文件與版本 API 維持 owner-only。
- 0003 migration 僅新增 publications 表與索引，不會將既有文件公開。33 項自動測試涵蓋主動發布、指定版本、私人資料拒絕、撤下、重新發布、重啟保存與文件刪除連動。

## Editor workspace

The workspace now uses CodeMirror 6 for YAML/JSON editing and the existing Swagger UI renderer for a debounced (350 ms) live preview. It includes line numbers, folding, key suggestions for YAML, find/replace, undo/redo, wrapping, resizable panes, and YAML/JSON conversion. Conversion prompts before discarding comments and can be undone.

Validation runs official OpenAPI structure schemas plus semantic checks in a browser Worker and on formal saves in the API, with clickable YAML/JSON source locations. Invalid edits retain the last valid preview, marked as stale. Private cloud saves remain explicit versions; valid paste/import/upload creates a new document as before. Publishing continues to select an immutable saved version. No auth configuration or external code-generation service is required.

Editor controls support keyboard interaction: Cmd/Ctrl+Enter saves, Cmd/Ctrl+F searches, and the focused pane separator responds to arrow keys, Home and End. On narrow screens the split layout stacks; Edit and Preview controls can show one pane at a time.


## Sharing permissions, cloud drafts and validation (v12)

- Share dialog offers private, unlisted (anyone with the link), and public gallery visibility. Expiry is checked in server SQL on every anonymous read/list. Audience changes, manual rotation, and renewing an expired publication replace its random link ID. Revocation removes access. Previously downloaded copies cannot be recalled. Migration 0004 preserves existing publications as public with no expiry; private documents remain private.
- Migration 0005 adds account-owned draft metadata in D1; unfinished source is stored in R2. Authenticated editing autosaves after 800 ms. Restore/discard choices appear when a cloud draft differs from the opened saved version. Formal saves remain explicit; drafts never become public. Revision checks reject stale writes/deletes, and a tombstone revision prevents a stale tab from recreating a discarded draft. Document deletion removes its draft and source. Guest edits are not cloud-saved. Network failures are shown with retry/download options; wait for the saved status before closing. The editor warns before leaving with unsynced content.
- Trusted Swagger 2.0 / OpenAPI 3.0 / 3.1 structure schemas and the JSON Schema 2020-12 metaschema are precompiled at build time. No runtime eval or document upload to an external validator occurs. Schema checks are supplemented by internal reference, operation ID, path-template/parameter and security-scheme checks. Browser validation runs in a dedicated Worker. Both API formal writes and the editor reject errors; drafts accept incomplete text.
- External references, references scoped by independent `$id`, and custom JSON Schema dialects are explicitly marked unverified warnings. No claim is made that their remote contents or examples match their schemas. Invalid legacy documents remain readable. Only the first 100 validation diagnostics are displayed.
- New development checkouts must run `npm ci` then `npm run build` before `npm test`; the build generates the ignored standalone validators. Existing applied migration files are unchanged.

### 版本比較與 Mock API

- 版本歷史的比較基準提供參數、Request／Response、Schema、授權與伺服器變動摘要，可篩選可能不相容、待確認、一般變更。這是規則式輔助審查，並非完整相容性證明；外部參照／複雜規格會警示，最多顯示 500 項摘要，逐行比較仍保留。
- 文件預覽的「Mock API」可選擇已儲存版本，確認回應資料可分享後啟用，期限為 1／7／30 天。URL 為 `/mock/<隨機識別碼>` 加 OpenAPI paths 中的路徑，不需 servers/basePath 前綴。Mock 不列入分享區；持有 URL 的人皆可使用，與文件分享的撤銷分開管理。更新會換發 URL；停用、到期、刪除文件立即失效。
- Mock 優先使用 response/media example 或具名 examples，其次產生有界限的 Schema 示意資料；支援 Swagger 2 與 OpenAPI 3 的本地 JSON Pointer。`?__status=404&__example=name` 可選擇狀態與具名例子。支援 JSON、text/plain、空回應及 CORS（不允許攜帶跨站 credentials）。
- Mock 不呼叫 upstream、不保存請求、沒有狀態性 CRUD，也不執行規格中的授權。不要傳入真實 token 或個資。外部參照、外部例子、二進位、串流不支援；Schema 產物不保證符合所有 pattern、組合、唯一性與範圍限制。回應上限 256 KB，生成深度 12、節點 1000、陣列最多 5 筆。
- 所有 Mock 管理 API 驗證登入、文件 ownership 與 Origin；對外 Mock 只讀指定不可變版本，不提供文件、私人歷史或帳號資料 API。

## 內容搜尋、風格檢查、型別匯出、變更紀錄與 Mock 驗證

- 「我的文件」搜尋除名稱與檔名外，也比對目前版本的路徑、operationId、tag、Schema 名稱與摘要，並在結果顯示命中的項目。索引在儲存與還原時寫入 `documents.search_text`（migration 0007，僅新增欄位）；較早儲存的文件第一次開啟時補建索引。搜尋文字不可包含控制字元。
- 編輯區新增風格建議（info 等級）：operationId、summary、tags、tag 宣告、成功回應、路徑命名等。風格建議不阻擋儲存或預覽，也不在 API 正式儲存時檢查。可在「風格規則」逐條關閉，設定保存在目前瀏覽器。
- 「下載／匯出」新增 TypeScript 型別（.d.ts）：具名 Schema 轉為 `export type`，各端點的參數、Request Body 與回應整理在 `paths` 介面。format、pattern 等執行期限制不會轉換。
- 版本比較可複製或下載 Markdown 變更紀錄，依「可能不相容／需要人工確認／一般變更」分組。分享頁只公開所選版本，因此不顯示變更紀錄。
- Mock 依規格驗證請求：path／query／header 參數與 JSON Request Body 的型別、必填、enum、長度、範圍、額外欄位。不符合時回應 400 與 issues 清單。不檢查 format 與 pattern（避免規格中的正規表示式拖慢 Worker），請求內容上限 256 KB，只在記憶體中檢查、不保存。
- Mock 查詢參數：`__validate=off` 關閉驗證；`__delay=毫秒`（0–5000）延遲回應；`__fail=0–1` 以機率回應錯誤，`__failStatus=400–599` 指定錯誤狀態碼（預設 500）。Mock 視窗可填寫 Query 與 Request Body，Body 會依 Schema 預填示範值。
