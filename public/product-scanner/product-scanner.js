(function () {
    'use strict';

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;
        stars.innerHTML = '';
        for (let i = 0; i < 180; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            s.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(s);
        }
    }
    createStars();

    const hamburger = document.getElementById('hamburgerBtn');
    const nav = document.getElementById('navLinks');
    if (hamburger && nav) {
        hamburger.addEventListener('click', function (event) {
            event.stopPropagation();
            nav.classList.toggle('active');
        });

        document.querySelectorAll('.nav-links a').forEach(function (link) {
            link.addEventListener('click', function () {
                nav.classList.remove('active');
            });
        });

        document.addEventListener('click', function (event) {
            if (!hamburger.contains(event.target) && !nav.contains(event.target)) {
                nav.classList.remove('active');
            }
        });
    }

    const backToTop = document.querySelector('.back-to-top');
    if (backToTop) {
        window.addEventListener('scroll', function () {
            backToTop.style.display = window.scrollY > 600 ? 'block' : 'none';
        });
        backToTop.style.display = 'none';
    }

    window.showNotification = function (message) {
        let node = document.getElementById('notification');
        if (!node) {
            node = document.createElement('div');
            node.id = 'notification';
            node.className = 'notification';
            document.body.appendChild(node);
        }

        node.textContent = message;
        node.style.display = 'block';
        node.style.animation = 'slideIn 0.2s';
        setTimeout(function () {
            node.style.animation = 'slideOut 0.25s';
            setTimeout(function () {
                node.style.display = 'none';
                node.style.animation = '';
            }, 250);
        }, 2200);
    };

    let currentMode = 'basic';
    const CHART_REFRESH_MS = 60 * 1000;
    const CHART_DRIFT_MS = 20 * 1000;
    let chartRefreshTimer = null;
    let chartDriftTimer = null;
    let chartState = {
        rice: [120, 125, 123, 128, 130, 128, 132],
        fuel: [140, 145, 148, 152, 155, 158, 162],
        meat: [135, 134, 136, 138, 137, 139, 138],
        veggies: [115, 118, 112, 120, 116, 122, 119]
    };

    function setModeActive(mode) {
        document.querySelectorAll('.mode-option').forEach(function (option) {
            const label = (option.textContent || '').trim().toLowerCase();
            option.classList.toggle('active', label.indexOf(mode) >= 0);
        });
    }

    function updateModeUi(mode) {
        const badge = document.getElementById('modeBadge');
        const instruction = document.getElementById('instruction');
        const advancedOptions = document.getElementById('advancedOptions');

        if (badge) {
            if (mode === 'advanced') {
                badge.textContent = 'ADVANCED CHECK (AI + Analytics)';
                badge.className = 'mode-badge advanced';
            } else {
                badge.textContent = 'BASIC CHECK (AI)';
                badge.className = 'mode-badge';
            }
        }

        if (instruction) {
            instruction.innerHTML =
                mode === 'advanced'
                    ? '<span>Deep Dive Analysis</span> - region filters, alternatives, and AI risk assessment.'
                    : '<span>Instant Price Check</span> - type a product and get live AI-backed pricing.';
        }

        if (advancedOptions) {
            advancedOptions.classList.toggle('show', mode === 'advanced');
        }
    }

    window.switchMode = function (mode) {
        currentMode = mode === 'advanced' ? 'advanced' : 'basic';
        setModeActive(currentMode);
        updateModeUi(currentMode);
        showNotification(`Switched to ${currentMode.toUpperCase()} mode`);
    };

    function detectLanguage(input) {
        const lower = input.toLowerCase();
        if (/(bigas|palengke|sari-sari|presyo|kilo|tinda)/.test(lower)) {
            return 'Tagalog support';
        }
        return 'English support';
    }

    function updateAutoDetect(input, scannerResult) {
        const detectBrand = document.getElementById('detectBrand');
        const detectLocation = document.getElementById('detectLocation');
        const detectLanguageNode = document.getElementById('detectLanguage');

        const productName = scannerResult && typeof scannerResult.product === 'string' ? scannerResult.product : input;
        const firstToken = productName.trim().split(/\s+/)[0] || 'Generic';
        const firstAlternative =
            scannerResult &&
            Array.isArray(scannerResult.alternatives) &&
            scannerResult.alternatives.length > 0 &&
            scannerResult.alternatives[0] &&
            typeof scannerResult.alternatives[0].marketplace === 'string'
                ? scannerResult.alternatives[0].marketplace
                : 'National';

        if (detectBrand) detectBrand.textContent = firstToken;
        if (detectLocation) detectLocation.textContent = firstAlternative;
        if (detectLanguageNode) detectLanguageNode.textContent = detectLanguage(input);
    }

    function getAdvancedOptions() {
        const regionSelect = document.getElementById('regionSelect');
        const priceRange = document.getElementById('priceRange');
        const dateRange = document.getElementById('dateRange');
        const dataSources = document.getElementById('dataSources');
        const historicalTrends = document.getElementById('historicalTrends');
        const pricePredictions = document.getElementById('pricePredictions');
        const competitorPrices = document.getElementById('competitorPrices');

        return {
            region: regionSelect ? regionSelect.value : 'Metro Manila',
            priceRange: priceRange ? priceRange.value : '',
            dateRange: dateRange ? dateRange.value : 'Last 30 days',
            dataSources: dataSources ? dataSources.value : 'All Sources',
            includeHistoricalTrends: Boolean(historicalTrends && historicalTrends.checked),
            includePredictions: Boolean(pricePredictions && pricePredictions.checked),
            includeCompetitors: Boolean(competitorPrices && competitorPrices.checked)
        };
    }

    function formatPeso(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return 'PHP 0.00';
        }
        return `PHP ${numeric.toFixed(2)}`;
    }

    function renderResults(input, scannerResult, advancedOptions) {
        const resultsSection = document.getElementById('resultsSection');
        const resultProduct = document.getElementById('resultProduct');
        const fairnessScore = document.getElementById('fairnessScore');
        const priceComparison = document.getElementById('priceComparison');
        const insightsBox = document.getElementById('insightsBox');
        const advancedResults = document.getElementById('advancedResults');

        if (!resultsSection || !scannerResult) return;

        if (resultProduct) {
            resultProduct.textContent = `${scannerResult.product || input} Price Analysis`;
        }

        if (fairnessScore) {
            fairnessScore.textContent = `${scannerResult.fairnessScore || 0}/100`;
        }

        if (priceComparison) {
            priceComparison.innerHTML = `
                <div class="price-card">
                    <div class="price-source">DTI Baseline</div>
                    <div class="price-value">${formatPeso(scannerResult.dtiPrice)}</div>
                    <div class="price-note">Official reference</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Market Average</div>
                    <div class="price-value">${formatPeso(scannerResult.marketPrice)}</div>
                    <div class="price-note">${Number(scannerResult.diffPct) >= 0 ? 'Above baseline' : 'Below baseline'}</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Online Average</div>
                    <div class="price-value">${formatPeso(scannerResult.onlinePrice)}</div>
                    <div class="price-note">Live marketplace records</div>
                </div>
            `;
        }

        if (insightsBox) {
            const critical = scannerResult.critical || {};
            const ratioNote =
                Number(scannerResult.diffPct) >= 0
                    ? `${Number(scannerResult.diffPct).toFixed(1)}% above baseline`
                    : `${Math.abs(Number(scannerResult.diffPct)).toFixed(1)}% below baseline`;
            insightsBox.innerHTML = `
                <strong style="color:${critical.criticalColor || '#ffaa33'};">${critical.criticalLabel || 'Moderate'}:</strong>
                ${scannerResult.insights || 'No insight available.'}<br>
                <span>${scannerResult.narrative || ''}</span><br>
                <span>Difference: ${ratioNote}</span><br>
                <span>${critical.criticalMessage || ''}</span>
            `;
        }

        if (advancedResults) {
            if (currentMode === 'advanced') {
                const alternatives = Array.isArray(scannerResult.alternatives) ? scannerResult.alternatives : [];
                const alternativesHtml =
                    alternatives.length === 0
                        ? '<div>No alternatives found.</div>'
                        : alternatives
                              .map(function (item) {
                                  return `<div>${item.marketplace}: ${item.product} - ${formatPeso(item.price)} (${item.location})</div>`;
                              })
                              .join('');

                advancedResults.innerHTML = `
                    <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #262626;">
                        <h4 style="color: #1ED760; margin-bottom: 1rem;">Advanced Analytics</h4>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:1rem;">
                            <div style="background:#0a0a0a; padding:1rem; border-radius:16px;">
                                <div style="color:#888;">Region</div>
                                <div style="font-size:1.2rem;">${advancedOptions.region}</div>
                            </div>
                            <div style="background:#0a0a0a; padding:1rem; border-radius:16px;">
                                <div style="color:#888;">Date Range</div>
                                <div style="font-size:1.2rem;">${advancedOptions.dateRange}</div>
                            </div>
                        </div>
                        <div style="margin-top:1rem; background:#0a0a0a; padding:1rem; border-radius:16px;">
                            <div style="color:#888;">Data Source</div>
                            <div style="font-size:1.1rem;">${advancedOptions.dataSources}</div>
                        </div>
                        <div style="margin-top:1rem; background:#0a0a0a; padding:1rem; border-radius:16px;">
                            <div style="color:#888;">Critical Level</div>
                            <div style="font-size:1.2rem; color:${scannerResult.critical && scannerResult.critical.criticalColor ? scannerResult.critical.criticalColor : '#ffaa33'};">
                                ${scannerResult.critical && scannerResult.critical.criticalLabel ? scannerResult.critical.criticalLabel : 'Moderate'}
                            </div>
                        </div>
                        <div style="margin-top:1rem; background:#0a0a0a; padding:1rem; border-radius:16px;">
                            <div style="color:#888;">Best Alternatives</div>
                            <div style="display:grid; gap:0.4rem; margin-top:0.5rem;">${alternativesHtml}</div>
                        </div>
                    </div>
                `;
                advancedResults.style.display = 'block';
            } else {
                advancedResults.style.display = 'none';
            }
        }

        resultsSection.classList.add('show');
    }

    async function runScanner() {
        const productInput = document.getElementById('productInput');
        const checkPriceBtn = document.getElementById('checkPriceBtn');
        if (!productInput) return;

        const input = productInput.value.trim();
        if (!input) {
            showNotification('Please enter a product or paste a link');
            return;
        }

        const advancedOptions = getAdvancedOptions();
        if (checkPriceBtn) checkPriceBtn.disabled = true;

        try {
            const response = await fetch('/api/ai/product-scanner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: input,
                    mode: currentMode,
                    options: advancedOptions
                })
            });

            const data = await response.json().catch(function () { return {}; });
            const scannerResult = data && typeof data === 'object' && data.result ? data.result : data;
            if (!response.ok || !scannerResult || typeof scannerResult !== 'object') {
                const message = typeof data.message === 'string' ? data.message : 'Scanner request failed.';
                throw new Error(message);
            }

            updateAutoDetect(input, scannerResult);
            renderResults(input, scannerResult, advancedOptions);
            showNotification(`AI scan complete for: ${input.substring(0, 40)}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Scanner request failed.';
            showNotification(message);
        } finally {
            if (checkPriceBtn) checkPriceBtn.disabled = false;
        }
    }

    window.fillExample = function (text) {
        const productInput = document.getElementById('productInput');
        if (productInput) {
            productInput.value = text;
        }
        updateAutoDetect(text, null);
    };

    const checkPriceBtn = document.getElementById('checkPriceBtn');
    if (checkPriceBtn) {
        checkPriceBtn.addEventListener('click', function () {
            void runScanner();
        });
    }

    const productInput = document.getElementById('productInput');
    if (productInput) {
        productInput.addEventListener('keypress', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                void runScanner();
            }
        });
    }

    function normalizeSeries(values, fallback) {
        if (!Array.isArray(values) || values.length === 0) {
            return fallback.slice();
        }
        const numbers = values
            .map(function (value) {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : null;
            })
            .filter(function (value) {
                return value !== null;
            });
        return numbers.length > 0 ? numbers : fallback.slice();
    }

    function generateTrendGraph() {
        const trendGraph = document.getElementById('trendGraph');
        const trendLines = document.getElementById('trendLines');
        if (!trendGraph && !trendLines) return;

        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const riceData = chartState.rice;
        const fuelData = chartState.fuel;
        const meatData = chartState.meat;
        const vegData = chartState.veggies;

        if (trendGraph) {
            let bars = '';
            for (let i = 0; i < days.length; i++) {
                const value = Number(riceData[i] || 0);
                bars += `
                    <div class="graph-bar-container">
                        <div class="graph-bar" style="height: ${value}px;" data-value="Rice: ${value.toFixed(1)}"></div>
                        <div class="graph-label">${days[i]}</div>
                    </div>
                `;
            }
            trendGraph.innerHTML = bars;
        }

        if (trendLines) {
            const points = ['rice', 'fuel', 'meat', 'veggies'];
            const datasets = [riceData, fuelData, meatData, vegData];
            let pointsHtml = '';

            for (let d = 0; d < datasets.length; d++) {
                const values = datasets[d];
                const min = Math.min.apply(null, values);
                const max = Math.max.apply(null, values);
                const spread = Math.max(1, max - min);

                for (let i = 0; i < values.length; i++) {
                    const x = (i / Math.max(1, values.length - 1)) * 100;
                    const y = 10 + ((values[i] - min) / spread) * 75;
                    pointsHtml += `
                        <div class="point-group point-${points[d]}"
                             style="left:${x}%; bottom:${y}%;"
                             data-tooltip="${points[d].charAt(0).toUpperCase() + points[d].slice(1)}: ${Number(values[i]).toFixed(1)}"></div>
                    `;
                }
            }

            trendLines.innerHTML = pointsHtml;
        }
    }

    function applyChartDrift() {
        Object.keys(chartState).forEach(function (key) {
            chartState[key] = chartState[key].map(function (value) {
                const next = Number(value) + (Math.random() - 0.5) * 0.8;
                return Math.max(90, Math.min(180, Number(next.toFixed(2))));
            });
        });
        generateTrendGraph();
    }

    async function refreshChartFromLiveMetrics() {
        try {
            const response = await fetch('/api/live/metrics');
            if (!response.ok) {
                applyChartDrift();
                return;
            }
            const payload = await response.json();
            const varianceTrend = Array.isArray(payload && payload.chart && payload.chart.varianceTrend)
                ? payload.chart.varianceTrend.slice(-7).map(function (row) { return row.value; })
                : null;
            const fairnessTrend = Array.isArray(payload && payload.chart && payload.chart.fairnessTrend)
                ? payload.chart.fairnessTrend.slice(-7).map(function (row) { return row.value; })
                : null;
            const savingsTrend = Array.isArray(payload && payload.chart && payload.chart.savingsTrend)
                ? payload.chart.savingsTrend.slice(-7).map(function (row) { return row.value; })
                : null;

            chartState.rice = normalizeSeries(varianceTrend, chartState.rice).map(function (value) {
                return 100 + value * 0.6;
            });
            chartState.fuel = normalizeSeries(fairnessTrend, chartState.fuel).map(function (value) {
                return 100 + value * 0.65;
            });
            chartState.meat = normalizeSeries(savingsTrend, chartState.meat).map(function (value) {
                return 95 + Math.min(70, Number(value) / 50);
            });
            chartState.veggies = chartState.meat.map(function (value, index) {
                return value - 6 + (index % 2 === 0 ? 1.5 : -1.2);
            });
            generateTrendGraph();
        } catch (_error) {
            applyChartDrift();
        }
    }

    function startChartLoops() {
        if (chartRefreshTimer) clearInterval(chartRefreshTimer);
        if (chartDriftTimer) clearInterval(chartDriftTimer);
        chartRefreshTimer = setInterval(function () {
            void refreshChartFromLiveMetrics();
        }, CHART_REFRESH_MS);
        chartDriftTimer = setInterval(function () {
            applyChartDrift();
        }, CHART_DRIFT_MS);
    }

    generateTrendGraph();
    void refreshChartFromLiveMetrics();
    startChartLoops();

    let resizeTimeout;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(generateTrendGraph, 250);
    });

    window.addEventListener('beforeunload', function () {
        if (chartRefreshTimer) clearInterval(chartRefreshTimer);
        if (chartDriftTimer) clearInterval(chartDriftTimer);
    });

    window.switchMode('basic');
})();
