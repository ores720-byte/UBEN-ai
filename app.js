const $ = s => document.querySelector(s);
const thread = $("#thread"), scroll = $("#scroll"), ta = $("#text"), sendBtn = $("#send");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = () => matchMedia("(max-width: 760px)").matches;

// ---------- storage ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);
const norm = s => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const cardKey = it => norm(it.front).slice(0, 120);
let chats = store.get("uba_chats", []);
const DIFFS = ["easy", "medium", "hard"];

// ---------- actions ----------
const ACTIONS = {
  quiz:     { label: "Multiple choice", icon: "fa-list-check", tab: "study", kind: "quiz", mode: "multiple choice" },
  tf:       { label: "True or false", icon: "fa-circle-question", tab: "study", kind: "quiz", mode: "true/false" },
  flash:    { label: "Flashcards", icon: "fa-note-sticky", tab: "study", kind: "quiz", mode: "flashcards" },
  due:      { label: "Cards due", icon: "fa-clock-rotate-left", tab: "study", kind: "due" },
  missed:   { label: "Review missed", icon: "fa-rotate-left", tab: "study", kind: "missed" },
  summarize:{ label: "Summary", icon: "fa-align-left", tab: "study", kind: "text" },
  keypoints:{ label: "Key points", icon: "fa-list-ul", tab: "study", kind: "text" },
  explain:  { label: "Explain simply", icon: "fa-lightbulb", tab: "study", kind: "text" },
  vocab:    { label: "Vocabulary", icon: "fa-spell-check", tab: "study", kind: "text" },
  formulas: { label: "Formulas", icon: "fa-square-root-variable", tab: "study", kind: "text" },
  translate:{ label: "Translate", icon: "fa-language", tab: "study", kind: "text" },
  outline:  { label: "Essay outline", icon: "fa-diagram-project", tab: "write", kind: "text" },
  feedback: { label: "Paragraph feedback", icon: "fa-pen", tab: "write", kind: "text" },
  thesis:   { label: "Thesis check", icon: "fa-check", tab: "write", kind: "text" },
  citation: { label: "Citations", icon: "fa-quote-left", tab: "write", kind: "text" },
  askfile:  { label: "Ask my file", icon: "fa-file-circle-question", tab: "write", kind: "text" },
  plan:     { label: "Study plan", icon: "fa-calendar-check", tab: "tools", kind: "text" },
  pomodoro: { label: "Focus timer", icon: "fa-stopwatch", tab: "tools", kind: "panel" },
  settings: { label: "AI settings", icon: "fa-key", tab: "tools", kind: "panel" },
  exam:     { label: "Exam countdown", icon: "fa-hourglass-half", tab: "tools", kind: "panel" },
  progress: { label: "My progress", icon: "fa-chart-simple", tab: "progress", kind: "panel" },
};
const TAB_DEFAULT = { study: "quiz", write: "outline", tools: "pomodoro", progress: "progress" };
const TEXT_TASK = { summarize: "summarize", keypoints: "keypoints", explain: "explain", vocab: "vocab", formulas: "formulas",
  translate: "translate", outline: "outline", feedback: "feedback", thesis: "thesis", citation: "citation", askfile: "askfile", plan: "plan" };
let tab = "study", action = "quiz", session = null, idx = 0, score = 0, timer = null, busy = false, slot = null;
let missedNow = [], correctNow = [], fromMissed = false, docText = "", pomo = null;

// ---------- helpers ----------
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  kids.flat().forEach(c => n.append(c instanceof Node ? c : String(c ?? "")));
  return n;
}
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}
function scrollBottom() {
  requestAnimationFrame(() => scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" }));
}
function addMsg(node) { thread.append(node); scrollBottom(); return node; }
function userMsg(text) { return el("div", { class: "msg user" }, el("div", { class: "user-bubble" }, text)); }
function assistantHead() { return el("div", { class: "assistant-head" }, el("i", { class: "fa-solid fa-sparkles spark" }), "UBEN Ai"); }
function assistantMsg(text, extra) {
  return el("div", { class: "msg" }, el("div", { class: "assistant" }, assistantHead(),
    text ? el("p", { class: "intro" }, text) : "", extra || ""));
}
function hero() {
  const suggestions = [
    ["fa-list-check", "Quiz from notes", "Make quiz questions from my lecture notes"],
    ["fa-note-sticky", "Flashcards for key terms", "Create flashcards for key terms in my course"],
    ["fa-align-left", "Summarize my notes", "Summarize my notes into the key ideas"],
  ];
  return el("section", { class: "hero" },
    el("h1", {}, "Good to see you, ", el("span", { class: "accent" }, "let's study")),
    el("p", {}, "Paste your notes or attach a file, then choose what to do with them."),
    el("div", { class: "suggestions" }, ...suggestions.map(([icon, label, text]) =>
      el("button", { class: "suggest", "data-fill": text }, el("i", { class: "fa-solid " + icon }), label))));
}
// ---------- Browser-only AI helpers (no server) ----------
const KEY_NAME = "uben_gemini_key";
const MODEL = "gemini-2.5-flash";
const getKey = () => { try { return localStorage.getItem(KEY_NAME) || ""; } catch { return ""; } };

async function gemini(prompt, json = false) {
  const key = getKey();
  if (!key) throw new Error("No API key yet. Open the gear icon and add your Gemini key.");
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: json ? 0.4 : 0.5, maxOutputTokens: 4096, ...(json ? { responseMimeType: "application/json" } : {}) },
      }),
    });
  } catch {
    throw new Error("Can't reach Google's AI service. Check your internet connection.");
  }
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new Error("The API key was rejected. Check it in the gear settings.");
  if (!r.ok) throw new Error("The AI service did not respond. Check your quota, then try again.");
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
}

function extractJson(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function extractText(file) {
  const name = file.name.toLowerCase();
  let text;
  if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) throw new Error("The PDF reader didn't load. Check your internet connection.");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const parts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map(it => it.str).join(" "));
    }
    text = parts.join("\n");
  } else if (name.endsWith(".docx")) {
    if (!window.mammoth) throw new Error("The Word reader didn't load. Check your internet connection.");
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else if (name.endsWith(".txt")) {
    text = await file.text();
  } else {
    throw new Error("Use a .pdf, .docx or .txt file.");
  }
  return text.slice(0, 40000);
}

const SHAPES = {
  "multiple choice": '{"items":[{"question":"string","options":["string","string","string","string"],"answer":"exact text of the correct option","source":"short phrase from the material that supports the answer"}]}',
  "true/false": '{"items":[{"statement":"string","answer":true,"source":"short phrase from the material"}]}',
  "flashcards": '{"items":[{"front":"string","back":"string"}]}',
};

async function generateItems(text, mode, difficulty, count) {
  const shape = SHAPES[mode];
  if (!shape) throw new Error("Unknown study mode.");
  const prompt = `You make study materials for university students.
Create exactly ${count} ${mode} items at ${difficulty} difficulty.
Use only facts from the material between the markers. Do not add outside facts.
Return only JSON in this shape: ${shape}

--- MATERIAL START ---
${text.slice(0, 30000)}
--- MATERIAL END ---`;
  const parsed = extractJson(await gemini(prompt, true));
  if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error("Could not build those items. Try again.");
  return { items: parsed.items.slice(0, count) };
}

const TASKS = {
  summarize: "Summarize the material in clear prose with short headings. Keep it under 300 words.",
  keypoints: "List the key points as short lines starting with '- '. Maximum 12 points.",
  explain: "Explain the material to a first-year student who is new to the topic. Use one simple everyday analogy and short sentences.",
  vocab: "Create a vocabulary list. For each term write: Term: one-line definition. Example: one sentence using it.",
  formulas: "Extract every formula or equation in the material. For each give the formula, what each symbol means, and when to use it.",
  translate: ({ lang }) => `Translate the material into ${lang}. Keep technical terms in English in brackets after the translation.`,
  outline: "Create an essay outline for this topic: a thesis, three to five body sections each with supporting points, and a conclusion. Use numbered headings.",
  feedback: "Give feedback on this paragraph under three headings: Clarity, Structure, Grammar. Give three specific improvements and then a rewritten version.",
  thesis: "Say whether this is a clear thesis statement (Yes or No). Explain why in two sentences, then suggest a stronger version.",
  citation: "Format the source details in the material into APA 7 and Harvard references. If a detail is missing, say which one in one sentence.",
  plan: ({ days, mins }) => `Make a ${days}-day study plan for this material, about ${mins} minutes per day. Write each day on its own line as 'Day N: what to study and practise'.`,
  askfile: "Answer the student's question using only the material. If the answer is not in the material, say so plainly.",
};

async function runTask(task, text, question, lang, days, mins) {
  const spec = TASKS[task];
  if (!spec) throw new Error("Unknown task.");
  if (!text.trim()) throw new Error("Add some notes, a file or a topic first.");
  const instruction = typeof spec === "function" ? spec({ lang, days, mins }) : spec;
  const ask = question ? `\n\nStudent's question: ${question}` : "";
  const prompt = `You are UBEN Ai, a helpful study assistant for university students. ${instruction}

--- MATERIAL START ---
${text.slice(0, 30000)}
--- MATERIAL END ---${ask}`;
  return (await gemini(prompt)).trim();
}

function bumpDaily() {
  const d = store.get("uba_daily", {});
  d[today()] = (d[today()] || 0) + 1;
  store.set("uba_daily", d);
}
function streakDays() {
  const d = store.get("uba_daily", {});
  let t = d[today()] > 0 ? today() : today() - 1, n = 0;
  while (d[t] > 0) { n++; t--; }
  return n;
}
function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast("Copied"), () => toast("Could not copy"));
}
function download(name, text) {
  const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/plain" })), download: name });
  document.body.append(a); a.click(); a.remove();
}
function readAloud(text) {
  if (!("speechSynthesis" in window)) return toast("Reading aloud is not supported here");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-GB";
  speechSynthesis.speak(u);
}
function setsToText(items, title) {
  return `${title}\n\n` + items.map((it, i) => it.front !== undefined
    ? `${i + 1}. ${it.front}\n   Answer: ${it.back}`
    : `${i + 1}. ${it.question || it.statement}\n   ${(it.options || []).map((o, j) => `${String.fromCharCode(65 + j)}) ${o}`).join("  ")}\n   Answer: ${it.answer === true ? "True" : it.answer === false ? "False" : it.answer}`
  ).join("\n\n");
}
function replyBlock(text, filename = "uben-ai.txt") {
  return el("div", { class: "reply" },
    el("div", { class: "reply-text" }, text),
    el("div", { class: "reply-tools" },
      el("button", { class: "mini", onclick: () => copyText(text) }, el("i", { class: "fa-regular fa-copy" }), "Copy"),
      el("button", { class: "mini", onclick: () => download(filename, text) }, el("i", { class: "fa-solid fa-download" }), "Download"),
      el("button", { class: "mini", onclick: () => readAloud(text) }, el("i", { class: "fa-solid fa-volume-high" }), "Read aloud")));
}

// ---------- tabs and chips ----------
function renderChips() {
  $("#chips").replaceChildren(...Object.entries(ACTIONS).filter(([, a]) => a.tab === tab).map(([k, a]) =>
    el("button", { class: "chip-select" + (k === action ? " on" : ""), "data-action": k, "aria-pressed": String(k === action) },
      el("i", { class: "fa-solid " + a.icon }), a.label)));
  updateSummary();
}
function setTab(t) {
  tab = t;
  action = TAB_DEFAULT[t];
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  renderChips();
}
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest(".tab");
  if (b) setTab(b.dataset.tab);
});
$("#chips").addEventListener("click", e => {
  const b = e.target.closest(".chip-select");
  if (!b) return;
  action = b.dataset.action;
  renderChips();
  if (ACTIONS[action].kind === "panel") showPanel(action);
  else ta.focus();
});
function updateSummary() {
  const btn = $("#settingsBtn");
  btn.innerHTML = "";
  btn.append(el("i", { class: "fa-solid fa-sliders" }), " " + `${ACTIONS[action].label} · ${$("#difficulty").value}`);
}

// ---------- sidebar ----------
function setSidebar(open) {
  $("#sidebar").classList.toggle("closed", !open);
  $("#toggleSide").setAttribute("aria-expanded", String(open));
  document.querySelector(".scrim")?.remove();
  if (open && isMobile()) {
    const s = el("div", { class: "scrim" });
    s.addEventListener("click", () => setSidebar(false));
    document.body.append(s);
  }
}
$("#toggleSide").addEventListener("click", () => setSidebar($("#sidebar").classList.contains("closed")));
matchMedia("(max-width: 760px)").addEventListener("change", e => setSidebar(!e.matches));
setSidebar(!isMobile());

function renderHistory() {
  const nodes = chats.map(c => el("button", { class: "side-item" + (c.id === activeId ? " on" : ""), "data-id": c.id, title: c.title }, c.title));
  $("#history").replaceChildren(...(nodes.length ? nodes : [el("p", { class: "side-empty" }, "Your sessions will appear here.")]));
}
let activeId = null;
$("#history").addEventListener("click", e => {
  const b = e.target.closest(".side-item");
  if (!b) return;
  openChat(b.dataset.id);
  if (isMobile()) setSidebar(false);
});
$("#newChat").addEventListener("click", newChat);
function newChat() {
  stopTimer(); session = null; slot = null; activeId = null;
  thread.replaceChildren(hero());
  ta.value = ""; autoGrow();
  $("#file").value = ""; $("#fileName").classList.add("hide");
  renderHistory();
  if (isMobile()) setSidebar(false);
  ta.focus();
}

// ---------- theme and font ----------
function setTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  $("#themeBtn i").className = dark ? "fa-solid fa-sun" : "fa-solid fa-moon";
}
const savedTheme = localStorage.getItem("uba_theme");
setTheme(savedTheme ? savedTheme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
$("#themeBtn").addEventListener("click", () => {
  const dark = !document.documentElement.classList.contains("dark");
  localStorage.setItem("uba_theme", dark ? "dark" : "light");
  setTheme(dark);
});
const FONT_SIZES = { small: "15px", medium: "16px", large: "18px" };
function applyFont(size) {
  document.documentElement.style.setProperty("--fs", FONT_SIZES[size] || "16px");
  store.set("uba_fs", size);
}

// ---------- composer ----------
function autoGrow() { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 200) + "px"; }
ta.addEventListener("input", autoGrow);
ta.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); run(); } });
sendBtn.addEventListener("click", run);
$("#settingsBtn").addEventListener("click", () => {
  const panel = $("#settings");
  const open = panel.classList.contains("hide");
  panel.classList.toggle("hide", !open);
  $("#settingsBtn").setAttribute("aria-expanded", String(open));
});
$("#difficulty").addEventListener("change", updateSummary);
$("#file").addEventListener("change", e => {
  const f = e.target.files[0];
  $("#fileName").textContent = f ? `${f.name}  ×` : "";
  $("#fileName").classList.toggle("hide", !f);
});
$("#fileName").addEventListener("click", () => { $("#file").value = ""; $("#fileName").classList.add("hide"); });

thread.addEventListener("click", e => {
  const s = e.target.closest(".suggest");
  if (s) { ta.value = s.dataset.fill; autoGrow(); ta.focus(); return; }
  const a = e.target.closest("[data-act]");
  if (!a) return;
  const act = a.dataset.act;
  if (act === "pomoToggle") pomoToggle();
  if (act === "pomoReset") pomoReset();
  if (act === "pomoSwitch") pomoSwitch();
  if (act === "examPlan") { action = "plan"; setTab("tools"); action = "plan"; renderChips(); ta.focus(); toast("Press send to build your plan"); }
  if (act === "clearMissed") { store.set("uba_missed", []); toast("Cleared"); showPanel("progress"); }
  if (act === "clearReports") { store.set("uba_reports", []); toast("Cleared"); showPanel("progress"); }
});
thread.addEventListener("change", e => {
  const s = e.target.closest("[data-setting]");
  if (!s) return;
  const k = s.dataset.setting;
  if (k === "exam") { store.set("uba_exam", s.value); showPanel("exam"); }
  if (k === "goal") { store.set("uba_goal", Math.max(1, parseInt(s.value, 10) || 10)); showPanel("progress"); }
  if (k === "font") applyFont(s.value);
});

// ---------- run ----------
async function run() {
  if (busy) return;
  const A = ACTIONS[action];
  if (A.kind === "panel") return showPanel(action);
  if (A.kind === "due") return startCards(dueCards(), "flashcards", false);
  if (A.kind === "missed") return startMissed();

  const typed = ta.value.trim();
  const file = $("#file").files[0];
  const needsText = A.kind === "quiz" || (action !== "askfile" && action !== "translate" && action !== "plan");
  if (action === "askfile" && !typed) return nudge();
  if (A.kind === "quiz" && !typed && !file) return nudge();
  if (needsText && A.kind === "text" && !typed && !file && !docText) return nudge();
  if (action === "translate" && !typed && !file && !docText) return nudge();
  if (action === "plan" && !typed && !file && !docText) return nudge();

  sendBtn.classList.remove("fire"); void sendBtn.offsetWidth; sendBtn.classList.add("fire");
  busy = true; sendBtn.disabled = true;
  stopTimer();
  $("#hero")?.remove();
  thread.querySelector(".hero")?.remove();

  const title = (typed || `File: ${file?.name || "untitled"}`).slice(0, 60);
  const label = file ? (typed ? `${typed}\n\n📎 ${file.name}` : `📎 ${file.name}`) : typed || A.label;
  addMsg(userMsg(label));
  ta.value = ""; autoGrow();
  const status = el("p", { class: "status-text" }, file ? "Reading your file…" : "Thinking…");
  const thinking = addMsg(el("div", { class: "msg" }, el("div", { class: "assistant" }, assistantHead(),
    el("div", { class: "dots" }, el("span"), el("span"), el("span")), status)));
  slot = null;

  try {
    let fileText = "";
    if (file) {
      fileText = await extractText(file);
      docText = fileText;
      status.textContent = "Working on it…";
    }
    const material = [typed, fileText].filter(Boolean).join("\n\n") || docText;

    if (A.kind === "quiz") {
      const data = await generateItems(material, A.mode, $("#difficulty").value,
        Math.min(20, Math.max(1, parseInt($("#count").value, 10) || 5)));
      const rec = { id: Date.now().toString(36), title, mode: A.mode, items: data.items, score: null, total: data.items.length };
      chats = [rec, ...chats].slice(0, 20);
      store.set("uba_chats", chats);
      activeId = rec.id;
      renderHistory();
      thinking.replaceWith(assistantMsg(`Here are ${data.items.length} ${A.label.toLowerCase()} items from your material.`));
      startCards(data.items, A.mode, false, rec.id);
    } else {
      const data = { text: await runTask(TEXT_TASK[action],
        action === "askfile" ? docText || material : material,
        action === "askfile" ? typed : "", $("#lang").value,
        examDays(), Math.max(10, parseInt($("#mins").value, 10) || 60)) };
      thinking.replaceWith(assistantMsg("", replyBlock(data.text, `${action}.txt`)));
    }
  } catch (err) {
    thinking.replaceWith(assistantMsg("", el("div", { class: "error-note" }, err.message)));
  } finally {
    busy = false; sendBtn.disabled = false;
    $("#file").value = ""; $("#fileName").classList.add("hide");
    scrollBottom();
  }
}
function nudge() {
  const box = document.querySelector(".composer-box");
  box.classList.remove("nudge"); void box.offsetWidth; box.classList.add("nudge");
  ta.focus();
}
function examDays() {
  const date = store.get("uba_exam", "");
  if (date) {
    const left = Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
    if (left > 0) return Math.min(left, 120);
  }
  return Math.max(1, parseInt($("#days").value, 10) || 7);
}

// ---------- flashcards with spaced repetition ----------
function dueCards() {
  const srs = store.get("uba_srs", {});
  const seen = new Set(), out = [];
  for (const c of chats) if (c.mode === "flashcards") for (const it of c.items) {
    const k = cardKey(it);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!srs[k] || srs[k].due <= today()) out.push(it);
  }
  return out.slice(0, 20);
}
function srsUpdate(item, know) {
  const srs = store.get("uba_srs", {});
  const k = cardKey(item), prev = srs[k] || { interval: 0 };
  const interval = know ? Math.max(1, Math.round((prev.interval || 1) * 2.2)) : 0;
  srs[k] = { interval, due: today() + interval };
  store.set("uba_srs", srs);
  bumpDaily();
}

function startCards(items, mode_, fromMissedList, chatId) {
  if (!items.length) {
    const msg = mode_ === "flashcards" ? "No cards are due right now. Nice work." : "Nothing to review yet.";
    return thread.append(assistantMsg(msg));
  }
  session = items; idx = 0; score = 0; slot = null;
  fromMissed = fromMissedList;
  missedNow = []; correctNow = [];
  currentMode = mode_;
  if (chatId) activeId = chatId;
  renderCurrent();
}
let currentMode = "multiple choice";

function openChat(id) {
  const rec = chats.find(c => c.id === id);
  if (!rec) return;
  stopTimer();
  activeId = id;
  thread.replaceChildren(userMsg(rec.title),
    assistantMsg(`Here are ${rec.items.length} items from this session. Starting again from the first.`));
  renderHistory();
  startCards(rec.items, rec.mode, false, id);
}

function startMissed() {
  const list = store.get("uba_missed", []);
  if (!list.length) return thread.append(assistantMsg("You have no missed questions. Take a quiz first."));
  $("#hero")?.remove();
  activeId = null;
  startCards(list.slice(0, 20), "multiple choice", true);
}

// ---------- quiz rendering ----------
function placeSlot(node) {
  if (slot?.isConnected) slot.replaceWith(node); else thread.append(node);
  slot = node;
  scrollBottom();
}
function renderCurrent() {
  if (idx >= session.length) return renderDone();
  const item = session[idx];
  const block = currentMode === "flashcards" ? flashcard(item)
    : currentMode === "true/false" ? trueFalse(item)
    : multipleChoice(item);
  const node = el("div", { class: "assistant-slot" },
    el("div", { class: "progress" }, el("div", { style: `width:${(idx / session.length) * 100}%` })),
    el("div", { class: "q-meta" },
      el("span", {}, `${idx + 1} of ${session.length}`),
      el("span", {}, currentMode === "flashcards" ? "Flashcards" : `${currentMode}${fromMissed ? " · missed" : ""} · ${$("#difficulty").value}`)),
    block);
  placeSlot(node);
  if ($("#timed").checked && currentMode !== "flashcards") startTimer(node);
}
function nextQuestion() { idx++; renderCurrent(); }

function findCorrectIndex(options, answer) {
  const a = norm(answer);
  if (!a) return -1;
  let i = options.findIndex(o => norm(o) === a);
  if (i === -1) i = options.findIndex(o => norm(o) && (a.includes(norm(o)) || norm(o).includes(a)));
  return i;
}
function quizBlock({ text, options, correct, label, tf = false, source = "" }) {
  const block = el("div", { class: "q-block", "data-correct": String(correct), "data-label": label },
    el("div", { class: "q-text" }, text),
    el("div", { class: "opts" + (tf ? " tf" : "") }, ...options.map((o, i) =>
      el("button", { class: "opt", "data-v": o, onclick: () => answer(block, i) },
        el("span", { class: "dot" }),
        tf ? "" : el("span", { class: "letter" }, "ABCDEFGH"[i]),
        el("span", {}, o),
        tf ? "" : el("span", { class: "kbd" }, String(i + 1))))),
    el("div", { class: "feedback-slot", role: "status", "aria-live": "polite" }),
    el("div", { class: "actions" }, el("span", { class: "hint" }, tf ? "" : "Press 1–4 to answer")));
  block._missed = { question: text, options, answer: label, source };
  return block;
}
function multipleChoice(item) {
  const options = (item.options || []).slice(0, 6).map(String);
  const correct = findCorrectIndex(options, item.answer);
  return quizBlock({ text: item.question, options, correct, label: correct >= 0 ? options[correct] : String(item.answer ?? ""), source: item.source });
}
function trueFalse(item) {
  const truth = norm(item.answer) === "true";
  return quizBlock({ text: item.statement, options: ["True", "False"], correct: truth ? 0 : 1, label: truth ? "True" : "False", tf: true, source: item.source });
}
function answer(block, pickedIdx) {
  if (block.dataset.answered) return;
  stopTimer();
  block.dataset.answered = "1";
  const correct = Number(block.dataset.correct);
  [...block.querySelectorAll(".opt")].forEach((b, i) => {
    b.disabled = true;
    if (i === correct) b.classList.add("right");
    else if (i === pickedIdx) b.classList.add("wrong");
    else b.classList.add("dim");
  });
  const ok = pickedIdx !== null && pickedIdx === correct;
  if (ok) { score++; correctNow.push(block._missed.question); } else missedNow.push(block._missed);
  bumpDaily();
  const label = block.dataset.label;
  const message = ok ? "Correct."
    : pickedIdx === null ? (label ? `Time is up. The answer is ${label}.` : "Time is up.")
    : (label ? `Not quite. The answer is ${label}.` : "Not quite.");
  const fb = block.querySelector(".feedback-slot");
  fb.replaceChildren(
    el("div", { class: "feedback " + (ok ? "ok" : "no") }, message),
    block._missed.source ? el("p", { class: "source" }, `From your material: "${block._missed.source}"`) : "");
  const last = idx + 1 >= session.length;
  block.querySelector(".actions").replaceChildren(
    el("button", { class: "mini", title: "Report a wrong question", onclick: () => reportQuestion(block) }, el("i", { class: "fa-regular fa-flag" }), "Report"),
    el("span", { class: "spacer" }),
    el("button", { class: "btn next-btn", onclick: nextQuestion }, last ? "See results" : "Next", el("i", { class: "fa-solid fa-arrow-right" })));
}
function reportQuestion(block) {
  const list = store.get("uba_reports", []);
  list.unshift({ ...block._missed, at: Date.now() });
  store.set("uba_reports", list.slice(0, 100));
  toast("Thanks. We will review this question.");
}

function flashcard(item) {
  const flipEl = el("div", { class: "flip", role: "button", tabindex: "0", "aria-label": "Flip card" },
    el("div", { class: "face front" }, el("small", {}, "Question"), String(item.front ?? "")),
    el("div", { class: "face back" }, el("small", {}, "Answer"), String(item.back ?? "")));
  const flip = () => flipEl.classList.toggle("show");
  flipEl.addEventListener("click", flip);
  flipEl.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
  const rating = el("div", { class: "row hide", style: "justify-content:center;margin-top:14px" },
    el("button", { class: "btn bad", onclick: () => rate(false) }, "Still learning"),
    el("button", { class: "btn good", onclick: () => rate(true) }, "Know it"));
  const rate = know => {
    srsUpdate(item, know);
    if (know) correctNow.push(String(item.front));
    rating.classList.add("hide");
    rating.insertAdjacentElement("afterend", el("p", { class: "feedback " + (know ? "ok" : "no") }, know ? "Scheduled for later." : "We will show this again soon."));
    if (!know) missedNow.push({ question: String(item.front), options: [], answer: String(item.back ?? ""), source: "" });
  };
  const last = idx + 1 >= session.length;
  return el("div", { class: "q-block" },
    el("div", { class: "flip-scene" }, flipEl),
    rating,
    el("div", { class: "actions" },
      el("span", { class: "hint" }, "Tap or press Space to flip"),
      el("button", { class: "btn ghost", onclick: () => { flip(); rating.classList.remove("hide"); } }, "Flip"),
      el("button", { class: "btn next-btn", onclick: nextQuestion }, last ? "See results" : "Next")));
}

function autoAdjust(pct) {
  if (!$("#autodiff").checked) return;
  const cur = DIFFS.indexOf($("#difficulty").value);
  const next = pct >= 80 ? Math.min(2, cur + 1) : pct < 50 ? Math.max(0, cur - 1) : cur;
  $("#difficulty").value = DIFFS[next];
  updateSummary();
}

function renderDone() {
  stopTimer();
  if (currentMode === "flashcards") {
    placeSlot(el("div", { class: "q-block done" },
      el("div", { class: "big" }, "Done"),
      el("p", {}, `You reviewed ${session.length} cards.`),
      el("button", { class: "btn", onclick: () => { idx = 0; renderCurrent(); } }, "Go through again")));
    return;
  }
  const pct = session.length ? Math.round((score / session.length) * 100) : 0;
  // Update the missed list: drop answered-correct items, add new misses
  const existing = store.get("uba_missed", []);
  const kept = existing.filter(q => !correctNow.includes(q.question));
  const merged = [...missedNow, ...kept.filter(q => !missedNow.some(m => m.question === q.question))];
  store.set("uba_missed", merged.slice(0, 100));
  if (activeId) {
    const rec = chats.find(c => c.id === activeId);
    if (rec) { rec.score = score; rec.total = session.length; store.set("uba_chats", chats); renderHistory(); }
  }
  const note = pct >= 80 ? "Strong work. Your notes are sticking."
    : pct >= 50 ? "Good start. Review the ones you missed."
    : "Keep going. Try the same set again.";
  autoAdjust(pct);
  const text = setsToText(session, "Study set");
  placeSlot(el("div", { class: "q-block done" },
    el("div", { class: "big" }, `${score}/${session.length}`),
    el("p", {}, note),
    el("div", { class: "row", style: "justify-content:center" },
      el("button", { class: "btn", onclick: () => { idx = 0; score = 0; missedNow = []; correctNow = []; renderCurrent(); } }, "Try again"),
      el("button", { class: "btn ghost", onclick: () => copyText(text) }, "Copy set"),
      el("button", { class: "btn ghost", onclick: () => download("study-set.txt", text) }, "Download"),
      missedNow.length ? el("button", { class: "btn ghost", onclick: () => startMissed() }, "Review missed") : "")));
}

// ---------- panels ----------
function showPanel(name) {
  stopTimer();
  $("#hero")?.remove();
  thread.querySelector(".hero")?.remove();
  let node;
  if (name === "pomodoro") node = pomodoroPanel();
  else if (name === "exam") node = examPanel();
  else if (name === "progress") node = progressPanel();
  else if (name === "settings") node = settingsPanel();
  thread.replaceChildren(node);
  if (name === "pomodoro") paintPomo();
  if (name === "settings") refreshConn();
}
function pomodoroPanel() {
  if (!pomo) pomo = { focus: true, left: 25 * 60, running: false, timer: null };
  return el("div", { class: "panel" },
    el("h2", {}, "Focus timer"),
    el("p", { class: "sub" }, "25 minutes of focus, then a 5 minute break."),
    el("div", { class: "clock", id: "pomoTime" }, "25:00"),
    el("p", { class: "sub", id: "pomoMode", style: "text-align:center" }, "Focus"),
    el("div", { class: "row", style: "justify-content:center" },
      el("button", { class: "btn", "data-act": "pomoToggle", id: "pomoToggleBtn" }, "Start"),
      el("button", { class: "btn ghost", "data-act": "pomoReset" }, "Reset"),
      el("button", { class: "btn ghost", "data-act": "pomoSwitch" }, "Switch")));
}
function paintPomo() {
  const t = $("#pomoTime");
  if (!t || !pomo) return;
  const m = String(Math.floor(pomo.left / 60)).padStart(2, "0"), s = String(pomo.left % 60).padStart(2, "0");
  t.textContent = `${m}:${s}`;
  $("#pomoMode").textContent = pomo.focus ? "Focus" : "Break";
  $("#pomoToggleBtn").textContent = pomo.running ? "Pause" : "Start";
}
function pomoToggle() {
  if (!pomo) return;
  if (pomo.running) { clearInterval(pomo.timer); pomo.running = false; }
  else {
    pomo.running = true;
    pomo.timer = setInterval(() => {
      pomo.left--;
      if (pomo.left <= 0) {
        clearInterval(pomo.timer); pomo.running = false;
        pomo.focus = !pomo.focus;
        pomo.left = pomo.focus ? 25 * 60 : 5 * 60;
        notify(pomo.focus ? "Break over. Back to focus." : "Focus session done. Take a break.");
      }
      paintPomo();
    }, 1000);
  }
  paintPomo();
}
function pomoReset() { clearInterval(pomo?.timer); if (pomo) { pomo.running = false; pomo.left = pomo.focus ? 25 * 60 : 5 * 60; } paintPomo(); }
function pomoSwitch() { clearInterval(pomo?.timer); if (pomo) { pomo.running = false; pomo.focus = !pomo.focus; pomo.left = pomo.focus ? 25 * 60 : 5 * 60; } paintPomo(); }
function notify(msg) {
  toast(msg);
  if ("Notification" in window && Notification.permission === "granted") new Notification("UBEN Ai", { body: msg });
  else if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}
function stopTimer() { clearInterval(timer); timer = null; }
function startTimer(node) {
  stopTimer();
  let left = 30;
  const pill = el("span", { class: "timer-pill" }, `${left}s`);
  const meta = node.querySelector(".q-meta");
  meta.insertBefore(pill, meta.lastChild);
  timer = setInterval(() => {
    left--;
    pill.textContent = `${left}s`;
    pill.classList.toggle("urgent", left <= 5);
    if (left <= 0) {
      stopTimer();
      const block = node.querySelector(".q-block");
      if (block && !block.dataset.answered) answer(block, null);
    }
  }, 1000);
}
function examPanel() {
  const date = store.get("uba_exam", "");
  const left = date ? Math.ceil((new Date(date).getTime() - Date.now()) / 86400000) : null;
  return el("div", { class: "panel" },
    el("h2", {}, "Exam countdown"),
    el("p", { class: "sub" }, "Set your exam date. The study plan uses the days left."),
    el("div", { class: "stats" }, el("div", { class: "stat" }, el("b", {}, left === null ? "–" : left > 0 ? left : "Today or past"), el("span", {}, "days left"))),
    el("div", { class: "row" },
      el("label", { class: "field" }, "Exam date",
        el("input", { type: "date", value: date, "data-setting": "exam" }))),
    el("div", { class: "row", style: "margin-top:14px" },
      el("button", { class: "btn", "data-act": "examPlan" }, el("i", { class: "fa-solid fa-calendar-check" }), "Make my study plan")));
}
function progressPanel() {
  const quizzes = chats.filter(c => c.score !== null && c.total);
  const avg = quizzes.length ? Math.round(quizzes.reduce((s, c) => s + (c.score / c.total) * 100, 0) / quizzes.length) : null;
  const daily = store.get("uba_daily", {});
  const goal = store.get("uba_goal", 10);
  const todayCount = daily[today()] || 0;
  const reports = store.get("uba_reports", []);
  const missed = store.get("uba_missed", []);
  const fs = store.get("uba_fs", "medium");
  const best = quizzes.reduce((b, c) => Math.max(b, Math.round((c.score / c.total) * 100)), 0);
  return el("div", { class: "panel" },
    el("h2", {}, "My progress"),
    el("p", { class: "sub" }, "Your results are saved on this device."),
    el("div", { class: "stats" },
      el("div", { class: "stat" }, el("b", {}, `${streakDays()} day${streakDays() === 1 ? "" : "s"}`), el("span", {}, "study streak")),
      el("div", { class: "stat" }, el("b", {}, avg === null ? "–" : avg + "%"), el("span", {}, "average score")),
      el("div", { class: "stat" }, el("b", {}, quizzes.length), el("span", {}, "sets finished")),
      el("div", { class: "stat" }, el("b", {}, best ? best + "%" : "–"), el("span", {}, "best score")),
      el("div", { class: "stat" }, el("b", {}, `${Math.min(todayCount, goal)}/${goal}`), el("span", {}, "today's goal")),
      el("div", { class: "stat" }, el("b", {}, dueCards().length), el("span", {}, "cards due")),
      el("div", { class: "stat" }, el("b", {}, missed.length), el("span", {}, "missed to review"))),
    el("div", { class: "row", style: "margin-top:10px" },
      el("label", { class: "field" }, "Daily goal (items)",
        el("input", { type: "number", min: "1", max: "200", value: String(goal), "data-setting": "goal" })),
      el("label", { class: "field" }, "Text size",
        el("select", { "data-setting": "font" },
          ...["small", "medium", "large"].map(s => el("option", { value: s, ...(s === fs ? { selected: "" } : {}) }, s[0].toUpperCase() + s.slice(1)))))),
    el("div", { class: "row", style: "margin-top:14px" },
      el("button", { class: "btn ghost", "data-act": "clearMissed" }, "Clear missed list"),
      el("button", { class: "btn ghost", "data-act": "clearReports" }, `Clear ${reports.length} reports`)));
}

// ---------- init ----------
applyFont(store.get("uba_fs", "medium"));
document.documentElement.style.setProperty("--fs", FONT_SIZES[store.get("uba_fs", "medium")]);
thread.replaceChildren(hero());
renderHistory();
renderChips();

// ---------- AI connection settings page ----------
function connMsg(text, bad = false) {
  const box = $("#statusBox");
  if (!box) return;
  box.className = "status-box" + (bad ? " err" : "");
  box.replaceChildren(el("span", { class: "conn-dot " + (bad ? "bad" : "unknown") }), el("span", {}, text));
}
function describeStatus() {
  const key = getKey();
  if (!key) return { cls: "none", text: "No API key yet. Paste your Gemini key below and press Save." };
  return { cls: "unknown", text: "Key saved on this phone. Press Test connection to check it." };
}
function refreshConn() {
  const d = describeStatus();
  $("#connDot").className = "conn-dot " + d.cls;
  connMsg(d.text, d.cls === "none");
  return d;
}
function settingsPanel() {
  return el("div", { class: "panel" },
    el("h2", {}, "AI connection"),
    el("p", { class: "sub" }, "Add your Gemini API key and check that the app can reach the AI."),
    el("div", { class: "status-box", id: "statusBox", role: "status", "aria-live": "polite" }, "Checking…"),
    el("div", { class: "settings-form" },
      el("label", { class: "field" }, "Gemini API key",
        el("input", { type: "password", id: "apiKey", autocomplete: "off", placeholder: "Paste your key here" }))),
    el("div", { class: "row", style: "margin-top:14px" },
      el("button", { class: "btn", "data-conn": "save" }, "Save key"),
      el("button", { class: "btn ghost", "data-conn": "test" }, "Test connection"),
      el("button", { class: "btn ghost", "data-conn": "remove" }, "Remove key")),
    el("p", { class: "note" }, "Your key is saved only in this browser on this phone and is sent only to Google's AI service."),
    el("h3", { class: "steps-title" }, "How to get a key"),
    el("ol", { class: "steps" },
      el("li", {}, "Open Google AI Studio and sign in with your Google account."),
      el("li", {}, "Choose Get API key, then Create API key."),
      el("li", {}, "Paste the key above and press Save key.")));
}
function saveKey() {
  const key = $("#apiKey").value.trim();
  if (key.length < 20) return connMsg("That key looks too short. Paste the full key.", true);
  try { localStorage.setItem(KEY_NAME, key); } catch { return connMsg("Your browser blocked saving the key.", true); }
  $("#apiKey").value = "";
  connMsg("Key saved. Press Test connection to check it.");
  refreshConn();
}
async function testKey() {
  if (!getKey()) return connMsg("No API key yet. Paste your key and press Save key.", true);
  connMsg("Testing…");
  try {
    await gemini("Reply with the single word OK.");
    connMsg(`Connected to ${MODEL}.`);
    $("#connDot").className = "conn-dot ok";
  } catch (err) {
    connMsg(err.message, true);
    $("#connDot").className = "conn-dot bad";
  }
}
function removeKey() {
  try { localStorage.removeItem(KEY_NAME); } catch {}
  connMsg("Key removed. Add a new key to use the AI.", true);
  refreshConn();
}
thread.addEventListener("click", e => {
  const b = e.target.closest("[data-conn]");
  if (!b) return;
  const act = b.dataset.conn;
  if (act === "save") saveKey();
  else if (act === "test") testKey();
  else if (act === "remove") removeKey();
});
$("#connBtn").addEventListener("click", () => showPanel("settings"));
// Offline support and install
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* offline support is optional */ });
}
