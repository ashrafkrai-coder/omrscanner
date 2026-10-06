/* OMR core: sheet layout, printable SVG sheet, and scanner.
 * The generator and the scanner share the same layout, so bubble positions
 * are known exactly once the four corner markers are located. */
(function (root) {
  'use strict';

  // All sheet geometry is in millimetres on an A4 page (210 x 297).
  const SHEET = {
    w: 210, h: 297,
    markerSize: 8,
    markers: [[12, 12], [198, 12], [198, 285], [12, 285]], // TL, TR, BR, BL centres
    maxPerCol: 25, blockPitch: 42.5, optPitch: 6.5, rowPitch: 7,
    numOffset: 5.5, firstOptOffset: 10, y0: 100, bubbleR: 2.5,
  };
  const PX_PER_MM = 5;
  const ORIGIN = SHEET.markers[0];
  const WARP_W = (SHEET.markers[1][0] - ORIGIN[0]) * PX_PER_MM;
  const WARP_H = (SHEET.markers[3][1] - ORIGIN[1]) * PX_PER_MM;
  const LABELS = { rumi: ['A', 'B', 'C', 'D'], jawi: ['ا', 'ب', 'ج', 'د'] }; // alif, ba, jim, dal
  const LETTERS = LABELS.rumi.join('');

  function layout(questions, choices) {
    const blocks = Math.ceil(questions / SHEET.maxPerCol);
    const perCol = Math.ceil(questions / blocks);
    const x0 = SHEET.w / 2 - (blocks * SHEET.blockPitch) / 2;
    const bubbles = []; // bubbles[q][o] = {x, y} in mm
    const labels = [];
    for (let q = 0; q < questions; q++) {
      const bx = x0 + Math.floor(q / perCol) * SHEET.blockPitch;
      const y = SHEET.y0 + (q % perCol) * SHEET.rowPitch;
      labels.push({ q, x: bx + SHEET.numOffset, y });
      const row = [];
      for (let o = 0; o < choices; o++) row.push({ x: bx + SHEET.firstOptOffset + o * SHEET.optPitch, y });
      bubbles.push(row);
    }
    const headers = [];
    for (let b = 0; b < blocks; b++) {
      const bx = x0 + b * SHEET.blockPitch;
      for (let o = 0; o < choices; o++) headers.push({ o, x: bx + SHEET.firstOptOffset + o * SHEET.optPitch, y: SHEET.y0 - 6 });
    }
    return { bubbles, labels, headers, perCol, blocks };
  }

  function sheetSVG(questions, choices, titleText, labelSet, marks = []) {
    const lab = LABELS[labelSet] || LABELS.rumi;
    const L = layout(questions, choices);
    const f = (n) => Math.round(n * 100) / 100;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" width="${SHEET.w}mm" height="${SHEET.h}mm" font-family="Arial, 'Segoe UI', 'Noto Naskh Arabic', 'Traditional Arabic', Helvetica, sans-serif">`;
    s += `<rect width="${SHEET.w}" height="${SHEET.h}" fill="#fff"/>`;
    for (const [cx, cy] of SHEET.markers) {
      const h = SHEET.markerSize / 2;
      s += `<rect x="${cx - h}" y="${cy - h}" width="${SHEET.markerSize}" height="${SHEET.markerSize}" fill="#000"/>`;
    }
    const jawi = labelSet === 'jawi';
    const T = jawi
      ? { title: 'بوراڠ جواڤن', name: 'نام', cls: 'کلس', date: 'تاريخ',
          note: 'ݢلڤکن بولتن سڤنوهڽ دڠن ڤن اتاو ڤنسل 2B. جڠن چونتڠ ڤنندا هيتم دسودوت.' }
      : { title: 'BORANG JAWAPAN', name: 'Nama', cls: 'Kelas', date: 'Tarikh', note: 'Gelapkan bulatan sepenuhnya dengan pen atau pensel 2B. Jangan conteng penanda hitam di sudut.' };
    const title = jawi && (!titleText || titleText === 'BORANG JAWAPAN') ? T.title : (titleText || T.title);
    s += `<text x="105" y="30" text-anchor="middle" font-size="${jawi ? 9 : 7}" font-weight="bold">${esc(title)}</text>`;
    // Jawi is right-to-left: label at the right end of its line.
    const line = (label, y, x1, x2) => jawi
      ? `<text x="${x2}" y="${y}" text-anchor="end" direction="rtl" font-size="5.5">${label}</text><line x1="${x1}" y1="${y + 1}" x2="${x2 - 18}" y2="${y + 1}" stroke="#000" stroke-width="0.25"/>`
      : `<text x="${x1}" y="${y}" font-size="4">${label}</text><line x1="${x1 + 18}" y1="${y + 1}" x2="${x2}" y2="${y + 1}" stroke="#000" stroke-width="0.25"/>`;
    s += line(T.name, 46, 22, 188);
    s += jawi ? line(T.cls, 58, 112, 188) + line(T.date, 58, 22, 100) : line(T.cls, 58, 22, 100) + line(T.date, 58, 112, 188);
    s += `<text x="105" y="76" text-anchor="middle" ${jawi ? 'direction="rtl"' : ''} font-size="${jawi ? 4.2 : 3.2}" fill="#444">${T.note}</text>`;
    for (const h of L.headers) s += `<text x="${f(h.x)}" y="${f(h.y)}" text-anchor="middle" font-size="${labelSet === 'jawi' ? 5.6 : 3.6}" font-weight="bold">${lab[h.o]}</text>`;
    for (const l of L.labels) s += `<text x="${f(l.x)}" y="${f(l.y + 1.3)}" text-anchor="end" font-size="3.6">${l.q + 1}</text>`;
    // Letter sits inside the bubble as a faint print guide: light enough that the scanner's
    // dark-pixel threshold ignores it on an unfilled bubble, but the student can still read it.
    const bubFont = jawi ? 4.2 : 3.6;
    for (const row of L.bubbles) row.forEach((b, o) => {
      s += `<circle cx="${f(b.x)}" cy="${f(b.y)}" r="${SHEET.bubbleR}" fill="none" stroke="#000" stroke-width="0.3"/>`;
      // Option letters are intentionally NOT printed inside bubbles; they can look like student marks.
    });
    // Optional marking layer: vector marks use the exact OMR bubble coordinates.\n    if (Array.isArray(marks)) {\n      for (const mark of marks) {\n        const q = Number(mark?.q), o = Number(mark?.o);\n        if (!Number.isInteger(q) || !Number.isInteger(o)) continue;\n        const b = L.bubbles[q]?.[o];\n        if (!b) continue;\n        const glyph = mark.type === 'cross' ? '✗' : '✓';\n        const size = mark.type === 'cross' ? 5.2 : 5.6;\n        s += `<text x="${f(b.x)}" y="${f(b.y + 1.7)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size}" font-weight="bold" fill="#e00000">${glyph}</text>`;\n      }\n    }\n    return s + '</svg>';
  }

  function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---- scanner -------------------------------------------------------------

  function findMarkers(cv, gray, track) {
    const w = gray.cols, h = gray.rows, dim = Math.max(w, h);
    const blur = track(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    let bs = Math.round(dim * 0.06);
    if (bs % 2 === 0) bs++;
    bs = Math.max(bs, 31);
    const bin = track(new cv.Mat());
    cv.adaptiveThreshold(blur, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, bs, 15);
    const contours = track(new cv.MatVector());
    const hier = track(new cv.Mat());
    cv.findContours(bin, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const cands = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      const side = Math.sqrt(area);
      if (side >= dim * 0.012 && side <= dim * 0.09) {
        const r = cv.minAreaRect(c);
        const rw = r.size.width, rh = r.size.height;
        if (rw > 0 && rh > 0 && Math.min(rw, rh) / Math.max(rw, rh) >= 0.6 && area / (rw * rh) >= 0.82) {
          cands.push({ x: r.center.x, y: r.center.y });
        }
      }
      c.delete();
    }
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    const pick = corners.map(([cx, cy]) => {
      let best = -1, bd = Infinity;
      cands.forEach((p, i) => { const d = Math.hypot(p.x - cx, p.y - cy); if (d < bd) { bd = d; best = i; } });
      return best;
    });
    if (new Set(pick).size < 4 || pick.includes(-1)) return { ok: false, error: 'Penanda sudut tidak ditemui. Pastikan keempat-empat kotak hitam di sudut borang kelihatan.' };
    const q = pick.map((i) => cands[i]);
    const diag = Math.hypot(w, h);
    if (q.some((p, i) => Math.hypot(p.x - corners[i][0], p.y - corners[i][1]) > diag * 0.4)) {
      return { ok: false, error: 'Borang terlalu jauh atau tidak memenuhi gambar. Dekatkan kamera.' };
    }
    const top = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), bot = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y);
    const lef = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y), rig = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y);
    const ratio = (top + bot) / (lef + rig);
    if (ratio < 0.5 || ratio > 0.9) return { ok: false, error: 'Bentuk borang tidak dikenali. Pegang borang menegak (potret) dan ambil gambar dari atas.' };
    return { ok: true, quad: q };
  }

  /** img: ImageData-like {data (RGBA), width, height}. */
  function scan(cv, img, opts) {
    opts = Object.assign({ questions: 40, choices: 5, minFill: 0.3, multiRatio: 0.6, darkLevel: 170 }, opts);
    const mats = [];
    const track = (m) => (mats.push(m), m);
    try {
      const src = track(cv.matFromImageData(img));
      const gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const found = findMarkers(cv, gray, track);
      if (!found.ok) return found;

      const srcPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, found.quad.flatMap((p) => [p.x, p.y])));
      const dstPts = track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, WARP_W, 0, WARP_W, WARP_H, 0, WARP_H]));
      const M = track(cv.getPerspectiveTransform(srcPts, dstPts));
      const warped = track(new cv.Mat());
      cv.warpPerspective(gray, warped, M, new cv.Size(WARP_W, WARP_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);

      // Flatten uneven lighting: divide by an estimate of the paper background.
      const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(41, 41)));
      const bg = track(new cv.Mat());
      cv.dilate(warped, bg, kernel);
      cv.GaussianBlur(bg, bg, new cv.Size(41, 41), 0);
      const flat = track(new cv.Mat());
      cv.divide(warped, bg, flat, 255, -1);

      const L = layout(opts.questions, opts.choices);
      const fd = flat.data, W = flat.cols;
      const R = SHEET.bubbleR * PX_PER_MM;

      // Perspective correction fixes camera angle, but a printed/photocopied
      // form can still have a slightly different row pitch from the current
      // SVG template. Detect the real bubble-row centres after warping.
      let rowCenters = null;
      let bubbleCentersX = null;
      try {
        const circles = track(new cv.Mat());
        cv.HoughCircles(flat, circles, cv.HOUGH_GRADIENT, 1.2, 22, 80, 18, 8, 17);
        const raw = [];
        const d = circles.data32F;
        for (let i = 0; i < circles.cols; i++) {
          const x = d[i * 3], y = d[i * 3 + 1], r = d[i * 3 + 2];
          if (x > W * 0.16 && x < W * 0.82 && y > 350 && y < WARP_H - 120 && r >= 8 && r <= 17) raw.push({ x, y });
        }
        raw.sort((a, b) => a.y - b.y);
        const groups = [];
        for (const p of raw) {
          let g = groups[groups.length - 1];
          if (!g || Math.abs(p.y - g.mean) > 5) groups.push({ ys: [p.y], mean: p.y, count: 1 });
          else { g.ys.push(p.y); g.mean = g.ys.reduce((s, v) => s + v, 0) / g.ys.length; g.count++; }
        }
        const nRows = Math.ceil(opts.questions / Math.ceil(opts.questions / SHEET.maxPerCol));
        const strong = groups.filter(g => g.count >= Math.max(8, opts.choices * 2));
        if (strong.length >= nRows) {
          const expected = Array.from({ length: nRows }, (_, i) =>
            (SHEET.y0 - ORIGIN[1]) * PX_PER_MM + i * SHEET.rowPitch * PX_PER_MM
          );
          const selected = strong.slice().sort((a, b) => {
            const da = Math.min(...expected.map(y => Math.abs(a.mean - y)));
            const db = Math.min(...expected.map(y => Math.abs(b.mean - y)));
            return da - db;
          }).slice(0, nRows).sort((a, b) => a.mean - b.mean);
          if (selected.length === nRows) rowCenters = selected.map(g => g.mean);
        }

        // Also calibrate the 12 bubble columns (4 choices × 3 blocks).
        // This compensates for small residual horizontal scaling/warping.
        const xGroups = [];
        raw.slice().sort((a, b) => a.x - b.x).forEach(p => {
          let g = xGroups[xGroups.length - 1];
          if (!g || Math.abs(p.x - g.mean) > 5) xGroups.push({ xs: [p.x], mean: p.x, count: 1 });
          else { g.xs.push(p.x); g.mean = g.xs.reduce((s, v) => s + v, 0) / g.xs.length; g.count++; }
        });
        const xStrong = xGroups.filter(g => g.count >= Math.max(10, nRows / 2));
        const nCols = Math.ceil(opts.questions / nRows) * opts.choices;
        const expectedX = [];
        for (let b = 0; b < Math.ceil(opts.questions / nRows); b++) {
          const bx = SHEET.w / 2 - (Math.ceil(opts.questions / nRows) * SHEET.blockPitch) / 2 + b * SHEET.blockPitch;
          for (let o = 0; o < opts.choices; o++) expectedX.push((bx + SHEET.firstOptOffset + o * SHEET.optPitch - ORIGIN[0]) * PX_PER_MM);
        }
        if (xStrong.length >= nCols) {
          const xs = xStrong.slice().sort((a, b) => {
            const da = Math.min(...expectedX.map(x => Math.abs(a.mean - x)));
            const db = Math.min(...expectedX.map(x => Math.abs(b.mean - x)));
            return da - db;
          }).slice(0, nCols).sort((a, b) => a.mean - b.mean);
          if (xs.length === nCols) bubbleCentersX = xs.map(g => g.mean);
        }
        circles.delete();
      } catch (_) {
        // Fall back to template geometry if circle detection is unavailable.
      }

      function zoneDensity(cx, cy, radius) {
        let dark = 0, n = 0;
        const r2 = radius * radius;
        for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
          for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
            const dx = x - cx, dy = y - cy;
            if (dx * dx + dy * dy > r2 || x < 0 || y < 0 || x >= W || y >= flat.rows) continue;
            n++;
            if (fd[y * W + x] < opts.darkLevel) dark++;
          }
        }
        return n ? dark / n : 0;
      }

      const fills = L.bubbles.map((row, q) => row.map((b) => {
        const block = Math.floor(q / L.perCol);
        const option = row.indexOf(b);
        const cx = bubbleCentersX ? bubbleCentersX[block * opts.choices + option] : (b.x - ORIGIN[0]) * PX_PER_MM;
        const rowInBlock = q % L.perCol;
        const cy = rowCenters ? rowCenters[rowInBlock] : (b.y - ORIGIN[1]) * PX_PER_MM;
        const inner = zoneDensity(cx, cy, R * 0.45);
        const middle = zoneDensity(cx, cy, R * 0.70);
        const broad = zoneDensity(cx, cy, R * 0.88);
        return 0.55 * inner + 0.30 * middle + 0.15 * broad;
      }));

      const confidence = fills.map((row) => {
        const sorted = row.slice().sort((a, b) => b - a);
        return { top: sorted[0] || 0, second: sorted[1] || 0, margin: (sorted[0] || 0) - (sorted[1] || 0) };
      });

      // answers[q]: option index, null = blank, -1 = more than one mark
      const answers = fills.map((row) => {
        const order = row.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
        if (order[0][0] < opts.minFill) return null;
        if (order[1] && order[1][0] >= opts.minFill && order[1][0] >= order[0][0] * opts.multiRatio) return -1;
        return order[0][1];
      });

      return {
        ok: true, answers, fills, quad: found.quad,
        warped: { data: new Uint8Array(warped.data), width: warped.cols, height: warped.rows },
        confidence,
        px: (b) => ({ x: (b.x - ORIGIN[0]) * PX_PER_MM, y: (b.y - ORIGIN[1]) * PX_PER_MM, r: SHEET.bubbleR * PX_PER_MM }),
        bubbles: L.bubbles,
      };
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /** key: array of option index or null. Returns {score, total, detail[]} */
  function grade(answers, key) {
    let score = 0, total = 0;
    const detail = answers.map((a, i) => {
      const k = key[i];
      if (k == null) return { a, k, status: 'nokey' };
      total++;
      if (a === k) { score++; return { a, k, status: 'ok' }; }
      return { a, k, status: a == null ? 'blank' : a === -1 ? 'multi' : 'wrong' };
    });
    return { score, total, detail };
  }

  const OMR = { SHEET, PX_PER_MM, WARP_W, WARP_H, LETTERS, LABELS, layout, sheetSVG, scan, grade };
  if (typeof module === 'object' && module.exports) module.exports = OMR;
  else root.OMR = OMR;
})(typeof self !== 'undefined' ? self : this);
