document.addEventListener('DOMContentLoaded', function() {
    createStars();
    initNotificationSystem();
    initHamburgerMenu();
    initCounterAnimation();
    initSmoothScroll();
    initPlanSelection();
    initHomePreviewImage();

    console.log('PRISM: All systems ready');
});

// ----- Notification System -----

function initNotificationSystem() {
    window.showNotification = function(message) {
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
    };
}

// ----- Stars Background -----

function createStars() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;

    starsContainer.innerHTML = '';
    const starCount = 200;

    for (let i = 0; i < starCount; i += 1) {
        const star = document.createElement('div');
        star.className = 'star';

        const size = Math.random() * 3 + 1;
        const x = Math.random() * 100;
        const y = Math.random() * 100;
        const opacity = Math.random() * 0.8 + 0.2;
        const duration = Math.random() * 3 + 2;

        star.style.cssText = `
            left: ${x}%;
            top: ${y}%;
            width: ${size}px;
            height: ${size}px;
            opacity: ${opacity};
            animation-duration: ${duration}s;
        `;

        starsContainer.appendChild(star);
    }
}

// ----- Hamburger Menu -----

function initHamburgerMenu() {
    const hamburger = document.getElementById('hamburgerBtn');
    const navLinks = document.getElementById('navLinks');

    if (!hamburger || !navLinks) return;

    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('active');
    });

    document.querySelectorAll('.nav-links a').forEach((link) => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
        });
    });

    document.addEventListener('click', (event) => {
        if (!hamburger.contains(event.target) && !navLinks.contains(event.target)) {
            navLinks.classList.remove('active');
        }
    });
}

// ----- Counter Animation -----

function initCounterAnimation() {
    const shopsElement = document.getElementById('shopsCount');
    const fairnessElement = document.getElementById('fairnessCount');
    const anomaliesElement = document.getElementById('anomaliesCount');

    if (!shopsElement || !fairnessElement || !anomaliesElement) return;

    function animateCounter(element, target, suffix = '') {
        let current = 0;
        const increment = target / 60;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                element.innerHTML = target.toLocaleString() + suffix;
                clearInterval(timer);
            } else {
                element.innerHTML = Math.floor(current).toLocaleString() + suffix;
            }
        }, 33);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                animateCounter(shopsElement, 1240);
                animateCounter(fairnessElement, 82, '<small>%</small>');
                animateCounter(anomaliesElement, 3214);
                observer.disconnect();
            }
        });
    }, { threshold: 0.5 });

    const impactSection = document.querySelector('.market-impact');
    if (impactSection) observer.observe(impactSection);
}

// ----- Smooth Scroll -----

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', function(event) {
            event.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}

// ----- Plan Selection -----

function initPlanSelection() {
    const planCards = document.querySelectorAll('.pricing-container .card');
    if (!planCards.length) return;

    planCards.forEach((card) => {
        card.addEventListener('click', () => {
            const planName = card.querySelector('h3')?.textContent?.trim() || 'Basic';
            localStorage.setItem('prism_selected_plan', planName);
            showNotification(`${planName} plan selected. Redirecting...`);

            setTimeout(() => {
                window.location.href = '/web/create-account/create-account.html';
            }, 700);
        });
    });
}

// ----- Home Preview Image -----

function initHomePreviewImage() {
    const previewImage = document.querySelector('.home-preview-img');
    if (!previewImage) return;

    // Remove stale inline handler that references a missing modal node.
    previewImage.removeAttribute('onclick');

    previewImage.addEventListener('click', () => {
        window.open(previewImage.src, '_blank', 'noopener');
    });
}
