"""Application configuration — reads from environment variables."""

import os
from dotenv import load_dotenv

load_dotenv()

# Core API keys
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
SIMLI_API_KEY: str = os.environ.get("SIMLI_API_KEY", "")
SIMLI_FACE_ID: str = os.environ.get("SIMLI_FACE_ID", "")

# Optional
ELEVENLABS_API_KEY: str = os.environ.get("ELEVENLABS_API_KEY", "")
TAVILY_API_KEY: str = os.environ.get("TAVILY_API_KEY", "")
SERPER_API_KEY: str = os.environ.get("SERPER_API_KEY", "")

# Development mode
MOCK_MODE: bool = os.environ.get("MOCK_MODE", "false").lower() == "true"

# Gemini model selection
LLM_MODEL: str = "google/gemini-2.0-flash-001"
LLM_MODEL_FALLBACK: str = "google/gemini-2.5-flash"
MODERATION_MODEL: str = "google/gemini-2.0-flash-lite"
LLM_PROVIDER: str = "openrouter"  # openrouter | gemini
LLM_API_URL: str = "https://openrouter.ai/api/v1/chat/completions"

# Limits
MAX_ANSWER_SENTENCES: int = 2
WEATHER_CACHE_SECONDS: int = 300  # 5 minutes
MAX_QUERY_LENGTH: int = 500

# Safety thresholds (Gemini built-in)
HARM_BLOCK_THRESHOLD: str = "BLOCK_MEDIUM_AND_ABOVE"

# Open-Meteo (no key needed)
OPEN_METEO_GEOCODING_URL: str = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL: str = "https://api.open-meteo.com/v1/forecast"

# Refusal message template
REFUSAL_MESSAGE: str = (
    "I can't help with that, but I'm happy to answer something else. "
    "Try asking me about the weather or another topic."
)
ERROR_MESSAGE: str = (
    "Sorry, I ran into a problem and couldn't get an answer. Please try again."
)
