SiYuan Notes AI Assistant Plugin, which enables rich functionalities such as Q&A and editing based on the content of SiYuan Notes.

## 🙏 Sponsors

| Sponsors | Description |
| --- | --- |
| ![17873186772188803ff9ca56b8aefe5fa96dcb51eb47d-20260821211408-jzsp68c.jpg](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/17873186772188803ff9ca56b8aefe5fa96dcb51eb47d-20260821211408-jzsp68c.jpg) | Thanks to APIMart for sponsoring this project! APIMart is a low-cost API platform for AI image & video generation — GPT-Image-2 from $0.006/image, 160+ images per dollar. One async API covers both image and video: submit a task, get an ID, fetch results via polling or callback. Batch tens of thousands of images without timeouts, switch models without changing code. Pay-as-you-go with no monthly fee — [sign up here](https://go.apimart.ai/gh-slidesci) to get started. |


## 📝 Changelog

See [CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/SiYuan-plugin-copilot@main/CHANGELOG.md)

## ✨ Main Features

- Multi-platform AI Support:
  - Built-in support for common platforms (OpenAI, Google Gemini, DeepSeek, Volcano Engine)
  - Also supports adding any platform compatible with the OpenAI API, allowing flexible switching of chat models
- Model Settings
  - Supports independent configuration of parameters for each model (temperature, max tokens)
  - Identifies special model capabilities (thinking mode, vision support)
- Three Chat Mode Switching: Switch between ask, edit, and agent chat modes
  - Ask Mode: For daily Q&A, supports selecting multiple models to reply simultaneously and choosing satisfactory answers
  - Edit Mode: For editing and modifying notes, supports viewing differences after editing and undo functionality
  - Agent Mode: Provides tools for the AI to autonomously query note content, edit notes, create documents, etc.
- Conversation Management
  - Supports saving conversation history, pinning and deleting historical records
  - Supports copying conversations as Markdown
  - Supports saving conversations as documents
- Multimodal Support
  - SiYuan Notes Content: Upload note content by dragging blocks, dragging page tabs, or dragging documents from the document tree
  - Image Upload: Supports pasting, uploading images, and also supports dragging image blocks directly for upload
  - File Upload (Supports Markdown, text files, etc.)
- Prompt Management
  - Supports creating and saving commonly used prompts for quick insertion into the input box

## 🔧 Development Related

### Local Development

```bash
pnpm install
pnpm run dev
```

### Files
- `src\tools\index.ts`: Implementation code for tools called in agent mode

## 📄 License

GPL3 License

## 🙏 Acknowledgments

- Developed based on the [plugin-sample-vite-svelte](https://github.com/SiYuan-note/plugin-sample-vite-svelte/) template
- Referenced the GPT conversation functionality implementation from [sy-f-misc](https://github.com/frostime/sy-f-misc)

## 📮 Feedback and Suggestions

If you have any issues or suggestions, please feel free to raise them in [GitHub Issues](https://github.com/Achuan-2/SiYuan-plugin-ai-sidebar/issues).

## ❤️ Tips Are Welcome

If you find this plugin useful, you're welcome to leave a tip or give the repository a star on GitHub. Your support helps me maintain and improve this plugin and develop new ones. Thank you for your support!

[Leave a tip](https://pancake.waffo.ai/store/achuan-2-fdbho4ye/product/PROD_3F7Aa7c2NQlz9KmxcgxjQ7?type=onetime&currency=USD)