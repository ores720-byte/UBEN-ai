// ai.js: AI provider code. Loads before app.js.
// Keys are read from this browser's storage. Only the admin settings can save them.
// ---------- AI helpers: several providers, tried in order ----------
const PROVIDERS = {
  gemini: { label: "Google Gemini", keyName: "uben_key_gemini", models: ["gemini-2.5-flash-lite"], hint: "aistudio.google.com" },
  groq: { label: "Groq", keyName: "uben_key_groq", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], hint: "console.groq.com" },
  claude: { label: "Claude (Anthropic)", keyName: "uben_key_claude", models: ["claude-haiku-4-5"], hint: "console.anthropic.com" },
  openrouter: { label: "OpenRouter", keyName: "uben_key_openrouter", models: ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free"], hint: "openrouter.ai" },
};
const ORDER = ["groq", "gemini", "openrouter", "claude"];
const getKeyFor = name => { try { return localStorage.getItem(PROVIDERS[name].keyName) || ""; } catch { return ""; } };
const hasAnyKey = () => ORDER.some(n => getKeyFor(n));

let lastCallAt = 0;
async function waitForSlot() {
  const wait = lastCallAt + 6000 - Date.now();
  if (wait > 0) await new Promise(res => setTimeout(res, wait));
  lastCallAt = Date.now();
}

async function callGemini(key, prompt, json) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.models[0]}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: json ? 0.4 : 0.5, maxOutputTokens: 2048, ...(json ? { responseMimeType: "application/json" } : {}) },
    }),
  });
  if (!r.ok) throw await providerError(r, "Gemini");
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
}

// Groq and OpenRouter both use the OpenAI chat format.
async function callOpenAIStyle(url, key, models, prompt, json, label, extraHeaders = {}) {
  let lastErr;
  for (const model of models) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key, ...extraHeaders },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: json ? 0.4 : 0.5,
        messages: [{ role: "user", content: prompt }],
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (r.ok) {
      const d = await r.json();
      return d.choices?.[0]?.message?.content || "";
    }
    lastErr = await providerError(r, label);
    if (r.status !== 404) throw lastErr; // only a missing model moves to the next name
  }
  // All built-in names failed: ask the provider which models this key can use.
  if (label === "Groq") {
    const live = await groqChatModels(key);
    for (const model of live.slice(0, 3)) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({ model, max_tokens: 2048, temperature: json ? 0.4 : 0.5,
          messages: [{ role: "user", content: prompt }] }),
      });
      if (r.ok) {
        const d = await r.json();
        return d.choices?.[0]?.message?.content || "";
      }
    }
  }
  throw lastErr;
}

// Lists chat models available to this Groq key, skipping speech, safety and image models.
async function groqChatModels(key) {
  try {
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: "Bearer " + key },
    });
    if (!r.ok) return [];
    const d = await r.json();
    const skip = /whisper|guard|tts|orpheus|vision|prompt|embed/i;
    return (d.data || []).map(m => m.id).filter(id => !skip.test(id))
      .sort((a, b) => (/70b|instruct|versatile/i.test(b) ? 1 : 0) - (/70b|instruct|versatile/i.test(a) ? 1 : 0));
  } catch {
    return [];
  }
}

// Builds an error that includes the provider's own message, so the cause is visible.
async function providerError(r, label) {
  let detail = "";
  try {
    const body = await r.json();
    detail = body?.error?.message || body?.message || body?.error || "";
  } catch {}
  const text = typeof detail === "string" ? detail : JSON.stringify(detail);
  const short = text ? " " + text.slice(0, 160) : "";
  if (r.status === 429) return new Error(`${label}: usage limit reached.${short}`);
  if ([400, 401, 403].includes(r.status)) return new Error(`${label}: key rejected (${r.status}).${short}`);
  return new Error(`${label}: error ${r.status}.${short}`);
}

async function callClaude(key, prompt, json) {
  let lastErr;
  for (const model of PROVIDERS.claude.models) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: json ? prompt + "\n\nReturn only valid JSON, with no other text." : prompt }],
      }),
    });
    if (r.ok) {
      const d = await r.json();
      return (d.content || []).map(b => b.text || "").join("");
    }
    lastErr = await providerError(r, "Claude");
    if (r.status !== 404) throw lastErr;
  }
  throw lastErr;
}

async function callProvider(name, key, prompt, json) {
  if (name === "claude") return callClaude(key, prompt, json);
  if (name === "gemini") return callGemini(key, prompt, json);
  if (name === "groq") return callOpenAIStyle("https://api.groq.com/openai/v1/chat/completions", key, PROVIDERS.groq.models, prompt, json, "Groq");
  if (name === "openrouter") return callOpenAIStyle("https://openrouter.ai/api/v1/chat/completions", key, PROVIDERS.openrouter.models, prompt, json, "OpenRouter", { "HTTP-Referer": location.origin, "X-Title": "UBEN Ai" });
  throw new Error("Unknown provider");
}

// Tries each provider that has a saved key, moving on when one fails.
async function gemini(prompt, json = false) {
  if (!hasAnyKey()) throw new Error("No API key yet. Open the gear icon and add a key.");
  await waitForSlot();
  const errors = [];
  for (const name of ORDER) {
    const key = getKeyFor(name);
    if (!key) continue;
    try {
      return await callProvider(name, key, prompt, json);
    } catch (err) {
      errors.push(err.message);
    }
  }
  throw new Error(errors.join(" ") + " Try again later or add another provider.");
}

// ---------- Long document writer: builds a long text in parts ----------
// Each part is one request. The end of the previous part is sent back as context,
// so the parts read as one document. Stops early if the model says it is finished.
async function writeLong(topic, parts = 5, onProgress = () => {}) {
  let written = "";
  for (let i = 1; i <= parts; i++) {
    onProgress(i, parts);
    const context = written ? `\n\nThe document so far ends with:\n"""${written.slice(-3000)}"""\n\nContinue from exactly where it stops. Do not repeat earlier text.` : "";
    const prompt = `Write part ${i} of ${parts} of a long, well-structured document about: ${topic}.` +
      ` Write about 1,000 words of new content with headings where useful.` +
      (i === parts ? " This is the final part, so finish with a conclusion." : "") +
      context + `\n\nIf the document is already complete, reply with only the word DONE.`;
    const piece = (await gemini(prompt)).trim();
    if (piece === "DONE" || piece === "") break;
    written += (written ? "\n\n" : "") + piece;
  }
  return written;
}

