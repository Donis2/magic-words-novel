(function () {
  "use strict";

  // ===== 数据 =====
  let vocabMap = {};       // 原形 -> 词条
  let chapterList = [];    // chapters.json 的 chapters
  let usageStats = null;   // usage_stats.json
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

  function handleSelection() {
    const sel = window.getSelection();
    const btn = $("#translate-btn");
    if (!sel || sel.isCollapsed) {
      btn.classList.add("hidden");
      return;
    }
    const text = sel.toString().trim();
    if (!text) {
      btn.classList.add("hidden");
      return;
    }
    // 仅当选区位于正文内
    const anchor = sel.anchorNode;
    const anchorEl = anchor && (anchor.nodeType === 1 ? anchor : anchor.parentElement);
    if (!anchorEl || !anchorEl.closest("#reader-body")) {
      btn.classList.add("hidden");
      return;
    }
    showTranslateBtn(sel);
  }

  function showTranslateBtn(sel) {
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const btn = $("#translate-btn");

    // 记忆当前选中文本（剔除词频上标数字，只保留英文）
    btn.dataset.text = getSelectionText(sel);
    // 记忆选区所在段落，供点击翻译后插入译文（点击按钮会清空 selection）
    const node = sel.anchorNode;
    pendingPara = (node && node.parentElement && node.parentElement.closest("p")) || null;
    if (!pendingPara) return;

    // 先临时显示以测量按钮尺寸（保持不可见，避免闪烁）
    btn.style.visibility = "hidden";
    btn.classList.remove("hidden");
    btn.style.left = "0px";
    btn.style.top = "0px";
    const btnH = btn.offsetHeight || 34;
    const btnW = btn.offsetWidth || 64;

    const centerX = rect.left + rect.width / 2;
    let left = centerX - btnW / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - btnW - 8));

    // 按钮默认放在选区下方，避开浏览器自带的选中菜单（多出现在上方/下方手柄处）
    const gap = 8;
    let top = rect.bottom + gap;
    if (top + btnH > window.innerHeight - 4) top = rect.top - btnH - gap;
    if (top < 4) top = 4;

    btn.style.left = left + "px";
    btn.style.top = top + "px";
    btn.style.visibility = "";
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
    btn.classList.add("hidden");
    if (!text || !para) return;

    let zh = null;
    try {
      zh = await translateText(text);
    } catch (err) {
      zh = null;
    }

    const box = document.createElement("div");
    box.className = "translate-box";
    if (zh) {
      box.innerHTML = `<div class="src">原文：${esc(text)}</div><div>${esc(zh)}</div>`;
    } else {
      box.innerHTML =
        `<div class="src">原文：${esc(text)}</div>` +
        `<div class="err">翻译服务暂不可用（网络或接口限制），请手动复制到翻译工具后再试。</div>`;
    }
    // 插入到选中段落的后面
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
    const translateBtn = $("#translate-btn");
    if (window.PointerEvent) {
      translateBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        onTranslate();
      });
    } else {
      translateBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onTranslate();
      });
      translateBtn.addEventListener("touchstart", (e) => {
        e.preventDefault();
        onTranslate();
      }, { passive: false });
    }

    // 单词读音按钮（事件委托，覆盖重新渲染的卡片）
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".speak-btn");
      if (btn && btn.dataset.word) speakWord(btn.dataset.word);
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