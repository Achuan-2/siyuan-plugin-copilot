---
name: todo_write
description: Maintain a session task list (each call replaces the list). todos[]: each {content, status: pending|in_progress|completed|cancelled}.
---

# todo_write

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `todos` | `array` | 否 | The updated todo list | `"pending"`, `"in_progress"`, `"completed"`, `"cancelled"` |
| `content` | `string` | 是 | Brief task description | - |
| `status` | `string` | 是 | Task status | `"pending"`, `"in_progress"`, `"completed"`, `"cancelled"` |

### 使用示例

```javascript
todo_write({
  "todos": "pending",
  "content": "...",
  "status": "pending"
})
```
