(function () {
    'use strict';

    const REFRESH_MS = 60 * 1000;
    const DRIFT_MS = 20 * 1000;

    let liveMetricsCache = null;
    let refreshTimer = null;
    let driftTimer = null;

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

        if (node._timeout) {
            clearTimeout(node._timeout);
        }
        if (node._hideTimeout) {
            clearTimeout(node._hideTimeout);
        }

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

    window.switchAdminTab = function (tab, explicitEvent) {
        const eventRef = explicitEvent || window.event;
        document.querySelectorAll('.admin-nav li').forEach(function (item) {
            item.classList.remove('active');
        });
        if (eventRef && eventRef.target) {
            eventRef.target.classList.add('active');
        } else {
            const candidate = Array.from(document.querySelectorAll('.admin-nav li')).find(function (item) {
                return item.textContent && item.textContent.toLowerCase().indexOf(tab.toLowerCase()) >= 0;
            });
            if (candidate) candidate.classList.add('active');
        }

        document.querySelectorAll('.admin-section').forEach(function (section) {
            section.classList.remove('active');
        });
        const target = document.getElementById(`section-${tab}`);
        if (target) {
            target.classList.add('active');
        }
    };

    function formatPeso(value) {
        const numeric = Number(value);
        return `PHP ${Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00'}`;
    }

    function formatDateTime(iso) {
        const parsed = Date.parse(iso || '');
        if (Number.isNaN(parsed)) return 'just now';
        return new Date(parsed).toLocaleString();
    }

    function setNumericElement(element, value, kind) {
        if (!element) return;
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return;

        element.dataset.liveBase = String(numeric);
        element.dataset.liveKind = kind;

        if (kind === 'percent') {
            element.textContent = `${numeric.toFixed(1)}%`;
            return;
        }
        if (kind === 'peso') {
            element.textContent = `PHP ${numeric.toFixed(2)}`;
            return;
        }
        element.textContent = String(Math.round(numeric));
    }

    function renderDashboard(snapshot, liveMetrics) {
        const statValues = document.querySelectorAll('#section-dashboard .stat-value');
        if (statValues.length >= 4) {
            setNumericElement(statValues[0], snapshot.metrics.totalUsers, 'count');
            setNumericElement(statValues[1], snapshot.metrics.activeSuppliers, 'count');
            setNumericElement(statValues[2], snapshot.metrics.productsTracked, 'count');
            setNumericElement(statValues[3], snapshot.metrics.openAlerts, 'count');
        }

        const activityBody = document.querySelector('#section-dashboard tbody');
        if (activityBody && Array.isArray(snapshot.recentActivity)) {
            const rows = snapshot.recentActivity.slice(0, 6).map(function (entry) {
                const status = String(entry.status || 'open');
                const isWarn = /warning|high|risk|pending/i.test(status);
                return `
                    <tr>
                        <td>${entry.actor || 'System'}</td>
                        <td>${entry.action || 'Update'}</td>
                        <td>${formatDateTime(entry.timestamp)}</td>
                        <td><span class="status-badge${isWarn ? ' warning' : ''}">${status}</span></td>
                    </tr>
                `;
            });
            activityBody.innerHTML = rows.join('');
        }

        const liveHint = document.querySelector('#section-dashboard .section-header h2');
        if (liveHint && liveMetrics) {
            liveHint.dataset.liveMetrics = liveMetrics.updatedAt || '';
        }
    }

    function renderProducts(snapshot) {
        const body = document.querySelector('#section-products tbody');
        if (!body || !Array.isArray(snapshot.products)) return;

        const rows = snapshot.products.slice(0, 14).map(function (product) {
            const warn = product.status === 'low-stock';
            return `
                <tr>
                    <td>${product.id}</td>
                    <td>${product.name}</td>
                    <td>${product.category}</td>
                    <td>${product.supplier}</td>
                    <td>${formatPeso(product.basePrice)}</td>
                    <td><span class="status-badge${warn ? ' warning' : ''}">${product.status}</span></td>
                    <td><button class="action-btn">Edit</button><button class="action-btn">Hide</button></td>
                </tr>
            `;
        });
        body.innerHTML = rows.join('');
    }

    function renderPriceMonitoring(snapshot) {
        const statValues = document.querySelectorAll('#section-prices .stat-value');
        if (statValues.length >= 3) {
            setNumericElement(statValues[0], snapshot.metrics.averageFairness, 'percent');
            setNumericElement(statValues[1], snapshot.metrics.flaggedListings, 'count');
            setNumericElement(statValues[2], snapshot.metrics.underpricedCount, 'count');
        }

        const body = document.querySelector('#section-prices tbody');
        if (!body || !Array.isArray(snapshot.priceMonitoring)) return;
        const anomalies = snapshot.priceMonitoring
            .slice()
            .sort(function (a, b) {
                return Math.abs(Number(b.differencePct || 0)) - Math.abs(Number(a.differencePct || 0));
            })
            .slice(0, 12);

        const rows = anomalies.map(function (row) {
            const diff = Number(row.differencePct || 0);
            const trendClass = diff >= 0 ? 'trend-up' : 'trend-down';
            const sign = diff >= 0 ? '+' : '';
            return `
                <tr>
                    <td>${row.item}</td>
                    <td>${formatPeso(row.observedPrice)}</td>
                    <td>${formatPeso(row.expectedPrice || row.observedPrice)}</td>
                    <td class="${trendClass}">${sign}${diff.toFixed(1)}%</td>
                    <td>${row.location || 'National'}</td>
                    <td><button class="action-btn">Investigate</button></td>
                </tr>
            `;
        });
        body.innerHTML = rows.join('');
    }

    function renderAlerts(snapshot) {
        const container = document.getElementById('section-alerts');
        if (!container || !Array.isArray(snapshot.alerts)) return;

        const existing = container.querySelectorAll('.alert-item');
        existing.forEach(function (node) {
            node.remove();
        });

        const rows = snapshot.alerts.slice(0, 6);
        rows.forEach(function (alert) {
            const node = document.createElement('div');
            node.className = 'alert-item';
            node.innerHTML = `
                <div style="flex:1">
                    <strong>${alert.title || 'Alert'}</strong> - ${alert.message || ''}
                </div>
                <button class="action-btn">${alert.status === 'resolved' ? 'Resolved' : 'Acknowledge'}</button>
            `;
            container.appendChild(node);
        });
    }

    function renderReports(snapshot) {
        const reportCard = document.querySelector('#section-reports .section-header + div h3');
        if (!reportCard || !Array.isArray(snapshot.reports) || snapshot.reports.length === 0) return;
        reportCard.textContent = snapshot.reports[0].title || 'Latest Report';
    }

    function applySubtleDrift() {
        const nodes = document.querySelectorAll('.stat-value[data-live-base]');
        nodes.forEach(function (node) {
            const base = Number(node.dataset.liveBase);
            if (!Number.isFinite(base)) return;

            const kind = node.dataset.liveKind || 'count';
            let drift = base;
            if (kind === 'count') {
                drift = base + (Math.random() - 0.5) * 0.6;
                node.textContent = String(Math.max(0, Math.round(drift)));
                return;
            }
            if (kind === 'percent') {
                drift = base + (Math.random() - 0.5) * 0.2;
                node.textContent = `${Math.max(0, drift).toFixed(1)}%`;
                return;
            }
            if (kind === 'peso') {
                drift = base + (Math.random() - 0.5) * 0.15;
                node.textContent = `PHP ${Math.max(0, drift).toFixed(2)}`;
            }
        });
    }

    async function fetchLiveData(showToast) {
        try {
            const [snapshotRes, metricsRes] = await Promise.all([
                fetch('/api/admin/snapshot'),
                fetch('/api/live/metrics')
            ]);

            if (!snapshotRes.ok) {
                throw new Error('Unable to load admin snapshot.');
            }
            const snapshot = await snapshotRes.json();

            let liveMetrics = null;
            if (metricsRes.ok) {
                liveMetrics = await metricsRes.json();
                liveMetricsCache = liveMetrics;
            }

            renderDashboard(snapshot, liveMetrics);
            renderProducts(snapshot);
            renderPriceMonitoring(snapshot);
            renderAlerts(snapshot);
            renderReports(snapshot);

            if (showToast) {
                showNotification('Admin data refreshed from live storage.');
            }
        } catch (error) {
            if (showToast) {
                const message = error instanceof Error ? error.message : 'Live refresh failed.';
                showNotification(message);
            }
        }
    }

    async function runMinuteTick() {
        try {
            const response = await fetch('/api/live/tick/run-now', { method: 'POST' });
            const data = await response.json().catch(function () { return {}; });
            if (!response.ok) {
                throw new Error(typeof data.message === 'string' ? data.message : 'Minute update failed.');
            }
            showNotification('Minute price tick completed.');
            await fetchLiveData(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Minute update failed.';
            showNotification(message);
        }
    }

    function setupActionButtons() {
        const refreshButton = Array.from(document.querySelectorAll('.btn-primary')).find(function (button) {
            return /refresh data/i.test(button.textContent || '');
        });
        if (refreshButton) {
            refreshButton.addEventListener('click', function (event) {
                event.preventDefault();
                void fetchLiveData(true);
            });
        }

        const runAnalysisButton = Array.from(document.querySelectorAll('.btn-primary')).find(function (button) {
            return /run analysis/i.test(button.textContent || '');
        });
        if (runAnalysisButton) {
            runAnalysisButton.addEventListener('click', function (event) {
                event.preventDefault();
                void runMinuteTick();
            });
        }
    }

    function startLiveLoops() {
        if (refreshTimer) clearInterval(refreshTimer);
        if (driftTimer) clearInterval(driftTimer);

        refreshTimer = setInterval(function () {
            void fetchLiveData(false);
        }, REFRESH_MS);

        driftTimer = setInterval(function () {
            applySubtleDrift();
        }, DRIFT_MS);
    }

    window.addEventListener('beforeunload', function () {
        if (refreshTimer) clearInterval(refreshTimer);
        if (driftTimer) clearInterval(driftTimer);
    });

    createStars();
    setupMenu();
    setupActionButtons();
    void fetchLiveData(false);
    startLiveLoops();
})();
