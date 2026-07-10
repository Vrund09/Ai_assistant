"""TTS via Google Gemini TTS REST API — no SDK, just httpx.

Gemini TTS returns base64-encoded 24kHz PCM audio.
We decode + resample to 16kHz mono for Simli WebRTC.
Uses the GEMINI_API_KEY (Groq) — but falls back if it doesn't work.
"""

import base64
import logging
import struct

from api.config import GEMINI_API_KEY

logger = logging.getLogger("tts")


async def generate_pcm(text: str, voice: str = "Puck") -> bytes | None:
    """Generate PCM 16kHz mono Int16 audio using Google Gemini TTS REST API.

    Free voices (female): Puck, Kore, Leda, Aoede.
    Falls back gracefully if API key or network is unavailable.
    """
    if not GEMINI_API_KEY:
        logger.warning("No API key for TTS")
        return None

    try:
        import httpx

        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent"

        body = {
            "contents": [{"parts": [{"text": f"Speak this naturally: {text}"}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}
                },
            },
        }

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{url}?key={GEMINI_API_KEY}",
                json=body,
                headers={"Content-Type": "application/json"},
            )

            if response.status_code != 200:
                logger.error("TTS API %s: %s", response.status_code, response.text[:150])
                return None

            data = response.json()
            candidates = data.get("candidates", [])
            if not candidates:
                return None

            parts = candidates[0].get("content", {}).get("parts", [])
            for part in parts:
                if "inlineData" in part and part["inlineData"].get("mimeType") == "audio/pcm":
                    audio_b64 = part["inlineData"]["data"]
                    if audio_b64:
                        raw_24khz = base64.b64decode(audio_b64)
                        pcm_16khz = _resample_24k_to_16k(raw_24khz)
                        logger.info("TTS: %d chars → %d bytes PCM", len(text), len(pcm_16khz))
                        return pcm_16khz

            return None

    except Exception as e:
        logger.error("TTS error: %s", e)
        return None


def _resample_24k_to_16k(pcm: bytes) -> bytes:
    """Resample 24kHz Int16 PCM → 16kHz Int16 PCM (simple linear interpolation)."""
    samples = struct.unpack(f"<{len(pcm)//2}h", pcm)
    ratio = 24000 / 16000
    out_len = int(len(samples) / ratio)
    out = bytearray()
    for i in range(out_len):
        src_idx = i * ratio
        idx_lo = int(src_idx)
        idx_hi = min(idx_lo + 1, len(samples) - 1)
        frac = src_idx - idx_lo
        val = int(samples[idx_lo] * (1 - frac) + samples[idx_hi] * frac)
        val = max(-32768, min(32767, val))
        out.extend(struct.pack("<h", val))
    return bytes(out)
