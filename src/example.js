export const example = `openapi: 3.0.3
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
