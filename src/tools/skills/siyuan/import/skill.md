---
name: import
description: Import operations (absolute local paths). Actions: md(notebook, path, targetPath?), sy(notebook, path, targetPath?) — .sy.zip, data(path) — full backup zip.
---

# import

## action: md
从本地绝对路径导入 Markdown 文件到思源指定目录下

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID (for md, sy) | - |
| `path` | `string` | 是 | Absolute local file path | - |
| `targetPath` | `string` | 否 | Target internal filesystem path (for md, sy; default /). This is the ID-based path like /2022...ws.sy, not hPath. | - |

### 使用示例

```javascript
import({
  "action": "md",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "targetPath": "..."
})
```

---

## action: sy
从本地绝对路径导入 .sy.zip 备份包文件为思源笔记文档 (.sy.zip)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `notebook` | `string` | 是 | Notebook ID (for md, sy) | - |
| `path` | `string` | 是 | Absolute local file path | - |
| `targetPath` | `string` | 否 | Target internal filesystem path (for md, sy; default /). This is the ID-based path like /2022...ws.sy, not hPath. | - |

### 使用示例

```javascript
import({
  "action": "sy",
  "notebook": "20211229091211-7v5p54a",
  "path": "...",
  "targetPath": "..."
})
```

---

## action: data
从本地绝对路径的备份包还原思源笔记的全量数据 (full backup zip.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Absolute local file path | - |

### 使用示例

```javascript
import({
  "action": "data",
  "path": "..."
})
```

---

