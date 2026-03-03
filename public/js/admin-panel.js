(function() {
    'use strict';

    const SETTINGS_STORAGE_KEY = 'prism_admin_settings_v2';
    const TAB_ORDER = ['dashboard', 'users', 'products', 'prices', 'alerts', 'reports', 'settings'];

    const state = {
        products: [],
        analytics: null,
        stats: null,
        resolvedAlerts: new Set()
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
            notification.style.animation = 'slideOut 0.2s';
            window.setTimeout(() => {
                notification.style.display = 'none';
                notification.style.animation = '';
            }, 220);
        }, 2000);
    };

    function parseJsonSafe(text) {
        try {
            return text ? JSON.parse(text) : {};
        } catch {
            return { message: text || 'Unexpected response' };
        }
    }

    async function fetchJson(url) {
        const response = await fetch(url);
        const body = parseJsonSafe(await response.text());
        if (!response.ok) {
            throw new Error(body.message || `Failed request: ${url}`);
        }
        return body;
    }

    async function sendJson(url, method, payload) {
        const response = await fetch(url, {
            method,
            headers: payload ? { 'Content-Type': 'application/json' } : undefined,
            body: payload ? JSON.stringify(payload) : undefined
        });
        const body = parseJsonSafe(await response.text());
        if (!response.ok) {
            throw new Error(body.message || `Failed request: ${method} ${url}`);
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

    function formatRelativeTime(timestamp) {
        const parsed = new Date(timestamp);
        if (Number.isNaN(parsed.getTime())) return 'Unknown time';

        const diffMs = Date.now() - parsed.getTime();
        const diffMinutes = Math.max(1, Math.floor(diffMs / 60000));
        if (diffMinutes < 60) return `${diffMinutes} min ago`;

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} hr ago`;

        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    }

    function alertKey(alert) {
        return `${alert.type}|${alert.product_name}|${alert.market_name}|${alert.created_at}`;
    }

    function getActiveAlerts() {
        const alerts = Array.isArray(state.analytics?.alerts) ? state.analytics.alerts : [];
        return alerts.filter((alert) => !state.resolvedAlerts.has(alertKey(alert)));
    }

    function safeText(value, fallback) {
        const text = String(value ?? '').trim();
        return text || fallback;
    }

    function toPercent(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return '0.00%';
        return `${amount.toFixed(2)}%`;
    }

    function updateStat(id, value) {
        const el = byId(id);
        if (!el) return;
        el.textContent = value;
    }

    function renderDashboard() {
        const totals = state.analytics?.totals || {};

        updateStat('dashboardTotalProducts', Number(totals.total_products || state.products.length || 0).toLocaleString());
        updateStat('dashboardTotalScans', Number(totals.total_scans || state.stats?.total_scans || 0).toLocaleString());
        updateStat('dashboardOverpricedReports', Number(totals.overpriced_reports || 0).toLocaleString());
        updateStat('dashboardAverageGap', toPercent(totals.avg_diff_percent || 0));

        const activityBody = byId('dashboardActivityBody');
        if (!activityBody) return;

        const alerts = getActiveAlerts().slice(0, 6);
        if (!alerts.length) {
            activityBody.innerHTML = '<tr><td colspan="4">No active alerts right now.</td></tr>';
            return;
        }

        activityBody.innerHTML = alerts
            .map((alert) => {
                const actor = safeText(alert.market_name, 'Market Feed');
                const action = `${safeText(alert.type, 'Alert')}: ${safeText(alert.product_name, 'Unknown Item')}`;
                const severityClass = alert.severity === 'critical' || alert.severity === 'high' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'good';
                const severityText = alert.severity.toUpperCase();
                return `
                    <tr>
                        <td>${actor}</td>
                        <td>${action}</td>
                        <td>${formatRelativeTime(alert.created_at)}</td>
                        <td><span class="status-badge ${severityClass}">${severityText}</span></td>
                    </tr>
                `;
            })
            .join('');
    }

    function populateCategoryFilter() {
        const filter = byId('productCategoryFilter');
        if (!filter) return;

        const currentValue = filter.value || 'ALL';
        const categories = [...new Set(state.products.map((item) => safeText(item.category, 'GENERAL')))].sort((a, b) => a.localeCompare(b));

        filter.innerHTML = ['<option value="ALL">All Categories</option>']
            .concat(categories.map((category) => `<option value="${category}">${category}</option>`))
            .join('');

        if (categories.includes(currentValue)) {
            filter.value = currentValue;
        }
    }

    function renderProducts() {
        const tableBody = byId('productsTableBody');
        if (!tableBody) return;

        const searchInput = byId('productSearchInput');
        const categoryFilter = byId('productCategoryFilter');
        const search = String(searchInput?.value || '').toLowerCase().trim();
        const selectedCategory = String(categoryFilter?.value || 'ALL');

        const rows = state.products
            .filter((product) => {
                const category = safeText(product.category, 'GENERAL');
                if (selectedCategory !== 'ALL' && category !== selectedCategory) {
                    return false;
                }

                if (!search) {
                    return true;
                }

                const haystack = [
                    safeText(product.catalog_code, ''),
                    safeText(product.name, ''),
                    category,
                    safeText(product.market_name, ''),
                    safeText(product.stall_name, ''),
                    safeText(product.region, '')
                ]
                    .join(' ')
                    .toLowerCase();

                return haystack.includes(search);
            })
            .sort((a, b) => {
                const categoryA = safeText(a.category, 'GENERAL');
                const categoryB = safeText(b.category, 'GENERAL');
                const byCategory = categoryA.localeCompare(categoryB);
                if (byCategory !== 0) return byCategory;
                return safeText(a.name, '').localeCompare(safeText(b.name, ''));
            });

        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="6">No products matched your filter.</td></tr>';
            return;
        }

        tableBody.innerHTML = rows
            .map((product) => {
                const srpPrice = Number(product.srp_price);
                const statusClass = Number.isFinite(srpPrice) && srpPrice > 0 ? 'good' : 'warning';
                const statusText = Number.isFinite(srpPrice) && srpPrice > 0 ? 'Priced' : 'Missing Price';

                return `
                    <tr>
                        <td>${safeText(product.catalog_code, safeText(product.id, 'N/A'))}</td>
                        <td>${safeText(product.name, 'Unknown')}</td>
                        <td>${safeText(product.category, 'GENERAL')}</td>
                        <td>${safeText(product.market_name, 'Unknown Market')} / ${safeText(product.stall_name, 'Unknown Stall')}</td>
                        <td>${formatMoney(product.srp_price)}</td>
                        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    </tr>
                `;
            })
            .join('');
    }

    function renderTrendChart() {
        const trendContainer = byId('adminTrendChart');
        if (!trendContainer) return;

        const monthly = Array.isArray(state.analytics?.monthly_report) ? state.analytics.monthly_report.slice(0, 8).reverse() : [];
        if (!monthly.length) {
            trendContainer.innerHTML = '<div class="trend-bar"><div class="trend-bar-label">No trend data</div></div>';
            return;
        }

        const maxDiff = Math.max(...monthly.map((row) => Math.abs(Number(row.avg_diff_percent || 0))), 1);
        trendContainer.innerHTML = monthly
            .map((row) => {
                const diff = Number(row.avg_diff_percent || 0);
                const height = Math.max(8, Math.round((Math.abs(diff) / maxDiff) * 82));
                const status = safeText(row.status, 'watch');
                return `
                    <div class="trend-bar ${status}">
                        <div class="trend-bar-value">${toPercent(diff)}</div>
                        <div class="trend-bar-fill" style="height:${height}px;"></div>
                        <div class="trend-bar-label">${safeText(row.month, '--').slice(2)}</div>
                    </div>
                `;
            })
            .join('');
    }

    function renderPriceMonitoring() {
        const totals = state.analytics?.totals || {};
        updateStat('monitorAverageDiff', toPercent(totals.avg_diff_percent || 0));
        updateStat('monitorOverpricedCount', Number(totals.overpriced_reports || 0).toLocaleString());
        updateStat('monitorDealCount', Number(totals.deal_reports || 0).toLocaleString());

        renderTrendChart();

        const anomaliesTableBody = byId('anomaliesTableBody');
        if (!anomaliesTableBody) return;

        const prioritized = getActiveAlerts().filter((alert) => alert.severity !== 'good').slice(0, 12);
        if (!prioritized.length) {
            anomaliesTableBody.innerHTML = '<tr><td colspan="6">No active anomalies found.</td></tr>';
            return;
        }

        anomaliesTableBody.innerHTML = prioritized
            .map((alert) => {
                const sign = Number(alert.difference_percent) >= 0 ? '+' : '-';
                return `
                    <tr>
                        <td>${safeText(alert.product_name, 'Unknown')}</td>
                        <td>${formatMoney(alert.scanned_price)}</td>
                        <td>${formatMoney(alert.srp_price)}</td>
                        <td class="trend-up">${sign}${Math.abs(Number(alert.difference_percent || 0)).toFixed(2)}%</td>
                        <td>${safeText(alert.market_name, 'Unknown Market')} / ${safeText(alert.stall_name, 'Unknown Stall')}</td>
                        <td><button class="action-btn" data-alert-key="${alertKey(alert)}">Acknowledge</button></td>
                    </tr>
                `;
            })
            .join('');
    }

    function renderAlerts() {
        const list = byId('alertsList');
        if (!list) return;

        const alerts = getActiveAlerts();
        if (!alerts.length) {
            list.innerHTML = '<div class="alert-item"><div style="flex:1">No active alerts.</div></div>';
            return;
        }

        list.innerHTML = alerts
            .map((alert) => {
                const typeLabel = safeText(alert.type, 'ALERT').replace(/_/g, ' ');
                const diff = Number(alert.difference_percent || 0);
                const sign = diff >= 0 ? '+' : '-';
                return `
                    <div class="alert-item ${safeText(alert.severity, 'warning')}">
                        <div style="flex:1">
                            <strong>${typeLabel}</strong> - ${safeText(alert.product_name, 'Unknown')}
                            <div style="color:#9a9a9a; margin-top:0.2rem; font-size:0.88rem;">
                                ${safeText(alert.market_name, 'Unknown Market')} / ${safeText(alert.stall_name, 'Unknown Stall')} | Difference: ${sign}${Math.abs(diff).toFixed(2)}% | ${formatRelativeTime(alert.created_at)}
                            </div>
                        </div>
                        <button class="action-btn" data-alert-key="${alertKey(alert)}">Acknowledge</button>
                    </div>
                `;
            })
            .join('');
    }

    function renderReports() {
        const tableBody = byId('monthlyReportBody');
        if (!tableBody) return;

        const rows = Array.isArray(state.analytics?.monthly_report) ? state.analytics.monthly_report : [];
        if (!rows.length) {
            tableBody.innerHTML = '<tr><td colspan="9">No monthly report data yet.</td></tr>';
            return;
        }

        tableBody.innerHTML = rows
            .map((row) => {
                const statusClass = row.status === 'bad' ? 'danger' : row.status === 'watch' ? 'warning' : 'good';
                const statusText = row.status === 'bad' ? 'Bad' : row.status === 'watch' ? 'Watch' : 'Good';
                return `
                    <tr>
                        <td>${safeText(row.month, '--')}</td>
                        <td>${Number(row.scan_count || 0).toLocaleString()}</td>
                        <td>${formatMoney(row.avg_scanned_price)}</td>
                        <td>${formatMoney(row.avg_srp_price)}</td>
                        <td>${toPercent(row.avg_diff_percent || 0)}</td>
                        <td>${Number(row.overpriced_count || 0).toLocaleString()}</td>
                        <td>${Number(row.deal_count || 0).toLocaleString()}</td>
                        <td>${Number(row.suspicious_count || 0).toLocaleString()}</td>
                        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    </tr>
                `;
            })
            .join('');
    }

    function renderAll() {
        populateCategoryFilter();
        renderDashboard();
        renderProducts();
        renderPriceMonitoring();
        renderAlerts();
        renderReports();
    }

    async function refreshAdminData() {
        const refreshButton = byId('refreshAdminDataBtn');
        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.textContent = 'Refreshing...';
        }

        try {
            const [products, analytics, stats] = await Promise.all([
                fetchJson('/api/admin/products'),
                fetchJson('/api/admin/analytics'),
                fetchJson('/api/admin/stats')
            ]);

            state.products = Array.isArray(products) ? products : [];
            state.analytics = analytics || null;
            state.stats = stats || null;

            renderAll();
            showNotification('Admin data refreshed.');
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Failed to refresh admin data.');
        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.textContent = 'Refresh Data';
            }
        }
    }

    async function wipeUserUploadedData() {
        const approved = window.confirm(
            'This will permanently remove user-uploaded products, ingestion data, and non-system price logs. Protected sample catalog rows will stay intact. Continue?'
        );
        if (!approved) {
            return;
        }

        const wipeButton = byId('wipeUserDataBtn');
        if (wipeButton) {
            wipeButton.disabled = true;
            wipeButton.textContent = 'Wiping...';
        }

        try {
            const result = await sendJson('/api/admin/data/user-uploaded', 'DELETE');
            state.resolvedAlerts.clear();
            await refreshAdminData();

            showNotification(
                `Wiped user data: ${Number(result.deleted_user_products || 0)} products, ${Number(result.deleted_price_logs || 0)} logs, ${Number(result.deleted_document_ingestions || 0)} ingestions.`
            );
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Failed to wipe user-uploaded data.');
        } finally {
            if (wipeButton) {
                wipeButton.disabled = false;
                wipeButton.textContent = 'Wipe User Uploaded Data';
            }
        }
    }

    function exportMonthlyReport() {
        const rows = Array.isArray(state.analytics?.monthly_report) ? state.analytics.monthly_report : [];
        if (!rows.length) {
            showNotification('No report rows available to export.');
            return;
        }

        const headers = [
            'month',
            'scan_count',
            'avg_scanned_price',
            'avg_srp_price',
            'avg_diff_percent',
            'overpriced_count',
            'deal_count',
            'suspicious_count',
            'status'
        ];

        const csvLines = [headers.join(',')];
        rows.forEach((row) => {
            const values = headers.map((header) => {
                const rawValue = row[header];
                const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
                return `"${value.replace(/"/g, '""')}"`;
            });
            csvLines.push(values.join(','));
        });

        const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `prism-monthly-report-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showNotification('Monthly report exported.');
    }

    function bindEvents() {
        const refreshButton = byId('refreshAdminDataBtn');
        const runMonitoringButton = byId('runMonitoringBtn');
        const wipeUserDataButton = byId('wipeUserDataBtn');
        const clearResolvedButton = byId('clearResolvedAlertsBtn');
        const downloadReportButton = byId('downloadReportBtn');
        const productSearch = byId('productSearchInput');
        const productCategoryFilter = byId('productCategoryFilter');

        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                refreshAdminData();
            });
        }

        if (runMonitoringButton) {
            runMonitoringButton.addEventListener('click', () => {
                refreshAdminData();
            });
        }

        if (wipeUserDataButton) {
            wipeUserDataButton.addEventListener('click', () => {
                wipeUserUploadedData();
            });
        }

        if (clearResolvedButton) {
            clearResolvedButton.addEventListener('click', () => {
                const beforeCount = state.resolvedAlerts.size;
                getActiveAlerts().forEach((alert) => state.resolvedAlerts.add(alertKey(alert)));
                renderDashboard();
                renderPriceMonitoring();
                renderAlerts();
                const cleared = state.resolvedAlerts.size - beforeCount;
                showNotification(cleared > 0 ? `Cleared ${cleared} alerts.` : 'No active alerts to clear.');
            });
        }

        if (downloadReportButton) {
            downloadReportButton.addEventListener('click', exportMonthlyReport);
        }

        if (productSearch) {
            productSearch.addEventListener('input', renderProducts);
        }

        if (productCategoryFilter) {
            productCategoryFilter.addEventListener('change', renderProducts);
        }

        document.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            const button = target.closest('button[data-alert-key]');
            if (!(button instanceof HTMLButtonElement)) return;

            const key = button.dataset.alertKey;
            if (!key) return;

            state.resolvedAlerts.add(key);
            renderDashboard();
            renderPriceMonitoring();
            renderAlerts();
            showNotification('Alert acknowledged.');
        });
    }

    function loadSettings() {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;

        try {
            const payload = JSON.parse(raw);
            if (!payload || typeof payload !== 'object') return;

            const form = document.querySelector('#section-settings form');
            if (!form) return;

            form.querySelectorAll('.form-control').forEach((field) => {
                const label = field.previousElementSibling;
                const key = label ? label.textContent.trim() : '';
                if (key && payload[key] !== undefined) {
                    field.value = payload[key];
                }
            });
        } catch {
            // Ignore stale settings.
        }
    }

    function saveSettings() {
        const form = document.querySelector('#section-settings form');
        if (!form) return;

        const payload = {};
        form.querySelectorAll('.form-control').forEach((field, index) => {
            const label = field.previousElementSibling;
            const key = label ? label.textContent.trim() : `field_${index}`;
            payload[key] = field.value;
        });

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
        showNotification('Settings saved.');
    }

    function bindSettingsSave() {
        const settingsSection = byId('section-settings');
        if (!settingsSection) return;

        const saveButton = settingsSection.querySelector('.btn-primary');
        if (saveButton) {
            saveButton.addEventListener('click', (event) => {
                event.preventDefault();
                saveSettings();
            });
        }
    }

    window.switchAdminTab = function(tab) {
        const normalized = TAB_ORDER.includes(tab) ? tab : 'dashboard';

        document.querySelectorAll('.admin-nav li').forEach((item, index) => {
            item.classList.toggle('active', TAB_ORDER[index] === normalized);
        });

        document.querySelectorAll('.admin-section').forEach((section) => {
            section.classList.remove('active');
        });

        const target = byId(`section-${normalized}`);
        if (target) {
            target.classList.add('active');
        }
    };

    createStars();
    initHamburger();
    bindEvents();
    bindSettingsSave();
    loadSettings();
    refreshAdminData();
})();
