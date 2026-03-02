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
