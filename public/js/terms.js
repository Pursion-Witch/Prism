(function() {
    'use strict';

    const TERMS_CONSENT_KEY = 'prism_terms_acceptance_v1';

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

    function setAcceptanceVisibility(isVisible) {
        const acceptanceBar = document.getElementById('acceptanceBar');
        if (!acceptanceBar) return;
        acceptanceBar.style.display = isVisible ? 'flex' : 'none';
    }

// Scroll to section

    window.scrollToSection = function(section) {
        const element = document.getElementById(`section-${section}`);
        if (!element) {
            showNotification('Section not found.');
            return;
        }

        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showNotification(`Jumping to section ${section}`);
    };

// Accept terms

    window.acceptTerms = function() {
        localStorage.setItem(TERMS_CONSENT_KEY, JSON.stringify({ accepted: true, timestamp: Date.now() }));
        setAcceptanceVisibility(false);
        showNotification('Terms accepted.');
    };

// Decline terms

    window.declineTerms = function() {
        localStorage.removeItem(TERMS_CONSENT_KEY);
        showNotification('Redirecting to homepage...');
        setTimeout(() => {
            window.location.href = '/web/home-page/hjome-page.html';
        }, 800);
    };

    document.querySelectorAll('.toc-item').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
        });
    });

    const accepted = localStorage.getItem(TERMS_CONSENT_KEY);
    if (accepted) {
        setAcceptanceVisibility(false);
    }
})();

