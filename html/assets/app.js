(function () {
  "use strict";

  // ===== 数据 =====
  let vocabMap = {};       // 原形 -> 词条
  let chapterList = [];    // chapters.json 的 chapters
  let usageStats = null;   // usage_stats.json
  let analysisSentences = null; // analysis.json 的 sentences 表（spaCy 预计算成分）
  let currentId = null;    // 当前章节 id
  let pendingPara = null;  // 翻译后译文要插入的段落元素

  const $ = (s) => document.querySelector(s);

  // ===== 加载数据 =====
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`加载失败: ${url}`);
    return r.json();
  }

  async function init() {
    try {
      const [vocab, chapters, stats] = await Promise.all([
        fetchJSON("data/vocab.json"),
        fetchJSON("data/chapters.json"),
        fetchJSON("data/usage_stats.json"),
      ]);
      (vocab.words || []).forEach((w) => {
        vocabMap[w.word] = w;
        vocabMap[w.word.toLowerCase()] = w;
      });
      chapterList = chapters.chapters || [];
      usageStats = stats;
      // 句子成分分析数据（spaCy 离线预计算），加载失败不影响其他功能
      try {
        const analysis = await fetchJSON("data/analysis.json");
        analysisSentences = analysis.sentences || null;
      } catch (e) {
        analysisSentences = null;
      }
      renderHome();
      bindEvents();
      loadSettings();
    } catch (err) {
      console.error(err);
      // 若以 file:// 打开会因 fetch 失败，给出提示
      document.body.innerHTML =
        '<div style="max-width:600px;margin:80px auto;padding:24px;font-family:sans-serif;line-height:1.7;">' +
        '<h2>无法加载数据</h2>' +
        '<p>数据文件读取失败（常见于直接用 file:// 打开）。请通过本地服务器访问，例如在项目根目录运行：</p>' +
        '<pre style="background:#f4f4f4;padding:12px;border-radius:8px;">python -m http.server 8000</pre>' +
        '<p>然后浏览器打开 <b>http://localhost:8000/html/</b></p>' +
        '<p style="color:#888;font-size:13px;">错误信息：' + String(err.message || err) + "</p>" +
        "</div>";
    }
  }

  // ===== 主页渲染 =====
  function renderHome() {
    $("#home-view").classList.remove("hidden");
    $("#reader-view").classList.add("hidden");

    const bar = $("#stats-bar");
    const total = usageStats.total_vocab;
    const used = usageStats.used_count;
    const cov = usageStats.coverage;
    bar.innerHTML =
      `<span>词表总数 <b>${total}</b></span>` +
      `<span>已覆盖 <b>${used}</b></span>` +
      `<span>覆盖率 <b>${(cov * 100).toFixed(1)}%</b></span>` +
      `<span>剩余 <b>${usageStats.unused_count}</b></span>`;

    const list = $("#chapter-list");
    const read = getReadSet();
    list.innerHTML = "";
    chapterList.forEach((c, i) => {
      const card = document.createElement("div");
      card.className = "chapter-card";
      const isRead = read.has(c.id);
      card.innerHTML =
        `<div>` +
        `<div class="num">第 ${c.num} 章</div>` +
        `<h3>${esc(c.title_cn)}${c.title_en ? ` <span class="en">${esc(c.title_en)}</span>` : ""}</h3>` +
        `<div class="meta">${c.word_count} 词 · 本章新增词频词 ${c.new_vocab.length}</div>` +
        `</div>` +
        `<span class="badge">${isRead ? "已读" : "未读"}</span>`;
      card.addEventListener("click", () => openChapter(c.id));
      list.appendChild(card);
    });
  }

  // ===== 阅读页 =====
  function openChapter(id) {
    const idx = chapterList.findIndex((c) => c.id === id);
    if (idx < 0) return;
    currentId = id;
    const c = chapterList[idx];

    $("#home-view").classList.add("hidden");
    $("#reader-view").classList.remove("hidden");

    $("#reader-title").textContent = c.title_cn;
    $("#reader-meta").textContent = c.title_en + " · " + c.word_count + " 词";

    const body = $("#reader-body");
    body.innerHTML = c.paragraphs.join("\n");

    $("#nav-pos").textContent = `${idx + 1} / ${chapterList.length}`;
    const hasPrev = idx > 0;
    const hasNext = idx < chapterList.length - 1;
    $("#btn-prev").disabled = !hasPrev;
    $("#btn-next").disabled = !hasNext;
    $("#btn-prev2").disabled = !hasPrev;
    $("#btn-next2").disabled = !hasNext;

    markRead(id);
    applyCompactMode();
    window.scrollTo({ top: 0 });
  }

  function goPrev() {
    const idx = chapterList.findIndex((c) => c.id === currentId);
    if (idx > 0) openChapter(chapterList[idx - 1].id);
  }
  function goNext() {
    const idx = chapterList.findIndex((c) => c.id === currentId);
    if (idx >= 0 && idx < chapterList.length - 1) openChapter(chapterList[idx + 1].id);
  }
  function goHome() {
    $("#reader-view").classList.add("hidden");
    renderHome();
    window.scrollTo({ top: 0 });
  }

  // ===== 已读/未读（localStorage）=====
  function getReadSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem("vocab_read") || "[]"));
    } catch (e) {
      return new Set();
    }
  }
  function markRead(id) {
    const s = getReadSet();
    s.add(id);
    try {
      localStorage.setItem("vocab_read", JSON.stringify([...s]));
    } catch (e) { /* ignore */ }
  }

  // ===== 词频标注：精简模式 =====
  function loadSettings() {
    try {
      const compact = localStorage.getItem("vocab_compact") === "1";
      const threshold = parseInt(localStorage.getItem("vocab_threshold") || "0", 10) || 0;
      $("#opt-compact").checked = compact;
      $("#opt-threshold").value = threshold;
    } catch (e) { /* ignore */ }
  }
  function applyCompactMode() {
    const compact = $("#opt-compact").checked;
    const threshold = parseInt($("#opt-threshold").value, 10) || 0;
    document.querySelectorAll("#reader-body .vocab").forEach((el) => {
      const freq = parseInt(el.dataset.freq, 10) || 0;
      el.classList.toggle("compact-hidden", compact && freq > threshold);
    });
  }

  // ===== 单词点击 → 释义卡片 =====
  function onBodyClick(e) {
    const target = e.target.closest(".vocab, .word");
    if (!target) { hideWordCard(); return; }
    // 若用户正在拖选文本，不弹卡片
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;

    const display = target.dataset.display || target.textContent.replace(/\d+/g, "").trim();
    const lemma = target.dataset.word || "";
    const freq = target.dataset.freq;

    showWordCard(display, lemma, freq ? parseInt(freq, 10) : null, target);
  }

  function showWordCard(display, lemma, freq, anchorEl) {
    const card = $("#word-card");
    let html = "";

    const entry = lemma ? vocabMap[lemma] : null;

    if (entry) {
      // 词频词：详细信息
      const u = usageStats.usage[entry.word];
      const inChapter = u && u.by_chapter[currentId] || 0;
      const total = u ? u.total : 0;
      const first = u ? u.first_chapter : null;
      const chapters = u ? u.chapters.join("、") : "";
      const posLine = entry.pos ? `<div class="grid"><span class="k">词性</span><span class="v">${esc(entry.pos)}</span></div>` : "";
      const rankLine = entry.rank ? `<div class="grid"><span class="k">词频排名</span><span class="v">第 ${entry.rank} 位</span></div>` : "";
      html =
        `<div class="card-head">` +
        `<span class="w">${esc(display)}</span>` +
        `<button class="speak-btn" data-word="${esc(entry.word)}" title="听读音" aria-label="听读音">读音</button>` +
        `<span class="freq">词频 ${freq}</span>` +
        `</div>` +
        (display.toLowerCase() !== entry.word.toLowerCase()
          ? `<div class="lemma">原形：${esc(entry.word)}</div>` : "") +
        `<div class="def">${esc(entry.def)}</div>` +
        posLine +
        rankLine +
        `<div class="grid"><span class="k">本章出现</span><span class="v">${inChapter} 次</span></div>` +
        `<div class="grid"><span class="k">累计出现</span><span class="v">${total} 次</span></div>` +
        `<div class="grid"><span class="k">首次出现</span><span class="v">${first || "—"}</span></div>` +
        `<div class="grid"><span class="k">已出现章节</span><span class="v">${chapters || "—"}</span></div>`;
    } else {
      // 非词频词：提示未收录
      html =
        `<div class="card-head">` +
        `<span class="w">${esc(display)}</span>` +
        `<button class="speak-btn" data-word="${esc(display)}" title="听读音" aria-label="听读音">读音</button>` +
        `</div>` +
        `<div class="def">未收录于考研词频表。</div>`;
    }

    card.innerHTML = html;
    card.classList.remove("hidden");

    // 定位
    const r = anchorEl.getBoundingClientRect();
    let left = r.left + r.width / 2 - 170;
    let top = r.bottom + 8;
    left = Math.max(8, Math.min(left, window.innerWidth - 348));
    if (top + 360 > window.innerHeight) top = r.top - 380;
    if (top < 8) top = 8;
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function hideWordCard() {
    $("#word-card").classList.add("hidden");
  }

  // ===== 单词读音 =====
  function speakWord(word) {
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = "en-US";
      u.rate = 0.85;
      const voices = window.speechSynthesis.getVoices();
      const en = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    } catch (e) {
      // 忽略语音合成错误
    }
  }

  // ===== 选中翻译 =====
  // 用 selectionchange 跨平台监听：移动端长按选词、桌面端拖选都会触发
  let selectTimer = null;
  function onSelectionChange() {
    clearTimeout(selectTimer);
    selectTimer = setTimeout(handleSelection, 220);
  }

  function hideFloatingBtns() {
    $("#translate-btn").classList.add("hidden");
    $("#analyze-btn").classList.add("hidden");
  }

  function handleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideFloatingBtns(); return; }
    const text = sel.toString().trim();
    if (!text) { hideFloatingBtns(); return; }
    // 仅当选区位于正文内
    const anchor = sel.anchorNode;
    const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!anchorEl || !anchorEl.closest("#reader-body")) { hideFloatingBtns(); return; }
    showFloatingBtns(sel);
  }

  function showFloatingBtns(sel) {
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const btnT = $("#translate-btn");
    const btnA = $("#analyze-btn");

    // 记忆当前选中文本（剔除词频上标数字，只保留英文）
    const text = getSelectionText(sel);
    btnT.dataset.text = text;
    btnA.dataset.text = text;
    // 记忆选区所在段落，供插入译文/分析结果（点击按钮会清空 selection）
    const node = sel.anchorNode;
    pendingPara = (node && node.parentElement && node.parentElement.closest("p")) || null;
    if (!pendingPara) { hideFloatingBtns(); return; }

    // 先临时显示以测量按钮尺寸（保持不可见，避免闪烁）
    btnT.style.visibility = "hidden";
    btnA.style.visibility = "hidden";
    btnT.classList.remove("hidden");
    btnA.classList.remove("hidden");
    btnT.style.left = "0px"; btnT.style.top = "0px";
    btnA.style.left = "0px"; btnA.style.top = "0px";
    const wT = btnT.offsetWidth || 60;
    const wA = btnA.offsetWidth || 60;
    const btnH = Math.max(btnT.offsetHeight || 34, btnA.offsetHeight || 34);
    const between = 6;
    const totalW = wT + wA + between;

    const centerX = rect.left + rect.width / 2;
    let left = centerX - totalW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - totalW - 8));

    // 按钮默认放在选区下方，避开浏览器自带的选中菜单
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + btnH > window.innerHeight - 4) top = rect.top - btnH - gap;
    if (top < 4) top = 4;

    btnT.style.left = left + "px";
    btnA.style.left = (left + wT + between) + "px";
    btnT.style.top = top + "px";
    btnA.style.top = top + "px";
    btnT.style.visibility = "";
    btnA.style.visibility = "";
  }

  // 提取选区纯文本，去除 <sup> 词频数字
  function getSelectionText(sel) {
    if (!sel || sel.rangeCount === 0) return "";
    const clone = sel.getRangeAt(0).cloneContents();
    clone.querySelectorAll("sup").forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  async function onTranslate() {
    const btn = $("#translate-btn");
    const text = btn.dataset.text;
    const para = pendingPara;
    // 立即清空状态，防止 pointerdown/touchstart/mousedown 等重复触发导致二次翻译
    btn.dataset.text = "";
    pendingPara = null;
    hideFloatingBtns();
    if (!text || !para) return;

    let zh = null;
    try {
      zh = await translateText(text);
    } catch (err) {
      zh = null;
    }

    const box = document.createElement("div");
    box.className = "translate-box";
    const closeBtn = `<button class="box-close" type="button" aria-label="关闭">×</button>`;
    if (zh) {
      box.innerHTML = closeBtn + `<div class="src">原文：${esc(text)}</div><div>${esc(zh)}</div>`;
    } else {
      box.innerHTML =
        closeBtn +
        `<div class="src">原文：${esc(text)}</div>` +
        `<div class="err">翻译服务暂不可用（网络或接口限制），请手动复制到翻译工具后再试。</div>`;
    }
    // 插入到选中段落的后面
    para.insertAdjacentElement("afterend", box);
    box.scrollIntoView({ block: "nearest" });
  }

  // ===== 句子成分分析（启发式浅层分析）=====
  const FUNC = {
    be: new Set(["am", "is", "are", "was", "were", "be", "been", "being"]),
    aux: new Set(["have", "has", "had", "having", "do", "does", "did", "done"]),
    mod: new Set(["can", "could", "may", "might", "must", "shall", "should", "will", "would", "need", "dare"]),
    neg: new Set(["not", "n't", "never"]),
    conj: new Set(["and", "but", "or", "nor", "yet", "if", "because", "although", "though", "unless"]),
    prep: new Set(["of", "in", "to", "for", "with", "on", "at", "from", "by", "about", "as", "into", "through", "over", "under", "before", "after", "between", "among", "without", "within", "during", "against", "behind", "beyond", "near", "toward", "upon", "across", "along", "around", "off", "onto", "above", "below", "until", "like", "inside", "outside", "past", "beside", "per"]),
    det: new Set(["a", "an", "the", "this", "that", "these", "those", "my", "your", "his", "her", "its", "our", "their", "some", "any", "no", "every", "each", "both", "all", "many", "much", "few", "several", "more", "most", "other", "another", "such", "own"]),
    pron: new Set(["i", "you", "he", "she", "it", "we", "they", "me", "him", "us", "them", "one", "ones", "who", "whom", "what", "whatever", "everyone", "everybody", "everything", "someone", "somebody", "something", "anyone", "anybody", "anything", "nothing", "nobody", "none", "this", "that", "these", "those"]),
    link: new Set(["be", "am", "is", "are", "was", "were", "been", "being", "become", "seem", "look", "feel", "sound", "remain", "appear", "get", "turn", "grow", "stay", "keep"]),
  };
  // 常见不规则动词的过去式/过去分词（原形同形者一并收录），用于正确识别谓语动词
  const IRREG_VERB = new Set("arose arisen awoke awoken beat beaten became become began begun bent bet bid bade bit bitten bled blew blown broke broken bred brought built bought caught chose chosen clung came come crept cut dealt dug drew drawn drank drunk drove driven ate eaten fell fallen fed felt fought found fled flew flown forgot forgotten forgave frozen forgot gotten gave given went gone grew grown hung heard hid hidden hit held hurt kept knelt knew known laid led left lent let lay lain lit lost made meant met paid put quit read rid rode ridden rang rung ran run said saw seen sold sent set sewn shook shaken shone shot shown shrank shrunk shut sang sung sank sunk sat slept slid slung smelt spoke spoken sped spent spun spat split spread sprang sprung stood stole stolen stuck stung stank struck strung swore sworn swept swam swum swung took taken taught tore torn told thought threw thrown thrust undertook woke woken wore worn wove woven wept won wrote written".split(" "));

  // 词频表 pos 缩写 -> 粗粒度
  function coarsePos(pos) {
    if (!pos) return null;
    const p = pos.split("/")[0].trim();
    if (p === "art.") return "DET";
    if (p === "a." || p === "adj.") return "ADJ";
    if (p === "ad." || p === "adv.") return "ADV";
    if (p === "n.") return "NOUN";
    if (p === "v." || p === "vi." || p === "vt.") return "VERB";
    if (p === "prep.") return "PREP";
    if (p === "conj.") return "CONJ";
    if (p === "pron.") return "PRON";
    if (p === "num.") return "NUM";
    return null;
  }

  function inferPos(word) {
    if (/^[A-Z][a-z]+$/.test(word)) return "NOUN"; // 专有名词
    if (/ly$/.test(word)) return "ADV";
    if (/(tion|sion|ment|ness|ity|ance|ence|ship|hood|dom|th)$/.test(word)) return "NOUN";
    if (/(ous|ful|less|ive|able|ible|al|ic|ary|ant|ent|ish|some)$/.test(word)) return "ADJ";
    if (/ing$/.test(word)) return "VERB";
    if (/ed$/.test(word) && !/eed$/.test(word)) return "VERB";
    if (/s$/.test(word) && !/ss$/.test(word)) return "NOUN";
    return "NOUN";
  }

  // 将变形词还原到词表原形，返回粗粒度词性（查不到返回 null）
  function lemmaPos(w) {
    const cands = [];
    if (/ies$/.test(w)) cands.push(w.slice(0, -3) + "y");
    if (/es$/.test(w)) cands.push(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w) && !/us$/.test(w) && !/is$/.test(w)) cands.push(w.slice(0, -1));
    if (/ied$/.test(w)) cands.push(w.slice(0, -3) + "y");
    if (/ed$/.test(w) && !/eed$/.test(w)) { cands.push(w.slice(0, -2)); cands.push(w.slice(0, -1)); }
    if (/ying$/.test(w)) cands.push(w.slice(0, -4) + "ie");
    if (/ing$/.test(w)) { cands.push(w.slice(0, -3)); cands.push(w.slice(0, -3) + "e"); }
    // 双写辅音还原（stopped -> stop）
    if (/([bcdfghjklmnpqrstvwxz])\1ed$/.test(w)) cands.push(w.slice(0, -3));
    if (/([bcdfghjklmnpqrstvwxz])\1ing$/.test(w)) cands.push(w.slice(0, -4));
    for (const c of cands) {
      const e = vocabMap[c];
      const p = e && e.pos ? coarsePos(e.pos) : null;
      if (p) return p;
    }
    return null;
  }

  function tagToken(word) {
    const w = word.toLowerCase();
    if (FUNC.be.has(w) || FUNC.aux.has(w)) return "AUX";
    if (FUNC.mod.has(w)) return "MOD";
    if (FUNC.neg.has(w)) return "NEG";
    if (IRREG_VERB.has(w)) return "VERB";
    if (FUNC.conj.has(w)) return "CONJ";
    if (FUNC.prep.has(w)) return "PREP";
    if (FUNC.det.has(w)) return "DET";
    if (FUNC.pron.has(w)) return "PRON";
    if (/ly$/.test(w)) return "ADV";
    const e = vocabMap[w];
    if (e && e.pos) { const c = coarsePos(e.pos); if (c) return c; }
    const lp = lemmaPos(w);
    if (lp && lp !== "ADV") return lp;
    return inferPos(word);
  }

  function tokenize(sentence) {
    const out = [];
    const re = /[A-Za-z]+(?:[’'-][A-Za-z]+)*|[.,!?;:()"“”—…]/g;
    let m;
    while ((m = re.exec(sentence))) {
      out.push({ word: m[0], punct: /^[.,!?;:()"“”—…]+$/.test(m[0]) });
    }
    return out;
  }

  function analyzeHeuristic(sentence) {
    const items = tokenize(sentence).map((t) => ({ word: t.word, tag: t.punct ? "PUNCT" : tagToken(t.word) }));
    const chunks = [];
    let i = 0;
    const n = items.length;
    let prevType = null;
    const push = (type, words) => { if (words.length) { chunks.push({ type, words }); prevType = type; } };
    const REL = new Set(["that", "which", "who", "whom", "whose", "where", "when", "why"]);

    while (i < n) {
      const w = items[i].word.toLowerCase();
      const tag = items[i].tag;

      if (tag === "PUNCT") { push("punct", [items[i].word]); i++; continue; }

      // 关系代词/从属连词：紧跟名词后引导定语从句，或 that 紧跟动词后引导宾语从句
      if (REL.has(w) && (prevType === "nominal" || (w === "that" && prevType === "verb"))) {
        push("conj", [items[i].word]); i++; continue;
      }
      if (tag === "CONJ") { push("conj", [items[i].word]); i++; continue; }

      // 谓语动词组（助动词/情态动词 + 否定 + 主动词，含中间副词）
      if (tag === "MOD" || tag === "AUX") {
        const words = [];
        while (i < n) {
          const t = items[i].tag;
          if (t === "MOD" || t === "AUX" || t === "NEG" || t === "VERB") { words.push(items[i].word); i++; }
          else if (t === "ADV" && words.length) { words.push(items[i].word); i++; }
          else break;
        }
        push("verb", words);
        continue;
      }
      if (tag === "VERB") { push("verb", [items[i].word]); i++; continue; }

      // 介词短语
      if (tag === "PREP") {
        const words = [items[i].word]; i++;
        while (i < n) {
          const t = items[i].tag;
          if (t === "DET" || t === "ADJ" || t === "NUM" || t === "NOUN" || t === "PRON") { words.push(items[i].word); i++; }
          else break;
        }
        push("pp", words);
        continue;
      }

      // 副词 -> 状语
      if (tag === "ADV") {
        const words = [];
        while (i < n && items[i].tag === "ADV") { words.push(items[i].word); i++; }
        push("adverbial", words);
        continue;
      }

      // 名词短语：限定词/数词/形容词做定语，与名词中心分拆（按句中成分，而非只看词性）
      if (tag === "DET" || tag === "ADJ" || tag === "NUM" || tag === "NOUN" || tag === "PRON") {
        const attrib = [];
        while (i < n) {
          const t = items[i].tag;
          if (t === "DET" || t === "NUM" || t === "ADJ") { attrib.push(items[i].word); i++; }
          else if (t === "ADV" && attrib.length) { attrib.push(items[i].word); i++; }
          else break;
        }
        const head = [];
        while (i < n && (items[i].tag === "NOUN" || items[i].tag === "PRON")) {
          head.push(items[i].word); i++;
        }
        if (attrib.length && head.length) {
          push("attribute", attrib);
          push("nominal", head);
        } else if (head.length) {
          push("nominal", head);
        } else if (attrib.length) {
          push("adjp", attrib);
        }
        continue;
      }

      push("other", [items[i].word]); i++;
    }

    // 角色标注：按短语在句中的作用归类，而非只看词性位置
    const segs = [];
    let verbFound = false;
    let linking = false;
    for (const c of chunks) {
      if (c.type === "verb") {
        verbFound = true;
        linking = c.words.some((ww) => FUNC.link.has(ww.toLowerCase()));
        segs.push({ type: "verb", text: c.words.join(" "), label: "谓语" });
      } else if (c.type === "conj") {
        segs.push({ type: "conj", text: c.words.join(" "), label: "连词" });
      } else if (c.type === "punct") {
        segs.push({ type: "punct", text: c.words.join(" "), label: "" });
      } else if (c.type === "nominal") {
        if (!verbFound) segs.push({ type: "subject", text: c.words.join(" "), label: "主语" });
        else if (linking) segs.push({ type: "complement", text: c.words.join(" "), label: "表语" });
        else segs.push({ type: "object", text: c.words.join(" "), label: "宾语" });
      } else if (c.type === "attribute") {
        segs.push({ type: "attribute", text: c.words.join(" "), label: "定语" });
      } else if (c.type === "adjp") {
        segs.push({ type: "complement", text: c.words.join(" "), label: "表语" });
      } else if (c.type === "pp") {
        // of 介词短语通常作后置定语，其余介词短语多作状语
        if (c.words[0].toLowerCase() === "of") segs.push({ type: "attribute", text: c.words.join(" "), label: "定语" });
        else segs.push({ type: "adverbial", text: c.words.join(" "), label: "状语" });
      } else if (c.type === "adverbial") {
        segs.push({ type: "adverbial", text: c.words.join(" "), label: "状语" });
      } else {
        segs.push({ type: "other", text: c.words.join(" "), label: "其他" });
      }
    }
    return segs;
  }

  const SEG_TITLES = {
    subject: "主语", verb: "谓语", object: "宾语", complement: "表语", comp: "补语",
    attribute: "定语", adverbial: "状语", conj: "连词", expletive: "引导词", other: "其他",
  };

  function normalizeText(s) {
    // 去空白 + 去掉句首尾引号/括号，与离线预计算的匹配键保持一致
    return String(s).replace(/\s+/g, " ").trim()
      .replace(/^["'“”‘’()\[\]]+|["'“”‘’()\[\]]+$/g, "");
  }

  // 把 spaCy 预计算的 [成分, 词] 序列合并成相邻同成分的片段
  function segsFromTokens(tokens) {
    const segs = [];
    for (const [role, text] of tokens) {
      const last = segs[segs.length - 1];
      if (role === "punct") {
        segs.push({ type: "punct", text, label: "" });
        continue;
      }
      if (last && last.type === role && last.type !== "punct") {
        last.text += " " + text;
      } else {
        segs.push({ type: role, text, label: SEG_TITLES[role] || "其他" });
      }
    }
    return segs;
  }

  // 首选 spaCy 离线依赖解析结果（精确整句匹配），未命中回退到启发式分析
  function analyzeSentence(sentence) {
    if (analysisSentences) {
      const tokens = analysisSentences[normalizeText(sentence)];
      if (tokens) return segsFromTokens(tokens);
    }
    return analyzeHeuristic(sentence);
  }

  function buildAnalysisBox(text) {
    const segs = analyzeSentence(text);
    const box = document.createElement("div");
    box.className = "analysis-box";
    let line = '<div class="seg-line">';
    for (const s of segs) {
      if (s.type === "punct") {
        line += `<span class="seg seg-punct"><span class="seg-word">${esc(s.text)}</span></span>`;
      } else {
        line += `<span class="seg seg-${s.type}"><span class="seg-word">${esc(s.text)}</span>` +
          `<svg class="seg-brace" viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><path d="M 4 0 Q 30 20 50 16 Q 70 20 96 0" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>` +
          `<span class="seg-label">${esc(s.label)}</span></span>`;
      }
    }
    line += "</div>";
    const order = ["subject", "verb", "object", "complement", "comp", "attribute", "adverbial", "conj", "expletive"];
    const lg = [];
    order.forEach((t) => { if (segs.some((s) => s.type === t)) lg.push(`<span class="lg lg-${t}"><i></i>${SEG_TITLES[t]}</span>`); });
    const legend = lg.length ? `<div class="analysis-legend">${lg.join("")}</div>` : "";
    box.innerHTML =
      `<button class="box-close" type="button" aria-label="关闭">×</button>` +
      `<div class="analysis-head">句子分析　<span class="analysis-orig">${esc(text)}</span></div>` +
      line + legend;
    return box;
  }

  function onAnalyze() {
    const btn = $("#analyze-btn");
    const text = btn.dataset.text;
    const para = pendingPara;
    btn.dataset.text = "";
    pendingPara = null;
    hideFloatingBtns();
    if (!text || !para) return;
    const box = buildAnalysisBox(text);
    para.insertAdjacentElement("afterend", box);
    box.scrollIntoView({ block: "nearest" });
  }

  // 带超时的 fetch：避免接口不可达时长时间挂起、译文一直不出现
  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // 多源翻译：并行请求 Google 与 MyMemory，取最先成功者，降低延迟
  async function translateViaGoogle(text) {
    const url =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
      encodeURIComponent(text);
    const r = await fetchWithTimeout(url, 5000);
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const parts = (j && j[0] || []).map((seg) => seg[0]).join("");
    if (!parts) throw new Error("no translation");
    return parts;
  }

  async function translateViaMyMemory(text) {
    const url =
      "https://api.mymemory.translated.net/get?q=" +
      encodeURIComponent(text) + "&langpair=en|zh-CN&de=reader@example.com";
    const r = await fetchWithTimeout(url, 5000);
    if (!r.ok) throw new Error("http " + r.status);
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    if (!t) throw new Error("no translation");
    return t;
  }

  function translateText(text) {
    const attempts = [translateViaGoogle(text), translateViaMyMemory(text)];
    return new Promise((resolve, reject) => {
      let pending = attempts.length;
      let lastErr = null;
      attempts.forEach((p) => {
        p.then(resolve).catch((e) => {
          lastErr = e;
          pending -= 1;
          if (pending === 0) reject(lastErr || new Error("all sources failed"));
        });
      });
    });
  }

  // ===== 工具 =====
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    $("#btn-back").addEventListener("click", goHome);
    $("#btn-back2").addEventListener("click", goHome);
    $("#btn-prev").addEventListener("click", goPrev);
    $("#btn-prev2").addEventListener("click", goPrev);
    $("#btn-next").addEventListener("click", goNext);
    $("#btn-next2").addEventListener("click", goNext);

    $("#reader-body").addEventListener("click", onBodyClick);
    document.addEventListener("selectionchange", onSelectionChange);

    // 翻译按钮用 pointerdown 触发：在移动端点按瞬间、选区尚未被系统清空前就响应，
    // 避免 click 落在选区已空/按钮已被隐藏之后导致无反应。
    const bindFloat = (btn, handler) => {
      if (window.PointerEvent) {
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          handler();
        });
      } else {
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          handler();
        });
        btn.addEventListener("touchstart", (e) => {
          e.preventDefault();
          handler();
        }, { passive: false });
      }
    };
    bindFloat($("#translate-btn"), onTranslate);
    bindFloat($("#analyze-btn"), onAnalyze);

    // 单词读音按钮（事件委托，覆盖重新渲染的卡片）
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".speak-btn");
      if (btn && btn.dataset.word) speakWord(btn.dataset.word);
    });

    // 关闭翻译/分析小窗口
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".box-close");
      if (!btn) return;
      const box = btn.closest(".translate-box, .analysis-box");
      if (box) box.remove();
    });

    // 点击空白关闭卡片
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".word-card") && !e.target.closest(".vocab") && !e.target.closest(".word")) {
        hideWordCard();
      }
    });

    // 设置面板
    $("#btn-settings").addEventListener("click", () => {
      $("#settings-overlay").classList.remove("hidden");
    });
    $("#btn-settings-close").addEventListener("click", () => {
      try {
        localStorage.setItem("vocab_compact", $("#opt-compact").checked ? "1" : "0");
        localStorage.setItem("vocab_threshold", $("#opt-threshold").value);
      } catch (e) { /* ignore */ }
      $("#settings-overlay").classList.add("hidden");
      applyCompactMode();
    });
    $("#settings-overlay").addEventListener("click", (e) => {
      if (e.target === $("#settings-overlay")) $("#settings-overlay").classList.add("hidden");
    });
  }

  init();
})();