---
name: history
description: Document history operations. Actions: list(query?, notebook?, op?, type?, page?), search(query, notebook?, op?, type?, page?), get(path), rollback(path), clear().
---

# history

## action: list
列出文档历史版本的备份列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `query` | `string` | 否 | Search query (for list, search) | - |
| `notebook` | `string` | 否 | Notebook ID filter (for list, search) | - |
| `op` | `string` | 否 | Operation filter: delete/update/create (for list, search) | - |
| `type` | `number` | 否 | Search type: 0=name,1=content,2=asset,3=docID,4=database (default 1) | - |
| `page` | `number` | 否 | Page number (default 1) | - |

### 使用示例

```javascript
history({
  "action": "list",
  "query": "...",
  "notebook": "20211229091211-7v5p54a",
  "op": "...",
  "type": "...",
  "page": "..."
})
```

---

## action: search
按关键词或时间搜索文档历史备份记录

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `query` | `string` | 是 | Search query (for list, search) | - |
| `notebook` | `string` | 否 | Notebook ID filter (for list, search) | - |
| `op` | `string` | 否 | Operation filter: delete/update/create (for list, search) | - |
| `type` | `number` | 否 | Search type: 0=name,1=content,2=asset,3=docID,4=database (default 1) | - |
| `page` | `number` | 否 | Page number (default 1) | - |

### 使用示例

```javascript
history({
  "action": "search",
  "query": "...",
  "notebook": "20211229091211-7v5p54a",
  "op": "...",
  "type": "...",
  "page": "..."
})
```

---

## action: get
获取指定历史版本文件的详细内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | History path relative to workspace directory (for get, rollback). Obtained from list/search output, e.g. history/2024-03-15-.../docid/... | - |

### 使用示例

```javascript
history({
  "action": "get",
  "path": "..."
})
```

---

## action: rollback
将文档回滚/恢复到指定的历史版本状态

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | History path relative to workspace directory (for get, rollback). Obtained from list/search output, e.g. history/2024-03-15-.../docid/... | - |

### 使用示例

```javascript
history({
  "action": "rollback",
  "path": "..."
})
```

---

## action: clear
清理文档的冗余历史备份记录 (.)

*该 action 无其他参数。*

### 使用示例

```javascript
history({
  "action": "clear"
})
```

---

