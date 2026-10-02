# Swagger YAML Viewer

既有 Site：https://swagger-yaml-workbench-stan.tonytonitone6.chatgpt.site/

沿用原站 Swagger UI、YAML / JSON 解析與版面。支援 Swagger 2.0、OpenAPI 3.0 / 3.1、5 MB 檔案、貼上、拖曳、範例匯入、Authorize 與 Try it out。

## 新增功能

- Google 登入：Auth.js Core + Google Provider + 官方 D1 adapter，資料庫 session。
- 使用者登入後，每次上傳、貼上有效的 YAML 或按儲存／載入範例，都建立獨立紀錄。
- D1 保存 title、fileName、sourceType、createdAt、updatedAt 及擁有者；R2 保存原始內容。
- 個人歷史可分頁、重新整理、重新開啟、刪除。重新開啟不會新增紀錄，編輯後儲存會新增。
- 未登入可使用原有預覽；介面會明確提示未儲存。個人文件 API 拒絕匿名存取。
- 查詢、讀取、刪除使用由伺服器驗證的 session user id；R2 存取前必須通過 D1 ownership 查詢。忽略客戶端傳入的 user id。
- 寫入及刪除驗證 Origin，Auth.js 處理 CSRF、state、PKCE、nonce、Google 回傳身份。只允許 email_verified 的 Google 帳號。
- 刪除先以 tombstone 隱藏紀錄，再刪 R2、D1；R2 失敗時仍不可讀取該紀錄，可重試 DELETE 完成清理。

## Google OAuth 設定（正式登入前必做）

此專案不是 Next.js，因此直接使用 Web Request / Response 相容的 Auth.js Core，搭配 Sites Worker。

1. 在 Google Cloud / Google Auth Platform 建立或選擇專案，設定 OAuth consent screen 的 app 名稱、聯絡 email、audience。
2. 建立 OAuth client，Application type 選 **Web application**。
3. Authorized redirect URI 必須完全一致：

   `https://swagger-yaml-workbench-stan.tonytonitone6.chatgpt.site/api/auth/callback/google`

4. 如 Google Console 要求 Authorized JavaScript origins，填：

   `https://swagger-yaml-workbench-stan.tonytonitone6.chatgpt.site`

5. 若 OAuth app 處於 Testing，在 test users 加入兩個實測 Google 帳號。本功能只使用 `openid email profile`，不要求 Drive 或 Gmail 權限。
6. 在原 Site 的 Settings → runtime environment / secrets 設定：

   - `AUTH_GOOGLE_ID`：Google Client ID。
   - `AUTH_GOOGLE_SECRET`：Google Client Secret，必須設為 secret。
   - `AUTH_SECRET`：已由本次工作建立為 Site secret；不包含在此程式庫中，不要在後續部署隨意更換。
   - `SITE_ORIGIN`：已設定為上述正式來源，不加路徑。

7. 更新 Site secrets 後，需要重新部署 saved version 才會使用新設定。
8. Google credentials 缺少時，登入按鈕停用，API 不會降級成匿名文件儲存。

**不要將 Client Secret 貼到聊天、commit 到 Git，或放進 public/。**

Google 官方說明：https://developers.google.com/identity/protocols/oauth2/web-server
Auth.js Google：https://authjs.dev/getting-started/providers/google
Auth.js D1：https://authjs.dev/getting-started/adapters/d1

## 本機執行

Node.js 24 建議。

```sh
npm ci
cp .env.example .env
npm run build
npm run dev
```

開啟 http://localhost:4173 。本機登入請將 `.env` 的三個 AUTH 值補齊，Google OAuth client 另加 `http://localhost:4173/api/auth/callback/google`。本機與正式資料庫分開。

`npm run dev` 使用 Miniflare 模擬 D1/R2，資料保存在忽略提交的 `.sites-runtime/`。修改程式後重新 build、重啟 dev。請勿用 `python -m http.server`，它不提供登入或文件 API。

## 測試

```sh
npm run build
npm test
npm audit --omit=dev
```

測試使用真正的 Auth.js D1 adapter 與持久化 Miniflare D1/R2，但直接建立測試 session；**不代表已完成 Google OAuth 實際登入**。涵蓋匿名／偽造 user id 拒絕、三種來源新增、metadata、跨帳號 list/read/delete、CSRF、無效文件／大小上限、重新啟動持久化、新 session 還原歷史、刪除資料與 R2 內容、登出撤銷 session、缺少設定時拒絕登入。

`node tests/browser-preview.mjs` 提供僅限 loopback 的本機 QA。`/__qa` 可選兩個假資料帳號，驗證頁面操作。這個測試程式不會被打包／發布；正式 Worker 沒有 QA 登入入口。使用前先停止其他占用 4173 的 dev server。

正式 Google Login 及兩個真實 Google 帳號的完整驗證，須完成上述 OAuth secrets 設定後進行。

## 程式結構

- `public/`：原 UI、瀏覽器解析、Swagger UI、歷史介面；保留原 vendor 與授權。
- `worker/auth.js`：Google Provider、D1 session、固定來源與身份驗證。
- `worker/documents.js`：文件 CRUD、ownership、D1 metadata、R2 內容。
- `worker/index.js`：HTTP 路由、Origin 驗證與公開資源。
- `db/schema.ts`、`drizzle/`：可追蹤的 schema 及 migrations。
- `scripts/build.mjs`：產生 Worker ESM、metadata 與 migrations。
- `.openai/hosting.json`：原 Site id 與 Sites 管理的 D1 / R2 bindings。

正式 migrations 由 Sites 發布流程套用。不要修改已套用 migrations；schema 後續修改請新增 migration。

外部 $ref 與 Try it out 會連至文件指定網址，仍受 CORS 限制。Google 登入只識別使用者，不會替你授權文件中的第三方 API。
