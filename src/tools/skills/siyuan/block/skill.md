---
name: block
description: Block operations. Actions: get(id), get_kramdown(id), get_children(id), tree_stat(id, by document), dom(id), insert(data, dataType, parentID?, nextID?, previousID?), append(data, dataType, parentID) / prepend(...) add a NEW child — use after block.update when both modifying and adding, update(id, data, dataType) replaces ONE block only (no append), delete(id), move(id, parentID, previousID?), breadcrumb(id), batch_get(ids) / batch_kramdown(ids) where ids is comma-separated.
---

# block

## action: get
获取指定块的详细元数据（如类型、所属文档、创建/更新时间等）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: get_kramdown
获取块的 Kramdown 格式 Markdown 源码内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "get_kramdown",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: get_children
获取指定块的直接子块列表及 ID

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "get_children",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: tree_stat
统计以指定块为根节点的文档/子树的字数等信息

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "tree_stat",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: dom
获取指定块的 Protyle DOM 结构内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "dom",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: insert
在指定位置（作为子节点或兄弟节点）插入新块

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `data` | `string` | 是 | Content (markdown or dom) | - |
| `dataType` | `string` | 是 | Content type: markdown or dom | `"markdown"`, `"dom"` |
| `parentID` | `string` | 否 | Parent block ID | - |
| `nextID` | `string` | 否 | Next sibling block ID (for insert) | - |
| `previousID` | `string` | 否 | Previous sibling block ID (for insert) | - |

### 使用示例

```javascript
block({
  "action": "insert",
  "data": "...",
  "dataType": "markdown",
  "parentID": "...",
  "nextID": "...",
  "previousID": "..."
})
```

---

## action: append
在指定父节点块 of 子级末尾追加新块 (add a NEW child — use after block.update when both modifying and adding)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `data` | `string` | 是 | Content (markdown or dom) | - |
| `dataType` | `string` | 是 | Content type: markdown or dom | `"markdown"`, `"dom"` |
| `parentID` | `string` | 是 | Parent block ID | - |

### 使用示例

```javascript
block({
  "action": "append",
  "data": "...",
  "dataType": "markdown",
  "parentID": "..."
})
```

---

## action: prepend
在指定父节点块 of 子级开头插入新块

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `data` | `string` | 是 | Content (markdown or dom) | - |
| `dataType` | `string` | 是 | Content type: markdown or dom | `"markdown"`, `"dom"` |
| `parentID` | `string` | 是 | Parent block ID | - |

### 使用示例

```javascript
block({
  "action": "prepend",
  "data": "...",
  "dataType": "markdown",
  "parentID": "..."
})
```

---

## action: update
更新指定块的内容（直接替换该块的内容） (replaces ONE block only (no append))

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |
| `data` | `string` | 是 | Content (markdown or dom) | - |
| `dataType` | `string` | 是 | Content type: markdown or dom | `"markdown"`, `"dom"` |

### 使用示例

```javascript
block({
  "action": "update",
  "id": "20200812220555-w7m19sc",
  "data": "...",
  "dataType": "markdown"
})
```

---

## action: delete
删除指定 ID 的块

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "delete",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: move
移动指定块到新的父块或兄弟块位置

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |
| `parentID` | `string` | 是 | Parent block ID | - |
| `previousID` | `string` | 否 | Previous sibling block ID (for insert) | - |

### 使用示例

```javascript
block({
  "action": "move",
  "id": "20200812220555-w7m19sc",
  "parentID": "...",
  "previousID": "..."
})
```

---

## action: breadcrumb
获取指定块到根文档的面包屑路径

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
block({
  "action": "breadcrumb",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: batch_get
批量获取多个块的详细元数据信息 (where ids is comma-separated.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `ids` | `string` | 是 | Comma-separated block IDs (for batch_get, batch_kramdown) | - |

### 使用示例

```javascript
block({
  "action": "batch_get",
  "ids": "..."
})
```

---

## action: batch_kramdown
批量获取多个块的 Kramdown 格式源码 (where ids is comma-separated.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `ids` | `string` | 是 | Comma-separated block IDs (for batch_get, batch_kramdown) | - |

### 使用示例

```javascript
block({
  "action": "batch_kramdown",
  "ids": "..."
})
```

---

