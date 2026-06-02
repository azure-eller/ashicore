/* ashicore — hero sequence: import → imported → live app */
(function () {
  const root = document.getElementById('appframe');
  if (!root) return;

  const scenes = {
    import: document.getElementById('sceneImport'),
    done: document.getElementById('sceneDone'),
    app: document.getElementById('sceneApp'),
  };
  const order = ['import', 'done', 'app'];
  const dots = [...document.querySelectorAll('#sceneDots .sd')];
  const statusText = document.getElementById('appStatusText');
  const statusLabel = { import: 'importing', done: 'imported', app: 'synced' };

  const imps = [...root.querySelectorAll('.imp')];
  const impProg = document.getElementById('impProg');
  const impCount = document.getElementById('impCount');
  const batchFill = document.getElementById('batchFill');
  const batchPct = document.getElementById('batchPct');

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  function showScene(name) {
    order.forEach((n, idx) => {
      scenes[n].classList.toggle('is-on', n === name);
      dots[idx] && dots[idx].classList.toggle('on', n === name);
    });
    if (statusText) statusText.textContent = statusLabel[name];
  }

  function resetImport() {
    imps.forEach(el => el.classList.remove('scanning', 'done'));
    if (impProg) impProg.style.width = '0%';
    if (impCount) impCount.textContent = 'Structuring records…';
  }

  if (reduce) {
    // settle on the live app, fully built
    imps.forEach(el => el.classList.add('done'));
    if (impProg) impProg.style.width = '100%';
    if (batchFill) batchFill.style.width = '68%';
    showScene('app');
    return;
  }

  let running = false;

  async function runImport() {
    resetImport();
    showScene('import');
    await wait(500);
    const total = 428;
    const per = [142, 206, 318, 428]; // cumulative records as each file lands
    for (let i = 0; i < imps.length; i++) {
      imps[i].classList.add('scanning');
      await wait(620);
      imps[i].classList.remove('scanning');
      imps[i].classList.add('done');
      if (impProg) impProg.style.width = Math.round(((i + 1) / imps.length) * 100) + '%';
      if (impCount) impCount.textContent = 'Structuring records… ' + per[i] + ' / ' + total;
      await wait(260);
    }
    if (impCount) impCount.textContent = '428 records structured';
    await wait(700);
  }

  async function runDone() {
    showScene('done');
    await wait(2200);
  }

  async function runApp() {
    if (batchFill) batchFill.style.width = '0%';
    if (batchPct) batchPct.textContent = '0%';
    showScene('app');
    await wait(260);
    // animate the active batch filling
    const target = 68;
    if (batchFill) batchFill.style.width = target + '%';
    const start = performance.now();
    const dur = 1400;
    await new Promise(res => {
      function frame(now) {
        const t = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        if (batchPct) batchPct.textContent = Math.round(target * e) + '%';
        if (t < 1) requestAnimationFrame(frame); else res();
      }
      requestAnimationFrame(frame);
    });
    await wait(2600);
  }

  async function loop() {
    if (running) return;
    running = true;
    while (running) {
      await runImport();
      await runDone();
      await runApp();
      await wait(300);
    }
  }

  let started = false;
  const begin = () => { if (started) return; started = true; loop(); };
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) begin(); });
  }, { threshold: 0.2 });
  io.observe(root);
  window.addEventListener('load', () => setTimeout(begin, 600));
  setTimeout(begin, 2200);
})();
