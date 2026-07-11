---
name: repo
description: Repository (data snapshot) operations. Actions: list(tag?, page=1), create(memo?), tag(id, name), untag(name), checkout(id), diff(left, right), search(keyword, page?), purge(), file_get(id), file_rollback(id), file_open(id), file_export(id).
---

# repo

## action: list
列出数据仓库的所有历史版本快照列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `tag` | `boolean` | 否 | List tagged snapshots only (for list, optional) | - |
| `page` | `number` | 否 | Page number (for list, search; default 1) | - |

### 使用示例

```javascript
repo({
  "action": "list",
  "tag": "...",
  "page": "..."
})
```

---

## action: create
手动创建一个当前工作区状态的数据版本快照

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `memo` | `string` | 否 | Snapshot memo (for create, optional) | - |

### 使用示例

```javascript
repo({
  "action": "create",
  "memo": "..."
})
```

---

## action: tag
给指定数据快照添加标签标记

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |
| `name` | `string` | 是 | Tag name (for tag, untag) | - |

### 使用示例

```javascript
repo({
  "action": "tag",
  "id": "20200812220555-w7m19sc",
  "name": "..."
})
```

---

## action: untag
移除数据快照的指定标签

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Tag name (for tag, untag) | - |

### 使用示例

```javascript
repo({
  "action": "untag",
  "name": "..."
})
```

---

## action: checkout
签出/将整个工作区数据还原到指定的快照版本状态

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |

### 使用示例

```javascript
repo({
  "action": "checkout",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: diff
对比两个版本快照之间的数据变动差异

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `left` | `string` | 是 | Left snapshot ID (for diff) | - |
| `right` | `string` | 是 | Right snapshot ID (for diff) | - |

### 使用示例

```javascript
repo({
  "action": "diff",
  "left": "...",
  "right": "..."
})
```

---

## action: search
根据关键词搜索历史版本快照

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `keyword` | `string` | 是 | Search keyword (for search) | - |
| `page` | `number` | 否 | Page number (for list, search; default 1) | - |

### 使用示例

```javascript
repo({
  "action": "search",
  "keyword": "...",
  "page": "..."
})
```

---

## action: purge
清理冗余的历史快照以释放磁盘空间

*该 action 无其他参数。*

### 使用示例

```javascript
repo({
  "action": "purge"
})
```

---

## action: file_get
获取快照中指定文件的历史内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |

### 使用示例

```javascript
repo({
  "action": "file_get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: file_rollback
回滚工作区中的单个文件到快照版本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |

### 使用示例

```javascript
repo({
  "action": "file_rollback",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: file_open
在编辑器中打开指定快照中的文件版本

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |

### 使用示例

```javascript
repo({
  "action": "file_open",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: file_export
将快照中的指定文件导出到本地绝对路径 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Snapshot ID (for tag, checkout, file_get, file_rollback, file_open, file_export) | - |

### 使用示例

```javascript
repo({
  "action": "file_export",
  "id": "20200812220555-w7m19sc"
})
```

---

