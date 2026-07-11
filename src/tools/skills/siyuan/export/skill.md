---
name: export
description: Export operations. Actions: md(id), html(id), preview(id), docx(id, output path), sy(id) → .sy.zip, md-zip(id), data() → full workspace backup.
---

# export

## action: md
导出指定块或文档为 Markdown 文本内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |

### 使用示例

```javascript
export({
  "action": "md",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: html
导出指定块或文档为 HTML 格式文本内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |

### 使用示例

```javascript
export({
  "action": "html",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: preview
获取导出为 HTML 格式的预览网页内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |

### 使用示例

```javascript
export({
  "action": "preview",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: docx
导出指定文档并保存为本地 Word (.docx) 文件

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |
| `output` | `string` | 是 | Output file path (required for docx, optional for others) | - |

### 使用示例

```javascript
export({
  "action": "docx",
  "id": "20200812220555-w7m19sc",
  "output": "..."
})
```

---

## action: sy
将指定文档包导出为思源专有的 .sy.zip 备份压缩包 (.sy.zip)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |

### 使用示例

```javascript
export({
  "action": "sy",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: md-zip
将文档及其关联资源打包导出为 Markdown 压缩包

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for md, html, preview, docx, sy, md-zip) | - |

### 使用示例

```javascript
export({
  "action": "md-zip",
  "id": "20200812220555-w7m19sc"
})
```

---

## action: data
执行工作区全量备份，导出 full_data.zip 备份压缩包 (full workspace backup.)

*该 action 无其他参数。*

### 使用示例

```javascript
export({
  "action": "data"
})
```

---

