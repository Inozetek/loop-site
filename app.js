/* Loop – AI Concierge — unveil motion. Vanilla, no dependencies, no tracking.
   Progressive: every element is visible without this file (the .reveal hide is
   gated on html.js, and the scrubbed art defaults to --p:1). Under
   prefers-reduced-motion nothing animates: everything is shown immediately. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var reveals = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var stages = Array.prototype.slice.call(document.querySelectorAll('[data-scrub]'));
  var nav = document.getElementById('nav');

  function showAll() { reveals.forEach(function (el) { el.classList.add('in'); }); }

  /* 1. Staggered fade/rise/de-blur reveals (delay comes from --d in CSS). */
  if (reduce || !('IntersectionObserver' in window)) {
    showAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
  }

  /* 2. Word-by-word illumination of the manifesto, scrubbed by scroll. */
  var words = [];
  var manifesto = document.querySelector('[data-scrub-words]');
  if (manifesto && !reduce) {
    var parts = manifesto.textContent.split(/(\s+)/);
    manifesto.textContent = '';
    parts.forEach(function (p) {
      if (/^\s+$/.test(p) || p === '') { manifesto.appendChild(document.createTextNode(p)); return; }
      var s = document.createElement('span');
      s.className = 'w';
      s.textContent = p;
      manifesto.appendChild(s);
      words.push(s);
    });
  }

  if (reduce) { if (nav) nav.classList.add('scrolled'); return; }

  /* 2b. The Today's Loop route draws itself (SMIL inside the image), which would
         finish at page load, long before anyone scrolls to it. Hold the image
         back and load it when the phone is on screen so the draw is seen. */
  var route = document.querySelector('.day-anim');
  if (route && 'IntersectionObserver' in window) {
    var src = route.getAttribute('href');
    route.removeAttribute('href');
    new IntersectionObserver(function (es, o) {
      if (es[0].isIntersecting) { route.setAttribute('href', src); o.disconnect(); }
    }, { threshold: 0.45 }).observe(route.closest('svg') || route);
  }

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* 3. Scroll-scrubbed rise of the phones: --p goes 0 -> 1 as a stage travels
        from the bottom of the viewport to ~40% up it. Cheap by construction:
        rects are read first, writes happen only for stages near the viewport and
        only when the rounded value changes, and CSS moves transform/opacity only. */
  var ticking = false;
  var lastP = stages.map(function () { return -1; });
  var lastLit = -1;
  var navOn = null;
  function frame() {
    ticking = false;
    var vh = window.innerHeight || root.clientHeight;
    var rects = stages.map(function (el) { return el.getBoundingClientRect(); });
    var m = words.length ? manifesto.getBoundingClientRect() : null;

    var on = window.scrollY > 12;
    if (nav && on !== navOn) { nav.classList.toggle('scrolled', on); navOn = on; }

    for (var i = 0; i < stages.length; i++) {
      var r = rects[i];
      if (r.bottom < -vh || r.top > vh * 2) continue;          /* far off-screen: skip */
      var p = clamp((vh - r.top) / (vh * 0.6));
      var eased = Math.round((1 - Math.pow(1 - p, 3)) * 200) / 200;
      if (eased !== lastP[i]) { stages[i].style.setProperty('--p', eased); lastP[i] = eased; }
    }

    if (m && m.bottom > -vh && m.top < vh * 2) {
      /* start lighting when the paragraph top hits 85% of the viewport,
         finish when its bottom reaches 55% */
      var start = vh * 0.85, end = vh * 0.55;
      var prog = clamp((start - m.top) / ((start - end) + m.height));
      var lit = Math.round(prog * words.length);
      if (lit !== lastLit) {
        for (var j = 0; j < words.length; j++) words[j].classList.toggle('lit', j < lit);
        lastLit = lit;
      }
    }
  }
  function onScroll() { if (!ticking) { ticking = true; window.requestAnimationFrame(frame); } }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  frame();
})();
