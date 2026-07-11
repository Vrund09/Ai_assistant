"""FastAPI entry point — Vercel serverless handler.

Architecture:
  Browser → POST /api/chat → Guardrails → Gemini (tool calling) → Answer
  Browser → Simli WebRTC (direct, not through this server)
"""

import logging
import time
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api.config import MOCK_MODE, ERROR_MESSAGE, GEMINI_API_KEY
from api.guardrails import run_guardrail_pipeline, layer3_output_scan
from api.tools import get_weather, web_search

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api")

app = FastAPI(title="Voice Avatar Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=0, max_length=1000)


class ChatResponse(BaseModel):
    reply: str
    blocked: bool = False
    block_reason: str | None = None
    latency_ms: float | None = None


@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Handle a chat message — guardrails → Gemini → answer."""
    t0 = time.time()
    user_message = request.message.strip()

    # Step 1: Guardrail pipeline (Layers 1 + 2)
    guard_result = await run_guardrail_pipeline(user_message)
    if guard_result.blocked:
        latency_ms = (time.time() - t0) * 1000
        return ChatResponse(
            reply=guard_result.response_text,
            blocked=True,
            block_reason=guard_result.reason,
            latency_ms=latency_ms,
        )

    # Step 2: Call Gemini (or mock)
    try:
        answer = await _call_gemini(user_message)
    except Exception as e:
        logger.error("Unexpected error in chat: %s", e)
        answer = ERROR_MESSAGE

    # Step 3: Layer 3 output scan
    blocked, reason = layer3_output_scan(answer)
    if blocked:
        from api.config import REFUSAL_MESSAGE
        latency_ms = (time.time() - t0) * 1000
        return ChatResponse(
            reply=REFUSAL_MESSAGE,
            blocked=True,
            block_reason=reason,
            latency_ms=latency_ms,
        )

    latency_ms = (time.time() - t0) * 1000
    return ChatResponse(reply=answer, latency_ms=latency_ms)


async def _call_gemini(user_message: str) -> str:
    """Call LLM via OpenAI-compatible API (OpenRouter) with Gemini fallback."""
    if MOCK_MODE:
        return "The weather in Hyderabad is currently 32 degrees with clear skies."

    prompt = await _build_prompt(user_message)

    if not GEMINI_API_KEY:
        return "I'm not configured with an API key yet."

    # Groq API (OpenAI-compatible)
    import httpx
    from api.config import LLM_MODEL, LLM_API_URL, GEMINI_API_KEY as gkey

    headers = {
        "Authorization": f"Bearer {gkey}",
        "Content-Type": "application/json",
    }
    body = {"model": LLM_MODEL, "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.7, "max_tokens": 200}

    async with httpx.AsyncClient(timeout=25.0) as client:
        response = await client.post(LLM_API_URL, headers=headers, json=body)
        if response.status_code == 200:
            data = response.json()
            logger.info("Groq LLM OK: %s", data.get("model", LLM_MODEL))
            return data["choices"][0]["message"]["content"].strip()
        else:
            logger.error("Groq error %s: %s", response.status_code, response.text[:200])
            return "I'm a bit overwhelmed right now. Give me a moment and try again."


async def _build_prompt(user_message: str) -> str:
    """Build LLM prompt with weather context pre-fetched."""
    weather_context = ""
    msg_lower = user_message.lower()
    if any(w in msg_lower for w in ["weather", "temperature", "rain", "sunny", "cloud", "forecast", "humidity", "wind"]):
        city = _extract_city(user_message)
        if city:
            weather = await get_weather(city)
            if weather.success:
                temp = f"{weather.temperature:.0f}" if weather.temperature else "?"
                weather_context = (
                    f"Weather for {weather.city}: {temp}°C, {weather.condition}, "
                    f"humidity {weather.humidity}%, wind {weather.wind_speed} km/h."
                )
            else:
                weather_context = str(weather.error)

    base = (
        "You are a warm, friendly voice assistant. Answer in 1-2 short sentences, "
        "natural spoken style. No markdown.\n\n"
    )
    if weather_context:
        return (
            base + f"Current weather data: {weather_context}\n\n"
            f'The user asked: "{user_message}"\n'
            "Include the weather data naturally in your answer."
        )
    return base + f'The user asked: "{user_message}"'


def _extract_city(text: str) -> str | None:
    """Extract city name from a weather query."""
    import re
    patterns = [
        r"weather\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.|\s+(?:today|tomorrow|now|right|is))",
        r"(?:what(?:'s| is| are).*?weather)\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.)",
        r"(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.|,)\s*(?:what|how|tell)",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            city = m.group(1).strip()
            if len(city) > 2 and len(city) < 50:
                return city
    return None


@app.get("/api/health")
async def health():
    from api.config import LLM_API_URL, LLM_MODEL
    return {
        "status": "ok",
        "mock_mode": MOCK_MODE,
        "llm_url": LLM_API_URL,
        "llm_model": LLM_MODEL,
    }


@app.post("/api/simli-session")
async def create_simli_session():
    """Create a fresh Simli WebRTC session. API key stays server-side."""
    from api.config import SIMLI_API_KEY, SIMLI_FACE_ID, MOCK_MODE

    if MOCK_MODE:
        return {
            "available": True,
            "iceServers": [{"urls": "stun:stun.l.google.com:19302"}],
            "sessionToken": "mock_session_token_123456",
            "wsUrl": "wss://api.simli.ai/compose/webrtc/p2p?session_token=mock_session_token_123456&enableSFU=true",
        }

    if not SIMLI_API_KEY or not SIMLI_FACE_ID:
        return {"error": "Simli not configured", "available": False}

    import httpx
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            # Step 1: Fetch ICE servers
            ice_resp = await client.get(
                "https://api.simli.ai/compose/ice",
                headers={"x-simli-api-key": SIMLI_API_KEY},
            )
            if ice_resp.status_code != 200:
                return {"error": f"ICE fetch failed: {ice_resp.status_code}", "available": False}
            ice_servers = ice_resp.json()

            # Step 2: Create session token
            token_resp = await client.post(
                "https://api.simli.ai/compose/token",
                headers={
                    "Content-Type": "application/json",
                    "x-simli-api-key": SIMLI_API_KEY,
                },
                json={
                    "faceId": SIMLI_FACE_ID,
                    "handleSilence": True,
                    "maxSessionLength": 21600,   # 6 hours
                    "maxIdleTime": 600,           # 10 minutes
                },
            )
            if token_resp.status_code != 200:
                return {"error": f"Token creation failed: {token_resp.status_code}", "available": False}
            token_data = token_resp.json()
        except Exception as e:
            return {"error": f"Simli connection failed: {str(e)}", "available": False}

    return {
        "available": True,
        "iceServers": ice_servers,
        "sessionToken": token_data["session_token"],
        "wsUrl": (
            "wss://api.simli.ai/compose/webrtc/p2p"
            f"?session_token={token_data['session_token']}"
            "&enableSFU=true"
        ),
    }



@app.get("/api/tts")
async def tts_endpoint(text: str = "", voice: str = "en-US-JennyNeural"):
    """Generate audio from text using edge-tts (free, no key).

    Returns MP3 audio bytes. Browser decodes via Web Audio API.
    Female voices: en-US-JennyNeural, en-US-AriaNeural, en-IN-NeerjaNeural
    """
    from fastapi.responses import Response

    if not text or not text.strip():
        return {"error": "No text provided"}

    from api.tts import generate_mp3

    mp3 = await generate_mp3(text.strip(), voice)
    if mp3 is None:
        return {"error": "TTS generation failed"}

    return Response(content=mp3, media_type="audio/mpeg")


# Mount static frontend (serve public/ directory)
possible_paths = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public"),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "public"),
    os.path.join(os.getcwd(), "public"),
    os.path.join(os.getcwd(), "..", "public"),
]

public_dir = None
for path in possible_paths:
    if os.path.isdir(path):
        public_dir = path
        logger.info("Found public directory at %s", path)
        break

if public_dir:
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")
else:
    logger.error("public/ directory not found in any of the expected paths: %s", possible_paths)
    @app.get("/")
    async def root():
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content="""<!DOCTYPE html>
<html><head><title>Voice Avatar Assistant</title></head>
<body style="background:#0f0f13;color:#e4e4e7;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
<div><h1>Setup Required</h1><p>The public/ directory was not found. Deploy with Vercel or serve locally.</p></div>
</body></html>""")
