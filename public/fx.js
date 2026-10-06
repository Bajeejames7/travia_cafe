'use strict';
/*
 * Hacker look: matrix rain background, a one-time boot screen, typewriter and
 * "decrypt" headings, and scroll reveals. Everything is skipped for visitors who
 * ask for reduced motion, and the page works the same if this file fails to load.
 */
(() => {
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (calm) return;
  document.documentElement.classList.add('fx');

  const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}[]$#*+=';
  const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

  /* ---- Matrix rain ---- */
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
      if (document.hidden || t - last < 55) return; // ~18 fps is plenty and easy on phones
      last = t;
      ctx.fillStyle = 'rgba(11, 15, 20, .12)';
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      for (let i = 0; i < drops.length; i++) {
        const y = drops[i] * size;
        ctx.fillStyle = Math.random() > 0.975 ? '#eafff5' : '#36d399';
        ctx.fillText(pick(), i * size, y);
        if (y > innerHeight && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---- Typewriter: types the element's own text, keeps the full text for screen readers ---- */
  function typewriter(el, speed = 38) {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    el.classList.add('cursor');
    let i = 0;
    return new Promise((done) => {
      (function tick() {
        el.textContent = text.slice(0, ++i);
        if (i < text.length) setTimeout(tick, speed + Math.random() * 40);
        else done();
      })();
    });
  }

  /* ---- Decrypt: scrambles a heading and resolves it left to right ---- */
  function decrypt(el) {
    if (el.children.length || el.dataset.decrypted) return;
    el.dataset.decrypted = '1';
    const text = el.textContent;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const solved = Math.floor(frame / 2);
      el.textContent = [...text].map((c, i) => (i < solved || c === ' ' ? c : pick())).join('');
      if (solved >= text.length) {
        clearInterval(id);
        el.textContent = text;
      }
    }, 30);
  }

  /* ---- Scroll reveals ---- */
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
      { threshold: 0.15 }
    );
    document.querySelectorAll('main h2, .card, .steps li').forEach((el, i) => {
      if (el.matches('.card, .steps li')) el.style.transitionDelay = `${(i % 3) * 90}ms`;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  /* ---- Boot screen: home page only, once per browser session, click/key to skip ---- */
  function boot() {
    let seen = false;
    try {
      seen = sessionStorage.getItem('tc-boot') === '1';
      sessionStorage.setItem('tc-boot', '1');
    } catch {}
    if (seen || !document.querySelector('.hero h1[data-type]')) return Promise.resolve();

    const lines = [
      'TRAVIA CAFE // secure terminal v2.6',
      '[ ok ] loading kernel modules ........ done',
      '[ ok ] mounting /labs ................ done',
      '[ ok ] starting firewall ............. active',
      '[ ok ] handshake with training node .. 200',
      '[ ** ] access granted. welcome, operator.',
    ];
    const box = document.createElement('div');
    box.id = 'boot';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<pre></pre><span class="skip">click or press any key to skip</span>';
    document.body.append(box);
    const pre = box.querySelector('pre');

    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        box.classList.add('done');
        setTimeout(() => box.remove(), 450);
        removeEventListener('keydown', finish);
        resolve();
      };
      box.addEventListener('click', finish);
      addEventListener('keydown', finish);
      let n = 0;
      (function next() {
        if (finished) return;
        if (n === lines.length) return setTimeout(finish, 450);
        pre.textContent += `${lines[n++]}\n`;
        setTimeout(next, 170 + Math.random() * 140);
      })();
    });
  }

  /* ---- Hero heading: types in, then glitches now and then ---- */
  async function hero() {
    const h1 = document.querySelector('.hero h1[data-type]');
    if (!h1) return;
    await typewriter(h1);
    setInterval(() => {
      h1.classList.add('glitching');
      setTimeout(() => h1.classList.remove('glitching'), 320);
    }, 6000);
  }

  function start() {
    matrix();
    reveals();
    const eyebrow = document.querySelector('.eyebrow');
    if (eyebrow && !eyebrow.textContent.startsWith('>')) eyebrow.textContent = `> ${eyebrow.textContent}`;
    boot().then(hero);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
