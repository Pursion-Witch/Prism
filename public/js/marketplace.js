        (function() {
// Stars background
            function createStars() {
                const stars = document.getElementById('stars');
                if (!stars) return;
                for (let i = 0; i < 180; i++) {
                    let s = document.createElement('div');
                    s.className = 'star';
                    s.style.cssText = `left:${Math.random()*100}%; 
                    top:${Math.random()*100}%; 
                    width:${Math.random()*3+1}px; 
                    height:${Math.random()*3+1}px; 
                    animation-delay:${Math.random()*3}s`;
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

// Notification helper

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

// Product Data Base

            const products = [
                // Rice & Grains
                { id:1, name:'Sinandomeng Rice (50kg)', supplier:'Mega Mart', price:2450, imageUrl:'images/sinandomeng.png', category:'rice', location:'Bulacan', rating:4.8, supplierAvatar:'MM' },
                { id:2, name:'Jasmine Rice (25kg)', supplier:'Mega Mart', price:1350, imageUrl:'images/jasmine.jpg', category:'rice', location:'Bulacan', rating:4.7, supplierAvatar:'MM' },
                { id:3, name:'Dinorado Rice (10kg)', supplier:'Palengke Direct', price:680, imageUrl:'images/rice3.png', category:'rice', location:'Nueva Ecija', rating:4.9, supplierAvatar:'PD' },
                { id:4, name:'Brown Rice (5kg)', supplier:'FarmFresh', price:320, imageUrl:'images/rice4.png', category:'rice', location:'Isabela', rating:4.6, supplierAvatar:'FF' },
                // Meat
                { id:5, name:'Whole Chicken (1kg)', supplier:'FarmFresh', price:180, imageUrl:'images/chicken.jpg', category:'meat', location:'Laguna', rating:4.8, supplierAvatar:'FF' },
                { id:6, name:'Pork Liempo (1kg)', supplier:'FarmFresh', price:340, imageUrl:'images/pork-liempo.jpg', category:'meat', location:'Pampanga', rating:4.7, supplierAvatar:'FF' },
                { id:7, name:'Beef Sirloin (1kg)', supplier:'Mega Mart', price:520, imageUrl:'images/beef.png', category:'meat', location:'Bulacan', rating:4.8, supplierAvatar:'MM' },
                { id:8, name:'Chicken Thighs (1kg)', supplier:'Palengke Direct', price:165, imageUrl:'images/thighs.webp', category:'meat', location:'Laguna', rating:4.6, supplierAvatar:'PD' },
                { id:9, name:'Ground Pork (1kg)', supplier:'Tindahan PH', price:290, imageUrl:'images/pork.jpg', category:'meat', location:'Manila', rating:4.5, supplierAvatar:'TP' },
                // Vegetables
                { id:10, name:'Red Onions (1kg)', supplier:'Palengke Direct', price:80, imageUrl:'images/onions.webp', category:'vegetables', location:'Nueva Ecija', rating:4.7, supplierAvatar:'PD' },
                { id:11, name:'Garlic (1kg)', supplier:'Palengke Direct', price:100, imageUrl:'images/garlic.webp', category:'vegetables', location:'Ilocos', rating:4.8, supplierAvatar:'PD' },
                { id:12, name:'Potatoes (1kg)', supplier:'FarmFresh', price:75, imageUrl:'images/potato.webp', category:'vegetables', location:'Benguet', rating:4.6, supplierAvatar:'FF' },
                { id:13, name:'Tomatoes (1kg)', supplier:'Tindahan PH', price:65, imageUrl:'images/tomato.webp', category:'vegetables', location:'Mindanao', rating:4.4, supplierAvatar:'TP' },
                { id:14, name:'Carrots (1kg)', supplier:'Mega Mart', price:85, imageUrl:'images/carrots.webp', category:'vegetables', location:'Benguet', rating:4.5, supplierAvatar:'MM' },
                { id:15, name:'Cabbage (1 head)', supplier:'FarmFresh', price:45, imageUrl:'images/cabbage.webp', category:'vegetables', location:'Benguet', rating:4.6, supplierAvatar:'FF' },
                // Canned
                { id:16, name:'Corned Beef (380g)', supplier:'Tindahan PH', price:85, imageUrl:'images/corned-beef.png', category:'canned', location:'Manila', rating:4.5, supplierAvatar:'TP' },
                { id:17, name:'Sardines (155g)', supplier:'Tindahan PH', price:18, imageUrl:'images/sardines.jpg', category:'canned', location:'Zamboanga', rating:4.4, supplierAvatar:'TP' },
                { id:18, name:'Tuna Flakes (180g)', supplier:'Mega Mart', price:42, imageUrl:'images/tuna.jpg', category:'canned', location:'General Santos', rating:4.6, supplierAvatar:'MM' },
                // Noodles
                { id:20, name:'Lucky Me Beef (60g x30)', supplier:'Mega Mart', price:285, imageUrl:'images/lucky-me.webp', category:'noodles', location:'Quezon City', rating:4.7, supplierAvatar:'MM' },
                { id:21, name:'Pancit Canton (80g x30)', supplier:'Mega Mart', price:450, imageUrl:'images/canton.jpg', category:'noodles', location:'Quezon City', rating:4.8, supplierAvatar:'MM' },
                // Beverages
                { id:23, name:'Coca-Cola (1.5L x12)', supplier:'Tindahan PH', price:720, imageUrl:'images/coke.png', category:'beverages', location:'Makati', rating:4.6, supplierAvatar:'TP' },
                { id:24, name:'Mineral Water (6L x4)', supplier:'FarmFresh', price:200, imageUrl:'images/water.webp', category:'beverages', location:'Rizal', rating:4.7, supplierAvatar:'FF' },
                { id:25, name:'Energy Drink (250ml x24)', supplier:'Mega Mart', price:720, imageUrl:'images/energy.webp', category:'beverages', location:'Bulacan', rating:4.5, supplierAvatar:'MM' },
                { id:26, name:'Coffee (3in1 x50)', supplier:'Tindahan PH', price:380, imageUrl:'images/coffee.jpg', category:'beverages', location:'Manila', rating:4.6, supplierAvatar:'TP' },
                { id:27, name:'Cooking Oil (1L x6)', supplier:'Mega Mart', price:270, imageUrl:'images/oil.webp', category:'canned', location:'Bulacan', rating:4.7, supplierAvatar:'MM' },
                { id:28, name:'Eggs (30pcs)', supplier:'FarmFresh', price:210, imageUrl:'images/egg.jpg', category:'meat', location:'Laguna', rating:4.8, supplierAvatar:'FF' },
            ];

// Chat data 

            const chats = [
                { id: 1, name: 'Mega Mart', avatar: 'MM', lastMessage: 'Available po ang rice today', time: '2m ago', unread: 2, online: true, messages: [
                    { sender: 'Mega Mart', text: 'Hello! We have fresh Sinandomeng rice today.', time: '10:30 AM', type: 'incoming' },
                    { sender: 'You', text: 'How much per kilo?', time: '10:32 AM', type: 'outgoing' },
                    { sender: 'Mega Mart', text: '₱49/kilo for bulk orders. How many kg?', time: '10:33 AM', type: 'incoming' },
                    { sender: 'You', text: 'I need 50kg for our store', time: '10:35 AM', type: 'outgoing' },
                    { sender: 'Mega Mart', text: 'Great! We can deliver tomorrow. Total ₱2,450', time: '10:36 AM', type: 'incoming' }
                ]},
                { id: 2, name: 'Palengke Direct', avatar: 'PD', lastMessage: 'Sibuyas price updated to ₱75/kg', time: '15m ago', unread: 0, online: true, messages: [
                    { sender: 'Palengke Direct', text: 'Sibuyas and bawang from Nueva Ecija!', time: '9:15 AM', type: 'incoming' },
                    { sender: 'You', text: 'Anong presyo ng sibuyas?', time: '9:17 AM', type: 'outgoing' },
                    { sender: 'Palengke Direct', text: '₱75/kg po. Bawang ₱95/kg', time: '9:18 AM', type: 'incoming' }
                ]},
                { id: 3, name: 'FarmFresh', avatar: 'FF', lastMessage: 'Whole chicken available ₱175/kg', time: '1h ago', unread: 1, online: true, messages: [
                    { sender: 'FarmFresh', text: 'Farm fresh chicken and pork available.', time: '11:00 AM', type: 'incoming' },
                    { sender: 'You', text: 'Whole chicken po?', time: '11:02 AM', type: 'outgoing' },
                    { sender: 'FarmFresh', text: 'Yes, ₱175/kg today. How many?', time: '11:03 AM', type: 'incoming' }
                ]},
                { id: 4, name: 'Tindahan PH', avatar: 'TP', lastMessage: 'Cooking oil sale! ₱250/6L', time: '3h ago', unread: 0, online: false, messages: [] },
            ];

// Products with background images

            const grid = document.getElementById('productsGrid');
            function renderProducts(category = 'all') {
                let html = '';
                const filtered = category === 'all' ? products : products.filter(p => p.category === category);
                filtered.forEach(p => {
                    html += `
                        <div class="product-card" onclick="openChat('${p.supplier}', '${p.supplierAvatar}', '${p.name}')">
                            <div class="product-image" style="background-image: url('${p.imageUrl}'); background-size: cover; background-position: center;"></div>
                            <div class="product-info">
                                <div class="product-supplier"><span style="opacity:0.6;"></span> ${p.supplier}</div>
                                <div class="product-name">${p.name}</div>
                                <div class="product-price">₱${p.price.toFixed(2)}</div>
                                <div class="product-meta">
                                    <span>${p.location}</span>
                                    <span> ${p.rating}</span>
                                    <span class="chat-badge"> chat</span>
                                </div>
                            </div>
                        </div>
                    `;
                });
                grid.innerHTML = html || '<div style="grid-column:1/-1; text-align:center; padding:3rem; color:#888;">No products found</div>';
            }
            renderProducts();

// Filter stubs

            window.filterCategory = function(cat) {
                document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
                if (event && event.target) event.target.classList.add('active');
                renderProducts(cat);
                showNotification(`Showing ${cat} category`);
            };
            window.searchProducts = function() {
                const term = document.getElementById('searchInput').value.toLowerCase();
                const filtered = products.filter(p => p.name.toLowerCase().includes(term) || p.supplier.toLowerCase().includes(term));
                let html = '';
                filtered.forEach(p => { html += `<div class="product-card" onclick="openChat('${p.supplier}', '${p.supplierAvatar}', '${p.name}')">
                    <div class="product-image" style="background-image: url('${p.imageUrl}'); background-size: cover;">
                    </div><div class="product-info"><div class="product-supplier">${p.supplier}</div><div class="product-name">${p.name}
                    </div><div class="product-price">₱${p.price}</div></div></div>`; });
                grid.innerHTML = html || '<div style="grid-column:1/-1; text-align:center; padding:3rem;">No products</div>';
                showNotification(`Found ${filtered.length} results`);
            };

// Render chat list

            const chatList = document.getElementById('chatList');
            function renderChatList(tab = 'recent') {
                let html = '';
                const filtered = tab === 'online' ? chats.filter(c => c.online) : chats;
                filtered.forEach(chat => {
                    html += `<div class="chat-item ${chat.id === 1 ? 'active' : ''}" onclick="selectChat(${chat.id})">
                    <div class="chat-avatar">${chat.avatar}${chat.online ? '<span class="online-indicator"></span>' : ''}
                    </div><div class="chat-info"><div class="chat-name">${chat.name}<span class="chat-time">${chat.time}
                    </span></div><div class="chat-preview">${chat.lastMessage}</div></div>${chat.unread ? `<div class="unread-badge">
                        ${chat.unread}</div>` : ''}</div>`;
                });
                chatList.innerHTML = html;
            }
            renderChatList();

            let currentChat = chats[0];
            window.selectChat = function(chatId) {
                currentChat = chats.find(c => c.id === chatId);
                document.querySelectorAll('.chat-item').forEach(i => i.classList.remove('active'));
                event.currentTarget.classList.add('active');
                document.getElementById('currentChatAvatar').textContent = currentChat.avatar;
                document.getElementById('currentChatName').textContent = currentChat.name;
                currentChat.unread = 0;
                renderChatList();
                renderMessages(currentChat);
            };

            function renderMessages(chat) {
                const messagesDiv = document.getElementById('chatMessages');
                let html = '';
                if (chat.messages) chat.messages.forEach(msg => { html += `<div class="message ${msg.type}"><div class="message-avatar">${msg.type==='incoming'?chat.avatar:'You'}</div><div class="message-bubble"><div class="message-text">${msg.text}</div><div class="message-time">${msg.time}</div></div></div>`; });
                messagesDiv.innerHTML = html || '<div style="color:#888;padding:1rem;text-align:center">No messages yet</div>';
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            window.openChat = function(supplier, avatar, product) {
                const chat = chats.find(c => c.name === supplier) || chats[0];
                selectChat(chat.id);
                document.getElementById('chatMessageInput').focus();
                showNotification(`Chat with ${supplier} about ${product}`);
            };

            window.sendMessage = function() {
                const input = document.getElementById('chatMessageInput');
                const text = input.value.trim();
                if (!text || !currentChat) return;
                if (!currentChat.messages) currentChat.messages = [];
                currentChat.messages.push({ sender: 'You', text: text, time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), type: 'outgoing' });
                renderMessages(currentChat);
                input.value = '';
                setTimeout(() => {
                    currentChat.messages.push({ sender: currentChat.name, text: 'Thanks for your message! We\'ll check availability.', time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }), type: 'incoming' });
                    renderMessages(currentChat);
                }, 1500);
            };

            window.switchChatTab = function(tab) {
                document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
                if (event) event.target.classList.add('active');
                renderChatList(tab);
            };

            document.getElementById('chatMessageInput').addEventListener('keypress', function(e) { if (e.key === 'Enter') sendMessage(); });
            renderMessages(chats[0]);

// Filter stubs

            window.filterSupplier = (s) => showNotification(`Filter by supplier: ${s}`);
            window.filterRating = (r) => showNotification(`Filter by rating: ${r}+ stars`);
            window.filterLocation = (l) => showNotification(`Filter by location: ${l}`);
            window.applyFilters = () => showNotification('Filters applied');
        })();