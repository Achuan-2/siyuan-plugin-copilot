---
name: template
description: Template management. Actions: search(keyword?), get(path), remove(path), render(path, id), save_as(id, name, overwrite?), create(name, content, overwrite?).
---

# template

## action: search
按关键词搜索可用的模板文件列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `keyword` | `string` | 否 | Search keyword; empty lists all (for search) | - |

### 使用示例

```javascript
template({
  "action": "search",
  "keyword": "..."
})
```

---

## action: get
获取模板文件的 Kramdown 源码内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Template file path as returned by search (for get, remove, render) | - |

### 使用示例

```javascript
template({
  "action": "get",
  "path": "..."
})
```

---

## action: remove
删除指定的模板文件

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Template file path as returned by search (for get, remove, render) | - |

### 使用示例

```javascript
template({
  "action": "remove",
  "path": "..."
})
```

---

## action: render
渲染指定的模板内容并将其插入到指定块中

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Template file path as returned by search (for get, remove, render) | - |
| `id` | `string` | 是 | Block ID (for render, save_as) | - |

### 使用示例

```javascript
template({
  "action": "render",
  "path": "...",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: save_as
将指定块的内容另存为模板文件

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID (for render, save_as) | - |
| `name` | `string` | 是 | Template name without extension (for save_as, create) | - |
| `overwrite` | `boolean` | 否 | Overwrite if exists (for save_as, create, default false) | - |

### 使用示例

```javascript
template({
  "action": "save_as",
  "id": "20200812220555-w7m19sc",
  "name": "...",
  "overwrite": "..."
})
```

---

## action: create
直接创建一个新的模板文件并写入内容 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Template name without extension (for save_as, create) | - |
| `content` | `string` | 是 | Markdown content (for create) | - |
| `overwrite` | `boolean` | 否 | Overwrite if exists (for save_as, create, default false) | - |

### 使用示例

```javascript
template({
  "action": "create",
  "name": "...",
  "content": "...",
  "overwrite": "..."
})
```

---

