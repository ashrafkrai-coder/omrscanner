// Synthetic end-to-end test: render a distorted "photo" of a filled sheet, scan it, compare.
const OMR = require('./omr.js');
let cv = require('./opencv.js');

function render(cv, questions, choices, truth, opts) {
  const { W, H, corners, pen } = opts;
  const L = OMR.layout(questions, choices);
  const S = OMR.SHEET;
  // photo px -> sheet mm
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, corners.flat());
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, S.w, 0, S.w, S.h, 0, S.h]);
  const M = cv.getPerspectiveTransform(from, to);
  const m = M.data64F;
  const data = new Uint8ClampedArray(W * H * 4);
  const ink = (x, y) => {
    if (x < 0 || y < 0 || x > S.w || y > S.h) return 90; // table
    for (const [cx, cy] of S.markers) if (Math.abs(x - cx) <= 4 && Math.abs(y - cy) <= 4) return 25;
    for (let q = 0; q < questions; q++) {
      const row = L.bubbles[q];
      if (Math.abs(y - row[0].y) > 3) continue;
      for (let o = 0; o < choices; o++) {
        const d = Math.hypot(x - row[o].x, y - row[o].y);
        if (truth[q] === o && d <= 2.3) return pen ? 35 : 125; // filled
        if (Math.abs(d - 2.5) < 0.17) return 30; // outline
      }
    }
    return 238;
  };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    let acc = 0;
    for (const [du, dv] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const uu = u + du, vv = v + dv;
      const w = m[6] * uu + m[7] * vv + m[8];
      acc += ink((m[0] * uu + m[1] * vv + m[2]) / w, (m[3] * uu + m[4] * vv + m[5]) / w);
    }
    let g = acc / 4;
    g *= 0.65 + 0.35 * (u / W) + (rnd() - 0.5) * 0.06; // uneven light + noise
    g = Math.max(0, Math.min(255, g));
    const i = (v * W + u) * 4; data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
  }
  from.delete(); to.delete(); M.delete();
  return { data, width: W, height: H };
}

async function main() {
  if (!cv.Mat) await new Promise((r) => { cv.onRuntimeInitialized = r; });
  const cases = [
    { questions: 60, choices: 4, pen: true, W: 1200, H: 1600, corners: [[80, 120], [1120, 90], [1150, 1520], [60, 1490]] },
    { questions: 100, choices: 4, pen: false, W: 1500, H: 2000, corners: [[150, 200], [1400, 260], [1380, 1900], [100, 1850]] },
    { questions: 20, choices: 4, pen: true, W: 1000, H: 1400, corners: [[20, 40], [980, 20], [990, 1380], [10, 1370]] },
  ];
  let bad = 0;
  for (const c of cases) {
    let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const truth = Array.from({ length: c.questions }, () => (rnd() < 0.1 ? null : Math.floor(rnd() * c.choices)));
    const img = render(cv, c.questions, c.choices, truth, c);
    const t0 = Date.now();
    const res = OMR.scan(cv, img, { questions: c.questions, choices: c.choices });
    if (!res.ok) { console.log('FAIL scan:', res.error); bad++; continue; }
    const wrong = truth.map((t, i) => (t === res.answers[i] ? -1 : i)).filter((i) => i >= 0);
    console.log(`${c.questions}q/${c.choices}opt pen=${c.pen}: ${c.questions - wrong.length}/${c.questions} correct, ${Date.now() - t0}ms`, wrong.length ? wrong.map((i) => `Q${i + 1}:${truth[i]}->${res.answers[i]}`).join(' ') : '');
    bad += wrong.length;
  }
  console.log(bad ? 'FAILED' : 'ALL OK');
  process.exit(bad ? 1 : 0);
}
main();

