## v2.7.2  / 20260717
- 🎨 小程序集合侧栏：只显示顶部的全屏按钮，移除每个小程序单独的全屏按钮
- 🐛 生图模式目前无法选择模型，问答模式选了模型，切换到生图模式，始终为问答模式之前的模型，怎么修改都无法修改为画图模型
- ♻️ 开发者：pnpm build也要把dist文件复制到思源插件文件夹


## v2.7.1 / 20260712
- 🎨 工具选择对话框优化：顶部添加搜索框，可以搜索工具，并添加一个筛选按钮，可以快速筛选已选择工具


## v2.7.0 / 20260712
- ✨ 新增侧栏小程序集合dock，可统一在一个dock打开所有小程序
- 🌐 开发者：改进i18n，取消父子json结构，变为平铺，i18n键使用驼峰拼写，这样方便直接根据i18n键就能快速找到对应翻译

## v2.6.0 / 20260711
- ✨ 思源相关工具替换为思源官方MCP工具
- ✨ 支持加载任务笔记管理插件的工具调用skill
- 🎨 问答、agent、画图模式提示词区别
- 🎨 手机端打开平台管理交互优化
- 🎨 优化不同模型的思考程度设置
- 🎨 内置平台支持编辑官网链接和名称
- 🎨 生图模式仅生成文字时优化，输出生成的文字
- 🎨 生图模式选择的模型单独记忆，切换到其他模式，不保留
- 🐛 当问答模式多模型对话，切换到agent模式单模型的时候，显示的上下文用量依然错误显示多个模型而不是仅显示一个模型
- 🐛 预设选择模型，如果清空了模型，依然会错误在模型列表中原先的模型左边显示数字角标1
- 🐛 注册小程序到侧栏，每次启动思源都错误自动打开小程序侧栏

## v2.5.1 / 20260706
- 🎨 输入框优化列表输入

## v2.5.0 / 20260705
- 🎨 支持输入／调用skill，支持输入@搜索文档
- 🎨 skills 文件夹改为存放在/data/storage/ai/agent/skills/，与思源agent一致
- 🎨 工具：Agent模式支持AI生成question card
- 🎨 支持计算上下文用量
- 🎨 工具：updateBlock 工具结果返回简化，节省token消耗
- 🐛 预设修改模型，没有及时更新选择的模型


## v2.4.4 / 20260630

- 🎨 小程序支持注册到侧边栏（目前有bug：Ctrl+Shift+I无法快捷打开思源开发者工具，目前无法修复）
- 🎨 小程序禁用开发者工具

## v2.4.3 / 20260608

- 🎨 后台代理隐藏进高级设置，超时时间增加

## v2.4.2 / 20260525

- 🎨 多模型问答调用工具优化
- 🎨 get_siyuan_skills只返回当前选用的工具，避免暴露所有工具
- 🎨 新增create_skill

## v2.4.1 / 20260524

- 🎨 skill列表优化：不显示skill目录

## v2.4.0 / 20260524

- ✨ 支持创建和调用skill
- 🎨 完善思源 forwardProxy 代理支持,感谢[BorisZhangYYY](https://github.com/BorisZhangYYY)
  贡献 ([#148](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/148))
- 🎨 模型预设支持添加块为prompt，支持添加多个块
- 🎨 网页小程序:  http 以及 www 开头网址的支持
- 🎨 改造工具调用，工具描述使用md存储，借鉴skills设计，方便查看编辑，用户也可以自行修改

## v2.3.11 / 20260428

- 🎨 生图模式在“正在生成/编辑图片”时，现在也会显示和对话模式一致的三个点跳
  动效果
- 🎨 生图模式支持预设提示词

## v2.3.10 / 20260428

- 🎨 适配DeepSeek v4模型非思考时调用工具
- 🎨 适配kimi 2.6模型非思考时调用工具
- 🐛 调用工具后，调用工具前面生成的AI对话内容会被吞掉

## v2.3.9 / 20260425

- 🎨 新增生图模式
- 🎨 支持搜索历史会话

## v2.3.8 / 20260422

- 🎨 识别kimi 2.6模型为思考模型

## v2.3.7 / 20260420

- 🎨 内置平台新增MiniMax
  - 🎨 支持搜索minimax模型
  - 🎨 适配MiniMax 2.7 thinking回答
- 🎨 支持设置聊天接口
- 🎨 预设编辑移除已删除的编辑模式

## v2.3.6 / 20260328

- ✨ 新增版本更新提醒弹窗
- 🎨 提示词优化：提示词插入到输入框最前而不是替换输入框内容，提示词列表支持拖动排序，以及侧栏和弹窗提示词列表同步
- 🎨 优化自定义平台URL设置， 如果以/chat/completions结尾，则视为完整对话端点
- 🎨 模型搜索支持折叠平台
- 🎨 平台支持开关和搜索，删除平台隐藏到右键菜单
- 🎨 设置界面和模型搜索适配手机端
- 🐛 自定义平台无法使用翻译功能
- 🐛 Gemini 图片生成接口使用 Authorization: Bearer 认证导致 API Key 用户请求失败 [#129](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/129)

## v2.3.5 / 20260323

- 🔥 arial-label改为title
- 🌐 i18n 优化

## v2.3.4 / 20260322

- 🐛 fix: 模型选择器 tooltip 切换模型后不更新

## v2.3.2 / 20260322

- 🎨 优化gemini生图

## v2.3.1 / 20260321

- 🎨 兼容gemini调用工具

## v2.3.0 / 20260321

- 🔥 移除编辑模式，agent模式支持更新块/插入块查看差异
- 🎨 删除标题，自动把子块删除
- 🎨 设置界面适配移动端

## v2.2.4 / 20260320

- 🐛 多模型问答样式优化：思考和工具调用不挤压回答空间
- 🐛 问答模式的get_siyuan_skills不罗列编辑工具给AI

## v2.2.3 / 20260320

- 🐛修复多模型回答多轮会导致之前消息被覆盖问题

## v2.2.1 / 20260318

- 🐛 多模型问答：kimi k2.5调用工具重新生成报错
- 🎨 多模型问答历史对话保留工具调用过程

## v2.2.0 / 20260318

- 🎨 新增运行js工具，支持管道操作，节省sql等命令token
- 🎨 新增运行python工具
- 🎨 siyuan_get_block_content新增command命令

## v2.1.0 / 20260318

- 🎨 优化思考过程中的工具调用显示
- 🎨 启用SOUL，会自动获取SOUL问答，添加到系统提示词后
- 🎨 问答模式支持工具调用
- 🎨 多模型回答重复保存问题
- 🎨 支持跨平台复制AI生成的回答
- 🎨 历史会话支持右键保存为笔记
- 🎨 工具选择: 添加类别全选/取消全选功能
- 💄 样式优化：工具选择按钮和思考模式重叠问题

## v2.0.4 / 20260315

- 🎨 记忆对话模式
- 🎨 适配gemini工具调用

## v2.0.3 / 20260314

- 🎨 样式优化：工具选择按钮和思考模式重叠问题

## v2.0.2 / 20260313

- 🎨 agent模式样式：优化工具选择按钮和思考模式布局

## v2.0.0 / 20260312

- 🎨 数据库工具拆分
- 🎨 新增创建子文档工具
- 🐛 优化之前上下文限制为10导致内容不够用，而导致agent一直重复执行
- 🐛 agent模式：重新生成没有调用工具
- 🐛 多模型对话：重复问题

## v1.9.0 / 20260312

- 🎨 适配claude模型调用工具
- 🎨 新增工具
  - SOUL
  - 系统通知
  - 获取当前时间
  - 删除块
  - 调用思源任意API工具

## v1.8.0 / 20260312

- 🎨 添加web_fetch工具，支持获取网页内容，遇到防爬的网页，会自动使用webview打开（比如知乎，需要先用小程序功能登录，这样就可以获取知乎文章了）
- 🎨 新增get_siyuan_skills工具，自动调用工具具体使用技巧，节省token
- 🎨 insertBlock工具：可以直接通过markdown插入多个块，无需一次插入一个块
- 🎨 适配kimi k2.5不思考模式：官方默认设置thinking: {type: "enabled"}，不思考时需要设置 thinking: {type: "disabled"}，kimi k2.5不能设置temperature
- 🐛 agent模式丢失块上下文

## v1.7.0 / 20260309

- 🎨 新增一键添加当前文档、右键AI总结、全局按钮悬浮提示 (感谢[ocean-zhc](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/114)贡献)
  - 🎨 新增"添加当前文档到上下文"按钮，一键将当前打开的文档添加为AI上下文
  - 🎨 新增文档树右键菜单"AI 总结文章"功能，右键文档即可自动总结
  - 🎨 所有按钮添加悬浮提示（使用思源原生 b3-tooltips），涵盖顶部工具栏、消息操作栏、底部按钮栏和模型预设按钮
- 🎨 不支持webview的平台使用iframe加载网页
- 🎨 链接添加右键菜单，在页签打开链接

## v1.6.13 / 20260228

- 🐛 Fix Nano Banana image generation compatibility issues，感谢[altairwei](https://github.com/Achuan-2/siyuan-plugin-copilot/pull/112)贡献

## v1.6.12 / 20260224

- 🎨 在 WebView 中打开链接默认为false

## v1.6.11 / 20260210

- 🎨 优化Markdown渲染任务列表样式

## v1.6.10 / 20260210

- 🎨交互输入输出语言，不交换textarea

## v1.6.9 / 20260210

- 🎨 webapp：顶栏支持谷歌搜索和bing搜索
- 🎨 webapp：添加devtools

## v1.6.8 / 20260209

- 🎨 网页图标存储在webappIcon文件夹下

## v1.6.7 / 20260210

- 🎨 webapp:优化链接打开监听
- 🎨 小程序添加页内搜索功能

## v1.6.6 / 20260209

- 🎨 网页小程序页签图标优化，支持打开新网页就加载新图标
- 🎨 webapp 记录浏览历史，支持输入文字快速进入历史页面
- 🎨 点击思源笔记中的 https 链接时，支持在内置 WebView 标签页中打开

## v1.6.5/ 20260209

- 🎨网页小程序优化，接近浏览器体验
  - 支持快捷键前进后退
  - 支持按Ctrl+Click在新标签页打开
  - 支持复制标签页

## v1.6.0 / 20260207

- ✨ 小程序功能
- ✨ 翻译对话框功能
- ✨ 支持网页链接获取内容
- 🎨 对于gemini模型支持开启模型联网能力
- 🎨 优化平台模型设置界面
- 🎨 多选模型也支持设置模型思考
- 🎨 添加模型时，需要根据模型名称，自动添加模型能力
- 🎨 预设默认不设置temperature
- 🎨 支持设置多模型默认视图为页签视图还是卡片视图
- 🎨 多模型采纳回答后也支持切换视图

## v1.5.3 / 20260206

- 🎨 预设点击设置模型，模型的弹窗位置优化，避免超出屏幕范围
- 🎨 多模型采纳回答后也支持切换视图
- 🎨 支持设置多模型默认视图为页签视图还是卡片视图
- 🎨 对于gemini-3-pro-模型，ai-sidebar__thinking-effort-select应该只能选择默认、低和高

## v1.5.2 / 20260205

- 🎨 Auto-rename 只在用户发出消息之后重命名，放弃ai回复后又再重命名

## v1.5.1 / 20260205

- 🎨 优化预设交互

## v1.5.0 / 20260205

- 🎨 V3 API移除内置平台，添加Achuan-2 API
- 🎨 生图优化，兼容生图如果图片是base64，自动保存为图片

## v1.4.0 / 20260204

- 🎨 单模型和多模型合并为一个组件
- 🎨 优化窄窗口布局

## v1.3.1 / 20260131

- 🎨 模型默认思考改为low（Gemini 3 Pro 只支持low和high，没有medium）

## v1.3.0 / 20260131

- 🎨 优化预设交互：支持模型搜索、预设搜索
- 🎨 多选模型：一个模型支持多次选择

## v1.2.0 / 20260131

- 🎨 如果模型预设没有开启temperature，默认使用平台设置的模型temperature
- 🎨 平台的模型自定义参数默认折叠
- 🎨 重新生成改进：重新生成始终采用用户选择的多模型或单模型方案，感谢[@lisontowind](https://github.com/lisontowind)
- 🎨 公式转义允许 $ 后面紧跟数字，如果输入价格之类的需要手动转义，感谢[@lisontowind](https://github.com/lisontowind)
- 🎨 修复代码块和公式混合复制，感谢[@lisontowind](https://github.com/lisontowind)
- 🎨 改进模型预设选择交互：直接弹出预设列表进行选择和修改
- 🎨 调用AI生成标题使用模型设置的temperature
- 🎨 AI还没生成内容有等待效果
- 🎨 每个session使用putfile单独存储为json文件sessions/sessionsID.json
- 🎨 图片附件保存为图片，不使用base64存储，减少session.json体积

## v1.1.0 / 20260121

- 🎨 支持公式复制 ([#102](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/102))，感谢[@lisontowind](https://github.com/lisontowind)

## v1.0.0 / 20260118

- 🎨 预设多选模型支持设置模型顺序
- 🎨 输入框禁用拼写检查
- 📝 更新README

## v0.9.2 / 20251227

- 🎨 添加删除提示词功能 ([#95](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/95)),感谢[MaplumeX](https://github.com/MaplumeX)贡献
- 🎨 优化上下文拖动

## v0.9.1 / 20251221

- 🎨 json支持检查，格式化和嵌套 ([#87](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/87))
- 🐛 修复部分回复无法显示问题 ([#89](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/89))

## v0.9.0 / 20251217

- 🎨 agent添加数据库工具 [#60](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/60)
- 🎨 agent 模式支持获取块属性和设置块属性功能  [#84](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/84)
- 🎨 新增对 DeepSeek V3.2思考中工具调用 的支持，避免在agent模式下返回报错——推理内容缺失 ([#83](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/83))，感谢[@zx2021210538](https://github.com/zx2021210538)贡献
- 🎨 agent添加获取文档树工具
- 🎨 agent模式的调用工具默认折叠，但是展开查看工具调用参数和结果默认展开
- 🎨 预设支持拖动排序
- 🐛 thinking模式报错问题
- 🐛 Failed to initialize KaTeX [#85](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/85)
- 🐛 i18n数据不可用，使用key作为后备: toolbar.aiChat
- 🐛 多模型回答，不会自动重命名会话标题 [#82](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/82)

## v0.8.0 / 20251213 预设支持选择模型，支持根据场景快速切换模型

- 🎨添加预设模型功能，设置不同场景快速选择模型 [#73](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/73)

## v0.7.0 / 20251212

- ✨ 右键支持选中文本，选择是复制Markdown、纯文本还是富文本，默认选中文本复制是Markdown #80
  - 🎨多模型回答没选择答案时也支持复制纯文本和富文本，不显示其他按钮
- 🎨改进模型预设：选择预设支持在聊天框显示名称 ([#81](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/81))，感谢[@B3000Kcn](https://github.com/B3000Kcn)贡献
- 🎨改进模型预设：temperatue添加一个checkbox，选择是否开启调整，如果关闭，则不应用预设的temperature值
- 🎨支持会话重命名标题，支持AI自动设置标题  [#57](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/57)
- 🐛copilot 初始化hljs，会错误影响third-languages.js注册 [#76](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/76)

## v0.6.0 / 20251203

- ✨添加思考模式快速切换按钮 [#69](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/69)
- 🎨支持Gemini openAI格式thinking
- 🎨支持Claude openAI格式thinking
- 🎨数学公式居中
- 🎨多选模型提问代码块样式优化
- 🐛路径保存多出笔记本路径 [#58](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/58)
- 🐛 拖动文档会错误选择其他文档 [#63](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/63)
- 🐛代码块高亮初始化优化 [#72](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/72)
- 🐛 多选模型回答代码块丢失高亮 [#59](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/59)
- 🐛拖动多模型模型排序，会意外触发拖动上下文 [#70](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/70)

## v0.5.1 / 20251123

- ♻️ refactor(api): 支持多种响应格式以获取模型 [#26](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/26)
- 尝试多种可能的响应格式以支持自定义API
- 处理不同格式的model对象

## v0.5.0 /20251116

- 🎨优化多模型回答思考过程不显示
- ♻️ 把侧栏注册放在onLayoutRead

## v0.4.9 / 20251115

- 🐛 预设保存优化 [#54](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/54)

## v0.4.8 / 20251115

- 🐛 多模型回答：连续对话没有包含上次选择的回答 #53
- 🐛 网页版本无法直接打开回答中的思源块链接
- ✨ feat(工具): 添加 appendParentID 参数以支持后置子块插入（比如给文档末尾插入块）

## v0.4.7 / 20251114

- ✨ 多模型回答，在选定答案之前，支持重新生成  [#50](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/50)

## v0.4.6 / 20251110

- 🎨 多模型选择的dropdown，支持调整选中模型的顺序，来更改显示多模型回答的顺序
- 🐛 代码块第一行会被错误隐藏 [#47](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/47)

## v0.4.5/ 20251110

- 🐛 fix(复制功能): 优化插件内复制行为
  - 仅在插件消息容器内处理复制，避免影响全局复制
  - 确保选区位于消息内容元素内
  - 保留默认复制行为当消息容器不存在

## v0.4.4 / 20251110

- 💄 多模型dropdown窗口优化 [#44](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/44)
- 🐛 多模型回答无法终止 [#43](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/43)

## v0.4.3 / 20251110

- 🐛 错误遗漏V3 API的模型

## v0.4.2 / 20251110

- 🎨 点击查看历史对话的内容，要跳到最开头，目前默认是最末尾 [#42](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/42)
- 🎨 上下文消息添加复制按钮 [#41](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/41)

## v0.4.1 / 20251109

- 🎨 思考过程默认折叠 [[[#40](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/40)](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/40)](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/40)
- 🎨 顶栏添加打开全屏按钮 [[#39](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/39)](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/39)
- 🎨 优化多模型响应显示方式

## v0.4.0 / 20251109

- ✨ 聊天框下方添加一个模型设置按钮

  - 使用iconEdit图标、
  - 每个设置有checkbox进行开关
  - 支持设置上下文数
  - 支持临时修改模型Temperature
  - 支持临时修改系统提示词
  - 支持保存预设和加载某个预设
- ✨ feat(会话管理): 添加批量删除会话功能

  - 实现多选模式，允许用户选择多个会话
  - 添加全选/取消全选功能
  - 提供批量删除选中会话的操作
  - 更新会话列表以避免多页签覆盖问题
- 🎨 优化多页签问答的聊天历史记录保存问题 [#28](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/28)
- 🎨 多模型问答优化 [#37](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/37)

  - 多模型回答的复制按钮优化：复制当前页签查看的模型回答
  - 重新生成优化：如果选了多模型回答，重新生成还是要用多模型回答
- 🎨 鼠标划选弹窗需要转Markdown [#36](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/36)
- 💄 消息内容从.protyle改为b3-typography类 [#38](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/38)

## v0.3.2 / 20251108

- 🎨模型搜索优化
  1. 模型搜索，点击添加，不清空搜索关键词，方便添加多个模型
  2. 模型搜索支持空格并集搜索，比如搜索gemini 2.5，可以搜索gemini-2.5
  3. 模型搜索去重
- ✨ 平台增加完全自定义URL功能 [#26](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/26)
- 🎨 内置平台优化 [#33](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/33)
  - 内置平台添加平台链接，支持点击跳转到内置平台的平台页面
  - 添加V3 API，并添加我的邀请链接：https://api.gpt.ge/register?aff=fQIZ
  - 内置平台添加kimi（moonshot）

## v0.3.1 / 20251108

- ♻️ 修复无法跨块多选内容复制 [#34](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/34)
- 🎨 编辑提示词不要显示「已保存提示词」 [#31](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/31)
- 💄 添加提示词的按钮icon优化 [#32](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/32)
- 🔥 聊天窗口去除左上角的名称 [#30](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/30)
- ✨ 选择多模型`需要显示已选用的模型名称 [#29](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/29)
- 🐛 工具列表错误添加一级标题 [#27](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/27)

## v0.3.0 / 20251107

- ✨ Copilot支持保存聊天会话到文件
- ✨ 历史对话支持右键菜单 [#23](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/23)
  - 导出到文件
  - 钉住/取消钉住：钉住之后置顶，置顶状态需要持久化
- ✨ feat(ai): 添加在新窗口和标签页打开AI功能
- ✨ agent模式，拖动文档为上下文只给ai传递块ID
  - agent模式，拖动文档到上下文只给ai传递文档块ID（拖动块还是获取kramdown给AI）
  - 切换不同模式，之前已经添加到聊天框上方的上下文中的块和文档策略也要即时更新

    - ask模式：获取Markdown
    - edit模式：获取kramdown
    - agent模式：拖动文档到上下文只给ai传递文档块ID（拖动块还是获取kramdown给AI）

## v0.2.3 / 20251107

- 🎨 sql 查询优化: 更新 SQL 查询文档和移除不必要的安全检查代码
- 🎨 优化对话的选中部分复制，复制为Markdown
- 🎨 为思源块引用链接添加点击事件

## v0.2.2 / 20251107

- ✨ 支持多模型对话 [#22](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/22)
- ✨ 图片和文件显示在对话下面，放在上下文内容里面 [#20](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/20)
- 📝 docs(工具文档): 更新思源笔记工具的使用说明

## v0.2.1 / 20251107

- 🎨 重构添加上下文逻辑 [#15](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/15)

  修改上下文逻辑

  - 目前的逻辑：上下文每次移到最新的对话，感觉还是固定在第一次会话好了
  - 可以参考Github Copilot的逻辑，改为当前上下文而不是全局上下文逻辑
    - 添加上下文，在聊天框显示
    - 发送消息，上下文会直接跟着发送的对话发送，不一直显示在聊天框方式，在用户提问的下面的上下文依然可以点击跳转
- ✨ 支持拖动块上传图片 [#14](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/14)
- 🐛 增强 API 请求错误信息的捕获和显示
- ✨ 添加消息右键菜单：可以选择复制、编辑、编辑、重新生成

## v0.2.0 / 20251106

- ✨ 新增agent模式 [#9](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/9)

## v0.1.2 / 20251106

- 以/结尾忽略v1版本，以# 强制使用输入地址实现逻辑优化

  - 输入[https/
    text.pollinations.ai/openai/]，应该用[https://text.pollinations.ai/openai/models]进
    型搜索，以及[https://text.pollinations.ai/openai/chat/completions]进行聊天
  - 输入[https/
    text.pollinations.ai/openai#]，应该用[https://text.pollinations.ai/openai]进行
    型搜索，以及[https://text.pollinations.ai/openai]进行聊天

## v0.1.1 / 20251106

- ⌥⌘C(Ctrl+Alt+C) 快捷键打开AI聊天窗口

## v0.1.0 / 20251106

- ✨多选拖动块也支持批量添加到上下文
- ✨创建新自定义平台后，默认选中新建的平台，方便进行设置
- ✨选择平台、新建平台不要影响当前已经选中的模型，目前切换选中平台会影响模型，只有删除平台且这个平台的模型是当前选中的模型才影响
- ✨内置平台API地址输入框隐藏

---

- ✨ Support adding multiple selected dragged blocks to context
- ✨ After creating a new custom platform, the newly created platform is selected by default for easy configuration
- ✨ Selecting a platform should not affect the currently selected model. Currently, switching the selected platform affects the model. It is hoped that deleting a platform will only affect the current selected model if that platform's model is the currently selected one.
- ✨ Hide the built-in platform API address input box

## v0.0.9 / 20251106

- ✨ 支持多选文档添加到上下文
- ✨ 思源笔记添加一个工具栏按钮，支持点击之后根据选择的文字进行AI问答，支持多轮问答，问答使用弹窗
- ✨ 搜索文档未输入关键词默认显示当前文档，支持添加到上下文

---

- ✨ Support adding multiple selected documents to context
- ✨ Add a toolbar button in SiYuan Note to support AI Q&A based on
- ✨ When searching documents, if no keywords are entered, the current document is displayed by default, and it can be added to the context

## v0.0.8 / 20251105

- 支持AI修改思源笔记内容
  - 支持基于对思源笔记块内容进行直接修改、新增块
  - 支持自动批准编辑
  - 支持查看更改情况
  - 支持AI修改后撤回

---

- Support AI modification of SiYuan Note content
  - Support direct modification and adding new blocks based on SiYuan Note block content
  - Support automatic approval for edits
  - Support viewing changes
  - Support undoing AI modifications

## v0.0.7 / 20251105

- 🎨 参考cherrystudio优化API地址提示 [#7](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/7)
- 🎨 历史对话需要保存上下文文档信息 [#2](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/2)
- 🎨 每次聊天自动保存当前会话 #3
- 📝 文档添加V3 API邀请链接、用爱发电 [#5](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/5)

---

- 🎨 Optimize API address prompt based on cherrystudio [#7](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/7)
- 🎨 Historical conversations need to save context document information [#2](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/2)
- 🎨 Auto-save current session for each chat #3
- 📝 Add V3 API invitation link and "powered by love" to the documentation [#5](https://github.com/Achuan-2/siyuan-plugin-copilot/issues/5)

## v0.0.6 / 20241104

- 🎨 细节优化
- 🎨 支持Gemini 2.5模型thinking
- 🎨 如果ai对话报错，报错消息也作为消息返回，这样就可以按刷新按钮重新生成消息
- 🐛如果添加了上下文内容，生成消息后，点击刷新，会不会携带上下文信息重新生成

---

- 🎨 Detail optimization
- 🎨 Support for Gemini 2.5 model thinking
- 🎨 If an AI conversation reports an error, the error message is also returned as a message, allowing the refresh button to regenerate the message
- 🐛 If context content is added, after generating a message, clicking refresh will carry the context information

## v0.0.4 / 20241103

- ✨ feat(数学公式): 添加数学公式渲染功能
  - 数学公式优化自动把`\[...\]`替换为`$$...$$`和`\(...\)`替换为`$..$`
  - 使用思源自带 KaTeX 渲染数学公式

---

- ✨ feat(math formulas): Added math formula rendering functionality
  - Math formula optimization automatically replaces `\[...\]` with `$...$` and `\(...\)` with `$...$`
  - Use SiYuan's built-in KaTeX to render math formulas

## v0.0.3 / 20251103

- 🎉 初次提交

---

- 🎉 first commit

