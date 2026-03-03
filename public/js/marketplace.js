(function() {
    'use strict';

// Stars background

    function createStars() {
        const stars = document.getElementById('stars');
        if (!stars) return;

        stars.innerHTML = '';
        for (let i = 0; i < 180; i += 1) {
            const star = document.createElement('div');
            star.className = 'star';
            star.style.cssText = `left:${Math.random() * 100}%; top:${Math.random() * 100}%; width:${Math.random() * 3 + 1}px; height:${Math.random() * 3 + 1}px; animation-delay:${Math.random() * 3}s`;
            stars.appendChild(star);
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

// Notification helper

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

// Product Data Base

    const products = [
        { id: 1, name: 'Sinandomeng Rice (50kg)', supplier: 'Mega Mart', price: 2450, imageUrl: '/images/sinandomeng.png', category: 'rice', location: 'Bulacan', rating: 4.8, supplierAvatar: 'MM' },
        { id: 2, name: 'Jasmine Rice (25kg)', supplier: 'Mega Mart', price: 1350, imageUrl: '/images/jasmine.jpg', category: 'rice', location: 'Bulacan', rating: 4.7, supplierAvatar: 'MM' },
        { id: 3, name: 'Dinorado Rice (10kg)', supplier: 'Palengke Direct', price: 680, imageUrl: '/images/rice3.png', category: 'rice', location: 'Nueva Ecija', rating: 4.9, supplierAvatar: 'PD' },
        { id: 4, name: 'Brown Rice (5kg)', supplier: 'FarmFresh', price: 320, imageUrl: '/images/rice4.png', category: 'rice', location: 'Isabela', rating: 4.6, supplierAvatar: 'FF' },
        { id: 5, name: 'Whole Chicken (1kg)', supplier: 'FarmFresh', price: 180, imageUrl: '/images/chicken.jpg', category: 'meat', location: 'Laguna', rating: 4.8, supplierAvatar: 'FF' },
        { id: 6, name: 'Pork Liempo (1kg)', supplier: 'FarmFresh', price: 340, imageUrl: '/images/pork-liempo.jpg', category: 'meat', location: 'Pampanga', rating: 4.7, supplierAvatar: 'FF' },
        { id: 7, name: 'Beef Sirloin (1kg)', supplier: 'Mega Mart', price: 520, imageUrl: '/images/beef.png', category: 'meat', location: 'Bulacan', rating: 4.8, supplierAvatar: 'MM' },
        { id: 8, name: 'Chicken Thighs (1kg)', supplier: 'Palengke Direct', price: 165, imageUrl: '/images/thighs.webp', category: 'meat', location: 'Laguna', rating: 4.6, supplierAvatar: 'PD' },
        { id: 9, name: 'Ground Pork (1kg)', supplier: 'Tindahan PH', price: 290, imageUrl: '/images/pork.jpg', category: 'meat', location: 'Manila', rating: 4.5, supplierAvatar: 'TP' },
        { id: 10, name: 'Red Onions (1kg)', supplier: 'Palengke Direct', price: 80, imageUrl: '/images/onions.webp', category: 'vegetables', location: 'Nueva Ecija', rating: 4.7, supplierAvatar: 'PD' },
        { id: 11, name: 'Garlic (1kg)', supplier: 'Palengke Direct', price: 100, imageUrl: '/images/garlic.webp', category: 'vegetables', location: 'Ilocos', rating: 4.8, supplierAvatar: 'PD' },
        { id: 12, name: 'Potatoes (1kg)', supplier: 'FarmFresh', price: 75, imageUrl: '/images/potato.webp', category: 'vegetables', location: 'Benguet', rating: 4.6, supplierAvatar: 'FF' },
        { id: 13, name: 'Tomatoes (1kg)', supplier: 'Tindahan PH', price: 65, imageUrl: '/images/tomato.webp', category: 'vegetables', location: 'Mindanao', rating: 4.4, supplierAvatar: 'TP' },
        { id: 14, name: 'Carrots (1kg)', supplier: 'Mega Mart', price: 85, imageUrl: '/images/carrots.webp', category: 'vegetables', location: 'Benguet', rating: 4.5, supplierAvatar: 'MM' },
        { id: 15, name: 'Cabbage (1 head)', supplier: 'FarmFresh', price: 45, imageUrl: '/images/cabbage.webp', category: 'vegetables', location: 'Benguet', rating: 4.6, supplierAvatar: 'FF' },
        { id: 16, name: 'Corned Beef (380g)', supplier: 'Tindahan PH', price: 85, imageUrl: '/images/corned-beef.png', category: 'canned', location: 'Manila', rating: 4.5, supplierAvatar: 'TP' },
        { id: 17, name: 'Sardines (155g)', supplier: 'Tindahan PH', price: 18, imageUrl: '/images/sardines.jpg', category: 'canned', location: 'Zamboanga', rating: 4.4, supplierAvatar: 'TP' },
        { id: 18, name: 'Tuna Flakes (180g)', supplier: 'Mega Mart', price: 42, imageUrl: '/images/tuna.jpg', category: 'canned', location: 'General Santos', rating: 4.6, supplierAvatar: 'MM' },
        { id: 20, name: 'Lucky Me Beef (60g x30)', supplier: 'Mega Mart', price: 285, imageUrl: '/images/lucky-me.webp', category: 'noodles', location: 'Quezon City', rating: 4.7, supplierAvatar: 'MM' },
        { id: 21, name: 'Pancit Canton (80g x30)', supplier: 'Mega Mart', price: 450, imageUrl: '/images/canton.jpg', category: 'noodles', location: 'Quezon City', rating: 4.8, supplierAvatar: 'MM' },
        { id: 23, name: 'Coca-Cola (1.5L x12)', supplier: 'Tindahan PH', price: 720, imageUrl: '/images/coke.png', category: 'beverages', location: 'Makati', rating: 4.6, supplierAvatar: 'TP' },
        { id: 24, name: 'Mineral Water (6L x4)', supplier: 'FarmFresh', price: 200, imageUrl: '/images/water.webp', category: 'beverages', location: 'Rizal', rating: 4.7, supplierAvatar: 'FF' },
        { id: 25, name: 'Energy Drink (250ml x24)', supplier: 'Mega Mart', price: 720, imageUrl: '/images/energy.webp', category: 'beverages', location: 'Bulacan', rating: 4.5, supplierAvatar: 'MM' },
        { id: 26, name: 'Coffee (3in1 x50)', supplier: 'Tindahan PH', price: 380, imageUrl: '/images/coffee.jpg', category: 'beverages', location: 'Manila', rating: 4.6, supplierAvatar: 'TP' },
        { id: 27, name: 'Cooking Oil (1L x6)', supplier: 'Mega Mart', price: 270, imageUrl: '/images/oil.webp', category: 'canned', location: 'Bulacan', rating: 4.7, supplierAvatar: 'MM' },
        { id: 28, name: 'Eggs (30pcs)', supplier: 'FarmFresh', price: 210, imageUrl: '/images/egg.jpg', category: 'meat', location: 'Laguna', rating: 4.8, supplierAvatar: 'FF' }
    ];

// Chat data

    const chats = [
        {
            id: 1,
            name: 'Mega Mart',
            avatar: 'MM',
            lastMessage: 'Available po ang rice today',
            time: '2m ago',
            unread: 2,
            online: true,
            messages: [
                { sender: 'Mega Mart', text: 'Hello! We have fresh Sinandomeng rice today.', time: '10:30 AM', type: 'incoming' },
                { sender: 'You', text: 'How much per kilo?', time: '10:32 AM', type: 'outgoing' },
                { sender: 'Mega Mart', text: 'PHP 49/kilo for bulk orders. How many kg?', time: '10:33 AM', type: 'incoming' }
            ]
        },
        {
            id: 2,
            name: 'Palengke Direct',
            avatar: 'PD',
            lastMessage: 'Sibuyas price updated to PHP 75/kg',
            time: '15m ago',
            unread: 0,
            online: true,
            messages: [
                { sender: 'Palengke Direct', text: 'Sibuyas and bawang from Nueva Ecija!', time: '9:15 AM', type: 'incoming' },
                { sender: 'You', text: 'Anong presyo ng sibuyas?', time: '9:17 AM', type: 'outgoing' },
                { sender: 'Palengke Direct', text: 'PHP 75/kg po. Bawang PHP 95/kg', time: '9:18 AM', type: 'incoming' }
            ]
        },
        {
            id: 3,
            name: 'FarmFresh',
            avatar: 'FF',
            lastMessage: 'Whole chicken available PHP 175/kg',
            time: '1h ago',
            unread: 1,
            online: true,
            messages: [
                { sender: 'FarmFresh', text: 'Farm fresh chicken and pork available.', time: '11:00 AM', type: 'incoming' },
                { sender: 'You', text: 'Whole chicken po?', time: '11:02 AM', type: 'outgoing' },
                { sender: 'FarmFresh', text: 'Yes, PHP 175/kg today. How many?', time: '11:03 AM', type: 'incoming' }
            ]
        },
        {
            id: 4,
            name: 'Tindahan PH',
            avatar: 'TP',
            lastMessage: 'Cooking oil sale! PHP 250/6L',
            time: '3h ago',
            unread: 0,
            online: false,
            messages: []
        }
    ];

    const state = {
        category: 'all',
        supplier: 'all',
        minPrice: null,
        maxPrice: null,
        rating: 0,
        location: 'all',
        searchTerm: '',
        chatTab: 'recent',
        selectedChatId: 1
    };

    const grid = document.getElementById('productsGrid');
    const chatList = document.getElementById('chatList');
    const searchInput = document.getElementById('searchInput');
    const minPriceInput = document.getElementById('minPrice');
    const maxPriceInput = document.getElementById('maxPrice');

    function normalize(value) {
        return value.trim().toLowerCase();
    }

    function matchesLocation(product, filter) {
        const location = normalize(product.location);

        if (filter === 'all') return true;
        if (filter === 'metro') return /(manila|makati|quezon city|pasig|taguig)/.test(location);
        if (filter === 'luzon') return /(bulacan|laguna|pampanga|nueva ecija|isabela|ilocos|benguet|rizal)/.test(location);
        if (filter === 'visayas') return /(cebu|bohol|iloilo|bacolod|leyte|visayas)/.test(location);
        if (filter === 'mindanao') return /(mindanao|zamboanga|davao|general santos|cagayan de oro)/.test(location);

        return true;
    }

    function matchesSupplier(product, supplierFilter) {
        if (supplierFilter === 'all') return true;

        const supplierMap = {
            megamart: 'mega mart',
            palengke: 'palengke direct',
            farmfresh: 'farmfresh',
            tindahan: 'tindahan ph'
        };

        return normalize(product.supplier).includes(supplierMap[supplierFilter] || '');
    }

    function getFilteredProducts() {
        return products.filter((product) => {
            if (state.category !== 'all' && product.category !== state.category) {
                return false;
            }

            if (!matchesSupplier(product, state.supplier)) {
                return false;
            }

            if (state.rating > 0 && product.rating < state.rating) {
                return false;
            }

            if (!matchesLocation(product, state.location)) {
                return false;
            }

            if (state.minPrice !== null && product.price < state.minPrice) {
                return false;
            }

            if (state.maxPrice !== null && product.price > state.maxPrice) {
                return false;
            }

            if (state.searchTerm) {
                const q = normalize(state.searchTerm);
                const haystack = `${product.name} ${product.supplier} ${product.location}`.toLowerCase();
                if (!haystack.includes(q)) {
                    return false;
                }
            }

            return true;
        });
    }

    function renderProducts() {
        if (!grid) return;

        const filtered = getFilteredProducts();

        if (filtered.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:3rem; color:#888;">No products found</div>';
            return;
        }

        grid.innerHTML = filtered
            .map((product) => `
                <div class="product-card" onclick="openChat('${product.supplier.replace(/'/g, "\\'")}', '${product.supplierAvatar}', '${product.name.replace(/'/g, "\\'")}')">
                    <div class="product-image" style="background-image: url('${product.imageUrl}'); background-size: cover; background-position: center;"></div>
                    <div class="product-info">
                        <div class="product-supplier">${product.supplier}</div>
                        <div class="product-name">${product.name}</div>
                        <div class="product-price">PHP ${product.price.toFixed(2)}</div>
                        <div class="product-meta">
                            <span>${product.location}</span>
                            <span>${product.rating.toFixed(1)}</span>
                            <span class="chat-badge">chat</span>
                        </div>
                    </div>
                </div>
            `)
            .join('');
    }

    function updateActiveCategoryPills() {
        document.querySelectorAll('.category-pills .pill').forEach((pill) => {
            const onClick = pill.getAttribute('onclick') || '';
            pill.classList.toggle('active', onClick.includes(`filterCategory('${state.category}')`));
        });
    }

    function updateFilterOptionSelections(groupSelector, valueMatcher) {
        document.querySelectorAll(groupSelector).forEach((option) => {
            const onClick = option.getAttribute('onclick') || '';
            option.classList.toggle('active', valueMatcher(onClick));
        });
    }

    function renderChatList() {
        if (!chatList) return;

        let filteredChats = chats;
        if (state.chatTab === 'online') {
            filteredChats = chats.filter((chat) => chat.online);
        } else if (state.chatTab === 'archived') {
            filteredChats = chats.filter((chat) => !chat.online && chat.unread === 0);
        }

        if (filteredChats.length === 0) {
            chatList.innerHTML = '<div style="color:#888;padding:1rem;text-align:center;">No conversations in this tab.</div>';
            return;
        }

        chatList.innerHTML = filteredChats
            .map((chat) => `
                <div class="chat-item ${chat.id === state.selectedChatId ? 'active' : ''}" data-chat-id="${chat.id}" onclick="selectChat(${chat.id})">
                    <div class="chat-avatar">${chat.avatar}${chat.online ? '<span class="online-indicator"></span>' : ''}</div>
                    <div class="chat-info">
                        <div class="chat-name">${chat.name}<span class="chat-time">${chat.time}</span></div>
                        <div class="chat-preview">${chat.lastMessage}</div>
                    </div>
                    ${chat.unread ? `<div class="unread-badge">${chat.unread}</div>` : ''}
                </div>
            `)
            .join('');
    }

    function renderMessages(chat) {
        const messagesDiv = document.getElementById('chatMessages');
        const avatar = document.getElementById('currentChatAvatar');
        const name = document.getElementById('currentChatName');

        if (!messagesDiv || !avatar || !name) return;

        avatar.textContent = chat.avatar;
        name.textContent = chat.name;

        if (!Array.isArray(chat.messages) || chat.messages.length === 0) {
            messagesDiv.innerHTML = '<div style="color:#888;padding:1rem;text-align:center;">No messages yet</div>';
            return;
        }

        messagesDiv.innerHTML = chat.messages
            .map((message) => `
                <div class="message ${message.type}">
                    <div class="message-avatar">${message.type === 'incoming' ? chat.avatar : 'You'}</div>
                    <div class="message-bubble">
                        <div class="message-text">${message.text}</div>
                        <div class="message-time">${message.time}</div>
                    </div>
                </div>
            `)
            .join('');

        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }

    function getSelectedChat() {
        return chats.find((chat) => chat.id === state.selectedChatId) || chats[0];
    }

    function parsePriceInput(value) {
        if (!value || !value.trim()) return null;
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return null;
        return parsed;
    }

    window.filterCategory = function(category) {
        state.category = category || 'all';
        updateActiveCategoryPills();
        renderProducts();
        showNotification(`Showing ${state.category} category`);
    };

    window.searchProducts = function() {
        state.searchTerm = searchInput ? searchInput.value : '';
        renderProducts();
        showNotification(`Found ${getFilteredProducts().length} results`);
    };

    window.filterSupplier = function(supplier) {
        state.supplier = supplier || 'all';

        updateFilterOptionSelections('.filter-section .filter-option[onclick^="filterSupplier"]', (onClick) =>
            onClick.includes(`'${state.supplier}'`)
        );

        document.querySelectorAll('input[name="supplier"]').forEach((input) => {
            const parentOnClick = input.parentElement?.getAttribute('onclick') || '';
            input.checked = parentOnClick.includes(`'${state.supplier}'`);
        });

        renderProducts();
        showNotification(`Supplier filter: ${state.supplier}`);
    };

    window.filterRating = function(rating) {
        state.rating = Number(rating) || 0;

        updateFilterOptionSelections('.filter-section .filter-option[onclick^="filterRating"]', (onClick) =>
            onClick.includes(`(${state.rating})`)
        );

        renderProducts();
        showNotification(`Rating filter: ${state.rating}+ stars`);
    };

    window.filterLocation = function(location) {
        state.location = location || 'all';

        updateFilterOptionSelections('.filter-section .filter-option[onclick^="filterLocation"]', (onClick) =>
            onClick.includes(`'${state.location}'`)
        );

        renderProducts();
        showNotification(`Location filter: ${state.location}`);
    };

    window.applyFilters = function() {
        state.minPrice = parsePriceInput(minPriceInput ? minPriceInput.value : '');
        state.maxPrice = parsePriceInput(maxPriceInput ? maxPriceInput.value : '');

        if (
            state.minPrice !== null &&
            state.maxPrice !== null &&
            state.maxPrice < state.minPrice
        ) {
            showNotification('Max price must be greater than min price.');
            return;
        }

        renderProducts();
        showNotification(`Filters applied: ${getFilteredProducts().length} items`);
    };

    window.selectChat = function(chatId) {
        const numericChatId = Number(chatId);
        if (!Number.isFinite(numericChatId)) return;

        const selectedChat = chats.find((chat) => chat.id === numericChatId);
        if (!selectedChat) return;

        state.selectedChatId = numericChatId;
        selectedChat.unread = 0;

        renderChatList();
        renderMessages(selectedChat);
    };

    window.openChat = function(supplier, _avatar, product) {
        const selectedChat = chats.find((chat) => chat.name === supplier);
        if (!selectedChat) {
            showNotification(`No active chat thread for ${supplier}.`);
            return;
        }

        window.selectChat(selectedChat.id);
        const input = document.getElementById('chatMessageInput');
        if (input) input.focus();
        showNotification(`Chat with ${supplier} about ${product}`);
    };

    window.sendMessage = function() {
        const input = document.getElementById('chatMessageInput');
        if (!input) return;

        const text = input.value.trim();
        if (!text) return;

        const chat = getSelectedChat();
        if (!chat.messages) chat.messages = [];

        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        chat.messages.push({ sender: 'You', text, time: timestamp, type: 'outgoing' });
        chat.lastMessage = text;
        chat.time = 'now';

        input.value = '';
        renderChatList();
        renderMessages(chat);

        setTimeout(() => {
            const autoReply = 'Thanks for your message. We will confirm stock and delivery options shortly.';
            const replyTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            chat.messages.push({ sender: chat.name, text: autoReply, time: replyTimestamp, type: 'incoming' });
            chat.lastMessage = autoReply;
            chat.time = 'just now';
            renderChatList();
            renderMessages(chat);
        }, 1200);
    };

    window.switchChatTab = function(tab) {
        state.chatTab = tab || 'recent';

        document.querySelectorAll('.chat-tab').forEach((tabEl) => {
            const onClick = tabEl.getAttribute('onclick') || '';
            tabEl.classList.toggle('active', onClick.includes(`'${state.chatTab}'`));
        });

        renderChatList();

        const selectedChat = getSelectedChat();
        renderMessages(selectedChat);
        showNotification(`Showing ${state.chatTab} chats`);
    };

    if (searchInput) {
        searchInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.searchProducts();
            }
        });
    }

    const chatMessageInput = document.getElementById('chatMessageInput');
    if (chatMessageInput) {
        chatMessageInput.addEventListener('keypress', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                window.sendMessage();
            }
        });
    }

    updateActiveCategoryPills();
    renderProducts();
    renderChatList();
    renderMessages(getSelectedChat());
})();
