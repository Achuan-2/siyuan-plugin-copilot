---
name: sync
description: Data sync operations. Actions: perform() (full upload+download), upload(), download(), status().
---

# sync

## action: perform
执行一次完整的数据云同步（包含上传和下载） ((full upload+download))

*该 action 无其他参数。*

### 使用示例

```javascript
sync({
  "action": "perform"
})
```

---

## action: upload
将本地笔记数据上传到云端备份

*该 action 无其他参数。*

### 使用示例

```javascript
sync({
  "action": "upload"
})
```

---

## action: download
从云端下载最新笔记数据到本地

*该 action 无其他参数。*

### 使用示例

```javascript
sync({
  "action": "download"
})
```

---

## action: status
获取当前的云同步状态（如未同步变动、冲突状态等） (.)

*该 action 无其他参数。*

### 使用示例

```javascript
sync({
  "action": "status"
})
```

---

