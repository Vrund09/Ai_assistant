/**
 * Voice Avatar Assistant — Frontend
 * Mic capture (Web Speech API), text fallback, API calls,
 * conversation history, animated avatar, and Simli WebRTC integration.
 */

var API_BASE = '/api';

var state = {
    isRecording: false,
    recognition: null,
    speechSupported: false,
    status: 'idle',
    simliReady: false,
    isSpeaking: false,
};

var $ = function (sel) { return document.querySelector(sel); };

var elements = {
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

var SIMLI_MAX_RECONNECTS = 3;

// =========================================================================
// Toast helper
// =========================================================================

function showToast(message, type) {
    type = type || 'info';
    var toast = document.createElement('div');
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

    var face = document.createElementNS(ns, 'circle');
    face.setAttribute('cx', '100');
    face.setAttribute('cy', '100');
    face.setAttribute('r', '80');
    face.setAttribute('fill', '#2d2d3d');
    face.setAttribute('stroke', '#7c3aed');
    face.setAttribute('stroke-width', '2');
    avatarSVG.appendChild(face);

    var leftEye = document.createElementNS(ns, 'circle');
    leftEye.setAttribute('cx', '75');
    leftEye.setAttribute('cy', '85');
    leftEye.setAttribute('r', '8');
    leftEye.setAttribute('fill', '#e4e4e7');
    avatarSVG.appendChild(leftEye);

    var leftPupil = document.createElementNS(ns, 'circle');
    leftPupil.setAttribute('cx', '77');
    leftPupil.setAttribute('cy', '85');
    leftPupil.setAttribute('r', '4');
    leftPupil.setAttribute('fill', '#0f0f13');
    avatarSVG.appendChild(leftPupil);

    var rightEye = document.createElementNS(ns, 'circle');
    rightEye.setAttribute('cx', '125');
    rightEye.setAttribute('cy', '85');
    rightEye.setAttribute('r', '8');
    rightEye.setAttribute('fill', '#e4e4e7');
    avatarSVG.appendChild(rightEye);

    var rightPupil = document.createElementNS(ns, 'circle');
    rightPupil.setAttribute('cx', '127');
    rightPupil.setAttribute('cy', '85');
    rightPupil.setAttribute('r', '4');
    rightPupil.setAttribute('fill', '#0f0f13');
    avatarSVG.appendChild(rightPupil);

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
    if ($('#playOverlay')) return;
    var overlay = document.createElement('div');
    overlay.id = 'playOverlay';
    overlay.className = 'play-overlay';
    overlay.innerHTML = '<div class="play-overlay-content">Tap to start avatar</div>';
    overlay.addEventListener('click', function () {
        elements.avatarVideo.play().catch(function (err) {
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
    if (needsPlayOnGesture && elements.avatarVideo.srcObject) {
        elements.avatarVideo.play().then(function () {
            needsPlayOnGesture = false;
            var overlay = $('#playOverlay');
            if (overlay) overlay.remove();
        }).catch(function (e) {
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

    window.speechSynthesis.cancel();

    state.isSpeaking = true;
    setStatus('speaking', 'Speaking...');
    animateMouth(true);

    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.pitch = 1.1;

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
var simliConfigured = false;
var simliConnecting = false;
var simliReconnectTimer = null;
var simliKeepaliveTimer = null;
var simliReconnectAttempts = 0;
var simliSendingPCM = false;

function setAvatarHealth(status) {
    if (elements.avatarHealth) {
        elements.avatarHealth.className = 'avatar-health ' + status;
    }
}

async function checkSimliAvailable() {
    try {
        var resp = await fetch(API_BASE + '/simli-status');
        if (!resp.ok) {
            simliConfigured = false;
            elements.avatarStatus.textContent = 'Voice mode';
            return;
        }
        var data = await resp.json();
        simliConfigured = data.configured;
        if (simliConfigured) {
            elements.avatarStatus.textContent = 'Ready — avatar activates on first message';
        } else {
            elements.avatarStatus.textContent = 'Voice mode';
        }
    } catch (e) {
        simliConfigured = false;
        elements.avatarStatus.textContent = 'Voice mode';
    }
}

// Creates a Simli session just-in-time (called from sendMessage when needed)
function ensureSimliSession() {
    return new Promise(function (resolve) {
        if (state.simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
            resolve(true);
            return;
        }
        if (simliConnecting) {
            // Wait for ongoing connection attempt
            var check = setInterval(function () {
                if (state.simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
                    clearInterval(check);
                    resolve(true);
                } else if (!simliConnecting) {
                    clearInterval(check);
                    resolve(false);
                }
            }, 200);
            // Timeout after 15s
            setTimeout(function () { clearInterval(check); resolve(false); }, 15000);
            return;
        }
        if (!simliConfigured) {
            resolve(false);
            return;
        }

        // Start a fresh session
        elements.avatarStatus.textContent = 'Activating avatar...';
        freshSimliSession()
            .then(function () {
                // Wait up to 15s for video track
                var waited = 0;
                var wait = setInterval(function () {
                    waited += 200;
                    if (state.simliReady) {
                        clearInterval(wait);
                        resolve(true);
                    } else if (waited >= 15000) {
                        clearInterval(wait);
                        resolve(false);
                    }
                }, 200);
            })
            .catch(function () {
                resolve(false);
            });
    });
}

function startSimliKeepalive() {
    stopSimliKeepalive();
    simliKeepaliveTimer = setInterval(function () {
        if (state.isSpeaking) return;
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
        simliPC = new RTCPeerConnection({ iceServers: session.iceServers });

        simliPC.addEventListener('track', function (evt) {
            if (evt.track.kind === 'video') {
                var vid = elements.avatarVideo;
                vid.srcObject = evt.streams[0];
                vid.play().then(function () {
                    console.log('Simli video autoplay succeeded');
                }).catch(function (e) {
                    console.log('Video autoplay blocked, will retry on gesture:', e.message);
                    needsPlayOnGesture = true;
                    showPlayOverlay();
                });
                elements.avatarPlaceholder.classList.add('hidden');
                vid.style.display = 'block';
                state.simliReady = true;
                simliReconnectAttempts = 0;
                elements.avatarStatus.textContent = '';
                setAvatarHealth('connected');
                console.log('Simli video connected');
            }
        });

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
    if (!simliConfigured) return;
    if (simliConnecting || simliReconnectTimer) return;

    if (simliReconnectAttempts >= SIMLI_MAX_RECONNECTS) {
        console.log('Simli: max reconnects reached, falling back to voice-only');
        elements.avatarStatus.textContent = 'Voice mode (avatar will retry on next message)';
        setAvatarHealth('disconnected');
        teardownSimli();
        return;
    }

    simliReconnectAttempts++;

    var delay = Math.min(3000 * simliReconnectAttempts, 15000);
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

window.addEventListener('beforeunload', function () {
    teardownSimli();
});

async function speakViaSimli(text) {
    if (!text) return;
    if (simliSendingPCM) return;

    if (!simliWS || simliWS.readyState !== WebSocket.OPEN) {
        return;
    }

    simliSendingPCM = true;
    try {
        var resp = await fetch(API_BASE + '/tts?text=' + encodeURIComponent(text));
        if (!resp.ok) return;

        var mp3Buffer = await resp.arrayBuffer();
        if (!mp3Buffer || mp3Buffer.byteLength === 0) return;

        var audioCtx = getAudioContext();
        var audioBuffer;
        try {
            audioBuffer = await audioCtx.decodeAudioData(mp3Buffer.slice(0));
        } catch (decodeErr) {
            console.log('MP3 decode failed:', decodeErr.message);
            return;
        }

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

        var chunkSize = 6000;
        for (var j = 0; j < pcmBytes.length; j += chunkSize) {
            if (!simliWS || simliWS.readyState !== WebSocket.OPEN) {
                console.log('WS died mid-send, stopping PCM');
                break;
            }
            simliWS.send(pcmBytes.slice(j, j + chunkSize));
            await new Promise(function (r) { setTimeout(r, 20); });
        }
    } catch (e) {
        console.log('Simli PCM send failed:', e.message);
    } finally {
        simliSendingPCM = false;
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
            // Start browser TTS immediately
            speakText(data.reply);

            // Lazy-init Simli: only create session when we have a reply to speak
            if (simliConfigured && !state.simliReady && !simliConnecting) {
                ensureSimliSession().then(function (ready) {
                    if (ready && simliWS && simliWS.readyState === WebSocket.OPEN) {
                        speakViaSimli(data.reply);
                    }
                });
            } else if (state.simliReady && simliWS && simliWS.readyState === WebSocket.OPEN) {
                speakViaSimli(data.reply);
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

// Visibility change: just update status, don't auto-reconnect
document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (simliConfigured && !state.simliReady) {
        elements.avatarStatus.textContent = 'Avatar will reconnect on next message';
    }
});

// =========================================================================
// Init
// =========================================================================

function init() {
    initAvatarFace();
    initSpeechRecognition();
    checkSimliAvailable();
    console.log('Voice Avatar Assistant ready');
    console.log('Speech recognition:', state.speechSupported ? 'supported' : 'not supported');
}

init();
