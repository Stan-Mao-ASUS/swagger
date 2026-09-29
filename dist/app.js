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
  } catch (error) {
    const mark = error.mark;
    reportError(mark ? `YAML 格式錯誤（第 ${mark.line + 1} 行，第 ${mark.column + 1} 欄）\n${error.reason}` : error.message);
  }
}
async function loadFile(file) {
  const sequence = ++readSequence;
  if (!file) return;
  if (!/\.(ya?ml|json)$/i.test(file.name)) return reportError('請選擇 .yaml、.yml 或 .json 檔案。');
  if (file.size > limit) return reportError('檔案過大，請使用 5 MB 以內的文件。');
  try {
    const source = await file.text();
    if (sequence !== readSequence) return;
    filename = file.name; $('source').value = source; render();
  } catch { reportError('無法讀取檔案，請重新選擇。'); }
}
$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
$('render').addEventListener('click', render);
$('demo').addEventListener('click', () => { readSequence++; filename = 'petstore-example.yaml'; $('source').value = example; render(); });
$('source').addEventListener('input', () => { readSequence++; filename = '貼上的 API 定義'; $('status').textContent = '內容已變更，按「更新文件」套用。'; $('error').hidden = true; });
$('source').addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); render(); } });
let dragDepth = 0;
window.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
window.addEventListener('drop', event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); });
$('dropzone').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => { if (--dragDepth <= 0) $('dropzone').classList.remove('dragging'); });
$('dropzone').addEventListener('dragover', event => event.preventDefault());
$('dropzone').addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('dropzone').classList.remove('dragging'); if (event.dataTransfer.files.length !== 1) return reportError('請一次拖曳一個 API 定義檔案。'); loadFile(event.dataTransfer.files[0]); });
$('source').value = example;
render();
