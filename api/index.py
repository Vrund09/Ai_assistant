"""FastAPI entry point — Vercel serverless handler.

Architecture:
  Browser → POST /api/chat → Guardrails → Gemini (tool calling) → Answer
  Browser → Simli WebRTC (direct, not through this server)
"""

import logging
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.config import MOCK_MODE, ERROR_MESSAGE
from api.guardrails import run_guardrail_pipeline, layer3_output_scan
from api.tools import get_weather, web_search, format_weather_answer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api")

app = FastAPI(title="Voice Avatar Assistant", version="0.1.0")

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


from google.genai.types import Tool, FunctionDeclaration, Schema, Type

TOOLS = [
    Tool(
        function_declarations=[
            FunctionDeclaration(
                name="get_weather",
                description="Get current weather for a city.",
                parameters=Schema(
                    type=Type.OBJECT,
                    properties={
                        "city": Schema(
                            type=Type.STRING,
                            description="City name, e.g. 'Hyderabad' or 'New York'.",
                        )
                    },
                    required=["city"],
                ),
            ),
        ]
    ),
    Tool(
        function_declarations=[
            FunctionDeclaration(
                name="web_search",
                description="Search the web for current information.",
                parameters=Schema(
                    type=Type.OBJECT,
                    properties={
                        "query": Schema(
                            type=Type.STRING,
                            description="The search query.",
                        )
                    },
                    required=["query"],
                ),
            ),
        ]
    ),
]

SYSTEM_PROMPT = """You are a helpful voice assistant. You speak answers aloud through an avatar.

Rules:
- Answer in 1-2 short sentences, natural spoken style.
- No markdown, no lists, no formatting — plain spoken English.
- Use the get_weather tool when the user asks about weather.
- Use the web_search tool for general knowledge questions.
- If a tool fails, apologize briefly and suggest trying again.
- Never guess weather data — always use the tool.
- Be warm and friendly, like a human assistant."""


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
    """Call Gemini with function calling, or return mock answer."""
    if MOCK_MODE:
        logger.info("MOCK_MODE: returning canned answer")
        return "The weather in Hyderabad is currently 32 degrees with clear skies."

    try:
        from google import genai
        from api.config import GEMINI_API_KEY, LLM_MODEL

        if not GEMINI_API_KEY:
            return "I'm not configured with an API key yet. Please set GEMINI_API_KEY."

        from google.genai.types import Content, Part, FunctionResponse

        client = genai.Client(api_key=GEMINI_API_KEY)

        response = client.models.generate_content(
            model=LLM_MODEL,
            contents=user_message,
            config={
                "system_instruction": SYSTEM_PROMPT,
                "tools": TOOLS,
                "temperature": 0.7,
                "max_output_tokens": 200,
            },
        )

        if response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "function_call") and part.function_call:
                    func_name = part.function_call.name
                    args = dict(part.function_call.args)

                    logger.info("Gemini calling tool: %s(%s)", func_name, args)

                    if func_name == "get_weather":
                        weather = await get_weather(**args)
                        tool_result = format_weather_answer(weather)
                    elif func_name == "web_search":
                        tool_result = await web_search(**args)
                    else:
                        tool_result = f"Unknown tool: {func_name}"

                    follow_up = client.models.generate_content(
                        model=LLM_MODEL,
                        contents=[
                            Content(role="user", parts=[Part.from_text(text=user_message)]),
                            Content(
                                role="model",
                                parts=[Part.from_function_call(name=func_name, args=args)],
                            ),
                            Content(
                                role="user",
                                parts=[
                                    Part.from_function_response(
                                        name=func_name,
                                        response={"result": tool_result},
                                    )
                                ],
                            ),
                        ],
                        config={
                            "system_instruction": SYSTEM_PROMPT,
                            "temperature": 0.7,
                            "max_output_tokens": 200,
                        },
                    )
                    return follow_up.text.strip()

        return response.text.strip()

    except Exception as e:
        logger.error("Gemini call error: %s", e)
        return ERROR_MESSAGE


@app.get("/api/health")
async def health():
    return {"status": "ok", "mock_mode": MOCK_MODE}


@app.get("/api/simli-config")
async def simli_config():
    from api.config import SIMLI_API_KEY, SIMLI_FACE_ID
    if not SIMLI_API_KEY:
        return {"error": "Simli not configured"}
    return {"apiKey": SIMLI_API_KEY, "faceId": SIMLI_FACE_ID}
