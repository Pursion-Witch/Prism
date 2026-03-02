(function() {
    'use strict';

    const PRIVACY_CONSENT_KEY = 'prism_privacy_consent_v1';

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

    function setConsentBarVisibility(isVisible) {
        const consentBar = document.getElementById('consentBar');
        if (!consentBar) return;
        consentBar.style.display = isVisible ? 'flex' : 'none';
    }

    function persistConsent(settings) {
        localStorage.setItem(PRIVACY_CONSENT_KEY, JSON.stringify({
            accepted: true,
            timestamp: Date.now(),
            settings
        }));
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

// Accept privacy

    window.acceptPrivacy = function() {
        persistConsent({ analytics: true, personalization: true, marketing: false });
        setConsentBarVisibility(false);
        showNotification('Privacy preferences saved.');
    };

    function openPrivacySettings() {
        const current = localStorage.getItem(PRIVACY_CONSENT_KEY);
        const defaults = { analytics: true, personalization: true, marketing: false };

        let currentSettings = defaults;
        if (current) {
            try {
                const parsed = JSON.parse(current);
                currentSettings = { ...defaults, ...(parsed.settings || {}) };
            } catch {
                currentSettings = defaults;
            }
        }

        const analytics = window.confirm('Enable analytics cookies? Click OK for yes, Cancel for no.');
        const personalization = window.confirm('Enable personalization cookies? Click OK for yes, Cancel for no.');

        const nextSettings = {
            analytics,
            personalization,
            marketing: currentSettings.marketing
        };

        persistConsent(nextSettings);
        setConsentBarVisibility(false);
        showNotification('Privacy settings updated.');
    }

    const settingsButton = document.querySelector('.btn-settings');
    if (settingsButton) {
        settingsButton.addEventListener('click', (event) => {
            event.preventDefault();
            openPrivacySettings();
        });
    }

// TOC items clickable

    document.querySelectorAll('.toc-item').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.preventDefault();
        });
    });

    const savedConsent = localStorage.getItem(PRIVACY_CONSENT_KEY);
    if (savedConsent) {
        setConsentBarVisibility(false);
    }
})();
