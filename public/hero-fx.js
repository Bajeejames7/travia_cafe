'use strict';
/*
 * Home page only, purely decorative: code rain behind the hero and the terminal typing out the real course list.
 * Respects reduced motion (no rain, terminal shown already typed) and pauses the rain when it is off screen or the
 * tab is hidden, so it costs nothing while nobody is looking.
 */
(() => {
  const band = document.querySelector('.hero-band');
  const pre = document.getElementById('term');
  if (!band || !pre) return;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- code rain
  function rain() {
    const canvas = document.createElement('canvas');
    canvas.className = 'rain';
    canvas.setAttribute('aria-hidden', 'true');
    band.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const SIZE = 15;
    const GLYPHS = '0101010110100110ABCDEF<>/{}#$'; // mostly binary, like the logo
    let cols = [];
    let w = 0;
    let h = 0;
    let visible = true;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = band.clientWidth;
      h = band.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${SIZE}px 'JetBrains Mono', monospace`;
      // Only some columns rain, which keeps it calm rather than a wall of characters.
      cols = Array.from({ length: Math.ceil(w / SIZE) }, (_, i) => (i in cols ? cols[i] : Math.random() < 0.3 ? (Math.random() * -h) / SIZE : null));
    }
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(band);
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(band);

    let last = 0;
    function frame(t) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden || t - last < 70) return; // ~14 fps is plenty and easy on phones
      last = t;
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      // Fade old characters towards transparent (not towards a colour), so the hero background shows through.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0, 0, 0, .13)';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < cols.length; i++) {
        if (cols[i] === null) continue;
        const y = cols[i] * SIZE;
        const head = Math.random() > 0.96;
        ctx.fillStyle = light ? (head ? '#0b4d22' : '#15803d') : head ? '#e3ffe0' : '#4fe74b';
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * SIZE, y);
        if (y > h && Math.random() > 0.975) cols[i] = 0;
        cols[i]++;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- terminal
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const slug = (t) =>
    t
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const money = (n) => `KSh ${Number(n || 0).toLocaleString('en-KE')}`;

  /** Command lines are typed out; output lines appear at once. */
  function script(catalog) {
    const mods = catalog && catalog.modules.length ? catalog.modules.slice(0, 3) : null;
    const first = mods && mods[0];
    return [
      { cmd: 'ls ~/courses' },
      ...(mods ? mods.map((m) => ({ out: `<span class="hl">${esc(slug(m.title))}/</span>` })) : [{ out: '<span class="dim">new courses coming soon</span>' }]),
      { cmd: `./enrol ${first ? slug(first.title) : 'your-course'}` },
      { out: '<span class="ok">[ ok ]</span> track ...... self-paced' },
      { out: `<span class="ok">[ ok ]</span> M-PESA ..... ${first ? `${money(first.price_self)} paid` : 'paid'}` },
      { out: '<span class="ok">[ ok ]</span> access ..... granted' },
      { cmd: './start-learning' },
    ];
  }
  const PROMPT = '<span class="p">$</span> ';
  const CURSOR = '<span class="term-cursor"></span>';

  function render(lines, cursorOnLast) {
    pre.innerHTML = lines.join('\n') + (cursorOnLast ? CURSOR : '');
  }

  function play(catalog) {
    const steps = script(catalog);
    const caption = document.getElementById('termCaption');
    if (caption && catalog && catalog.modules.length) {
      const from = Math.min(...catalog.modules.map((m) => Math.min(m.price_self, m.price_live, m.price_physical)));
      caption.textContent = `${catalog.modules.length} course${catalog.modules.length === 1 ? '' : 's'} · from ${money(from)} · Pay with M-PESA`;
    }
    const done = steps.map((s) => (s.cmd ? PROMPT + esc(s.cmd) : s.out));
    if (calm) return render(done, true);

    const shown = [];
    let i = 0;
    (function next() {
      if (i === steps.length) return render(shown, true);
      const s = steps[i++];
      if (s.out) {
        shown.push(s.out);
        render(shown, false);
        return setTimeout(next, 140);
      }
      let n = 0;
      (function type() {
        n++;
        render([...shown, PROMPT + esc(s.cmd.slice(0, n))], true);
        if (n < s.cmd.length) return setTimeout(type, 28 + Math.random() * 45);
        shown.push(PROMPT + esc(s.cmd));
        setTimeout(next, 380);
      })();
    })();
  }

  // ---------------------------------------------------------------- glitch
  /**
   * Shaky and glitchy all the time (styles.css .glitchy): a constant jitter plus two torn red/cyan copies of the
   * text, and every 2–5 seconds a stronger burst (.glitching). The copies are aria-hidden, so a screen reader reads
   * the headline once. Bursts are skipped while nobody can see the headline.
   */
  function glitch() {
    const h1 = band.querySelector('h1');
    if (!h1) return;
    const text = h1.textContent;
    for (const tone of ['red', 'cyan']) {
      const copy = document.createElement('span');
      copy.className = `g g-${tone}`;
      copy.setAttribute('aria-hidden', 'true');
      copy.textContent = text;
      h1.append(copy);
    }
    h1.classList.add('glitchy');
    (function schedule() {
      setTimeout(() => {
        const onScreen = h1.getBoundingClientRect().bottom > 0;
        if (!document.hidden && onScreen) {
          h1.classList.add('glitching');
          setTimeout(() => h1.classList.remove('glitching'), 500);
        }
        schedule();
      }, 2000 + Math.random() * 3000);
    })();
  }

  function start() {
    if (!calm) {
      rain();
      glitch();
    }
    // The course list comes from app.js; if it is slow or fails, type the generic version.
    let started = false;
    const go = (c) => {
      if (started) return;
      started = true;
      play(c);
    };
    if (window.tcCatalog) go(window.tcCatalog);
    else {
      document.addEventListener('tc:catalog', (e) => go(e.detail), { once: true });
      setTimeout(() => go(null), 2500);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
