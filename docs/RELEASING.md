# 维护者发布步骤

首次公开版本使用 Git tag `v0.1.4`，插件 manifest 保持 `0.1.4`，GitHub Release 标记为 **Pre-release**，标题为 `Word Bridge v0.1.4 — 公开测试版`。不将测试版标记为正式稳定版。

发布前确认 README 与 KNOWN_ISSUES 中的当前限制属实，运行全量单元测试与 `npm run package`，检查生成 ZIP 和 SHA256SUMS。

GitHub 仓库应为 Public。初次公开前先审查实际 Git 文件清单，再提交并推送到用户指定的远程地址。GitHub 登录交给浏览器或 GitHub CLI 的安全登录流程；不把 Token 写入仓库、命令参数或聊天。

推送 tag 后，在 GitHub Releases 中建立 Pre-release，使用 `RELEASE_NOTES.md` 的内容，上传 `release/` 下的完整 ZIP、校验清单及运行文件。GitHub 自动生成该 tag 的源码归档，包含本仓库工具源码与许可材料。

CI 在 push/PR 上执行安装、单元测试和构建打包，不自行发布 Release。首次公开还需实际观察 Actions 结果，再从 Release 下载 ZIP 验证目录层级和 SHA-256。

相关官方说明：https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
