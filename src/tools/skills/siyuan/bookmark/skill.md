---
name: bookmark
description: Bookmark management. Actions: list(), labels(), remove(label), rename(old, new).
---

# bookmark

## action: list
列出所有已标记的书签块列表

*该 action 无其他参数。*

### 使用示例

```javascript
bookmark({
  "action": "list"
})
```

---

## action: labels
列出当前工作区中存在的所有书签标签名称

*该 action 无其他参数。*

### 使用示例

```javascript
bookmark({
  "action": "labels"
})
```

---

## action: remove
从所有块中移除指定的书签标签

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `label` | `string` | 是 | Bookmark label (for remove) | - |

### 使用示例

```javascript
bookmark({
  "action": "remove",
  "label": "..."
})
```

---

## action: rename
重命名指定的书签标签 (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `old` | `string` | 是 | Old label (for rename) | - |
| `new` | `string` | 是 | New label (for rename) | - |

### 使用示例

```javascript
bookmark({
  "action": "rename",
  "old": "...",
  "new": "..."
})
```

---

