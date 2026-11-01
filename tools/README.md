# 可选词典重建工具

正常开发与安装使用已附带的 assets/dictionary.json，不需要运行本目录。

本目录是 GPLv3 的独立词典重建工具链，完整许可见 LICENSE。readmdict 中另有 MIT 声明的文件保留原许可，详情见 readmdict/README-LICENSE.md。此工具链不进入插件运行 ZIP，插件源码仍按根目录 MIT 许可发布。

重建需要自行取得 ECDICT 1.0.28 的《简明英汉字典增强版》MDX，以及 KyleBing/english-vocabulary 的 CET4/CET6 JSON。前者 MIT，后者上游当前 LICENSE 为 BSD-3-Clause，已在根目录第三方声明中保留其全文。

例如在项目根目录使用 Python 3.10 或更新版本执行：

```sh
python tools/build_dictionary.py --mdx /path/to/ecdict.mdx --cet4 /path/to/cet4.json --cet6 /path/to/cet6.json --out assets/dictionary.json --report dictionary-build-report.json
```

此命令只展示调用方式，不代表使用不同来源材料能重现相同哈希。生成规则与输入原文件 SHA-256 记录在数据 meta 中，原始 MDX、词表及运行报告不进入版本控制。

readmdict 来源及本地兼容调整见其许可说明与 readmdict-0.1.1.METADATA.txt。该 METADATA 的 MIT 标签与 readmdict.py 中的 GPLv3 头冲突，本目录按源文件头采用 GPLv3。

公开整理时仅检查了帮助入口，没有重新下载完整原始词典来重跑生成。上游读取器在 Python 3.13 下会出现转义写法警告；未安装可选 LZO 库时会提示缺少 LZO 支持。它们不影响正常 npm 构建，但重建不同压缩格式的 MDX 时需单独确认依赖与结果。
