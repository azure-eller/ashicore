/* ashicore — scroll reveals, nav, topo texture */
(function () {
  // ---- scroll reveal ----
  const reveals = [...document.querySelectorAll('.reveal')];
  const show = el => el.classList.add('in');

  // reveal anything already within (or near) the viewport right now
  const revealInView = () => {
    const vh = window.innerHeight || document.documentElement.clientHeight;
    reveals.forEach(el => {
      if (el.classList.contains('in')) return;
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) show(el);
    });
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { show(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(el => io.observe(el));
    // belt-and-suspenders: handle envs where IO doesn't fire for in-view nodes
    requestAnimationFrame(revealInView);
    window.addEventListener('scroll', revealInView, { passive: true });
    window.addEventListener('load', revealInView);
    // final failsafe so content can never stay hidden
    setTimeout(() => reveals.forEach(show), 2200);
  } else {
    reveals.forEach(show);
  }

  // ---- nav scrolled state ----
  const nav = document.getElementById('nav');
  const onScroll = () => {
    if (window.scrollY > 14) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---- topo contour background (simple concentric ovals, drawn once) ----
  const topo = document.getElementById('topo');
  if (topo) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 1200 700');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const cx = 960, cy = 150;
    for (let k = 1; k <= 13; k++) {
      const el = document.createElementNS(ns, 'ellipse');
      el.setAttribute('cx', cx);
      el.setAttribute('cy', cy);
      el.setAttribute('rx', 70 + k * 62);
      el.setAttribute('ry', 52 + k * 44);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', 'var(--line)');
      el.setAttribute('stroke-width', k % 4 === 0 ? '1.6' : '1');
      el.setAttribute('transform', `rotate(-16 ${cx} ${cy})`);
      svg.appendChild(el);
    }
    topo.appendChild(svg);
  }
})();
