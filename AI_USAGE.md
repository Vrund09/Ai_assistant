# AI Tool Usage

This project was built using **DeepSeek** inside the **CommandCode CLI agent** as the primary build tool.

## Tools Used

| Tool | Purpose |
|---|---|
| CommandCode CLI + DeepSeek | Code generation, refactoring, debugging |
| Web search MCP (Tavily) | Pulling current docs for Gemini SDK, Simli API, Vercel |
| Filesystem + shell access | Running pytest, uvicorn, git, vercel deploy |

## How I Prompted

The build spec (`plan.md`) was fed section-by-section:

1. **S1-S2** — Scaffold, backend, weather tool, Gemini wiring
2. **S3** — Three-layer guardrail system
3. **S4-S5** — TTS + Simli avatar integration
4. **S6** — Frontend polish (CSS, animations, responsive)
5. **S7** — Streaming optimizations (SSE, pre-warming)
6. **Tests** — Unit, integration, and red-team suite

Each section was followed by `pytest` (mocked, zero cost) and a git commit with a descriptive message.

## What I Accepted vs Corrected

- **Accepted:** Most scaffold code, config structure, test patterns
- **Corrected:** Function-calling format for Gemini SDK v1.x (iterated based on actual API errors), CORS headers for Vercel, Vercel route config format
- **Hand-written:** CSS animations, conversation history UI, error toast styling

## AI in the App Itself

The deployed app uses AI at three points:

1. **Gemini 2.5 Flash** — Natural language understanding + function calling + answer generation
2. **Gemini 2.5 Flash-Lite** — Content safety classification (moderation Layer 2)
3. **Simli** — AI-driven facial animation + lip-sync for the photorealistic avatar
