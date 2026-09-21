# -*- coding: utf-8 -*-
"""词频标注管线：读取词频表、词形还原匹配、正文标注、统计。"""
import json
import re
import os
from collections import Counter

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XLSX = os.path.join(ROOT, "词频词汇表.xlsx")
VOCAB_JSON = os.path.join(ROOT, "html", "data", "vocab.json")

# 释义中的词性标签
POS_RE = re.compile(r"((?:[a-z]+\.\s*)+)")


def load_vocab(path=XLSX):
    """读取词频表，返回 vocab 列表与辅助索引。"""
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    vocab = []
    for r in rows[1:]:
        if r[2] is None:
            continue
        rank, freq, word = r[0], r[1], str(r[2]).strip()
        defn = (r[3] or "").strip()
        other = (r[4] or "").strip()
        cat = (r[5] or "").strip()
        subcat = (r[6] or "").strip()
        pos = "/".join(m.strip() for m in POS_RE.findall(defn)) or ""
        vocab.append({
            "word": word,
            "freq": int(freq or 0),
            "rank": int(rank or 0),
            "pos": pos,
            "def": defn,
            "other": other if other else None,
            "category": cat,
            "subcategory": subcat,
        })
    # 建立索引：小写原形 -> 词条；变体 -> (原形, 词条)
    by_form = {}
    for v in vocab:
        by_form.setdefault(v["word"].lower(), v)
        if v["other"]:
            by_form.setdefault(v["other"].lower(), v)
    return vocab, by_form


# 不规则形态映射：常见形式 -> 原形
IRREG = {
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be",
    "been": "be", "being": "be",
    "has": "have", "had": "have", "having": "have",
    "does": "do", "did": "do", "done": "do", "doing": "do",
    "went": "go", "gone": "go", "going": "go", "goes": "go",
    "said": "say", "says": "say", "saying": "say",
    "made": "make", "making": "make", "makes": "make",
    "took": "take", "taken": "take", "taking": "take", "takes": "take",
    "came": "come", "coming": "come", "comes": "come",
    "saw": "see", "seen": "see", "seeing": "see", "sees": "see",
    "knew": "know", "known": "know", "knowing": "know", "knows": "know",
    "thought": "think", "thinking": "think", "thinks": "think",
    "found": "find", "finding": "find", "finds": "find",
    "got": "get", "gotten": "get", "getting": "get", "gets": "get",
    "gave": "give", "given": "give", "giving": "give", "gives": "give",
    "felt": "feel", "feeling": "feel", "feels": "feel",
    "left": "leave", "leaving": "leave", "leaves": "leave",
    "kept": "keep", "keeping": "keep", "keeps": "keep",
    "held": "hold", "holding": "hold", "holds": "hold",
    "told": "tell", "telling": "tell", "tells": "tell",
    "ran": "run", "running": "run", "runs": "run",
    "began": "begin", "begun": "begin", "beginning": "begin", "begins": "begin",
    "brought": "bring", "bringing": "bring", "brings": "bring",
    "heard": "hear", "hearing": "hear", "hears": "hear",
    "mages": "mage", "casted": "cast", "men": "man", "women": "woman",
    "children": "child", "people": "person", "feet": "foot", "teeth": "tooth",
}


def reduce_word(tok):
    """生成词形还原候选原形（用于查表）。"""
    w = tok.lower()
    if w in IRREG:
        yield IRREG[w]
        return
    # 复数/三单：-ies -> y ; -es ; -s
    if w.endswith("ies") and len(w) > 4:
        yield w[:-3] + "y"
    if w.endswith("es") and len(w) > 4:
        yield w[:-2]
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        yield w[:-1]
    # 过去式/分词：-ied -> y ; -ed ; -d
    if w.endswith("ied") and len(w) > 5:
        yield w[:-3] + "y"
    if w.endswith("ed") and len(w) > 5:
        yield w[:-2]
        yield w[:-1]
    if w.endswith("d") and len(w) > 4:
        yield w[:-1]
    # 现在分词：-ing
    if w.endswith("ing") and len(w) > 5:
        yield w[:-3]
        yield w[:-3] + "e"
    # 比较级/最高级：-er/-est/-ly
    if w.endswith("est") and len(w) > 5:
        yield w[:-3]
    if w.endswith("er") and len(w) > 4:
        yield w[:-2]
    if w.endswith("ly") and len(w) > 4:
        yield w[:-2]


def match_token(tok, by_form):
    """匹配 token 到词表；返回 (原形, 词条) 或 None。"""
    w = tok.lower()
    if w in IRREG:
        w = IRREG[w]
    if w in by_form:
        v = by_form[w]
        return (v["word"], v)
    for cand in reduce_word(tok):
        if cand in by_form:
            v = by_form[cand]
            return (v["word"], v)
    return None


TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")


def annotate_html(text, by_form):
    """将英文正文分词并标注，返回 (html, tokens 统计信息)。

    tokens: list of dict {form, lemma, entry}
    """
    html = []
    tokens = []
    pos = 0
    for m in TOKEN_RE.finditer(text):
        html.append(_escape(text[pos:m.start()]))
        tok = m.group(0)
        hit = match_token(tok, by_form)
        if hit:
            lemma, entry = hit
            html.append(
                f'<strong class="vocab" data-word="{lemma}" '
                f'data-display="{_escape(tok)}" data-freq="{entry["freq"]}">'
                f'{_escape(tok)}<sup>{entry["freq"]}</sup></strong>'
            )
            tokens.append({"form": tok, "lemma": lemma, "entry": entry})
        else:
            html.append(
                f'<span class="word" data-word="{tok.lower()}" '
                f'data-display="{_escape(tok)}">{_escape(tok)}</span>'
            )
            tokens.append({"form": tok, "lemma": None, "entry": None})
        pos = m.end()
    html.append(_escape(text[pos:]))
    return "".join(html), tokens


def annotate_markdown(text, by_form):
    """Markdown 标注：**word**<sup>freq</sup>。"""
    md = []
    pos = 0
    for m in TOKEN_RE.finditer(text):
        md.append(text[pos:m.start()])
        tok = m.group(0)
        hit = match_token(tok, by_form)
        if hit:
            lemma, entry = hit
            md.append(f"**{tok}**<sup>{entry['freq']}</sup>")
        else:
            md.append(tok)
        pos = m.end()
    md.append(text[pos:])
    return "".join(md)


def _escape(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def write_vocab_json(path=VOCAB_JSON):
    vocab, _ = load_vocab()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"total": len(vocab), "words": vocab}, f, ensure_ascii=False)
    return vocab


if __name__ == "__main__":
    vocab, by_form = load_vocab()
    print("总词数:", len(vocab))
    # 高频实义词参考（排除纯功能词的小集合，仅作写作参考）
    func_poses = {"art.", "prep.", "conj.", "pron.", "num."}
    ref = [v for v in vocab if v["pos"] and not v["pos"].startswith(tuple(func_poses))]
    ref.sort(key=lambda x: -x["freq"])
    print("前 120 个高频实义词参考：")
    for v in ref[:120]:
        print(f"  {v['word']:<16} {v['freq']:>5}  {v['pos']:<10} {v['def'][:30]}")