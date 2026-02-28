       (function() {

// Stars background

            function createStars() {
                const stars = document.getElementById('stars');
                if (!stars) return;
                for (let i = 0; i < 180; i++) {
                    let s = document.createElement('div');
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
                hamburger.addEventListener('click', (e) => { e.stopPropagation(); nav.classList.toggle('active'); });
                document.querySelectorAll('.nav-links a').forEach(l => l.addEventListener('click', () => nav.classList.remove('active')));
                document.addEventListener('click', (e) => { if (!hamburger.contains(e.target) && !nav.contains(e.target)) nav.classList.remove('active'); });
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
                    setTimeout(() => { n.style.display = 'none'; n.style.animation = ''; }, 250);
                }, 2000);
            };

// FAQ Data

            const faqData = {
                general: [
                    {
                        question: "What is PRISM?",
                        answer: "PRISM (Price Intelligence & Smart Monitoring) is an AI-powered platform that analyzes real transaction data to detect unfair pricing, monitor market health, and protect consumers and businesses in the Philippines."
                    },
                    {
                        question: "Is PRISM free to use?",
                        answer: "Yes! PRISM offers a free Basic plan with limited price searches and basic trend data. We also have Premium (₱199/month) and Enterprise (₱999/month) plans with advanced features."
                    },
                    {
                        question: "Where does PRISM get its price data?",
                        answer: "We aggregate data from multiple sources: DTI SRP, PSA inflation statistics, partner suppliers, Lazada, Shopee, and community-contributed palengke prices. All data is anonymized and validated."
                    }
                ],
                account: [
                    {
                        question: "How do I create an account?",
                        answer: "Click 'CREATE ACCOUNT' on the homepage. You can sign up with email or Google. Basic plan is free, no credit card required."
                    },
                    {
                        question: "I forgot my password. What should I do?",
                        answer: "Click 'Forgot Password' on the login page. We'll send a reset link to your email. If you don't receive it within 5 minutes, check your spam folder."
                    },
                    {
                        question: "Can I delete my account?",
                        answer: "Yes, go to Account Settings → Delete Account. Your data will be permanently removed within 30 days. Some anonymized price data may be retained for analytics."
                    }
                ],
                prices: [
                    {
                        question: "How does the fairness score work?",
                        answer: "Our AI compares market prices against DTI SRP, historical trends, and regional averages. Scores range from 0-100: 80+ is 'Presyong Sakto' (Fair), 60-79 is 'Medyo Mahal' (Slightly High), below 60 is 'Overpriced'."
                    },
                    {
                        question: "What are price alerts?",
                        answer: "You can set alerts for specific products. We'll notify you via app or email when prices drop, rise, or when an item becomes fairly priced based on your preferences."
                    },
                    {
                        question: "How accurate is the price data?",
                        answer: "We strive for high accuracy but prices can change rapidly. Always verify with the seller. Our AI flags potential inaccuracies for review. Report any incorrect prices through the product page."
                    }
                ],
                marketplace: [
                    {
                        question: "How do I buy from suppliers?",
                        answer: "Browse products in Marketplace, click 'Chat with Supplier' to discuss details, pricing, and arrange payment/delivery directly. PRISM facilitates communication but doesn't handle transactions."
                    },
                    {
                        question: "Is it safe to transact with suppliers?",
                        answer: "We verify supplier accounts and display their transaction history and ratings. However, always exercise caution: agree on terms before payment, and report suspicious behavior immediately."
                    },
                    {
                        question: "Can I become a supplier?",
                        answer: "Yes! Contact us through the Admin Panel or email suppliers@prism.ph. We'll guide you through verification and listing setup. Enterprise plan includes priority supplier support."
                    }
                ],
                subscription: [
                    {
                        question: "What's included in Premium?",
                        answer: "Premium (₱199/month) includes unlimited searches, advanced analytics, AI price predictions, priority alerts, and ad-free experience."
                    },
                    {
                        question: "What's included in Enterprise?",
                        answer: "Enterprise (₱999/month) adds real-time monitoring, API access, team dashboard, supplier verification, dedicated account manager, and custom integrations."
                    },
                    {
                        question: "How do I cancel my subscription?",
                        answer: "Go to Account → Subscription → Cancel. You'll still have access until the end of your billing period. No partial refunds for unused time."
                    }
                ],
                technical: [
                    {
                        question: "Is PRISM available on mobile?",
                        answer: "Yes! Our web app is fully responsive. Native iOS and Android apps are coming soon. You can also add PRISM to your home screen for app-like experience."
                    },
                    {
                        question: "Do you have an API?",
                        answer: "Yes, Enterprise plan includes API access. You can integrate real-time price data into your own applications. Documentation available at docs.prism.ph"
                    },
                    {
                        question: "How does the AI detection work?",
                        answer: "We use supervised and unsupervised machine learning to detect price anomalies. Our models analyze historical patterns, regional variations, and external factors."
                    }
                ]
            };

// Render FAQ

            function renderFAQ(category = 'all', searchTerm = '') {
                const container = document.getElementById('faqContent');
                const noResults = document.getElementById('noResults');
                let html = '';
                let hasResults = false;

                if (category === 'all') {
                    for (const [cat, questions] of Object.entries(faqData)) {
                        const filteredQuestions = questions.filter(q => 
                            searchTerm === '' || 
                            q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            q.answer.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        
                        if (filteredQuestions.length > 0) {
                            hasResults = true;
                            html += `<div class="faq-category"><h2><span>${getCategoryIcon(cat)}</span> ${getCategoryName(cat)}</h2>`;
                            
                            filteredQuestions.forEach((item, index) => {
                                html += `
                                    <div class="faq-item" data-category="${cat}">
                                        <div class="faq-question" onclick="toggleFAQ(this)">
                                            <h3>${item.question}</h3>
                                            <span class="material-symbols-outlined">add</span>
                                        </div>
                                        <div class="faq-answer">
                                            <p>${item.answer}</p>
                                        </div>
                                    </div>
                                `;
                            });
                            
                            html += `</div>`;
                        }
                    }
                } else {

// Show single category
                    if (faqData[category]) {
                        const filteredQuestions = faqData[category].filter(q => 
                            searchTerm === '' || 
                            q.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            q.answer.toLowerCase().includes(searchTerm.toLowerCase())
                        );
                        
                        if (filteredQuestions.length > 0) {
                            hasResults = true;
                            html += `<div class="faq-category"><h2><span>${getCategoryIcon(category)}</span> ${getCategoryName(category)}</h2>`;
                            
                            filteredQuestions.forEach((item, index) => {
                                html += `
                                    <div class="faq-item" data-category="${category}">
                                        <div class="faq-question" onclick="toggleFAQ(this)">
                                            <h3>${item.question}</h3>
                                            <span class="material-symbols-outlined">add</span>
                                        </div>
                                        <div class="faq-answer">
                                            <p>${item.answer}</p>
                                        </div>
                                    </div>
                                `;
                            });
                            
                            html += `</div>`;
                        }
                    }
                }

                if (hasResults) {
                    container.innerHTML = html;
                    noResults.style.display = 'none';
                } else {
                    container.innerHTML = '';
                    noResults.style.display = 'block';
                }
            }

            function getCategoryIcon(category) {
                const icons = {
                    general: '',
                    account: '',
                    prices: '',
                    marketplace: '',
                    subscription: '',
                    technical: ''
                };
                return icons[category] || '';
            }

            function getCategoryName(category) {
                const names = {
                    general: 'General Questions',
                    account: 'Account Management',
                    prices: 'Prices & Alerts',
                    marketplace: 'Marketplace',
                    subscription: 'Subscriptions & Billing',
                    technical: 'Technical Support'
                };
                return names[category] || category;
            }

// Toggle FAQ answer

            window.toggleFAQ = function(element) {
                const question = element;
                const answer = question.nextElementSibling;
                const icon = question.querySelector('.faq-icon');
                
                question.classList.toggle('active');
                
// Toggle answer visibility

                if (answer.classList.contains('show')) {
                    answer.classList.remove('show');
                    icon.textContent = '<span class="material-symbols-outlined">add</span>';
                } else {
                    answer.classList.add('show');
                    icon.textContent = '<span class="material-symbols-outlined">close</span>';
                }
            };

            let currentCategory = 'all';
            let currentSearch = '';

            window.filterCategory = function(category) {
                currentCategory = category;
                currentSearch = document.getElementById('faqSearch').value;
                
                document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
                document.querySelector(`[data-category="${category}"]`).classList.add('active');
                
                renderFAQ(category, currentSearch);
                showNotification(`Showing ${category === 'all' ? 'all questions' : category} category`);
            };

// Search FAQ

            window.searchFAQ = function() {
                const searchTerm = document.getElementById('faqSearch').value;
                currentSearch = searchTerm;
                renderFAQ(currentCategory, searchTerm);
                if (searchTerm) {
                    showNotification(`Searching for: "${searchTerm}"`);
                }
            };

// Enter key search

            document.getElementById('faqSearch').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    searchFAQ();
                }
            });

            renderFAQ('all', '');
        })();
