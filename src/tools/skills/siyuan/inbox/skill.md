---
name: inbox
description: Inbox management (cloud-clipped web pages, messages, and audio/video/file attachments; requires subscription). Actions: list(page=1), get(id), convert(ids, notebook, path=/, remove_after=true) — converts one or more shorthands into local documents under the target notebook, deleting the cloud originals on success.
---

# inbox

## action: list
列出收件箱中的剪藏文章、消息和附件列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `page` | `integer` | 否 | Page number for list (1-based, default 1) | - |

### 使用示例

```javascript
inbox({
  "action": "list",
  "page": "..."
})
```

---

## action: get
获取收件箱中指定条目的详细剪藏内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Shorthand ID (for get) | - |

### 使用示例

```javascript
inbox({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: convert
将收件箱中指定的一个或多个条目导入转换为思源笔记本地文档 (converts one or more shorthands into local documents under the target notebook)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `ids` | `string` | 是 | Comma-separated shorthand IDs (for convert), e.g. "1700000000000,1700000000001" | - |
| `notebook` | `string` | 是 | Target notebook ID (for convert) | - |
| `path` | `string` | 否 | Target hPath in the notebook for the new documents (default "/\ | - |
| `remove_after` | `boolean` | 否 | Whether to delete the cloud shorthand after a successful conversion (default true) | - |

### 使用示例

```javascript
inbox({
  "action": "convert",
  "ids": "...",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "remove_after": "..."
})
```

---

