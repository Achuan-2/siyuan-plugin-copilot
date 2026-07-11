---
name: asset
description: Asset management. Actions: upload(id, files=comma-separated absolute paths), unused(), clean(path?), stat(path).
---

# asset

## action: upload
上传本地文件到思源笔记资源文件夹中

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `id` | `string` | 是 | Document block ID (for upload) | - |
| `files` | `string` | 否 | Comma-separated absolute file paths (for upload) | - |

### 使用示例

```javascript
asset({
  "action": "upload",
  "id": "20200812220555-w7m19sc",
  "files": "..."
})
```

---

## action: unused
查找笔记本中所有未使用的资源文件

*该 action 无其他参数。*

### 使用示例

```javascript
asset({
  "action": "unused"
})
```

---

## action: clean
清理/删除指定的未使用的资源文件

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 否 | Single unused asset path to remove, relative to data directory (for clean, optional). Use as returned by the unused action, e.g. assets/image/xxx.png. | - |

### 使用示例

```javascript
asset({
  "action": "clean",
  "path": "..."
})
```

---

## action: stat
获取资源文件的统计状态（如大小、是否存在等） (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Single unused asset path to remove, relative to data directory (for clean, optional). Use as returned by the unused action, e.g. assets/image/xxx.png. | - |

### 使用示例

```javascript
asset({
  "action": "stat",
  "path": "..."
})
```

---

