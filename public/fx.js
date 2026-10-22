'use strict';
/*
 * A gentle fade-in as sections scroll into view. Purely decorative: skipped for visitors who ask for
 * reduced motion, and the page reads the same if this file fails to load.
 */
(() => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('fx');

  function start() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.section-head, main .grid3 .card, .flow, .faq details').forEach((el, i) => {
      el.style.transitionDelay = `${(i % 3) * 70}ms`;
      el.classList.add('reveal');
      io.observe(el);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
