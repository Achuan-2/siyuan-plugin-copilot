---
name: attr
description: Block custom-attribute operations. Actions: get(id), set(id, attrs object), batch-get(ids comma-separated).
---

# attr

## action: get
获取指定块的自定义属性及系统属性

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
attr({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: set
设置指定块的属性值（如自定义属性、命名、别名、备注等）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |
| `attrs` | `object` | 是 | Attribute key-value pairs (for set). Common attributes: - icon: emoji hex codepoint like "1f4ca\ | - |

### 使用示例

```javascript
attr({
  "action": "set",
  "id": "20200812220555-w7m19sc",
  "attrs": "..."
})
```

---

## action: batch-get
批量获取多个块的自定义属性 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `ids` | `string` | 是 | Comma-separated block IDs (for batch-get) | - |

### 使用示例

```javascript
attr({
  "action": "batch-get",
  "ids": "..."
})
```

---

