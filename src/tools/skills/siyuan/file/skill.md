---
name: file
description: Workspace file operations (paths relative to workspace; debugging/log reading only — never use for workspace data). Actions: list(path, limit=200, 0/-1=unlimited), read(path, offset, limit; default 200 lines, limit=-1 for full), write(path, data), delete(path), rename(old, new), copy(src, dst), grep(pattern, path, include?, context?, limit=200), find(path, include?, limit=200), stat(path).
---

# file

## action: list
列出工作区路径下的文件和子目录列表（非笔记数据文件）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |
| `limit` | `number` | 否 | Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited. | - |

### 使用示例

```javascript
file({
  "action": "list",
  "path": "...",
  "limit": "..."
})
```

---

## action: read
读取工作区中的配置文件或日志等普通文件内容（非 .sy 文件）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |
| `offset` | `number` | 是 | Line number to start reading from (for read, 1-based). Negative means N lines from the end. Default: 0 (read from beginning). | - |
| `limit` | `number` | 否 | Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited. | - |

### 使用示例

```javascript
file({
  "action": "read",
  "path": "...",
  "offset": "...",
  "limit": "..."
})
```

---

## action: write
写入数据到工作区中指定路径的文件（用于调试或配置文件）

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |
| `data` | `string` | 是 | File content (for write) | - |

### 使用示例

```javascript
file({
  "action": "write",
  "path": "...",
  "data": "..."
})
```

---

## action: delete
删除工作区指定路径的文件

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |

### 使用示例

```javascript
file({
  "action": "delete",
  "path": "..."
})
```

---

## action: rename
重命名工作区的文件或路径

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `old` | `string` | 是 | Source path (for rename) | - |
| `new` | `string` | 是 | Destination path (for rename) | - |

### 使用示例

```javascript
file({
  "action": "rename",
  "old": "...",
  "new": "..."
})
```

---

## action: copy
复制工作区指定路径的文件到新路径

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `src` | `string` | 是 | Source path (for copy) | - |
| `dst` | `string` | 是 | Destination path (for copy) | - |

### 使用示例

```javascript
file({
  "action": "copy",
  "src": "...",
  "dst": "..."
})
```

---

## action: grep
在指定路径的文件内容中进行全文搜索匹配 (grep)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `pattern` | `string` | 是 | Regex pattern to search for (for grep) | - |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |
| `include` | `string` | 否 | File glob pattern to filter files (for grep, find; e.g. "*.go\ | - |
| `context` | `number` | 否 | Number of context lines before and after each match (for grep, default 0) | - |
| `limit` | `number` | 否 | Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited. | - |

### 使用示例

```javascript
file({
  "action": "grep",
  "pattern": "...",
  "path": "...",
  "include": "...",
  "context": "...",
  "limit": "..."
})
```

---

## action: find
在指定目录下递归查找符合命名模式的文件 (find)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |
| `include` | `string` | 否 | File glob pattern to filter files (for grep, find; e.g. "*.go\ | - |
| `limit` | `number` | 否 | Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited. | - |

### 使用示例

```javascript
file({
  "action": "find",
  "path": "...",
  "include": "...",
  "limit": "..."
})
```

---

## action: stat
获取指定工作区文件的属性（大小、修改时间、是否存在等） (.)

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `path` | `string` | 是 | Relative path within workspace (for list, read, write, delete, grep, find, stat) | - |

### 使用示例

```javascript
file({
  "action": "stat",
  "path": "..."
})
```

---

