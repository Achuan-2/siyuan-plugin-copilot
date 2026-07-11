---
name: workspace
description: Workspace management. Actions: list(), info() (path, version, valid).
---

# workspace

## action: list
列出所有已注册的思源笔记工作区路径

*该 action 无其他参数。*

### 使用示例

```javascript
workspace({
  "action": "list"
})
```

---

## action: info
获取当前活动工作区的详细配置信息 ((path, version, valid).)

*该 action 无其他参数。*

### 使用示例

```javascript
workspace({
  "action": "info"
})
```

---

