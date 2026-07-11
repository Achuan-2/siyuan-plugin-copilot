---
name: frontend
description: Frontend/UI actions in the SiYuan editor (run in the browser; may change what the user sees). Actions: open_setting(query?), focus_block(id), open_document(id), open_search(query?). Plugins may register more — see <plugin_actions> and invoke by full name (e.g. plugin__myplugin__myaction).
---

# frontend

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `action` | `string` | 是 | Operation | - |
| `id` | `string` | 否 | Block or document ID (for focus_block and open_document) | - |
| `query` | `string` | 否 | Search keyword (for open_setting to locate a config item, for open_search to pre-fill the search box) | - |

### 使用示例

```javascript
frontend({
  "action": "...",
  "id": "...",
  "query": "..."
})
```
