---
name: database
description: Attribute view (database) operations. Actions: search(keyword), get(id), render(id, viewID?, query?, page=1, pageSize=50), keys(id), key_add(id, name, type, icon?, prev?), key_remove(id, keyID, removeRelationDest?), item_add(id, blockID?, content?, viewID?, groupID?, previousID?, detached?, ignoreDefaultFill?), item_remove(id, itemIDs comma-separated), item_update(id, keyID, itemID, value as JSON string), unused(), clean(id?).
---

# database

## action: search
根据关键词搜索数据库/属性视图

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `keyword` | `string` | 是 | Search keyword (for search) | - |

### 使用示例

```javascript
database({
  "action": "search",
  "keyword": "..."
})
```

---

## action: get
获取指定属性视图/数据库的结构和行数据

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |

### 使用示例

```javascript
database({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: render
渲染或查询数据库数据表格，支持过滤和分页

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `viewID` | `string` | 否 | View ID (for render, item_add) | - |
| `query` | `string` | 否 | Filter query (for render) | - |
| `page` | `number` | 否 | Page number (default 1) | - |
| `pageSize` | `number` | 否 | Results per page (default 50) | - |

### 使用示例

```javascript
database({
  "action": "render",
  "id": "20200812220555-w7m19sc",
  "viewID": "...",
  "query": "...",
  "page": "...",
  "pageSize": "..."
})
```

---

## action: keys
列出属性视图包含的所有列/字段属性

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |

### 使用示例

```javascript
database({
  "action": "keys",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: key_add
向属性视图中添加新字段/列（如文本、数值、日期等）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `name` | `string` | 是 | Key name (for key_add) | - |
| `type` | `string` | 是 | Key type: block/text/number/date/select/mSelect/url/email/phone/mAsset/template/created/updated/checkbox/relation/rollup/lineNumber (for key_add) | - |
| `icon` | `string` | 否 | Key icon (for key_add, optional) | - |
| `prev` | `string` | 否 | Previous key ID for ordering (for key_add, optional) | - |

### 使用示例

```javascript
database({
  "action": "key_add",
  "id": "20200812220555-w7m19sc",
  "name": "...",
  "type": "...",
  "icon": "...",
  "prev": "..."
})
```

---

## action: key_remove
从属性视图中删除指定字段/列

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `keyID` | `string` | 是 | Key ID (for key_remove, item_update) | - |
| `removeRelationDest` | `boolean` | 否 | Also remove related data in linked databases (for key_remove, optional) | - |

### 使用示例

```javascript
database({
  "action": "key_remove",
  "id": "20200812220555-w7m19sc",
  "keyID": "...",
  "removeRelationDest": "..."
})
```

---

## action: item_add
在数据库中插入一行新数据（关联现有块或独立行）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `blockID` | `string` | 否 | Block ID to bind (for item_add, optional) | - |
| `content` | `string` | 否 | Block column text content (for item_add, optional) | - |
| `viewID` | `string` | 否 | View ID (for render, item_add) | - |
| `groupID` | `string` | 否 | Group ID for positioning (for item_add, optional) | - |
| `previousID` | `string` | 否 | Previous item ID for positioning (for item_add, optional) | - |
| `detached` | `boolean` | 否 | Create detached row (for item_add, optional) | - |
| `ignoreDefaultFill` | `boolean` | 否 | Skip filling default values (for item_add, optional) | - |

### 使用示例

```javascript
database({
  "action": "item_add",
  "id": "20200812220555-w7m19sc",
  "blockID": "...",
  "content": "...",
  "viewID": "...",
  "groupID": "...",
  "previousID": "...",
  "detached": "...",
  "ignoreDefaultFill": "..."
})
```

---

## action: item_remove
删除数据库中指定的多行数据

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `itemIDs` | `string` | 是 | Comma-separated item IDs (for item_remove) | - |

### 使用示例

```javascript
database({
  "action": "item_remove",
  "id": "20200812220555-w7m19sc",
  "itemIDs": "..."
})
```

---

## action: item_update
更新数据库中指定行和列单元格的值

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |
| `keyID` | `string` | 是 | Key ID (for key_remove, item_update) | - |
| `itemID` | `string` | 是 | Item ID (for item_update) | - |
| `value` | `string` | 是 | JSON value for the cell (for item_update) | - |

### 使用示例

```javascript
database({
  "action": "item_update",
  "id": "20200812220555-w7m19sc",
  "keyID": "...",
  "itemID": "...",
  "value": "..."
})
```

---

## action: unused
查找数据库中未使用的关联项

*该 action 无其他参数。*

### 使用示例

```javascript
database({
  "action": "unused"
})
```

---

## action: clean
清理或删除指定的数据库/关联项 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 否 | Attribute view ID (for get, render, keys, key_add, key_remove, item_add, item_remove, item_update, clean) | - |

### 使用示例

```javascript
database({
  "action": "clean",
  "id": "20200812220555-w7m19sc"
})
```

---

