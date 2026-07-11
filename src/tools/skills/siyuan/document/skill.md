---
name: document
description: Document operations. Actions: get(id), create(notebook, path=hPath, title, markdown?), list(notebook, path=hPath default /), delete(id), rename(id, title), move(id, notebook, path=target hPath), duplicate(id), search_docs(keyword), info(id).
---

# document

## action: get
获取指定文档的元数据和子级文档列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |

### 使用示例

```javascript
document({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: create
在指定笔记本和目录下创建新文档

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID (required for create, list, move) | - |
| `path` | `string` | 否 | Document hPath, the human-readable path shown in the document tree (e.g. /folder/doc). Used for create, list, move. | - |
| `title` | `string` | 是 | Document title (for create, rename) | - |
| `markdown` | `string` | 否 | Initial markdown content (for create) | - |

### 使用示例

```javascript
document({
  "action": "create",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "title": "...",
  "markdown": "..."
})
```

---

## action: list
列出指定笔记本和目录路径下的所有子文档

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID (required for create, list, move) | - |
| `path` | `string` | 否 | Document hPath, the human-readable path shown in the document tree (e.g. /folder/doc). Used for create, list, move. | - |

### 使用示例

```javascript
document({
  "action": "list",
  "notebook": "20211229091211-7v5p54a",
  "path": "..."
})
```

---

## action: delete
删除指定的文档（移动到回收站）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |

### 使用示例

```javascript
document({
  "action": "delete",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: rename
修改文档的标题

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |
| `title` | `string` | 是 | Document title (for create, rename) | - |

### 使用示例

```javascript
document({
  "action": "rename",
  "id": "20200812220555-w7m19sc",
  "title": "..."
})
```

---

## action: move
移动文档到指定笔记本或目标目录下

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |
| `notebook` | `string` | 是 | Notebook ID (required for create, list, move) | - |
| `path` | `string` | 否 | Document hPath, the human-readable path shown in the document tree (e.g. /folder/doc). Used for create, list, move. | - |

### 使用示例

```javascript
document({
  "action": "move",
  "id": "20200812220555-w7m19sc",
  "notebook": "20211229091211-7v5p54a",
  "path": "..."
})
```

---

## action: duplicate
复制/克隆指定的文档

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |

### 使用示例

```javascript
document({
  "action": "duplicate",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: search_docs
按关键词搜索文档标题

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `keyword` | `string` | 是 | Search keyword (for search_docs) | - |

### 使用示例

```javascript
document({
  "action": "search_docs",
  "keyword": "..."
})
```

---

## action: info
获取文档的完整元数据及统计信息 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |

### 使用示例

```javascript
document({
  "action": "info",
  "id": "20200812220555-w7m19sc"
})
```

---

