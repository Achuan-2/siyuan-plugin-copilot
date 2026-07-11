---
name: tag
description: Tag management. Actions: list(keyword?), rename(old, new), remove(label).
---

# tag

## action: list
列出工作区中所有已创建的标签（支持根据关键词过滤）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `keyword` | `string` | 否 | Search keyword (for list) | - |

### 使用示例

```javascript
tag({
  "action": "list",
  "keyword": "..."
})
```

---

## action: rename
重命名标签（会同步更新所有笔记中的该标签）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `old` | `string` | 是 | Old tag label (for rename) | - |
| `new` | `string` | 是 | New tag label (for rename) | - |

### 使用示例

```javascript
tag({
  "action": "rename",
  "old": "...",
  "new": "..."
})
```

---

## action: remove
删除指定的标签（会从所有笔记中移除该标签文本） (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `label` | `string` | 是 | Tag label (for remove) | - |

### 使用示例

```javascript
tag({
  "action": "remove",
  "label": "..."
})
```

---

