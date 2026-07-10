"""FastAPI entry point — Vercel serverless handler.

Architecture:
  Browser → POST /api/chat → Guardrails → Gemini (tool calling) → Answer
  Browser → Simli WebRTC (direct, not through this server)
"""

import logging
import time
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api.config import MOCK_MODE, ERROR_MESSAGE
from api.guardrails import run_guardrail_pipeline, layer3_output_scan
from api.tools import get_weather, web_search

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("api")

app = FastAPI(title="Voice Avatar Assistant", version="1.0.0")

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
    """Call LLM via OpenAI-compatible API (OpenRouter) with Gemini fallback."""
    if MOCK_MODE:
        return "The weather in Hyderabad is currently 32 degrees with clear skies."

    prompt = await _build_prompt(user_message)

    if not GEMINI_API_KEY:
        return "I'm not configured with an API key yet."

    # Try OpenRouter (OpenAI-compatible) first
    try:
        import httpx
        from api.config import GEMINI_API_KEY as key, LLM_MODEL, LLM_API_URL

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://gcc-livid.vercel.app",
            "X-Title": "Voice Avatar Assistant",
        }
        body = {"model": LLM_MODEL, "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7, "max_tokens": 200}

        async with httpx.AsyncClient(timeout=25.0) as client:
            response = await client.post(LLM_API_URL, headers=headers, json=body)
            if response.status_code == 200:
                data = response.json()
                return data["choices"][0]["message"]["content"].strip()
            else:
                logger.warning("OpenRouter %s: %s", response.status_code, response.text[:200])
    except Exception as e:
        logger.warning("OpenRouter error: %s, trying Gemini fallback", e)

    # Fallback: direct Google Gemini
    try:
        from google import genai
        from api.config import GEMINI_API_KEY as gkey
        client = genai.Client(api_key=gkey)
        for model in ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.0-flash-lite"]:
            try:
                response = client.models.generate_content(
                    model=model, contents=prompt,
                    config={"temperature": 0.7, "max_output_tokens": 200})
                text = (response.text or "").strip()
                if text:
                    logger.info("Gemini fallback OK: %s", model)
                    return text
            except Exception as e2:
                logger.warning("Gemini %s: %s", model, str(e2)[:80])
    except Exception as e:
        logger.error("Gemini fallback error: %s", e)

    return "I'm having trouble connecting to my brain right now. Please try again in a moment."


async def _build_prompt(user_message: str) -> str:
    """Build LLM prompt with weather context pre-fetched."""
    weather_context = ""
    msg_lower = user_message.lower()
    if any(w in msg_lower for w in ["weather", "temperature", "rain", "sunny", "cloud", "forecast", "humidity", "wind"]):
        city = _extract_city(user_message)
        if city:
            weather = await get_weather(city)
            if weather.success:
                temp = f"{weather.temperature:.0f}" if weather.temperature else "?"
                weather_context = (
                    f"Weather for {weather.city}: {temp}°C, {weather.condition}, "
                    f"humidity {weather.humidity}%, wind {weather.wind_speed} km/h."
                )
            else:
                weather_context = str(weather.error)

    base = (
        "You are a warm, friendly voice assistant. Answer in 1-2 short sentences, "
        "natural spoken style. No markdown.\n\n"
    )
    if weather_context:
        return (
            base + f"Current weather data: {weather_context}\n\n"
            f'The user asked: "{user_message}"\n'
            "Include the weather data naturally in your answer."
        )
    return base + f'The user asked: "{user_message}"'


def _extract_city(text: str) -> str | None:
    """Extract city name from a weather query."""
    import re
    patterns = [
        r"weather\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.|\s+(?:today|tomorrow|now|right|is))",
        r"(?:what(?:'s| is| are).*?weather)\s+(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.)",
        r"(?:in|for|at)\s+([A-Za-z\s]+?)(?:\?|$|\.|,)\s*(?:what|how|tell)",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            city = m.group(1).strip()
            if len(city) > 2 and len(city) < 50:
                return city
    return None


@app.get("/api/health")
async def health():
    return {"status": "ok", "mock_mode": MOCK_MODE}


@app.get("/api/simli-config")
async def simli_config():
    from api.config import SIMLI_API_KEY, SIMLI_FACE_ID
    if not SIMLI_API_KEY:
        return {"error": "Simli not configured"}
    return {"apiKey": SIMLI_API_KEY, "faceId": SIMLI_FACE_ID}


@app.get("/api/tts")
async def tts_endpoint(text: str = "", voice: str = "Puck"):
    """Generate PCM 16kHz mono audio from text using Gemini TTS.

    Returns raw PCM bytes for direct piping into Simli WebRTC.
    Voice options (female): Puck, Kore, Leda, Aoede, Autonoe, Callirrhoe
    """
    from fastapi.responses import Response

    if not text or not text.strip():
        return {"error": "No text provided"}

    from api.tts import generate_pcm

    pcm = await generate_pcm(text.strip(), voice)
    if pcm is None:
        return {"error": "TTS generation failed"}

    return Response(content=pcm, media_type="audio/pcm")


# Mount static frontend (serve public/ directory)
public_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public")
if os.path.isdir(public_dir):
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="static")
else:
    # Fallback: serve index.html inline if public/ directory not found
    import pathlib
    _pf = pathlib.Path(__file__).parent / ".." / "public"
    logger.warning("public/ directory not found at %s, trying %s", public_dir, _pf.resolve())
    if _pf.is_dir():
        app.mount("/", StaticFiles(directory=str(_pf.resolve()), html=True), name="static")
    else:
        # Last resort: serve inline HTML
        @app.get("/")
        async def root():
            from fastapi.responses import HTMLResponse
            return HTMLResponse(content=r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Voice Avatar Assistant</title>
<style>
:root{--bg:#0f0f13;--surface:#1a1a24;--border:#2a2a3a;--text:#e4e4e7;--text-muted:#71717a;--accent:#7c3aed;--danger:#ef4444;--success:#22c55e;--radius:12px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;display:flex;justify-content:center;align-items:center;padding:16px}
.container{width:100%;max-width:600px;display:flex;flex-direction:column;gap:16px}
h1{font-size:1.5rem;text-align:center}
.subtitle{color:var(--text-muted);font-size:.875rem;text-align:center}
.avatar-container{position:relative;width:100%;aspect-ratio:4/3;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center}
.avatar-container video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none}
.avatar-container video.show{display:block}
.avatar-container svg{position:absolute;top:0;left:0}
.avatar-container svg.hidden{display:none}
.avatar-status{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:rgba(26,26,36,.85);padding:4px 14px;border-radius:20px;font-size:.8rem;color:var(--text-muted);z-index:2}
.status-bar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:var(--surface);border-radius:var(--radius);border:1px solid var(--border)}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--text-muted);transition:background .2s}
.status-dot.listening{background:var(--accent);animation:pulse 1s infinite}
.status-dot.thinking{background:#f59e0b;animation:pulse .6s infinite}
.status-dot.speaking{background:var(--success)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.status-text{font-size:.875rem;color:var(--text-muted)}
.status-text.active{color:var(--text)}
.conversation{display:flex;flex-direction:column;gap:8px;max-height:200px;overflow-y:auto}
.message{padding:10px 14px;border-radius:var(--radius);font-size:.875rem;animation:fadeIn .3s}
.message.user{background:var(--accent);color:#fff;align-self:flex-end;max-width:80%}
.message.assistant{background:var(--surface);color:var(--text);align-self:flex-start;max-width:80%;border:1px solid var(--border)}
.message.blocked{border-color:var(--danger);color:var(--danger)}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.controls{margin-top:8px}
input[type=text]{width:100%;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:.9375rem;outline:none}
input[type=text]:focus{border-color:var(--accent)}
input[type=text]::placeholder{color:var(--text-muted)}
.btn-row{display:flex;gap:8px;margin-top:8px}
.btn{padding:10px 20px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius);font-size:.9375rem;cursor:pointer}
.btn:hover{opacity:.9}
.btn-sec{background:var(--surface);border:1px solid var(--border);color:var(--text)}
footer{text-align:center;color:var(--text-muted);font-size:.75rem;margin-top:8px}
.toast{position:fixed;bottom:20px;right:20px;padding:12px 20px;border-radius:var(--radius);background:var(--surface);border:1px solid var(--danger);color:var(--danger);font-size:.875rem;z-index:1000;animation:fadeIn .3s}
video{background:var(--surface)}
</style>
</head>
<body>
<div class="container">
<h1>🎙️ Voice Avatar Assistant</h1>
<p class="subtitle">Ask me anything — I'll speak the answer</p>

<div class="avatar-container" id="avatarContainer">
<video id="simliVideo" autoplay playsinline></video>
<svg id="faceSVG" viewBox="0 0 200 200" width="100%" height="100%">
<circle cx="100" cy="100" r="80" fill="#2d2d3d" stroke="#7c3aed" stroke-width="2"/>
<circle cx="75" cy="85" r="8" fill="#e4e4e7"/><circle cx="77" cy="85" r="4" fill="#0f0f13"/>
<circle cx="125" cy="85" r="8" fill="#e4e4e7"/><circle cx="127" cy="85" r="4" fill="#0f0f13"/>
<path id="mouth" d="M 75 130 Q 100 140 125 130" stroke="#e4e4e7" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
<div class="avatar-status" id="avatarStatus">Connecting...</div>
</div>

<div class="status-bar">
<span class="status-dot" id="statusDot"></span>
<span class="status-text" id="statusText">Initializing...</span>
</div>

<div class="conversation" id="conversation"></div>

<div class="controls">
<input type="text" id="msg" placeholder="Type your question here..." maxlength="500" autofocus>
<div class="btn-row">
<button class="btn" onclick="send()">Send</button>
<button class="btn btn-sec" id="micBtn" onmousedown="startMic(event)" onmouseup="stopMic()" onmouseleave="stopMic()" ontouchstart="startMic(event)" ontouchend="stopMic()">🎤 Hold to talk</button>
</div>
</div>

<footer>Gemini + Simli + Open-Meteo</footer>
</div>

<script>
// ============================================================
// Simli WebRTC Avatar — connects on page load
// ============================================================
var simliPC = null;
var simliWS = null;
var simliReady = false;

async function initSimli() {
    try {
        var resp = await fetch('/api/simli-config');
        if (!resp.ok) { throw new Error('No Simli config'); }
        var cfg = await resp.json();
        if (!cfg.apiKey || !cfg.faceId) { throw new Error('Missing keys'); }

        document.getElementById('avatarStatus').textContent = 'Starting avatar...';

        // Step 1: Get ICE servers
        var iceResp = await fetch('https://api.simli.ai/compose/ice', {
            headers: { 'x-simli-api-key': cfg.apiKey }
        });
        if (!iceResp.ok) throw new Error('ICE servers failed');
        var iceServers = await iceResp.json();

        // Step 2: Get session token
        var tokenResp = await fetch('https://api.simli.ai/compose/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-simli-api-key': cfg.apiKey
            },
            body: JSON.stringify({
                faceId: cfg.faceId,
                handleSilence: true,
                maxSessionLength: 3600,
                maxIdleTime: 300
            })
        });
        if (!tokenResp.ok) throw new Error('Token failed: ' + tokenResp.status);
        var tokenData = await tokenResp.json();

        // Step 3: Create RTCPeerConnection
        simliPC = new RTCPeerConnection({ iceServers: iceServers });

        simliPC.addEventListener('track', function(evt) {
            if (evt.track.kind === 'video') {
                var vid = document.getElementById('simliVideo');
                vid.srcObject = evt.streams[0];
                vid.classList.add('show');
                document.getElementById('faceSVG').classList.add('hidden');
                document.getElementById('avatarStatus').textContent = 'Ready';
                simliReady = true;
                console.log('Simli video connected');
            }
        });

        simliPC.oniceconnectionstatechange = function() {
            console.log('ICE state:', simliPC.iceConnectionState);
            if (simliPC.iceConnectionState === 'failed' || simliPC.iceConnectionState === 'disconnected') {
                document.getElementById('faceSVG').classList.remove('hidden');
                document.getElementById('simliVideo').classList.remove('show');
                document.getElementById('avatarStatus').textContent = 'Reconnecting...';
            }
        };

        // Step 4: Open WebSocket for signaling
        var wsUrl = 'wss://api.simli.ai/compose/webrtc/p2p?session_token=' +
            tokenData.session_token + '&enableSFU=true';
        simliWS = new WebSocket(wsUrl);

        var offerSent = false;
        simliPC.onicecandidate = function(event) {
            if (event.candidate === null && simliPC.localDescription && !offerSent) {
                offerSent = true;
                if (simliWS.readyState === WebSocket.OPEN) {
                    simliWS.send(JSON.stringify({
                        sdp: simliPC.localDescription.sdp,
                        type: simliPC.localDescription.type
                    }));
                }
            }
        };

        simliWS.addEventListener('open', function() {
            console.log('Simli WS open, starting negotiation');
            simliPC.addTransceiver('audio', { direction: 'recvonly' });
            simliPC.addTransceiver('video', { direction: 'recvonly' });
            simliPC.createOffer()
                .then(function(offer) { return simliPC.setLocalDescription(offer); })
                .catch(function(e) { console.error('Offer error:', e); });
        });

        simliWS.addEventListener('message', async function(evt) {
            if (evt.data === 'START') {
                setTimeout(function() {
                    if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                        simliWS.send(new Uint8Array(64000));
                    }
                }, 100);
                return;
            }
            if (evt.data === 'STOP') { return; }
            try {
                var msg = JSON.parse(evt.data);
                if (msg.type === 'answer' && msg.sdp && simliPC) {
                    await simliPC.setRemoteDescription(msg);
                    console.log('Simli remote set');
                }
            } catch(e) {}
        });

        simliWS.addEventListener('close', function() {
            console.log('Simli WS closed');
            simliReady = false;
        });

    } catch(e) {
        console.log('Simli init failed:', e.message);
        document.getElementById('avatarStatus').textContent = 'SVG mode';
        document.getElementById('statusText').textContent = 'Waiting for your question...';
    }
}

// ============================================================
// Browser TTS + animated mouth
// ============================================================
var isSpeaking = false;
var mouthAnim = false;
var mouthFrame = null;
var recognition = null;
var speechReady = false;

function setStatus(s, msg) {
    var d = document.getElementById('statusDot');
    var t = document.getElementById('statusText');
    d.className = 'status-dot';
    t.className = 'status-text';
    if (s === 'thinking') { d.classList.add('thinking'); t.classList.add('active'); }
    else if (s === 'speaking') { d.classList.add('speaking'); t.classList.add('active'); }
    if (msg) t.textContent = msg;
}

function addMsg(text, role) {
    var el = document.createElement('div');
    el.className = 'message ' + role;
    el.textContent = text;
    var c = document.getElementById('conversation');
    c.appendChild(el);
    c.scrollTop = c.scrollHeight;
}

function animateMouth(speaking) {
    var m = document.getElementById('mouth');
    if (!m) return;
    if (speaking && !mouthAnim) {
        mouthAnim = true;
        var intensity = 0, dir = 1;
        (function pulse() {
            if (!mouthAnim) return;
            intensity += dir * 0.1;
            if (intensity > 1) { intensity = 1; dir = -1; }
            if (intensity < 0) { intensity = 0; dir = 1; }
            var open = 8 + intensity * 13;
            m.setAttribute('d', 'M 75 130 Q 100 ' + (130 + open) + ' 125 130');
            mouthFrame = requestAnimationFrame(pulse);
        })();
    } else if (!speaking && mouthAnim) {
        mouthAnim = false;
        if (mouthFrame) cancelAnimationFrame(mouthFrame);
        m.setAttribute('d', 'M 75 130 Q 100 140 125 130');
    }
}

// Load voices
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function() { window.speechSynthesis.getVoices(); };
}

function speak(text) {
    if (!text || isSpeaking) return;
    window.speechSynthesis.cancel();
    isSpeaking = true;
    setStatus('speaking', 'Speaking...');
    animateMouth(true);
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.0;
    u.pitch = 1.1;
    // Pick female voice
    var voices = window.speechSynthesis.getVoices();
    var female = voices.find(function(v){ return v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman') || v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Karen'); });
    if (!female) female = voices.find(function(v){ return v.lang.startsWith('en') && v.name.toLowerCase().includes('google'); });
    if (!female) female = voices.find(function(v){ return v.lang.startsWith('en'); });
    if (female) u.voice = female;
    u.onend = function() { isSpeaking = false; animateMouth(false); setStatus('idle', 'Waiting...'); };
    u.onerror = function() { isSpeaking = false; animateMouth(false); setStatus('idle', 'Waiting...'); };
    window.speechSynthesis.speak(u);
}

async function send() {
    var m = document.getElementById('msg').value.trim();
    if (!m || isSpeaking) return;
    setStatus('thinking', 'Thinking...');
    addMsg(m, 'user');
    document.getElementById('msg').value = '';
    try {
        var r = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:m})});
        var d = await r.json();
        var cls = d.blocked ? 'assistant blocked' : 'assistant';
        addMsg(d.reply, cls);
        if (d.blocked) {
            // Use browser TTS for refusal messages
            speakBrowser(d.reply);
            var tst = document.createElement('div'); tst.className = 'toast'; tst.textContent = 'Blocked by safety filter'; document.body.appendChild(tst);
            setTimeout(function(){ tst.remove(); }, 4000);
        } else {
            // Try Simli TTS pipeline first, fall back to browser
            if (simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
                speakSimli(d.reply);
            } else {
                speakBrowser(d.reply);
            }
        }
    } catch(e) {
        addMsg("Sorry, couldn't get an answer.", 'assistant');
        setStatus('idle', 'Waiting...');
    }
}

// Browser TTS (fallback) — female voice
function speakBrowser(text) {
    if (!text || isSpeaking) return;
    window.speechSynthesis.cancel();
    isSpeaking = true;
    setStatus('speaking', 'Speaking...');
    animateMouth(true);
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 1.0;
    u.pitch = 1.1;
    var voices = window.speechSynthesis.getVoices();
    var female = voices.find(function(v){ var n = v.name.toLowerCase(); return n.includes('female') || n.includes('zira') || n.includes('samantha') || n.includes('karen'); });
    if (!female) female = voices.find(function(v){ return v.lang.startsWith('en'); });
    if (female) u.voice = female;
    u.onend = function() { isSpeaking = false; animateMouth(false); setStatus('idle', 'Waiting...'); };
    u.onerror = function() { isSpeaking = false; animateMouth(false); setStatus('idle', 'Waiting...'); };
    window.speechSynthesis.speak(u);
}

// Simli TTS pipeline — fetches PCM from Gemini TTS, pipes through WebRTC for lip-sync
async function speakSimli(text) {
    if (!text || isSpeaking) return;
    isSpeaking = true;
    setStatus('speaking', 'Speaking...');
    animateMouth(true);
    try {
        // Fetch PCM audio from our TTS endpoint
        var resp = await fetch('/api/tts?text=' + encodeURIComponent(text) + '&voice=Puck');
        if (!resp.ok) throw new Error('TTS failed: ' + resp.status);
        var pcmBuffer = await resp.arrayBuffer();
        if (!pcmBuffer || pcmBuffer.byteLength === 0) throw new Error('Empty audio');

        // Send PCM through Simli WebRTC in chunks
        var chunkSize = 6000;
        var uint8 = new Uint8Array(pcmBuffer);
        for (var i = 0; i < uint8.length; i += chunkSize) {
            if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                simliWS.send(uint8.slice(i, i + chunkSize));
            }
            // Small delay between chunks for smooth playback
            await new Promise(function(r) { setTimeout(r, 20); });
        }

        // Let the last audio finish playing
        setTimeout(function() {
            isSpeaking = false;
            animateMouth(false);
            setStatus('idle', 'Waiting...');
        }, 500);
    } catch(e) {
        console.log('Simli speak failed, falling back to browser:', e);
        window.speechSynthesis.cancel();
        isSpeaking = false;
        animateMouth(false);
        // Fall back to browser TTS
        speakBrowser(text);
    }
}

document.getElementById('msg').addEventListener('keydown', function(e) { if (e.key === 'Enter') send(); });

var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
    speechReady = true;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = function(e) {
        var final = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript;
        }
        if (final) { document.getElementById('msg').value = final; send(); stopMic(); }
    };
    recognition.onerror = function(e) {
        if (e.error === 'not-allowed') alert('Mic denied. Enable in browser settings.');
        stopMic();
    };
}

function startMic(e) { e.preventDefault(); if (speechReady) { try { recognition.start(); } catch(ex){} } document.getElementById('micBtn').textContent = '🔴 Listening...'; document.getElementById('micBtn').style.background = 'var(--accent)'; }
function stopMic() { if (speechReady) { try { recognition.stop(); } catch(ex){} } document.getElementById('micBtn').textContent = '🎤 Hold to talk'; document.getElementById('micBtn').style.background = ''; }

// ============================================================
// Init: load Simli, then fall back to SVG + health check
// ============================================================
initSimli();
setTimeout(function() {
    if (!simliReady) {
        document.getElementById('statusText').textContent = 'Waiting for your question...';
        document.getElementById('avatarStatus').textContent = 'SVG mode';
    }
}, 8000);

fetch('/api/health').then(function(r){ return r.json(); }).then(function(d){
    console.log('Health:', d.status);
});
</script>
</body>
</html>""")

