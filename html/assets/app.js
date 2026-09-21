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
        `<div class="card-head"><span class="w">${esc(display)}</span><span class="freq">词频 ${freq}</span></div>` +
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
        `<div class="card-head"><span class="w">${esc(display)}</span></div>` +
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

  // ===== 选中翻译 =====
  function onBodyMouseUp(e) {
    // 延迟以等待 selection 稳定
    setTimeout(() => {
      if (e.target.closest("#translate-btn") || e.target.closest(".word-card")) return;
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text && text.length > 0) {
        showTranslateBtn(sel);
      } else {
        $("#translate-btn").classList.add("hidden");
      }
    }, 10);
  }

  function showTranslateBtn(sel) {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const btn = $("#translate-btn");
    btn.classList.remove("hidden");
    let left = rect.left + rect.width / 2 - 30;
    let top = rect.top - 34;
    left = Math.max(8, Math.min(left, window.innerWidth - 70));
    if (top < 4) top = rect.bottom + 6;
    btn.style.left = left + "px";
    btn.style.top = top + "px";
    // 记忆当前选中文本（剔除词频上标数字，只保留英文）
    btn.dataset.text = getSelectionText(sel);
    // 记忆选区所在段落，供点击翻译后插入译文（点击按钮会清空 selection）
    const node = sel.anchorNode;
    pendingPara = (node && node.parentElement && node.parentElement.closest("p")) || null;
  }

  // 提取选区纯文本，去除 <sup> 词频数字
  function getSelectionText(sel) {
    if (!sel || sel.rangeCount === 0) return "";
    const clone = sel.getRangeAt(0).cloneContents();
    clone.querySelectorAll("sup").forEach((el) => el.remove());
    return clone.textContent.trim();
  }

  async function onTranslate() {
    const text = $("#translate-btn").dataset.text;
    if (!text) return;
    const btn = $("#translate-btn");
    btn.classList.add("hidden");

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
    if (pendingPara) {
      pendingPara.insertAdjacentElement("afterend", box);
    } else {
      $("#reader-body").appendChild(box);
    }
    box.scrollIntoView({ block: "nearest" });
    pendingPara = null;
  }

  // 多源翻译：优先 Google 端点，失败回退 MyMemory
  async function translateText(text) {
    const tries = [
      async () => {
        const url =
          "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=" +
          encodeURIComponent(text);
        const r = await fetch(url);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const parts = (j && j[0] || []).map((seg) => seg[0]).join("");
        if (!parts) throw new Error("no translation");
        return parts;
      },
      async () => {
        const url =
          "https://api.mymemory.translated.net/get?q=" +
          encodeURIComponent(text) + "&langpair=en|zh-CN&de=reader@example.com";
        const r = await fetch(url);
        if (!r.ok) throw new Error("http " + r.status);
        const j = await r.json();
        const t = j && j.responseData && j.responseData.translatedText;
        if (!t) throw new Error("no translation");
        return t;
      },
    ];
    let lastErr = null;
    for (const fn of tries) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("all sources failed");
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
    $("#reader-body").addEventListener("mouseup", onBodyMouseUp);

    $("#translate-btn").addEventListener("click", onTranslate);

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