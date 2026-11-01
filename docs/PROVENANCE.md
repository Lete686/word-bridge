# 来源与公开版本范围

本项目将已交付的 Word Bridge 0.1.4 整理为可公开构建的仓库。插件运行 TypeScript 源码、样式、manifest 和预生成词典保持该版本内容。

公开整理包括 README、使用说明、已知问题、许可材料、贡献说明、CI 和完整 ZIP 打包脚本。package-lock 的根版本号与 package.json 对齐；依赖版本与 integrity 保持，下载地址整理为 npm 官方 registry。

未纳入本仓库的内容：本机专用的 Obsidian CDP 端到端测试及测试仓库、私有交付报告、账户配置、真实凭证、系统语音安装包、缓存和构建目录。公开项目保留七个单元测试文件，移除不可移植的本机 e2e npm 命令。

产品参考源码基线：

- Obsidian-Word-Memo：`6b010eda3464106374dfe510642368f4954c6496`。
- Word-Memo：`0c0b0229657ea60a38b36d6928faacb9c4424f8b`。

上述项目用于需求与产品方向参考，未复制其整套应用、插件宿主或编译 main.js。插件为独立 TypeScript/esbuild 实现。参考与数据、工具的许可范围分别见根目录第三方声明。

ECDICT 预生成数据为 137,565 条。内置 JSON SHA-256：`ac2c4a60a3ac133733dbe3444a8d22fd71761cb34b937488f54e8d888f641925`。正常 npm 构建直接使用该文件，不重新处理词典原始材料。
