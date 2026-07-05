创建或更新自定义 Skill 的 skill.md 内容。

## 何时使用
- 仅在 Agent 模式中由用户启用后使用。
- 当用户明确要求创建新的 Skill、把当前经验沉淀为 Skill、或更新已有 Skill 的执行说明时调用。
- 如果要更新已有 Skill，建议先调用 `read_skill` 读取原内容，再生成完整的新 `skill.md` 内容后写回。

## 参数
- skillId: Skill 标识符，会保存到 `data/storage/ai/agent/skills/{skillId}/skill.md`。不能包含路径分隔符或文件名非法字符。
- content: 完整的 `skill.md` Markdown 内容。建议包含 YAML Frontmatter，例如 `name` 和 `description`。
- name: 可选。`content` 缺少 YAML Frontmatter 时，用于自动补全 Frontmatter 的 Skill 名称。
- description: 可选。`content` 缺少 YAML Frontmatter 时，用于自动补全 Frontmatter 的 Skill 描述。
- blockIds: 可选。思源块 ID 列表。提供后会写入或更新 `siyuan-plugin-copilot:skill-blocks` 标记，使 Skill 内容从这些块展开。

## 注意事项
- 本工具会覆盖目标 Skill 的 `skill.md`，不是增量追加。
- `content` 缺少 YAML Frontmatter 时会自动添加，但为了让 Skill 列表展示准确，最好显式提供 `name` 和 `description`。
- 使用 `blockIds` 时，`content` 可以只包含 Frontmatter 和补充说明；实际工作流内容会在读取 Skill 时从对应思源块导出。
