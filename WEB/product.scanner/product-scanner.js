(function() {
    'use strict';

    // Stars background
    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;
        
        // Clear existing stars to prevent duplicates
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

    // Back to top
    const btt = document.querySelector('.back-to-top');
    if (btt) {
        window.addEventListener('scroll', () => { 
            btt.style.display = window.scrollY > 600 ? 'block' : 'none'; 
        });
        btt.style.display = 'none';
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
        
        setTimeout(() => {
            n.style.animation = 'slideOut 0.25s';
            setTimeout(() => { 
                n.style.display = 'none'; 
                n.style.animation = ''; 
            }, 250);
        }, 2000);
    };

    // Mode switching
    let currentMode = 'basic';
    
    window.switchMode = function(mode, event) {
        currentMode = mode;
        
        // Update toggle UI
        document.querySelectorAll('.mode-option').forEach(opt => opt.classList.remove('active'));
        if (event && event.target) {
            event.target.classList.add('active');
        }
        
        // Update badge and instruction
        const badge = document.getElementById('modeBadge');
        const instruction = document.getElementById('instruction');
        const advancedOptions = document.getElementById('advancedOptions');
        
        if (badge) {
            if (mode === 'basic') {
                badge.textContent = 'BASIC CHECK (AI)';
                badge.className = 'mode-badge';
                if (instruction) {
                    instruction.innerHTML = '<span>Instant Price Check</span> — paste a product title, or type naturally. AI detects the details.';
                }
                if (advancedOptions) {
                    advancedOptions.classList.remove('show');
                }
            } else {
                badge.textContent = 'ADVANCED CHECK (AI + Analytics)';
                badge.className = 'mode-badge advanced';
                if (instruction) {
                    instruction.innerHTML = '<span>Deep Dive Analysis</span> — region, date range, price predictions, and competitor comparisons.';
                }
                if (advancedOptions) {
                    advancedOptions.classList.add('show');
                }
            }
        }
        
        showNotification(`Switched to ${mode.toUpperCase()} mode`);
    };

    // Fill example chips
    window.fillExample = function(text) {
        const productInput = document.getElementById('productInput');
        if (productInput) {
            productInput.value = text;
        }
        
        // Auto-detect simulation
        const detectBrand = document.getElementById('detectBrand');
        const detectLocation = document.getElementById('detectLocation');
        const detectLanguage = document.getElementById('detectLanguage');
        
        if (detectBrand) {
            detectBrand.textContent = text.includes('Samsung') ? 'Samsung' : 
                                     (text.includes('Bigas') ? 'NFA' : 'Generic');
        }
        if (detectLocation) {
            detectLocation.textContent = text.includes('Lazada') ? 'Lazada' : 
                                        (text.includes('palengke') ? 'Palengke' : 'Online');
        }
        if (detectLanguage) {
            detectLanguage.textContent = text.includes('Bigas') ? 'Tagalog' : 'English';
        }
        
        showNotification('AI detected: ' + (detectBrand ? detectBrand.textContent : 'product'));
    };

    // Check price button
    const checkPriceBtn = document.getElementById('checkPriceBtn');
    if (checkPriceBtn) {
        checkPriceBtn.addEventListener('click', function() {
            const productInput = document.getElementById('productInput');
            if (!productInput) return;
            
            const input = productInput.value.trim();
            if (!input) {
                showNotification('Please enter a product or paste a link');
                return;
            }

            // Simulate AI detection
            let brand = 'Generic', location = 'Online', lang = 'English';
            const lowerInput = input.toLowerCase();
            
            if (lowerInput.includes('samsung')) brand = 'Samsung';
            else if (lowerInput.includes('bigas')) brand = 'NFA';
            else if (lowerInput.includes('dole')) brand = 'Dole';
            else if (lowerInput.includes('mangan')) brand = 'Mangan Tzu';
            
            if (lowerInput.includes('lazada')) location = 'Lazada';
            else if (lowerInput.includes('shopee')) location = 'Shopee';
            else if (lowerInput.includes('palengke')) location = 'Palengke';
            else if (lowerInput.includes('sari-sari')) location = 'Sari-sari Store';
            
            if (lowerInput.includes('tagalog') || lowerInput.includes('bigas')) lang = 'Tagalog';
            
            const detectBrand = document.getElementById('detectBrand');
            const detectLocation = document.getElementById('detectLocation');
            const detectLanguage = document.getElementById('detectLanguage');
            
            if (detectBrand) detectBrand.textContent = brand;
            if (detectLocation) detectLocation.textContent = location;
            if (detectLanguage) detectLanguage.textContent = lang + ' support';
            
            // Show results
            showResults(input, brand, location);
            showNotification(`${currentMode.toUpperCase()} analysis complete for: ${input.substring(0,30)}...`);
        });
    }

    // Show results
    function showResults(input, brand, location) {
        const resultsSection = document.getElementById('resultsSection');
        const resultProduct = document.getElementById('resultProduct');
        const fairnessScore = document.getElementById('fairnessScore');
        const priceComparison = document.getElementById('priceComparison');
        const insightsBox = document.getElementById('insightsBox');
        const advancedResults = document.getElementById('advancedResults');

        if (!resultsSection) return;

        // Set product name
        if (resultProduct) {
            resultProduct.textContent = `${brand} Price Analysis`;
        }

        // Random fairness score
        const score = Math.floor(Math.random() * 30) + 65; // 65-95
        if (fairnessScore) {
            fairnessScore.textContent = score + '/100';
        }

        // Price comparison data
        const dtiPrice = Math.floor(Math.random() * 200) + 50;
        const marketPrice = Math.floor(dtiPrice * (0.9 + Math.random() * 0.3));
        const onlinePrice = Math.floor(dtiPrice * (0.85 + Math.random() * 0.2));
        
        if (priceComparison) {
            priceComparison.innerHTML = `
                <div class="price-card">
                    <div class="price-source">DTI SRP</div>
                    <div class="price-value">₱${dtiPrice}</div>
                    <div class="price-note">Official price</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Market (${location})</div>
                    <div class="price-value">₱${marketPrice}</div>
                    <div class="price-note">${marketPrice > dtiPrice ? 'Above SRP' : 'At or below SRP'}</div>
                </div>
                <div class="price-card">
                    <div class="price-source">Online Average</div>
                    <div class="price-value">₱${onlinePrice}</div>
                    <div class="price-note">Lazada/Shopee</div>
                </div>
            `;
        }

        // Insights
        if (insightsBox) {
            const diff = ((marketPrice - dtiPrice) / dtiPrice * 100).toFixed(1);
            if (marketPrice > dtiPrice) {
                insightsBox.innerHTML = `<strong>Insight:</strong> This product is priced <span style="color: #ff6b6b;">${diff}% above DTI SRP</span> in your area. Consider checking other locations or online options.`;
            } else {
                insightsBox.innerHTML = `<strong>Good Deal:</strong> This product is priced at or below DTI SRP. Fair price confirmed!`;
            }
        }

        // Advanced results if in advanced mode
        if (currentMode === 'advanced' && advancedResults) {
            const regionSelect = document.getElementById('regionSelect');
            const dateRangeSelect = document.getElementById('dateRange');
            const historicalTrends = document.getElementById('historicalTrends');
            const pricePredictions = document.getElementById('pricePredictions');
            const competitorPrices = document.getElementById('competitorPrices');
            
            const region = regionSelect ? regionSelect.value : 'NCR';
            const dateRange = dateRangeSelect ? dateRangeSelect.value : 'Last 30 days';
            const trends = historicalTrends ? historicalTrends.checked : false;
            
            let advancedHTML = `
                <div style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #262626;">
                    <h4 style="color: #1ED760; margin-bottom: 1rem;"> Advanced Analytics</h4>
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
            
            if (trends) {
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
                        <div style="font-size: 1.2rem; color: #ffaa33;">₱${Math.floor(marketPrice * (0.95 + Math.random() * 0.1))}</div>
                        <div style="color: #aaa; font-size: 0.9rem;">Confidence: ${Math.floor(Math.random() * 20) + 75}%</div>
                    </div>
                `;
            }
            
            if (competitorPrices && competitorPrices.checked) {
                advancedHTML += `
                    <div style="margin-top: 1rem; background: #0a0a0a; padding: 1rem; border-radius: 16px;">
                        <div style="color: #888;">Competitor Comparison</div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem;">
                            <div>Puregold: ₱${Math.floor(dtiPrice * 0.95)}</div>
                            <div>SM: ₱${Math.floor(dtiPrice * 1.05)}</div>
                            <div>Robinsons: ₱${Math.floor(dtiPrice * 1.02)}</div>
                            <div>Local Palengke: ₱${Math.floor(dtiPrice * 0.9)}</div>
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

    // Initialize with basic mode
    window.switchMode('basic', { target: document.querySelector('.mode-option') });
    
    // Enter key search
    const productInput = document.getElementById('productInput');
    if (productInput) {
        productInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                const checkPriceBtn = document.getElementById('checkPriceBtn');
                if (checkPriceBtn) {
                    checkPriceBtn.click();
                }
            }
        });
    }

    // Generate trend graph
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
            for (let i = 0; i < days.length; i++) {
                bars += `
                    <div class="graph-bar-container">
                        <div class="graph-bar" style="height: ${riceData[i]}px;" data-value="Rice: ${riceData[i]}"></div>
                        <div class="graph-label">${days[i]}</div>
                    </div>
                `;
            }
            trendGraph.innerHTML = bars;
        }

        // Generate multi-line points
        if (trendLines) {
            const points = ['rice', 'fuel', 'meat', 'veggies'];
            const colors = ['#1ED760', '#ff6b6b', '#ffaa33', '#4ecdc4'];
            const datasets = [riceData, fuelData, meatData, vegData];
            
            let pointsHTML = '';
            for (let d = 0; d < datasets.length; d++) {
                for (let i = 0; i < datasets[d].length; i++) {
                    const x = (i / (datasets[d].length - 1)) * 100;
                    const y = 100 - ((datasets[d][i] - 110) / 60 * 100); // Scale to 0-100%
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

    // Refresh graph on window resize with debounce
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(generateTrendGraph, 250);
    });
})();