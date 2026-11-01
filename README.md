# Word Bridge

面向 Windows 版 Obsidian 的轻量查词插件：选中文字，点击选区旁的小图标，在浮窗中查词或翻译，再按需收藏和同步生词。

**当前版本：0.1.4，公开测试版（Pre-release）。** 墨墨云词本已能读取，实测单词可到达云端，但插件仍可能显示“失败”。这个状态核实问题尚未修复，请先阅读[已知问题](docs/KNOWN_ISSUES.md)。

## 功能

- 选区旁的小图标，点击后打开浮窗；单纯选中不会发送请求。
- 单词查询使用内置 ECDICT 筛选词典，共 137,565 条，显示中文释义和词典提供的音标。
- 发音使用系统 TTS；Windows 需提供可调用的英文语音。没有内置真人录音。
- 句子翻译使用自行配置的 OpenAI 兼容大模型 API。
- 手动收藏英文拼写；词典给出原形时可自行选择收藏原词或原形。
- 生词列表、删除、手动同步所选单词到已有墨墨云词本。
- 查词和翻译结果不会插入或改写原笔记。

本版面向 Windows 桌面 Markdown 笔记，不包含复习训练、文字游戏、词汇可视化、PDF/OCR 或移动端支持。

## 安装

需要 Obsidian 1.11.4 或更新版本。本版尚未提交 Obsidian 社区插件目录，采用完整 ZIP 手动安装。

1. 在本仓库的 **Releases** 页面打开标为 **Pre-release** 的版本。
2. 下载 `word-bridge-maimemo-0.1.4.zip`，解压后取得 `word-bridge-maimemo` 文件夹。
3. 放入测试仓库的 `.obsidian/plugins/` 中，确保存在 `.obsidian/plugins/word-bridge-maimemo/manifest.json`。
4. 在 Obsidian 的“设置 → 第三方插件”中启用 Word Bridge。

升级时先停用插件并备份现有目录，用新包的同名运行文件覆盖；保留已有 `data.json`。密钥保存在 Obsidian SecretStorage，生词与普通配置保存在插件数据中。

完整安装与配置见[使用说明](docs/USAGE.md)。ZIP 中的 `dictionary.json` 是必需文件，安装时应保留完整包。

## 使用

在 Markdown 笔记中选中英文单词或句子，点击出现的小图标。单词查本地词典，句子走配置的大模型翻译；看完可点击空白处或按 Esc 关闭浮窗。

需要同步时，在设置中填写自己的墨墨 Token、读取并选择目标云词本，再打开生词列表手动同步。云词本同步不等于加入学习计划。测试版的同步状态可能不准确，云端实际内容与插件状态需要分别核对。

## 数据与网络

本地收藏记录包含英文拼写、加入时间和必要同步状态，不保存释义、原句或来源笔记路径。普通设置另含目标云词本等配置。

本地词典查询不发送网络请求。点击句子翻译会把所选文本发送到你配置的大模型服务；墨墨列表读取与手动同步使用墨墨 API。系统英文语音的可用性取决于 Windows 安装情况，详见[发音说明](docs/USAGE.md#英文发音)。反馈问题时请移除 Token、API Key、笔记正文和账户信息。

## 开发

本地验证环境为 Node.js 24。克隆仓库后依次执行：

```sh
npm ci
npm test
npm run build
```

构建输出位于 `dist/word-bridge-maimemo/`。生成完整安装 ZIP 和校验清单：

```sh
npm run package
```

产物在 `release/`。词典 JSON 已随源码提供，正常构建无需下载原始 MDX 或执行 Python 工具。可选词典重建方法见 [tools/README.md](tools/README.md)。

公开仓库提供 100 项单元测试；真实墨墨账户、真实大模型、Windows 发音及 Obsidian 界面行为需要另外验收，CI 通过不代表这些服务已通过。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可与致谢

| 范围 | 许可 |
| --- | --- |
| 插件 TypeScript 源码与打包脚本 | [MIT](LICENSE) |
| ECDICT 内置词典派生数据 | [MIT](licenses/ECDICT-MIT.txt) |
| 参与筛选的 KyleBing 四六级词表 | [BSD-3-Clause](licenses/KyleBing-BSD-3-Clause.txt)，原词表未打包 |
| 可选词典重建工具链 | [GPLv3](tools/LICENSE)，其中另有 MIT 声明的文件保留原许可 |

完整范围及声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Python 重建工具不进入插件运行 ZIP。

产品方向参考 [Obsidian-Word-Memo](https://github.com/Losecloud/Obsidian-Word-Memo) 和 [Word-Memo](https://github.com/Losecloud/Word-Memo)。Word Bridge 是独立插件实现，与这些项目及 Obsidian、墨墨没有官方隶属关系。
