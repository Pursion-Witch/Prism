(function() {
    'use strict';

    const RANGE_DATA = {
        today: {
            kpis: [
                { value: '48', trendClass: 'trend-up', trendValue: 'up 12%', trendText: 'vs yesterday', sublabel: 'Found in Metro Manila' },
                { value: '82', scoreOutOf100: true, trendClass: 'trend-down', trendValue: 'up 5%', trendText: 'from last week', sublabel: 'Presyong "Sakto" (Fair)' },
                { value: '1,240', trendClass: 'trend-down', trendValue: '+24 new', trendText: 'this month', sublabel: 'Supermarkets & Palengkes' },
                { value: '2.1M', trendClass: 'trend-up', trendValue: 'up 8.3%', trendText: 'vs yesterday', sublabel: 'Daily across PH' }
            ],
            overpricedCount: 48,
            overpricedContext: 'Items significantly above DTI SRP today',
            recentAlertsLabel: '12 new',
            trendLabel: 'Price Trend Index (24 Hours)',
            trendPoints: [62, 74, 81, 76, 84, 79, 88],
            trendPointPrices: [84, 86, 90, 89, 93, 91, 95],
            categoryValues: [85, 72, 68, 45, 38]
        },
        week: {
            kpis: [
                { value: '116', trendClass: 'trend-up', trendValue: 'up 9%', trendText: 'vs last week', sublabel: 'Concentrated in urban centers' },
                { value: '79', scoreOutOf100: true, trendClass: 'trend-up', trendValue: 'down 2%', trendText: 'from prior week', sublabel: 'Market slightly unstable' },
                { value: '1,286', trendClass: 'trend-down', trendValue: '+46 new', trendText: 'this week', sublabel: 'Expanded provincial coverage' },
                { value: '8.9M', trendClass: 'trend-up', trendValue: 'up 6.7%', trendText: 'week-over-week', sublabel: 'Nationwide weekly checks' }
            ],
            overpricedCount: 116,
            overpricedContext: 'Items significantly above DTI SRP this week',
            recentAlertsLabel: '31 new',
            trendLabel: 'Price Trend Index (7 Days)',
            trendPoints: [58, 63, 68, 72, 77, 83, 80],
            trendPointPrices: [82, 84, 86, 88, 90, 94, 92],
            categoryValues: [79, 76, 64, 49, 42]
        },
        month: {
            kpis: [
                { value: '402', trendClass: 'trend-up', trendValue: 'up 14%', trendText: 'vs last month', sublabel: 'High pressure in onions and meat' },
                { value: '76', scoreOutOf100: true, trendClass: 'trend-up', trendValue: 'down 4%', trendText: 'from previous month', sublabel: 'Consumer risk elevated' },
                { value: '1,355', trendClass: 'trend-down', trendValue: '+115 new', trendText: 'this month', sublabel: 'Added partner suppliers' },
                { value: '36.4M', trendClass: 'trend-up', trendValue: 'up 11.2%', trendText: 'month-over-month', sublabel: 'Monthly scan volume' }
            ],
            overpricedCount: 402,
            overpricedContext: 'Items significantly above DTI SRP this month',
            recentAlertsLabel: '95 new',
            trendLabel: 'Price Trend Index (30 Days)',
            trendPoints: [55, 60, 66, 70, 74, 79, 85],
            trendPointPrices: [80, 82, 84, 87, 89, 92, 96],
            categoryValues: [88, 81, 72, 58, 50]
        },
        quarter: {
            kpis: [
                { value: '1,074', trendClass: 'trend-up', trendValue: 'up 7%', trendText: 'vs last quarter', sublabel: 'Sustained food inflation pressure' },
                { value: '74', scoreOutOf100: true, trendClass: 'trend-up', trendValue: 'down 3%', trendText: 'from last quarter', sublabel: 'Interventions needed' },
                { value: '1,421', trendClass: 'trend-down', trendValue: '+188 new', trendText: 'this quarter', sublabel: 'Coverage expansion in Visayas' },
                { value: '108.2M', trendClass: 'trend-up', trendValue: 'up 9.5%', trendText: 'quarter-over-quarter', sublabel: 'Quarterly national checks' }
            ],
            overpricedCount: 1074,
            overpricedContext: 'Items significantly above DTI SRP this quarter',
            recentAlertsLabel: '214 new',
            trendLabel: 'Price Trend Index (Quarter)',
            trendPoints: [52, 57, 63, 68, 73, 79, 84],
            trendPointPrices: [78, 80, 83, 86, 89, 93, 97],
            categoryValues: [92, 85, 75, 63, 54]
        },
        year: {
            kpis: [
                { value: '4,892', trendClass: 'trend-up', trendValue: 'up 11%', trendText: 'vs last year', sublabel: 'Long-term inflation watchlist' },
                { value: '77', scoreOutOf100: true, trendClass: 'trend-down', trendValue: 'up 2%', trendText: 'from last year', sublabel: 'Year-end recovery trend' },
                { value: '1,580', trendClass: 'trend-down', trendValue: '+340 new', trendText: 'this year', sublabel: 'National supplier network growth' },
                { value: '438.7M', trendClass: 'trend-up', trendValue: 'up 15.1%', trendText: 'year-over-year', sublabel: 'Annual scan volume' }
            ],
            overpricedCount: 4892,
            overpricedContext: 'Items significantly above DTI SRP this year',
            recentAlertsLabel: '782 new',
            trendLabel: 'Price Trend Index (Year)',
            trendPoints: [48, 54, 60, 67, 72, 78, 83],
            trendPointPrices: [75, 78, 82, 85, 89, 93, 98],
            categoryValues: [95, 88, 79, 66, 58]
        }
    };

    const CATEGORY_LABELS = ['Rice', 'Meat', 'Veg', 'Oil', 'Canned'];
    let activeRange = 'today';

// Stars background

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';

        for (let i = 0; i < 180; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            s.style.cssText = `left:${Math.random()*100}%; top:${Math.random()*100}%; width:${Math.random()*3+1}px; height:${Math.random()*3+1}px; animation-delay:${Math.random()*3}s`;
            stars.appendChild(s);
        }
    }
    createStars();

// Hamburger menu

    const hamburger = document.getElementById('hamburgerBtn');
    const nav = document.getElementById('navLinks');

    if (hamburger && nav) {
        hamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            nav.classList.toggle('active');
        });

        document.querySelectorAll('.nav-links a').forEach((l) => {
            l.addEventListener('click', () => nav.classList.remove('active'));
        });

        document.addEventListener('click', (e) => {
            if (!hamburger.contains(e.target) && !nav.contains(e.target)) {
                nav.classList.remove('active');
            }
        });
    }

// Notification system

    window.showNotification = function(msg) {
        let n = document.getElementById('notification');
        if (!n) {
            n = document.createElement('div');
            n.id = 'notification';
            n.className = 'notification';
            document.body.appendChild(n);
        }
        n.textContent = msg;
        n.style.display = 'block';
        n.style.animation = 'slideIn 0.2s';

        if (n._timeout) {
            clearTimeout(n._timeout);
            clearTimeout(n._hideTimeout);
        }

        n._timeout = setTimeout(() => {
            n.style.animation = 'slideOut 0.25s';
            n._hideTimeout = setTimeout(() => {
                n.style.display = 'none';
                n.style.animation = '';
                delete n._timeout;
                delete n._hideTimeout;
            }, 250);
        }, 2000);
    };

// Date filter

    function setActiveRangeButton(range) {
        const labelByRange = {
            today: 'Today',
            week: 'This Week',
            month: 'This Month',
            quarter: 'This Quarter',
            year: 'This Year'
        };

        const targetLabel = labelByRange[range] || labelByRange.today;
        document.querySelectorAll('.date-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.textContent.trim() === targetLabel);
        });
    }

    function updateKpiCards(range) {
        const data = RANGE_DATA[range] || RANGE_DATA.today;
        const cards = document.querySelectorAll('.kpi-grid .kpi-card');

        cards.forEach((card, index) => {
            const item = data.kpis[index];
            if (!item) return;

            const valueEl = card.querySelector('.kpi-value');
            const trendEl = card.querySelector('.kpi-trend');
            const sublabelEl = card.querySelector('.kpi-sublabel');

            if (valueEl) {
                valueEl.innerHTML = item.scoreOutOf100
                    ? `${item.value}<small style="font-size:1.5rem; color:#888;">/100</small>`
                    : item.value;
            }

            if (trendEl) {
                trendEl.innerHTML = `<span class="${item.trendClass}">${item.trendValue}</span> ${item.trendText}`;
            }

            if (sublabelEl) {
                sublabelEl.textContent = item.sublabel;
            }
        });
    }

    function updateRangeLabels(range) {
        const data = RANGE_DATA[range] || RANGE_DATA.today;

        const overpricedCard = Array.from(document.querySelectorAll('.card')).find((card) => {
            const title = card.querySelector('.card-title');
            return !!title && title.textContent.includes('Most Overpriced');
        });

        if (overpricedCard) {
            const context = overpricedCard.querySelector('p');
            if (context) {
                context.textContent = data.overpricedContext;
            }

            const viewAll = overpricedCard.querySelector('.view-all');
            if (viewAll) {
                viewAll.textContent = `View All ${data.overpricedCount.toLocaleString()} DTI Price Alerts ->`;
            }
        }

        const alertsCard = Array.from(document.querySelectorAll('.card')).find((card) => {
            const title = card.querySelector('.card-title');
            return !!title && title.textContent.includes('Recent Price Alerts');
        });

        if (alertsCard) {
            const badge = alertsCard.querySelector('.card-title span:last-child');
            if (badge) {
                badge.textContent = data.recentAlertsLabel;
            }
        }

        const trendTitle = document.querySelector('.charts-row .chart-card h3');
        if (trendTitle) {
            trendTitle.innerHTML = `<span> </span> ${data.trendLabel}`;
        }
    }

    window.filterDate = function(range) {
        activeRange = RANGE_DATA[range] ? range : 'today';
        setActiveRangeButton(activeRange);
        updateKpiCards(activeRange);
        updateRangeLabels(activeRange);
        generateTrendPoints(activeRange);
        generateCategoryChart(activeRange);
        showNotification(`Showing data for: ${activeRange}`);
    };

// Generate trend graph points

    function generateTrendPoints(range) {
        const container = document.getElementById('trendPoints');
        if (!container) return;

        const data = RANGE_DATA[range] || RANGE_DATA.today;
        const points = data.trendPoints;
        const pointPrices = data.trendPointPrices;
        let html = '';

        for (let i = 0; i < points.length; i++) {
            const left = (i / (points.length - 1)) * 100;
            const bottom = points[i];
            const pointPrice = pointPrices[i];
            html += `<div class="point" style="left: ${left}%; bottom: ${bottom}px;" data-value="PHP ${pointPrice}" onclick="showNotification('Price: PHP ${pointPrice}')"></div>`;
        }
        container.innerHTML = html;
    }

// Generate category chart

    function generateCategoryChart(range) {
        const container = document.getElementById('categoryChart');
        if (!container) return;

        const data = RANGE_DATA[range] || RANGE_DATA.today;
        const values = data.categoryValues;

        let html = '';
        for (let i = 0; i < CATEGORY_LABELS.length; i++) {
            html += `
                <div class="bar-item">
                    <div class="bar" style="height: ${values[i]}px;" onclick="showNotification('${CATEGORY_LABELS[i]}: ${values[i]}k items')"></div>
                    <div class="bar-label">${CATEGORY_LABELS[i]}</div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    if (document.getElementById('trendPoints')) {
        generateTrendPoints(activeRange);
    }

    if (document.getElementById('categoryChart')) {
        generateCategoryChart(activeRange);
    }

    function setupInteractiveElements() {
        const interactiveSelectors = [
            '.overpriced-item',
            '.alert-item',
            '.supplier-item',
            '.heatmap-cell'
        ];

        interactiveSelectors.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                el.removeEventListener('click', handleInteractiveClick);
                el.addEventListener('click', handleInteractiveClick);
            });
        });
    }

    function handleInteractiveClick() {
        const text = this.innerText.slice(0, 40);
        showNotification(text + '...');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupInteractiveElements);
    } else {
        setupInteractiveElements();
    }

// Refresh data simulation

    const refreshInterval = setInterval(() => {
        updateKpiCards(activeRange);
        updateRangeLabels(activeRange);
        generateTrendPoints(activeRange);
        generateCategoryChart(activeRange);
    }, 30000);

    window.addEventListener('beforeunload', () => {
        clearInterval(refreshInterval);
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (document.getElementById('trendPoints')) {
                generateTrendPoints(activeRange);
            }
            if (document.getElementById('categoryChart')) {
                generateCategoryChart(activeRange);
            }
        }, 250);
    });

    window.filterDate('today');
})();
