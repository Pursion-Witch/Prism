        (function() {
            
// Stars background

            function createStars() {
                const stars = document.getElementById('stars');
                if (!stars) return;
                for (let i = 0; i < 180; i++) {
                    let s = document.createElement('div');
                    s.className = 'star';
                    s.style.cssText = `left:${Math.random()*100}%; top:${Math.random()*100}%; width:${Math.random()*3+1}px; height:${Math.random()*3+1}px; animation-delay:${Math.random()*3}s`;
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

// Notification

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

// Tab switching

            window.switchAdminTab = function(tab) {
                document.querySelectorAll('.admin-nav li').forEach(li => li.classList.remove('active'));
                event.target.classList.add('active');
                
                document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
                document.getElementById(`section-${tab}`).classList.add('active');
                
                showNotification(`Switched to ${tab} section`);
            };

            document.querySelectorAll('.action-btn, .btn-primary, .btn-secondary').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            });
        })();
