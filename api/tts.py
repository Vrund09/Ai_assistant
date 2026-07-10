"""Gemini TTS — generates PCM audio for Simli WebRTC.

Gemini returns 24kHz mono PCM (base64-encoded).
Simli needs 16kHz mono PCM Int16.
We decode and resample server-side.
"""

import base64
import logging
import struct
from io import BytesIO

from api.config import GEMINI_API_KEY

logger = logging.getLogger("tts")


async def generate_pcm(text: str, voice: str = "Puck") -> bytes | None:
    """Generate raw PCM 16kHz mono Int16 audio from text using Gemini TTS.

    Returns raw PCM bytes ready for Simli WebRTC, or None on failure.
    """
    if not GEMINI_API_KEY:
        logger.warning("No Gemini API key — TTS unavailable")
        return None

    try:
        from google import genai

        client = genai.Client(api_key=GEMINI_API_KEY)

        interaction = client.interactions.create(
            model="gemini-2.5-flash-preview-tts",
            input=text,
            response_format={"type": "audio"},
            generation_config={"speech_config": [{"voice": voice}]},
        )

        # Audio comes as base64-encoded 24kHz mono PCM (Int16)
        audio_b64 = interaction.output_audio.data
        if not audio_b64:
            logger.warning("TTS returned empty audio")
            return None

        raw_24khz = base64.b64decode(audio_b64)

        # Resample 24kHz → 16kHz (Simli requirement)
        # Simple ratio: keep every 3rd sample out of 2 (24000/16000 = 3/2)
        pcm_16khz = _resample_pcm(raw_24khz, 24000, 16000)

        logger.info("TTS: %d chars → %d bytes PCM 16kHz", len(text), len(pcm_16khz))
        return pcm_16khz

    except Exception as e:
        logger.error("TTS error: %s", e)
        return None


def _resample_pcm(pcm: bytes, from_rate: int, to_rate: int) -> bytes:
    """Simple linear-interpolation PCM resampler.

    Converts Int16 mono PCM from `from_rate` Hz to `to_rate` Hz.
    """
    if from_rate == to_rate:
        return pcm

    samples = struct.unpack("<%dh" % (len(pcm) // 2), pcm)
    ratio = from_rate / to_rate
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
