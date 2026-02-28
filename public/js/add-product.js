(function () {
    'use strict';

    const form = document.getElementById('addProductForm');
    const fileInput = document.getElementById('productImage');
    const preview = document.getElementById('imagePreview');
    const imageTextInput = document.getElementById('imageText');
    const productNameInput = document.getElementById('productName');
    const extractTextBtn = document.getElementById('extractTextBtn');
    const useTextAsNameBtn = document.getElementById('useTextAsNameBtn');
    const saveAndReturnBtn = document.getElementById('saveAndReturnBtn');
    const saveProductBtn = document.getElementById('saveProductBtn');

    let selectedImageData = '';
    let selectedImageName = '';
    let returnAfterSave = false;

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';
        for (let i = 0; i < 180; i++) {
            const s = document.createElement('div');
            s.className = 'star';
            s.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(s);
        }
    }

    createStars();

    const hamburger = document.getElementById('hamburgerBtn');
    const nav = document.getElementById('navLinks');
    if (hamburger && nav) {
        hamburger.addEventListener('click', function (e) {
            e.stopPropagation();
            nav.classList.toggle('active');
        });

        document.querySelectorAll('.nav-links a').forEach(function (link) {
            link.addEventListener('click', function () {
                nav.classList.remove('active');
            });
        });

        document.addEventListener('click', function (e) {
            if (!hamburger.contains(e.target) && !nav.contains(e.target)) {
                nav.classList.remove('active');
            }
        });
    }

    window.showNotification = function (message) {
        let node = document.getElementById('notification');
        if (!node) {
            node = document.createElement('div');
            node.id = 'notification';
            node.className = 'notification';
            document.body.appendChild(node);
        }

        node.textContent = message;
        node.style.display = 'block';
        node.style.animation = 'slideIn 0.2s';

        setTimeout(function () {
            node.style.animation = 'slideOut 0.25s';
            setTimeout(function () {
                node.style.display = 'none';
                node.style.animation = '';
            }, 250);
        }, 2200);
    };

    function readFileAsDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(typeof reader.result === 'string' ? reader.result : '');
            };
            reader.onerror = function () {
                reject(new Error('Unable to read image file.'));
            };
            reader.readAsDataURL(file);
        });
    }

    function deriveTextFromFilename(filename) {
        if (!filename) return '';
        return filename
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function setPreview(dataUrl) {
        if (!preview) return;

        if (!dataUrl) {
            preview.textContent = 'No image selected';
            return;
        }

        preview.innerHTML = '';
        const image = document.createElement('img');
        image.src = dataUrl;
        image.alt = 'Selected product';
        preview.appendChild(image);
    }

    async function handleImageSelected() {
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;
        if (!file) {
            selectedImageData = '';
            selectedImageName = '';
            setPreview('');
            return;
        }

        selectedImageName = file.name;
        try {
            selectedImageData = await readFileAsDataUrl(file);
            setPreview(selectedImageData);
        } catch (error) {
            selectedImageData = '';
            setPreview('');
            showNotification('Image could not be loaded.');
            return;
        }

        const guessedText = deriveTextFromFilename(file.name);
        if (imageTextInput && !imageTextInput.value.trim() && guessedText) {
            imageTextInput.value = guessedText;
            showNotification('Picture text extracted from filename. Edit as needed.');
        }
    }

    function extractPictureText() {
        if (!selectedImageName) {
            showNotification('Select an image first.');
            return;
        }

        const guessedText = deriveTextFromFilename(selectedImageName);
        if (!guessedText) {
            showNotification('No text could be inferred from this filename.');
            return;
        }

        if (imageTextInput) {
            imageTextInput.value = guessedText;
            showNotification('Picture text extracted.');
        }
    }

    function usePictureTextAsName() {
        if (!imageTextInput || !productNameInput) return;

        const source = imageTextInput.value
            .split(/\r?\n/)
            .map(function (line) { return line.trim(); })
            .find(function (line) { return line.length > 0; });

        if (!source) {
            showNotification('No picture text found.');
            return;
        }

        productNameInput.value = source;
        showNotification('Product name filled from picture text.');
    }

    async function submitProduct() {
        if (!form) return;
        const formData = new FormData(form);
        const name = String(formData.get('name') || '').trim();
        const category = String(formData.get('category') || '').trim();
        const supplier = String(formData.get('supplier') || '').trim();
        const basePrice = Number(formData.get('basePrice'));
        const status = String(formData.get('status') || 'active').trim();
        const imageText = String(formData.get('imageText') || '').trim();

        if (!name || !category || !supplier || !Number.isFinite(basePrice) || basePrice <= 0) {
            showNotification('Please complete all required product fields.');
            return;
        }

        if (saveProductBtn) saveProductBtn.disabled = true;
        if (saveAndReturnBtn) saveAndReturnBtn.disabled = true;

        const payload = {
            name: name,
            category: category,
            supplier: supplier,
            basePrice: Number(basePrice.toFixed(2)),
            status: status,
            imageName: selectedImageName || undefined,
            imageData: selectedImageData || undefined,
            imageText: imageText || undefined
        };

        try {
            const response = await fetch('/api/data/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(function () { return {}; });
            if (!response.ok || data.ok === false) {
                const message = typeof data.message === 'string' ? data.message : 'Unable to save product.';
                throw new Error(message);
            }

            showNotification('Product saved to JSON database.');
            if (returnAfterSave) {
                setTimeout(function () {
                    window.location.href = '/admin-panel/admin-panel.html';
                }, 500);
                return;
            }

            form.reset();
            selectedImageData = '';
            selectedImageName = '';
            setPreview('');
            if (imageTextInput) {
                imageTextInput.value = '';
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unexpected error while saving.';
            showNotification(message);
        } finally {
            if (saveProductBtn) saveProductBtn.disabled = false;
            if (saveAndReturnBtn) saveAndReturnBtn.disabled = false;
            returnAfterSave = false;
        }
    }

    if (fileInput) {
        fileInput.addEventListener('change', function () {
            handleImageSelected();
        });
    }

    if (extractTextBtn) {
        extractTextBtn.addEventListener('click', extractPictureText);
    }

    if (useTextAsNameBtn) {
        useTextAsNameBtn.addEventListener('click', usePictureTextAsName);
    }

    if (saveAndReturnBtn) {
        saveAndReturnBtn.addEventListener('click', function () {
            returnAfterSave = true;
            submitProduct();
        });
    }

    if (form) {
        form.addEventListener('submit', function (event) {
            event.preventDefault();
            returnAfterSave = false;
            submitProduct();
        });
    }
})();
