"""Integration tests for FastAPI endpoints — zero API quota (mocked)."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from api.index import app

client = TestClient(app)



def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "mock_mode" in data


@patch("api.index._call_gemini")
@patch("api.guardrails.layer2_moderation")
def test_chat_benign_message(mock_moderation, mock_gemini):
    mock_moderation.return_value = (False, None)
    mock_gemini.return_value = "The weather in Hyderabad is 32 degrees with clear skies."

    response = client.post("/api/chat", json={"message": "What is the weather in Hyderabad?"})
    assert response.status_code == 200
    data = response.json()
    assert not data["blocked"]
    assert "Hyderabad" in data["reply"]


@patch("api.index._call_gemini")
@patch("api.guardrails.layer2_moderation")
def test_chat_blocked_profanity(mock_moderation, mock_gemini):
    response = client.post("/api/chat", json={"message": "fuck you"})
    assert response.status_code == 200
    data = response.json()
    assert data["blocked"]
    assert data["block_reason"] is not None
    mock_gemini.assert_not_called()


@patch("api.index._call_gemini")
@patch("api.guardrails.layer2_moderation")
def test_chat_empty_message(mock_moderation, mock_gemini):
    response = client.post("/api/chat", json={"message": ""})
    assert response.status_code == 200
    data = response.json()
    assert data["blocked"]


@patch("api.index._call_gemini")
@patch("api.guardrails.layer2_moderation")
def test_chat_error_handling(mock_moderation, mock_gemini):
    mock_moderation.return_value = (False, None)
    mock_gemini.side_effect = Exception("API error")

    response = client.post("/api/chat", json={"message": "hello"})
    assert response.status_code == 200
    data = response.json()
    assert "sorry" in data["reply"].lower() or "couldn't" in data["reply"].lower()


@patch("api.config.MOCK_MODE", True)
def test_simli_session_mock_mode_true():
    response = client.post("/api/simli-session")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert "sessionToken" in data
    assert "wsUrl" in data


@patch("api.config.MOCK_MODE", False)
@patch("api.config.SIMLI_API_KEY", "")
@patch("api.config.SIMLI_FACE_ID", "")
def test_simli_session_no_config():
    response = client.post("/api/simli-session")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert "not configured" in data["error"] or "missing" in data["error"].lower()


@patch("api.config.MOCK_MODE", False)
@patch("api.config.SIMLI_API_KEY", "test_key")
@patch("api.config.SIMLI_FACE_ID", "test_face")
@patch("httpx.AsyncClient.get")
@patch("httpx.AsyncClient.post")
def test_simli_session_live_mocked(mock_post, mock_get):
    mock_get.return_value = MagicMock(
        status_code=200,
        json=lambda: [{"urls": "stun:stun.l.google.com:19302"}]
    )
    mock_post.return_value = MagicMock(
        status_code=200,
        json=lambda: {"session_token": "test_session_token_xyz"}
    )

    response = client.post("/api/simli-session")
    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert data["sessionToken"] == "test_session_token_xyz"
    assert "wsUrl" in data


def test_simli_config_deleted():
    response = client.get("/api/simli-config")
    assert response.status_code == 404

