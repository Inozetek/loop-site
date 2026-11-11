// Shared Loop finish for the inner pages: prism reveal on headings, chrome/pearl light that follows the pointer.
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.classList.add('fxjs');
  var svgNS = 'http://www.w3.org/2000/svg';
  var holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = '<svg width="0" height="0"><filter id="lfx-liquid" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="0.010 0.032" numOctaves="2" seed="7">' +
    (reduce ? '' : '<animate attributeName="baseFrequency" dur="14s" repeatCount="indefinite" values="0.010 0.032; 0.014 0.024; 0.009 0.036; 0.010 0.032"/>') +
    '</feTurbulence><feDisplacementMap in="SourceGraphic" scale="22" xChannelSelector="R" yChannelSelector="G"/></filter></svg>';
  document.body.appendChild(holder);

  document.querySelectorAll('.fx, .lift').forEach(function (el) {
    if (el.classList.contains('fx')) {
      var m = document.createElement('span'); m.className = 'fx-metal'; m.setAttribute('aria-hidden', 'true');
      var p = document.createElement('span'); p.className = 'fx-pearl'; p.setAttribute('aria-hidden', 'true');
      el.insertBefore(p, el.firstChild); el.insertBefore(m, el.firstChild);
    }
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      el.style.setProperty('--mx', Math.max(0, Math.min(100, (e.clientX - r.left) / r.width * 100)) + '%');
      el.style.setProperty('--my', Math.max(0, Math.min(100, (e.clientY - r.top) / r.height * 100)) + '%');
    });
    el.addEventListener('pointerleave', function () { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); });
  });

  var prisms = document.querySelectorAll('.prism-in');
  if (reduce || !('IntersectionObserver' in window)) { prisms.forEach(function (el) { el.classList.add('done'); }); return; }
  prisms.forEach(function (el) {
    var light = document.createElement('span');
    light.className = 'prism-light'; light.setAttribute('aria-hidden', 'true');
    light.innerHTML = el.innerHTML;
    el.appendChild(light);
    el.addEventListener('animationend', function () { el.classList.add('done'); }, { once: true });
  });
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('go'); io.unobserve(e.target); } });
  }, { threshold: 0.4, rootMargin: '0px 0px -8% 0px' });
  prisms.forEach(function (el) { io.observe(el); });
})();
