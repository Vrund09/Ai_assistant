"""Unit tests for weather tools."""

import pytest
from api.tools import WeatherResult


class TestWeatherResultFormat:
    def test_successful_weather(self):
        weather = WeatherResult(success=True, city="London", temperature=15.3, condition="partly cloudy")
        assert weather.success
        assert weather.city == "London"
        assert weather.temperature == 15.3

    def test_failed_weather_returns_error(self):
        weather = WeatherResult(success=False, city="XyzzyTown", error="City not found")
        assert not weather.success
        assert weather.error is not None
