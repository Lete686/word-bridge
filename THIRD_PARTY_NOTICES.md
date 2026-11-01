# 第三方来源与许可声明

插件运行代码按根目录 LICENSE（MIT）分发。可选词典重建工具链见 tools/LICENSE（GPLv3）及逐文件说明，二者许可范围单独标明。

## ECDICT：内置词典数据（MIT）

- 来源：https://github.com/skywind3000/ECDICT
- 数据版本：1.0.28，ecdict-mdx-28.zip 内《简明英汉字典增强版》MDX。
- 原 MDX SHA-256：275e71b58fd359bfe649af1cbee533ea81770bdbc53ec4a34567f84720a5751b
- assets/dictionary.json 为筛选派生数据，保留来源与原文件哈希。原始数据署名 Linwei，当前上游公开 MIT 许可全文如下；另存于 licenses/ECDICT-MIT.txt。

```text
MIT License

Copyright (c) 2025 Linwei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## KyleBing/english-vocabulary：四六级筛选词表（BSD-3-Clause）

- 来源：https://github.com/KyleBing/english-vocabulary
- 输入文件：json/3-CET4-顺序.json、json/4-CET6-顺序.json。
- 词表只参与词典生成时的入选判断，原词表文件不随插件分发。
- 2026-11-01 核对上游当前 LICENSE 为 BSD-3-Clause。本公开版本使用该声明及全文，不沿用旧交付中写成 MIT 的描述。许可另存于 licenses/KyleBing-BSD-3-Clause.txt。

```text
BSD 3-Clause License

Copyright (c) 2022-2026, KyleBing

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Word Memo：产品参考与致谢

- https://github.com/Losecloud/Word-Memo
- https://github.com/Losecloud/Obsidian-Word-Memo

产品方向参考上述项目。Word Bridge 的插件宿主与界面为独立 TypeScript 实现，未复制其应用源码或打包产物。参考项目的声明为 MIT，Copyright (c) 2025 词忆团队。这里的参考说明不表示获得其官方背书。

## readmdict：可选词典重建工具（GPLv3）

- tools/readmdict/readmdict.py 源文件头声明 GPLv3，Copyright (C) 2012, 2013, 2015 Xiaoqiang Wang。
- pureSalsa20.py、ripemd128.py 源于 writemdict，MIT，Copyright (c) 2015 zhansliu；保留其文件头及独立许可。
- PyPI readmdict 0.1.1 METADATA 写作 MIT，与上述源文件头冲突；这里按源文件头处理，工具链整体按 GPLv3 分发，原有 MIT 文件声明仍保留。
- 完整许可及修改说明见 tools/LICENSE、tools/readmdict/README-LICENSE.md、tools/readmdict/LICENSE-MIT-writemdict.txt。
- 本目录只用于从原 MDX 重建已附带的词典。正常 npm 构建无需执行它，插件运行 ZIP 不包含这些 Python 文件。

## API、发音与其他资源

- Obsidian API 由 Obsidian 提供，仓库仅通过开发依赖引用其类型。
- 墨墨开放 API：https://open.maimemo.com/ 。插件不包含墨墨的代码、词典或账户数据。
- 发音使用系统 TTS，没有内置真人录音。Windows 语音安装包不随本仓库或 Release 分发。
- 牛津、柯林斯等商业词典数据未随本插件分发。
