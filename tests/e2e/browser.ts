// End-to-end UI regression run against the local QA server and headless Chrome. Not part of `npm test`.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ORIGIN = 'http://localhost:4173';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const QA_SERVER = 'tests/browser-preview.ts';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type CdpResponse = { id: number; result?: any; error?: { message: string } };
const results: string[] = [];
let failures = 0;
const check = (ok: unknown, label: string) => { results.push((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failures++; };

const work = await mkdtemp(path.join(tmpdir(), 'workbench-e2e-'));
const downloads = path.join(work, 'downloads');
await rm('.sites-runtime/library-qa', { recursive: true, force: true });
const server: ChildProcess = spawn(process.execPath, [QA_SERVER], { stdio: 'ignore' });
const chrome: ChildProcess = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${path.join(work, 'profile')}`, '--window-size=1440,1000', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const stop = async () => { chrome.kill(); server.kill(); await sleep(300); await rm(work, { recursive: true, force: true }); await rm('.sites-runtime/library-qa', { recursive: true, force: true }); };

let page: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await (await fetch('http://127.0.0.1:9333/json/list')).json() as any[]).find(t => t.type === 'page'); } catch { await sleep(200); }
}
for (let i = 0; i < 60; i++) { try { await fetch(ORIGIN + '/__qa'); break; } catch { await sleep(200); } }
if (!page) throw new Error('Chrome did not start; set CHROME_PATH.');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener('open', resolve));
let seq = 0;
const waiting = new Map<number, (message: CdpResponse) => void>();
const pageErrors: string[] = [];
ws.addEventListener('message', event => {
  const message = JSON.parse(String(event.data));
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)!(message); waiting.delete(message.id); }
  if (message.method === 'Page.javascriptDialogOpening') ws.send(JSON.stringify({ id: ++seq, method: 'Page.handleJavaScriptDialog', params: { accept: true } }));
  if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
});
const send = (method: string, params: object = {}) => new Promise<CdpResponse>((resolve, reject) => {
  const id = ++seq, timer = setTimeout(() => { waiting.delete(id); reject(new Error('CDP timeout: ' + method)); }, 20000);
  waiting.set(id, message => { clearTimeout(timer); resolve(message); }); ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate<T = any>(expression: string): Promise<T> {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.exception?.description || response.result.exceptionDetails.text);
  return response.result.result.value;
}
async function until(expression: string, label: string, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) if (await evaluate(expression)) return true;
  throw new Error('timed out waiting for: ' + label);
}
const helpers = `
  window.byText = (selector, text) => [...document.querySelectorAll(selector)].find(el => el.textContent.includes(text));
  window.setInput = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };
  window.editorView = () => document.querySelector('.cm-content').cmTile.root.view;
  window.api = async (p, o = {}) => { const r = await fetch(p, o); return { status: r.status, body: await r.json().catch(() => null) }; };
  window.confirm = () => true;`;
async function go(url: string) {
  await send('Page.navigate', { url: ORIGIN + url });
  await sleep(300);
  await until('document.readyState === "complete"', 'load ' + url);
  await evaluate(helpers);
}
const text = (selector: string) => evaluate<string>(`document.querySelector(${JSON.stringify(selector)})?.textContent || ''`);
const click = (selector: string, label: string) => evaluate(`byText(${JSON.stringify(selector)}, ${JSON.stringify(label)}).click()`);
const settle = () => sleep(400);
async function typeAtEnd(value: string) {
  await evaluate('(() => { const view = editorView(); view.focus(); view.dispatch({ selection: { anchor: view.state.doc.length } }); })()');
  await send('Input.insertText', { text: value });
}
const ready = () => until('!!document.querySelector("#render") && !document.querySelector("#render").disabled', 'workbench idle');

const yaml = `openapi: 3.0.3
info:
  title: E2E Orders
  version: 1.0.0
tags:
  - name: orders
paths:
  /orders/{orderId}:
    parameters:
      - { in: path, name: orderId, required: true, schema: { type: integer, minimum: 1 } }
    get:
      operationId: get_order
      tags: [orders]
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
  /orders:
    post:
      operationId: createOrder
      summary: Create order
      tags: [orders]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/Order' }
      responses:
        '201':
          description: created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Order' }
components:
  schemas:
    Order:
      type: object
      required: [quantity]
      properties:
        id: { type: integer, readOnly: true }
        quantity: { type: integer, minimum: 1 }
`;

try {
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Browser.grantPermissions', { origin: ORIGIN, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });

  await go('/');
  await until('!!document.querySelector("#sign-in")', 'anonymous view');
  check((await text('#status')).includes('已載入 3 個 API 端點'), 'anonymous: example preview loaded');
  check(await evaluate('!!document.querySelector("#swagger-ui .opblock")'), 'anonymous: Swagger UI rendered');

  await go('/__qa/alice');
  await until('!!document.querySelector(".account-label")', 'signed in as Alice');
  check((await text('.account-label')).includes('Alice'), 'login: account menu shows Alice');
  await ready();

  await evaluate(`(() => { const view = editorView(); view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } }); const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(yaml)}); view.contentDOM.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); })()`);
  await until('document.querySelector("#status")?.textContent.includes("已儲存 v1")', 'paste saved as v1');
  const id = await evaluate<string>('new URLSearchParams(location.search).get("doc")');
  check(/^[a-f0-9-]{36}$/.test(id || ''), 'paste: creates a document and puts its id in the URL');
  check((await text('.draft-label')).includes('已儲存 v1'), 'paste: file bar shows saved v1');

  await ready();
  await typeAtEnd('# e2e draft line\n');
  await until('document.querySelector(".draft-label")?.textContent.includes("未儲存")', 'edit marks dirty');
  check((await text('#status')).includes('未儲存的變更'), 'typing: status reports unsaved changes');
  await until('document.querySelector(".draft-status")?.textContent.includes("草稿已保存至帳號")', 'draft autosaved', 8000);
  check(true, 'typing: cloud draft autosaved');

  await go('/?doc=' + id);
  await until('!!byText("button", "恢復草稿")', 'draft recovery prompt');
  check(true, 'reload: recovery prompt for the unsaved draft');
  await click('button', '恢復草稿');
  await until('editorView().state.doc.toString().includes("# e2e draft line")', 'draft restored');
  check((await text('#status')).includes('已恢復'), 'recover: editor restored from the cloud draft');

  await ready();
  await evaluate('setInput(document.querySelector("input[aria-label=\'版本說明\']"), "e2e note")');
  await click('#render', '儲存新版本');
  await until('document.querySelector("#status")?.textContent.includes("已儲存 v2")', 'saved v2');
  check(true, 'save: creates v2');
  await go('/?doc=' + id);
  await ready(); await settle();
  check(await evaluate('!byText("button", "恢復草稿")'), 'save: the cloud draft is cleared after saving');
  check(await evaluate('editorView().state.doc.toString().includes("# e2e draft line")'), 'save: reopened document has the saved text');

  const external = await evaluate<{ status: number }>(`api('/api/documents/${id}/content', { method: 'PUT', headers: { 'content-type': 'text/plain', 'x-expected-version': '2' }, body: ${JSON.stringify(yaml + '# other tab\n')} })`);
  check(external.status === 201, 'conflict setup: another writer saved v3');
  await typeAtEnd('# stale edit\n');
  await until('!document.querySelector("#render").disabled', 'save enabled');
  await click('#render', '儲存新版本');
  await until('document.querySelector("#error")?.textContent.includes("新版本")', 'conflict error');
  check(true, 'conflict: stale save is rejected with a 409 message and the edit is kept');
  check(await evaluate('editorView().state.doc.toString().includes("# stale edit")'), 'conflict: editor keeps the unsaved edit');

  await go('/?doc=' + id);
  await until('!!byText("button", "捨棄草稿") || !!document.querySelector("#render")', 'reopened');
  if (await evaluate('!!byText("button", "捨棄草稿")')) { await click('button', '捨棄草稿'); await settle(); }
  await ready();
  await until('!!byText("button", "版本歷史 · v3")', 'version history v3');
  await click('button', '版本歷史');
  await until('!!byText(".version-item", "v1")', 'versions listed');
  check(await evaluate('[...document.querySelectorAll(".version-item")].map(b => b.textContent).join("|").includes("e2e note")'), 'history: version note is listed');
  await click('.version-item', 'v1');
  await until('!!byText("button", "還原此版本") && !byText("button", "還原此版本").disabled', 'restore enabled');
  await click('button', '還原此版本');
  await click('button', '確認還原');
  await until('document.querySelector("#status")?.textContent.includes("已將 v1 還原為 v4")', 'restored');
  check(true, 'restore: v1 restored as v4');
  check(await evaluate('!editorView().state.doc.toString().includes("# e2e draft line")'), 'restore: editor shows the restored content');

  await ready();
  check((await text('.validation-summary')).includes('風格建議'), 'style: suggestions shown');
  await evaluate('setInput(document.querySelector(".document-toolbar select[aria-label=\'下載目前預覽\']"), "typescript")'); await sleep(800);
  check((await readdir(downloads).catch(() => [])).some(f => f.endsWith('.d.ts')), 'export: TypeScript declarations downloaded');

  await click('.editor-tools button', '大綱');
  await until('document.querySelectorAll(".outline-item").length >= 3', 'outline built');
  check(await evaluate('!!byText(".outline-item", "POST /orders")'), 'outline: lists operations');
  await evaluate('setInput(document.querySelector(".outline-panel input"), "Order")'); await settle();
  check(await evaluate('[...document.querySelectorAll(".outline-item")].every(b => b.textContent.includes("Order") || b.textContent.includes("order"))'), 'outline: filter narrows the list');
  await click('.outline-item', 'Schema');
  await sleep(200);
  check(await evaluate('(() => { const v = editorView(); return v.state.doc.lineAt(v.state.selection.main.head).text.trim().startsWith("Order:"); })()'), 'outline: clicking a schema jumps to its line');
  await click('.editor-tools button', '大綱');

  await click('.document-actions button', '程式碼範例');
  await until('!!document.querySelector(".snippet-output")', 'snippets dialog');
  check((await text('.snippet-output')).startsWith('curl -X GET'), 'snippets: curl for the first endpoint');
  await evaluate(`(() => { const d = document.querySelector("dialog[aria-label='程式碼範例']"); const [endpoint, language] = d.querySelectorAll("select"); setInput(endpoint, [...endpoint.options].find(o => o.value.startsWith("POST")).value); setInput(language, "python"); })()`); await settle();
  check((await text('.snippet-output')).includes('requests.request(') && (await text('.snippet-output')).includes('"quantity"'), 'snippets: Python request with a sample body');
  await click('dialog[aria-label="程式碼範例"] .close-button', '×'); await settle();

  const beforeFormat = await evaluate<string>('editorView().state.doc.toString()');
  await click('.editor-tools button', '整理格式');
  await until('!!document.querySelector("dialog[aria-label=\'整理格式\']")', 'format dialog');
  await evaluate('[...document.querySelectorAll("dialog[aria-label=\'整理格式\'] input")][1].click()'); await settle();
  await click('dialog[aria-label="整理格式"] button.primary', '整理格式');
  await until('document.querySelector(".draft-label")?.textContent.includes("未儲存")', 'formatted');
  check(await evaluate('editorView().state.doc.toString().startsWith("openapi:")'), 'format: document reformatted in place');
  await evaluate('document.querySelector(".editor-tools button[title^=\'復原\']").click()'); await settle();
  await until('editorView().state.doc.toString() === ' + JSON.stringify(beforeFormat), 'undo restores the original text');
  check(true, 'format: undo restores the original text');
  await go('/?doc=' + id); await until('!!byText("button", "捨棄草稿") || !!document.querySelector("#render")', 'reopen after format');
  if (await evaluate('!!byText("button", "捨棄草稿")')) { await click('button', '捨棄草稿'); await settle(); }
  await ready();

  await click('button', '我的文件');
  await until('!!document.querySelector(".library-filters")', 'library open');
  await until('!!byText(".document-name button", "E2E Orders")', 'library lists the document');
  await evaluate('setInput(document.querySelector("input[aria-label=\'新分類名稱\']"), "E2E 分類")'); await settle();
  await click('button', '新增分類');
  await until('!!byText("[role=status]", "已新增分類")', 'category created');
  await evaluate('document.querySelector(".row-actions .text-button").click()');
  await until('!!document.querySelector("dialog[aria-label=\'編輯文件資料\']")', 'edit dialog');
  await evaluate(`(() => { const d = document.querySelector("dialog[aria-label='編輯文件資料']"); setInput(d.querySelector("input"), "Renamed E2E"); const s = d.querySelector("select"); setInput(s, [...s.options].find(o => o.textContent === "E2E 分類").value); })()`); await settle();
  await click('dialog[aria-label="編輯文件資料"] button', '儲存變更');
  await until('!!byText(".document-name button", "Renamed E2E") && !!byText(".category-chip", "E2E 分類")', 'renamed and categorized');
  check(true, 'library: rename and categorize');
  await evaluate('setInput(document.querySelector(".library-filters input[type=search]"), "createorder")'); await settle();
  await click('.library-filters button', '套用篩選');
  await until('!!document.querySelector(".search-matches")', 'content search');
  check((await text('.search-matches')).includes('operationId createOrder'), 'library: content search shows the match');
  await click('.category-row .danger-text', '移除');
  await until('!!byText("[role=status]", "分類已移除")', 'category removed');
  check(await evaluate('!!byText(".category-chip", "未分類")'), 'library: removing a category keeps the document uncategorized');
  await click('dialog[aria-label="我的文件"] .close-button', '×'); await settle();

  await ready();
  await click('button', '分享權限');
  await until('!!document.querySelector(".share-form select")', 'share dialog');
  await evaluate('setInput(document.querySelector(".share-form select"), "public")'); await settle();
  await until('!!document.querySelector(".share-form .share-consent input:not([disabled])")', 'share version loaded');
  await evaluate('[...document.querySelectorAll(".share-form .share-consent input")].at(-1).click()'); await settle();
  await click('.share-form button.primary', '儲存分享設定');
  await until('!!byText("[role=status]", "已發布 v4 至分享區")', 'published');
  check(true, 'share: published v4 publicly');
  await click('dialog[aria-label="分享權限"] .close-button', '×'); await settle();
  await click('.workspace-nav button', '分享區');
  await until('!!byText(".shared-card h2", "E2E Orders")', 'shared listing');
  check(true, 'share: listed in the shared area');
  await click('.shared-card h2 a', 'E2E Orders');
  await until('!!document.querySelector(".shared-meta") && !!document.querySelector("#swagger-ui .opblock")', 'shared document view');
  check((await text('.shared-meta')).includes('v4'), 'share: shared page shows the published version');
  await click('.workspace-nav button', '工作台'); await ready();

  await evaluate('document.querySelector(".account-menu").open = true');
  await evaluate('setInput(document.querySelector("#theme-select"), "light")');
  await until('document.documentElement.dataset.theme === "light" && !document.querySelector("#theme-select").disabled', 'theme light');
  await evaluate('localStorage.clear()');
  await go('/?doc=' + id); await ready();
  await until('document.querySelector("#theme-select")?.value === "light" && document.documentElement.dataset.theme === "light"', 'theme restored from account');
  check(true, 'theme: preference restored from the account after clearing local storage');

  await click('button', 'Mock API');
  await until('!!byText("button", "啟用 Mock API") && !document.querySelector(".mock-consent input").disabled', 'mock dialog');
  await evaluate('document.querySelector(".mock-consent input").click()'); await settle();
  await click('button', '啟用 Mock API');
  await until('!!byText("strong", "已啟用")', 'mock enabled');
  await evaluate(`(() => { const s = byText("label", "測試端點").querySelector("select"); setInput(s, [...s.options].find(o => o.value.startsWith("POST /orders")).value); })()`);
  await until('!!document.querySelector("textarea.mock-body")', 'mock body');
  await evaluate('setInput(document.querySelector("textarea.mock-body"), "{\\"quantity\\":0}")'); await settle();
  await click('button', '實際呼叫 Mock');
  await until('!!byText("[role=status] strong", "實際回應")', 'mock call');
  check((await evaluate<string>('byText("[role=status] strong", "實際回應").parentElement.textContent')).includes('HTTP 400'), 'mock: invalid request rejected by the live mock');
  await click('dialog[aria-label="Mock API"] .close-button', '×'); await settle();

  await send('Network.deleteCookies', { name: 'authjs.session-token', url: ORIGIN });
  await click('button', '我的文件');
  await until('!!document.querySelector("#sign-in")', 'session expiry resets the view');
  check(await evaluate('!document.querySelector("dialog[open]")'), 'session expiry: private dialogs close and the sign-in button returns');
  check((await evaluate<string>('location.search')) === '', 'session expiry: private document id removed from the URL');

  await go('/__qa/bob');
  await until('!!document.querySelector(".account-label")', 'signed in as Bob');
  await ready();
  await click('button', '我的文件');
  await until('!!document.querySelector(".library-empty")', 'Bob library empty');
  check(true, "isolation: Bob cannot see Alice's documents");
  await click('dialog[aria-label="我的文件"] .close-button', '×');

  await go('/?view=shared');
  await until('!!byText(".shared-card h2", "E2E Orders")', 'shared listing for others');
  check(true, 'share: other accounts see the public document');

  await go('/?doc=' + id);
  await until('!!document.querySelector("#error") || !!document.querySelector("#render")', 'foreign doc');
  await settle();
  check((await evaluate<string>('editorView().state.doc.toString()')).includes('Petstore'), "isolation: opening Alice's document id as Bob shows the example instead");

  await go('/__qa/alice'); await ready();
  await click('button', '我的文件');
  await until('!!byText(".document-name button", "Renamed E2E")', 'library for delete');
  await click('.row-actions .danger-text', '刪除');
  await until('!!document.querySelector(".library-empty")', 'deleted');
  check(true, 'delete: document removed from the library');
  await click('dialog[aria-label="我的文件"] .close-button', '×'); await settle();
  const shared = await evaluate<{ body: { publications: unknown[] } }>(`api('/api/shared?q=E2E')`);
  check(shared.body.publications.length === 0, 'delete: the public share disappears with the document');

  await evaluate('document.querySelector(".account-menu").open = true');
  await click('#sign-out', '登出');
  await until('!!document.querySelector("#sign-in")', 'signed out');
  check((await text('#status')).includes('已登出'), 'sign-out: status confirms and the private view is cleared');
} catch (error) {
  failures++;
  results.push('ERROR ' + (error as Error).message);
  const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
  if (shot?.result?.data) { await writeFile('.sites-runtime/e2e-error.png', Buffer.from(shot.result.data, 'base64')); results.push('screenshot: .sites-runtime/e2e-error.png'); }
}
console.log(results.join('\n'));
console.log(pageErrors.length ? 'PAGE ERRORS:\n' + pageErrors.join('\n') : 'no page errors');
ws.close(); await stop();
process.exit(failures || pageErrors.length ? 1 : 0);
