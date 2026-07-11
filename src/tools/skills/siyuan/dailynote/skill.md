---
name: dailynote
description: Daily note operations. Actions: create(notebook) — create/open today's note, append(notebook, data, dataType?) / prepend(...) add a block.
---

# dailynote

## action: create
创建或打开今天（或指定日期）的日记文档 (create/open today's note)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID | - |

### 使用示例

```javascript
dailynote({
  "action": "create",
  "notebook": "20211229091211-7v5p54a"
})
```

---

## action: append
在今天（或指定日期）的日记末尾追加新内容块 (add a block.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID | - |
| `data` | `string` | 是 | Content in markdown or dom (for append/prepend) | - |
| `dataType` | `string` | 否 | Content type: markdown or dom | `"markdown"`, `"dom"` |

### 使用示例

```javascript
dailynote({
  "action": "append",
  "notebook": "20211229091211-7v5p54a",
  "data": "...",
  "dataType": "markdown"
})
```

---

## action: prepend
在今天（或指定日期）的日记开头插入新内容块

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID | - |
| `data` | `string` | 是 | Content in markdown or dom (for append/prepend) | - |
| `dataType` | `string` | 是 | Content type: markdown or dom | `"markdown"`, `"dom"` |

### 使用示例

```javascript
dailynote({
  "action": "prepend",
  "notebook": "20211229091211-7v5p54a",
  "data": "...",
  "dataType": "markdown"
})
```

---

