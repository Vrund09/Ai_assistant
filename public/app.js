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
    avatarHealth: $('#avatarHealth'),
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
// Audio / Video Unlock Helper (iOS Safari & Mobile Compatibility)
// =========================================================================

var sharedAudioCtx = null;
var needsPlayOnGesture = false;

function getAudioContext() {
    if (!sharedAudioCtx) {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
}

function showPlayOverlay() {
    if ($('#playOverlay')) return; // already shown
    var overlay = document.createElement('div');
    overlay.id = 'playOverlay';
    overlay.className = 'play-overlay';
    overlay.innerHTML = '<div class="play-overlay-content">Tap to start avatar</div>';
    overlay.addEventListener('click', function () {
        elements.avatarVideo.play().catch(function(err){
            console.log('Explicit play failed on overlay click:', err.message);
        });
        overlay.remove();
        needsPlayOnGesture = false;
    });
    elements.avatarContainer.appendChild(overlay);
}

function unlockAudio() {
    var ctx = getAudioContext();
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    // Also trigger video play if it was blocked
    if (needsPlayOnGesture && elements.avatarVideo.srcObject) {
        elements.avatarVideo.play().then(function() {
            needsPlayOnGesture = false;
            var overlay = $('#playOverlay');
            if (overlay) overlay.remove();
        }).catch(function(e){
            console.log('Unlock audio gesture play failed:', e.message);
        });
    }
}
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('click', unlockAudio, { once: true });

// =========================================================================
// Browser Speech Synthesis (TTS) — works immediately, zero setup
// =========================================================================

function speakText(text) {
    if (!text || state.isSpeaking) return;

    if (window.speechSynthesis && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
    }

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
var simliAvailable = false;      // Flag: Simli is configured (can always reconnect)
var simliConnecting = false;     // guard against overlapping connect attempts
var simliReconnectTimer = null;  // pending reconnect
var simliKeepaliveTimer = null;  // periodic silence to prevent idle timeout
var simliReconnectAttempts = 0;  // for backoff / giving up
var simliSendingPCM = false;     // guard against race conditions

function setAvatarHealth(status) {
    if (elements.avatarHealth) {
        elements.avatarHealth.className = 'avatar-health ' + status;
    }
}

async function initSimli() {
    try {
        elements.avatarStatus.textContent = 'Loading avatar...';
        setAvatarHealth('connecting');

        var resp = await fetch(API_BASE + '/simli-session', { method: 'POST' });
        if (!resp.ok) {
            elements.avatarStatus.textContent = 'Voice mode';
            setAvatarHealth('disconnected');
            return;
        }
        var session = await resp.json();
        if (!session.available) {
            console.log('Simli not available:', session.error);
            elements.avatarStatus.textContent = 'Voice mode';
            setAvatarHealth('disconnected');
            return;
        }

        simliAvailable = true;
        elements.avatarStatus.textContent = 'Connecting...';
        await connectSimliWebRTC(session);
    } catch (e) {
        console.log('Simli init failed:', e.message);
        elements.avatarStatus.textContent = 'Voice mode';
        setAvatarHealth('disconnected');
        scheduleSimliReconnect('init-error');
    }
}

// Send a tiny silence buffer every 15s so Simli's idle timer (maxIdleTime)
// never expires and drops the session between questions.
function startSimliKeepalive() {
    stopSimliKeepalive();
    simliKeepaliveTimer = setInterval(function () {
        if (state.isSpeaking) return; // don't interfere while real audio streams
        if (simliWS && simliWS.readyState === WebSocket.OPEN) {
            try { simliWS.send(new Uint8Array(2000)); } catch (e) { /* ignore */ }
        }
    }, 15000);
}

function stopSimliKeepalive() {
    if (simliKeepaliveTimer) {
        clearInterval(simliKeepaliveTimer);
        simliKeepaliveTimer = null;
    }
}

async function connectSimliWebRTC(session) {
    if (simliConnecting) return;
    simliConnecting = true;
    setAvatarHealth('connecting');
    try {
        // 1. Create RTCPeerConnection with server-provided ICE servers
        simliPC = new RTCPeerConnection({ iceServers: session.iceServers });

        // 2. Track event → show video
        simliPC.addEventListener('track', function (evt) {
            if (evt.track.kind === 'video') {
                var vid = elements.avatarVideo;
                vid.srcObject = evt.streams[0];
                vid.play().then(function() {
                    console.log('Simli video autoplay succeeded');
                }).catch(function(e) {
                    console.log('Video autoplay blocked, will retry on gesture:', e.message);
                    needsPlayOnGesture = true;
                    showPlayOverlay();
                });
                elements.avatarPlaceholder.classList.add('hidden');
                vid.style.display = 'block';
                state.simliReady = true;
                simliReconnectAttempts = 0;  // healthy → reset backoff
                elements.avatarStatus.textContent = '';
                setAvatarHealth('connected');
                console.log('Simli video connected');
            }
        });

        // 3. ICE state monitoring
        simliPC.oniceconnectionstatechange = function () {
            var st = simliPC ? simliPC.iceConnectionState : '';
            console.log('Simli ICE state:', st);
            if (st === 'failed' || st === 'disconnected' || st === 'closed') {
                scheduleSimliReconnect('ice-' + st);
            }
        };

        var offerSent = false;
        simliPC.onicecandidate = function (event) {
            if (event.candidate === null && simliPC.localDescription && !offerSent) {
                offerSent = true;
                if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                    simliWS.send(JSON.stringify({
                        sdp: simliPC.localDescription.sdp,
                        type: simliPC.localDescription.type
                    }));
                }
            }
        };

        // 4. WebSocket signaling (using server-provided wsUrl)
        simliWS = new WebSocket(session.wsUrl);

        simliWS.addEventListener('message', async function (evt) {
            if (evt.data === 'START') {
                setTimeout(function () {
                    if (simliWS && simliWS.readyState === WebSocket.OPEN) {
                        simliWS.send(new Uint8Array(64000));
                    }
                }, 100);
                startSimliKeepalive();
                return;
            }
            if (evt.data === 'STOP') {
                console.log('Simli sent STOP — session expired');
                teardownSimli();
                freshSimliSession();  // Fresh token, not reusing old config
                return;
            }
            try {
                var msg = JSON.parse(evt.data);
                if (msg.type === 'answer' && msg.sdp && simliPC) {
                    await simliPC.setRemoteDescription(msg);
                    console.log('Simli remote description set');
                }
            } catch (e) { /* ignore non-JSON messages */ }
        });

        simliWS.addEventListener('open', function () {
            console.log('Simli WS open, starting negotiation');
            simliPC.addTransceiver('audio', { direction: 'recvonly' });
            simliPC.addTransceiver('video', { direction: 'recvonly' });
            simliPC.createOffer()
                .then(function (offer) { return simliPC.setLocalDescription(offer); })
                .catch(function (e) { console.error('Offer error:', e); });
        });

        simliWS.addEventListener('close', function () {
            console.log('Simli WebSocket closed');
            stopSimliKeepalive();
            scheduleSimliReconnect('ws-close');
        });

    } catch (e) {
        console.error('Simli WebRTC connection error:', e);
        scheduleSimliReconnect('connect-error');
    } finally {
        simliConnecting = false;
    }
}

function scheduleSimliReconnect(reason) {
    if (!simliAvailable) return;
    if (simliConnecting || simliReconnectTimer) return;

    simliReconnectAttempts++;

    // Exponential backoff: 2s, 4s, 8s, 16s, 30s, 30s, 30s...
    var delay = Math.min(2000 * Math.pow(2, simliReconnectAttempts - 1), 30000);
    console.log('Simli reconnect #' + simliReconnectAttempts + ' (' + reason + ') in ' + delay + 'ms');
    
    elements.avatarStatus.textContent = 'Reconnecting...';
    setAvatarHealth('connecting');
    teardownSimli();

    simliReconnectTimer = setTimeout(function () {
        simliReconnectTimer = null;
        freshSimliSession();
    }, delay);
}

async function freshSimliSession() {
    if (simliConnecting) return;
    try {
        setAvatarHealth('connecting');
        var resp = await fetch(API_BASE + '/simli-session', { method: 'POST' });
        if (!resp.ok) throw new Error('Session endpoint returned ' + resp.status);
        var session = await resp.json();
        if (!session.available) throw new Error(session.error || 'Simli unavailable');
        await connectSimliWebRTC(session);
    } catch (e) {
        console.error('Fresh session failed:', e.message);
        scheduleSimliReconnect('fresh-session-error');
    }
}

function teardownSimli() {
    stopSimliKeepalive();
    if (simliPC) {
        simliPC.oniceconnectionstatechange = null;
        simliPC.onicecandidate = null;
        try { simliPC.close(); } catch (e) { /* ignore */ }
        simliPC = null;
    }
    if (simliWS) {
        simliWS.onmessage = null;
        simliWS.onopen = null;
        simliWS.onclose = null;
        try { simliWS.close(); } catch (e) { /* ignore */ }
        simliWS = null;
    }
    state.simliReady = false;
    elements.avatarVideo.style.display = 'none';
    elements.avatarPlaceholder.classList.remove('hidden');
    setAvatarHealth('disconnected');
}

function stopSimli() {
    teardownSimli();
}

async function speakViaSimli(text) {
    if (!text) return;
    if (simliSendingPCM) return; // Skip if previous PCM still streaming

    if (!simliWS || simliWS.readyState !== WebSocket.OPEN) {
        scheduleSimliReconnect('speak-no-socket');
        return;
    }

    simliSendingPCM = true;
    try {
        var resp = await fetch(API_BASE + '/tts?text=' + encodeURIComponent(text));
        if (!resp.ok) return;

        var mp3Buffer = await resp.arrayBuffer();
        if (!mp3Buffer || mp3Buffer.byteLength === 0) return;

        // Decode MP3 → PCM 16kHz mono via Web Audio API
        var audioCtx = getAudioContext();
        var audioBuffer = await audioCtx.decodeAudioData(mp3Buffer);

        var sampleRate = 16000;
        var length = Math.ceil(audioBuffer.duration * sampleRate);
        var offlineCtx = new OfflineAudioContext(1, length, sampleRate);
        var source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();
        var rendered = await offlineCtx.startRendering();
        var channel = rendered.getChannelData(0);

        var pcmInt16 = new Int16Array(channel.length);
        for (var i = 0; i < channel.length; i++) {
            pcmInt16[i] = Math.max(-32768, Math.min(32767, Math.round(channel[i] * 32767)));
        }
        var pcmBytes = new Uint8Array(pcmInt16.buffer);

        // Send PCM through Simli WebRTC in chunks
        var chunkSize = 6000;
        for (var i = 0; i < pcmBytes.length; i += chunkSize) {
            if (!simliWS || simliWS.readyState !== WebSocket.OPEN) {
                console.log('WS died mid-send, triggering reconnect');
                scheduleSimliReconnect('ws-died-mid-send');
                break; // Stop sending, browser TTS continues as fallback
            }
            simliWS.send(pcmBytes.slice(i, i + chunkSize));
            await new Promise(function (r) { setTimeout(r, 20); });
        }
    } catch (e) {
        console.log('Simli PCM send failed:', e.message);
    } finally {
        simliSendingPCM = false;
    }
}

async function speakWithSimli(text) {
    return speakViaSimli(text);
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
            // Browser TTS for audible voice + Simli PCM for lip-sync (both run)
            speakText(data.reply);
            if (state.simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
                speakViaSimli(data.reply);
            }
        }

        if (!state.simliReady && simliAvailable && !simliConnecting && !simliReconnectTimer) {
            freshSimliSession();
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

document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    // Page is now visible again
    if (simliAvailable && !state.simliReady && !simliConnecting && !simliReconnectTimer) {
        console.log('Tab visible + avatar dead → reconnecting');
        freshSimliSession();
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
