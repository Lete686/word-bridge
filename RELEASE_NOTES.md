# Word Bridge v0.1.4 — 公开测试版

首个公开测试版本，面向 Windows 桌面版 Obsidian Markdown 笔记。

提供选区小图标与查词浮窗、内置英汉词典、系统英文 TTS、自配大模型翻译、英文生词收藏及手动墨墨云词本同步。查询结果不改写原笔记。

## 本版限制

- **墨墨状态核实仍有问题**：已出现“云词本中能看到单词，插件仍显示失败”的现场情况，尚未修复。请核对云端实际内容，不将“本次追加”当作已收录凭证。
- 云词本同步不代表加入学习计划；全量替换接口的跨客户端并发更新没有原子保证。
- 部分词条缺少音标或有词形标注误差；发音需 Windows 提供应用能调用的英文语音。
- 仅桌面 Markdown，不含移动端、PDF/OCR、复习或游戏模块。

## 安装

下载本 Release 的 `word-bridge-maimemo-0.1.4.zip`，解压后将 `word-bridge-maimemo` 文件夹放入测试仓库 `.obsidian/plugins/`，再启用插件。升级时保留已有 data.json 和 SecretStorage。

完整包包括 dictionary.json，下载源码归档不能直接代替插件安装包。

## 验证与许可

本地验证包括 100 项单元测试、类型检查、构建和安装 ZIP 完整性检查。GitHub Actions 以及真实账户、服务和设备的行为需分别验证。

插件代码 MIT，ECDICT 数据 MIT，筛选词表声明 BSD-3-Clause；可选 Python 词典重建工具链 GPLv3，不进入运行 ZIP。完整许可随源码与运行包中的第三方声明提供。
