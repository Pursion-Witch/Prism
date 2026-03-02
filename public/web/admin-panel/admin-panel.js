(function() {
    'use strict';

    const SETTINGS_STORAGE_KEY = 'prism_admin_settings_v1';

// Stars background

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';
        for (let i = 0; i < 180; i += 1) {
            const s = document.createElement('div');
            s.className = 'star';
            s.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(s);
        }
    }
    createStars();

// Hamburger menu

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

// Notification

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

// Tab switching

    const TAB_ORDER = ['dashboard', 'users', 'products', 'prices', 'alerts', 'reports', 'settings'];

    window.switchAdminTab = function(tab) {
        const normalizedTab = TAB_ORDER.includes(tab) ? tab : 'dashboard';

        document.querySelectorAll('.admin-nav li').forEach((li, index) => {
            li.classList.toggle('active', TAB_ORDER[index] === normalizedTab);
        });

        document.querySelectorAll('.admin-section').forEach((section) => {
            section.classList.remove('active');
        });

        const activeSection = document.getElementById(`section-${normalizedTab}`);
        if (activeSection) {
            activeSection.classList.add('active');
        }

        showNotification(`Switched to ${normalizedTab} section`);
    };

    function normalizeStatusBadge(badge, statusText) {
        if (!badge) return;

        const value = statusText.trim().toLowerCase();
        badge.textContent = statusText;

        if (value.includes('warning') || value.includes('pending') || value.includes('suspend') || value.includes('review')) {
            badge.classList.add('warning');
        } else {
            badge.classList.remove('warning');
        }
    }

    function appendUserRow() {
        const name = window.prompt('Enter user name:');
        if (!name) return;

        const email = window.prompt('Enter user email:');
        if (!email) return;

        const role = window.prompt('Enter role (Consumer, Supplier, Agency):', 'Consumer') || 'Consumer';

        const usersTable = document.querySelector('#section-users tbody');
        if (!usersTable) return;

        const nextId = usersTable.querySelectorAll('tr').length + 1;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#${String(nextId).padStart(3, '0')}</td>
            <td>${name}</td>
            <td>${email}</td>
            <td>${role}</td>
            <td><span class="status-badge">Active</span></td>
            <td><button class="action-btn">Edit</button><button class="action-btn">Suspend</button></td>
        `;

        usersTable.prepend(row);
        showNotification(`User ${name} added.`);
    }

    function appendProductRow() {
        const product = window.prompt('Enter product name:');
        if (!product) return;

        const category = window.prompt('Enter category:', 'GENERAL') || 'GENERAL';
        const supplier = window.prompt('Enter market and stall:', 'Carbon Public Market / Stall A-01') || 'Carbon Public Market / Stall A-01';
        const price = Number(window.prompt('Enter base price:', '0'));

        if (!Number.isFinite(price) || price <= 0) {
            showNotification('Invalid product price.');
            return;
        }

        const productsTable = document.querySelector('#section-products tbody');
        if (!productsTable) return;

        const nextId = productsTable.querySelectorAll('tr').length + 101;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>#P${nextId}</td>
            <td>${product}</td>
            <td>${category}</td>
            <td>${supplier}</td>
            <td>PHP ${price.toFixed(2)}</td>
            <td><span class="status-badge">Active</span></td>
            <td><button class="action-btn">Edit</button><button class="action-btn">Hide</button></td>
        `;

        productsTable.prepend(row);
        showNotification(`Product ${product} added.`);
    }

    function refreshDashboardStats() {
        const cards = document.querySelectorAll('#section-dashboard .stat-card .stat-value');
        cards.forEach((valueEl) => {
            const current = valueEl.textContent || '';
            if (current.includes(',')) {
                const parsed = Number(current.replace(/,/g, ''));
                if (Number.isFinite(parsed)) {
                    const drift = Math.floor(Math.random() * 25) - 12;
                    valueEl.textContent = (parsed + drift).toLocaleString();
                }
                return;
            }

            if (current.includes('%')) {
                const parsed = Number(current.replace('%', ''));
                if (Number.isFinite(parsed)) {
                    const drift = (Math.random() * 3 - 1.5).toFixed(1);
                    valueEl.textContent = `${Math.max(0, parsed + Number(drift)).toFixed(1)}%`;
                }
                return;
            }

            const parsed = Number(current);
            if (Number.isFinite(parsed)) {
                const drift = Math.floor(Math.random() * 8) - 4;
                valueEl.textContent = String(Math.max(0, parsed + drift));
            }
        });

        showNotification('Dashboard data refreshed.');
    }

    function runPriceAnalysis() {
        const anomalyRows = document.querySelectorAll('#section-prices tbody tr');
        anomalyRows.forEach((row) => {
            const diffCell = row.children[3];
            if (!diffCell) return;

            const nextDiff = Math.max(1, Math.floor(Math.random() * 45));
            diffCell.textContent = `+${nextDiff}%`;
            diffCell.classList.add('trend-up');
        });

        const summaryValues = document.querySelectorAll('#section-prices .stat-card .stat-value');
        if (summaryValues[0]) summaryValues[0].textContent = `${70 + Math.floor(Math.random() * 25)}%`;
        if (summaryValues[1]) summaryValues[1].textContent = String(30 + Math.floor(Math.random() * 40));
        if (summaryValues[2]) summaryValues[2].textContent = String(8 + Math.floor(Math.random() * 10));

        showNotification('Price analysis completed.');
    }

    function clearResolvedAlerts() {
        const alertRows = document.querySelectorAll('#section-alerts .alert-item');
        let removedCount = 0;

        alertRows.forEach((row) => {
            if (row.getAttribute('data-status') === 'resolved') {
                row.remove();
                removedCount += 1;
            }
        });

        if (removedCount === 0) {
            showNotification('No resolved alerts to clear.');
            return;
        }

        showNotification(`Cleared ${removedCount} resolved alerts.`);
    }

    function markAlertResolved(button, label) {
        const alertRow = button.closest('.alert-item');
        if (!alertRow) return;

        alertRow.setAttribute('data-status', 'resolved');
        button.disabled = true;
        button.textContent = 'Resolved';
        showNotification(`${label} marked as resolved.`);
    }

    function downloadReport() {
        const reportContent = [
            'PRISM Admin Report',
            `Generated: ${new Date().toISOString()}`,
            '',
            'Dashboard Snapshot',
            ...Array.from(document.querySelectorAll('#section-dashboard .stat-card')).map((card) => {
                const label = card.querySelector('.stat-label')?.textContent?.trim() || 'Metric';
                const value = card.querySelector('.stat-value')?.textContent?.trim() || '-';
                return `${label}: ${value}`;
            })
        ].join('\n');

        const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `prism-report-${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        showNotification('Report downloaded.');
    }

    function setReportWindow(windowLabel) {
        const container = document.querySelector('#section-reports .section-header + div');
        const subtitle = container?.querySelector('p');
        if (subtitle) {
            subtitle.textContent = `${windowLabel} report generated on ${new Date().toLocaleDateString()}`;
        }
        showNotification(`${windowLabel} report selected.`);
    }

    function saveSettings() {
        const form = document.querySelector('#section-settings form');
        if (!form) return;

        const payload = {};
        form.querySelectorAll('.form-control').forEach((field, index) => {
            const key = field.previousElementSibling?.textContent?.trim() || `field_${index}`;
            payload[key] = field.value;
        });

        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
        showNotification('Settings saved.');
    }

    function loadSettings() {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;

        try {
            const payload = JSON.parse(raw);
            const form = document.querySelector('#section-settings form');
            if (!form || typeof payload !== 'object' || payload === null) return;

            form.querySelectorAll('.form-control').forEach((field) => {
                const key = field.previousElementSibling?.textContent?.trim();
                if (key && payload[key] !== undefined) {
                    field.value = payload[key];
                }
            });
        } catch {
            // Ignore invalid persisted data.
        }
    }

    function regenerateApiKey() {
        const codeBlock = document.querySelector('#section-settings code');
        if (!codeBlock) return;

        const randomPart = Math.random().toString(36).slice(2, 18);
        codeBlock.textContent = `sk_live_prism_${randomPart}`;
        showNotification('API key regenerated.');
    }

    function handleActionButtonClick(button) {
        const label = button.textContent.trim().toLowerCase();
        const row = button.closest('tr');

        if (label === 'edit' && row) {
            const targetCell = row.children[1];
            if (!targetCell) return;
            const nextValue = window.prompt('Update value:', targetCell.textContent.trim());
            if (nextValue) {
                targetCell.textContent = nextValue.trim();
                showNotification('Row updated.');
            }
            return;
        }

        if (label === 'suspend' && row) {
            const badge = row.querySelector('.status-badge');
            normalizeStatusBadge(badge, 'Suspended');
            button.textContent = 'Activate';
            showNotification('User suspended.');
            return;
        }

        if (label === 'activate' && row) {
            const badge = row.querySelector('.status-badge');
            normalizeStatusBadge(badge, 'Active');
            button.textContent = 'Suspend';
            showNotification('User reactivated.');
            return;
        }

        if (label === 'approve' && row) {
            const badge = row.querySelector('.status-badge');
            normalizeStatusBadge(badge, 'Active');
            showNotification('Entry approved.');
            return;
        }

        if (label === 'reject' && row) {
            row.remove();
            showNotification('Entry rejected and removed.');
            return;
        }

        if (label === 'hide' && row) {
            row.style.display = 'none';
            showNotification('Product hidden from list.');
            return;
        }

        if (label === 'investigate' && row) {
            const badgeCell = row.children[3];
            if (badgeCell) {
                badgeCell.textContent = `${badgeCell.textContent.trim()} (under review)`;
            }
            button.textContent = 'Reviewing';
            button.disabled = true;
            showNotification('Investigation started.');
            return;
        }

        if (label === 'ignore' && row) {
            row.remove();
            showNotification('Anomaly ignored and removed.');
            return;
        }

        if (label === 'acknowledge') {
            markAlertResolved(button, 'Alert');
            return;
        }

        if (label === 'review') {
            markAlertResolved(button, 'Report');
            return;
        }

        if (label === 'sync') {
            markAlertResolved(button, 'Sync task');
            return;
        }

        if (label === 'regenerate') {
            regenerateApiKey();
        }
    }

    function wireButtons() {
        document.querySelectorAll('.btn-primary, .btn-secondary').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();

                if (button instanceof HTMLAnchorElement && button.dataset.navigate) {
                    return;
                }

                const label = button.textContent.trim().toLowerCase();

                if (label.includes('refresh data')) {
                    refreshDashboardStats();
                    return;
                }

                if (label.includes('add user')) {
                    appendUserRow();
                    return;
                }

                if (label.includes('add product')) {
                    appendProductRow();
                    return;
                }

                if (label.includes('run analysis')) {
                    runPriceAnalysis();
                    return;
                }

                if (label.includes('clear resolved')) {
                    clearResolvedAlerts();
                    return;
                }

                if (label.includes('download pdf')) {
                    downloadReport();
                    return;
                }

                if (label === 'weekly' || label === 'monthly' || label === 'quarterly') {
                    setReportWindow(label.charAt(0).toUpperCase() + label.slice(1));
                    return;
                }

                if (label.includes('save changes')) {
                    saveSettings();
                    return;
                }
            });
        });

        document.querySelectorAll('.action-btn').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                event.preventDefault();
                handleActionButtonClick(button);
            });
        });
    }

    wireButtons();
    loadSettings();
})();
