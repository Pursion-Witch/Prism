(function() {
    'use strict';

    const USERS_KEY = 'prism_users_v1';

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
        }, 2400);
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

    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function normalize(value) {
        return value.trim().toLowerCase();
    }

    function wireCreateAccount() {
        const inputs = document.querySelectorAll('input');
        const nameInput = inputs[0];
        const emailInput = document.querySelector('input[type="email"]');
        const passwordInput = document.querySelector('input[type="password"]');
        const createButton = document.querySelector('.login-btn');
        const googleButton = document.querySelector('.social-btn.google');
        const facebookButton = document.querySelector('.social-btn.facebook');

        if (!nameInput || !emailInput || !passwordInput || !createButton) return;

        function submit() {
            const name = nameInput.value.trim();
            const email = normalize(emailInput.value);
            const password = passwordInput.value;

            if (!name || !email || !password) {
                showNotification('Please complete all fields.');
                return;
            }

            if (password.length < 6) {
                showNotification('Password must be at least 6 characters.');
                return;
            }

            const users = readUsers();
            if (users.some((user) => normalize(user.email || '') === email)) {
                showNotification('Email already exists. Please login instead.');
                return;
            }

            users.push({
                id: `user_${Date.now()}`,
                name,
                email,
                password,
                createdAt: new Date().toISOString()
            });

            saveUsers(users);
            showNotification('Account created. Redirecting to login...');

            setTimeout(() => {
                window.location.href = '/web/login/login.html';
            }, 900);
        }

        createButton.addEventListener('click', (event) => {
            event.preventDefault();
            submit();
        });

        [nameInput, emailInput, passwordInput].forEach((field) => {
            field.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    submit();
                }
            });
        });

        if (googleButton) {
            googleButton.addEventListener('click', () => {
                nameInput.value = 'Google User';
                emailInput.value = 'google.user@prism.ph';
                showNotification('Google sign-up demo: profile filled.');
            });
        }

        if (facebookButton) {
            facebookButton.addEventListener('click', () => {
                nameInput.value = 'Facebook User';
                emailInput.value = 'facebook.user@prism.ph';
                showNotification('Facebook sign-up demo: profile filled.');
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        createStars();
        wireCreateAccount();
    });
})();
