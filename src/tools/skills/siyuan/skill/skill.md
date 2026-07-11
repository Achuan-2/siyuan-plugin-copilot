---
name: skill
description: Skill operations: load(name), save(name, content), install(url), remove(name), rename(name, new_name), list().
---

# skill

## action: load
加载指定自定义 Skill 的 SKILL.md 文档内容

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Skill name (directory name) | - |

### 使用示例

```javascript
skill({
  "action": "load",
  "name": "..."
})
```

---

## action: save
创建或更新自定义 Skill 并保存其 SKILL.md 文档

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Skill name (directory name) | - |
| `content` | `string` | 是 | SKILL.md full content with YAML frontmatter (for save) | - |

### 使用示例

```javascript
skill({
  "action": "save",
  "name": "...",
  "content": "..."
})
```

---

## action: install
从 GitHub 仓库、直链或 ZIP 安装自定义 Skill

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `url` | `string` | 是 | Skill source for install: 'owner/repo' shorthand (e.g. Tencent/WeChatReading), a full GitHub URL, a raw SKILL.md URL, or a release zip URL | - |

### 使用示例

```javascript
skill({
  "action": "install",
  "url": "..."
})
```

---

## action: remove
删除指定的自定义 Skill 文件夹

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Skill name (directory name) | - |

### 使用示例

```javascript
skill({
  "action": "remove",
  "name": "..."
})
```

---

## action: rename
重命名指定的自定义 Skill

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `name` | `string` | 是 | Skill name (directory name) | - |
| `new_name` | `string` | 是 | New skill name (for rename) | - |

### 使用示例

```javascript
skill({
  "action": "rename",
  "name": "...",
  "new_name": "..."
})
```

---

## action: list
列出当前加载的所有自定义 Skill

*该 action 无其他参数。*

### 使用示例

```javascript
skill({
  "action": "list"
})
```

---

