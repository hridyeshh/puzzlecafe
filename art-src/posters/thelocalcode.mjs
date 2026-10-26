// thelocalcode's two posters, composed from its own art, tokens and words (../thelocalcode): the Mac with a real
// client site on its screen, the poking hand, the butterfly; Fraunces, Bricolage Grotesque, ink outlines and hard
// shadows on cream. Writes the 2048×1024 masters here and 1024×512 copies to public/brands.
// Run from the repo root: node art-src/posters/thelocalcode.mjs (uses ../thelocalcode's playwright-core and Chrome).
import pw from '/Users/hridyesh/Desktop/everything/Development/Projects/thelocalcode/node_modules/playwright-core/index.js';
import { readFileSync } from 'node:fs';
const { chromium } = pw;
const TLC = '/Users/hridyesh/Desktop/everything/Development/Projects/thelocalcode/public';
const uri = (p) => `data:image/${p.endsWith('.webp') ? 'webp' : 'jpeg'};base64,${readFileSync(`${TLC}/${p}`).toString('base64')}`;
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..900,0..100,0..1;1,9..144,300..900,0..100,0..1&family=JetBrains+Mono:wght@500;700&display=block';
const BASE = `
  :root { --cream:#fcf5e2; --paper:#fff; --ink:#000; --ink-soft:#1e1e1e; --purple:#7f78c5; --purple-deep:#5f57b7; --lavender:#cfc9ee;
    --mint:#72d184; --yellow:#eebf12; --yellow-check:#f2ca35; --pink:#ffb4af; --red:#f42615; --silver:#c9cdd3; --steel:#8d939b; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 2048px; height: 1024px; overflow: hidden; background: var(--cream); color: var(--ink); position: relative;
    font-family: 'Bricolage Grotesque', sans-serif; -webkit-font-smoothing: antialiased; }
  .serif { font-family: 'Fraunces', serif; font-variation-settings: 'SOFT' 100, 'WONK' 0, 'opsz' 144; font-weight: 420; letter-spacing: -0.02em; }
  .mark { position: absolute; display: flex; align-items: center; gap: 18px; font-weight: 800; font-size: 74px; letter-spacing: -0.03em; }
  .mark img { width: 104px; }
  .chip { display: inline-block; border: 4px solid var(--ink); border-radius: 999px; padding: 12px 30px; font-size: 34px; font-weight: 600;
    box-shadow: 6px 6px 0 var(--ink); background: var(--paper); }
  .hl { background: var(--yellow); border: 5px solid var(--ink); border-radius: 22px; padding: 0 22px 8px; box-shadow: 8px 8px 0 var(--ink); }
  .mono { font-family: 'JetBrains Mono', monospace; font-weight: 500; }`;

const mac = { w: 1419, h: 1825, sx: 0.1239, sy: 0.1182, sw: 0.7549, sh: 0.4486 };
function poster1() {
  const H = 930; const W = (mac.w / mac.h) * H; const X = 96; const Y = 58;
  return `<style>${BASE}
    .mac { position:absolute; left:${X}px; top:${Y}px; width:${W}px; filter: drop-shadow(0 26px 30px rgba(0,0,0,.28)); }
    .screen { position:absolute; left:${X + mac.sx * W}px; top:${Y + mac.sy * H}px; width:${mac.sw * W}px; height:${mac.sh * H}px; object-fit:cover; object-position:top; border-radius:18px; }
    .hand { position:absolute; left:${X + W - 46}px; top:742px; width:1330px; }
    h1 { position:absolute; left:930px; top:212px; font-size:132px; line-height:1.04; }
    .chips { position:absolute; left:934px; top:612px; display:flex; gap:22px; flex-wrap:wrap; width:1060px; }
  </style>
  <div class="mark" style="left:934px; top:74px"><img src="${uri('art/butterfly.webp')}" alt="">thelocalcode</div>
  <img class="mac" src="${uri('art/mac.webp')}" alt=""><img class="screen" src="${uri('sites/stickynotes-0.jpg')}" alt="">
  <h1 class="serif">Built like a <span class="hl">product,</span><br>not a template.</h1>
  <div class="chips"><span class="chip" style="background:var(--lavender)">Logo. Colours. Type.</span><span class="chip" style="background:var(--mint)">Words that sound like you.</span></div>
  <img class="hand" src="${uri('art/hand-poke.webp')}" alt="">`;
}

function poster2() {
  // Five vendors' cables, tangled; then one straight cable from "you" to a bulb that lights.
  const vendors = [['designer', 'var(--lavender)', 120], ['developer', 'var(--mint)', 330], ['hosting', 'var(--yellow-check)', 560], ['SEO agency', 'var(--pink)', 760], ['social media', 'var(--silver)', 1000]];
  const tangle = vendors.map(([, c], i) => {
    const x0 = 150 + i * 215; const y0 = 238;
    const d = `M${x0} ${y0} C ${x0 + 160} ${y0 + 150}, ${x0 - 220} ${y0 + 120}, ${x0 + 40} ${y0 + 60} S ${x0 + 330} ${y0 - 40}, ${x0 + 150} ${y0 + 110} S ${560 + i * 30} ${330}, ${640} ${352}`;
    return `<path d="${d}" stroke="#000" stroke-width="15" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${c}" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  }).join('');
  const tags = vendors.map(([t, c], i) => `<span class="chip" style="position:absolute; left:${70 + i * 215}px; top:150px; font-size:28px; padding:8px 20px; background:${c}">${t}</span>`).join('');
  return `<style>${BASE}
    h2 { position:absolute; left:70px; top:66px; font-size:46px; font-weight:600; color:var(--ink-soft); }
    h1 { position:absolute; left:70px; top:470px; font-size:150px; line-height:1; }
    svg { position:absolute; inset:0; }
    .you { position:absolute; left:70px; top:806px; width:170px; height:118px; border:7px solid var(--ink); border-radius:26px; background:var(--paper);
      display:grid; place-items:center; font-size:52px; font-weight:700; box-shadow: 8px 8px 0 var(--ink); }
  </style>
  <h2>Getting online usually means five vendors.</h2>
  <svg viewBox="0 0 2048 1024">${tangle}
    <circle cx="640" cy="352" r="22" fill="var(--paper)" stroke="#000" stroke-width="7"/>
    <text x="676" y="322" font-family="JetBrains Mono" font-weight="700" font-size="54" fill="#000" stroke="var(--cream)" stroke-width="12" paint-order="stroke">?!</text>
    <path d="M246 865 H1690" stroke="#000" stroke-width="34" stroke-linecap="round"/><path d="M246 865 H1690" stroke="var(--purple)" stroke-width="20" stroke-linecap="round"/>
    <circle cx="1830" cy="842" r="150" fill="var(--yellow-check)" opacity="0.55"/>
    <rect x="1640" y="826" width="64" height="80" rx="12" fill="var(--silver)" stroke="#000" stroke-width="7"/>
    <path d="M1652 826V906M1666 826V906M1680 826V906" stroke="var(--steel)" stroke-width="5"/>
    <path d="M1704 866 Q1740 846 1772 866" stroke="#000" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="1830" cy="842" r="66" fill="var(--yellow)" stroke="#000" stroke-width="8"/>
    <path d="M1806 842 q12 -22 24 0 t24 0" stroke="#000" stroke-width="6" fill="none" stroke-linecap="round"/>
    ${[0, 1, 2, 3, 4, 5, 6].map((k) => { const a = (-150 + k * 40) * Math.PI / 180; return `<path d="M${1830 + Math.cos(a) * 96} ${842 + Math.sin(a) * 96} L${1830 + Math.cos(a) * 128} ${842 + Math.sin(a) * 128}" stroke="#000" stroke-width="8" stroke-linecap="round"/>`; }).join('')}
  </svg>
  ${tags}
  <div class="mark" style="right:76px; top:58px"><img src="${uri('art/butterfly.webp')}" alt="">thelocalcode</div>
  <h1 class="serif">With us, it's <span class="hl" style="background:var(--lavender)">one straight line.</span></h1>
  <div class="you">you</div>`;
}

const browser = await chromium.launch({ channel: 'chrome' });
for (const [scale, dir] of [[1, 'art-src/posters'], [0.5, 'public/brands']]) {
  const page = await browser.newPage({ viewport: { width: 2048, height: 1024 }, deviceScaleFactor: scale });
  for (const [name, body] of [['thelocalcode-1', poster1()], ['thelocalcode-2', poster2()]]) {
    await page.setContent(`<!doctype html><html><head><link rel="stylesheet" href="${FONTS}"></head><body>${body}</body></html>`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 90 });
  }
  await page.close();
}
await browser.close();
