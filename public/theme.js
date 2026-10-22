'use strict';
/*
 * Light / dark theme. Loaded in <head> without defer, so the theme is set before the page is drawn and there is no
 * flash of the wrong colours. A visitor's choice is remembered; until they choose, the device setting decides.
 */
(function () {
  var KEY = 'tc-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null; // storage blocked (private mode): fall back to the device setting
    }
  }
  function current() {
    return root.getAttribute('data-theme') || 'dark';
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#eef1f4' : '#0b1016');
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
      var label = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  apply(saved() || (media && media.matches ? 'light' : 'dark'));
  if (media && media.addEventListener) {
    media.addEventListener('change', function (e) {
      if (!saved()) apply(e.matches ? 'light' : 'dark');
    });
  }

  function addToggle() {
    var bar = document.querySelector('.topbar .row');
    if (!bar || bar.querySelector('.theme-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.innerHTML =
      '<svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' +
      '<svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
    btn.addEventListener('click', function () {
      var next = current() === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {
        // not remembered, but still switches for this page
      }
      apply(next);
    });
    var actions = bar.querySelector('.nav-actions');
    if (actions) actions.after(btn);
    else bar.appendChild(btn);
    apply(current());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle);
  else addToggle();
})();
