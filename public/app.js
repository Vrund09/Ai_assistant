/**
 * Voice Avatar Assistant — Frontend
 * Handles mic capture (Web Speech API), text fallback, API calls,
 * conversation history, and Simli avatar integration (placeholder).
 */

const API_BASE = '/api';

const state = {
    isRecording: false,
    recognition: null,
    speechSupported: false,
    status: 'idle', // idle | listening | thinking | speaking | error
    simliReady: false,
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
    const dot = elements.statusDot;
    const text = elements.statusText;

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
    } else if (status === 'error') {
        dot.classList.add('error');
    }

    if (message) text.textContent = message;
}

// =========================================================================
// Conversation history
// =========================================================================

function addMessage(text, role) {
    const el = document.createElement('div');
    el.className = 'message ' + role;
    el.textContent = text;
    elements.conversation.appendChild(el);
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

// =========================================================================
// Simli avatar integration (pre-warm on load)
// =========================================================================

async function initSimli() {
    try {
        const resp = await fetch(API_BASE + '/simli-config');
        if (!resp.ok) {
            console.log('Simli not configured');
            return;
        }

        const config = await resp.json();
        if (!config.apiKey) {
            console.log('Simli not configured');
            return;
        }

        console.log('Pre-warming Simli WebRTC session...');

        // Simli SDK initialization goes here when you have the key.
        // The exact SDK call depends on Simli's current API.
        // See: https://docs.simli.com for latest integration docs.
        //
        // Typical pattern:
        //   const simli = new SimliClient({ apiKey, faceId });
        //   await simli.start();
        //   state.simliClient = simli;
        //   elements.avatarPlaceholder.classList.add('hidden');
        //   elements.avatarVideo.style.display = 'block';

        elements.avatarStatus.textContent = 'Simli configured';
        state.simliReady = true;
        console.log('Simli ready for avatar speech');

    } catch (err) {
        console.log('Simli init skipped:', err.message);
    }
}

async function speakWithAvatar(text) {
    if (!state.simliReady) return;

    try {
        // Simli speak call goes here:
        //   await state.simliClient.speak(text);
        console.log('Avatar speaking:', text.substring(0, 50) + '...');
    } catch (err) {
        console.error('Avatar speak error:', err);
    }
}

// =========================================================================
// API call
// =========================================================================

async function sendMessage(message) {
    if (!message.trim()) return;

    setStatus('thinking', 'Thinking...');
    addMessage(message, 'user');
    elements.textInput.value = '';

    try {
        const t0 = performance.now();
        const response = await fetch(API_BASE + '/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message }),
        });
        const t1 = performance.now();

        if (!response.ok) {
            throw new Error('Server error: ' + response.status);
        }

        const data = await response.json();
        const msgClass = data.blocked ? 'assistant blocked' : 'assistant';
        addMessage(data.reply, msgClass);

        if (data.blocked) {
            setStatus('idle', 'Waiting for your question...');
            showToast('Message blocked by safety filter', 'error');
        } else {
            setStatus('speaking', 'Speaking...');
            speakWithAvatar(data.reply);
            setTimeout(function () {
                setStatus('idle', 'Waiting for your question...');
            }, 2500);
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        elements.micBtn.disabled = true;
        elements.micBtn.title = 'Speech recognition not supported in this browser';
        elements.micBtn.querySelector('.btn-label').textContent = 'Not supported';
        showToast('Speech recognition is not supported in this browser. Use text input instead.', 'warning');
        return;
    }

    state.speechSupported = true;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = function (event) {
        var interim = '';
        var final = '';

        for (var i = event.resultIndex; i < event.results.length; i++) {
            var transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += transcript;
            } else {
                interim += transcript;
            }
        }

        if (interim) {
            elements.transcript.textContent = interim;
            elements.transcript.classList.add('active');
        }

        if (final) {
            elements.transcript.textContent = final;
            elements.transcript.classList.add('active');
            sendMessage(final);
            setTimeout(function () {
                elements.transcript.textContent = '';
                elements.transcript.classList.remove('active');
            }, 1000);
        }
    };

    recognition.onerror = function (event) {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
            showToast('Microphone access denied. Please enable it in your browser settings.', 'error');
        } else if (event.error !== 'no-speech') {
            showToast('Speech recognition error: ' + event.error, 'error');
        }
        stopRecording();
    };

    recognition.onend = function () {
        if (!state.isRecording) {
            stopRecording();
        }
    };

    state.recognition = recognition;
}

function startRecording() {
    if (!state.speechSupported) return;

    state.isRecording = true;
    elements.micBtn.classList.add('recording');
    elements.micBtn.querySelector('.btn-label').textContent = 'Listening...';
    setStatus('listening', "I'm listening...");
    elements.avatarFace.textContent = '👂';

    try {
        state.recognition.start();
    } catch (e) {
        // Already started — ignore
    }
}

function stopRecording() {
    state.isRecording = false;
    elements.micBtn.classList.remove('recording');
    elements.micBtn.querySelector('.btn-label').textContent = 'Hold to talk';
    elements.avatarFace.textContent = '🎙️';

    try {
        state.recognition.stop();
    } catch (e) {
        // Not started — ignore
    }

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
    var message = elements.textInput.value.trim();
    if (message) sendMessage(message);
});

elements.textInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        var message = elements.textInput.value.trim();
        if (message) sendMessage(message);
    }
});

// =========================================================================
// Init
// =========================================================================

function init() {
    initSpeechRecognition();
    initSimli();
    console.log('Voice Avatar Assistant ready');
    console.log('Speech recognition:', state.speechSupported ? 'supported' : 'not supported');
}

init();
