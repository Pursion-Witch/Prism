(function() {
    'use strict';

    const USERS_KEY = 'prism_users_v1';
    const SESSION_KEY = 'prism_session_v1';

    function createStars() {
        const starsContainer = document.getElementById('stars');
        if (!starsContainer) return;

        starsContainer.innerHTML = '';
        for (let i = 0; i < 200; i += 1) {
            const star = document.createElement('div');
            star.className = 'star';

            const size = Math.random() * 3 + 1;
            const x = Math.random() * 100;
            const y = Math.random() * 100;
            const duration = Math.random() * 3 + 2;

            star.style.cssText = `left:${x}%; top:${y}%; width:${size}px; height:${size}px; animation-duration:${duration}s;`;
            starsContainer.appendChild(star);
        }
    }

    function showNotification(message) {
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.style.cssText = 'position:fixed; top:20px; right:20px; z-index:9999; background:#111; color:#fff; padding:12px 14px; border-radius:10px; border:1px solid #333; font-size:12px;';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.style.display = 'block';

        setTimeout(() => {
            notification.style.display = 'none';
        }, 2200);
    }

    function readUsers() {
        const raw = localStorage.getItem(USERS_KEY);
        if (!raw) return [];

        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    function saveSession(email) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            email,
            loggedInAt: Date.now()
        }));
    }

    function normalize(value) {
        return value.trim().toLowerCase();
    }

    function wireLogin() {
        const emailInput = document.querySelector('input[type="email"]');
        const passwordInput = document.querySelector('input[type="password"]');
        const loginButton = document.querySelector('.login-btn');
        const googleButton = document.querySelector('.social-btn.google');
        const facebookButton = document.querySelector('.social-btn.facebook');

        if (!emailInput || !passwordInput || !loginButton) return;

        function attemptLogin() {
            const email = normalize(emailInput.value);
            const password = passwordInput.value;

            if (!email || !password) {
                showNotification('Please enter email and password.');
                return;
            }

            const users = readUsers();
            const matchedUser = users.find((user) => normalize(user.email || '') === email && user.password === password);
            const fallbackAdmin = email === 'admin@prism.ph' && password === 'admin123';

            if (!matchedUser && !fallbackAdmin) {
                showNotification('Invalid credentials.');
                return;
            }

            saveSession(email);
            showNotification('Login successful. Redirecting...');
            setTimeout(() => {
                window.location.href = '/web/home-page/hjome-page.html';
            }, 700);
        }

        loginButton.addEventListener('click', (event) => {
            event.preventDefault();
            attemptLogin();
        });

        [emailInput, passwordInput].forEach((field) => {
            field.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    attemptLogin();
                }
            });
        });

        if (googleButton) {
            googleButton.addEventListener('click', () => {
                emailInput.value = 'google.user@prism.ph';
                passwordInput.value = 'google-oauth';
                showNotification('Google sign-in demo: credentials filled.');
            });
        }

        if (facebookButton) {
            facebookButton.addEventListener('click', () => {
                emailInput.value = 'facebook.user@prism.ph';
                passwordInput.value = 'facebook-oauth';
                showNotification('Facebook sign-in demo: credentials filled.');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        createStars();
        wireLogin();
    });
})();

