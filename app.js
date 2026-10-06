(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LETTERS = OMR.LETTERS;
  const labelsOf = (set) => OMR.LABELS[set] || OMR.LABELS.rumi;
  const L = (i, set) => labelsOf(set || cfg.labels)[i];
  // Jawi letters (with common variants) and Latin letters all map to option index.
  const ALIAS = { 'ا': 0, 'أ': 0, 'إ': 0, 'آ': 0, 'ب': 1, 'ج': 2, 'د': 3 };

  // ---- persistent state ----------------------------------------------------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('omr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('omr.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const cfg = Object.assign({ questions: 60, choices: 4, title: 'BORANG JAWAPAN', minFill: 0.3, labels: 'rumi' }, store.get('cfg', {}), { questions: 60, choices: 4 });
  let keyStr = store.get('key', '');
  let records = store.get('records', []);
  let cv = null, lastImg = null, lastScan = null;

  // ---- OpenCV loading ------------------------------------------------------
  function loadCV() {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'opencv.js';
      s.onerror = () => reject(new Error('opencv.js gagal dimuat'));
      s.onload = () => {
        const m = window.cv;
        // Wrap: resolving a promise with the Module itself would loop (it is thenable).
        if (m.Mat) return resolve({ m });
        m.onRuntimeInitialized = () => resolve({ m });
      };
      document.head.appendChild(s);
    });
  }
  loadCV().then(({ m }) => { cv = m; $('engine').textContent = 'Sedia mengimbas ✔'; })
    .catch((e) => { $('engine').textContent = '⚠ ' + e.message; });

  // ---- tabs ----------------------------------------------------------------
  document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('section').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + b.dataset.tab));
    window.scrollTo(0, 0);
  }));

  // ---- key -----------------------------------------------------------------
  function parseKey(text) {
    const out = [];
    for (const ch of text.toUpperCase()) {
      const i = ch in ALIAS ? ALIAS[ch] : LETTERS.indexOf(ch);
      if (i >= 0 && i < cfg.choices) out.push(i);
      else if (ch === '-' || ch === '*') out.push(null);
    }
    return out.slice(0, cfg.questions);
  }
  const keyArray = () => { const k = parseKey(keyStr); while (k.length < cfg.questions) k.push(null); return k; };
  function renderKeyInfo() {
    const n = parseKey(keyStr).length;
    $('keyInfo').textContent = `${n} / ${cfg.questions} soalan`;
    $('keyInfo').style.color = n === cfg.questions ? 'var(--ok)' : 'var(--warn)';
    $('keyWarn').innerHTML = n < cfg.questions ? '<div class="msg warn">Kunci jawapan belum lengkap. Isi di tab Kunci untuk markah automatik.</div>' : '';
  }
  $('keyText').value = keyStr;
  $('keyText').addEventListener('input', (e) => { keyStr = e.target.value; store.set('key', keyStr); renderKeyInfo(); regrade(); });

  function renderPad() {
    const pad = $('keyPad'); const n = cfg.choices;
    pad.innerHTML = labelsOf(cfg.labels).slice(0, n).map((c) => `<button type="button" data-k="${c}">${c}</button>`).join('')
      + '<button type="button" class="sec" data-k="-">–</button><button type="button" class="sec" data-k="<">⌫</button>';
  }
  $('keyPad').addEventListener('click', (e) => {
    const k = e.target.dataset.k; if (!k) return;
    keyStr = k === '<' ? Array.from(keyStr).slice(0, -1).join('') : keyStr + k;
    $('keyText').value = keyStr; store.set('key', keyStr); renderKeyInfo(); regrade();
  });

  // ---- sheet designer ------------------------------------------------------
  function renderSheet() {
    const svg = OMR.sheetSVG(cfg.questions, cfg.choices, cfg.title, cfg.labels);
    $('sheetPreview').innerHTML = svg;
    $('printRoot').innerHTML = svg;
  }
  $('title').value = cfg.title; $('labels').value = cfg.labels;
  const onCfg = () => {
    cfg.title = $('title').value;
    cfg.labels = $('labels').value;
    store.set('cfg', cfg); renderSheet(); renderKeyInfo(); renderPad(); if (lastScan) showResult();
  };
  ['title', 'labels'].forEach((id) => $(id).addEventListener('input', onCfg));
  $('print').addEventListener('click', () => window.print());

  // ---- image input ---------------------------------------------------------
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  async function pdfToImageData(file, maxDim) {
    const pdfjs = await import('./pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', location.href).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1); // first page only
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: maxDim / Math.max(v1.width, v1.height) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // PDFs are transparent by default
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  async function fileToImageData(file, maxDim = 2000) {
    if (isPdf(file)) return pdfToImageData(file, maxDim);
    let src, w, h;
    if (window.createImageBitmap) { src = await createImageBitmap(file); w = src.width; h = src.height; }
    else {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
      w = src.naturalWidth; h = src.naturalHeight;
    }
    const k = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, c.width, c.height);
    return ctx.getImageData(0, 0, c.width, c.height);
  }

  async function runScan(file, target) {
    const err = $(target === 'key' ? 'keyErr' : 'scanErr');
    err.innerHTML = '';
    if (!cv) { err.innerHTML = '<div class="msg err">Enjin imbasan masih dimuatkan, cuba sebentar lagi.</div>'; return null; }
    try {
      const img = await fileToImageData(file);
      const res = OMR.scan(cv, img, { questions: cfg.questions, choices: cfg.choices, minFill: cfg.minFill });
      if (!res.ok) { err.innerHTML = `<div class="msg err">${res.error}</div>`; return null; }
      return { img, res };
    } catch (e) {
      err.innerHTML = `<div class="msg err">Gagal memproses gambar: ${e.message || e}</div>`;
      return null;
    }
  }

  for (const id of ['cam', 'gallery']) {
    $(id).addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      $('result').hidden = true;
      const r = await runScan(f, 'scan');
      if (!r) return;
      lastImg = r.img; lastScan = r.res;
      showResult();
    });
  }
  for (const id of ['keyScan', 'keyFile']) $(id).addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const r = await runScan(f, 'key');
    if (!r) return;
    const bad = r.res.answers.filter((a) => a == null || a === -1).length;
    keyStr = r.res.answers.map((a) => (a == null || a === -1 ? '-' : L(a))).join('');
    $('keyText').value = keyStr; store.set('key', keyStr); renderKeyInfo();
    if (bad) $('keyErr').innerHTML = `<div class="msg warn">${bad} soalan kosong atau bertanda lebih daripada satu, ditanda "-". Semak dan betulkan di atas.</div>`;
  });

  // ---- results -------------------------------------------------------------
  $('sens').value = cfg.minFill; $('sensVal').textContent = cfg.minFill;
  $('sens').addEventListener('input', (e) => {
    cfg.minFill = parseFloat(e.target.value); $('sensVal').textContent = cfg.minFill; store.set('cfg', cfg);
    if (lastImg && cv) { const res = OMR.scan(cv, lastImg, { questions: cfg.questions, choices: cfg.choices, minFill: cfg.minFill }); if (res.ok) { lastScan = res; showResult(); } }
  });

  function regrade() { if (lastScan) showResult(); }

  function showResult() {
    const key = keyArray();
    const g = OMR.grade(lastScan.answers, key);
    $('result').hidden = false;
    $('scoreNum').textContent = g.score;
    $('scoreOf').textContent = ' / ' + g.total;
    $('scorePct').textContent = g.total ? Math.round((g.score / g.total) * 100) + '%' : 'Tiada kunci jawapan';
    lastScan.grade = g;

    // overlay
    const { warped, bubbles, px } = lastScan;
    const cvs = $('view'); cvs.width = warped.width; cvs.height = warped.height;
    const ctx = cvs.getContext('2d');
    const id = ctx.createImageData(warped.width, warped.height);
    for (let i = 0, n = warped.data.length; i < n; i++) { const v = warped.data[i]; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    ctx.lineWidth = 4;
    const redMark = (b, type) => {
      const p = px(b);
      ctx.save(); ctx.strokeStyle = '#e00000'; ctx.fillStyle = '#e00000';
      ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(type === 'check' ? '✓' : '✗', p.x, p.y); ctx.restore();
    };
    g.detail.forEach((d, q) => {
      // Never call an answer wrong when no digital key exists for that question.
      // Red marks are reserved for actual grading against a known key.
      if (d.k == null) return;
      if (d.status === 'multi') {
        lastScan.fills[q].forEach((f, o) => { if (f >= cfg.minFill) redMark(bubbles[q][o], 'cross'); });
        redMark(bubbles[q][d.k], 'check');
      } else if (d.a != null) {
        redMark(bubbles[q][d.a], d.status === 'ok' ? 'check' : 'cross');
        if (d.a !== d.k) redMark(bubbles[q][d.k], 'check');
      } else {
        // Blank answer: show the correct key location only.
        redMark(bubbles[q][d.k], 'check');
      }
    });
    lastScan.review = g.detail.map((d, q) => {
      const c = lastScan.confidence?.[q];
      return !!(c && d.a != null && d.a !== -1 && c.top >= cfg.minFill && c.margin < 0.08);
    });

    $('chips').innerHTML = g.detail.map((d, q) => {
      const a = d.a == null ? '–' : d.a === -1 ? '??' : L(d.a);
      const mark = d.status === 'ok' ? '✓' : d.status === 'nokey' ? '' : d.k != null ? '(' + L(d.k) + ')' : '';
      const uncertain = lastScan.review?.[q] ? ' ⚠' : '';
      return `<div class="chip ${d.status}"><span>${q + 1}</span><span>${a} ${mark}${uncertain}</span></div>`;
    }).join('');
  }

  $('printMarked').addEventListener('click', () => {
    if (!lastScan || !lastScan.grade) return;
    const img = $('view').toDataURL('image/png'), g = lastScan.grade;
    $('markedPrint').innerHTML = `
      <h1>OMR — Kertas Jawapan Disemak</h1>
      <p><b>Nama:</b> ${escapeHtml($('name').value.trim() || 'Tanpa nama')} &nbsp; <b>Markah:</b> ${g.score}/${g.total} (${g.total ? Math.round(g.score / g.total * 100) : 0}%)</p>
      <img src="${img}" alt="OMR bertanda">
      <p>✓ merah = betul &nbsp; ✗ merah = salah / tanda berganda</p>`;
    document.body.classList.add('markedPrint');
    window.print();
    setTimeout(() => document.body.classList.remove('markedPrint'), 500);
  });

  $('saveRec').addEventListener('click', () => {
    const g = lastScan.grade;
    records.unshift({
      id: Date.now(), name: $('name').value.trim() || 'Tanpa nama', date: new Date().toISOString(),
      score: g.score, total: g.total, labels: cfg.labels,
      answers: g.detail.map((d) => (d.a == null ? '-' : d.a === -1 ? '?' : LETTERS[d.a])).join(''),
    });
    store.set('records', records); renderRecords();
    $('name').value = ''; $('result').hidden = true; lastScan = lastImg = null;
    window.scrollTo(0, 0);
  });

  // ---- records -------------------------------------------------------------
  function renderRecords() {
    $('recList').innerHTML = records.length ? records.map((r) => `
      <div class="rec"><div><b>${escapeHtml(r.name)}</b><small>${new Date(r.date).toLocaleString('ms-MY')}</small></div>
      <div><b>${r.score}/${r.total}</b> <button class="danger" data-del="${r.id}">✕</button></div></div>`).join('')
      : '<div class="hint">Belum ada rekod.</div>';
  }
  $('recList').addEventListener('click', (e) => {
    const id = e.target.dataset.del; if (!id) return;
    records = records.filter((r) => String(r.id) !== id); store.set('records', records); renderRecords();
  });
  $('clear').addEventListener('click', () => {
    if (records.length && confirm('Padam semua rekod?')) { records = []; store.set('records', records); renderRecords(); }
  });
  $('csv').addEventListener('click', () => {
    if (!records.length) return;
    const maxQ = Math.max(...records.map((r) => r.answers.length));
    const head = ['Nama', 'Tarikh', 'Markah', 'Jumlah', 'Peratus', ...Array.from({ length: maxQ }, (_, i) => 'S' + (i + 1))];
    const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
    const rows = records.slice().reverse().map((r) => [q(r.name), q(r.date.slice(0, 16).replace('T', ' ')), r.score, r.total, r.total ? Math.round((r.score / r.total) * 100) : '', ...r.answers.split('').map((c) => { const i = LETTERS.indexOf(c); return i < 0 ? c : L(i, r.labels); })]);
    const blob = new Blob(['﻿' + [head.join(','), ...rows.map((r) => r.join(','))].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'keputusan-omr.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  function escapeHtml(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  renderSheet(); renderKeyInfo(); renderRecords(); renderPad();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
