# Agent Rules — Voice Avatar Assistant

## Stack constraints
- Backend is FastAPI on Vercel Python runtime.
- Never suggest WebSockets (Vercel doesn't support them) — use SSE (`StreamingResponse`) for streaming.
- API keys live in `os.environ`, never in frontend JS.

## Development rules
- All external API calls go behind `MOCK_MODE=True` during development.
- Tests must never call Gemini/Simli live — use mocks for all paid APIs.
- Open-Meteo (weather) is free and keyless, live calls in tests are OK.

## LLM output rules
- Answers are spoken aloud by an avatar: ≤2 sentences, natural spoken style, no markdown.
- Never concatenate user text directly into the system prompt.
- Tools have fixed schemas — no dynamic prompt building from user input.

## Repo conventions
- Backend: `api/` directory (FastAPI app + modules).
- Frontend: `public/` directory (static HTML/CSS/JS).
- Tests: `tests/` directory (pytest).
- Config: root-level `.env.example`, `vercel.json`, `requirements.txt`.
- Docs: root-level `README.md`, `AI_USAGE.md`, `plan.md`.
