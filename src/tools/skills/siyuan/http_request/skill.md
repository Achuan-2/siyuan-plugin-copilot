---
name: http_request
description: Send an HTTP request to a REST API and return the raw text response (JSON is kept as-is). action (HTTP method): get (default)/post/put/delete/patch. url (http/https), headers (object), body (string). Use this instead of web_fetch when you need POST, custom headers (e.g. Authorization), or raw JSON responses.
---

# http_request

## action: get

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 否 | The request URL (must start with http:// or https://) | - |
| `headers` | `object` | 否 | Optional request headers, e.g. {"Authorization":"Bearer ...\ | - |
| `body` | `string` | 否 | Optional request body for post/put/patch. | - |

### 使用示例

```javascript
http_request({
  "action": "get",
  "url": "...",
  "headers": "...",
  "body": "..."
})
```

---

## action: post

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 否 | The request URL (must start with http:// or https://) | - |
| `headers` | `object` | 否 | Optional request headers, e.g. {"Authorization":"Bearer ...\ | - |
| `body` | `string` | 否 | Optional request body for post/put/patch. | - |

### 使用示例

```javascript
http_request({
  "action": "post",
  "url": "...",
  "headers": "...",
  "body": "..."
})
```

---

## action: put

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 否 | The request URL (must start with http:// or https://) | - |
| `headers` | `object` | 否 | Optional request headers, e.g. {"Authorization":"Bearer ...\ | - |
| `body` | `string` | 否 | Optional request body for post/put/patch. | - |

### 使用示例

```javascript
http_request({
  "action": "put",
  "url": "...",
  "headers": "...",
  "body": "..."
})
```

---

## action: delete

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 否 | The request URL (must start with http:// or https://) | - |
| `headers` | `object` | 否 | Optional request headers, e.g. {"Authorization":"Bearer ...\ | - |
| `body` | `string` | 否 | Optional request body for post/put/patch. | - |

### 使用示例

```javascript
http_request({
  "action": "delete",
  "url": "...",
  "headers": "...",
  "body": "..."
})
```

---

## action: patch

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 否 | The request URL (must start with http:// or https://) | - |
| `headers` | `object` | 否 | Optional request headers, e.g. {"Authorization":"Bearer ...\ | - |
| `body` | `string` | 否 | Optional request body for post/put/patch. | - |

### 使用示例

```javascript
http_request({
  "action": "patch",
  "url": "...",
  "headers": "...",
  "body": "..."
})
```

---

