(function() {
    'use strict';

    const state = {
        analytics: null,
        products: [],
        activeRange: 'today'
    };

    function byId(id) {
        return document.getElementById(id);
    }

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

    window.showNotification = function(message) {
        let notification = byId('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.style.display = 'block';
        notification.style.animation = 'slideIn 0.2s';

        window.setTimeout(() => {
            notification.style.animation = 'slideOut 0.25s';
            window.setTimeout(() => {
                notification.style.display = 'none';
                notification.style.animation = '';
            }, 250);
        }, 2000);
    };

    function parseJsonSafe(raw) {
        try {
            return raw ? JSON.parse(raw) : {};
        } catch {
            return { message: raw || 'Unexpected response' };
        }
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        const body = parseJsonSafe(await response.text());
        if (!response.ok) {
            throw new Error(body.message || `Request failed: ${url}`);
        }
        return body;
    }

    function formatMoney(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount) || amount <= 0) return 'Not available';
        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            maximumFractionDigits: 2
        }).format(amount);
    }

    function toPercent(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '0.00%';
        return `${amount.toFixed(2)}%`;
    }

    function formatCompact(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '0';
        return new Intl.NumberFormat('en-PH', {
            notation: 'compact',
            maximumFractionDigits: 1
        }).format(amount);
    }

    function safeText(value, fallback) {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function setText(id, value) {
        const element = byId(id);
        if (!element) return;
        element.textContent = value;
    }

    function setActiveRangeButton(range) {
        const labelByRange = {
            today: 'Today',
            week: 'This Week',
            month: 'This Month',
            quarter: 'This Quarter',
            year: 'This Year'
        };

        const target = labelByRange[range] || labelByRange.today;
        document.querySelectorAll('.date-btn').forEach((button) => {
            button.classList.toggle('active', button.textContent.trim() === target);
        });
    }

    function getFairnessScore(totals) {
        const scans = Number(totals.total_scans || 0);
        if (!scans) return 0;

        const overpriced = Number(totals.overpriced_reports || 0);
        const deals = Number(totals.deal_reports || 0);
        const penalty = (overpriced / scans) * 120;
        const bonus = (deals / scans) * 40;
        const score = 100 - penalty + bonus;
        return Math.max(0, Math.min(100, Number(score.toFixed(1))));
    }

    function getFilteredTrendPoints() {
        const points = Array.isArray(state.analytics?.trend_points) ? state.analytics.trend_points : [];
        if (!points.length) return [];

        if (state.activeRange === 'today' || state.activeRange === 'week') {
            return points.slice(-7);
        }
        if (state.activeRange === 'month') {
            return points.slice(-6);
        }
        if (state.activeRange === 'quarter') {
            return points.slice(-9);
        }

        return points;
    }

    function renderKpis() {
        const totals = state.analytics?.totals || {};
        const fairnessScore = getFairnessScore(totals);

        setText('kpiOverpricedCount', Number(totals.overpriced_reports || 0).toLocaleString());
        const fairnessScoreEl = byId('kpiFairnessScore');
        if (fairnessScoreEl) {
            fairnessScoreEl.innerHTML = `${fairnessScore}<small style=\"font-size:1.5rem; color:#888;\">/100</small>`;
        }
        setText('kpiProductsTracked', Number(totals.total_products || state.products.length || 0).toLocaleString());
        setText('kpiScansLogged', formatCompact(totals.total_scans || 0));

        const avgGap = Number(totals.avg_diff_percent || 0);
        setText('kpiOverpricedSub', `${toPercent(avgGap)} average market gap`);
        setText('kpiFairnessSub', avgGap > 10 ? 'High inflation pressure' : avgGap > 4 ? 'Monitor pricing changes' : 'Stable market behavior');
        setText('kpiProductsSub', `${state.products.length.toLocaleString()} catalog records loaded`);
        setText('kpiScansSub', `Deals flagged: ${Number(totals.deal_reports || 0).toLocaleString()}`);
        setText('kpiOverpricedTrend', `${toPercent(avgGap)} average diff vs SRP`);
        setText('kpiFairnessTrend', `${Number(totals.overpriced_reports || 0).toLocaleString()} overpriced flags`);
        setText('kpiProductsTrend', `+${state.products.length.toLocaleString()} tracked items`);
        setText('kpiScansTrend', `${Number(totals.total_scans || 0).toLocaleString()} submitted checks`);
    }

    function renderTrendPoints() {
        const container = byId('trendPoints');
        if (!container) return;

        const points = getFilteredTrendPoints();
        if (!points.length) {
            container.innerHTML = '';
            return;
        }

        const values = points.map((point) => Number(point.value || 0));
        const minValue = Math.min(...values, 0);
        const maxValue = Math.max(...values, 1);
        const range = Math.max(1, maxValue - minValue);

        container.innerHTML = points
            .map((point, index) => {
                const left = points.length > 1 ? (index / (points.length - 1)) * 100 : 50;
                const normalized = (Number(point.value || 0) - minValue) / range;
                const bottom = Math.round(30 + normalized * 130);
                return `<div class="point" style="left:${left}%; bottom:${bottom}px;" data-value="${safeText(point.label, '--')}: ${toPercent(point.value || 0)}"></div>`;
            })
            .join('');
    }

    function renderCategoryChart() {
        const chart = byId('categoryChart');
        if (!chart) return;

        const categories = Array.isArray(state.analytics?.category_insights)
            ? state.analytics.category_insights.slice(0, 6)
            : [];

        if (!categories.length) {
            chart.innerHTML = '<div class="bar-item"><div class="bar" style="height:8px"></div><div class="bar-label">No Data</div></div>';
            return;
        }

        const maxCount = Math.max(...categories.map((item) => Number(item.scan_count || 0)), 1);
        chart.innerHTML = categories
            .map((item) => {
                const height = Math.max(8, Math.round((Number(item.scan_count || 0) / maxCount) * 165));
                return `
                    <div class="bar-item">
                        <div class="bar" style="height:${height}px" title="${safeText(item.category, 'GENERAL')}: ${Number(item.scan_count || 0).toLocaleString()} scans"></div>
                        <div class="bar-label">${safeText(item.category, 'GEN').slice(0, 8)}</div>
                    </div>
                `;
            })
            .join('');
    }

    function renderOverpricedList() {
        const container = byId('overpricedListContainer');
        const context = byId('overpricedContextText');
        const viewAll = byId('overpricedViewAll');
        if (!container) return;

        const alerts = Array.isArray(state.analytics?.alerts) ? state.analytics.alerts : [];
        const overpriced = alerts
            .filter((alert) => alert.type === 'OVERPRICED' || alert.type === 'MALICIOUS_SPIKE')
            .sort((a, b) => Number(b.difference_percent || 0) - Number(a.difference_percent || 0))
            .slice(0, 5);

        if (context) {
            context.textContent = overpriced.length
                ? 'Items significantly above listed SRP based on recent submissions.'
                : 'No severe overpriced alerts in the latest checks.';
        }

        if (!overpriced.length) {
            container.innerHTML = '<div class="overpriced-item"><div class="item-info"><h4>No critical overpriced entries</h4><div class="srp">Latest scans are within expected range.</div></div></div>';
            if (viewAll) viewAll.textContent = 'View All Alerts ->';
            return;
        }

        container.innerHTML = overpriced
            .map((item) => {
                const diff = Number(item.difference_percent || 0);
                const marketPrice = Number(item.scanned_price || 0);
                const srpPrice = Number(item.srp_price || 0);
                return `
                    <div class="overpriced-item">
                        <div class="item-info">
                            <h4>${safeText(item.product_name, 'Unknown')} <span style="color:#ff6b6b; font-size:0.8rem;">${Math.abs(diff).toFixed(2)}%</span></h4>
                            <div class="srp">SRP: ${formatMoney(srpPrice)} | Market: ${formatMoney(marketPrice)}</div>
                        </div>
                        <div class="item-change">
                            <div class="change-badge">+${formatMoney(Math.max(0, marketPrice - srpPrice))}</div>
                            <div class="market-price">${safeText(item.market_name, 'Market')}</div>
                        </div>
                    </div>
                `;
            })
            .join('');

        if (viewAll) {
            viewAll.textContent = `View All ${overpriced.length} Priority Alerts ->`;
        }
    }

    function renderRecentAlerts() {
        const container = byId('dashboardRecentAlerts');
        const badge = byId('dashboardRecentAlertsBadge');
        if (!container) return;

        const alerts = Array.isArray(state.analytics?.alerts) ? state.analytics.alerts : [];
        if (badge) {
            badge.textContent = `${alerts.length} new`;
        }

        if (!alerts.length) {
            container.innerHTML = '<div class="alert-item"><div class="alert-details"><div class="alert-title">No active alerts</div><div class="alert-meta">Market is stable for now.</div></div><div class="alert-action wait">Stable</div></div>';
            return;
        }

        container.innerHTML = alerts
            .slice(0, 4)
            .map((alert) => {
                const actionClass = alert.severity === 'good' ? 'alert-action' : 'alert-action wait';
                const actionText = alert.severity === 'good' ? 'Good Deal' : alert.severity === 'critical' ? 'Urgent' : 'Review';
                return `
                    <div class="alert-item">
                        <div class="alert-details">
                            <div class="alert-title">${safeText(alert.product_name, 'Unknown')} - ${formatMoney(alert.scanned_price)}</div>
                            <div class="alert-meta">@ ${safeText(alert.market_name, 'Unknown Market')} / ${safeText(alert.stall_name, 'Unknown Stall')} | ${toPercent(alert.difference_percent || 0)}</div>
                        </div>
                        <div class="${actionClass}">${actionText}</div>
                    </div>
                `;
            })
            .join('');
    }

    function renderCategoryLeaders() {
        const container = byId('dashboardCategoryLeaders');
        if (!container) return;

        const categories = Array.isArray(state.analytics?.category_insights)
            ? state.analytics.category_insights
                .map((item) => {
                    const scans = Math.max(1, Number(item.scan_count || 0));
                    const fair = Number(item.fair_count || 0) + Number(item.great_deal_count || 0) + Number(item.steal_count || 0);
                    const fairRatio = Math.max(0, Math.min(100, (fair / scans) * 100));
                    return { ...item, fairRatio };
                })
                .sort((a, b) => b.fairRatio - a.fairRatio)
                .slice(0, 4)
            : [];

        if (!categories.length) {
            container.innerHTML = '<div class="supplier-item"><div class="supplier-avatar">--</div><div class="supplier-info"><div class="supplier-name">No category data</div><div class="supplier-meta">Run more scans to populate this panel</div></div><div class="supplier-score">--</div></div>';
            return;
        }

        container.innerHTML = categories
            .map((item) => {
                const initials = safeText(item.category, 'GEN').slice(0, 2).toUpperCase();
                return `
                    <div class="supplier-item">
                        <div class="supplier-avatar">${initials}</div>
                        <div class="supplier-info">
                            <div class="supplier-name">${safeText(item.category, 'GENERAL')}</div>
                            <div class="supplier-meta">${Number(item.scan_count || 0).toLocaleString()} scans | ${Number(item.overpriced_count || 0).toLocaleString()} overpriced</div>
                        </div>
                        <div class="supplier-score">${Number(item.fairRatio).toFixed(0)}%</div>
                    </div>
                `;
            })
            .join('');
    }

    function renderTrendBars() {
        const container = byId('dashboardTrendBars');
        if (!container) return;

        const points = getFilteredTrendPoints().slice(-6);
        if (!points.length) {
            container.innerHTML = '<div style="flex:1; background:#1ED760; height:8px; border-radius:8px 8px 0 0;"></div>';
            return;
        }

        const max = Math.max(...points.map((point) => Math.abs(Number(point.value || 0))), 1);
        container.innerHTML = points
            .map((point) => {
                const value = Number(point.value || 0);
                const height = Math.max(12, Math.round((Math.abs(value) / max) * 90));
                const color = value > 10 ? '#ff6b6b' : value > 4 ? '#ffaa33' : '#1ED760';
                return `<div style="flex:1; background:${color}; height:${height}px; border-radius:8px 8px 0 0;"></div>`;
            })
            .join('');
    }

    function renderGoodDeals() {
        const container = byId('dashboardGoodDeals');
        if (!container) return;

        const deals = Array.isArray(state.analytics?.alerts)
            ? state.analytics.alerts
                .filter((alert) => alert.type === 'GOOD_DEAL')
                .sort((a, b) => Number(a.difference_percent || 0) - Number(b.difference_percent || 0))
                .slice(0, 4)
            : [];

        if (!deals.length) {
            container.innerHTML = '<div style="background:#0a0a0a; border-radius:24px; padding:1.2rem;"><div style="color:#1ED760; font-weight:600;">No highlighted deal yet</div><div style="font-size:1.2rem; font-weight:700; margin:0.5rem 0;">Stay tuned</div><div style="font-weight:600;">More user submissions needed</div></div>';
            return;
        }

        container.innerHTML = deals
            .map((deal) => {
                const savings = Math.max(0, Number(deal.srp_price || 0) - Number(deal.scanned_price || 0));
                return `
                    <div style="background:#0a0a0a; border-radius:24px; padding:1.2rem;">
                        <div style="color:#1ED760; font-weight:600;">${safeText(deal.market_name, 'Market')}</div>
                        <div style="font-size:2rem; font-weight:700; margin:0.5rem 0;">${formatMoney(deal.scanned_price)}</div>
                        <div style="font-weight:600;">${safeText(deal.product_name, 'Unknown')}</div>
                        <div style="color:#ffaa33; font-size:0.9rem;">Save ${formatMoney(savings)}</div>
                        <div style="color:#888; font-size:0.8rem; margin-top:0.5rem;">${safeText(deal.stall_name, 'Unknown Stall')}</div>
                    </div>
                `;
            })
            .join('');
    }

    function renderInsights() {
        const container = byId('dashboardInsights');
        if (!container) return;

        const monthly = Array.isArray(state.analytics?.monthly_report) ? state.analytics.monthly_report[0] : null;
        const categories = Array.isArray(state.analytics?.category_insights) ? state.analytics.category_insights : [];

        const topRiskCategory = categories
            .slice()
            .sort((a, b) => Number(b.overpriced_count || 0) - Number(a.overpriced_count || 0))[0];

        const topStableCategory = categories
            .slice()
            .sort((a, b) => {
                const aDiff = Math.abs(Number(a.avg_diff_percent || 0));
                const bDiff = Math.abs(Number(b.avg_diff_percent || 0));
                return aDiff - bDiff;
            })[0];

        const avgDiff = Number(monthly?.avg_diff_percent || 0);
        const suspicious = Number(monthly?.suspicious_count || 0);

        container.innerHTML = `
            <div style="background:#0a0a0a; border-radius:16px; padding:1rem; margin-bottom:1rem;">
                <div style="color:#1ED760; font-weight:600;">Price Pressure Insight</div>
                <p style="color:#ccc; margin:0.5rem 0;">Current monthly gap is ${toPercent(avgDiff)}. Highest risk category: ${safeText(topRiskCategory?.category, 'N/A')}.</p>
                <div style="color:#888; font-size:0.8rem;">Source: catalog + submitted scan logs</div>
            </div>
            <div style="background:#0a0a0a; border-radius:16px; padding:1rem;">
                <div style="color:#ffaa33; font-weight:600;">Quality Signal</div>
                <p style="color:#ccc; margin:0.5rem 0;">Suspicious submissions this month: ${suspicious.toLocaleString()}. Most stable category: ${safeText(topStableCategory?.category, 'N/A')}.</p>
                <div style="color:#888; font-size:0.8rem;">Lower suspicious values indicate cleaner user reports.</div>
            </div>
        `;
    }

    function renderAll() {
        renderKpis();
        renderTrendPoints();
        renderCategoryChart();
        renderOverpricedList();
        renderRecentAlerts();
        renderCategoryLeaders();
        renderTrendBars();
        renderGoodDeals();
        renderInsights();
    }

    async function loadData(showToast) {
        try {
            const [analytics, products] = await Promise.all([
                fetchJson('/api/admin/analytics'),
                fetchJson('/api/admin/products')
            ]);

            state.analytics = analytics || null;
            state.products = Array.isArray(products) ? products : [];
            renderAll();
            if (showToast) {
                showNotification('Dashboard refreshed with live catalog data.');
            }
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Failed to load dashboard data.');
        }
    }

    window.filterDate = function(range) {
        const allowed = new Set(['today', 'week', 'month', 'quarter', 'year']);
        state.activeRange = allowed.has(range) ? range : 'today';
        setActiveRangeButton(state.activeRange);
        renderAll();
        showNotification(`Showing ${state.activeRange} view`);
    };

    function bindInteractions() {
        const interactiveSelectors = ['.overpriced-item', '.alert-item', '.supplier-item', '.heatmap-cell', '.bar', '.point'];
        interactiveSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((element) => {
                element.addEventListener('click', () => {
                    const text = safeText(element.textContent, 'item').slice(0, 55);
                    showNotification(text);
                });
            });
        });
    }

    createStars();
    initHamburger();
    setActiveRangeButton(state.activeRange);
    loadData(false);

    const refreshTimer = window.setInterval(() => {
        loadData(false);
    }, 45000);

    window.addEventListener('beforeunload', () => {
        window.clearInterval(refreshTimer);
    });

    window.addEventListener('resize', () => {
        renderTrendPoints();
        renderCategoryChart();
        renderTrendBars();
    });

    setTimeout(bindInteractions, 500);
})();
