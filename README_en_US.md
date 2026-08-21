SiYuan Notes AI Assistant Plugin, which enables rich functionalities such as Q&A and editing based on the content of SiYuan Notes.

## 🙏 Sponsors

| Logo | Description |
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

## ❤️ Powered by Love

If you like my plugin, you are welcome to give a star on the GitHub repository and offer appreciation via WeChat. This will motivate me to continue improving this plugin and developing new ones.

Maintaining plugins is time-consuming and labor-intensive. Personal time and energy are limited. Open source is about sharing, but it does not mean I have to waste my time implementing features for users for free.

I will gradually improve features that I need. Appreciation can expedite updates. For some features I think can be improved but are not currently necessary, they may require appreciation to be prioritized (marked with an appreciation tag and the required amount). Features that are not needed or are very complicated to implement will have their issues closed directly without consideration.

Friends who have accumulated appreciation totaling 50 RMB and wish to add me on WeChat can send an email to <span data-type="a" data-href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</span> to request adding as a friend (If the appreciation does not reach 50 RMB, I will not reply to the email or add you as a friend, as I do not wish to be a free customer service representative).

![image](https://camo.githubusercontent.com/8052f6f2e7dafba534e781934efa9bcb084fa3a9dfa5c221a85ac63db8b043cb/68747470733a2f2f6173736574732e62336c6f6766696c652e636f6d2f73697975616e2f313631303230353735393030352f6173736574732f6e6574776f726b2d61737365742d696d6167652d32303235303631343132333535382d667568697235762e706e67)
