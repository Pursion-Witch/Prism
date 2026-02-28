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

// Scroll to section

            window.scrollToSection = function(section) {
                const element = document.getElementById(`section-${section}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    showNotification(`Jumping to section ${section}`);
                }
            };

// Accept privacy

            window.acceptPrivacy = function() {
                document.getElementById('consentBar').style.display = 'none';
                showNotification('Thank you for accepting our Privacy Policy');
            };

// TOC items clickable

            document.querySelectorAll('.toc-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const section = item.textContent.trim().split(' ')[1].toLowerCase().replace(/[^a-z]/g, '');
                    scrollToSection(section);
                });
            });
        })();