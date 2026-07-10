"""TTS via edge-tts — free Microsoft Edge neural voices, no API key.

Produces PCM Int16 16kHz mono audio for Simli WebRTC lip-sync.
edge-tts returns MP3 → pydub/ffmpeg converts to raw PCM.
"""

import io
import logging
import struct
import subprocess

logger = logging.getLogger("tts")

# Female voices (for avatar)
VOICES = {
    "jenny": "en-US-JennyNeural",
    "aria": "en-US-AriaNeural",
    "neerja": "en-IN-NeerjaNeural",
}


async def generate_pcm(text: str, voice: str = "en-US-JennyNeural") -> bytes | None:
    """Generate PCM 16kHz mono Int16 audio for Simli WebRTC.

    Uses Microsoft Edge TTS (free, no key, no quota).
    Returns None → frontend falls back to browser TTS.
    """
    try:
        import edge_tts

        communicate = edge_tts.Communicate(text, voice)

        mp3_data = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                mp3_data.extend(chunk["data"])

        if not mp3_data:
            logger.warning("edge-tts returned empty audio")
            return None

        pcm = _mp3_to_pcm16(bytes(mp3_data))
        if pcm:
            logger.info("TTS: %d chars → %d bytes PCM 16kHz", len(text), len(pcm))
        return pcm

    except Exception as e:
        logger.error("TTS error: %s", e)
        return None


def _mp3_to_pcm16(mp3_data: bytes) -> bytes | None:
    """Convert MP3 → PCM Int16 16kHz mono.

    Tries: pydub → ffmpeg CLI → None (browser TTS fallback).
    """
    # Strategy 1: pydub (works on Vercel Python 3.12)
    try:
        from pydub import AudioSegment
        audio = AudioSegment.from_mp3(io.BytesIO(mp3_data))
        audio = audio.set_frame_rate(16000).set_channels(1).set_sample_width(2)
        return audio.raw_data
    except Exception as e:
        logger.debug("pydub unavailable: %s", e)

    # Strategy 2: ffmpeg subprocess
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", "pipe:0", "-f", "s16le", "-ar", "16000", "-ac", "1", "pipe:1"],
            input=mp3_data, capture_output=True, timeout=10,
        )
        if proc.returncode == 0 and proc.stdout:
            return proc.stdout
    except Exception as e:
        logger.debug("ffmpeg unavailable: %s", e)

    return None
