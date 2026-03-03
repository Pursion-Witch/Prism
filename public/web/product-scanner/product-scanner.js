(function() {
    'use strict';

    let currentMode = 'basic';
    let cameraStream = null;
    let capturedBlob = null;
    let capturedUrl = '';
    let voiceRecognition = null;
    let voiceListening = false;
    let voiceStopRequested = false;
    let voiceTranslateTimer = null;
    let lastQueuedVoiceTranscript = '';
    let lastAppliedVoiceTranscript = '';
    let voiceMediaRecorder = null;
    let voiceMediaStream = null;
    let voiceAudioChunks = [];
    let voiceProcessing = false;

    const CAMERA_FILE_NAME = 'camera-capture.jpg';
    const HIDE_PRICE_TOKENS = ['hide price', 'no price', 'without price', 'label only', 'identify only', 'name only'];
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;

    const byId = (id) => document.getElementById(id);

    function createStars() {
        const stars = byId('stars');
        if (!stars) return;
        stars.innerHTML = '';
        for (let i = 0; i < 180; i += 1) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(star);
        }
    }

    function initHamburger() {
        const hamburger = byId('hamburgerBtn');
        const nav = byId('navLinks');
        if (!hamburger || !nav) return;

        hamburger.addEventListener('click', (event) => {
            event.stopPropagation();
            nav.classList.toggle('active');
        });
        document.querySelectorAll('.nav-links a').forEach((link) => {
            link.addEventListener('click', () => nav.classList.remove('active'));
        });
        document.addEventListener('click', (event) => {
            if (!hamburger.contains(event.target) && !nav.contains(event.target)) {
                nav.classList.remove('active');
            }
        });
    }

    function showNotification(message) {
        let notification = byId('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }
        notification.textContent = message;
        notification.style.display = 'block';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 2200);
    }

    function normalizeVoiceText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatVoicePreview(value) {
        const text = normalizeVoiceText(value);
        if (!text) return 'Listening...';
        return text.length > 68 ? `${text.slice(0, 68)}...` : text;
    }

    function setVoiceStatus(message, isRecording) {
        const status = byId('voiceStatus');
        const button = byId('voiceInputBtn');

        if (status) {
            status.textContent = message;
            status.classList.toggle('recording', Boolean(isRecording));
        }

        if (button) {
            button.classList.toggle('recording', Boolean(isRecording));
            if (!voiceProcessing) {
                button.textContent = isRecording ? 'STOP MIC' : 'START MIC';
            }
        }
    }

    function setVoiceProcessingState(isProcessing) {
        voiceProcessing = Boolean(isProcessing);
        const button = byId('voiceInputBtn');
        const status = byId('voiceStatus');

        if (button) {
            button.disabled = voiceProcessing;
            button.classList.toggle('processing', voiceProcessing);
            if (voiceProcessing) {
                button.textContent = 'TRANSCRIBING...';
            } else if (!voiceListening) {
                button.textContent = 'START MIC';
            }
        }

        if (status) {
            status.classList.toggle('processing', voiceProcessing);
        }
    }

    function supportsAudioCapture() {
        return typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    }

    function getAudioLanguageHint() {
        const language = String(getVoiceLanguage() || '').toLowerCase();
        if (language.startsWith('en')) return 'en';
        if (language.startsWith('fil') || language.startsWith('tl')) return 'tl';
        if (language.startsWith('ceb')) return 'ceb';
        return '';
    }

    function clearVoiceMediaStream() {
        if (voiceMediaStream) {
            voiceMediaStream.getTracks().forEach((track) => track.stop());
            voiceMediaStream = null;
        }
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                if (!result) {
                    reject(new Error('Failed to read audio recording.'));
                    return;
                }
                const commaIndex = result.indexOf(',');
                resolve(commaIndex >= 0 ? result.substring(commaIndex + 1) : result);
            };
            reader.onerror = () => reject(new Error('Failed to read audio recording.'));
            reader.readAsDataURL(blob);
        });
    }

    async function transcribeAudioBlob(blob, mimeType) {
        if (!blob || !blob.size) {
            setVoiceStatus('No speech captured. Try again.', false);
            return;
        }

        setVoiceProcessingState(true);
        setVoiceStatus('Transcribing audio...', false);

        try {
            const audioBase64 = await blobToBase64(blob);
            const response = await fetch('/api/analyze/transcribe-audio', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_base64: audioBase64,
                    mime_type: mimeType || 'audio/webm',
                    language: getAudioLanguageHint()
                })
            });

            const payload = parseJsonSafe(await response.text());
            if (!response.ok) {
                throw new Error(payload.message || 'Audio transcription failed.');
            }

            const transcribedText = normalizeVoiceText(
                payload.canonical_text || payload.translated_text || payload.transcribed_text || ''
            );

            if (!transcribedText) {
                setVoiceStatus('No speech detected. Try again.', false);
                showNotification('No speech detected from microphone.');
                return;
            }

            const input = byId('productInput');
            if (input) {
                input.value = transcribedText;
            }
            updateMetadata(transcribedText);
            syncCheckButtonState();

            if (
                payload.translated_text &&
                payload.transcribed_text &&
                String(payload.translated_text).toLowerCase() !== String(payload.transcribed_text).toLowerCase()
            ) {
                setVoiceStatus('Voice captured and translated.', false);
            } else {
                setVoiceStatus('Voice captured.', false);
            }

            showNotification('Voice transcription complete.');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Audio transcription failed.';
            setVoiceStatus('Transcription failed. Try again.', false);
            showNotification(message);
        } finally {
            setVoiceProcessingState(false);
        }
    }

    async function startAudioRecording() {
        if (voiceProcessing || voiceListening) {
            return;
        }

        if (!supportsAudioCapture()) {
            startVoiceInput();
            return;
        }

        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            showNotification('Microphone requires HTTPS or localhost.');
            setVoiceStatus('Microphone requires HTTPS.', false);
            return;
        }

        try {
            voiceAudioChunks = [];
            voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
            let recorderOptions = undefined;
            if (typeof window.MediaRecorder.isTypeSupported === 'function') {
                for (const candidate of mimeCandidates) {
                    if (window.MediaRecorder.isTypeSupported(candidate)) {
                        recorderOptions = { mimeType: candidate };
                        break;
                    }
                }
            }

            voiceMediaRecorder = recorderOptions
                ? new MediaRecorder(voiceMediaStream, recorderOptions)
                : new MediaRecorder(voiceMediaStream);

            const activeRecorder = voiceMediaRecorder;
            activeRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    voiceAudioChunks.push(event.data);
                }
            };

            activeRecorder.onerror = () => {
                voiceListening = false;
                clearVoiceMediaStream();
                setVoiceStatus('Recording failed. Try again.', false);
            };

            activeRecorder.onstop = async () => {
                const capturedChunks = voiceAudioChunks.slice();
                const mimeType = activeRecorder.mimeType || 'audio/webm';
                voiceAudioChunks = [];
                voiceListening = false;
                voiceMediaRecorder = null;
                clearVoiceMediaStream();
                setVoiceStatus('Preparing audio...', false);
                const audioBlob = new Blob(capturedChunks, { type: mimeType });
                await transcribeAudioBlob(audioBlob, mimeType);
            };

            voiceStopRequested = false;
            activeRecorder.start(220);
            voiceListening = true;
            setVoiceStatus('Recording... tap STOP MIC when done.', true);
        } catch (error) {
            clearVoiceMediaStream();
            setVoiceStatus('Microphone permission denied.', false);
            showNotification('Microphone permission is required for voice input.');
        }
    }

    function stopAudioRecording() {
        voiceStopRequested = true;

        if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
            try {
                voiceMediaRecorder.stop();
                setVoiceStatus('Processing recording...', false);
                return;
            } catch {
                // fall through to cleanup
            }
        }

        voiceListening = false;
        clearVoiceMediaStream();
        setVoiceStatus('Voice idle', false);
    }

    function clearVoiceTranslateTimer() {
        if (voiceTranslateTimer) {
            clearTimeout(voiceTranslateTimer);
            voiceTranslateTimer = null;
        }
    }

    async function translateVoiceTranscript(rawTranscript) {
        const transcript = normalizeVoiceText(rawTranscript);
        if (!transcript || transcript === lastAppliedVoiceTranscript) {
            return;
        }

        const input = byId('productInput');
        if (!input) return;

        setVoiceStatus('Translating speech to text...', voiceListening);
        let translatedText = transcript;

        try {
            const response = await fetch('/api/analyze/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: transcript })
            });
            const payload = parseJsonSafe(await response.text());
            if (!response.ok) {
                throw new Error(payload.message || 'Translation failed.');
            }
            translatedText = normalizeVoiceText(payload.canonical_text || payload.translated_text || transcript) || transcript;
        } catch (error) {
            translatedText = transcript;
        }

        input.value = translatedText;
        updateMetadata(translatedText);
        syncCheckButtonState();
        lastAppliedVoiceTranscript = transcript;
        if (translatedText.toLowerCase() !== transcript.toLowerCase()) {
            setVoiceStatus('Voice captured and translated.', voiceListening);
        } else {
            setVoiceStatus('Voice captured.', voiceListening);
        }
    }

    function scheduleVoiceTranslation(rawTranscript) {
        const transcript = normalizeVoiceText(rawTranscript);
        if (!transcript || transcript === lastQueuedVoiceTranscript) {
            return;
        }

        lastQueuedVoiceTranscript = transcript;
        clearVoiceTranslateTimer();
        voiceTranslateTimer = setTimeout(() => {
            voiceTranslateTimer = null;
            translateVoiceTranscript(transcript).catch(() => {
                setVoiceStatus('Voice captured (translation unavailable).', voiceListening);
            });
        }, 420);
    }

    function getVoiceLanguage() {
        const languageSelect = byId('voiceLanguage');
        if (!languageSelect || typeof languageSelect.value !== 'string') {
            return 'en-PH';
        }
        return languageSelect.value || 'en-PH';
    }

    function ensureVoiceRecognition() {
        if (voiceRecognition) return voiceRecognition;
        if (!SpeechRecognitionCtor) return null;

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            voiceListening = true;
            voiceStopRequested = false;
            setVoiceStatus('Listening...', true);
        };

        recognition.onresult = (event) => {
            const finalSegments = [];
            const interimSegments = [];

            for (let index = 0; index < event.results.length; index += 1) {
                const segment = normalizeVoiceText(event.results[index][0]?.transcript || '');
                if (!segment) continue;
                if (event.results[index].isFinal) {
                    finalSegments.push(segment);
                } else {
                    interimSegments.push(segment);
                }
            }

            const finalTranscript = normalizeVoiceText(finalSegments.join(' '));
            const interimTranscript = normalizeVoiceText(interimSegments.join(' '));
            const preview = interimTranscript || finalTranscript;

            if (preview) {
                setVoiceStatus(`Listening: ${formatVoicePreview(preview)}`, true);
            }

            if (finalTranscript) {
                scheduleVoiceTranslation(finalTranscript);
            }
        };

        recognition.onerror = (event) => {
            const code = String(event.error || '').toLowerCase();
            if (code === 'not-allowed' || code === 'service-not-allowed') {
                setVoiceStatus('Microphone permission denied.', false);
                showNotification('Microphone permission is required for voice input.');
                voiceStopRequested = true;
                return;
            }

            if (code === 'language-not-supported') {
                setVoiceStatus('Voice language is not supported by this browser.', false);
                voiceStopRequested = true;
                return;
            }

            if (code === 'audio-capture') {
                setVoiceStatus('No microphone was found.', false);
                voiceStopRequested = true;
                return;
            }

            if (code === 'no-speech') {
                setVoiceStatus('No speech detected. Keep speaking...', true);
                return;
            }

            setVoiceStatus('Voice input failed. Try again.', false);
            voiceStopRequested = true;
        };

        recognition.onend = () => {
            clearVoiceTranslateTimer();

            if (voiceListening && !voiceStopRequested) {
                try {
                    recognition.lang = getVoiceLanguage();
                    recognition.start();
                    return;
                } catch {
                    // fall through to reset state
                }
            }

            voiceListening = false;
            voiceStopRequested = false;
            setVoiceStatus('Voice idle', false);
        };

        voiceRecognition = recognition;
        return voiceRecognition;
    }

    function startVoiceInput() {
        const recognition = ensureVoiceRecognition();
        if (!recognition) {
            setVoiceStatus('Voice input is not supported in this browser.', false);
            showNotification('Speech recognition is not available on this browser.');
            const button = byId('voiceInputBtn');
            if (button) button.disabled = true;
            return;
        }

        if (voiceListening) return;

        recognition.lang = getVoiceLanguage();
        voiceStopRequested = false;
        lastQueuedVoiceTranscript = '';
        lastAppliedVoiceTranscript = '';

        try {
            recognition.start();
        } catch (error) {
            setVoiceStatus('Unable to start microphone.', false);
            showNotification('Unable to start microphone.');
        }
    }

    function stopVoiceInput() {
        voiceStopRequested = true;
        clearVoiceTranslateTimer();

        if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
            stopAudioRecording();
            return;
        }

        if (voiceRecognition && voiceListening) {
            try {
                voiceRecognition.stop();
                setVoiceStatus('Stopping microphone...', false);
                return;
            } catch {
                // fallback to idle state
            }
        }

        voiceListening = false;
        clearVoiceMediaStream();
        setVoiceStatus('Voice idle', false);
    }

    function parseJsonSafe(raw) {
        try {
            return raw ? JSON.parse(raw) : {};
        } catch {
            return { message: raw || 'Unexpected server response.' };
        }
    }

    function formatMoney(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) {
            return 'Not available';
        }
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            maximumFractionDigits: 2
        }).format(amount);
    }

    function detectMetadata(text) {
        const lowered = String(text || '').toLowerCase();
        const brand = lowered.includes('samsung') ? 'Samsung' : lowered.includes('dole') ? 'Dole' : lowered.includes('bigas') ? 'NFA' : 'General';
        const location = lowered.includes('lazada') ? 'Lazada' : lowered.includes('shopee') ? 'Shopee' : lowered.includes('palengke') ? 'Market' : 'Cebu City';
        const language = lowered.includes('tagalog') || lowered.includes('bigas') ? 'Tagalog support' : 'English support';
        return { brand, location, language };
    }

    function updateMetadata(text) {
        const metadata = detectMetadata(text);
        const brand = byId('detectBrand');
        const location = byId('detectLocation');
        const language = byId('detectLanguage');
        if (brand) brand.textContent = metadata.brand;
        if (location) location.textContent = metadata.location;
        if (language) language.textContent = metadata.language;
    }

    function parseAnalyzeInput(raw) {
        const input = String(raw || '').trim();
        if (!input) return null;

        const moneyMatch = [...input.matchAll(/(?:PHP|P)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi)];
        const trailingNumber = input.match(/(?:^|[\s:-])([0-9][0-9,]*(?:\.[0-9]+)?)\s*$/);
        const priceToken = moneyMatch.length
            ? moneyMatch[moneyMatch.length - 1][1]
            : trailingNumber
                ? trailingNumber[1]
                : '';

        let parsedPrice = null;
        if (priceToken) {
            const price = Number(priceToken.replace(/,/g, ''));
            if (Number.isFinite(price) && price > 0) {
                parsedPrice = Number(price.toFixed(2));
            }
        }

        const normalizedName = (parsedPrice !== null
            ? input
                .replace(/(?:PHP|P)\s*[0-9][0-9,]*(?:\.[0-9]+)?/gi, '')
                .replace(priceToken, '')
            : input)
            .replace(/\/\s*[a-zA-Z]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalizedName || !/[a-zA-Z]/.test(normalizedName)) return null;
        return { name: normalizedName, price: parsedPrice };
    }

    function getPromptText() {
        const input = byId('scanPrompt');
        return input ? String(input.value || '').trim() : '';
    }

    function getShowPriceRequest() {
        const checkbox = byId('showPriceToggle');
        const checked = !checkbox || checkbox.checked;
        const prompt = getPromptText().toLowerCase();
        const promptAllows = !HIDE_PRICE_TOKENS.some((token) => prompt.includes(token));
        return checked && promptAllows;
    }

    function hasAnalyzeInput() {
        const input = byId('productInput');
        const hasText = input ? Boolean(String(input.value || '').trim()) : false;
        return hasText || Boolean(capturedBlob);
    }

    function syncCheckButtonState() {
        const button = byId('checkPriceBtn');
        if (!button) return;
        const isLoading = button.dataset.loading === 'true';
        button.disabled = isLoading ? true : !hasAnalyzeInput();
    }

    function setLoading(isLoading) {
        const button = byId('checkPriceBtn');
        if (!button) return;
        button.dataset.loading = isLoading ? 'true' : 'false';
        button.disabled = isLoading ? true : !hasAnalyzeInput();
        button.textContent = isLoading ? 'ANALYZING...' : 'CHECK PRICE NOW';
    }

    function renderLoading(name) {
        const title = byId('resultProduct');
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        if (title) title.textContent = `${name} Price Analysis`;
        setScoreVisual(score, '...', '#8f8f8f');
        if (comparison) comparison.innerHTML = '<div class="price-card"><div class="price-source">Status</div><div class="price-value">Loading</div><div class="price-note">Running AI analysis</div></div>';
        if (insights) insights.textContent = 'Please wait...';
        if (results) results.classList.add('show');
    }

    function renderError(message) {
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        setScoreVisual(score, '--', '#8f8f8f');
        if (comparison) comparison.innerHTML = '';
        if (insights) insights.innerHTML = `<strong>Error:</strong> ${message}`;
        if (results) results.classList.add('show');
    }

    function withAlpha(color, alphaHex) {
        if (typeof color !== 'string') return color;
        return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alphaHex}` : color;
    }

    function setScoreVisual(scoreElement, label, color) {
        if (!scoreElement) return;
        scoreElement.textContent = label;
        scoreElement.style.color = color || '';
        scoreElement.style.background = color ? withAlpha(color, '20') : '';
        scoreElement.style.border = color ? `1px solid ${withAlpha(color, '55')}` : '';
    }

    function buildFallbackAssessment(scannedPrice, fairPrice) {
        if (!(Number.isFinite(scannedPrice) && scannedPrice > 0 && Number.isFinite(fairPrice) && fairPrice > 0)) {
            return {
                level: 'FAIR',
                ratio: null,
                difference_percent: null,
                color: '#8f8f8f',
                note: 'No submitted price to compare.'
            };
        }

        const ratio = scannedPrice / fairPrice;
        const differencePercent = ((scannedPrice - fairPrice) / fairPrice) * 100;

        if (ratio >= 1.15) {
            return {
                level: 'OVERPRICED',
                ratio: Number(ratio.toFixed(4)),
                difference_percent: Number(differencePercent.toFixed(2)),
                color: '#ff5f5f',
                note: 'Submitted price is significantly above fair market.'
            };
        }

        if (ratio >= 0.9) {
            return {
                level: 'FAIR',
                ratio: Number(ratio.toFixed(4)),
                difference_percent: Number(differencePercent.toFixed(2)),
                color: '#1ed760',
                note: 'Submitted price is within fair range.'
            };
        }

        if (ratio >= 0.75) {
            return {
                level: 'GREAT DEAL',
                ratio: Number(ratio.toFixed(4)),
                difference_percent: Number(differencePercent.toFixed(2)),
                color: '#24c9c3',
                note: 'Submitted price is below fair market.'
            };
        }

        return {
            level: 'STEAL',
            ratio: Number(ratio.toFixed(4)),
            difference_percent: Number(differencePercent.toFixed(2)),
            color: '#2f9bff',
            note: 'Submitted price is far below market and may need verification.'
        };
    }

    function normalizeRatioAssessment(assessment, scannedPrice, fairPrice) {
        if (!assessment || typeof assessment !== 'object') {
            return buildFallbackAssessment(scannedPrice, fairPrice);
        }

        const level = String(assessment.level || '').toUpperCase();
        const allowedLevels = new Set(['OVERPRICED', 'FAIR', 'GREAT DEAL', 'STEAL']);
        if (!allowedLevels.has(level)) {
            return buildFallbackAssessment(scannedPrice, fairPrice);
        }

        return {
            level,
            ratio: Number.isFinite(Number(assessment.ratio)) ? Number(assessment.ratio) : null,
            difference_percent: Number.isFinite(Number(assessment.difference_percent))
                ? Number(assessment.difference_percent)
                : null,
            color: typeof assessment.color === 'string' && assessment.color ? assessment.color : '#8f8f8f',
            note: typeof assessment.note === 'string' && assessment.note ? assessment.note : ''
        };
    }

    function describeInputPriceSource(source) {
        const normalized = String(source || '').toLowerCase();
        if (normalized === 'explicit') return 'Entered directly by user';
        if (normalized === 'sentence-detected') return 'Detected from sentence input';
        if (normalized === 'vision-detected') return 'Detected by camera scan';
        return 'Scanner or user input';
    }

    function renderResults(payload) {
        const {
            name,
            normalizedName,
            canonicalName,
            scannedPrice,
            fairPrice,
            showPrice,
            reasoning,
            ratioAssessment,
            inputPriceSource,
            translationSource,
            canonicalSource,
            extractionSource
        } = payload;
        const title = byId('resultProduct');
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        if (!results) return;

        if (title) title.textContent = `${name} Price Analysis`;

        if (!showPrice) {
            setScoreVisual(score, 'LABEL', '#8f8f8f');
            if (comparison) {
                const normalizedLine = normalizedName && normalizedName.toLowerCase() !== String(name).toLowerCase()
                    ? `<div class="price-note">English: ${normalizedName}</div>`
                    : '';
                const canonicalLine = canonicalName && canonicalName.toLowerCase() !== String(name).toLowerCase()
                    ? `<div class="price-note">Generalized: ${canonicalName}</div>`
                    : '';
                const translationLine = translationSource && translationSource !== 'none'
                    ? `<div class="price-note">Translated to English for market matching</div>`
                    : '';
                comparison.innerHTML = `<div class="price-card"><div class="price-source">Detected Label</div><div class="price-value">${name}</div>${normalizedLine}${canonicalLine}<div class="price-note">Price hidden by prompt</div></div>`;
                if (translationLine) {
                    comparison.innerHTML += `<div class="price-card"><div class="price-source">Normalization</div><div class="price-value">READY</div>${translationLine}</div>`;
                }
            }
            if (insights) {
                insights.innerHTML = `<strong>Label mode:</strong> ${reasoning || 'Detected product text is ready for database use.'}`;
            }
            results.classList.add('show');
            return;
        }

        const hasScanned = Number.isFinite(scannedPrice) && scannedPrice > 0;
        const hasFair = Number.isFinite(fairPrice) && fairPrice > 0;
        const delta = hasScanned && hasFair ? scannedPrice - fairPrice : 0;
        const assessment = normalizeRatioAssessment(ratioAssessment, scannedPrice, fairPrice);
        const hasDifference = Number.isFinite(assessment.difference_percent) && assessment.difference_percent !== null;
        const hasRatio = Number.isFinite(assessment.ratio) && assessment.ratio !== null;

        if (hasScanned && hasFair) {
            setScoreVisual(score, assessment.level, assessment.color);
        } else if (hasFair) {
            setScoreVisual(score, 'NO INPUT PRICE', '#8f8f8f');
        } else {
            setScoreVisual(score, 'NO MARKET DATA', '#8f8f8f');
        }

        if (comparison) {
            const normalizedLine = normalizedName && normalizedName.toLowerCase() !== String(name).toLowerCase()
                ? `<div class="price-note">English: ${normalizedName}</div>`
                : '';
            const canonicalLine = canonicalName && canonicalName.toLowerCase() !== String(name).toLowerCase()
                ? `<div class="price-note">Generalized item: ${canonicalName}</div>`
                : '';
            const translationLine = translationSource && translationSource !== 'none'
                ? `<div class="price-note">Translation source: ${translationSource}</div>`
                : '';
            const canonicalSourceLine = canonicalSource === 'rules'
                ? `<div class="price-note">Grouped with similar items</div>`
                : '';
            const extractionLine = extractionSource && extractionSource !== 'raw'
                ? `<div class="price-note">Item extracted from sentence text</div>`
                : '';
            const inputSourceLine = `<div class="price-note">${describeInputPriceSource(inputPriceSource)}</div>`;
            const ratioLine = hasRatio ? `<div class="price-note">Ratio: ${Number(assessment.ratio).toFixed(2)}x of fair price</div>` : '';
            const differenceTag = hasScanned && hasFair
                ? `<span style="color:${assessment.color}; font-weight:700;">${assessment.level}</span>`
                : 'Need both prices';
            comparison.innerHTML = `
                <div class="price-card">
                    <div class="price-source">Analyzed Item</div>
                    <div class="price-value">${name}</div>
                    ${normalizedLine}
                    ${canonicalLine}
                    ${translationLine}
                    ${canonicalSourceLine}
                    ${extractionLine}
                </div>
                <div class="price-card">
                    <div class="price-source">Submitted Price</div>
                    <div class="price-value">${hasScanned ? formatMoney(scannedPrice) : 'Not detected'}</div>
                    ${inputSourceLine}
                </div>
                <div class="price-card">
                    <div class="price-source">Fair Price</div>
                    <div class="price-value">${hasFair ? formatMoney(fairPrice) : 'Not available'}</div>
                    <div class="price-note">AI and market estimate</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Difference</div>
                    <div class="price-value">${hasScanned && hasFair ? `${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}` : 'Not available'}</div>
                    <div class="price-note">${differenceTag}</div>
                    ${ratioLine}
                </div>
            `;
        }

        if (insights) {
            if (!hasFair) {
                insights.innerHTML = '<strong>Notice:</strong> Fair price is not available yet.';
            } else if (!hasScanned) {
                insights.innerHTML = '<strong>Notice:</strong> No submitted price detected. Add a price to compare against current market.';
            } else {
                const direction = Number(assessment.difference_percent) > 0
                    ? 'above'
                    : Number(assessment.difference_percent) < 0
                        ? 'below'
                        : 'equal to';
                const differenceLine = hasDifference
                    ? `Submitted price is <span style="color:${assessment.color};">${Math.abs(Number(assessment.difference_percent)).toFixed(2)}%</span> ${direction} market reference.`
                    : 'Submitted price and market reference are being compared.';
                insights.innerHTML = `<strong style="color:${assessment.color};">${assessment.level}:</strong> ${assessment.note}<br><br>${differenceLine}`;
                if (inputPriceSource === 'sentence-detected') {
                    insights.innerHTML += '<br><strong>Input parsing:</strong> Price value was extracted from your sentence.';
                }
            }
            if (reasoning) insights.innerHTML += `<br><br><strong>AI reasoning:</strong> ${reasoning}`;
        }

        results.classList.add('show');
    }

    async function analyzeCurrentInput() {
        const input = byId('productInput');
        const rawText = input ? String(input.value || '').trim() : '';

        if (capturedBlob) {
            const filename =
                capturedBlob instanceof File && capturedBlob.name
                    ? capturedBlob.name
                    : CAMERA_FILE_NAME;
            await analyzeImageBlob(capturedBlob, filename);
            return;
        }

        if (!rawText) {
            const message = 'Enter product text or capture/upload an image first.';
            renderError(message);
            showNotification(message);
            return;
        }

        await analyzeTyped();
    }

    async function analyzeTyped() {
        const input = byId('productInput');
        if (!input) return;

        const parsed = parseAnalyzeInput(input.value);
        if (!parsed) {
            renderError('Invalid input. Example: carrot or Bigas NFA PHP 45 per kilo');
            return;
        }

        const region = byId('regionSelect') ? byId('regionSelect').value : 'Cebu City';
        const prompt = getPromptText();
        const showPriceRequest = getShowPriceRequest();

        updateMetadata(parsed.name);
        setLoading(true);
        renderLoading(parsed.name);

        try {
            const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: parsed.name,
                    price: parsed.price,
                    region,
                    prompt,
                    show_price: showPriceRequest
                })
            });

            const payload = parseJsonSafe(await response.text());
            if (!response.ok) {
                throw new Error(payload.message || 'Failed to analyze price.');
            }

            renderResults({
                name: payload.name ?? parsed.name,
                normalizedName: payload.normalized_name ?? parsed.name,
                canonicalName: payload.canonical_name ?? payload.normalized_name ?? parsed.name,
                scannedPrice: Number(payload.scanned_price ?? parsed.price ?? 0),
                fairPrice: Number(payload.fairPrice ?? payload.fair_market_value ?? 0),
                showPrice: payload.display?.show_price ?? showPriceRequest,
                reasoning: payload.reasoning,
                ratioAssessment: payload.ratio_assessment ?? null,
                inputPriceSource: payload.input_price_source ?? (parsed.price ? 'explicit' : 'none'),
                translationSource: payload.translation_source ?? 'none',
                canonicalSource: payload.canonical_source ?? 'none',
                extractionSource: payload.item_extraction?.source ?? 'raw'
            });
            const displayName = String(payload.name ?? parsed.name);
            showNotification(`Analysis complete for ${displayName.substring(0, 40)}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Service request failed.';
            renderError(message);
            showNotification(message);
        } finally {
            setLoading(false);
        }
    }

    async function analyzeImageBlob(blob, filename) {
        const prompt = getPromptText();
        const showPriceRequest = getShowPriceRequest();
        const data = new FormData();
        data.append('image', blob, filename || 'scan.jpg');
        data.append('prompt', prompt);
        data.append('show_price', String(showPriceRequest));
        const nameHint = byId('productInput') ? String(byId('productInput').value || '').trim() : '';
        if (nameHint) {
            data.append('name_hint', nameHint);
        }

        setLoading(true);
        renderLoading(filename || 'Image scan');

        try {
            const response = await fetch('/api/analyze-image', { method: 'POST', body: data });
            const payload = parseJsonSafe(await response.text());
            if (!response.ok) {
                throw new Error(payload.message || 'Image analysis failed.');
            }

            const vision = payload.vision || {};
            const market = payload.market_analysis || {};
            const name = market.name || vision.detected_name || 'Detected Product';
            const scannedPrice = Number(market.scanned_price ?? vision.detected_price ?? 0);
            const fairPrice = Number(market.fair_market_value ?? 0);
            const shouldShowPrice = payload.display?.show_price ?? showPriceRequest;

            const input = byId('productInput');
            if (input) {
                input.value = shouldShowPrice && scannedPrice > 0 ? `${name} PHP ${scannedPrice.toFixed(2)}` : name;
            }
            syncCheckButtonState();

            updateMetadata(name);
            renderResults({
                name,
                normalizedName: market.normalized_name ?? name,
                canonicalName: market.canonical_name ?? market.normalized_name ?? name,
                scannedPrice,
                fairPrice,
                showPrice: shouldShowPrice,
                reasoning: market.reasoning,
                ratioAssessment: payload.ratio_assessment ?? null,
                inputPriceSource: scannedPrice > 0 ? 'vision-detected' : 'none',
                translationSource: market.translation_source ?? 'none',
                canonicalSource: market.canonical_source ?? 'none',
                extractionSource: payload.item_extraction?.source ?? 'raw'
            });

            if (payload.vision_warning) {
                showNotification(`Vision fallback used: ${payload.vision_warning}`);
            } else {
                showNotification(payload.low_confidence ? 'Low confidence label. Please verify manually.' : `Image analysis complete: ${name}`);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Image analysis failed.';
            renderError(message);
            showNotification(message);
        } finally {
            setLoading(false);
            syncCheckButtonState();
        }
    }

    function syncPreviewState() {
        const preview = document.querySelector('.capture-preview');
        const video = byId('cameraPreview');
        const image = byId('captureSnapshot');
        if (!preview || !video || !image) return;
        preview.classList.toggle('has-media', video.classList.contains('show') || image.classList.contains('show'));

        const clearBtn = byId('clearCaptureBtn');
        if (clearBtn) {
            clearBtn.disabled = !capturedBlob;
        }
    }

    function clearCapturedImage() {
        const image = byId('captureSnapshot');
        const scanBtn = byId('scanCaptureBtn');
        if (image) {
            image.src = '';
            image.classList.remove('show');
        }
        if (scanBtn) {
            scanBtn.disabled = true;
        }

        if (capturedUrl) {
            URL.revokeObjectURL(capturedUrl);
            capturedUrl = '';
        }

        capturedBlob = null;
        syncPreviewState();
        syncCheckButtonState();
        showNotification('Captured image cleared.');
    }

    async function startCamera() {
        const video = byId('cameraPreview');
        const image = byId('captureSnapshot');
        const captureBtn = byId('captureBtn');
        if (!video || !image || !captureBtn) return;
        if (!navigator.mediaDevices?.getUserMedia) {
            showNotification('Camera is not supported on this browser.');
            return;
        }
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            showNotification('Camera requires HTTPS or localhost.');
            return;
        }

        try {
            if (!cameraStream) {
                const constraintOptions = [
                    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
                    { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
                    { video: true, audio: false }
                ];

                let streamError = null;
                for (const constraints of constraintOptions) {
                    try {
                        cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
                        break;
                    } catch (error) {
                        streamError = error;
                    }
                }

                if (!cameraStream) {
                    throw streamError || new Error('Unable to start camera stream.');
                }

                video.srcObject = cameraStream;
            }
            await video.play();
            video.classList.add('show');
            image.classList.remove('show');
            captureBtn.disabled = false;
            syncPreviewState();
            showNotification('Camera ready.');
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Unable to access camera.');
        }
    }

    async function captureFromCamera() {
        const video = byId('cameraPreview');
        const canvas = byId('captureCanvas');
        const image = byId('captureSnapshot');
        const scanBtn = byId('scanCaptureBtn');
        if (!video || !canvas || !image || !scanBtn) return;
        if (!cameraStream) {
            showNotification('Start camera first.');
            return;
        }
        if (!video.videoWidth || !video.videoHeight) {
            showNotification('Camera is initializing. Try capture again in 1-2 seconds.');
            return;
        }

        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            showNotification('Failed to capture camera frame.');
            return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob((output) => resolve(output), 'image/jpeg', 0.92));
        if (!blob) {
            showNotification('Failed to capture image.');
            return;
        }

        capturedBlob = blob;
        if (capturedUrl) URL.revokeObjectURL(capturedUrl);
        capturedUrl = URL.createObjectURL(blob);
        image.src = capturedUrl;
        image.classList.add('show');
        video.classList.remove('show');
        scanBtn.disabled = false;
        syncPreviewState();
        syncCheckButtonState();
        showNotification('Image captured.');
    }

    function stopCamera() {
        const video = byId('cameraPreview');
        if (cameraStream) {
            cameraStream.getTracks().forEach((track) => track.stop());
            cameraStream = null;
        }
        if (video) {
            video.pause();
            video.srcObject = null;
            video.classList.remove('show');
        }
        syncPreviewState();
    }

    window.switchMode = function(mode) {
        currentMode = mode === 'advanced' ? 'advanced' : 'basic';
        document.querySelectorAll('.mode-option').forEach((option) => {
            option.classList.toggle('active', option.textContent.trim().toLowerCase() === currentMode);
        });

        const badge = byId('modeBadge');
        const instruction = byId('instruction');
        const advanced = byId('advancedOptions');

        if (currentMode === 'advanced') {
            if (badge) {
                badge.textContent = 'ADVANCED CHECK (AI + Analytics)';
                badge.className = 'mode-badge advanced';
            }
            if (instruction) {
                instruction.innerHTML = '<span>Deep Dive Analysis</span> - region, date range, predictions, and competitor comparisons.';
            }
            if (advanced) advanced.classList.add('show');
        } else {
            if (badge) {
                badge.textContent = 'BASIC CHECK (AI)';
                badge.className = 'mode-badge';
            }
            if (instruction) {
                instruction.innerHTML = '<span>Instant Price Check</span> - paste a product title, type naturally, or scan with camera.';
            }
            if (advanced) advanced.classList.remove('show');
        }
    };

    window.fillExample = function(text) {
        const input = byId('productInput');
        if (input) input.value = text;
        updateMetadata(text);
        syncCheckButtonState();
        showNotification('Example loaded.');
    };

    function wireEvents() {
        const checkBtn = byId('checkPriceBtn');
        const input = byId('productInput');
        const startBtn = byId('startCameraBtn');
        const captureBtn = byId('captureBtn');
        const scanBtn = byId('scanCaptureBtn');
        const clearCaptureBtn = byId('clearCaptureBtn');
        const upload = byId('imageUploadInput');
        const voiceBtn = byId('voiceInputBtn');
        const voiceLanguage = byId('voiceLanguage');

        if (checkBtn) checkBtn.addEventListener('click', analyzeCurrentInput);
        if (input) {
            input.addEventListener('input', () => {
                updateMetadata(input.value);
                syncCheckButtonState();
            });
            input.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    analyzeCurrentInput();
                }
            });
        }

        if (startBtn) startBtn.addEventListener('click', startCamera);
        if (captureBtn) captureBtn.addEventListener('click', captureFromCamera);
        if (scanBtn) {
            scanBtn.addEventListener('click', () => {
                if (!capturedBlob) {
                    showNotification('Capture an image first.');
                    return;
                }
                const filename =
                    capturedBlob instanceof File && capturedBlob.name
                        ? capturedBlob.name
                        : CAMERA_FILE_NAME;
                analyzeImageBlob(capturedBlob, filename);
            });
        }
        if (clearCaptureBtn) {
            clearCaptureBtn.addEventListener('click', clearCapturedImage);
        }
        if (upload) {
            upload.addEventListener('change', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement) || !target.files?.length) return;
                const file = target.files[0];
                const snapshot = byId('captureSnapshot');
                const video = byId('cameraPreview');
                const scanCaptureBtn = byId('scanCaptureBtn');

                capturedBlob = file;
                if (capturedUrl) {
                    URL.revokeObjectURL(capturedUrl);
                }
                capturedUrl = URL.createObjectURL(file);

                if (snapshot) {
                    snapshot.src = capturedUrl;
                    snapshot.classList.add('show');
                }
                if (video) {
                    video.classList.remove('show');
                }
                if (scanCaptureBtn) {
                    scanCaptureBtn.disabled = false;
                }

                syncPreviewState();
                syncCheckButtonState();
                showNotification(`Image loaded: ${file.name}`);
                target.value = '';
            });
        }

        if (voiceBtn) {
            const audioCaptureAvailable = supportsAudioCapture();
            const speechRecognitionAvailable = Boolean(SpeechRecognitionCtor);
            if (!audioCaptureAvailable && !speechRecognitionAvailable) {
                voiceBtn.disabled = true;
                setVoiceStatus('Voice input is not supported in this browser.', false);
            } else {
                setVoiceStatus('Voice idle', false);
                voiceBtn.addEventListener('click', () => {
                    if (voiceProcessing) return;

                    if (speechRecognitionAvailable) {
                        if (voiceListening) stopVoiceInput();
                        else startVoiceInput();
                        return;
                    }

                    if (voiceMediaRecorder && voiceMediaRecorder.state !== 'inactive') {
                        stopAudioRecording();
                    } else {
                        startAudioRecording();
                    }
                });
            }
        }

        if (voiceLanguage) {
            voiceLanguage.addEventListener('change', () => {
                if (voiceRecognition && voiceListening) {
                    stopVoiceInput();
                    setTimeout(() => {
                        startVoiceInput();
                    }, 180);
                }
            });
        }

        window.addEventListener('beforeunload', () => {
            stopCamera();
            stopVoiceInput();
            clearVoiceMediaStream();
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
        });

        syncCheckButtonState();
    }

    createStars();
    initHamburger();
    wireEvents();
    window.switchMode('basic');
    syncPreviewState();
    window.showNotification = showNotification;
})();
