"""Tools — Open-Meteo weather and optional web search."""

import logging
import time
from dataclasses import dataclass

import httpx

from api.config import (
    OPEN_METEO_GEOCODING_URL,
    OPEN_METEO_FORECAST_URL,
    TAVILY_API_KEY,
    SERPER_API_KEY,
    WEATHER_CACHE_SECONDS,
)

logger = logging.getLogger("tools")
_weather_cache: dict[str, tuple[float, dict]] = {}


@dataclass
class WeatherResult:
    success: bool
    city: str
    temperature: float | None = None
    condition: str | None = None
    humidity: int | None = None
    wind_speed: float | None = None
    error: str | None = None


async def get_weather(city: str) -> WeatherResult:
    """Get current weather via Open-Meteo (free, keyless). Two-step: geocode → forecast."""
    cache_key = city.lower().strip()

    if cache_key in _weather_cache:
        timestamp, cached = _weather_cache[cache_key]
        if time.time() - timestamp < WEATHER_CACHE_SECONDS:
            logger.info("Weather cache hit: %s", city)
            return WeatherResult(**cached)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            geo_response = await client.get(
                OPEN_METEO_GEOCODING_URL,
                params={"name": city, "count": 1, "language": "en"},
            )
            geo_response.raise_for_status()
            geo_data = geo_response.json()

            if not geo_data.get("results"):
                return WeatherResult(
                    success=False,
                    city=city,
                    error=f"I couldn't find a city called {city}. Could you check the spelling?",
                )

            location = geo_data["results"][0]
            lat, lon = location["latitude"], location["longitude"]
            resolved_name = location.get("name", city)

            weather_response = await client.get(
                OPEN_METEO_FORECAST_URL,
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
                    "timezone": "auto",
                },
            )
            weather_response.raise_for_status()
            weather_data = weather_response.json()

            current = weather_data.get("current", {})
            weather_code = current.get("weather_code", 0)
            condition = _weather_code_to_text(weather_code)

            result = WeatherResult(
                success=True,
                city=resolved_name,
                temperature=current.get("temperature_2m"),
                condition=condition,
                humidity=current.get("relative_humidity_2m"),
                wind_speed=current.get("wind_speed_10m"),
            )

            _weather_cache[cache_key] = (time.time(), result.__dict__)
            return result

    except Exception as e:
        logger.error("Weather error for %s: %s", city, e)
        return WeatherResult(
            success=False,
            city=city,
            error="Sorry, I couldn't get the weather right now. Please try again.",
        )


def _weather_code_to_text(code: int) -> str:
    mapping = {
        0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
        45: "foggy", 48: "depositing rime fog",
        51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
        61: "slight rain", 63: "moderate rain", 65: "heavy rain",
        71: "slight snow", 73: "moderate snow", 75: "heavy snow",
        80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
        95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail",
    }
    return mapping.get(code, "unknown")


def format_weather_answer(weather: WeatherResult) -> str:
    if not weather.success:
        return weather.error or "Sorry, I couldn't get the weather."
    parts = [f"Right now in {weather.city},"]
    if weather.temperature is not None:
        parts.append(f"it's {weather.temperature:.0f} degrees")
    if weather.condition:
        parts.append(f"with {weather.condition}")
    parts.append(".")
    return " ".join(parts)


async def web_search(query: str) -> str:
    """Web search via Tavily or Serper (optional stretch goal)."""
    if TAVILY_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api.tavily.com/search",
                    json={"query": query, "api_key": TAVILY_API_KEY},
                )
                response.raise_for_status()
                data = response.json()
                results = data.get("results", [])
                if results:
                    return " ".join(r.get("content", "") for r in results[:3])[:500]
        except Exception as e:
            logger.error("Tavily error: %s", e)

    if SERPER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://google.serper.dev/search",
                    json={"q": query},
                    headers={"X-API-KEY": SERPER_API_KEY},
                )
                response.raise_for_status()
                data = response.json()
                organic = data.get("organic", [])
                if organic:
                    return " ".join(r.get("snippet", "") for r in organic[:3])[:500]
        except Exception as e:
            logger.error("Serper error: %s", e)

    return "I don't have web search configured yet, but I can tell you about the weather."
