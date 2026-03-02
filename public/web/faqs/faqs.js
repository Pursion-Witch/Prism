(function() {
    'use strict';

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

// Notification system

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

// FAQ Data

    const faqData = {
        general: [
            {
                question: 'What is PRISM?',
                answer: 'PRISM (Price Intelligence & Smart Monitoring) is an AI-powered platform that analyzes real transaction data to detect unfair pricing, monitor market health, and protect consumers and businesses in the Philippines.'
            },
            {
                question: 'Is PRISM free to use?',
                answer: 'Yes. PRISM offers a free Basic plan with limited price searches and basic trend data. Premium and Enterprise plans include advanced features.'
            },
            {
                question: 'Where does PRISM get its price data?',
                answer: 'We aggregate data from DTI SRP, PSA statistics, partner suppliers, major e-commerce sources, and community-contributed market prices.'
            }
        ],
        account: [
            {
                question: 'How do I create an account?',
                answer: 'Click CREATE ACCOUNT on the homepage. You can sign up with email or social providers.'
            },
            {
                question: 'I forgot my password. What should I do?',
                answer: 'Use the forgot password option in login (or contact support) and we will help you reset access.'
            },
            {
                question: 'Can I delete my account?',
                answer: 'Yes. Contact support to request account deletion and data cleanup.'
            }
        ],
        prices: [
            {
                question: 'How does the fairness score work?',
                answer: 'Our engine compares market prices against SRP baselines, historical trends, and regional factors to estimate fairness.'
            },
            {
                question: 'What are price alerts?',
                answer: 'Price alerts notify you when watched products move above, below, or near target fair values.'
            },
            {
                question: 'How accurate is the price data?',
                answer: 'We continuously validate sources, but prices may change quickly. Always verify directly with the supplier before purchasing.'
            }
        ],
        marketplace: [
            {
                question: 'How do I buy from suppliers?',
                answer: 'Browse products in Marketplace and use built-in chat to negotiate terms directly with suppliers.'
            },
            {
                question: 'Is it safe to transact with suppliers?',
                answer: 'Use verified suppliers and standard due diligence. Report suspicious activity using the alert/report flow.'
            },
            {
                question: 'Can I become a supplier?',
                answer: 'Yes. Contact the PRISM team and complete supplier verification to list your catalog.'
            }
        ],
        subscription: [
            {
                question: 'What is included in Premium?',
                answer: 'Premium includes higher limits, deeper analytics, and faster alert updates.'
            },
            {
                question: 'What is included in Enterprise?',
                answer: 'Enterprise adds API access, team-level controls, and operational reporting.'
            },
            {
                question: 'How do I cancel my subscription?',
                answer: 'Go to account billing settings and cancel before your next billing cycle.'
            }
        ],
        technical: [
            {
                question: 'Is PRISM available on mobile?',
                answer: 'Yes. The web app supports mobile browsers and responsive layouts.'
            },
            {
                question: 'Do you have an API?',
                answer: 'Yes, API access is available for enterprise use cases.'
            },
            {
                question: 'How does AI detection work?',
                answer: 'AI combines baseline pricing, anomaly logic, and source confidence scoring to classify market conditions.'
            }
        ]
    };

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

    function getCategoryIcon(category) {
        const icons = {
            general: 'help',
            account: 'person',
            prices: 'monitoring',
            marketplace: 'storefront',
            subscription: 'paid',
            technical: 'build'
        };
        return `<span class="material-symbols-outlined">${icons[category] || 'help'}</span>`;
    }

    let currentCategory = 'all';
    let currentSearchTerm = '';

    function questionMatches(item, searchTerm) {
        if (!searchTerm) return true;

        const q = searchTerm.toLowerCase();
        return item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q);
    }

    function renderFAQ(category = 'all', searchTerm = '') {
        const container = document.getElementById('faqContent');
        const noResults = document.getElementById('noResults');
        if (!container || !noResults) return;

        let html = '';
        let hasResults = false;

        const categoriesToRender = category === 'all' ? Object.keys(faqData) : [category];

        categoriesToRender.forEach((cat) => {
            const questions = faqData[cat] || [];
            const filteredQuestions = questions.filter((item) => questionMatches(item, searchTerm));

            if (filteredQuestions.length === 0) {
                return;
            }

            hasResults = true;
            html += `<div class="faq-category"><h2>${getCategoryIcon(cat)} ${getCategoryName(cat)}</h2>`;

            filteredQuestions.forEach((item) => {
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

            html += '</div>';
        });

        if (!hasResults) {
            container.innerHTML = '';
            noResults.style.display = 'block';
            return;
        }

        container.innerHTML = html;
        noResults.style.display = 'none';
    }

    window.toggleFAQ = function(questionElement) {
        if (!questionElement) return;

        const answer = questionElement.nextElementSibling;
        const icon = questionElement.querySelector('.material-symbols-outlined');
        if (!answer || !icon) return;

        const isOpening = !answer.classList.contains('show');

        if (isOpening) {
            document.querySelectorAll('.faq-answer.show').forEach((openAnswer) => {
                openAnswer.classList.remove('show');
            });
            document.querySelectorAll('.faq-question.active').forEach((openQuestion) => {
                openQuestion.classList.remove('active');
                const openIcon = openQuestion.querySelector('.material-symbols-outlined');
                if (openIcon) openIcon.textContent = 'add';
            });
        }

        questionElement.classList.toggle('active', isOpening);
        answer.classList.toggle('show', isOpening);
        icon.textContent = isOpening ? 'close' : 'add';
    };

    window.filterCategory = function(category) {
        currentCategory = category || 'all';

        document.querySelectorAll('.pill[data-category]').forEach((pill) => {
            pill.classList.toggle('active', pill.getAttribute('data-category') === currentCategory);
        });

        renderFAQ(currentCategory, currentSearchTerm);
        showNotification(`Showing ${currentCategory === 'all' ? 'all questions' : currentCategory}`);
    };

    window.searchFAQ = function() {
        const searchInput = document.getElementById('faqSearch');
        currentSearchTerm = searchInput ? searchInput.value.trim() : '';
        renderFAQ(currentCategory, currentSearchTerm);

        if (currentSearchTerm) {
            showNotification(`Searching for: "${currentSearchTerm}"`);
        }
    };

    const searchInput = document.getElementById('faqSearch');
    if (searchInput) {
        searchInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.searchFAQ();
            }
        });
    }

    const supportButton = document.querySelector('.btn-support');
    if (supportButton) {
        supportButton.addEventListener('click', () => {
            const subject = encodeURIComponent('PRISM Support Request');
            const body = encodeURIComponent('Hi PRISM team,%0D%0A%0D%0AI need help with:%0D%0A');
            window.location.href = `mailto:prism@gmail.com?subject=${subject}&body=${body}`;
        });
    }

    renderFAQ('all', '');
})();
