"""TTS via edge-tts — serves raw MP3, browser decodes to PCM.

edge-tts returns MP3. We send the MP3 directly to the browser.
The browser's Web Audio API decodes it to raw PCM and pipes it
through Simli's WebRTC channel for lip-sync.

Zero dependencies beyond edge-tts itself.
"""

import logging

logger = logging.getLogger("tts")


async def generate_mp3(text: str, voice: str = "en-US-JennyNeural") -> bytes | None:
    """Generate MP3 audio from text using edge-tts.

    Returns raw MP3 bytes, or None on failure.
    Browser decodes MP3 → PCM → Simli WebRTC.
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

        logger.info("TTS: %d chars → %d bytes MP3", len(text), len(mp3_data))
        return bytes(mp3_data)

    except Exception as e:
        logger.error("TTS error: %s", e)
        return None


# Backward compat alias
async def generate_pcm(text: str, voice: str = "en-US-JennyNeural") -> bytes | None:
    """Alias — now returns MP3 bytes (renamed for clarity)."""
    return await generate_mp3(text, voice)
