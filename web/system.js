// AI-Driven Lane Reconstruction · system website
// One vertical narrative (hero → context → workflow → input → analysis → inference → options → film → results).
// Reads web/data/*.json only; never edits them. No WebGL, no canvas, no requestAnimationFrame loop:
// the digital space is reached by navigating to experience.html, not embedded here.

const Q = new URLSearchParams(location.search);
const HOUSE = 'R02_W_02';
const DEFAULT = { evidence: null, intent: null, analysisDone: 0, grammar: 'ban' };
const GRAMMARS = {
  almond: {
    title: 'Almond', subtitle: 'Organic Gothic', img: 'system_assets/option_almond.jpg',
    text: 'Trunks rise from the broken walls and branch into Gothic ribs, closed by thin membranes.',
    system: 'Trunk • branch • node • membrane',
    alt: 'Almond repair: branching ribs and membranes grow from the residual walls of the burned row.',
  },
  ban: {
    title: 'Ban', subtitle: 'Folded tectonic', img: 'system_assets/option_ban.jpg',
    text: 'Paper tubes and folded modules assemble a light frame inside the missing envelope.',
    system: 'Tube • folded module • perforation • inner membrane',
    alt: 'Ban repair: paper tubes and folded perforated modules fill the missing walls and roofs.',
  },
  shikumen: {
    title: 'Shikumen', subtitle: 'Reconstructed masonry', img: 'system_assets/option_shikumen.jpg',
    text: 'Brick, tile and stone trim rebuild the lost masonry in the language of the lane.',
    system: 'Brick • tile • trim • seam • openings',
    alt: 'Shikumen repair: brick courses, roof tiles and trims rebuild the missing masonry.',
  },
};
const FLOW = [
  { n: '01', name: 'Input', text: 'Evidence of the ruin and a style reference enter the system.', img: 'system_assets/stage01_fire.jpg', alt: 'Thermal point cloud of the fire inside the damaged lane.', data: () => '2 INPUT SLOTS • RUIN + REFERENCE' },
  { n: '02', name: 'Detect', text: 'Residual walls, fractures and voids are measured.', img: 'system_assets/stage02_damage.jpg', alt: 'Damage scan passing over the broken walls.', data: () => `VOID ${fmt(voidShare())}% • ${HOUSE}` },
  { n: '03', name: 'Infer', text: 'Typology rebuilds the missing envelope as a target skeleton.', img: 'system_assets/stage03_inference.jpg', alt: 'Target skeleton drawn over the residual walls.', data: () => `EVIDENCE ${fmt(layer('ban')?.evidence)}%` },
  { n: '04', name: 'Generate', text: 'Three grammars repair the same ruin in comparable form.', img: 'system_assets/option_ban.jpg', alt: 'Ban repair of the burned row.', data: () => '3 GRAMMARS • 18 DATASETS' },
  { n: '05', name: 'Explore', text: 'The repaired lane returns to the city as a navigable space.', img: 'system_assets/stage08_drone_low.jpg', alt: 'Low drone view of the reconstructed lane in the city.', data: () => '08 STAGES • DIGITAL SPACE' },
];
const PIPE = [
  ['Damage detection', 'AI ESTIMATE'], ['Residual wall segmentation', 'MODEL EXPORT'], ['Crack and trace reading', 'AI ESTIMATE'],
  ['Missing region inference', 'MODEL EXPORT'], ['Point-cloud registration', 'MODEL EXPORT'], ['Structural path extraction', 'MODEL EXPORT'],
  ['Data quantification', 'MODEL EXPORT'],
];

let S = load();
const D = {};
const $ = (s, r = document) => r.querySelector(s);
const fmt = (v, d = 1) => (v == null || Number.isNaN(+v) ? null : (+v).toFixed(d));
const thumbs = {};                       // object URLs for this session only

function load() {
  let s;
  try { s = JSON.parse(localStorage.getItem('rebuild-system-v2') || 'null'); } catch { s = null; }
  s = { ...DEFAULT, ...(s || {}) };
  if (GRAMMARS[Q.get('g')]) s.grammar = Q.get('g');        // ?g=almond|ban|shikumen selects a grammar on load
  if (!GRAMMARS[s.grammar]) s.grammar = 'ban';
  return s;
}
function save() {
  const { evidence, intent, analysisDone, grammar } = S;
  try { localStorage.setItem('rebuild-system-v2', JSON.stringify({ evidence, intent, analysisDone, grammar })); } catch { /* private mode */ }
}

async function data() {
  const get = (n) => fetch(`data/${n}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [lane, damage, layers, stats, grammar] = await Promise.all(['lane.json', 'damage.json', 'layers.json', 'skeleton_stats.json', 'grammar.json'].map(get));
  Object.assign(D, { lane, damage, layers, stats, grammar });
}
const house = () => D.damage?.houses?.find((h) => h.house_id === HOUSE);
const voidShare = () => house()?.levels?.['空洞']?.area_share_percent ?? null;
const layer = (g) => D.layers?.variants?.find((v) => v.grammar === g)?.shares_percent ?? null;
const stat = (g) => D.stats?.records?.find((r) => r.house_id === HOUSE && r.grammar === g) ?? null;

// A readout: label, value (null → PENDING), unit, source class
function readout(label, value, unit, source) {
  const pending = value == null;
  return `<div class="readout${pending ? ' pending' : ''}"><dt>${label}</dt><dd><span class="value">${pending ? 'PENDING' : value + (unit || '')}</span><span class="badge small">${pending ? 'NOT IN DATASET' : source}</span></dd></div>`;
}

// ---------------------------------------------------------------- workflow
function renderFlow() {
  $('#flow').innerHTML = FLOW.map((f, i) => `
    <article class="card flow-card${i === 0 ? ' lead' : ''}">
      <img src="${f.img}" alt="${f.alt}" loading="lazy" width="1280" height="720">
      <div class="flow-body">
        <span class="badge">${f.n}</span>
        <h3>${f.name}</h3>
        <p class="prose">${f.text}</p>
        <p class="mono meta">${f.data()}</p>
      </div>
    </article>`).join('');
}

// ---------------------------------------------------------------- input
const ACCEPT = { evidence: 'image/*,.pdf,.obj,.ply,.las', intent: 'image/*,.pdf' };
const FORMATS = { evidence: 'JPG • PNG • PDF • OBJ • PLY • LAS • MAX 50 MB', intent: 'JPG • PNG • PDF • MAX 20 MB' };
const LIMIT = { evidence: 50, intent: 20 };
const bytes = (n) => (n == null ? '—' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

function renderSlot(kind) {
  const f = S[kind], el = $(`#slot-${kind}`);
  const id = `file-${kind}`;
  if (!f) {
    el.innerHTML = `
      <label class="drop" for="${id}">
        <svg class="icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 28V10M12 18l8-8 8 8M8 30h24"/></svg>
        <span class="drop-title">Choose or drop a file</span>
        <span class="mono">${FORMATS[kind]}</span>
      </label>
      <input class="visually-hidden" type="file" id="${id}" accept="${ACCEPT[kind]}" data-kind="${kind}">`;
  } else {
    const src = thumbs[kind] || f.preview;
    el.innerHTML = `
      <div class="file">
        ${src ? `<img src="${src}" alt="Preview of ${f.name}">` : `<div class="file-ph mono" aria-hidden="true">${(f.name.split('.').pop() || 'FILE').toUpperCase()}</div>`}
        <div class="file-meta">
          <p class="file-name">${f.name}</p>
          <p class="mono">${bytes(f.size)} • <span class="ready"><i class="dot" aria-hidden="true"></i>FILE READY</span>${f.demo ? ' • DEMONSTRATION' : ''}</p>
          <div class="file-actions">
            <label class="pill quiet" for="${id}">Replace</label>
            <input class="visually-hidden" type="file" id="${id}" accept="${ACCEPT[kind]}" data-kind="${kind}">
            <button class="pill quiet" type="button" data-remove="${kind}">Remove</button>
          </div>
        </div>
      </div>`;
  }
  const input = $(`#${id}`);
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > LIMIT[kind] * 1048576) { status(`FILE TOO LARGE • LIMIT ${LIMIT[kind]} MB`); return; }
    if (thumbs[kind]) URL.revokeObjectURL(thumbs[kind]);
    thumbs[kind] = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    S[kind] = { name: file.name, size: file.size, demo: false };
    S.analysisDone = 0;
    save(); renderSlot(kind); refreshInput();
  };
  const rm = el.querySelector('[data-remove]');
  if (rm) rm.onclick = () => {
    if (thumbs[kind]) URL.revokeObjectURL(thumbs[kind]);
    delete thumbs[kind];
    S[kind] = null; S.analysisDone = 0; save(); renderSlot(kind); refreshInput();
    $(`#file-${kind}`)?.focus();
  };
  // drag and drop onto the label
  const drop = el.querySelector('.drop');
  if (drop) {
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => {
      e.preventDefault(); drop.classList.remove('over');
      const dt = new DataTransfer(); if (e.dataTransfer.files[0]) dt.items.add(e.dataTransfer.files[0]);
      input.files = dt.files; input.onchange();
    };
  }
}
function status(t) { $('#uploadStatus').textContent = t; }
function refreshInput() {
  const both = !!(S.evidence && S.intent);
  $('#analyze').disabled = !both;
  if (both) status(S.evidence.demo && S.intent.demo ? 'DEMONSTRATION DATASET LOADED • READY' : 'TWO INPUTS READY • PREVIEW ONLY, NOT UPLOADED');
  else status(`WAITING FOR ${!S.evidence && !S.intent ? 'TWO INPUTS' : !S.evidence ? 'DAMAGED BUILDING' : 'STYLE REFERENCE'}`);
}
const fileSize = async (u) => { try { const r = await fetch(u); return (await r.blob()).size; } catch { return null; } };
async function demoFile(kind, grammar = S.grammar) {
  if (kind === 'evidence') S.evidence = { name: 'community_05_R02_W_02_before.jpg', size: await fileSize('system_assets/context_damaged_lane.jpg'), demo: true, preview: 'system_assets/context_damaged_lane.jpg' };
  else S.intent = { name: `${grammar}_reference.jpg`, size: await fileSize(`../references/${grammar}.jpg`), demo: true, preview: `../references/${grammar}.jpg` };
  save(); renderSlot(kind); refreshInput();
}
async function loadDemo() {
  await demoFile('evidence'); await demoFile('intent');
  $('#analyze').focus();
}

// ---------------------------------------------------------------- guided demo
// Walks the whole site with a visible pointer and captions, then opens the existing digital space
// (experience.html?tour=1) so stages 01–08 play on their own. Timed with setTimeout only; Stop or Escape ends it.
const GUIDE_GRAMMAR = 'ban';
const guide = { on: false, timer: null, step: 0 };
const GUIDE_STEPS = 8;
const wait = (ms) => new Promise((res, rej) => { guide.timer = setTimeout(() => (guide.on ? res() : rej(new Error('stopped'))), reduced() ? Math.min(ms, 600) : ms); });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function caption(step, title, text) {
  guide.step = step;
  $('#guideStep').textContent = `${String(step).padStart(2, '0')} / ${String(GUIDE_STEPS).padStart(2, '0')}`;
  $('#guideTitle').textContent = title;
  $('#guideText').textContent = text;
  $('#guideProgress').style.transform = `scaleX(${step / GUIDE_STEPS})`;
}
function point(el, click = false) {
  const p = $('#guidePointer');
  if (!el) { p.hidden = true; return; }
  const r = el.getBoundingClientRect();
  p.hidden = false;
  p.style.transform = `translate(${Math.round(r.left + r.width / 2 - 11)}px, ${Math.round(r.top + r.height / 2 - 11)}px)`;
  document.querySelectorAll('.guide-target').forEach((x) => x.classList.remove('guide-target'));
  el.classList.add('guide-target');
  if (click) { p.classList.remove('click'); void p.offsetWidth; p.classList.add('click'); }
}
async function show(id, settle = 900) { go(id); await wait(settle); }
async function runGuide() {
  if (guide.on) return;
  guide.on = true;
  document.body.classList.add('guiding');
  $('#guide').hidden = false;
  $('#guideStop').focus();
  try {
    caption(1, 'Start', 'This demonstration walks through the system with the project dataset, then opens the digital space.');
    await show('hero', 600); await wait(1800);

    // reset the input so the visitor sees the slots fill
    ['evidence', 'intent'].forEach((k) => { S[k] = null; renderSlot(k); });
    S.analysisDone = 0; refreshInput(); drawPipe();
    caption(2, 'Add a photo', 'Add a photograph or model of the damaged building. Here: house R02_W_02 after the fire.');
    await show('input');
    point($('#slot-evidence .drop'), true); await wait(1200);
    await demoFile('evidence'); point($('#slot-evidence .file')); await wait(1800);

    caption(3, 'Choose a style', 'Add one style reference. The repair grammar is read from it. Here: the paper-tube reference (Ban).');
    point($('#slot-intent .drop'), true); await wait(1200);
    await demoFile('intent', GUIDE_GRAMMAR); point($('#slot-intent .file')); await wait(1800);

    caption(4, 'Analyze damage', 'Both inputs are ready. The detection sequence measures walls, voids and fracture edges.');
    point($('#analyze'), true); await wait(900);
    point(null); await show('analysis', 700);
    await new Promise((res) => runAnalysis(res)); renderInference(); await wait(1200);

    caption(5, 'AI inference', 'Every rebuilt surface is classed as evidence, inference or imagination. The three shares add up to 100%.');
    await show('inference'); point($('#segments')); await wait(3200);

    caption(6, 'Select a repair grammar', 'Three grammars repair the same ruin. The demo selects Ban, the grammar read from the reference.');
    point(null); await show('options');
    point($(`[data-grammar="${GUIDE_GRAMMAR}"]`), true); await wait(900);
    select(GUIDE_GRAMMAR); point($(`[data-grammar="${GUIDE_GRAMMAR}"]`)); await wait(2200);

    caption(7, 'Review results', 'Retained structure, rebuilt area and source shares for the selected grammar.');
    point(null); await show('results'); await wait(2800);

    caption(8, 'Enter the digital space', 'Opening the eight-stage reconstruction: 01 Fire to 08 Reconstructed city. It plays automatically.');
    await show('reconstruction', 600);
    point($('#enterSpace'), true);
    for (let n = 3; n > 0; n--) { $('#guideText').textContent = `Opening stages 01 to 08 in ${n}…`; await wait(1000); }
    location.href = `experience.html?tour=1&g=${GUIDE_GRAMMAR}`;
  } catch { /* stopped */ }
}
function stopGuide() {
  if (!guide.on) return;
  guide.on = false;
  clearTimeout(guide.timer);
  $('#guide').hidden = true;
  $('#guidePointer').hidden = true;
  document.querySelectorAll('.guide-target').forEach((x) => x.classList.remove('guide-target'));
  document.body.classList.remove('guiding');
  $('#watchDemo')?.focus();
}

// ---------------------------------------------------------------- analysis
function renderDamage() {
  const v = voidShare(), st = stat(S.grammar), trace = house()?.levels?.['痕迹'];
  $('#damageReadouts').innerHTML = [
    readout('Damage area', fmt(st?.missing_area_m2), ' m²', 'MODEL EXPORT'),
    readout('Void ratio', fmt(v), '%', 'AI ESTIMATE'),
    readout('Structural loss', null),
    readout('Crack traces', trace?.available_value == null ? null : String(trace.available_value), ' found', 'AI ESTIMATE'),
    readout('Confidence', null),
  ].join('');
  drawPipe();
}
function drawPipe() {
  $('#pipeline').innerHTML = PIPE.map(([name, src], i) => {
    const state = i < S.analysisDone ? 'done' : i === S.analysisDone && running ? 'active' : '';
    return `<li class="${state}"><i class="dot" aria-hidden="true"></i><span>${name}</span><span class="mono">${state === 'done' ? 'DONE' : state === 'active' ? 'RUNNING' : 'QUEUED'} • ${src}</span></li>`;
  }).join('');
  $('#analysisStatus').textContent = S.analysisDone >= PIPE.length ? 'SEQUENCE COMPLETE • DEMONSTRATION DATA' : running ? `RUNNING ${S.analysisDone + 1} / ${PIPE.length}` : 'SEQUENCE NOT RUN';
}
let running = false, timer = null;
function runAnalysis(then) {
  if (running) return;
  running = true; S.analysisDone = 0; drawPipe();
  $('#runAnalysis').disabled = true;
  timer = setInterval(() => {
    S.analysisDone++;
    if (S.analysisDone >= PIPE.length) { clearInterval(timer); running = false; $('#runAnalysis').disabled = false; save(); then && then(); }
    drawPipe();
  }, 420);
}

// ---------------------------------------------------------------- inference
function renderInference() {
  const p = layer(S.grammar), st = stat(S.grammar);
  $('#layerGrammar').textContent = S.grammar.toUpperCase();
  const parts = [['evidence', 'Evidence', 'Surviving walls'], ['inference', 'Inference', 'Implied by typology'], ['imagination', 'Imagination', 'Invented by grammar']];
  if (!p) {
    $('#segments').innerHTML = '<p class="mono">PENDING</p>';
    $('#legend').innerHTML = '';
  } else {
    $('#segments').setAttribute('aria-label', parts.map(([k, n]) => `${n} ${fmt(p[k])} percent`).join(', '));
    $('#segments').innerHTML = parts.map(([k, n]) => `<span class="seg ${k}" style="flex-basis:${p[k]}%"><b class="mono">${fmt(p[k])}%</b><i aria-hidden="true"></i></span>`).join('');
    $('#legend').innerHTML = parts.map(([k, n, d]) => `<div class="legend-row ${k}"><dt><i aria-hidden="true"></i>${n}</dt><dd class="mono">${fmt(p[k])}% • ${d.toUpperCase()}</dd></div>`).join('');
  }
  $('#inferenceReadouts').innerHTML = [
    readout('Confidence', null),
    readout('Target model', st ? `${HOUSE}` : null, '', '6 / 6 TARGETS'),
    readout('Reconstruction status', S.analysisDone >= PIPE.length ? 'Target model complete' : 'Awaiting sequence', '', 'DEMONSTRATION'),
  ].join('');
}

// ---------------------------------------------------------------- options
function renderOptions() {
  $('#optionGrid').innerHTML = Object.entries(GRAMMARS).map(([g, o], i) => {
    const st = stat(g), on = S.grammar === g;
    return `<article class="card option${on ? ' selected' : ''}" aria-labelledby="opt-${g}">
      <div class="option-head"><span class="badge">0${i + 1}</span>${on ? '<span class="selected-tag mono"><i class="dot" aria-hidden="true"></i>SELECTED</span>' : ''}</div>
      <h3 id="opt-${g}">${o.title}<span>${o.subtitle}</span></h3>
      <img src="${o.img}" alt="${o.alt}" loading="lazy" width="1200" height="800">
      <p class="prose">${o.text}</p>
      <dl class="mono">
        <div><dt>CONSTRUCTION</dt><dd>${o.system.toUpperCase()}</dd></div>
        <div><dt>COVERAGE</dt><dd>${st ? fmt(st.coverage_percent) + '%' : 'PENDING'}</dd></div>
        <div><dt>SKELETON</dt><dd>${st ? Math.round(st.skeleton_length_m).toLocaleString('en-US') + ' M' : 'PENDING'}</dd></div>
      </dl>
      <button class="pill" type="button" data-grammar="${g}" aria-pressed="${on}">${on ? 'Selected option' : 'View option'}</button>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-grammar]').forEach((b) => (b.onclick = () => select(b.dataset.grammar)));
}
function select(g) {
  S.grammar = g; save();
  renderOptions(); renderInference(); renderResults(); renderDamage();
  $('#optionStatus').textContent = `SELECTED ${g.toUpperCase()} • ${GRAMMARS[g].subtitle.toUpperCase()}`;
  $(`[data-grammar="${g}"]`)?.focus();
}

// ---------------------------------------------------------------- results
function renderResults() {
  const v = voidShare(), p = layer(S.grammar), st = stat(S.grammar), o = GRAMMARS[S.grammar];
  const img = $('#resultsImage');
  img.src = `system_assets/results_city_${S.grammar}.jpg`;
  img.alt = `The reconstructed lane in its city block, repaired with ${o.title} (${o.subtitle.toLowerCase()}).`;
  $('#resultsCaption').textContent = `COMMUNITY_05 • ${o.title.toUpperCase()} • STAGE 08 CAPTURE`;
  $('#resultReadouts').innerHTML = [
    readout('Selected grammar', `${GRAMMARS[S.grammar].title} / ${GRAMMARS[S.grammar].subtitle}`, '', 'AUTHOR SELECTION'),
    readout('Retained structure', v == null ? null : fmt(100 - v), '%', 'AI ESTIMATE'),
    readout('Reconstructed area', fmt(st?.missing_area_m2), ' m²', 'MODEL EXPORT'),
    readout('Evidence', fmt(p?.evidence), '%', 'AI ESTIMATE'),
    readout('Inference', fmt(p?.inference), '%', 'MODEL EXPORT'),
    readout('Imagination', fmt(p?.imagination), '%', 'MODEL EXPORT'),
    readout('Coverage', fmt(st?.coverage_percent), '%', 'MODEL EXPORT'),
  ].join('');
}

// ---------------------------------------------------------------- film
function setupFilm() {
  const v = $('#film');
  // the film is not part of every copy of the site (it exceeds GitHub's file limit); when it cannot load,
  // keep the poster, disable the play controls and say why instead of leaving dead buttons
  const missing = () => {
    v.removeAttribute('controls');
    ['#playFilm', '#playFull'].forEach((id) => { const b = $(id); if (b) { b.disabled = true; b.title = 'Film not included in this copy'; } });
    const n = $('#filmNote'); if (n) n.textContent = 'FILM NOT INCLUDED IN THIS ONLINE COPY • POSTER ONLY';
  };
  const src = v.querySelector('source');
  if (src) src.addEventListener('error', missing);
  fetch(src?.getAttribute('src') || '', { method: 'HEAD' }).then((r) => { if (!r.ok) missing(); }).catch(missing);
  const play = () => { $('#reconstruction').scrollIntoView({ behavior: smooth(), block: 'start' }); v.play().catch(() => v.focus()); };
  $('#playFilm').onclick = play;
  $('#playFull').onclick = play;
  // pause when out of view or when the page is hidden
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => es.forEach((e) => { if (!e.isIntersecting && !v.paused) v.pause(); }), { threshold: 0.15 }).observe(v);
  document.addEventListener('visibilitychange', () => { if (document.hidden && !v.paused) v.pause(); });
}

// ---------------------------------------------------------------- nav, menu, dialog, reveal
const smooth = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
const LEGACY = { landing: 'hero', upload: 'input', quantification: 'analysis', generate: 'options', twin: 'reconstruction', report: 'results' };
function go(id) {
  const el = document.getElementById(LEGACY[id] || id);
  if (!el) return;
  el.scrollIntoView({ behavior: smooth(), block: 'start' });
  history.replaceState(null, '', '#' + el.id);
}
let io;
function setupObservers() {
  if (!('IntersectionObserver' in window)) return;
  const links = [...document.querySelectorAll('#menu a')];
  io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) links.forEach((l) => (l.dataset.scroll === e.target.id ? l.setAttribute('aria-current', 'true') : l.removeAttribute('aria-current')));
  }), { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main > section').forEach((s) => io.observe(s));
  // one-shot reveal: opacity + transform only, observer disconnects each target after it appears
  const rv = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }), { threshold: 0.12 });
  document.querySelectorAll('.section-head, .card, .context-copy, .context-figure').forEach((el) => { el.classList.add('reveal'); rv.observe(el); });
}

// ---------------------------------------------------------------- boot
async function boot() {
  await data();
  const facts = { units: D.lane?.units?.length, damaged: D.damage?.houses?.length };
  document.querySelectorAll('[data-fact]').forEach((el) => { const v = facts[el.dataset.fact]; if (v != null) el.textContent = v; });
  renderFlow();
  renderSlot('evidence'); renderSlot('intent'); refreshInput();
  renderDamage(); renderInference(); renderOptions(); renderResults();
  setupFilm();
  setupNavSafe();
  setupObservers();
  $('#loadDemo').onclick = loadDemo;
  $('#watchDemo').onclick = runGuide;
  $('#guideStop').onclick = stopGuide;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && guide.on) stopGuide(); });
  $('#runAnalysis').onclick = () => runAnalysis(() => renderInference());
  $('#analyze').onclick = () => { go('analysis'); runAnalysis(() => renderInference()); };
  if (Q.get('demo') === '1' && !(S.evidence && S.intent)) await loadDemo();
  if (Q.get('guide') === '1') setTimeout(runGuide, 400);
  const h = location.hash.slice(1);
  if (h) setTimeout(() => { const el = document.getElementById(LEGACY[h] || h); if (el) el.scrollIntoView({ block: 'start' }); }, 0);
  window.__ready = true;
}
function setupNavSafe() {
  const menu = $('#menu'), btn = $('#menuButton');
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.onclick = () => { const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('a').focus(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { close(); btn.focus(); } });
  document.querySelectorAll('[data-scroll]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); close(); go(a.dataset.scroll); }));
  const dlg = $('#compare');
  $('#beforeAfter').onclick = () => dlg.showModal();
  $('#closeCompare').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}
boot();
