'use strict';
const example = `openapi: 3.0.3
info:
  title: Petstore API
  version: 1.0.0
  description: |
    寵物商店 API 範例。展開下方端點，查看參數、回應與資料結構。
    使用左側匯入自己的 YAML，或直接貼上內容後按「更新文件」。
servers:
  - url: https://petstore3.swagger.io/api/v3
    description: Swagger 公開範例伺服器
tags:
  - name: pet
    description: 寵物資料查詢
paths:
  /pet/findByStatus:
    get:
      tags: [pet]
      summary: 依狀態查詢寵物
      operationId: findPetsByStatus
      parameters:
        - name: status
          in: query
          description: 寵物目前的狀態
          required: true
          schema:
            type: string
            enum: [available, pending, sold]
            default: available
      responses:
        '200':
          description: 查詢成功
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Pet'
        '400':
          description: 無效的狀態
  /pet/{petId}:
    get:
      tags: [pet]
      summary: 取得單一寵物資料
      operationId: getPetById
      parameters:
        - name: petId
          in: path
          required: true
          description: 寵物 ID
          schema:
            type: integer
            format: int64
            example: 1
      responses:
        '200':
          description: 查詢成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
        '404':
          description: 找不到寵物
  /pet:
    post:
      tags: [pet]
      summary: 新增一隻寵物
      operationId: addPet
      security:
        - api_key: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Pet'
      responses:
        '200':
          description: 新增成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
components:
  securitySchemes:
    api_key:
      type: apiKey
      in: header
      name: api_key
  schemas:
    Pet:
      type: object
      required: [name, photoUrls]
      properties:
        id:
          type: integer
          format: int64
          example: 10
        name:
          type: string
          example: 小豆
        photoUrls:
          type: array
          items:
            type: string
          example: []
        status:
          type: string
          enum: [available, pending, sold]
          example: available
`;
const $ = id => document.getElementById(id);
const limit = 5 * 1024 * 1024;
let filename = 'petstore-example.yaml';
let readSequence = 0;
let ui;
let user = null;
let sourceType = 'paste';
let busy = false;
let selectedId = null;
let nextOffset = null;
let historySequence = 0;
function reportError(message) {
  $('error').textContent = message;
  $('error').hidden = false;
  $('status').textContent = '尚未更新；右側保留上一份成功載入的文件。';
}
function render() {
  try {
    if (!window.jsyaml || !window.SwaggerUIBundle) throw new Error('文件元件載入失敗，請重新整理頁面。');
    const source = $('source').value;
    if (!source.trim()) throw new Error('請先選擇檔案或貼上 YAML / JSON 內容。');
    if (new Blob([source]).size > limit) throw new Error('檔案過大，請使用 5 MB 以內的文件。');
    const parsed = jsyaml.load(source, { schema: jsyaml.JSON_SCHEMA });
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('API 定義必須是 YAML 或 JSON 物件。');
    if (parsed.swagger !== '2.0' && !/^3\.(0|1)\.\d+$/.test(String(parsed.openapi || ''))) throw new Error('請提供 swagger: "2.0" 或 openapi: 3.0.x / 3.1.x 的文件。');
    if (!parsed.info || typeof parsed.info.title !== 'string' || typeof parsed.info.version !== 'string') throw new Error('文件需要 info.title 與 info.version，且兩者都必須是字串。');
    if ((!parsed.paths || typeof parsed.paths !== 'object' || Array.isArray(parsed.paths)) && !(String(parsed.openapi).startsWith('3.1.') && (parsed.webhooks || parsed.components))) throw new Error('文件需要 paths 物件，例如 paths: {}。');
    let spec;
    try { spec = JSON.parse(JSON.stringify(parsed)); } catch { throw new Error('無法處理循環 YAML alias，請改用 OpenAPI 的 $ref。'); }
    // Replace the root so authentication state cannot leak into the next document.
    const root = document.createElement('div'); root.id = 'swagger-ui';
    if (ui && typeof ui.destroy === 'function') ui.destroy();
    $('swagger-ui').replaceWith(root);
    ui = SwaggerUIBundle({spec, dom_id:'#swagger-ui', presets:[SwaggerUIBundle.presets.apis], layout:'BaseLayout', validatorUrl:null, persistAuthorization:false, deepLinking:false, docExpansion:'list', defaultModelsExpandDepth:1, displayRequestDuration:true, showExtensions:true, supportedSubmitMethods:['get','put','post','delete','options','head','patch','trace'], tryItOutEnabled:false});
    $('filename').textContent = filename;
    $('spec-version').textContent = spec.swagger ? 'Swagger 2.0' : `OpenAPI ${spec.openapi}`;
    const count = Object.values(spec.paths || {}).reduce((sum,path) => sum + Object.keys(path || {}).filter(key => /^(get|put|post|delete|options|head|patch|trace)$/.test(key)).length, 0);
    $('status').textContent = `已載入 ${count} 個 API 端點`;
    $('error').hidden = true;
    return spec;
  } catch (error) {
    const mark = error.mark;
    reportError(mark ? `YAML 格式錯誤（第 ${mark.line + 1} 行，第 ${mark.column + 1} 欄）\n${error.reason}` : error.message);
  }
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) { user = null; updateAccount(); clearPrivateView(); }
    throw new Error(data.error || '無法連線，請稍後再試。');
  }
  return data;
}
function setBusy(value) {
  busy = value;
  for (const id of ['upload', 'render', 'demo', 'sign-out', 'history-refresh', 'history-more']) $(id).disabled = value;
  $('source').readOnly = value;
  $('history-list').querySelectorAll('button').forEach(button => { button.disabled = value; });
}
function updateAccount(configured = true) {
  $('account-name').textContent = user ? (user.name || user.email) : '尚未登入';
  $('sign-in').hidden = !!user; $('sign-in').disabled = !configured;
  $('sign-out').hidden = !user;
  $('auth-note').textContent = user ? '文件會安全保存至你的帳號。每次匯入都會新增一筆紀錄。' : configured ? '使用 Google 登入後，即可儲存文件及查看個人歷史。未登入仍可預覽。' : 'Google 登入尚待站主完成設定。目前僅可預覽，文件不會儲存。';
}
function clearPrivateView() {
  historySequence++;
  selectedId = null; nextOffset = null;
  $('history-list').replaceChildren(); $('history-more').hidden = true;
  $('history-status').textContent = '登入後查看你的文件。';
  history.replaceState(null, '', '/');
  // Preserve pending editor input on session expiry, but remove the old authenticated preview.
  const root = document.createElement('div'); root.id = 'swagger-ui';
  if (ui && typeof ui.destroy === 'function') ui.destroy();
  $('swagger-ui').replaceWith(root); ui = undefined;
}
async function refreshHistory(append = false) {
  if (!user) return;
  const sequence = ++historySequence;
  const data = await api('/api/documents?offset=' + (append ? nextOffset || 0 : 0));
  if (sequence !== historySequence) return;
  if (!append) $('history-list').replaceChildren();
  nextOffset = data.nextOffset;
  for (const item of data.documents) {
    const li = document.createElement('li'); li.className = 'history-item';
    const open = document.createElement('button'); open.type = 'button'; open.className = 'history-open';
    const title = document.createElement('strong'); title.textContent = item.title;
    const meta = document.createElement('span'); meta.textContent = `${item.fileName} · ${{ upload: '上傳', paste: '貼上', import: '匯入' }[item.sourceType] || item.sourceType}`;
    const date = document.createElement('time'); date.dateTime = item.createdAt; date.textContent = new Date(item.createdAt).toLocaleString('zh-TW');
    open.append(title, meta, date); open.setAttribute('aria-label', '開啟 ' + item.title);
    open.onclick = () => openDocument(item.id);
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'history-delete'; remove.textContent = '刪除'; remove.setAttribute('aria-label', '刪除 ' + item.title);
    remove.onclick = () => deleteDocument(item);
    li.append(open, remove); $('history-list').append(li);
  }
  $('history-status').textContent = $('history-list').children.length ? '' : '尚無文件。上傳檔案或貼上 YAML 後即可儲存。';
  $('history-more').hidden = nextOffset === null;
}
async function saveCurrent() {
  if (busy) return;
  const spec = render(); if (!spec) return;
  if (!user) { $('status').textContent = '已預覽，尚未儲存。請先使用 Google 登入，再按「儲存並更新文件」。'; return; }
  setBusy(true); $('status').textContent = '正在儲存…';
  try {
    const data = await api('/api/documents', { method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8', 'x-source-type': sourceType, 'x-file-name': encodeURIComponent(filename) }, body: $('source').value });
    selectedId = data.document.id; history.replaceState(null, '', '?doc=' + selectedId);
    $('status').textContent = '已儲存至個人歷史，重新整理後仍可開啟。';
    await refreshHistory().catch(() => { $('history-status').textContent = '文件已儲存，歷史清單暫時無法更新，請按重新整理。'; });
  } catch (error) { reportError(error.message); $('status').textContent = '儲存未確認完成。請先重新整理歷史確認；編輯區內容已保留。'; }
  finally { setBusy(false); }
}
async function openDocument(id) {
  if (busy) return; setBusy(true);
  try {
    const { document: item } = await api('/api/documents/' + encodeURIComponent(id));
    filename = item.fileName; sourceType = item.sourceType; $('source').value = item.source; render();
    selectedId = item.id; history.replaceState(null, '', '?doc=' + item.id);
    $('status').textContent = '已從歷史開啟。編輯後儲存會建立新紀錄。';
  } catch (error) { reportError(error.message); }
  finally { setBusy(false); }
}
async function deleteDocument(item) {
  if (busy || !confirm(`刪除「${item.title}」？這會移除已儲存的文件，無法復原。`)) return;
  setBusy(true);
  try {
    await api('/api/documents/' + encodeURIComponent(item.id), { method: 'DELETE' });
    if (selectedId === item.id) { selectedId = null; history.replaceState(null, '', '/'); filename = 'petstore-example.yaml'; $('source').value = example; render(); }
    await refreshHistory(); $('status').textContent = '文件已刪除。';
  } catch (error) { reportError(error.message); }
  finally { setBusy(false); }
}
async function loadFile(file) {
  if (busy) return;
  const sequence = ++readSequence;
  if (!file) return;
  if (!/\.(ya?ml|json)$/i.test(file.name)) return reportError('請選擇 .yaml、.yml 或 .json 檔案。');
  if (file.size > limit) return reportError('檔案過大，請使用 5 MB 以內的文件。');
  try {
    const source = await file.text(); if (sequence !== readSequence || busy) return;
    filename = file.name; sourceType = 'upload'; $('source').value = source; await saveCurrent();
  } catch { reportError('無法讀取檔案，請重新選擇。'); }
}
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
$('render').addEventListener('click', saveCurrent);
$('demo').addEventListener('click', () => { readSequence++; filename = 'petstore-example.yaml'; sourceType = 'import'; $('source').value = example; saveCurrent(); });
$('source').addEventListener('input', () => { readSequence++; filename = 'pasted-api.yaml'; sourceType = 'paste'; $('status').textContent = '內容已變更，按「儲存並更新文件」套用。'; $('error').hidden = true; });
$('source').addEventListener('paste', () => { setTimeout(() => { if (!busy) saveCurrent(); }, 0); });
$('source').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); saveCurrent(); } });
$('history-refresh').onclick = () => refreshHistory().catch(error => reportError(error.message));
$('history-more').onclick = () => refreshHistory(true).catch(error => reportError(error.message));
$('sign-in').onclick = () => { window.location.assign('/api/auth/signin'); };
$('sign-out').onclick = async () => {
  if (busy) return;
  setBusy(true);
  try {
    const { csrfToken } = await api('/api/auth/csrf');
    await api('/api/auth/signout', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' }, body: new URLSearchParams({ csrfToken, callbackUrl: location.origin }) });
    user = null; clearPrivateView(); filename = 'petstore-example.yaml'; $('source').value = example; render(); updateAccount();
  } catch (error) { reportError(error.message); }
  finally { setBusy(false); }
};
let dragDepth = 0;
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
$('dropzone').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => { if (--dragDepth <= 0) $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('dragover', event => event.preventDefault());
$('dropzone').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('dragging'); if (event.dataTransfer.files.length !== 1) return reportError('請一次拖曳一個 API 定義檔案。'); loadFile(event.dataTransfer.files[0]); });
$('source').value = example; render();
async function initialize() {
  setBusy(true);
  try {
    const data = await api('/api/me'); user = data.user; updateAccount(data.googleConfigured);
    if (user) {
      await refreshHistory();
      const id = new URLSearchParams(location.search).get('doc');
      setBusy(false);
      if (id) await openDocument(id);
    }
  } catch (error) { updateAccount(false); $('auth-note').textContent = '無法讀取登入狀態，請重新整理再試。'; reportError(error.message); }
  finally { setBusy(false); }
}
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
initialize();
