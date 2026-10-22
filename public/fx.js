'use strict';
/*
 * Hacker look: faded matrix rain, the hero terminal typing itself out, a quick "decrypt" on section
 * headings and scroll reveals. Purely decorative: everything is skipped for visitors who ask for
 * reduced motion, and the page reads the same if this file fails to load.
 */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('fx');

  const RAIN = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEF<>/{}[]$#*+=';
  // Headings scramble through Latin glyphs only, so they never flash as unreadable script.
  const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*';
  const pick = (set) => set[(Math.random() * set.length) | 0];

  function matrix() {
    const canvas = document.createElement('canvas');
    canvas.id = 'matrix';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const size = 16;
    let drops = [];
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${size}px 'JetBrains Mono', monospace`;
      const cols = Math.ceil(innerWidth / size);
      drops = Array.from({ length: cols }, (_, i) => drops[i] ?? (Math.random() * -innerHeight) / size);
    }
    resize();
    addEventListener('resize', resize);

    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (document.hidden || t - last < 60) return; // ~16 fps is plenty and easy on phone batteries
      last = t;
      ctx.fillStyle = 'rgba(10, 14, 19, .14)';
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * size;
        ctx.fillStyle = Math.random() > 0.975 ? '#eafff5' : '#36d399';
        ctx.fillText(pick(RAIN), i * size, y);
        if (y > innerHeight && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    requestAnimationFrame(frame);
  }

  /** Types the hero terminal line by line, then leaves a blinking cursor. */
  function terminal() {
    const pre = document.getElementById('term');
    if (!pre) return;
    const lines = pre.innerHTML.split('\n');
    pre.innerHTML = '';
    let i = 0;
    (function next() {
      if (i === lines.length) {
        pre.insertAdjacentHTML('beforeend', '\n<span class="p">$</span> <span class="cursor"></span>');
        return;
      }
      pre.insertAdjacentHTML('beforeend', (i ? '\n' : '') + lines[i++]);
      setTimeout(next, 260 + Math.random() * 220);
    })();
  }

  function decrypt(el) {
    if (el.children.length || el.dataset.decrypted) return;
    el.dataset.decrypted = '1';
    const text = el.textContent;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const solved = Math.floor(frame * 1.6);
      el.textContent = [...text].map((c, i) => (i < solved || c === ' ' ? c : pick(SCRAMBLE))).join('');
      if (solved >= text.length) {
        clearInterval(id);
        el.textContent = text;
      }
    }, 24);
  }

  function reveals() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          if (e.target.matches('h2')) decrypt(e.target);
          io.unobserve(e.target);
        }
      },
      { threshold: 0.12 }
    );
    document.querySelectorAll('.section-head h2, .cta-band h2, main .card, .steps-3 .panel, .faq details').forEach((el, i) => {
      if (!el.matches('h2')) el.style.transitionDelay = `${(i % 3) * 80}ms`;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  function start() {
    matrix();
    terminal();
    reveals();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
