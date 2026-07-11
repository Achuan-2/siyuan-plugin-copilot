---
name: sql
description: Read-only SQL on SiYuan's database. Action: query(stmt) — SELECT only.
---

# sql

## action: query
SELECT only.

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `stmt` | `string` | 是 | SQL SELECT statement | - |

### 使用示例

```javascript
sql({
  "action": "query",
  "stmt": "SELECT * FROM blocks WHERE content LIKE '%key%' LIMIT 10"
})
```

---

