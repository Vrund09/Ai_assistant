# Voice → Internet → Speaking Avatar Assistant — Build Plan

**Assessment goal:** Web app that takes voice input, fetches live data from the internet (e.g., weather), and speaks the answer back through a photorealistic talking avatar — with guardrails against offensive/inappropriate queries.
**Timebox:** 2 days. **Judged on:** AI tool usage, fit-&-finish, guardrails.
**Build tool:** DeepSeek inside your command-code CLI agent (use this plan as the working spec — paste sections in as prompts). The *app itself* runs on Gemini free tier.

---

## 1. Architecture

```
Browser (static frontend, served by Vercel)
 ├── Mic capture ── Web Speech API (STT, free, in-browser)
 │                     └─ fallback: text input box
 ├── POST /api/chat ──► FastAPI (Vercel Python serverless)
 │                        ├─► Guardrail Layer 1 (input moderation)
 │                        ├─► LLM (Gemini API free tier): intent + tool call
 │                        │      └─► Tool: Open-Meteo weather / web search
 │                        └─► Guardrail Layer 2 (output check)
 │                               └─► short spoken-style answer (text)
 └── Simli WebRTC session (browser ↔ Simli directly)
        ──► answer text/audio ──► photorealistic avatar speaks
```

**Stack decision:** FastAPI backend + static HTML/JS frontend, both deployed on Vercel (Python runtime), **not** Streamlit. Streamlit can't cleanly handle browser mic + WebRTC avatar video. Vercel notes for FastAPI:
- Repo layout: `api/index.py` (FastAPI app) + `public/` (frontend) + `vercel.json` routing all `/api/*` to the Python function.
- Vercel serverless does **not** support WebSockets — that's fine here because the two realtime channels (mic STT, Simli WebRTC video) both run browser-side; FastAPI only handles stateless request/response. Keep it that way.
- Use SSE (`StreamingResponse`) if you stream LLM tokens; SSE works on Vercel, WebSockets don't.
- API keys live in Vercel env vars, read via `os.environ` — never in frontend JS.

---

## 2. Component choices & why (report Question 2 material)

| Layer | Choice | Why | Cost |
|---|---|---|---|
| Backend | **FastAPI** on Vercel Python runtime | Python ecosystem (Gemini SDK, pytest), stateless serverless fits the flow | Free |
| STT | Web Speech API (browser) | Zero cost, zero server latency, no key | Free |
| STT fallback | Text input box (always visible) | Demo insurance without burning any API quota | Free |
| LLM | **Gemini API free tier** — `gemini-2.5-flash` for answers (function calling), `gemini-2.5-flash-lite` for the moderation pass | Free tier with real daily quota; flash-lite is faster + has a separate/larger quota, so moderation doesn't eat your answer budget | Free |
| Live data | Open-Meteo (weather), no key needed; optionally a search API (Tavily/Serper free tier) for general queries | No signup friction, reliable JSON | Free |
| TTS | Gemini TTS / ElevenLabs Flash / Deepgram Aura — or skip entirely if Simli accepts text | Lowest-latency natural voices, free tiers | Free tier |
| Avatar | **Simli** — real-time streaming avatar API, <300 ms response, WebRTC, $10 signup credit + 50 free min/month | Purpose-built for live agents; cheapest free tier; simple SDK | Free tier |
| Avatar alt. | HeyGen **LiveAvatar** (their old Interactive Avatar sunsets Mar 2026) or D-ID streaming | Mention in report as evaluated alternatives | Trial |
| Moderation | Layered: regex/keyword blocklist → Gemini flash-lite classifier → output scan | No extra vendor; defense-in-depth story | Free |
| Hosting | Vercel | Free, HTTPS (required for mic access), instant demo URL for recruiter | Free |
| Build agent | DeepSeek in command-code CLI | What you use to *write* the code — documented in `AI_USAGE.md` | — |

**Free-tier reality check:** Gemini free tier is rate-limited per model per day (check current limits at ai.google.dev/pricing when you start). Design for it: one answer call + one moderation call per user query max, cache weather 5 min, and mock the LLM in all automated tests (§6).

---

## 3. Spec-wise breakdown

### S1 — Voice input (STT)
- Push-to-talk mic button; interim transcript rendered live.
- Web Speech API `SpeechRecognition`; detect unsupported browser → text input box (always keep a text box — good UX and demo insurance).
- **Success criteria:** transcript appears <1 s after speech ends; works in Chrome; graceful fallback elsewhere.

### S2 — Understanding + live data fetch
- `/api/chat` (FastAPI): Gemini `gemini-2.5-flash` with function calling. Tools: `get_weather(city)` → Open-Meteo geocoding + forecast; `web_search(query)` (optional stretch).
- System prompt forces answers ≤2 sentences, spoken-style, no markdown (it will be spoken aloud).
- **Success criteria:** "what is the weather in Hyderabad" returns real current temp/conditions; unknown cities handled with a spoken apology, never a stack trace.

### S3 — Guardrails (a judged criterion — over-invest here)
Three layers, all logged:
1. **Input filter:** keyword/regex blocklist (profanity, slurs, violence, sexual content, self-harm, illegal acts) — instant rejection, no LLM call wasted.
2. **LLM moderation pass:** Gemini `flash-lite` classifier returns `SAFE`/`UNSAFE` + category before answering. Catches obfuscated/indirect asks ("how do I make my neighbor disappear"). Bonus: Gemini has built-in safety settings (`HarmBlockThreshold`) — turn them on too and mention this layered story in the report.
3. **Output filter:** scan the final answer before it reaches TTS/avatar.
- Refusals are polite and *spoken by the avatar too* ("I can't help with that, but I'm happy to answer something else") — that's fit-&-finish.
- Prompt-injection defense: user text is never concatenated into the system prompt; tools have fixed schemas.
- **Success criteria:** 100% of a 30-case red-team list refused (see §6); zero false refusals on a 20-case benign list.

### S4 — Voice output (TTS)
- Preferred: let Simli handle TTS from text (removes a hop and a quota). Else answer text → ElevenLabs Flash / Deepgram Aura / Gemini TTS → audio stream.
- **Success criteria:** natural voice, audio starts <1.5 s after answer text is ready.

### S5 — Photorealistic avatar (report Question 1 — implement, don't just describe)
- Simli SDK: create WebRTC session on page load (pre-warm!), pipe answer audio/text in; avatar lip-syncs in real time in a video element.
- Idle behavior: avatar stays "listening" between turns (Simli handles idle animation) — this is what makes it feel human.
- **Report depth for Q1** — explain the pipeline: face model (diffusion/NeRF-based rendering of a real-person likeness) + audio-driven lip-sync + expression model, delivered as a WebRTC stream; contrast hosted APIs (Simli/HeyGen LiveAvatar/D-ID/Tavus) vs open-source (SadTalker, MuseTalk, Wav2Lip — free but offline-speed on consumer GPUs, so unsuitable for real-time in 2 days).
- **Success criteria:** avatar visibly speaks the answer with correct lip-sync; total question→avatar-speaking under ~4 s.

### S6 — Fit-&-finish (a judged criterion)
- Single clean page: avatar video centered, mic button, live transcript, conversation history, status states (listening / thinking / speaking) with subtle animation.
- Loading skeletons, error toasts ("mic permission denied — here's how to enable"), mobile-responsive, favicon + title, README with setup + architecture diagram + screenshots.
- 30–60 s demo video (screen recording) in the submission email — recruiters may not run code.
- **Success criteria:** a stranger can open the URL and succeed on first try with zero instructions.

### S7 — Latency engineering (report Question 3)
Implement what's cheap, describe the rest:
- Pre-warm the Simli WebRTC session on page load (biggest win).
- Stream everything: STT interim results, Gemini token streaming via SSE (`StreamingResponse` — works on Vercel; WebSockets don't) — start avatar speech on the first sentence, don't wait for the full answer.
- Fastest-tier models (`flash`/`flash-lite`, not `pro`); cap answer length (shorter answer = less video to generate).
- Report-only items: edge deployment near the avatar provider's region, WebRTC over HTTP polling, sentence-chunked pipelining, speculative pre-fetch of likely tool calls, caching weather responses ~5 min.
- **Success criteria:** measured p50 end-to-end latency reported honestly in the README/report.

### S8 — One-pager PDF report
- Three sections answering the three questions using material from S5, §2, and S7. One page, tight. Include the architecture diagram and a latency table (measured per stage).

---

## 4. Two-day timeline

**Day 1 AM:** repo scaffold (FastAPI `api/index.py` + `public/` frontend + `vercel.json`), S1 mic + STT, S2 weather tool + Gemini wiring — text-in/text-out works end-to-end locally (`uvicorn`).
**Day 1 PM:** S3 all three guardrail layers + red-team test file; S4 TTS. Milestone: voice→voice works.
**Day 2 AM:** S5 Simli avatar integration + pre-warming; S7 streaming optimizations.
**Day 2 PM:** S6 polish, deploy to Vercel, run full test checklist, record demo video, write PDF report, send email.
**Cut line if behind:** general web search tool goes first; weather-only still fully satisfies the brief. Never cut guardrails or the avatar — both are explicitly judged.

---

## 5. What you need to set up (your end)

1. **Gemini API key** — free at aistudio.google.com (app LLM + moderation classifier). Note the free-tier per-model daily request limits and plan usage around them.
2. **DeepSeek API key / command-code login** — for the CLI *build agent* only, not the app.
3. **Simli account + API key** — $10 signup credit / 50 free min/month. Sign up *first*; if approval or credits are an issue, fall back to HeyGen LiveAvatar trial or D-ID trial.
4. **ElevenLabs (or Deepgram) API key** — only if Simli won't do TTS for you.
5. **Vercel account** (GitHub login) — free hosting; keys go in Vercel env vars, never in client code or the repo.
6. **Open-Meteo** — no key needed.
7. Optional: **Tavily/Serper** key (general search stretch goal).
8. A `.env.example` file listing all keys (with dummy values) — reviewers notice this.

**Budget: $0** if free tiers hold. Quota protection rules: develop with a `MOCK_MODE` flag (canned LLM/avatar responses) so iteration burns zero quota; keep Simli minutes for final testing + demo recording; one Gemini answer call + one flash-lite moderation call per query max.

---

## 6. Testing & validation plan (free-tier-aware)

**Golden rule: automated tests never touch paid/limited APIs.** Unit + integration tests run against mocks; only two deliberate live runs consume quota (the final red-team pass and the latency benchmark).

**Unit tests** (pytest, zero quota): guardrail Layer-1 filter (blocklist hits, leetspeak variants, benign near-misses), weather tool parsing with recorded Open-Meteo JSON fixtures (valid city, misspelled, nonexistent, non-English), answer-length capping, refusal-message formatting.

**Integration tests** (pytest + FastAPI `TestClient`, zero quota): mock the Gemini client (`unittest.mock` / recorded responses) → assert the full route logic: input filter → tool call → output filter → response shape; API-failure path returns a spoken error message, not a 500. Open-Meteo is free/keyless, so live-calling it in a couple of tests is fine.

**Guardrail red-team suite** (`tests/redteam.py`) — the only quota-consuming test:
- ~30 unsafe prompts across categories: profanity, hate, violence, sexual, self-harm, illegal, and *indirect* phrasings + prompt-injection attempts ("ignore your instructions and…").
- ~20 benign prompts that superficially look risky ("weather in Kabul", "how do knives get sharpened") — must NOT be refused.
- Quota math: 50 prompts × (1 flash-lite moderation + ≤1 flash answer) ≈ ≤100 requests — comfortably inside Gemini's free daily limits for one run. Design so most unsafe prompts die at the free regex layer (no LLM call at all). Run the full suite **twice total**: once after S3 is built, once before submission. Between those, run only the ~10 cases you changed.
- Assert: every unsafe → polite refusal; every benign → real answer. Include the pass/fail table in the README — concrete evidence for the "guardrails" criterion. **Avatar stays in MOCK_MODE for this suite** — refusal text doesn't need video; zero Simli minutes spent.

**Latency benchmark:** timestamps per stage (STT done → LLM first token → avatar first frame) over **5 runs, not more** (~3 Simli minutes, ~10 Gemini requests); report p50. This table goes straight into report Q3.

**Manual QA checklist (pre-submission):**
- [ ] Fresh incognito browser, deployed URL: mic permission flow works
- [ ] "What is the weather in Hyderabad" → correct, spoken by avatar
- [ ] 3 other cities + one general question
- [ ] 3 offensive queries → polite spoken refusal
- [ ] Mic denied → text input path works
- [ ] Mobile browser check
- [ ] No API keys in client bundle (view-source check) or git history
- [ ] README: setup, architecture diagram, test results, demo GIF

---

## 7. Command-code CLI setup — plugins/skills/MCPs for the build agent

Set these up *before* Day 1 so the DeepSeek agent works from ground truth, not stale training data:

**Environment (local machine):**
- Python 3.11+ with `uv` (or venv + pip): `fastapi`, `uvicorn`, `google-genai`, `httpx`, `pytest`, `pytest-mock`
- Node.js (only for `npm i -g vercel` — the Vercel CLI — and Simli's JS SDK on the frontend)
- Git + GitHub repo from the start (commit history is judged evidence)

**MCP servers / plugins to add to the CLI agent:**
- **Fetch/web-search MCP** (e.g. `fetch` or Tavily/Brave MCP) — so the agent can pull *current* docs for Gemini function calling, Simli SDK, and Vercel Python runtime instead of hallucinating outdated APIs. This is the single highest-value plugin for this project.
- **Docs MCP like Context7** (if available for your CLI) — up-to-date library docs for FastAPI/Gemini SDK inline.
- **Playwright/browser MCP** — lets the agent open the deployed page, click the mic/text UI, and screenshot it: automated fit-&-finish checking without you burning time.
- **Filesystem + shell** access (usually built-in) — needed for `pytest`, `uvicorn` dev server, `vercel deploy`.

**Custom skills/rules file for the agent** (`AGENTS.md` / rules file in repo root — most command-code CLIs auto-read one):
- "Backend is FastAPI on Vercel Python runtime; never suggest WebSockets (unsupported) — use SSE."
- "All external API calls go behind `MOCK_MODE`; tests must never call Gemini/Simli live."
- "Answers are spoken aloud: ≤2 sentences, no markdown in LLM output."
- Paste the §3 spec of whatever you're currently building at the top of each session.

**Agent workflow per spec:** feed one S-section → let it implement → run `pytest` (mocked, free) → review diff → commit. Never let it run the red-team suite or Simli calls on its own — those cost quota; you trigger them manually.

---

## 8. "AI tool usage" judging criterion — make it visible

- Keep an `AI_USAGE.md`: which tool (DeepSeek + command-code CLI + the MCPs above), how you prompted it (this spec fed section-by-section), what you accepted vs corrected. Judges reward *directed* AI use, not blind generation.
- Small, frequent, well-messaged git commits (`feat: S3 guardrail layer 2 — Gemini moderation pass`) show a planned, professional process.
- The app itself uses AI at three points (Gemini answering, Gemini moderation, Simli avatar generation) — say so explicitly in the report.

---

## 9. Submission checklist

- [ ] Deployed Vercel URL + GitHub repo (README with screenshots, architecture, test results)
- [ ] One-pager PDF answering Q1 (avatar, in depth), Q2 (tools & why — table from §2), Q3 (latency — from S7 + measured numbers)
- [ ] Demo video (30–60 s)
- [ ] Email to rajesh@gccwise.com (+ any other listed addresses — recheck the brief, your copy appears cut off after the first address) with URL, repo, PDF, video