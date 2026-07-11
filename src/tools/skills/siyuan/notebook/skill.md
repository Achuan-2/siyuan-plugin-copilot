---
name: notebook
description: Notebook management. Actions: list(), open(id), close(id), create(name), rename(id, name), remove(id), set_icon(id, icon), random_icon(id?).
---

# notebook

## action: list
列出当前工作区中所有的笔记本（包含未开启的）

*该 action 无其他参数。*

### 使用示例

```javascript
notebook({
  "action": "list"
})
```

---

## action: open
开启/挂载指定的笔记本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |

### 使用示例

```javascript
notebook({
  "action": "open",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: close
关闭/卸载指定的笔记本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |

### 使用示例

```javascript
notebook({
  "action": "close",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: create
创建一个新笔记本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Notebook name (for create, rename) | - |

### 使用示例

```javascript
notebook({
  "action": "create",
  "name": "..."
})
```

---

## action: rename
修改指定笔记本的名称

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |
| `name` | `string` | 是 | Notebook name (for create, rename) | - |

### 使用示例

```javascript
notebook({
  "action": "rename",
  "id": "20200812220555-w7m19sc",
  "name": "..."
})
```

---

## action: remove
删除指定的笔记本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |

### 使用示例

```javascript
notebook({
  "action": "remove",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: set_icon
设置笔记本的展示图标（支持 Emoji 和自定义图）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |
| `icon` | `string` | 是 | Notebook icon (for set_icon). Emoji hex codepoint like "1f4ca\ | - |

### 使用示例

```javascript
notebook({
  "action": "set_icon",
  "id": "20200812220555-w7m19sc",
  "icon": "..."
})
```

---

## action: random_icon
为指定笔记本随机生成一个 Emoji 图标 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 否 | Notebook ID (for open, close, rename, remove, set_icon, random_icon) | - |

### 使用示例

```javascript
notebook({
  "action": "random_icon",
  "id": "20200812220555-w7m19sc"
})
```

---

