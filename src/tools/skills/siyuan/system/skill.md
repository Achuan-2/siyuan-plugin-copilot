---
name: system
description: System info. Actions: version(), current_time(), workspace().
---

# system

## action: version
获取思源笔记内核和前端的版本号

*该 action 无其他参数。*

### 使用示例

```javascript
system({
  "action": "version"
})
```

---

## action: current_time
获取思源笔记系统的当前时间

*该 action 无其他参数。*

### 使用示例

```javascript
system({
  "action": "current_time"
})
```

---

## action: workspace
获取思源笔记当前工作区的目录绝对路径 (.)

*该 action 无其他参数。*

### 使用示例

```javascript
system({
  "action": "workspace"
})
```

---

