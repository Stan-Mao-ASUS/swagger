# Swagger YAML Viewer

使用 Swagger UI 呈現 YAML / JSON，支援 Swagger 2.0、OpenAPI 3.0.x / 3.1.x。

## 本機執行

在此目錄執行 `python3 -m http.server 4173 --directory dist`，開啟 http://localhost:4173。

選擇或拖曳 YAML/JSON（最大 5 MB）會立即載入。貼上或編輯內容後，按「更新文件」或 Cmd/Ctrl + Enter。展開端點即可查看參數、回應、Schema，並使用 Authorize / Try it out。

文件只保留於頁面記憶體，重新整理後回到範例。不會上傳或儲存文件到網站伺服器。外部 $ref 與 Try it out 會連線到文件指定網址；Execute 會實際呼叫 API。未啟用外部 validator 或永久授權儲存。

API 呼叫需要目標伺服器允許 CORS；HTTPS 頁面呼叫 HTTP API 可能被瀏覽器阻擋。servers（OpenAPI 3）或 host/schemes（Swagger 2）請指定實際 API 網址。相對網址會以本站來源為基準；本機多檔相對 $ref 請先 bundle 成單一文件。此工具檢查 YAML 語法及基本結構，並非完整規格驗證器。

## 原始碼

- dist/index.html：介面
- dist/style.css：響應式樣式
- dist/app.js：匯入、解析及 Swagger UI 整合
- dist/vendor：Swagger UI 5.33.0、js-yaml 5.4.2 及授權文件

官方說明：https://swagger.io/docs/open-source-tools/swagger-ui/usage/installation/
