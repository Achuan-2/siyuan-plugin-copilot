---
name: outline
description: Document outline (heading tree). Action: get(id).
---

# outline

## action: get
获取指定文档的大纲结构（标题树层级及 ID） (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID | - |

### 使用示例

```javascript
outline({
  "action": "get",
  "id": "20200812220555-w7m19sc"
})
```

---

