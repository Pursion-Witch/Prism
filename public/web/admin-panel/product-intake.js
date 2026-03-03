(function() {
    'use strict';

    const PREVIEW_READ_BYTES = 180 * 1024;
    const PREVIEW_MAX_LINES = 24;
    const PREVIEW_EXTENSIONS = new Set(['txt', 'csv', 'json', 'md']);

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
        }, 2500);
    }

    async function parseJsonResponse(response) {
        const text = await response.text();
        try {
            return text ? JSON.parse(text) : {};
        } catch {
            return { message: text || 'Unexpected response from server.' };
        }
    }

    function setButtonState(button, isBusy, busyLabel, idleLabel) {
        if (!button) return;
        button.disabled = isBusy;
        button.textContent = isBusy ? busyLabel : idleLabel;
    }

    function toCurrency(value) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return 'N/A';
        }

        return new Intl.NumberFormat('en-PH', {
            style: 'currency',
            currency: 'PHP',
            maximumFractionDigits: 2
        }).format(parsed);
    }

    function toFileSize(bytes) {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value <= 0) {
            return '0 KB';
        }

        if (value >= 1024 * 1024) {
            return `${(value / (1024 * 1024)).toFixed(2)} MB`;
        }

        return `${Math.max(1, Math.round(value / 1024))} KB`;
    }

    function getFileExtension(name) {
        const parts = String(name || '').split('.');
        if (parts.length < 2) return '';
        return parts[parts.length - 1].toLowerCase();
    }

    function setFilePreviewContent(name, meta, text) {
        const nameEl = document.getElementById('filePreviewName');
        const metaEl = document.getElementById('filePreviewMeta');
        const textEl = document.getElementById('filePreviewText');

        if (nameEl) nameEl.textContent = name;
        if (metaEl) metaEl.textContent = meta;
        if (textEl) textEl.textContent = text;
    }

    async function previewSelectedFile(file) {
        if (!file) {
            setFilePreviewContent('No file selected', 'Select a file to preview before AI import.', 'Preview will appear here.');
            return;
        }

        const extension = getFileExtension(file.name);
        const supported = PREVIEW_EXTENSIONS.has(extension);

        if (!supported) {
            setFilePreviewContent(
                file.name,
                `${toFileSize(file.size)} • Unsupported preview format`,
                'This file cannot be previewed. Use txt, csv, json, or md.'
            );
            return;
        }

        try {
            const sampledText = await file.slice(0, PREVIEW_READ_BYTES).text();
            const lines = sampledText
                .replace(/\u0000/g, ' ')
                .split(/\r?\n/)
                .map((line) => line.trimEnd());
            const previewLines = lines.slice(0, PREVIEW_MAX_LINES);
            const previewBody = previewLines.join('\n').trim() || '[Empty document]';
            const isTruncated = file.size > PREVIEW_READ_BYTES || lines.length > PREVIEW_MAX_LINES;

            setFilePreviewContent(
                file.name,
                `${toFileSize(file.size)} • ${extension.toUpperCase()} • AI-first import ready${isTruncated ? ' • Preview truncated' : ''}`,
                isTruncated ? `${previewBody}\n\n...` : previewBody
            );
        } catch {
            setFilePreviewContent(file.name, `${toFileSize(file.size)} • Preview failed`, 'Unable to read this file for preview.');
        }
    }

    function normalizeRowsForTable(payload) {
        if (!payload || typeof payload !== 'object') {
            return [];
        }

        if (Array.isArray(payload.records_preview)) {
            return payload.records_preview;
        }

        if (Array.isArray(payload.records)) {
            return payload.records;
        }

        if (payload.product && typeof payload.product === 'object') {
            return [payload.product];
        }

        return [];
    }

    function renderResultMetrics(payload) {
        const metrics = document.getElementById('resultMetrics');
        if (!metrics) return;

        const cards = [];
        if (Number.isFinite(Number(payload.imported))) cards.push({ label: 'Imported Rows', value: Number(payload.imported) });
        if (Number.isFinite(Number(payload.inserted))) cards.push({ label: 'Inserted', value: Number(payload.inserted) });
        if (Number.isFinite(Number(payload.updated))) cards.push({ label: 'Updated', value: Number(payload.updated) });
        if (Number.isFinite(Number(payload.rows_without_price))) cards.push({ label: 'Without Price', value: Number(payload.rows_without_price) });
        if (Number.isFinite(Number(payload.draft_count))) cards.push({ label: 'Detected Rows', value: Number(payload.draft_count) });
        if (typeof payload.source === 'string' && payload.source) cards.push({ label: 'Parser', value: payload.source.toUpperCase() });
        if (typeof payload.action === 'string' && payload.action) cards.push({ label: 'Action', value: payload.action.toUpperCase() });

        if (!cards.length) {
            cards.push({ label: 'Status', value: payload.message || 'Completed' });
        }

        metrics.innerHTML = cards
            .map((card) => `<div class="metric-card"><div class="metric-label">${card.label}</div><div class="metric-value">${card.value}</div></div>`)
            .join('');
    }

    function renderResultMeta(payload) {
        const meta = document.getElementById('resultMeta');
        if (!meta) return;

        const segments = [];
        if (payload.message) segments.push(payload.message);
        if (payload.ingestion_id) segments.push(`Ingestion ID: ${payload.ingestion_id}`);
        if (payload.filename) segments.push(`File: ${payload.filename}`);
        if (payload.file_type) segments.push(`Type: ${payload.file_type}`);

        meta.textContent = segments.join(' • ');
    }

    function renderResultTable(payload) {
        const table = document.getElementById('resultTable');
        if (!table) return;

        const rows = normalizeRowsForTable(payload).slice(0, 12);
        if (!rows.length) {
            table.innerHTML = '<tbody><tr><td>No row preview available for this operation.</td></tr></tbody>';
            return;
        }

        const normalizedRows = rows.map((row) => ({
            name: row.product_name || row.name || 'N/A',
            category: row.category || 'GENERAL',
            brand: row.brand_name || 'N/A',
            region: row.region || 'Cebu City',
            market: row.market_name || 'N/A',
            stall: row.stall_name || 'N/A',
            srp_price: row.srp_price
        }));

        const body = normalizedRows
            .map((row) => `
                <tr>
                    <td>${row.name}</td>
                    <td>${row.category}</td>
                    <td>${row.brand}</td>
                    <td>${row.region}</td>
                    <td>${row.market}</td>
                    <td>${row.stall}</td>
                    <td>${toCurrency(row.srp_price)}</td>
                </tr>
            `)
            .join('');

        table.innerHTML = `
            <thead>
                <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Brand</th>
                    <th>Region</th>
                    <th>Market</th>
                    <th>Stall</th>
                    <th>Price</th>
                </tr>
            </thead>
            <tbody>${body}</tbody>
        `;
    }

    function renderResult(payload) {
        const resultBox = document.getElementById('resultBox');
        if (resultBox) {
            resultBox.textContent = JSON.stringify(payload, null, 2);
        }

        renderResultMetrics(payload || {});
        renderResultMeta(payload || {});
        renderResultTable(payload || {});
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

        setButtonState(submitBtn, true, 'AI Reading...', 'Upload and Import');
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
            await previewSelectedFile(null);
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Document import failed.');
        } finally {
            setButtonState(submitBtn, false, 'AI Reading...', 'Upload and Import');
        }
    }

    async function clearAllPrices() {
        const clearBtn = document.getElementById('clearAllBtn');
        const confirmed = window.confirm('This will clear all SRP prices from the product catalog and remove document ingestion history. Continue?');
        if (!confirmed) {
            return;
        }

        setButtonState(clearBtn, true, 'Clearing...', 'Clear All Prices');
        try {
            const response = await fetch('/api/admin/products/prices', {
                method: 'DELETE'
            });
            const body = await parseJsonResponse(response);
            renderResult(body);

            if (!response.ok) {
                throw new Error(body.message || 'Failed to clear prices.');
            }

            showNotification(body.message || 'All prices cleared.');
        } catch (error) {
            showNotification(error instanceof Error ? error.message : 'Failed to clear prices.');
        } finally {
            setButtonState(clearBtn, false, 'Clearing...', 'Clear All Prices');
        }
    }

    function wireEvents() {
        const manualForm = document.getElementById('manualForm');
        const uploadForm = document.getElementById('uploadForm');
        const fileInput = document.getElementById('document');
        const clearAllBtn = document.getElementById('clearAllBtn');

        if (manualForm) {
            manualForm.addEventListener('submit', submitManualForm);
        }

        if (uploadForm) {
            uploadForm.addEventListener('submit', submitUploadForm);
        }

        if (fileInput) {
            fileInput.addEventListener('change', async (event) => {
                const target = event.target;
                if (!(target instanceof HTMLInputElement) || !target.files || target.files.length === 0) {
                    await previewSelectedFile(null);
                    return;
                }

                await previewSelectedFile(target.files[0]);
            });
        }

        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', clearAllPrices);
        }
    }

    createStars();
    initHamburgerMenu();
    wireEvents();
    renderResult({ message: 'No operations yet.' });
    previewSelectedFile(null);

    window.showNotification = showNotification;
})();
