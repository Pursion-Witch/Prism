(function() {
    'use strict';

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
        
        document.querySelectorAll('.nav-links a').forEach(l => {
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
        
// Clear any existing timeout

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

    window.filterDate = function(range, event) {
        if (!event && arguments.length > 1) {
            event = arguments[1];
        }
        
        document.querySelectorAll('.date-btn').forEach(btn => btn.classList.remove('active'));
        
        if (event && event.target) {
            event.target.classList.add('active');
        } else {
            const buttons = document.querySelectorAll('.date-btn');
            for (let btn of buttons) {
                if (btn.textContent.includes(range)) {
                    btn.classList.add('active');
                    break;
                }
            }
        }
        
        showNotification(`Showing data for: ${range}`);
    };

// Generate trend graph points

    function generateTrendPoints() {
        const container = document.getElementById('trendPoints');
        if (!container) return;
        
        const points = [65, 72, 68, 85, 82, 78, 88];
        let html = '';
        
        for (let i = 0; i < points.length; i++) {
            const left = (i / (points.length - 1)) * 100;
            const bottom = points[i]; 
            const randomPrice = Math.floor(80 + Math.random() * 50);
            html += `<div class="point" style="left: ${left}%; bottom: ${bottom}px;" data-value="₱${randomPrice}" onclick="showNotification('Price: ₱${randomPrice}')"></div>`;
        }
        container.innerHTML = html;
    }

// Generate category chart

    function generateCategoryChart() {
        const container = document.getElementById('categoryChart');
        if (!container) return;
        
        const categories = ['Rice', 'Meat', 'Veg', 'Oil', 'Canned'];
        const values = [85, 72, 68, 45, 38];
        
        let html = '';
        for (let i = 0; i < categories.length; i++) {
            html += `
                <div class="bar-item">
                    <div class="bar" style="height: ${values[i]}px;" onclick="showNotification('${categories[i]}: ${values[i]}k items')"></div>
                    <div class="bar-label">${categories[i]}</div>
                </div>
            `;
        }
        container.innerHTML = html;
    }

    if (document.getElementById('trendPoints')) {
        generateTrendPoints();
    }
    
    if (document.getElementById('categoryChart')) {
        generateCategoryChart();
    }

    function setupInteractiveElements() {
        const interactiveSelectors = [
            '.overpriced-item', 
            '.alert-item', 
            '.supplier-item', 
            '.heatmap-cell'
        ];
        
        interactiveSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                el.removeEventListener('click', handleInteractiveClick);
                el.addEventListener('click', handleInteractiveClick);
            });
        });
    }

    function handleInteractiveClick() {
        const text = this.innerText.slice(0, 40);
        showNotification(text + '…');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupInteractiveElements);
    } else {
        setupInteractiveElements();
    }

// Refresh data simulation

    let refreshInterval = setInterval(() => {
        
// Update KPI values slightly for demo

        const kpiValues = document.querySelectorAll('.kpi-value');
        kpiValues.forEach(el => {
            if (el.innerText.includes('M')) return; 

            let val = parseFloat(el.innerText.replace(/[^0-9.-]/g, ''));
            
            if (!isNaN(val)) {
                const variation = (Math.random() * 2 - 1) * 0.5; 
                const newVal = (val + variation).toFixed(1);
                
                if (el.innerText.includes('₱')) {
                    el.innerText = '₱' + newVal;
                } else if (el.innerText.includes('%')) {
                    el.innerText = newVal + '%';
                } else {
                    el.innerText = newVal;
                }
            }
        });
    }, 30000);

    window.addEventListener('beforeunload', () => {
        clearInterval(refreshInterval);
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (document.getElementById('trendPoints')) {
                generateTrendPoints();
            }
            if (document.getElementById('categoryChart')) {
                generateCategoryChart();
            }
        }, 250);
    });

})();
