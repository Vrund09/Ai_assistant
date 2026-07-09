"""Unit tests for weather and web search tools."""

import pytest
from api.tools import format_weather_answer, WeatherResult


class TestFormatWeatherAnswer:
    def test_successful_weather(self):
        weather = WeatherResult(
            success=True,
            city="London",
            temperature=15.3,
            condition="partly cloudy",
        )
        result = format_weather_answer(weather)
        assert "London" in result
        assert "15 degrees" in result
        assert "partly cloudy" in result

    def test_failed_weather_returns_error(self):
        weather = WeatherResult(
            success=False,
            city="XyzzyTown",
            error="City not found",
        )
        result = format_weather_answer(weather)
        assert "not found" in result.lower()

    def test_missing_temperature(self):
        weather = WeatherResult(success=True, city="Paris")
        result = format_weather_answer(weather)
        assert "Paris" in result
