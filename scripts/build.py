# -*- coding: utf-8 -*-
"""构建脚本：读取词频表 + 各章源文件，生成 md/html 数据与统计。"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pipeline import (load_vocab, annotate_html, annotate_markdown,
                      match_token, TOKEN_RE, write_vocab_json)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "scripts", "sources")
MD_DIR = os.path.join(ROOT, "md")
HTML_DIR = os.path.join(ROOT, "html")
DATA_DIR = os.path.join(HTML_DIR, "data")
STATS_DIR = os.path.join(ROOT, "stats")

# 章节标题（编号 -> 中文标题 / 英文副标题）
CHAPTERS = {
    "chapter-001": {"cn": "第一章 魔法觉醒", "en": "The Awakening of Magic"},
    "chapter-002": {"cn": "第二章 铁骑将至", "en": "The Riders of Iron"},
}


def load_chapter_sources():
    """读取所有 chapter-*.txt，按编号排序。"""
    files = sorted(f for f in os.listdir(SOURCES) if re.fullmatch(r"chapter-\d+\.txt", f))
    result = []
    for f in files:
        cid = f[:-4]
        title = CHAPTERS.get(cid, {"cn": cid, "en": ""})
        with open(os.path.join(SOURCES, f), encoding="utf-8") as fp:
            text = fp.read().strip()
        result.append((cid, title, text))
    return result


def build():
    vocab, by_form = load_vocab()
    write_vocab_json()

    chapters = []
    # 累计统计：word -> {first_chapter, chapters:[...], total, by_chapter:{cid:count}}
    usage = {}

    for cid, title, text in load_chapter_sources():
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        md_lines = [f"# {title['cn']} {title['en']}" if title['en'] else f"# {title['cn']}", ""]
        html_paras = []
        total_words = 0
        new_in_chapter = []

        for p in paragraphs:
            md_lines.append(annotate_markdown(p, by_form))
            md_lines.append("")
            h, _tokens = annotate_html(p, by_form)
            html_paras.append(f"<p>{h}</p>")
            total_words += len(p.split())

        # 统计词频词使用
        for p in paragraphs:
            for m in TOKEN_RE.finditer(p):
                tok = m.group(0)
                hit = match_token(tok, by_form)
                if not hit:
                    continue
                lemma, entry = hit
                if lemma not in usage:
                    usage[lemma] = {
                        "word": lemma,
                        "freq": entry["freq"],
                        "first_chapter": cid,
                        "chapters": [],
                        "total": 0,
                        "by_chapter": {},
                    }
                    usage[lemma]["chapters"].append(cid)
                    new_in_chapter.append(lemma)
                else:
                    if cid not in usage[lemma]["by_chapter"]:
                        usage[lemma]["chapters"].append(cid)
                usage[lemma]["by_chapter"][cid] = usage[lemma]["by_chapter"].get(cid, 0) + 1
                usage[lemma]["total"] += 1

        num = int(cid.split("-")[1])
        chapters.append({
            "id": cid,
            "num": num,
            "title_cn": title["cn"],
            "title_en": title["en"],
            "word_count": total_words,
            "new_vocab": sorted(new_in_chapter, key=lambda w: -usage[w]["freq"]),
            "paragraphs": html_paras,
        })

        # 写 Markdown 文件
        os.makedirs(MD_DIR, exist_ok=True)
        md_path = os.path.join(MD_DIR, f"{cid}.md")
        with open(md_path, "w", encoding="utf-8") as fp:
            fp.write("\n".join(md_lines).rstrip() + "\n")

    # chapters.json
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(os.path.join(DATA_DIR, "chapters.json"), "w", encoding="utf-8") as fp:
        json.dump({"chapters": chapters}, fp, ensure_ascii=False, indent=2)

    # usage_stats.json
    total_vocab = len(vocab)
    used_count = len(usage)
    stats = {
        "total_vocab": total_vocab,
        "used_count": used_count,
        "coverage": round(used_count / total_vocab, 6) if total_vocab else 0,
        "unused_count": total_vocab - used_count,
        "usage": usage,
    }
    with open(os.path.join(DATA_DIR, "usage_stats.json"), "w", encoding="utf-8") as fp:
        json.dump(stats, fp, ensure_ascii=False, indent=2)

    # usage_report.md
    os.makedirs(STATS_DIR, exist_ok=True)
    lines = [
        "# 词频词使用统计报告",
        "",
        f"- 词频表总词数：{total_vocab}",
        f"- 累计已使用词数：{used_count}",
        f"- 覆盖率：{used_count / total_vocab * 100:.2f}%",
        f"- 尚未使用词数：{total_vocab - used_count}",
        "",
        "| 单词 | 词频 | 累计次数 | 首次出现章节 | 已出现章节 |",
        "| --- | ---: | ---: | --- | --- |",
    ]
    for lemma in sorted(usage, key=lambda w: -usage[w]["freq"]):
        u = usage[lemma]
        chs = ", ".join(u["chapters"])
        lines.append(f"| {u['word']} | {u['freq']} | {u['total']} | {u['first_chapter']} | {chs} |")
    with open(os.path.join(STATS_DIR, "usage_report.md"), "w", encoding="utf-8") as fp:
        fp.write("\n".join(lines).rstrip() + "\n")

    # 下一章建议：未使用词按词频降序
    unused = [v for v in vocab if v["word"] not in usage]
    unused.sort(key=lambda v: -v["freq"])
    suggest = [v["word"] for v in unused[:50]]

    print(f"总词数: {total_vocab}")
    print(f"已使用: {used_count}  ({used_count / total_vocab * 100:.2f}%)")
    print(f"未使用: {total_vocab - used_count}")
    print(f"章节数: {len(chapters)}")
    for c in chapters:
        print(f"  {c['id']}: {c['title_cn']} | {c['word_count']}词 | 新增词频词 {len(c['new_vocab'])}")
    print(f"下一章建议优先使用(前50): {', '.join(suggest)}")


if __name__ == "__main__":
    build()