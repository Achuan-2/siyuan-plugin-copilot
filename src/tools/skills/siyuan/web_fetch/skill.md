---
name: web_fetch
description: Fetch a web page and convert to Markdown or text. url (http/https), format: markdown (default) or text.
---

# web_fetch

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 是 | The page URL to fetch (must start with http:// or https://) | - |
| `format` | `string` | 否 | Output format: 'markdown' or 'text' (default 'markdown') | `"markdown"`, `"text"` |

### 使用示例

```javascript
web_fetch({
  "url": "...",
  "format": "markdown"
})
```
