# 🤖 AI Tool Usage

This project was built with heavy, **directed** use of AI coding tools. This file documents
which tools were used, how they were prompted, and — importantly — **what was accepted vs.
corrected**, because good AI usage is about steering the tool, not blind generation.

---

## Tools used

| Tool | Role |
|---|---|
| **Claude Code (CLI agent)** | Primary build agent — scaffolding, writing FastAPI routes, the guardrail pipeline, tests, and docs, from a written spec fed section-by-section. |
| **A written build spec (`plan.md`)** | The single source of truth. Each spec section (S1 voice, S2 data, S3 guardrails, …) was pasted in as the working prompt so the agent built against ground truth, not stale training data. |
| **`AGENTS.md` rules file** | Repo-root rules the CLI auto-reads every session — e.g. *"never suggest WebSockets on Vercel, use SSE"*, *"all external calls behind `MOCK_MODE`; tests never call live APIs"*, *"answers are spoken aloud: ≤2 sentences, no markdown."* |
| **Web/docs lookups** | Used to pull *current* API shapes for the Simli WebRTC handshake, the Groq OpenAI-compatible endpoint, and the Vercel Python runtime — instead of hallucinating outdated SDKs. |

The **app itself** uses AI at three points: (1) Groq LLM composing the answer, (2) Groq LLM as
a safety classifier (guardrail Layer 2), and (3) the Simli model generating the photorealistic
talking-avatar video.

---

## How I prompted it

- **Spec-driven, one section at a time.** Rather than "build me a voice assistant," each
  feature was handed over as a scoped spec with explicit success criteria, then implemented,
  tested, reviewed, and committed before moving on.
- **Tests-as-a-contract.** The agent was told to write `pytest` suites that run fully mocked
  (`MOCK_MODE`), so iteration burned **zero API quota** and every change was verifiable offline.
- **Small, well-messaged commits.** ~40 commits with conventional messages
  (`feat: S3 guardrail layer 2`, `fix: handle Groq rate limits gracefully`) — the git history
  is a visible record of a planned, professional process.

---

## What I accepted vs. corrected

Directing the AI mattered most where its first answer was wrong for *this* environment:

- **Streamlit → FastAPI.** The initial instinct was a Streamlit app. I rejected it: Streamlit
  can't cleanly handle browser mic + WebRTC avatar video. Redirected to a static frontend +
  stateless FastAPI on Vercel.
- **WebSockets → browser-side realtime.** Early drafts tried server WebSockets for the avatar.
  Vercel serverless doesn't support them — corrected so **both** realtime channels (STT and the
  Simli WebRTC stream) run browser-side and FastAPI stays pure request/response.
- **LLM provider swap: Gemini → Groq.** The plan started on Gemini's free tier; in practice
  Groq's `llama-3.3-70b-versatile` gave much higher tokens/sec (lower latency) on an
  OpenAI-compatible endpoint. Swapped the client while keeping the `GEMINI_API_KEY` env name
  for compatibility. *(Corrected AI's assumption that the plan was immutable.)*
- **TTS/lip-sync pipeline.** Got the audio path working through trial and correction: edge-tts
  returns **MP3**, which the browser decodes via the Web Audio API to **16 kHz mono PCM** and
  streams over the Simli WebRTC data channel for lip-sync — while browser speech synthesis plays
  the audible voice **in parallel**. Several iterations (`fix: run browser TTS + Simli PCM in
  parallel…`) were needed to stop the two audio paths from blocking each other.
- **Guardrail Layer 2 hardening.** The LLM classifier was made **fail-open** (any
  timeout/error/non-200 returns *safe*) so a moderation hiccup can never block a legitimate
  user, and its JSON parsing tolerates models that wrap output in prose or code fences — a
  correction over the naive "assume clean JSON" first draft.
- **Rate-limit resilience.** Groq 429s originally crashed the request; corrected to degrade
  gracefully into a spoken "I'm a bit overwhelmed, try again" message rather than a 500.

---

## Why this counts as good AI usage

The AI wrote most of the code, but **every architectural decision was human-steered**: the
framework choice, the serverless constraint, the provider swap, the fail-safe posture of the
guardrails, and the parallel audio pipeline all came from correcting the model against the real
constraints of the deployment target. The result is a working, tested, deployed app rather than
a plausible-looking draft.
