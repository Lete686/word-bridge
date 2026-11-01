#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 ECDICT 简明英汉增强版 MDX 生成插件内置离线词典。

输入：ECDICT 1.0.28 的 ecdict-mdx-28.zip 内 MDX（MIT，作者 Linwei，
      https://github.com/skywind3000/ECDICT ）。
输出：JSON，结构：
      {
        "meta": {...},
        "entries": {
          "run":     ["[rʌn]", "n. 跑...\\nvi. ...", null, null],
          "running": ["['rʌniŋ]", "n. 赛跑...", "run", "现在分词"]
        }
      }
      字段依次为：音标、中文释义（换行分隔）、可信原形、原形关系。
      没有原形时后两项为 null。原形来自词典条目的“原型:”行，不做后缀猜测。

筛选规则（可复现）：
  1. 只保留 ASCII 单词（允许连字符与撇号），长度 1..40，必须含中文。
  2. 主词条：BNC 或 COCA 排名 ≤ 60000，或带四/六/研/托/雅/高/宝考试标签，
     或出现在 CET4/CET6 词表中。
  3. 变形词条：条目自带“原型:”且原形属于主词条集合。
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from readmdict import MDX

WORD_RE = re.compile(r"[A-Za-z][A-Za-z'’\-]*")
ABBR_RE = re.compile(r"(?:[A-Za-z]\.){2,}[A-Za-z]?")
KEY_RE = re.compile(r"(?:[A-Za-z][A-Za-z'’\-]*|(?:[A-Za-z]\.){2,}[A-Za-z]?)")
FREQ_RE = re.compile(r"\(([^()\r\n]*?)(\d+|-)/(\d+|-)\)\s*$")
PHON_RE = re.compile(r"`3`\[([^\]]*)\]")
LEMMA_A = re.compile(r"原型[:：]\s*(\S+?)\s*是\s*(\S+?)\s*的\s*([^\s`]+)")
LEMMA_B = re.compile(r"原型[:：]\s*(\S+?)\s*$")
MARKER_RE = re.compile(r"`\d+`")
EXAM_TAGS = ("四", "六", "研", "托", "雅", "高", "宝")
INFLECTION_LABELS = (
    "时态", "原型", "级别", "复数", "过去式", "过去分词", "现在分词",
    "第三人称单数", "比较级", "最高级", "变化形式",
)


def clean_definition(raw: str) -> str:
    text = raw.replace("\r\n", "\n")
    lines = []
    for line in text.split("\n"):
        if line.startswith("`1`") or line.startswith("`3`"):
            continue
        line = MARKER_RE.sub("", line).strip()
        if not line:
            continue
        for part in line.split("</br>"):
            part = part.strip()
            if not part:
                continue
            if FREQ_RE.fullmatch(part):
                continue
            if any(part.startswith(label + ":") or part.startswith(label + "：")
                   for label in INFLECTION_LABELS):
                continue
            if re.fullmatch(r"\([^()]*\)", part):
                continue
            lines.append(part)
    # 去重但保持顺序
    seen = set()
    out = []
    for line in lines:
        if line not in seen:
            seen.add(line)
            out.append(line)
    return "\n".join(out)


def parse_entry(word: str, raw: str):
    phon = ""
    m = PHON_RE.search(raw)
    if m:
        phon = "[" + m.group(1).strip().strip("[]").strip() + "]"
    definition = clean_definition(raw)
    freq = FREQ_RE.search(raw)
    tags = freq.group(1).strip() if freq else ""
    coca = int(freq.group(2)) if freq and freq.group(2) != "-" else 0
    bnc = int(freq.group(3)) if freq and freq.group(3) != "-" else 0
    ranked = min([r for r in (coca, bnc) if r > 0], default=0)
    lemma = rel = None
    la = LEMMA_A.search(raw)
    if la:
        source, base, relation = la.group(1), la.group(2), la.group(3)
        if source.casefold() == word.casefold() and WORD_RE.fullmatch(base):
            lemma, rel = base, relation
    else:
        lb = LEMMA_B.search(raw)
        if lb and WORD_RE.fullmatch(lb.group(1)) and lb.group(1).casefold() != word.casefold():
            lemma = lb.group(1)
            rel = ""
    return {
        "word": word, "phonetic": phon, "definition": definition,
        "lemma": lemma, "relation": rel, "rank": ranked, "tags": tags,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mdx", required=True)
    ap.add_argument("--cet4", required=True)
    ap.add_argument("--cet6", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--max-rank", type=int, default=60000)
    args = ap.parse_args()

    mdx_path = pathlib.Path(args.mdx)
    cet = set()
    for p in (args.cet4, args.cet6):
        for row in json.loads(pathlib.Path(p).read_text(encoding="utf-8-sig")):
            w = str(row.get("word", "")).strip()
            if WORD_RE.fullmatch(w):
                cet.add(w.casefold())

    mdx = MDX(str(mdx_path))
    total = len(mdx)
    headwords = {}
    eligible_with_lemma = []
    all_with_lemma = []
    scanned = 0
    start = time.monotonic()
    for key, raw in mdx.items():
        scanned += 1
        word = key.decode("utf-8", "replace").strip()
        if not word or len(word) > 40 or not KEY_RE.fullmatch(word):
            continue
        text = raw.decode("utf-8", "replace")
        if not any("一" <= ch <= "鿿" for ch in text):
            continue
        entry = parse_entry(word, text)
        if not entry["definition"]:
            continue
        if entry["lemma"] is not None:
            all_with_lemma.append(entry)
        exotic = any(c in word for c in "'’-") or bool(ABBR_RE.fullmatch(word))
        eligible = (
            (0 < entry["rank"] <= args.max_rank)
            or any(t in entry["tags"] for t in EXAM_TAGS)
            or word.casefold() in cet
            or (exotic and (bool(entry["phonetic"]) or bool(ABBR_RE.fullmatch(word))))
        )
        if not eligible:
            continue
        if entry["lemma"] is None:
            headwords[word] = entry
        else:
            eligible_with_lemma.append(entry)

    entries = {}
    for word, e in headwords.items():
        entries[word] = e
    for e in eligible_with_lemma:
        entries.setdefault(e["word"], e)
    known_folded = {w.casefold() for w in entries}
    added_inflections = 0
    for e in all_with_lemma:
        if e["word"] in entries:
            continue
        if e["lemma"] and e["lemma"].casefold() in known_folded:
            entries[e["word"]] = e
            added_inflections += 1

    payload_entries = {}
    for word in sorted(entries, key=lambda x: (x.casefold(), x)):
        e = entries[word]
        payload_entries[word] = [e["phonetic"], e["definition"], e["lemma"], e["relation"]]

    sha = hashlib.sha256(mdx_path.read_bytes()).hexdigest()
    meta = {
        "name": "ECDICT 简明英汉（阅读筛选版）",
        "source": "https://github.com/skywind3000/ECDICT",
        "sourceRelease": "ecdict-mdx-28.zip / 简明英汉字典增强版",
        "license": "MIT (Copyright (c) Linwei)",
        "sourceFile": mdx_path.name,
        "sourceSha256": sha,
        "maxRank": args.max_rank,
        "generated": "2026-10-30",
    }
    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump({"meta": meta, "entries": payload_entries}, f, ensure_ascii=False, separators=(",", ":"))
    digest = hashlib.sha256(out_path.read_bytes()).hexdigest()
    report = {
        "source_entries": total,
        "scanned": scanned,
        "headwords": len(headwords),
        "inflections_added": added_inflections,
        "output_entries": len(payload_entries),
        "with_phonetic": sum(1 for v in payload_entries.values() if v[0]),
        "with_lemma": sum(1 for v in payload_entries.values() if v[2]),
        "seconds": round(time.monotonic() - start, 1),
        "source_sha256": sha,
        "output_bytes": out_path.stat().st_size,
        "output_sha256": digest,
    }
    pathlib.Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
