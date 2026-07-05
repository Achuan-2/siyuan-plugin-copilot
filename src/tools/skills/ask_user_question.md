向用户弹出 question card（问卷卡片）并收集答案。调用后插件会暂停执行，直到用户填写并提交，答案会作为 tool result 返回给你。

## 何时使用
- 需要用户从多个选项中选择（单选/多选）
- 需要用户输入一段文本才能继续
- 需要确认用户偏好、风格、范围、语言等
- 不应该替用户做决定时

## 参数说明

### questions (必填)
问题列表，每个问题是一个对象：

- **id** (string, 必填)：问题唯一标识，答案返回时会以此作为 key。
- **type** (string, 必填)：问题类型，可选值：
  - `"single"`：单选
  - `"multiple"`：多选
  - `"text"`：文本输入
- **title** (string, 必填)：问题标题。
- **description** (string, 可选)：补充说明，显示在标题下方。
- **options** (array, 单选/多选必填)：选项列表，每项包含：
  - **label** (string, 必填)：显示文本。
  - **value** (string, 可选)：提交值，省略时使用 label。
  - **description** (string, 可选)：选项额外说明。
- **required** (boolean, 可选)：是否必填，默认为 false。
- **placeholder** (string, 可选)：text 类型的输入框占位提示。

### submitButtonText (可选)
提交按钮文本，默认为“提交”。

## 使用示例

```javascript
// 单选：确认回答风格
ask_user_question({
  questions: [
    {
      id: "style",
      type: "single",
      title: "选择回答风格",
      description: "你希望我以哪种风格继续？",
      required: true,
      options: [
        { label: "简洁", value: "concise" },
        { label: "详细", value: "detailed" },
        { label: "带示例", value: "with_examples" }
      ]
    }
  ]
})

// 多选 + 文本输入
ask_user_question({
  questions: [
    {
      id: "languages",
      type: "multiple",
      title: "需要翻译为哪些语言？",
      required: true,
      options: [
        { label: "英文", value: "en" },
        { label: "日文", value: "ja" },
        { label: "法文", value: "fr" }
      ]
    },
    {
      id: "notes",
      type: "text",
      title: "补充说明",
      placeholder: "输入任何额外要求…"
    }
  ]
})
```

## 返回结果
用户提交后，返回 JSON 对象，key 为问题 id，value 为：
- single：选中的 value（string）
- multiple：选中的 value 数组（string[]）
- text：输入文本（string）

示例：
```json
{
  "style": "detailed",
  "languages": ["en", "ja"],
  "notes": "请使用正式语气"
}
```

## 注意事项
- 一次调用可以包含多个问题，它们会渲染在同一张卡片上。
- 调用后必须等待用户提交，不能在同一轮 tool_calls 里混合其他需要立即执行的工具。
- 如果用户未选择必填项，提交按钮会被禁用。
- 问题标题和描述来自你，注意语言与用户保持一致。
