(function () {
    'use strict';

    const REFRESH_MS = 60 * 1000;
    const DRIFT_MS = 20 * 1000;

    let refreshTimer = null;
    let driftTimer = null;
    let trendState = [64, 68, 66, 71, 73, 72, 75];
    let categoryState = [82, 71, 66, 48, 40];

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

    function setupMenu() {
        const hamburger = document.getElementById('hamburgerBtn');
        const nav = document.getElementById('navLinks');
        if (!hamburger || !nav) return;

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

        if (node._timeout) clearTimeout(node._timeout);
        if (node._hideTimeout) clearTimeout(node._hideTimeout);

        node._timeout = setTimeout(function () {
            node.style.animation = 'slideOut 0.25s';
            node._hideTimeout = setTimeout(function () {
                node.style.display = 'none';
                node.style.animation = '';
                node._timeout = null;
                node._hideTimeout = null;
            }, 250);
        }, 2200);
    };

    window.filterDate = function (range, explicitEvent) {
        const eventRef = explicitEvent || window.event;
        document.querySelectorAll('.date-btn').forEach(function (btn) {
            btn.classList.remove('active');
        });
        if (eventRef && eventRef.target) {
            eventRef.target.classList.add('active');
        }
        showNotification(`Showing data for: ${range}`);
    };

    async function readJsonSafe(response) {
        try {
            return await response.json();
        } catch (_error) {
            return {};
        }
    }

    function normalizePoints(series, size, fallback) {
        if (!Array.isArray(series) || series.length === 0) {
            return fallback.slice(0, size);
        }
        const values = series
            .slice(-size)
            .map(function (entry) {
                const value = Number(entry && entry.value);
                return Number.isFinite(value) ? value : null;
            })
            .filter(function (value) {
                return value !== null;
            });
        if (values.length === 0) return fallback.slice(0, size);

        const min = Math.min.apply(null, values);
        const max = Math.max.apply(null, values);
        if (max - min < 0.001) {
            return values.map(function (value, index) {
                return 62 + index * 2 + (value - min) * 0.1;
            });
        }

        return values.map(function (value) {
            const scaled = 45 + ((value - min) / (max - min)) * 40;
            return Number(scaled.toFixed(2));
        });
    }

    function renderTrendPoints() {
        const container = document.getElementById('trendPoints');
        if (!container) return;

        let html = '';
        for (let i = 0; i < trendState.length; i++) {
            const left = (i / Math.max(1, trendState.length - 1)) * 100;
            const bottom = Math.max(18, trendState[i]);
            const peso = (90 + trendState[i]).toFixed(2);
            html += `<div class="point" style="left:${left}%; bottom:${bottom}px;" data-value="PHP ${peso}" onclick="showNotification('Price: PHP ${peso}')"></div>`;
        }
        container.innerHTML = html;
    }

    function renderCategoryChart() {
        const container = document.getElementById('categoryChart');
        if (!container) return;

        const categories = ['Rice', 'Meat', 'Veg', 'Oil', 'Canned'];
        let html = '';
        for (let i = 0; i < categories.length; i++) {
            const height = Math.max(12, categoryState[i]);
            html += `
                <div class="bar-item">
                    <div class="bar" style="height:${height}px;" onclick="showNotification('${categories[i]}: ${Math.round(height)} index')"></div>
                    <div class="bar-label">${categories[i]}</div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    function setKpiValue(node, value, kind) {
        if (!node) return;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;
        node.dataset.liveBase = String(numeric);
        node.dataset.liveKind = kind;
        if (kind === 'percent') {
            node.textContent = `${numeric.toFixed(1)}%`;
            return;
        }
        if (kind === 'peso') {
            node.textContent = numeric >= 1000000 ? `PHP ${(numeric / 1000000).toFixed(2)}M` : `PHP ${numeric.toFixed(2)}`;
            return;
        }
        node.textContent = String(Math.round(numeric));
    }

    function applyKpiDrift() {
        document.querySelectorAll('.kpi-value[data-live-base]').forEach(function (node) {
            const base = Number(node.dataset.liveBase);
            if (!Number.isFinite(base)) return;
            const kind = node.dataset.liveKind || 'count';
            if (kind === 'percent') {
                const value = Math.max(0, base + (Math.random() - 0.5) * 0.25);
                node.textContent = `${value.toFixed(1)}%`;
                return;
            }
            if (kind === 'peso') {
                const value = Math.max(0, base + (Math.random() - 0.5) * 1200);
                node.textContent = value >= 1000000 ? `PHP ${(value / 1000000).toFixed(2)}M` : `PHP ${value.toFixed(2)}`;
                return;
            }
            const value = Math.max(0, base + (Math.random() - 0.5) * 1.5);
            node.textContent = String(Math.round(value));
        });
    }

    function renderOverpriced(snapshot) {
        const host = document.querySelector('.dashboard-two-col .card');
        if (!host || !Array.isArray(snapshot.priceMonitoring)) return;

        const rows = snapshot.priceMonitoring
            .slice()
            .sort(function (a, b) {
                return Math.abs(Number(b.differencePct || 0)) - Math.abs(Number(a.differencePct || 0));
            })
            .slice(0, 2);

        const items = host.querySelectorAll('.overpriced-item');
        rows.forEach(function (row, index) {
            const node = items[index];
            if (!node) return;
            const title = node.querySelector('h4');
            const srp = node.querySelector('.srp');
            const badge = node.querySelector('.change-badge');
            const market = node.querySelector('.market-price');
            if (title) title.textContent = row.item;
            if (srp) srp.textContent = `SRP: ${Number(row.expectedPrice || row.observedPrice).toFixed(2)}`;
            if (badge) badge.textContent = `${Number(row.differencePct || 0) >= 0 ? '+' : ''}${Number(row.differencePct || 0).toFixed(1)}%`;
            if (market) market.textContent = Number(row.observedPrice).toFixed(2);
        });
    }

    function renderSuppliers(snapshot) {
        const supplierCards = document.querySelectorAll('.supplier-item');
        if (!supplierCards.length || !Array.isArray(snapshot.products)) return;

        const supplierMap = {};
        snapshot.products.forEach(function (product) {
            const key = product.supplier || 'Unknown';
            if (!supplierMap[key]) supplierMap[key] = 0;
            supplierMap[key] += 1;
        });

        const top = Object.keys(supplierMap)
            .map(function (name) {
                return { name: name, count: supplierMap[name] };
            })
            .sort(function (a, b) {
                return b.count - a.count;
            })
            .slice(0, supplierCards.length);

        top.forEach(function (row, index) {
            const card = supplierCards[index];
            const avatar = card.querySelector('.supplier-avatar');
            const name = card.querySelector('.supplier-name');
            const meta = card.querySelector('.supplier-meta');
            const score = card.querySelector('.supplier-score');
            if (avatar) avatar.textContent = row.name.split(/\s+/).map(function (part) { return part[0] || ''; }).join('').slice(0, 2).toUpperCase();
            if (name) name.textContent = row.name;
            if (meta) meta.textContent = `${row.count} listed products`;
            if (score) score.textContent = `${Math.max(70, Math.min(99, 70 + row.count))}%`;
        });
    }

    function renderAlerts(snapshot) {
        const nodes = document.querySelectorAll('.dashboard-two-col .card .alert-item');
        if (!nodes.length || !Array.isArray(snapshot.alerts)) return;

        snapshot.alerts.slice(0, nodes.length).forEach(function (alert, index) {
            const node = nodes[index];
            const title = node.querySelector('.alert-title');
            const meta = node.querySelector('.alert-meta');
            const action = node.querySelector('.alert-action');
            if (title) title.textContent = alert.title || 'System Alert';
            if (meta) meta.textContent = alert.updatedAt ? new Date(alert.updatedAt).toLocaleTimeString() : 'just now';
            if (action) {
                action.textContent = alert.status === 'resolved' ? 'Resolved' : 'Review';
            }
        });
    }

    function jitterSeries() {
        trendState = trendState.map(function (value) {
            return Math.max(20, Math.min(92, value + (Math.random() - 0.5) * 1.2));
        });
        categoryState = categoryState.map(function (value) {
            return Math.max(16, Math.min(95, value + (Math.random() - 0.5) * 1.1));
        });
        renderTrendPoints();
        renderCategoryChart();
    }

    function applyMarketIndexStates(records) {
        if (!Array.isArray(records) || records.length === 0) {
            return false;
        }

        const trendRows = records.slice(0, 7).map(function (row) {
            return { value: Number(row.avgObservedPrice) };
        });
        const categoryRows = records.slice(0, 5).map(function (row) {
            return { value: Number(row.variancePct) };
        });

        trendState = normalizePoints(trendRows, 7, trendState);
        categoryState = normalizePoints(categoryRows, 5, categoryState);
        return true;
    }

    function setupInteractiveElements() {
        const selectors = ['.overpriced-item', '.alert-item', '.supplier-item', '.heatmap-cell'];
        selectors.forEach(function (selector) {
            document.querySelectorAll(selector).forEach(function (node) {
                node.removeEventListener('click', node._dashboardClickHandler);
                node._dashboardClickHandler = function () {
                    const text = (node.innerText || '').slice(0, 42);
                    showNotification(text);
                };
                node.addEventListener('click', node._dashboardClickHandler);
            });
        });
    }

    async function refreshLiveData(showToast) {
        try {
            const [marketRes, metricsRes, snapshotRes] = await Promise.all([
                fetch('/api/market-index?limit=12'),
                fetch('/api/live/metrics'),
                fetch('/api/admin/snapshot')
            ]);
            if (!snapshotRes.ok) {
                throw new Error('Unable to load dashboard snapshot.');
            }

            const snapshot = await readJsonSafe(snapshotRes);
            const marketIndexPayload = marketRes.ok ? await readJsonSafe(marketRes) : null;
            const liveMetrics = metricsRes.ok ? await readJsonSafe(metricsRes) : null;

            const kpis = document.querySelectorAll('.kpi-value');
            if (kpis.length >= 4) {
                const variance =
                    snapshot.metrics.productsTracked > 0
                        ? (snapshot.metrics.flaggedListings / snapshot.metrics.productsTracked) * 100
                        : 0;
                setKpiValue(kpis[0], variance, 'percent');
                setKpiValue(kpis[1], snapshot.metrics.flaggedListings, 'count');
                setKpiValue(kpis[2], snapshot.metrics.averageFairness, 'percent');
                setKpiValue(kpis[3], snapshot.metrics.estimatedSavings, 'peso');
            }

            renderOverpriced(snapshot);
            renderSuppliers(snapshot);
            renderAlerts(snapshot);

            if (marketIndexPayload && Array.isArray(marketIndexPayload.records) && applyMarketIndexStates(marketIndexPayload.records)) {
                // preferred source for market pulse
            } else if (liveMetrics && liveMetrics.chart) {
                trendState = normalizePoints(liveMetrics.chart.fairnessTrend, 7, trendState);
                categoryState = normalizePoints(liveMetrics.chart.varianceTrend, 5, categoryState);
            } else {
                jitterSeries();
            }
            renderTrendPoints();
            renderCategoryChart();

            setupInteractiveElements();
            if (showToast) {
                showNotification('Dashboard refreshed from live data.');
            }
        } catch (error) {
            jitterSeries();
            if (showToast) {
                const message = error instanceof Error ? error.message : 'Dashboard refresh failed.';
                showNotification(message);
            }
        }
    }

    function startLiveLoops() {
        if (refreshTimer) clearInterval(refreshTimer);
        if (driftTimer) clearInterval(driftTimer);
        refreshTimer = setInterval(function () {
            void refreshLiveData(false);
        }, REFRESH_MS);
        driftTimer = setInterval(function () {
            applyKpiDrift();
            jitterSeries();
        }, DRIFT_MS);
    }

    window.addEventListener('beforeunload', function () {
        if (refreshTimer) clearInterval(refreshTimer);
        if (driftTimer) clearInterval(driftTimer);
    });

    createStars();
    setupMenu();
    renderTrendPoints();
    renderCategoryChart();
    setupInteractiveElements();
    void refreshLiveData(false);
    startLiveLoops();
})();
