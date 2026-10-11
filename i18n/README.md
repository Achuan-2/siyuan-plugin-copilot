# 国际化文案

本插件维护 `zh_CN.json`（简体中文）和 `en_US.json`（英文）两份平铺字典。两份字典的键名和占位符必须保持一致。界面文案、操作提示、可见错误和导出标题都应从字典读取；注释、用户内容、协议字段及发送给 AI 的工作流提示不属于界面翻译。

在 TypeScript 和 Svelte 中统一使用 `src/utils/i18n.ts`：

```ts
import { i18n, tf, i18nKey, getCurrentLanguage } from './utils/i18n';

i18n('commonSave');
i18n('aiSidebarConfirmDeletePlatformMessage', { platformName: name });
tf('sessionDeleteCount', count);
i18n(i18nKey('tools', 'run_python', 'name'));
new Date().toLocaleString(getCurrentLanguage());
```

`i18n` 替换 `${name}` 形式的命名参数，`tf` 替换 `{0}`、`{1}` 形式的位置参数。优先用完整句子和参数表达动态文案，避免拼接中文前后缀，这样英文可以调整语序。参数中的美元符号和占位符会原样保留，不会二次替换。两种占位符不要混用。

语言来自 `window.siyuan.config.lang`，兼容 `zh-CN` / `zh_CN` 和 `en` / `en_US` 等名称。优先读取思源加载的插件字典，缺少键时使用随代码打包的当前语言字典；未支持的语言使用英文打包字典。未知键最终返回键名，因此不要使用 `i18n(key) || '中文'`，该写法无法提供有效回退。动态工具键可以先用 `hasTranslation` 判断。

```sh
pnpm run check:i18n
pnpm run audit:i18n
node --test tests/i18n.test.mjs
pnpm run build
```

`check:i18n` 检查中英文键、参数占位符及源码直接引用的键。`audit:i18n` 额外列出脚本字符串和 Svelte 文本中的中文，排除普通注释和样式；输出仍可能包含 AI 提示词、工具参数说明、注入脚本或语言自身名称，需要人工判断，不能直接全部替换。动态生成的键也需要人工核对。

构建会将字典复制到产物中。新增文案后，应同时核对源码、构建产物及已安装插件的字典；源码检查和构建成功并不等于思源界面已验证。
