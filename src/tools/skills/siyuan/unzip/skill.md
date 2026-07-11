---
name: unzip
description: Extract a zip archive within the workspace. Provide the workspace-relative path to the zip file and the destination directory (also workspace-relative). The destination will be created if it does not exist.
---

# unzip

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `zipPath` | `string` | 是 | Workspace-relative path to the .zip file to extract. | - |
| `destPath` | `string` | 是 | Workspace-relative destination directory to extract into. | - |

### 使用示例

```javascript
unzip({
  "zipPath": "...",
  "destPath": "..."
})
```
