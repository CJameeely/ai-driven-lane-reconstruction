// Fixed-timestep cinematic recorder for the digital space, stages 01–08.
// Reads shots from cinematic_cameras.json (key cinematic_01_08) and drives the existing experience.html
// through its public hooks only (__filmCamera, __experience.*, data-city-grammar buttons). A virtual clock
// replaces performance.now / Date.now / requestAnimationFrame in every frame, so each output frame advances
// exactly 1/30 s regardless of real render speed. Nothing in the approved scene code is modified.
//
// usage: node web/record_cinematic_01_08.mjs <outDir> [--preview STEP] [--from SEC] [--to SEC]
//   full run pipes JPEG frames into ffmpeg (H.264, 1920x1080, 30 fps) -> <outDir>/silent_raw.mp4
//   --preview STEP renders one frame every STEP seconds to <outDir>/preview/ (no video)
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2), outDir = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const PREVIEW = opt('--preview', 0), FROM = opt('--from', 0), TO = opt('--to', 183);
const FFMPEG = '/Users/cj/Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';
const EXE = '/Users/cj/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const FPS = 30, DT = 1000 / FPS;
const cfg = JSON.parse(await readFile(new URL('./cinematic_cameras.json', import.meta.url), 'utf8')).cinematic_01_08;
const DUR = cfg.duration;
await mkdir(outDir + (PREVIEW ? '/preview' : ''), { recursive: true });

// ---- timeline (seconds) -------------------------------------------------------------------------
const STAGE_AT = [ // stage index entered at time t (reloads are hidden behind a cross-fade)
  { t: 22, n: 1 }, { t: 43, n: 2 }, { t: 63, n: 3 }, { t: 76, n: 4 }, { t: 98.2, n: 5 }, { t: 121.2, n: 6, shikumen: true }, { t: 146.5, n: 7, cityGrammar: 'shikumen' },
];
const CITY_SWITCH = [{ t: 149, g: 'shikumen', fadeOnly: true }, { t: 162, g: 'almond' }, { t: 164.33, g: 'ban' }, { t: 166.66, g: 'shikumen' }, { t: 169, g: 'almond' }];
const PROGRESS = [ // [key, t0, t1, v0, v1]
  ['fire', 6, 20, 0, 1], ['fire', 22, 25, 1, .2], ['fire', 25, 29, .2, 0],
  ['damage', 22, 25, 0, .08], ['damage', 25, 34, .08, .5], ['damage', 34, 41, .5, 1],
  ['inference', 43, 61, 0, 1], ['return', 63, 73, 0, 1],
  ['growth', 76, 94, .1, 1], ['growth', 96, 98.2, 1, .12],
  ['growth', 98.2, 116.5, .08, 1], ['growth', 119, 121.2, 1, .12],
  ['growth', 121.2, 141, .06, 1],
];
const STAGE_TITLES = [[0, '01 / FIRE'], [22, '02 / DAMAGE SCAN'], [43, '03 / AI INFERENCE'], [63, '04 / RETURN TO THE LANE'], [76, '05 / ALMOND'], [97, '06 / BAN'], [120, '07 / SHIKUMEN'], [146, '08 / RECONSTRUCTED CITY'], [175, '']];
const CAPTIONS = [
  [7, 21, 'A thermal point cloud maps the fire as it spreads through the damaged lane.'],
  [26, 42, 'An AI scan traces each fracture and quantifies the damage at its exact location.'],
  [44, 62, 'Evidence, inference and imagination reconstruct the geometry that has been lost.'],
  [64, 75, 'The reconstructed targets return to the lane, ready to receive a repair grammar.'],
  [77, 95.5, 'Organic trunks and branching membranes grow from the ruins to form a new Gothic structure.'],
  [100, 118.5, 'Paper tubes and folded modules assemble a lightweight tectonic repair.'],
  [123, 143.5, 'New brickwork, windows and tiled roofs rebuild the lane through its original Shikumen language.'],
  [150, 174, 'The repaired lane returns to the city as an explorable digital reconstruction.'],
];
const CHECK = { 18: 'cinematic_01_fire', 38: 'cinematic_02_damage', 57: 'cinematic_03_inference', 74: 'cinematic_04_return', 85: 'cinematic_05_almond_growth', 95.5: 'cinematic_05_almond_complete',
  108: 'cinematic_06_ban_growth', 118: 'cinematic_06_ban_complete', 127: 'cinematic_07_shikumen_brick', 134: 'cinematic_07_shikumen_window', 140: 'cinematic_07_shikumen_roof', 143.5: 'cinematic_07_shikumen_complete',
  153: 'cinematic_08_drone_entry', 159: 'cinematic_08_drone_rise', 165.5: 'cinematic_08_drone_orbit', 174: 'cinematic_08_city_overview', 3: 'cinematic_00_open', 179: 'cinematic_09_end' };

// ---- virtual clock, installed in every frame (top page and growth iframe) -----------------------
const CLOCK = `(()=>{let vt=0,id=0;const q=new Map(),d0=Date.now();
performance.now=()=>vt;Date.now=()=>d0+vt;
window.requestAnimationFrame=cb=>{q.set(++id,cb);return id};window.cancelAnimationFrame=i=>q.delete(i);
window.__vt={step(ms){vt+=ms;const cbs=[...q.values()];q.clear();for(const cb of cbs){try{cb(vt)}catch(e){console.error(e)}}
 for(const a of document.getAnimations()){if(a.__vs==null){a.__vs=vt;a.pause()}a.currentTime=Math.max(0,vt-a.__vs)}},get t(){return vt}};})();`;

// ---- page-side cinematic driver ------------------------------------------------------------------
const DRIVER = ({ cfg, PROGRESS, STAGE_TITLES, CAPTIONS }) => {
  const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2), cl = (x) => Math.max(0, Math.min(1, x));
  const cr = (P, u) => { if (P.length === 1) return P[0]; const n = P.length - 1, s = Math.min(n - 1e-9, u * n), i = Math.floor(s), t = s - i, p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n, i + 2)];
    return p1.map((_, k) => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t)); };
  const css = document.createElement('style');
  css.textContent = `#stage,#filmCaption,#progress,#controls,#hint,#quality,#cityTools,#cross,#loading,.city-state,#debugPanel,#telemetry,#city,#returnView{display:none!important}
  *{cursor:none!important}#datum{transition:none!important}
  .cine{position:fixed;pointer-events:none;z-index:40;transition:none}
  #cTitle{left:44px;top:36px;font:400 30px/1 Oswald,'Barlow Condensed',sans-serif;letter-spacing:.04em;color:#fff;text-transform:uppercase;text-shadow:0 2px 14px rgba(0,0,0,.7)}
  #cTitle i{display:block;width:120px;height:1px;background:#cc6437;margin-top:12px}
  #cCapBg{left:0;right:0;bottom:0;height:190px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.42))}
  #cCap{left:14%;right:14%;bottom:54px;text-align:center;font:400 25px/1.45 Inter,system-ui,sans-serif;color:#eceae6;letter-spacing:.005em;text-shadow:0 2px 12px rgba(0,0,0,.8)}
  #cReady{left:0;right:0;bottom:118px;text-align:center;font:400 15px/1 'Roboto Mono',monospace;letter-spacing:.18em;color:#fff}
  #cCard{inset:0;display:grid;place-content:center;text-align:center;color:#fff}
  #cCard h1{font:400 64px/1.05 Oswald,sans-serif;letter-spacing:.02em;text-transform:uppercase;margin:0}
  #cCard p{font:400 16px/1 'Roboto Mono',monospace;letter-spacing:.32em;color:#cecece;margin:26px 0 0}
  #cCard i{display:block;width:150px;height:1px;background:#cc6437;margin:24px auto 0}
  #cDim{inset:0;background:radial-gradient(ellipse 38% 34% at 50% 52%,rgba(0,0,0,0),rgba(0,0,0,.72))}
  #cBlack{inset:0;background:#000;z-index:42}#cXf{inset:0;width:100vw;height:100vh;object-fit:cover;z-index:38}`;
  document.head.append(css);
  const mk = (id, tag = 'div') => { const e = document.createElement(tag); e.id = id; e.className = 'cine'; document.body.append(e); return e; };
  const el = { dim: mk('cDim'), capBg: mk('cCapBg'), cap: mk('cCap'), ready: mk('cReady'), title: mk('cTitle'), card: mk('cCard'), xf: mk('cXf', 'img'), black: mk('cBlack') };
  el.ready.textContent = '6 / 6 TARGETS READY';
  let lastTitle = null, lastCap = null, lastCard = null, xfStart = -1;
  const datum = document.querySelector('#datum'), ann = document.querySelector('#annotations');
  window.__cine = {
    xf(src, t) { el.xf.src = src; xfStart = t; el.xf.style.opacity = 1; },
    apply(t) {
      // camera
      const S = cfg.shots; let s = S.find((x) => t >= x.start && t < x.start + x.duration) || S[S.length - 1];
      const u = ease(cl((t - s.start) / s.duration)), p = cr(s.path_position, u), tg = cr(s.path_target, u), fov = s.start_fov + (s.end_fov - s.start_fov) * u;
      window.__filmCamera(p, tg, fov);
      // stage progress (absolute values, so frames can be rendered out of order)
      const E = window.__experience, set = { fire: E.setFireProgress, damage: E.setDamageProgress, inference: E.setInferenceProgress, return: E.setReturnProgress, growth: E.setProgress };
      for (const [k, t0, t1, v0, v1] of PROGRESS) if (t >= t0 - 1e-6 && t <= t1 + .5) { const a = cl((t - t0) / (t1 - t0)); try { set[k](v0 + (v1 - v0) * (k === 'growth' ? a : ease(a))); } catch (e) {} }
      // overlays
      let title = ''; for (const [t0, x] of STAGE_TITLES) if (t >= t0) title = x;
      const nextT = STAGE_TITLES.find(([t0]) => t0 > t)?.[0] ?? 1e9, prevT = [...STAGE_TITLES].reverse().find(([t0]) => t0 <= t)?.[0] ?? 0;
      if (title !== lastTitle) { el.title.innerHTML = title ? `${title}<i></i>` : ''; lastTitle = title; }
      el.title.style.opacity = t < 5.2 ? 0 : cl(Math.min((t - Math.max(prevT, 5.2)) / .6, (nextT - t) / .5));
      const c = CAPTIONS.find(([a, b]) => t >= a && t <= b);
      if ((c?.[2] || '') !== lastCap) { el.cap.textContent = c?.[2] || ''; lastCap = c?.[2] || ''; }
      const capA = c ? cl(Math.min((t - c[0]) / .8, (c[1] - t) / .6)) : 0; el.cap.style.opacity = capA; el.capBg.style.opacity = Math.max(capA, 0) * .9;
      el.ready.style.opacity = cl(Math.min((t - 72.5) / .6, (76 - t) / .4));
      // opening / ending cards
      let card = '';
      if (t < 6.2) card = '<h1>AI-DRIVEN LANE RECONSTRUCTION</h1><i></i><p>FIRE · DAMAGE · INFERENCE · REPAIR · CITY</p>';
      else if (t >= 176) card = '<h1>AI-DRIVEN DAMAGE QUANTIFICATION<br>AND GENERATIVE RECONSTRUCTION</h1><i></i><p>FIRE · SCAN · INFER · REPAIR · CITY</p>';
      if (card !== lastCard) { el.card.innerHTML = card; lastCard = card; }
      el.card.style.opacity = t < 6.2 ? cl(Math.min((t - .8) / 1.2, (6.2 - t) / 1)) : t >= 176 ? cl((t - 176) / 1.2) : 0;
      el.dim.style.opacity = t >= 175 ? cl((t - 175) / 2.5) : 0;
      el.black.style.opacity = t < 1.6 ? 1 - cl(t / 1.6) : t > 181.2 ? cl((t - 181.2) / 1.8) : 0;
      // stage data: hidden for fire, opening and ending; never shown above the caption band
      const dA = t < 22.5 || t >= 175 ? 0 : 1; datum.style.opacity = dA; datum.style.visibility = dA ? 'visible' : 'hidden';
      ann.style.opacity = t >= 144 ? 0 : 1;
      // reload cross-fade
      el.xf.style.opacity = xfStart >= 0 ? cl(1 - (t - xfStart) / .8) : 0;
    },
    step(ms) { window.__vt.step(ms); try { const w = document.querySelector('#growthFrame').contentWindow; w.__vt?.step(ms); if (document.body.dataset.stage === 'city') w.__vt?.step(ms); } catch (e) {} }, // city view throttles its renderer to 66.6 ms, so it gets two sub-steps per output frame
    ready() { const w = document.querySelector('#growthFrame')?.contentWindow; return !!(w && w.__ready && w.__growth && document.querySelector('#loading').classList.contains('done')); },
  };
};

// ---- browser --------------------------------------------------------------------------------------
const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(CLOCK);
const page = await ctx.newPage();
const log = [], errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
const URL0 = `http://127.0.0.1:8765/web/experience.html?scene=0&g=almond&tour=0&record=1&quality=high&v=${Date.now()}`;
await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 120000 });
const pump = async (cond, label, maxReal = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < maxReal) { await page.evaluate(() => { window.__vt.step(33.34); try { document.querySelector('#growthFrame').contentWindow.__vt?.step(33.34); } catch (e) {} }); if (await page.evaluate(cond).catch(() => false)) return Date.now() - t0; await page.waitForTimeout(25); } throw Error('timeout: ' + label); };
await pump(() => window.__ready === true && !!window.__experience, 'experience ready');
await page.addStyleTag({ url: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400&family=Inter:wght@400&family=Roboto+Mono:wght@400&display=swap' }).catch(() => log.push('fonts: offline fallback'));
await page.evaluate(DRIVER, { cfg, PROGRESS, STAGE_TITLES, CAPTIONS });
await page.evaluate(() => document.querySelector('#pause').click()); // stop the experience's own real-time timeline; the recorder sets every value
await page.evaluate(async () => { await document.fonts.ready; });
await pump(() => window.__cine.ready(), 'renderer ready');
for (let i = 0; i < 90; i++) await page.evaluate(() => window.__cine.step(33.34)); // settle
log.push('start ' + new Date().toISOString());

// ---- events -----------------------------------------------------------------------------------------
let lastJpeg = null;
const xfade = async (t) => { if (lastJpeg) await page.evaluate(([s, t]) => window.__cine.xf(s, t), ['data:image/jpeg;base64,' + lastJpeg.toString('base64'), t]); };
async function enterStage(ev) {
  await xfade(ev.t);
  await page.evaluate((n) => { window.__enterDone = false; window.__experience.enterStage(n, .1).then(() => (window.__enterDone = true)); }, ev.n);
  const ms = await pump(() => window.__enterDone === true && window.__cine.ready(), 'stage ' + ev.n);
  let info = null;
  if (ev.shikumen) { // 07 must not start until every SHIKUMEN component is loaded and stable
    info = await page.evaluate(() => document.querySelector('#growthFrame').contentWindow.__growth.getInfo().renderCounts);
    log.push('shikumen renderCounts ' + JSON.stringify(info));
    for (let i = 0; i < 150; i++) await page.evaluate(() => window.__cine.step(33.34));
    await page.waitForTimeout(5000);
  }
  if (ev.cityGrammar) { await page.evaluate((g) => document.querySelector(`[data-city-grammar="${g}"]`).click(), ev.cityGrammar); await page.waitForTimeout(300); await pump(() => window.__cine.ready(), 'city ' + ev.cityGrammar); for (let i = 0; i < 20; i++) await page.evaluate(() => window.__cine.step(33.34)); }
  log.push(`stage ${ev.n} at ${ev.t}s ready after ${ms} ms real` + (ev.cityGrammar ? ' then ' + ev.cityGrammar : ''));
}
async function citySwitch(ev) {
  await xfade(ev.t);
  if (ev.fadeOnly) return;
  await page.evaluate((g) => document.querySelector(`[data-city-grammar="${g}"]`).click(), ev.g);
  await page.waitForTimeout(300);
  const ms = await pump(() => window.__cine.ready(), 'city ' + ev.g);
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.__cine.step(33.34));
  log.push(`city grammar ${ev.g} at ${ev.t}s ready after ${ms} ms real`);
}

// ---- encoder ------------------------------------------------------------------------------------------
let ff = null;
if (!PREVIEW) {
  ff = spawn(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-vf', 'scale=1920:1080:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-r', String(FPS), '-movflags', '+faststart', `${outDir}/silent_raw.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

// ---- main loop ---------------------------------------------------------------------------------------
const frames = Math.round(DUR * FPS), checks = Object.entries(CHECK).map(([k, v]) => [Math.round(+k * FPS), v]);
const stageQ = STAGE_AT.slice(), cityQ = CITY_SWITCH.slice();
const t0real = Date.now(); let done = 0;
const f0 = Math.round(FROM * FPS), f1 = Math.min(frames, Math.round(TO * FPS)), every = PREVIEW ? Math.max(1, Math.round(PREVIEW * FPS)) : 1;
for (let f = 0; f < f1; f++) {
  const t = f / FPS;
  while (stageQ.length && t >= stageQ[0].t) await enterStage(stageQ.shift());
  while (cityQ.length && t >= cityQ[0].t) await citySwitch(cityQ.shift());
  const render = f >= f0 && (f % every === 0 || checks.some(([cf]) => cf === f));
  if (!render && PREVIEW) { if (f % 6 === 0) await page.evaluate((t) => { window.__cine.apply(t); window.__cine.step(33.34 * 6); }, t); continue; }
  await page.evaluate((t) => { window.__cine.apply(t); window.__cine.step(1000 / 30); }, t);
  if (!render) continue;
  const jpg = await page.screenshot({ type: 'jpeg', quality: 93 });
  lastJpeg = jpg;
  if (ff) await write(jpg);
  const ck = checks.find(([cf]) => cf === f);
  if (ck) await writeFile(`${outDir}/${ck[1]}.jpg`, jpg);
  if (PREVIEW) await writeFile(`${outDir}/preview/${String(f).padStart(5, '0')}.jpg`, jpg);
  if (++done % 150 === 0) console.log(`frame ${f}/${f1} t=${t.toFixed(1)}s ${((Date.now() - t0real) / 1000).toFixed(0)}s real`);
}
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
log.push('end ' + new Date().toISOString(), `frames ${f1 - f0}`, `real ${(Date.now() - t0real) / 1000}s`);
await writeFile(`${outDir}/record_log${PREVIEW ? '_preview' : ''}.json`, JSON.stringify({ url: URL0, log, errors: [...new Set(errs)].slice(0, 40) }, null, 1));
console.log(JSON.stringify({ log, errors: [...new Set(errs)].slice(0, 10) }, null, 1));
await browser.close();
