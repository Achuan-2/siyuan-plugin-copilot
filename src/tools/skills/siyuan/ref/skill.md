---
name: ref
description: Reference/backlink operations. Actions: backlinks(id, keyword?, sort?), mentions(id, keyword?, sort?), refresh(id).
---

# ref

## action: backlinks
获取指定块的所有反向链接（双链引用）列表

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |
| `keyword` | `string` | 否 | Filter by keyword | - |
| `sort` | `number` | 否 | Sort mode for backlinks and mentions: 0=updated-desc 1=updated-asc 2=created-desc 3=created-asc 4=name-desc 5=name-asc 6=alphanum-desc 7=alphanum-asc (default 0) | - |

### 使用示例

```javascript
ref({
  "action": "backlinks",
  "id": "20200812220555-w7m19sc",
  "keyword": "...",
  "sort": "..."
})
```

---

## action: mentions
获取提及指定块但未建立双链引用的文本片段（提及列表）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |
| `keyword` | `string` | 否 | Filter by keyword | - |
| `sort` | `number` | 否 | Sort mode for backlinks and mentions: 0=updated-desc 1=updated-asc 2=created-desc 3=created-asc 4=name-desc 5=name-asc 6=alphanum-desc 7=alphanum-asc (default 0) | - |

### 使用示例

```javascript
ref({
  "action": "mentions",
  "id": "20200812220555-w7m19sc",
  "keyword": "...",
  "sort": "..."
})
```

---

## action: refresh
强制刷新指定块的引用关系缓存 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Block ID | - |

### 使用示例

```javascript
ref({
  "action": "refresh",
  "id": "20200812220555-w7m19sc"
})
```

---

