document.addEventListener('DOMContentLoaded', function() {

    createStars();
    initHamburgerMenu();
    initCounterAnimation();
    initSmoothScroll();

    console.log('PRISM: All systems ready');
});

// ----- Stars Background -----

function createStars() {
    const starsContainer = document.getElementById('stars');
    if (!starsContainer) return;
    
    const starCount = 200;
    
    for (let i = 0; i < starCount; i++) {
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

    document.querySelectorAll('.nav-links a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('active');
        });
    });

    document.addEventListener('click', (e) => {
        if (!hamburger.contains(e.target) && !navLinks.contains(e.target)) {
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
        entries.forEach(entry => {
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
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });
}