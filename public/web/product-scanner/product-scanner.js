(function() {
    'use strict';

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';
        for (let i = 0; i < 180; i += 1) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(star);
        }
    }
    createStars();

    const hamburger = document.getElementById('hamburgerBtn');
    const nav = document.getElementById('navLinks');

    if (hamburger && nav) {
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

    const btt = document.querySelector('.back-to-top');
    if (btt) {
        window.addEventListener('scroll', () => {
            btt.style.display = window.scrollY > 600 ? 'block' : 'none';
        });
        btt.style.display = 'none';
    }

    window.showNotification = function(message) {
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.style.display = 'block';
        notification.style.animation = 'slideIn 0.2s';

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.25s';
            setTimeout(() => {
                notification.style.display = 'none';
                notification.style.animation = '';
            }, 250);
        }, 2000);
    };

    function formatMoney(value) {
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            maximumFractionDigits: 2
        }).format(value);
    }

    function detectMetadata(text) {
        const lowered = text.toLowerCase();

        const brand = lowered.includes('samsung')
            ? 'Samsung'
            : lowered.includes('bigas')
                ? 'NFA'
                : lowered.includes('dole')
                    ? 'Dole'
                    : lowered.includes('mangan')
                        ? 'Mangan Tzu'
                        : 'Generic';

        const location = lowered.includes('lazada')
            ? 'Lazada'
            : lowered.includes('shopee')
                ? 'Shopee'
                : lowered.includes('palengke')
                    ? 'Palengke'
                    : lowered.includes('sari-sari')
                        ? 'Sari-sari Store'
                        : 'Online';

        const language = lowered.includes('tagalog') || lowered.includes('bigas')
            ? 'Tagalog support'
            : 'English support';

        return { brand, location, language };
    }

    function parseAnalyzeInput(rawInput) {
        const input = rawInput.trim();
        if (!input) {
            return null;
        }

        const moneyMatches = [...input.matchAll(/(?:\u20B1|PHP)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/gi)];
        let priceToken = '';

        if (moneyMatches.length > 0) {
            priceToken = moneyMatches[moneyMatches.length - 1][1];
        } else {
            const numericMatches = [...input.matchAll(/([0-9][0-9,]*(?:\.[0-9]+)?)/g)];
            if (numericMatches.length === 0) {
                return null;
            }
            priceToken = numericMatches[numericMatches.length - 1][1];
        }

        const parsedPrice = Number(priceToken.replace(/,/g, ''));
        if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
            return null;
        }

        const escapedToken = priceToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const name = input
            .replace(/(?:\u20B1|PHP)\s*[0-9][0-9,]*(?:\.[0-9]+)?/gi, '')
            .replace(new RegExp(escapedToken, 'g'), '')
            .replace(/\/\s*[a-zA-Z]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const normalizedName = name || input;
        if (!/[a-zA-Z]/.test(normalizedName)) {
            return null;
        }

        return {
            name: normalizedName,
            price: Number(parsedPrice.toFixed(2))
        };
    }

    function setLoadingState(isLoading) {
        const button = document.getElementById('checkPriceBtn');
        if (!button) return;

        button.disabled = isLoading;
        button.textContent = isLoading ? 'ANALYZING...' : 'CHECK PRICE NOW';
    }

    async function analyzeImage(file) {
        const formData = new FormData();
        formData.append('image', file);

        const res = await fetch('/api/analyze-image', {
            method: 'POST',
            body: formData
        });

        const payload = await res.json();
        if (!res.ok) {
            throw new Error(payload.message || 'Failed to analyze image.');
        }

        return payload;
    }

    window.analyzeImage = analyzeImage;

    let currentMode = 'basic';

    window.switchMode = function(mode, event) {
        currentMode = mode;

        document.querySelectorAll('.mode-option').forEach((option) => option.classList.remove('active'));
        if (event && event.target) {
            event.target.classList.add('active');
        }

        const badge = document.getElementById('modeBadge');
        const instruction = document.getElementById('instruction');
        const advancedOptions = document.getElementById('advancedOptions');

        if (badge) {
            if (mode === 'basic') {
                badge.textContent = 'BASIC CHECK (AI)';
                badge.className = 'mode-badge';
                if (instruction) {
                    instruction.innerHTML = '<span>Instant Price Check</span> - paste a product title, or type naturally. AI detects the details.';
                }
                if (advancedOptions) {
                    advancedOptions.classList.remove('show');
                }
            } else {
                badge.textContent = 'ADVANCED CHECK (AI + Analytics)';
                badge.className = 'mode-badge advanced';
                if (instruction) {
                    instruction.innerHTML = '<span>Deep Dive Analysis</span> - region, date range, price predictions, and competitor comparisons.';
                }
                if (advancedOptions) {
                    advancedOptions.classList.add('show');
                }
            }
        }

        showNotification(`Switched to ${mode.toUpperCase()} mode`);
    };

    window.fillExample = function(text) {
        const productInput = document.getElementById('productInput');
        if (productInput) {
            productInput.value = text;
        }

        const metadata = detectMetadata(text);
        const detectBrand = document.getElementById('detectBrand');
        const detectLocation = document.getElementById('detectLocation');
        const detectLanguage = document.getElementById('detectLanguage');

        if (detectBrand) detectBrand.textContent = metadata.brand;
        if (detectLocation) detectLocation.textContent = metadata.location;
        if (detectLanguage) detectLanguage.textContent = metadata.language;

        showNotification(`AI detected: ${metadata.brand}`);
    };

    function sanitizeExampleChipLabels() {
        document.querySelectorAll('.example-chip').forEach((chip) => {
            chip.textContent = chip.textContent
                .replace(/(?:\u20B1|₱)\s*[0-9][0-9,]*(?:\.[0-9]+)?(?:\s*\/\s*[a-zA-Z]+)?/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        });
    }

    function renderLoading(name) {
        const resultsSection = document.getElementById('resultsSection');
        const resultProduct = document.getElementById('resultProduct');
        const fairnessScore = document.getElementById('fairnessScore');
        const priceComparison = document.getElementById('priceComparison');
        const insightsBox = document.getElementById('insightsBox');
        const advancedResults = document.getElementById('advancedResults');

        if (resultProduct) resultProduct.textContent = `${name} Price Analysis`;
        if (fairnessScore) fairnessScore.textContent = '...';
        if (priceComparison) {
            priceComparison.innerHTML = '<div class="price-card"><div class="price-source">Status</div><div class="price-value">Loading</div><div class="price-note">Fetching fair price...</div></div>';
        }
        if (insightsBox) insightsBox.innerHTML = 'Analyzing with AI service...';
        if (advancedResults) advancedResults.style.display = 'none';
        if (resultsSection) resultsSection.classList.add('show');
    }

    function renderError(message) {
        const resultsSection = document.getElementById('resultsSection');
        const fairnessScore = document.getElementById('fairnessScore');
        const priceComparison = document.getElementById('priceComparison');
        const insightsBox = document.getElementById('insightsBox');
        const advancedResults = document.getElementById('advancedResults');

        if (fairnessScore) fairnessScore.textContent = '--';
        if (priceComparison) priceComparison.innerHTML = '';
        if (insightsBox) insightsBox.innerHTML = `<strong>Error:</strong> ${message}`;
        if (advancedResults) advancedResults.style.display = 'none';
        if (resultsSection) resultsSection.classList.add('show');
    }

    function showResults(name, inputPrice, fairPrice, anomalyScore) {
        const resultsSection = document.getElementById('resultsSection');
        const resultProduct = document.getElementById('resultProduct');
        const fairnessScore = document.getElementById('fairnessScore');
        const priceComparison = document.getElementById('priceComparison');
        const insightsBox = document.getElementById('insightsBox');
        const advancedResults = document.getElementById('advancedResults');

        if (!resultsSection) return;

        const anomalyPercent = Number(anomalyScore) * 100;
        const delta = Number(inputPrice) - Number(fairPrice);

        if (resultProduct) {
            resultProduct.textContent = `${name} Price Analysis`;
        }

        if (fairnessScore) {
            fairnessScore.textContent = `${anomalyPercent.toFixed(2)}%`;
        }

        if (priceComparison) {
            priceComparison.innerHTML = `
                <div class="price-card">
                    <div class="price-source">Submitted Price</div>
                    <div class="price-value">${formatMoney(Number(inputPrice))}</div>
                    <div class="price-note">User input</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Fair Price</div>
                    <div class="price-value">${formatMoney(Number(fairPrice))}</div>
                    <div class="price-note">AI and history adjusted</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Difference</div>
                    <div class="price-value">${delta >= 0 ? '+' : '-'}${formatMoney(Math.abs(delta))}</div>
                    <div class="price-note">${delta > 0 ? 'Above fair price' : delta < 0 ? 'Below fair price' : 'At fair price'}</div>
                </div>
            `;
        }

        if (insightsBox) {
            if (anomalyPercent >= 25) {
                insightsBox.innerHTML = `<strong>Alert:</strong> Anomaly score is <span style="color: #ff6b6b;">${anomalyPercent.toFixed(2)}%</span>. This price deviates heavily from fair value.`;
            } else if (anomalyPercent >= 10) {
                insightsBox.innerHTML = `<strong>Notice:</strong> Anomaly score is <span style="color: #ffaa33;">${anomalyPercent.toFixed(2)}%</span>. This price is moderately different from fair value.`;
            } else {
                insightsBox.innerHTML = `<strong>Good Deal:</strong> Anomaly score is <span style="color: #1ED760;">${anomalyPercent.toFixed(2)}%</span>. This price is close to fair value.`;
            }
        }

        if (currentMode === 'advanced' && advancedResults) {
            const regionSelect = document.getElementById('regionSelect');
            const dateRangeSelect = document.getElementById('dateRange');
            const historicalTrends = document.getElementById('historicalTrends');
            const pricePredictions = document.getElementById('pricePredictions');
            const competitorPrices = document.getElementById('competitorPrices');

            const region = regionSelect ? regionSelect.value : 'NCR';
            const dateRange = dateRangeSelect ? dateRangeSelect.value : 'Last 30 days';
            const includeTrends = historicalTrends ? historicalTrends.checked : false;

            let advancedHTML = `
                <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #262626;">
                    <h4 style="color: #1ED760; margin-bottom: 1rem;">Advanced Analytics</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                            <div style="color: #888;">Region</div>
                            <div style="font-size: 1.2rem;">${region}</div>
                        </div>
                        <div style="background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                            <div style="color: #888;">Date Range</div>
                            <div style="font-size: 1.2rem;">${dateRange}</div>
                        </div>
                    </div>
            `;

            if (includeTrends) {
                const trend = Math.random() > 0.5 ? 'upward' : 'downward';
                advancedHTML += `
                    <div style="margin-top: 1rem; background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                        <div style="color: #888;">Historical Trend (30 days)</div>
                        <div style="font-size: 1.2rem; color: ${trend === 'upward' ? '#ff6b6b' : '#1ED760'}">${trend === 'upward' ? 'Rising' : 'Falling'}</div>
                        <div style="color: #aaa; font-size: 0.9rem; margin-top: 0.5rem;">Average change: ${trend === 'upward' ? '+3.2%' : '-1.8%'}</div>
                    </div>
                `;
            }

            if (pricePredictions && pricePredictions.checked) {
                advancedHTML += `
                    <div style="margin-top: 1rem; background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                        <div style="color: #888;">AI Price Prediction (next 7 days)</div>
                        <div style="font-size: 1.2rem; color: #ffaa33;">${formatMoney(Number(fairPrice) * (0.95 + Math.random() * 0.1))}</div>
                        <div style="color: #aaa; font-size: 0.9rem;">Confidence: ${Math.floor(Math.random() * 20) + 75}%</div>
                    </div>
                `;
            }

            if (competitorPrices && competitorPrices.checked) {
                advancedHTML += `
                    <div style="margin-top: 1rem; background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                        <div style="color: #888;">Competitor Comparison</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
                            <div>Puregold: ${formatMoney(Number(fairPrice) * 0.95)}</div>
                            <div>SM: ${formatMoney(Number(fairPrice) * 1.05)}</div>
                            <div>Robinsons: ${formatMoney(Number(fairPrice) * 1.02)}</div>
                            <div>Local Palengke: ${formatMoney(Number(fairPrice) * 0.9)}</div>
                        </div>
                    </div>
                `;
            }

            advancedHTML += '</div>';
            advancedResults.innerHTML = advancedHTML;
            advancedResults.style.display = 'block';
        } else if (advancedResults) {
            advancedResults.style.display = 'none';
        }

        resultsSection.classList.add('show');
    }

    const checkPriceBtn = document.getElementById('checkPriceBtn');
    if (checkPriceBtn) {
        checkPriceBtn.addEventListener('click', async () => {
            const productInput = document.getElementById('productInput');
            if (!productInput) return;

            const parsedInput = parseAnalyzeInput(productInput.value);
            if (!parsedInput) {
                renderError('Invalid input. Example: Bigas NFA PHP 45/kilo');
                return;
            }

            const metadata = detectMetadata(parsedInput.name);
            const detectBrand = document.getElementById('detectBrand');
            const detectLocation = document.getElementById('detectLocation');
            const detectLanguage = document.getElementById('detectLanguage');

            if (detectBrand) detectBrand.textContent = metadata.brand;
            if (detectLocation) detectLocation.textContent = metadata.location;
            if (detectLanguage) detectLanguage.textContent = metadata.language;

            setLoadingState(true);
            renderLoading(parsedInput.name);

            try {
                const regionSelect = document.getElementById('regionSelect');
                const region = regionSelect ? regionSelect.value : 'Metro Manila';
                const response = await fetch('/api/analyze', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: parsedInput.name, price: parsedInput.price, region })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.message || 'Failed to analyze price.');
                }

                const fairPrice = Number(data.fairPrice ?? data.fair_market_value ?? 0);
                const anomalyScore = Number(
                    data.anomalyScore ??
                    (fairPrice > 0 ? Math.abs(parsedInput.price - fairPrice) / fairPrice : 0)
                );

                showResults(parsedInput.name, parsedInput.price, fairPrice, anomalyScore);
                showNotification(`${currentMode.toUpperCase()} analysis complete for: ${parsedInput.name.substring(0, 30)}...`);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Error contacting analysis service.';
                renderError(message);
                showNotification(message);
            } finally {
                setLoadingState(false);
            }
        });
    }

    function attachImageAnalyzeInput() {
        const imageInput = document.querySelector('input[type="file"][name="image"], input[type="file"]');
        if (!imageInput) return;

        imageInput.addEventListener('change', async (event) => {
            const target = event.target;
            if (!(target instanceof HTMLInputElement) || !target.files || target.files.length === 0) {
                return;
            }

            const file = target.files[0];
            setLoadingState(true);
            renderLoading(file.name);

            try {
                const payload = await analyzeImage(file);
                const market = payload.market_analysis || {};
                const vision = payload.vision || {};
                const detectedName = vision.detected_name || market.name || file.name;
                const scannedPrice = Number(market.scanned_price ?? vision.detected_price ?? 0);
                const fairPrice = Number(market.fair_market_value ?? 0);
                const anomalyScore = fairPrice > 0 ? Math.abs(scannedPrice - fairPrice) / fairPrice : 0;

                showResults(detectedName, scannedPrice, fairPrice, anomalyScore);

                if (payload.low_confidence) {
                    showNotification('Low confidence image detection. Verify before relying on this result.');
                } else {
                    showNotification(`Image analysis complete: ${detectedName}`);
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Image analysis failed.';
                renderError(message);
                showNotification(message);
            } finally {
                target.value = '';
                setLoadingState(false);
            }
        });
    }

    attachImageAnalyzeInput();
    sanitizeExampleChipLabels();

    window.switchMode('basic', { target: document.querySelector('.mode-option') });

    const productInput = document.getElementById('productInput');
    if (productInput) {
        productInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                const button = document.getElementById('checkPriceBtn');
                if (button) button.click();
            }
        });
    }

    function generateTrendGraph() {
        const trendGraph = document.getElementById('trendGraph');
        const trendLines = document.getElementById('trendLines');

        if (!trendGraph && !trendLines) return;

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const riceData = [120, 125, 123, 128, 130, 128, 132];
        const fuelData = [140, 145, 148, 152, 155, 158, 162];
        const meatData = [135, 134, 136, 138, 137, 139, 138];
        const vegData = [115, 118, 112, 120, 116, 122, 119];

        if (trendGraph) {
            let bars = '';
            for (let i = 0; i < days.length; i += 1) {
                bars += `
                    <div class="graph-bar-container">
                        <div class="graph-bar" style="height: ${riceData[i]}px;" data-value="Rice: ${riceData[i]}"></div>
                        <div class="graph-label">${days[i]}</div>
                    </div>
                `;
            }
            trendGraph.innerHTML = bars;
        }

        if (trendLines) {
            const points = ['rice', 'fuel', 'meat', 'veggies'];
            const datasets = [riceData, fuelData, meatData, vegData];

            let pointsHTML = '';
            for (let d = 0; d < datasets.length; d += 1) {
                for (let i = 0; i < datasets[d].length; i += 1) {
                    const x = (i / (datasets[d].length - 1)) * 100;
                    const y = 100 - ((datasets[d][i] - 110) / 60 * 100);
                    pointsHTML += `
                        <div class="point-group point-${points[d]}"
                             style="left: ${x}%; bottom: ${y}%;"
                             data-tooltip="${points[d].charAt(0).toUpperCase() + points[d].slice(1)}: ${datasets[d][i]}"></div>
                    `;
                }
            }
            trendLines.innerHTML = pointsHTML;
        }
    }

    generateTrendGraph();

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(generateTrendGraph, 250);
    });
})();
