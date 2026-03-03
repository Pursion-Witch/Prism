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

// Notification system

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

// Team cards

            document.querySelectorAll('.team-card').forEach(card => {
                card.addEventListener('click', () => {
                    const name = card.querySelector('h3').textContent;
                    showNotification(`${name}'s profile`);
                });
            });

// Value cards

            document.querySelectorAll('.value-card').forEach(card => {
                card.addEventListener('click', () => {
                    const value = card.querySelector('h3').textContent;
                    showNotification(`${value} — core to our mission`);
                });
            });

            const partnerButton = document.querySelector('.cta-section .btn-outline');
            if (partnerButton) {
                partnerButton.addEventListener('click', () => {
                    const subject = encodeURIComponent('PRISM Partnership Inquiry');
                    const body = encodeURIComponent('Hello PRISM team,%0D%0A%0D%0AWe are interested in partnering with PRISM.%0D%0A');
                    window.location.href = `mailto:prism@gmail.com?subject=${subject}&body=${body}`;
                });
            }
        })();
