/**
 * Voice Avatar Assistant — Frontend
 * Mic capture (Web Speech API), text fallback, API calls,
 * conversation history, animated avatar, and Simli WebRTC integration.
 */

const API_BASE = '/api';

const state = {
    isRecording: false,
    recognition: null,
    speechSupported: false,
    status: 'idle',
    simliReady: false,
    isSpeaking: false,
};

const $ = (sel) => document.querySelector(sel);

const elements = {
    textInput: $('#textInput'),
    sendBtn: $('#sendBtn'),
    micBtn: $('#micBtn'),
    transcript: $('#transcript'),
    conversation: $('#conversation'),
    statusDot: $('#statusDot'),
    statusText: $('#statusText'),
    avatarPlaceholder: $('#avatarPlaceholder'),
    avatarStatus: $('#avatarStatus'),
    avatarFace: $('#avatarFace'),
    avatarVideo: $('#avatarVideo'),
    avatarMouth: $('#avatarMouth'),
    avatarContainer: $('#avatarContainer'),
    toastContainer: $('#toastContainer'),
};

// =========================================================================
// Toast helper
// =========================================================================

function showToast(message, type) {
    type = type || 'info';
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    elements.toastContainer.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 4000);
}

// =========================================================================
// Status management
// =========================================================================

function setStatus(status, message) {
    state.status = status;
    var dot = elements.statusDot;
    var text = elements.statusText;

    dot.className = 'status-dot';
    text.className = 'status-text';

    if (status === 'listening') {
        dot.classList.add('listening');
        text.classList.add('active');
    } else if (status === 'thinking') {
        dot.classList.add('thinking');
        text.classList.add('active');
    } else if (status === 'speaking') {
        dot.classList.add('speaking');
        text.classList.add('active');
    } else if (status === 'error') {
        dot.classList.add('error');
    }

    if (message) text.textContent = message;
}

// =========================================================================
// Conversation history
// =========================================================================

function addMessage(text, role) {
    var el = document.createElement('div');
    el.className = 'message ' + role;
    el.textContent = text;
    elements.conversation.appendChild(el);
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

// =========================================================================
// Animated Avatar Face (always works, no API needed)
// =========================================================================

// Pre-draw the avatar face as an SVG with animatable mouth
var avatarSVG = null;
var mouthPath = null;
var mouthAnimating = false;
var mouthAnimFrame = null;

function initAvatarFace() {
    var container = elements.avatarContainer;
    var ns = 'http://www.w3.org/2000/svg';

    avatarSVG = document.createElementNS(ns, 'svg');
    avatarSVG.setAttribute('viewBox', '0 0 200 200');
    avatarSVG.setAttribute('width', '100%');
    avatarSVG.setAttribute('height', '100%');
    avatarSVG.style.position = 'absolute';
    avatarSVG.style.top = '0';
    avatarSVG.style.left = '0';

    // Face circle
    var face = document.createElementNS(ns, 'circle');
    face.setAttribute('cx', '100');
    face.setAttribute('cy', '100');
    face.setAttribute('r', '80');
    face.setAttribute('fill', '#2d2d3d');
    face.setAttribute('stroke', '#7c3aed');
    face.setAttribute('stroke-width', '2');
    avatarSVG.appendChild(face);

    // Left eye
    var leftEye = document.createElementNS(ns, 'circle');
    leftEye.setAttribute('cx', '75');
    leftEye.setAttribute('cy', '85');
    leftEye.setAttribute('r', '8');
    leftEye.setAttribute('fill', '#e4e4e7');
    avatarSVG.appendChild(leftEye);

    // Left pupil
    var leftPupil = document.createElementNS(ns, 'circle');
    leftPupil.setAttribute('cx', '77');
    leftPupil.setAttribute('cy', '85');
    leftPupil.setAttribute('r', '4');
    leftPupil.setAttribute('fill', '#0f0f13');
    avatarSVG.appendChild(leftPupil);

    // Right eye
    var rightEye = document.createElementNS(ns, 'circle');
    rightEye.setAttribute('cx', '125');
    rightEye.setAttribute('cy', '85');
    rightEye.setAttribute('r', '8');
    rightEye.setAttribute('fill', '#e4e4e7');
    avatarSVG.appendChild(rightEye);

    // Right pupil
    var rightPupil = document.createElementNS(ns, 'circle');
    rightPupil.setAttribute('cx', '127');
    rightPupil.setAttribute('cy', '85');
    rightPupil.setAttribute('r', '4');
    rightPupil.setAttribute('fill', '#0f0f13');
    avatarSVG.appendChild(rightPupil);

    // Mouth
    mouthPath = document.createElementNS(ns, 'path');
    mouthPath.setAttribute('d', 'M 75 130 Q 100 145 125 130');
    mouthPath.setAttribute('stroke', '#e4e4e7');
    mouthPath.setAttribute('stroke-width', '3');
    mouthPath.setAttribute('fill', 'none');
    mouthPath.setAttribute('stroke-linecap', 'round');
    avatarSVG.appendChild(mouthPath);

    container.appendChild(avatarSVG);
}

function animateMouth(speaking) {
    if (speaking && !mouthAnimating) {
        mouthAnimating = true;
        var intensity = 0;
        var dir = 1;
        function pulse() {
            if (!mouthAnimating) return;
            intensity += dir * 0.08;
            if (intensity > 1) { intensity = 1; dir = -1; }
            if (intensity < 0) { intensity = 0; dir = 1; }
            var open = 8 + intensity * 15;
            mouthPath.setAttribute('d', 'M 75 130 Q 100 ' + (130 + open) + ' 125 130');
            mouthAnimFrame = requestAnimationFrame(pulse);
        }
        pulse();
    } else if (!speaking && mouthAnimating) {
        mouthAnimating = false;
        if (mouthAnimFrame) cancelAnimationFrame(mouthAnimFrame);
        mouthPath.setAttribute('d', 'M 75 130 Q 100 140 125 130');
    }
}

// =========================================================================
// Browser Speech Synthesis (TTS) — works immediately, zero setup
// =========================================================================

function speakText(text) {
    if (!text || state.isSpeaking) return;

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');
    animateMouth(true);

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

    // Pick a female voice
    var voices = window.speechSynthesis.getVoices();
    var preferred = voices.find(function (v) {
        var n = v.name.toLowerCase();
        return n.includes('female') || n.includes('woman') || n.includes('zira') || n.includes('samantha') || n.includes('karen');
    });
    if (!preferred) preferred = voices.find(function (v) {
        return v.lang.startsWith('en') && v.name.toLowerCase().includes('google');
    });
    if (!preferred) preferred = voices.find(function (v) {
        return v.lang.startsWith('en');
    });
    if (preferred) utterance.voice = preferred;

    utterance.onend = function () {
        state.isSpeaking = false;
        animateMouth(false);
        setStatus('idle', 'Waiting for your question...');
    };

    utterance.onerror = function () {
        state.isSpeaking = false;
        animateMouth(false);
        setStatus('idle', 'Waiting for your question...');
    };

    window.speechSynthesis.speak(utterance);
}

// Preload voices (some browsers need this)
if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function () {
        window.speechSynthesis.getVoices();
    };
}

// =========================================================================
// Simli WebRTC Avatar (premium, requires API key)
// =========================================================================

var simliPC = null;
var simliWS = null;
var simliToken = null;

async function initSimli() {
    try {
        var resp = await fetch(API_BASE + '/simli-config');
        if (!resp.ok) return;
        var config = await resp.json();
        if (!config.apiKey || !config.faceId) return;

        state.simliReady = true;
        elements.avatarStatus.textContent = 'Avatar ready';
        console.log('Simli configured');

        // Pre-warm the WebRTC session
        await prewarmSimli(config);
    } catch (e) {
        console.log('Simli init skipped:', e.message);
    }
}

async function prewarmSimli(config) {
    try {
        // 1. Get ICE servers
        var iceResp = await fetch('https://api.simli.ai/compose/ice', {
            headers: { 'x-simli-api-key': config.apiKey }
        });
        var iceServers = await iceResp.json();

        // 2. Get session token
        var tokenResp = await fetch('https://api.simli.ai/compose/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-simli-api-key': config.apiKey
            },
            body: JSON.stringify({
                faceId: config.faceId,
                handleSilence: true,
                maxSessionLength: 3600,
                maxIdleTime: 300
            })
        });
        var tokenData = await tokenResp.json();
        simliToken = tokenData.session_token;
        console.log('Simli token acquired');

        // 3. Create WebRTC peer connection
        simliPC = new RTCPeerConnection({ iceServers: iceServers });

        simliPC.addEventListener('track', function (evt) {
            if (evt.track.kind === 'video') {
                elements.avatarVideo.srcObject = evt.streams[0];
                elements.avatarPlaceholder.classList.add('hidden');
                elements.avatarVideo.style.display = 'block';
                console.log('Simli video stream connected');
            }
        });

        simliPC.onicecandidate = function (event) {
            if (event.candidate === null && simliPC.localDescription) {
                // All candidates gathered — send to Simli
                if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                    simliWS.send(JSON.stringify({
                        sdp: simliPC.localDescription.sdp,
                        type: simliPC.localDescription.type
                    }));
                }
            }
        };

        // 4. Open WebSocket for signaling
        var wsUrl = 'wss://api.simli.ai/compose/webrtc/p2p?session_token=' +
            simliToken + '&enableSFU=true';
        simliWS = new WebSocket(wsUrl);

        simliWS.addEventListener('message', async function (evt) {
            if (evt.data === 'START') {
                // Send silence to keep the connection alive
                setTimeout(function () {
                    if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                        simliWS.send(new Uint8Array(64000));
                    }
                }, 100);
                return;
            }
            if (evt.data === 'STOP') {
                stopSimli();
                return;
            }
            try {
                var msg = JSON.parse(evt.data);
                if (msg.type === 'answer' && msg.sdp) {
                    await simliPC.setRemoteDescription(msg);
                    console.log('Simli remote description set');
                }
            } catch (e) { /* ignore non-JSON messages */ }
        });

        simliWS.addEventListener('open', function () {
            // Start negotiation
            simliPC.addTransceiver('audio', { direction: 'recvonly' });
            simliPC.addTransceiver('video', { direction: 'recvonly' });
            simliPC.createOffer()
                .then(function (offer) { return simliPC.setLocalDescription(offer); })
                .then(function () {
                    // ICE candidate gathering will trigger the send via onicecandidate
                });
        });

        simliWS.addEventListener('close', function () {
            console.log('Simli WebSocket closed');
        });

        elements.avatarStatus.textContent = 'Avatar ready';
        console.log('Simli pre-warmed');

    } catch (e) {
        console.error('Simli pre-warm error:', e);
        state.simliReady = false;
    }
}

function stopSimli() {
    if (simliPC) {
        simliPC.close();
        simliPC = null;
    }
    if (simliWS) {
        simliWS.close();
        simliWS = null;
    }
    elements.avatarVideo.style.display = 'none';
    elements.avatarPlaceholder.classList.remove('hidden');
}

// Simli needs PCM audio. In a full integration, you'd use a TTS service
// (ElevenLabs, Gemini TTS) to get PCM Int16 16kHz mono audio, then send it.
async function speakWithSimli(text) {
    if (!state.simliReady || !simliWS || simliWS.readyState !== WebSocket.OPEN) return;

    try {
        // Placeholder: in production, fetch PCM audio from a TTS API
        // const audioResponse = await fetch(TTS_API_URL, { method:'POST', body: JSON.stringify({text}) });
        // const pcmBuffer = await audioResponse.arrayBuffer();
        // simliWS.send(new Uint8Array(pcmBuffer));
        console.log('Simli would speak:', text.substring(0, 50));
    } catch (e) {
        console.error('Simli speak error:', e);
    }
}

// =========================================================================
// API call
// =========================================================================

async function sendMessage(message) {
    if (!message.trim() || state.isSpeaking) return;

    setStatus('thinking', 'Thinking...');
    addMessage(message, 'user');
    elements.textInput.value = '';

    try {
        var t0 = performance.now();
        var response = await fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message }),
        });
        var t1 = performance.now();

        if (!response.ok) {
            throw new Error('Server error: ' + response.status);
        }

        var data = await response.json();
        var msgClass = data.blocked ? 'assistant blocked' : 'assistant';
        addMessage(data.reply, msgClass);

        if (data.blocked) {
            setStatus('idle', 'Waiting for your question...');
            speakText(data.reply);
            showToast('Message blocked by safety filter', 'error');
        } else {
            // Try Simli TTS pipeline first (lip-sync via WebRTC), fall back to browser
            if (state.simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
                speakViaSimli(data.reply);
            } else {
                speakText(data.reply);
            }
        }

        console.log('Latency: ' + (t1 - t0).toFixed(0) + 'ms');
    } catch (err) {
        console.error('API error:', err);
        setStatus('error', 'Something went wrong');
        addMessage("Sorry, I couldn't get an answer. Please try again.", 'assistant');
        showToast('Failed to reach the server', 'error');

        setTimeout(function () {
            setStatus('idle', 'Waiting for your question...');
        }, 3000);
    }
}

// =========================================================================
// Speech recognition (Web Speech API)
// =========================================================================

function initSpeechRecognition() {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        elements.micBtn.disabled = true;
        elements.micBtn.title = 'Speech recognition not supported';
        elements.micBtn.querySelector('.btn-label').textContent = 'Not supported';
        showToast('Speech not supported. Use text input instead.', 'warning');
        return;
    }

    state.speechSupported = true;
    var recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = function (event) {
        var interim = '';
        var finalText = '';

        for (var i = event.resultIndex; i < event.results.length; i++) {
            var t = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalText += t;
            } else {
                interim += t;
            }
        }

        if (interim) {
            elements.transcript.textContent = interim;
            elements.transcript.classList.add('active');
        }

        if (finalText) {
            elements.transcript.textContent = finalText;
            elements.transcript.classList.add('active');
            sendMessage(finalText);
            setTimeout(function () {
                elements.transcript.textContent = '';
                elements.transcript.classList.remove('active');
            }, 1000);
        }
    };

    recognition.onerror = function (event) {
        if (event.error === 'not-allowed') {
            showToast('Microphone denied. Enable it in browser settings.', 'error');
        } else if (event.error !== 'no-speech') {
            showToast('Speech error: ' + event.error, 'error');
        }
        stopRecording();
    };

    recognition.onend = function () {
        if (!state.isRecording) stopRecording();
    };

    state.recognition = recognition;
}

function startRecording() {
    if (!state.speechSupported) return;

    state.isRecording = true;
    elements.micBtn.classList.add('recording');
    elements.micBtn.querySelector('.btn-label').textContent = 'Listening...';
    setStatus('listening', "I'm listening...");

    try {
        state.recognition.start();
    } catch (e) { /* already started */ }
}

function stopRecording() {
    state.isRecording = false;
    elements.micBtn.classList.remove('recording');
    elements.micBtn.querySelector('.btn-label').textContent = 'Hold to talk';

    try {
        state.recognition.stop();
    } catch (e) { /* not started */ }

    if (state.status === 'listening') {
        setStatus('idle', 'Waiting for your question...');
    }
}

// =========================================================================
// Event handlers
// =========================================================================

elements.micBtn.addEventListener('mousedown', function (e) {
    e.preventDefault();
    startRecording();
});
elements.micBtn.addEventListener('mouseup', function (e) {
    e.preventDefault();
    stopRecording();
});
elements.micBtn.addEventListener('mouseleave', function () {
    if (state.isRecording) stopRecording();
});
elements.micBtn.addEventListener('touchstart', function (e) {
    e.preventDefault();
    startRecording();
});
elements.micBtn.addEventListener('touchend', function (e) {
    e.preventDefault();
    stopRecording();
});

elements.sendBtn.addEventListener('click', function () {
    var msg = elements.textInput.value.trim();
    if (msg) sendMessage(msg);
});
elements.textInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var msg = elements.textInput.value.trim();
        if (msg) sendMessage(msg);
    }
});

// =========================================================================
// Init
// =========================================================================

function init() {
    initAvatarFace();
    initSpeechRecognition();
    initSimli();
    console.log('Voice Avatar Assistant ready');
    console.log('Speech recognition:', state.speechSupported ? 'supported' : 'not supported');
}

init();
