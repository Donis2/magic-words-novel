# -*- coding: utf-8 -*-
"""离线句子成分分析：用 spaCy 依赖解析，为正文每个句子中的每个单词标注句法成分。

成分标签（与前端一致）：
  subject 主语 / verb 谓语 / object 宾语 / complement 表语 / comp 补语
  attribute 定语 / adverbial 状语 / conj 连词 / punct 标点

输出 html/data/analysis.json：{ "sentences": { 规范化句子文本: [[成分, 词], ...] } }
前端选中整句时按规范化文本精确匹配，命中则用本表结果，未命中回退到启发式分析。
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import spacy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "scripts", "sources")
OUT = os.path.join(ROOT, "html", "data", "analysis.json")

REL_PRON = {"who", "whom", "whose", "which", "that"}
# 缩写后缀：合并到前一个词（"do"+"n't" -> "don't"），避免 "n't" 单独飘出
CONTRACT = {"n't", "'nt", "'s", "'re", "'ve", "'ll", "'d", "'m", "'t", "'em"}


def _pp_role(prep_tok):
    """介词短语（prep + pobj…）作定语还是状语，取决于其中心词是名词还是动词/形容词。"""
    h = prep_tok.head
    return "attribute" if h.pos_ in ("NOUN", "PROPN", "PRON") else "adverbial"


def role_of(tok, has_cop, there_heads):
    dep = tok.dep_
    pos = tok.pos_
    low = tok.text.lower()
    head = tok.head

    if tok.is_punct:
        return "punct"
    if dep in ("cc", "preconj"):
        return "conj"
    # 从属连词 / 关系副词（that/if/because/where/when…），一律作连词（关联词）
    if pos == "SCONJ":
        return "conj"
    if dep == "mark":
        return "conj"
    # 系动词 be（cop）作谓语；此时句根是表语中心词
    if dep == "cop":
        return "verb"
    # 关系代词引导从句（主语/宾语位置）→ 连词/关联词
    if low in REL_PRON and dep in ("nsubj", "nsubjpass", "dobj", "pobj", "obj", "obl") \
            and head.dep_ in ("relcl", "acl", "ccomp", "advcl", "xcomp", "csubj"):
        return "conj"

    if dep in ("nsubj", "nsubjpass", "csubj"):
        return "subject"
    # there be 存现句：spaCy 把真正的（逻辑）主语标成 attr，这里还原为主语
    if dep == "attr" and head.i in there_heads:
        return "subject"
    if dep == "expl":
        return "expletive"           # there be 引导词
    if dep in ("dobj", "iobj", "obj"):
        return "object"
    if dep in ("attr", "acomp"):
        return "complement"
    if dep == "oprd":
        return "comp"

    if dep == "ROOT":
        if has_cop:
            return "complement"      # 系表结构：句根名词/形容词是表语
        if pos in ("VERB", "AUX"):
            return "verb"
        return "other"

    # 不定式标记 to（PART/aux）：跟随其后的动词角色，保持 "to rule" 黏连一致
    if dep == "aux" and pos == "PART":
        return role_of(head, has_cop, there_heads)
    if dep in ("aux", "auxpass", "prt"):
        return "verb"
    if dep in ("relcl", "acl", "advcl"):
        return "verb"                # 从句谓语
    if dep == "ccomp":
        return "verb"                # 宾语从句/强调句中的从句谓语
    if dep == "xcomp":
        return "object"              # 无主语不定式/非谓语作宾语

    if dep in ("det", "amod", "nummod", "poss", "predet", "compound",
               "nmod", "case", "npadvmod"):
        return "attribute"
    if dep == "appos":
        # 同位语与中心词指同一物，继承其成分（主语/宾语/表语…）
        return role_of(head, has_cop, there_heads) if head is not tok else "attribute"
    if dep in ("advmod", "neg"):
        return "adverbial"
    if dep == "prep":
        return _pp_role(tok)
    if dep == "pobj":
        p = head
        return _pp_role(p) if p.dep_ == "prep" else "attribute"
    if dep == "conj":
        if head is tok:
            return "attribute"
        return role_of(head, has_cop, there_heads)

    return "other"


def norm(text):
    return re.sub(r"\s+", " ", text).strip()


# 匹配键：去空白 + 去掉句首尾引号/括号，使 spaCy 分句结果与用户“选中整句”一致
_QUOTES = "\"'“”‘’()[]"
_match_re = re.compile(r"^[" + re.escape(_QUOTES) + r"]+|[" + re.escape(_QUOTES) + r"]+$")


def match_key(text):
    return _match_re.sub("", norm(text))


def tokenize_sentence(sent):
    """返回 [[role, text], ...]，并把缩写后缀合并到前一词。"""
    has_cop = any(t.dep_ == "cop" for t in sent)
    there_heads = {t.head.i for t in sent if t.dep_ == "expl"}
    out = []
    for t in sent:
        if t.text == "":
            continue
        role = role_of(t, has_cop, there_heads)
        txt = t.text
        if txt.lower() in CONTRACT or txt.startswith("'"):
            if out:
                out[-1][1] += txt
                continue
            # 句首不可能出现缩写后缀，忽略
            continue
        out.append([role, txt])
    return out


def build():
    nlp = spacy.load("en_core_web_sm", disable=["ner", "lemmatizer", "textcat"])
    sentences = {}
    n_sents = 0

    files = sorted(f for f in os.listdir(SOURCES) if re.fullmatch(r"chapter-\d+\.txt", f))
    for f in files:
        with open(os.path.join(SOURCES, f), encoding="utf-8") as fp:
            text = fp.read()
        # 按段落分别解析，与浏览器渲染（用户逐个段落选择）保持一致，
        # 避免整篇解析时对白引号导致 spaCy 跨段落合并/错挂分句。
        for para in re.split(r"\n\n+", text.strip()):
            if not para.strip():
                continue
            doc = nlp(para)
            for sent in doc.sents:
                key = match_key(sent.text)
                if not key:
                    continue
                sentences[key] = tokenize_sentence(sent)
                n_sents += 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump({"sentences": sentences}, fp, ensure_ascii=False)

    print(f"章节数: {len(files)}")
    print(f"句数: {n_sents}")
    print(f"输出: {OUT}")


if __name__ == "__main__":
    build()