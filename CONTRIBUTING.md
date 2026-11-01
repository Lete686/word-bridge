# 贡献指南

欢迎提交可复现的问题和小范围 Pull Request。先阅读 README 与 docs/KNOWN_ISSUES.md，优先处理已有缺陷。

使用 Node.js 24，依次运行 `npm ci`、`npm test`、`npm run package`。不提交 node_modules、dist、release、data.json、.obsidian、真实密钥或本机语音包。

修改同步逻辑时保留：完整拼写去重、正文去重与服务端核实分开、POST 结果未知先读回、重新合并最新内容、元数据保留及明确的 verified/normalized/failed/unknown 状态。不要为了让界面显示成功而从提交正文推导“已核实”。

增加有实际失败场景的回归测试。真实服务测试使用自己的专用测试词本，主动写入应由测试者明确控制；mock 通过与真实服务通过分别报告。

普通功能或缺陷可在 Issues 提交：版本、复现步骤、期望/实际结果和脱敏报错。安全问题请参考 SECURITY.md，避免在公开 Issue 中包含凭证。

插件部分提交按 MIT 接受；tools/ 下的词典重建工具遵循其单独的 GPLv3/逐文件许可，不应移入运行包。
