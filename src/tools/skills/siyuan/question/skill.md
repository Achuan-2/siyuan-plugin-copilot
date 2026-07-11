---
name: question
description: Ask the user questions to clarify needs/preferences (do NOT use for plain-text option lists). questions[]: each {header (short label), question, options[] {label, description}, multiple?, custom?}.
---

# question

### 参数说明

| 参数名 | 类型 | 必填 | 描述 | 可选值 |
| --- | --- | --- | --- | --- |
| `questions` | `array` | 否 | Array of questions to ask the user | - |
| `header` | `string` | 否 | Very short label (max 30 chars) | - |
| `question` | `string` | 否 | Complete question text | - |
| `options` | `array` | 否 | Available choices for this question | - |
| `label` | `string` | 是 | Display text (1-5 words, concise) | - |
| `description` | `string` | 是 | Explanation of this choice | - |

### 使用示例

```javascript
question({
  "questions": "...",
  "header": "...",
  "question": "...",
  "options": "...",
  "label": "...",
  "description": "..."
})
```
