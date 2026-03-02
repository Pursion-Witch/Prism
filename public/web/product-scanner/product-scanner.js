(function() {
    'use strict';

    let currentMode = 'basic';
    let cameraStream = null;
    let capturedBlob = null;
    let capturedUrl = '';

    const CAMERA_FILE_NAME = 'camera-capture.jpg';
    const HIDE_PRICE_TOKENS = ['hide price', 'no price', 'without price', 'label only', 'identify only', 'name only'];

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

    function setLoading(isLoading) {
        const button = byId('checkPriceBtn');
        if (!button) return;
        button.disabled = isLoading;
        button.textContent = isLoading ? 'ANALYZING...' : 'CHECK PRICE NOW';
    }

    function renderLoading(name) {
        const title = byId('resultProduct');
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        if (title) title.textContent = `${name} Price Analysis`;
        if (score) score.textContent = '...';
        if (comparison) comparison.innerHTML = '<div class="price-card"><div class="price-source">Status</div><div class="price-value">Loading</div><div class="price-note">Running AI analysis</div></div>';
        if (insights) insights.textContent = 'Please wait...';
        if (results) results.classList.add('show');
    }

    function renderError(message) {
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        if (score) score.textContent = '--';
        if (comparison) comparison.innerHTML = '';
        if (insights) insights.innerHTML = `<strong>Error:</strong> ${message}`;
        if (results) results.classList.add('show');
    }

    function renderResults(payload) {
        const { name, scannedPrice, fairPrice, anomalyScore, showPrice, reasoning } = payload;
        const title = byId('resultProduct');
        const score = byId('fairnessScore');
        const comparison = byId('priceComparison');
        const insights = byId('insightsBox');
        const results = byId('resultsSection');
        if (!results) return;

        if (title) title.textContent = `${name} Price Analysis`;

        if (!showPrice) {
            if (score) score.textContent = 'LABEL';
            if (comparison) {
                comparison.innerHTML = `<div class="price-card"><div class="price-source">Detected Label</div><div class="price-value">${name}</div><div class="price-note">Price hidden by prompt</div></div>`;
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
        const anomalyPercent = hasFair ? Number(anomalyScore) * 100 : 0;

        if (score) score.textContent = hasFair ? `${anomalyPercent.toFixed(2)}%` : 'N/A';
        if (comparison) {
            comparison.innerHTML = `
                <div class="price-card">
                    <div class="price-source">Submitted Price</div>
                    <div class="price-value">${hasScanned ? formatMoney(scannedPrice) : 'Not detected'}</div>
                    <div class="price-note">Scanner or user input</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Fair Price</div>
                    <div class="price-value">${hasFair ? formatMoney(fairPrice) : 'Not available'}</div>
                    <div class="price-note">AI and market estimate</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Difference</div>
                    <div class="price-value">${hasScanned && hasFair ? `${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}` : 'Not available'}</div>
                    <div class="price-note">${hasScanned && hasFair ? (delta > 0 ? 'Above fair price' : delta < 0 ? 'Below fair price' : 'At fair price') : 'Need both prices'}</div>
                </div>
            `;
        }

        if (insights) {
            if (!hasFair) {
                insights.innerHTML = '<strong>Notice:</strong> Fair price is not available yet.';
            } else if (anomalyPercent >= 25) {
                insights.innerHTML = `<strong>Alert:</strong> Price differs by <span style="color:#ff6b6b;">${anomalyPercent.toFixed(2)}%</span>.`;
            } else if (anomalyPercent >= 10) {
                insights.innerHTML = `<strong>Notice:</strong> Price differs by <span style="color:#ffaa33;">${anomalyPercent.toFixed(2)}%</span>.`;
            } else {
                insights.innerHTML = `<strong>Good match:</strong> Price differs by <span style="color:#1ED760;">${anomalyPercent.toFixed(2)}%</span>.`;
            }
            if (reasoning) insights.innerHTML += `<br><br><strong>AI reasoning:</strong> ${reasoning}`;
        }

        results.classList.add('show');
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
                name: parsed.name,
                scannedPrice: Number(payload.scanned_price ?? parsed.price ?? 0),
                fairPrice: Number(payload.fairPrice ?? payload.fair_market_value ?? 0),
                anomalyScore: Number(payload.anomalyScore ?? 0),
                showPrice: payload.display?.show_price ?? showPriceRequest,
                reasoning: payload.reasoning
            });
            showNotification(`Analysis complete for ${parsed.name.substring(0, 40)}`);
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
            const name = vision.detected_name || market.name || 'Detected Product';
            const scannedPrice = Number(market.scanned_price ?? vision.detected_price ?? 0);
            const fairPrice = Number(market.fair_market_value ?? 0);
            const anomalyScore = fairPrice > 0 ? Math.abs(scannedPrice - fairPrice) / fairPrice : 0;
            const shouldShowPrice = payload.display?.show_price ?? showPriceRequest;

            const input = byId('productInput');
            if (input) {
                input.value = shouldShowPrice && scannedPrice > 0 ? `${name} PHP ${scannedPrice.toFixed(2)}` : name;
            }

            updateMetadata(name);
            renderResults({
                name,
                scannedPrice,
                fairPrice,
                anomalyScore,
                showPrice: shouldShowPrice,
                reasoning: market.reasoning
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
        }
    }

    function syncPreviewState() {
        const preview = document.querySelector('.capture-preview');
        const video = byId('cameraPreview');
        const image = byId('captureSnapshot');
        if (!preview || !video || !image) return;
        preview.classList.toggle('has-media', video.classList.contains('show') || image.classList.contains('show'));
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

        try {
            if (!cameraStream) {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
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
        showNotification('Example loaded.');
    };

    function wireEvents() {
        const checkBtn = byId('checkPriceBtn');
        const input = byId('productInput');
        const startBtn = byId('startCameraBtn');
        const captureBtn = byId('captureBtn');
        const scanBtn = byId('scanCaptureBtn');
        const upload = byId('imageUploadInput');

        if (checkBtn) checkBtn.addEventListener('click', analyzeTyped);
        if (input) {
            input.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    analyzeTyped();
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
                analyzeImageBlob(capturedBlob, CAMERA_FILE_NAME);
            });
        }
        if (upload) {
            upload.addEventListener('change', (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement) || !target.files?.length) return;
                const file = target.files[0];
                analyzeImageBlob(file, file.name).finally(() => {
                    target.value = '';
                });
            });
        }

        window.addEventListener('beforeunload', () => {
            stopCamera();
            if (capturedUrl) URL.revokeObjectURL(capturedUrl);
        });
    }

    createStars();
    initHamburger();
    wireEvents();
    window.switchMode('basic');
    syncPreviewState();
    window.showNotification = showNotification;
})();
