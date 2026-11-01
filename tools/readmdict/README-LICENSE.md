# readmdict 目录许可说明

本目录只在“重新生成词典”时使用，**不进入插件安装包**，也不是插件运行时依赖。

## 逐文件结论

| 文件 | 许可 | 依据 |
| --- | --- | --- |
| `readmdict.py` | **GNU GPL v3** | 文件头第 6–8 行：Copyright (C) 2012, 2013, 2015 Xiaoqiang Wang，并明确声明 “GNU General Public License ... version 3”。 |
| `pureSalsa20.py` | MIT | 文件头版权归 https://github.com/zhansliu/writemdict；该仓库 LICENSE 为 MIT。 |
| `ripemd128.py` | MIT | 同上。 |
| `__init__.py`、`__main__.py` | 随包整合 | 本地兼容调整，无独立许可声明。 |

## 关于 PyPI METADATA 的冲突

PyPI 包 `readmdict==0.1.1` 的 `METADATA` 标记 License: MIT，但实际分发的 `readmdict.py` 源文件头明确声明 GPLv3。二者冲突时，本交付按**具体源文件的 GPLv3 声明**处理，不按 METADATA 的 MIT 处理。

因此，本目录整体按 **GPLv3** 分发，并随附：

- `LICENSE-GPL-3.0.txt`：GNU GPL v3 全文（来自 https://www.gnu.org/licenses/gpl-3.0.txt，SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`）。
- `LICENSE-MIT-writemdict.txt`：writemdict 的 MIT 许可（适用于 `pureSalsa20.py`、`ripemd128.py`）。

## 对插件与词典数据的影响

- 插件运行时安装包（由本仓库构建的插件 ZIP）不含本目录，插件代码仍为 MIT。
- `assets/dictionary.json` 来自 ECDICT（MIT）的公开 MDX，经本工具读取后重新整理为 JSON。本交付不认为“用 GPL 工具处理数据”会使 ECDICT 数据本身变为 GPL；但这是分发方的判断，不构成法律意见。
- 如不希望分发 GPLv3 工具，可删除本目录，改用 `pip install readmdict==0.1.1` 并自行遵守其 GPLv3 许可；插件构建与安装不依赖本目录。
