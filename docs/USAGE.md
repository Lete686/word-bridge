# 安装与使用

## 开始使用

在 Windows 桌面版 Obsidian 的测试仓库中安装完整 Release ZIP，启用第三方插件后打开 Word Bridge 设置。插件 ID 为 `word-bridge-maimemo`；与原版 `word-memo` 使用不同目录。

单词查词不需要 Key。选中文字只出现小图标，点击图标才打开结果浮窗。点击空白处或按 Esc 关闭；复制或收藏均由用户手动选择。

## 句子翻译

填写自己的服务地址、模型名称、API Key 和超时设置，再点击测试。使用 OpenAI 兼容的聊天接口，不代表所有兼容服务的认证与参数差异均已验证。翻译会将所选文本发送到所配置的服务。

## 收藏和墨墨同步

1. 在浮窗选择收藏原词；词典给出原形时也可选择原形。
2. 在设置中保存自己的墨墨开放 API Token，点击“读取词本列表”。
3. 选择一个已有的专用测试云词本。
4. 打开生词列表，选中少量词后点击“同步选中”。
5. 到墨墨云词本核对原内容与新词，再查看插件的核实状态。

已知问题：[云端有词但插件仍标失败](KNOWN_ISSUES.md#k01墨墨云端已有单词插件仍显示失败)。同步只针对云词本，不管理学习计划；不自动上传，不自动创建词本。删除本地生词不会删除墨墨远程词条。

## 英文发音

发音按钮使用系统 TTS，需要 Obsidian 能枚举到可用英文 voice。Windows 中可在“设置 → 时间和语言 → 语音 → 管理语音”检查英文语音。安装后保存笔记、彻底退出所有 Obsidian 进程，再重新打开测试。

如果仍提示只有中文语音，应分别检查 Windows 的语音安装、应用枚举结果和实际播放，不把“文件已安装”直接当作“应用可调用”。本仓库不执行系统修改。微软的安装说明见：

- https://support.microsoft.com/en-au/accessibility/windows/narrator/appendix-a-supported-languages-and-voices
- https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/features-on-demand-v2--capabilities?view=windows-10

## 升级与反馈

升级前停用插件并备份插件目录，将新包的 7 个运行文件覆盖同名文件，保留 `data.json` 和 Obsidian SecretStorage。重新启用后检查版本号。

反馈时提供插件版本、Obsidian/Windows 版本、脱敏后的报错、复现步骤及预期行为。不要上传 data.json、Token、API Key、完整控制台请求头或私人笔记截图。
