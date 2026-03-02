(function() {
    'use strict';

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';
        for (let i = 0; i < 180; i += 1) {
            const dot = document.createElement('div');
            dot.className = 'star';
            dot.style.cssText = `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${Math.random() * 2 + 1}px;height:${Math.random() * 2 + 1}px;animation-duration:${Math.random() * 3 + 2}s;`;
            stars.appendChild(dot);
        }
    }

    function initHamburgerMenu() {
        const hamburger = document.getElementById('hamburgerBtn');
        const navLinks = document.getElementById('navLinks');
        if (!hamburger || !navLinks) return;

        hamburger.addEventListener('click', (event) => {
            event.stopPropagation();
            navLinks.classList.toggle('active');
        });

        document.querySelectorAll('.nav-links a').forEach((link) => {
            link.addEventListener('click', () => navLinks.classList.remove('active'));
        });

        document.addEventListener('click', (event) => {
            if (!hamburger.contains(event.target) && !navLinks.contains(event.target)) {
                navLinks.classList.remove('active');
            }
        });
    }

    function showNotification(message) {
        let notification = document.getElementById('notification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'notification';
            notification.className = 'notification';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.style.display = 'block';

        window.setTimeout(() => {
            notification.style.display = 'none';
        }, 2200);
    }

    async function parseJsonResponse(response) {
        const text = await response.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch {
            return { message: text || 'Unexpected response from server.' };
        }
    }

    function renderResult(payload) {
        const resultBox = document.getElementById('resultBox');
        if (!resultBox) return;
        resultBox.textContent = JSON.stringify(payload, null, 2);
    }

    function setButtonState(button, isBusy, busyLabel, idleLabel) {
        if (!button) return;
        button.disabled = isBusy;
        button.textContent = isBusy ? busyLabel : idleLabel;
    }

    async function submitManualForm(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const submitBtn = document.getElementById('manualSubmitBtn');
        const formData = new FormData(form);
        const payload = {
            name: String(formData.get('name') || '').trim(),
            category: String(formData.get('category') || '').trim(),
            brand_name: String(formData.get('brand_name') || '').trim(),
            region: String(formData.get('region') || '').trim(),
            market_name: String(formData.get('market_name') || '').trim(),
            stall_name: String(formData.get('stall_name') || '').trim(),
            srp_price: Number(formData.get('srp_price'))
        };

        setButtonState(submitBtn, true, 'Saving...', 'Save Product');
        try {
            const response = await fetch('/api/admin/products/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const body = await parseJsonResponse(response);
            renderResult(body);

            if (!response.ok) {
                throw new Error(body.message || 'Manual product insert failed.');
            }

            showNotification(body.message || 'Product saved.');
            form.reset();
            const regionInput = document.getElementById('region');
            const marketInput = document.getElementById('market_name');
            const stallInput = document.getElementById('stall_name');
            if (regionInput) regionInput.value = 'Cebu City';
            if (marketInput) marketInput.value = 'Carbon Public Market';
            if (stallInput) stallInput.value = 'Stall A-01';
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Manual insert failed.');
        } finally {
            setButtonState(submitBtn, false, 'Saving...', 'Save Product');
        }
    }

    async function submitUploadForm(event) {
        event.preventDefault();

        const form = event.currentTarget;
        const submitBtn = document.getElementById('uploadSubmitBtn');
        const fileInput = document.getElementById('document');

        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showNotification('Please select a document file first.');
            return;
        }

        const payload = new FormData(form);

        setButtonState(submitBtn, true, 'Importing...', 'Upload and Import');
        try {
            const response = await fetch('/api/admin/products/import', {
                method: 'POST',
                body: payload
            });

            const body = await parseJsonResponse(response);
            renderResult(body);

            if (!response.ok) {
                throw new Error(body.message || 'Document import failed.');
            }

            showNotification(body.message || 'Document imported.');
            form.reset();
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Document import failed.');
        } finally {
            setButtonState(submitBtn, false, 'Importing...', 'Upload and Import');
        }
    }

    createStars();
    initHamburgerMenu();

    const manualForm = document.getElementById('manualForm');
    const uploadForm = document.getElementById('uploadForm');

    if (manualForm) {
        manualForm.addEventListener('submit', submitManualForm);
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', submitUploadForm);
    }

    window.showNotification = showNotification;
})();
