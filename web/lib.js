// 灾后重建 · 网页共用部分：数据读取、撒点、着色器、弄堂、一套修复数据的组装
// main.js（45 秒概念影片）和 story.js（滚动叙事）都从这里引用。
//
// 数据（renders/<set>/growth/，Rhino 坐标，米，Z 向上）：
//   targets.obj  修复后的表面，按面积撒体积粒子
//   walls.obj    烧剩的砖墙（废墟本体）
//   breaks.csv   断口：粒子先后、余烬、废墟焦黑
//   edges.csv    特征边：点线，按 kind 的建造顺序亮起，按 source 分证据、推断两种样式
//   growth.csv   生长线：想象层，浅青、闪烁
//   camera.json  street 机位
// 场景是 Rhino 坐标（Z 向上），整体放在一个绕 X 转 -90° 的组里；Three.js 是 Y 向上。
//
// 着色器的时钟分开给，叙事页才能单独控制每一层：
//   uP        修复进度（体积粒子回落、生长线），时序同 td_cloud.py 阶段 4
//   uLineP    证据、推断点线的勾线进度（影片里等于 uP；叙事页里推断线可以先于粒子亮起）
//   uConfAmt  按房间可信度调点线：可信度低的更稀、更暗（点线要有 aConf 属性，没有时不起作用）
//   uRuinP    废墟轮廓的进度（0.03~0.4 从地面描到断口）
//   uEmberOn  余烬亮度 0~1
//   uDissolve 修复部分散成灰往上飘走
//   uGain     x 证据点线  y 推断点线  z 想象（生长线）  w 废墟轮廓
//   uCloudGain 体积粒子总亮度，uCharAmt 废墟烧黑程度

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ruinMaterial, uvMeters, quality, LANE_W } from './lane.js';
export { buildLane, quality, LANE_W, pbr } from './lane.js';
export { Soundscape } from './sound.js';

export const ROOT = '../renders/';
// 表现参数：项目根目录的 look.json，和 td_cloud.py 共用；改完保存，页面 2 秒内自动刷新
export const LOOK_URL = '../look.json';
export const LOOK_TEXT = await fetch(LOOK_URL, { cache: 'no-store' }).then((r) => r.text()).catch(() => '{}');
export const LOOK = JSON.parse(LOOK_TEXT);
export const lk = (path, def) => path.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), LOOK) ?? def;
export const col = (path, def) => new THREE.Color(...lk(path, def));
const R = 'rhythm.';
export const DURATION = lk(R + 'duration_s', 45);   // 秒，导演模式和播放都按这个时长走完 0~1
export const RHYTHM = {
  emberEnd: lk(R + 'ember_end', 0.1), fallStart: lk(R + 'fall_start', 0.1), fallEnd: lk(R + 'fall_end', 0.6),
  lineStart: lk(R + 'line_start', 0.4), lineEnd: lk(R + 'line_end', 0.85), hold: lk(R + 'hold_start', 0.85),
  ruinLine: lk(R + 'ruin_line', [0.03, 0.4]), dissolve: lk(R + 'dissolve_s', 5),
  span: 0.12 / Math.max(0.05, lk('particles.gather_speed', 1)), upward: lk('particles.upward', 0.8),
};
// 勾线段里各组的位置（按段的比例）
const LG = lk(R + 'line_groups', {});
export const LINE_GROUPS = [
  [['wall', 'shell'], ...(LG.wall || [0.0, 0.4])],
  [['floor'], ...(LG.floor || [0.2, 0.5])],
  [['roof'], ...(LG.roof || [0.4, 0.65])],
  [['door', 'window', 'partition', 'stair'], ...(LG.frame || [0.55, 0.8])],
];
export const GROWTH_GROUP = LG.growth || [0.7, 1.0];
export const FRAME_KINDS = new Set(['door', 'window', 'partition', 'stair']);

export const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
export const defaultCount = () => (isMobile ? lk('particles.count_mobile', 60000)
  : (navigator.hardwareConcurrency || 4) <= 4 ? lk('particles.count_low', 100000) : lk('particles.count', 200000));

// ---------------------------------------------------------------- 工具

export function rng(seed) {                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return r.text();
}

export async function exists(url) {
  try { return (await fetch(url, { method: 'HEAD' })).ok; } catch { return false; }
}

export function parseObj(src) {
  // 返回 { tris: Float32Array(9n), names: [] }，多边形按扇形拆三角
  const vs = [], tris = [], names = [];
  let name = '';
  for (const line of src.split('\n')) {
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      vs.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('f ')) {
      const ii = line.trim().split(/\s+/).slice(1).map((t) => parseInt(t, 10) - 1);
      for (let k = 1; k < ii.length - 1; k++) {
        for (const i of [ii[0], ii[k], ii[k + 1]]) tris.push(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2]);
        names.push(name);
      }
    } else if (line.startsWith('o ')) {
      name = line.slice(2).trim();
    }
  }
  return { tris: new Float32Array(tris), names };
}

export function parseCsv(src) {
  const lines = src.trim().split('\n');
  const head = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const c = l.split(',');
    const o = {};
    head.forEach((h, i) => { o[h] = c[i]; });
    return o;
  });
}

export function nearestAll(pts, ref, maxRef = 900, seed = 2) {
  // 每个点到参考点的最近距离。参考点抽稀到 maxRef 个，在类型数组里暴力算（20 万 × 900 约 0.3 秒）
  let r = ref;
  if (ref.length / 3 > maxRef) {
    const rr = rng(seed), m = ref.length / 3;
    r = new Float32Array(maxRef * 3);
    for (let i = 0; i < maxRef; i++) { const j = Math.floor(rr() * m); r[i * 3] = ref[j * 3]; r[i * 3 + 1] = ref[j * 3 + 1]; r[i * 3 + 2] = ref[j * 3 + 2]; }
  }
  const n = pts.length / 3, k = r.length / 3, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    let best = Infinity;
    for (let j = 0; j < k; j++) {
      const dx = r[j * 3] - x, dy = r[j * 3 + 1] - y, dz = r[j * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) best = d;
    }
    out[i] = Math.sqrt(best);
  }
  return out;
}

export class Grid {
  // 空间哈希：给大量点找最近的参考点
  constructor(pts, cell) {
    this.cell = cell;
    this.pts = pts;
    this.map = new Map();
    for (let i = 0; i < pts.length / 3; i++) {
      const k = this.key(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      if (!this.map.has(k)) this.map.set(k, []);
      this.map.get(k).push(i);
    }
  }
  key(x, y, z) {
    const c = this.cell;
    return this.k3(Math.floor(x / c), Math.floor(y / c), Math.floor(z / c));
  }
  k3(i, j, k) { return ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096); }   // 数字键，比字符串快很多
  nearest(x, y, z, maxRing = 40) {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c);
    let best = Infinity;
    for (let r = 0; r <= maxRing; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const l = this.map.get(this.k3(cx + dx, cy + dy, cz + dz));
        if (!l) continue;
        for (const i of l) {
          const ex = this.pts[i * 3] - x, ey = this.pts[i * 3 + 1] - y, ez = this.pts[i * 3 + 2] - z;
          best = Math.min(best, ex * ex + ey * ey + ez * ez);
        }
      }
      if (best < Infinity && Math.sqrt(best) < r * c) break;   // 再外一圈不可能更近
    }
    return Math.sqrt(best);
  }
}

export function sampleSurface(tris, n, rand, filter) {
  // 按三角形面积撒 n 个点
  const m = tris.length / 9;
  const cum = new Float64Array(m);
  let tot = 0;
  for (let i = 0; i < m; i++) {
    let a = 0;
    if (!filter || filter(i)) {
      const o = i * 9;
      const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
      const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      a = 0.5 * Math.hypot(cx, cy, cz);
    }
    tot += a;
    cum[i] = tot;
  }
  const out = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) {
    const r = rand() * tot;
    let lo = 0, hi = m - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const o = lo * 9;
    let r1 = rand(), r2 = rand();
    if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    for (let k = 0; k < 3; k++) {
      out[j * 3 + k] = tris[o + k] + r1 * (tris[o + 3 + k] - tris[o + k]) + r2 * (tris[o + 6 + k] - tris[o + k]);
    }
  }
  return out;
}

export function featureEdges(tris, angle = 30) {
  // 1mm 焊接顶点后，只属于一个三角形的边或两侧法向夹角超过 angle 的边
  const keyOf = (o) => [tris[o], tris[o + 1], tris[o + 2]].map((v) => Math.round(v * 1000)).join(',');
  const edges = new Map();
  const nrm = [];
  const m = tris.length / 9;
  for (let f = 0; f < m; f++) {
    const o = f * 9;
    const ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
    const vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n);
    if (l < 1e-9) { nrm.push(null); continue; }
    nrm.push(n.map((v) => v / l));
    const ks = [keyOf(o), keyOf(o + 3), keyOf(o + 6)];
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const k = ks[a] < ks[b] ? ks[a] + '|' + ks[b] : ks[b] + '|' + ks[a];
      if (!edges.has(k)) edges.set(k, { pa: o + a * 3, pb: o + b * 3, faces: [] });
      edges.get(k).faces.push(f);
    }
  }
  const cosA = Math.cos(angle * Math.PI / 180);
  const out = [];
  for (const e of edges.values()) {
    if (e.faces.length === 2) {
      const a = nrm[e.faces[0]], b = nrm[e.faces[1]];
      if (a && b && Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) > cosA) continue;
    }
    out.push([[tris[e.pa], tris[e.pa + 1], tris[e.pa + 2]], [tris[e.pb], tris[e.pb + 1], tris[e.pb + 2]]]);
  }
  return out;
}

export function resample(pl, step) {
  // 折线 pl（[[x,y,z],…]）按间距重采样，返回 [点, 沿线比例]
  const cum = [0];
  for (let i = 1; i < pl.length; i++) cum.push(cum[i - 1] + Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1], pl[i][2] - pl[i - 1][2]));
  const L = cum[cum.length - 1];
  if (L < 1e-6) return [[pl[0]], [0]];
  const m = Math.max(2, Math.floor(L / step) + 1);
  const pts = [], fr = [];
  let j = 0;
  for (let i = 0; i < m; i++) {
    const s = L * i / (m - 1);
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const t = (s - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-9);
    pts.push([0, 1, 2].map((k) => pl[j][k] + t * (pl[j + 1][k] - pl[j][k])));
    fr.push(s / L);
  }
  return [pts, fr];
}

// ---------------------------------------------------------------- 着色器

export { NOISE } from './glsl.js';
import { NOISE } from './glsl.js';

// 点的公共部分：按世界尺寸算屏幕像素，小于 1.5 像素时把亮度按面积折算，不闪
const POINT_SIZE = /* glsl */`
uniform float uScale;      // 画布高度 /(2 tan(fov/2))
uniform float uFog;        // FogExp2 的密度
uniform float uNear;       // 大于 0 时，离相机近于这个距离（米）的点渐暗，室内穿行时不糊成团
varying vec3 vColor;
varying float vFog;
void finishPoint(vec4 mv, float worldSize, vec3 col) {
  float px = min(worldSize * uScale / max(-mv.z, 0.05), 9.0);
  float k = clamp(px / 1.5, 0.0, 1.0);
  gl_PointSize = max(px, 1.5);
  float d = length(mv.xyz);
  vColor = col * k * k * (uNear > 0.0 ? smoothstep(0.25 * uNear, uNear, d) : 1.0);
  vFog = exp(-uFog * uFog * d * d);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */`
varying vec3 vColor;
varying float vFog;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = length(q) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 1.6);
  gl_FragColor = vec4(vColor * a * vFog, 1.0);
}
`;

const CLOUD_VERT = /* glsl */`
${NOISE}
${POINT_SIZE}
attribute vec4 aData;      // x 先后  y 暴露度  z w 随机数
attribute vec4 aRand;      // 四个随机数
uniform float uTime, uP, uSpan, uNoise, uSpread, uTopZ, uFallH, uG0, uG1, uHold;
uniform float uDiss, uWindA, uWindDist, uSize, uBright, uFront, uDissolve, uPass, uCloudGain;
uniform vec3 uColor, uEmber;
vec3 n3(vec3 q) { return vec3(snoise(q), snoise(q + vec3(31.4, 17.2, 9.1)), snoise(q + vec3(-7.3, 45.1, 23.8))); }
void main() {
  vec3 tgt = position;
  float order = aData.x, expo = aData.y;
  float G0 = uG0, G1 = max(uG1, uG0 + 0.05);
  float LEAD = max(G0, 0.02);
  float span = clamp(uSpan, 0.02, G1 - G0);
  float t0 = G0 + order * (G1 - G0 - span);
  float k = clamp((uP - t0) / span, 0.0, 1.0);
  float e = k * k * (3.0 - 2.0 * k);

  // 散开位置：建筑上方的空中
  float a1 = aRand.x * 6.2831853;
  vec3 scat = vec3(tgt.xy + vec2(cos(a1), sin(a1)) * uSpread * sqrt(aRand.y), uTopZ + uFallH * (0.2 + 0.8 * aRand.z));
  vec3 nv = n3(tgt * 0.6 + vec3(0.0, 0.0, uTime * 0.15));
  vec3 pos = mix(scat, tgt, e);

  // 零星烟灰：离断口近的一小部分粒子先从断口升到空中
  bool early = aRand.w < 0.15 && order < 0.25;
  if (early && uP < t0) { float r = smoothstep(t0 - LEAD, t0, uP); pos = mix(tgt, scat, r * r); }
  float vis = early ? smoothstep(t0 - LEAD, t0 - 0.6 * LEAD, uP) : smoothstep(t0, t0 + 0.25 * span, uP);
  pos += nv * uNoise * (1.2 * (1.0 - e) + 0.03);
  float bright = vis * mix(0.3, 1.0, e);
  float front = smoothstep(0.7, 1.0, k) * (1.0 - smoothstep(0.0, 0.06, uP - (t0 + span)));
  bright *= 1.0 + uFront * front;

  // 消散：停留段里屋顶的一部分粒子像烟灰一样往上飘走再补回
  float zone = smoothstep(0.3, 0.6, expo);
  float pick = step(aData.z, uDiss * zone);
  float per = 3.0 + 4.0 * aData.w;
  float ph = fract(uTime / per + aRand.x * 7.0);
  float blow = ph < 0.35 ? smoothstep(0.0, 0.35, ph) : 1.0 - smoothstep(0.35, 1.0, ph);
  blow *= pick * smoothstep(0.98, 1.0, k) * smoothstep(uHold - 0.03, uHold, uP);
  vec3 wind = vec3(0.35 * cos(uWindA), 0.35 * sin(uWindA), 1.0);
  pos += (wind * uWindDist + nv * 0.6) * blow * (0.5 + aRand.y);
  bright *= 1.0 - 0.4 * blow;

  // 换参考时散成灰
  float kd = smoothstep((1.0 - order) * 0.5, (1.0 - order) * 0.5 + 0.5, uDissolve);
  pos = mix(pos, scat + nv * 0.6, kd);
  bright *= 1.0 - kd * kd;

  // 分两遍画：0 = 还在空中的（不被修复体挡），1 = 落定的（被修复体的深度挡住，只剩看得见的表面）
  bool landed = k >= 0.999 && blow < 0.05 && kd < 0.01;
  if ((uPass < 0.5) == landed) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }

  vec3 col = mix(uEmber, uColor, e * (1.0 - kd));
  col = mix(col, vec3(1.0), 0.6 * front);
  if (bright * uCloudGain < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  finishPoint(modelViewMatrix * vec4(pos, 1.0), uSize, col * bright * uBright * uCloudGain * (vis > 0.001 ? 1.0 : 0.0));
}
`;

const EMBER_VERT = /* glsl */`
${NOISE}
${POINT_SIZE}
attribute float aPhase;
uniform float uTime, uEmberOn, uBright, uSize;
uniform vec3 uEmber;
void main() {
  float n = snoise(position * 1.7 + vec3(0.0, 0.0, uTime * 1.2 + aPhase * 20.0));
  float flick = 0.45 + 0.4 * n + 0.6 * pow(max(n, 0.0), 6.0);
  float env = uEmberOn;
  if (env < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= 1.0 - 0.04 / max(length(mv.xyz), 0.1);     // 往相机提 4cm，不和墙面打架
  finishPoint(mv, uSize, uEmber * uBright * flick * env);
}
`;

const LINE_VERT = /* glsl */`
${NOISE}
${POINT_SIZE}
attribute vec3 aLine;      // x 类别  y 亮起时间  z 随机数
uniform float uTime, uP, uRuinP, uLineP, uConfAmt, uLS, uLE, uBright, uSize, uDissolve;
uniform vec4 uGain;
attribute float aConf;
uniform vec3 uEvid, uInfer, uImag, uEmber;
uniform float uFrame, uTw, uRuinB, uShowG;
void main() {
  int c = int(aLine.x + 0.5);
  // 0 证据  1 推断  3 推断的门窗框  2 想象（生长线）  4 废墟轮廓（时间是总进度）  7 生长线起点的断口闪光
  float t = c == 4 ? aLine.y : uLS + aLine.y * (uLE - uLS);
  float P = c == 4 ? uRuinP : (c == 2 || c == 7 ? uP : uLineP);
  float on = smoothstep(t, t + 0.004, P);
  float fresh = 1.0 - smoothstep(t, t + 0.035, P);
  float n = snoise(vec3(aLine.z * 91.0, 0.0, uTime * 14.0));
  vec3 col;
  float b;
  if (c == 4) { col = uEvid * uRuinB; b = on * (1.0 + fresh * fresh * 1.5); }
  else if (c == 0) { col = uEvid; b = on * (1.0 + fresh * fresh * (2.0 + 1.2 * n * uTw)); }
  else if (c == 1 || c == 3) { col = uInfer * (c == 3 ? uFrame : 1.0); b = on * (1.0 + fresh * fresh * (2.0 + 1.2 * n * uTw)); }
  else if (c == 2) {
    col = uImag;
    float probe = 1.0 - smoothstep(t, t + 0.05, uP);
    float tw = 1.0 + 0.3 * uTw * snoise(position * 2.0 + vec3(0.0, 0.0, uTime * 5.0));
    b = on * tw * (1.0 + probe * probe * (3.5 + 1.5 * n * uTw)) * uShowG;
  } else {
    col = mix(uEmber, vec3(1.0), 0.5);
    float dt = uP - t;
    b = 3.0 * smoothstep(0.0, 0.003, dt) * exp(-max(dt, 0.0) / 0.012) * uShowG;
  }
  if (c != 4) b *= 1.0 - smoothstep(0.0, 0.6, uDissolve);
  if (uConfAmt > 0.0 && (c == 0 || c == 1 || c == 3)) {
    float k = mix(1.0, clamp(aConf, 0.0, 1.0), uConfAmt);
    float h = fract(sin(dot(position, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    if (h > 0.3 + 0.7 * k * k) b = 0.0;
    b *= mix(0.3, 1.0, k * k);
  }
  b *= c == 4 ? uGain.w : (c == 0 ? uGain.x : (c == 2 || c == 7 ? uGain.z : uGain.y));
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= 1.0 - 0.03 / max(length(mv.xyz), 0.1);
  if (b < 0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  finishPoint(mv, uSize, col * b * uBright);
}
`;

export function pointMaterial(vert, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: POINT_FRAG, uniforms,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- 一套修复数据

export async function loadSet(name, COUNT) {
  const base = ROOT + name + '/';
  // 单栋数据在 growth/，社区合并数据直接位于 community_NN/。自动识别，旧页面行为不变。
  const g = await exists(base + 'growth/targets.obj') ? base + 'growth/' : base;
  const [targetsSrc, wallsSrc, breaksSrc, edgesSrc, camSrc] = await Promise.all([
    ...['targets.obj', 'walls.obj', 'breaks.csv', 'edges.csv'].map((f) => text(g + f)),
    text(g + 'camera.json').catch(() => ''),
  ]);
  const growthSrc = await text(g + 'growth.csv').catch(() => '');
  let grammar = {};
  try { grammar = JSON.parse(await text(ROOT + name + '/grammar.json')); } catch { /* 没有就用文件夹名 */ }

  const T = parseObj(targetsSrc), Wl = parseObj(wallsSrc);
  const breaks = parseCsv(breaksSrc).map((r) => [+r.x, +r.y, +r.z]);
  const edgesRows = parseCsv(edgesSrc);
  const cam = camSrc ? JSON.parse(camSrc).views.street : {
    camera: [62, -32, 28], target: [0, 18, 4.5], lens_mm: 35,
  };
  const brkFlat = new Float32Array(breaks.flat());
  const brkGrid = new Grid(brkFlat, 0.5);

  // 包围盒
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < T.tris.length; i += 3) { zmin = Math.min(zmin, T.tris[i]); zmax = Math.max(zmax, T.tris[i]); }
  let wx = -Infinity, wy = -Infinity, wz = -Infinity;
  for (let i = 0; i < Wl.tris.length; i += 3) { wx = Math.max(wx, Wl.tris[i]); wy = Math.max(wy, Wl.tris[i + 1]); wz = Math.max(wz, Wl.tris[i + 2]); }

  // 体积粒子：表面撒点，先后 = 0.8 高度 + 0.2 离断口的距离（换成名次）
  const rand = rng(1);
  const N = COUNT;
  const pos = sampleSurface(T.tris, N, rand);
  const dist = breaks.length ? nearestAll(pos, brkFlat) : new Float32Array(N);
  let dmax = 1e-6;
  for (let i = 0; i < N; i++) dmax = Math.max(dmax, dist[i]);
  const key = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const zr = (pos[i * 3 + 2] - zmin) / Math.max(zmax - zmin, 1e-6);
    const gauss = (rand() + rand() + rand() - 1.5) * 0.8;
    key[i] = RHYTHM.upward * zr + (1 - RHYTHM.upward) * dist[i] / dmax + 0.02 * gauss;
  }
  const idx = new Uint32Array(N).map((_, i) => i).sort((a, b) => key[a] - key[b]);
  // 暴露度：顶部 30% 或靠近特征边
  const featPts = edgesRows.filter((r) => r.kind !== 'growth' && r.kind !== 'stair').map((r) => [+r.x, +r.y, +r.z]);
  const featGrid = new Grid(new Float32Array(featPts.flat()), 0.3);
  const data = new Float32Array(N * 4), rnd = new Float32Array(N * 4);
  idx.forEach((i, rank) => { data[i * 4] = rank / Math.max(N - 1, 1); });
  for (let i = 0; i < N; i++) {
    const z = pos[i * 3 + 2];
    const top = Math.min(1, Math.max(0, (z - (zmax - 0.3 * (zmax - zmin))) / (0.3 * (zmax - zmin))));
    const dn = featPts.length ? featGrid.nearest(pos[i * 3], pos[i * 3 + 1], z, 1) : Infinity;
    data[i * 4 + 1] = Math.max(top, 0.8 * Math.exp(-dn / 0.12));
    data[i * 4 + 2] = rand(); data[i * 4 + 3] = rand();
    for (let k = 0; k < 4; k++) rnd[i * 4 + k] = rand();
  }

  // 点线
  const LINE_STEP = lk('web.line_spacing_m', 0.03), INFER = lk('lines.infer_spacing', 2.5);
  const lp = [], la = [];
  const push = (p, c, t, s) => { lp.push(p[0], p[1], p[2]); la.push(c, Math.min(t, 0.999), s); };
  const lr = rng(7);
  const edges = new Map();
  for (const r of edgesRows) {
    if (!edges.has(r.edge_id)) edges.set(r.edge_id, { kind: r.kind, src: r.source || (r.kind === 'growth' ? 'imagined' : 'inferred'), pts: [] });
    edges.get(r.edge_id).pts.push([+r.order, +r.x, +r.y, +r.z]);
  }
  for (const e of edges.values()) e.pts = e.pts.sort((a, b) => a[0] - b[0]).map((p) => p.slice(1));
  for (const [kinds, g0, g1] of LINE_GROUPS) {
    const grp = [...edges.values()].filter((e) => kinds.includes(e.kind));
    grp.forEach((e) => {
      let pl = e.pts;
      if (Math.abs(pl[pl.length - 1][2] - pl[0][2]) > 0.05) { if (pl[pl.length - 1][2] < pl[0][2]) pl = [...pl].reverse(); }
      else if (breaks.length) {
        const d0 = brkGrid.nearest(...pl[0]), d1 = brkGrid.nearest(...pl[pl.length - 1]);
        if (d1 < d0) pl = [...pl].reverse();
      }
      e.ord = Math.min(...pl.map((p) => p[2]));
      e.pl = pl;
    });
    grp.sort((a, b) => a.ord - b.ord);
    const dur = Math.min(0.07, (g1 - g0) / 2);
    grp.forEach((e, i) => {
      const t0 = g0 + (g1 - g0 - dur) * i / Math.max(grp.length - 1, 1);
      const c = e.src === 'evidence' ? 0 : (FRAME_KINDS.has(e.kind) ? 3 : 1);
      const [pts, fr] = resample(e.pl, c === 0 ? LINE_STEP : LINE_STEP * INFER);
      const s = lr();
      pts.forEach((p, k) => push(p, c, t0 + dur * fr[k], s));
    });
  }
  // 想象：growth.csv 的生长线，从靠断口的一端长出去；起点那段断口闪一下
  const growthStats = { curves: 0, points: 0, length: 0 };
  if (growthSrc) {
    const curves = new Map();
    for (const r of parseCsv(growthSrc)) {
      if (!curves.has(r.curve_id)) curves.set(r.curve_id, []);
      curves.get(r.curve_id).push([+r.point_id, +r.x, +r.y, +r.z]);
    }
    growthStats.curves = curves.size;
    for (const c of curves.values()) {
      growthStats.points += c.length;
      c.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < c.length; i++) growthStats.length += Math.hypot(c[i][1] - c[i - 1][1], c[i][2] - c[i - 1][2], c[i][3] - c[i - 1][3]);
    }
    const cs = [...curves.values()].map((c) => c.sort((a, b) => a[0] - b[0]).map((p) => p.slice(1))).filter((c) => c.length > 1)
      .map((pl) => {
        if (breaks.length && brkGrid.nearest(...pl[pl.length - 1]) < brkGrid.nearest(...pl[0])) pl = [...pl].reverse();
        return pl;
      }).sort((a, b) => a[0][2] - b[0][2]);
    const [g0, g1] = GROWTH_GROUP, dur = 0.12;
    cs.forEach((pl, i) => {
      const t0 = g0 + (g1 - g0 - dur) * i / Math.max(cs.length - 1, 1);
      const [pts, fr] = resample(pl, LINE_STEP);
      const s = lr();
      pts.forEach((p, k) => push(p, 2, t0 + dur * fr[k], s));
      const st = pts[0];
      const near = breaks.filter((b) => Math.hypot(b[0] - st[0], b[1] - st[1], b[2] - st[2]) < 0.5).slice(0, 40);
      for (const b of near.length >= 6 ? near : [st]) push(b, 7, t0, s);
    });
  }
  // 证据：废墟轮廓，0.03~0.4 从地面描到断口
  {
    const segs = featureEdges(Wl.tris);
    let z0 = Infinity, z1 = -Infinity;
    segs.forEach(([a, b]) => { z0 = Math.min(z0, a[2], b[2]); z1 = Math.max(z1, a[2], b[2]); });
    segs.forEach(([a, b]) => {
      const pl = a[2] <= b[2] ? [a, b] : [b, a];
      const [pts] = resample(pl, LINE_STEP);
      pts.forEach((p) => push(p, 4, RHYTHM.ruinLine[0] + (RHYTHM.ruinLine[1] - RHYTHM.ruinLine[0]) * (p[2] - z0) / Math.max(z1 - z0, 1e-6), lr()));
    });
  }

  // 余烬：断口每点周围撒 4 颗
  const ep = [], eph = [];
  const er = rng(3);
  for (const b of breaks) for (let k = 0; k < 4; k++) {
    ep.push(b[0] + (er() - 0.5) * 0.06, b[1] + (er() - 0.5) * 0.06, b[2] + (er() - 0.5) * 0.06);
    eph.push(er());
  }

  // 废墟网格：每个顶点离断口的焦黑程度
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(Wl.tris, 3));
  wallGeo.computeVertexNormals();
  uvMeters(wallGeo);
  const charA = breaks.length ? nearestAll(Wl.tris, brkFlat, 1500).map((d) => Math.exp(-d / 0.9)) : new Float32Array(Wl.tris.length / 3);
  wallGeo.setAttribute('aChar', new THREE.BufferAttribute(charA, 1));

  // 深度预渲染：修复后的房子（不含门窗格子），只写深度，挡住落定后看不见的粒子和点线
  const keep = [];
  T.names.forEach((n, i) => { if (!/^(window_|door_|lattice_)/.test(n)) keep.push(i); });
  const occ = new Float32Array(keep.length * 9);
  keep.forEach((i, j) => occ.set(T.tris.subarray(i * 9, i * 9 + 9), j * 9));

  return {
    name, label: grammar.name || name, estimated: !!grammar.estimated,
    cloud: { pos, data, rnd }, lines: { pos: new Float32Array(lp), attr: new Float32Array(la) },
    embers: { pos: new Float32Array(ep), phase: new Float32Array(eph) }, wallGeo, occ,
    growthStats, area: (() => { let a = 0; const t = T.tris; for (let i = 0; i < t.length; i += 9) { const ux = t[i + 3] - t[i], uy = t[i + 4] - t[i + 1], uz = t[i + 5] - t[i + 2], vx = t[i + 6] - t[i], vy = t[i + 7] - t[i + 1], vz = t[i + 8] - t[i + 2]; a += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); } return a; })(),
    breaks, wallTris: Wl.tris, hasSource: edgesRows.length > 0 && 'source' in edgesRows[0],
    info: { row: wx, depth: wy, eave: Math.max(wz + 0.4, zmax - 2.3), ridge: zmax, zmin, zmax, top: zmax }, cam,
  };
}

// ---------------------------------------------------------------- 组装


export function makeSet(d, U) {
  const grp = new THREE.Group();
  const ruin = new THREE.Mesh(d.wallGeo, ruinMaterial(U));
  ruin.castShadow = ruin.receiveShadow = true;
  grp.add(ruin);

  const cloudGeo = new THREE.BufferGeometry();
  cloudGeo.setAttribute('position', new THREE.BufferAttribute(d.cloud.pos, 3));
  cloudGeo.setAttribute('aData', new THREE.BufferAttribute(d.cloud.data, 4));
  cloudGeo.setAttribute('aRand', new THREE.BufferAttribute(d.cloud.rnd, 4));
  // 风向和 TD 一样相对 street 机位：0 往画面右边吹
  const fx = d.cam.target[0] - d.cam.camera[0], fy = d.cam.target[1] - d.cam.camera[1];
  const windA = Math.atan2(-fx, fy) + THREE.MathUtils.degToRad(lk('particles.wind_dir_deg', 15));
  const cu = (pass) => ({
    ...U, uPass: { value: pass }, uSpan: { value: RHYTHM.span }, uNoise: { value: lk('particles.noise', 0.3) },
    uSpread: { value: lk('particles.spread_m', 1.5) }, uTopZ: { value: d.info.top },
    uFallH: { value: lk('particles.fall_height_ratio', 0.5) * (d.info.zmax - d.info.zmin) },
    uG0: { value: RHYTHM.fallStart }, uG1: { value: RHYTHM.fallEnd }, uHold: { value: RHYTHM.hold },
    uDiss: { value: lk('particles.dissipate', 0.6) }, uWindA: { value: windA },
    uWindDist: { value: lk('particles.wind_dist_m', 1.5) }, uSize: { value: lk('web.particle_size_m', 0.022) },
    uBright: { value: lk('particles.brightness', 0.55) }, uFront: { value: lk('particles.front_glow', 1.8) },
    uColor: { value: col('colors.particle', [1.0, 0.93, 0.82]) }, uEmber: { value: col('colors.ember', [0.75, 0.2, 0.05]) },
  });
  const air = new THREE.Points(cloudGeo, pointMaterial(CLOUD_VERT, cu(0)));
  const landed = new THREE.Points(cloudGeo, pointMaterial(CLOUD_VERT, cu(1)));
  air.renderOrder = 10; landed.renderOrder = 30;
  air.frustumCulled = landed.frustumCulled = false;

  const occGeo = new THREE.BufferGeometry();
  occGeo.setAttribute('position', new THREE.BufferAttribute(d.occ, 3));
  const occM = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
  const occ = new THREE.Mesh(occGeo, occM);
  occ.renderOrder = 20;

  const emGeo = new THREE.BufferGeometry();
  emGeo.setAttribute('position', new THREE.BufferAttribute(d.embers.pos, 3));
  emGeo.setAttribute('aPhase', new THREE.BufferAttribute(d.embers.phase, 1));
  const embers = new THREE.Points(emGeo, pointMaterial(EMBER_VERT, {
    ...U, uSize: { value: lk('web.ember_size_m', 0.025) },
    uBright: { value: lk('ember.brightness', 1.0) * lk('web.ember_gain', 0.7) },
    uEmber: { value: col('colors.ember', [0.75, 0.2, 0.05]) } }));
  embers.renderOrder = 11;

  const lnGeo = new THREE.BufferGeometry();
  lnGeo.setAttribute('position', new THREE.BufferAttribute(d.lines.pos, 3));
  lnGeo.setAttribute('aLine', new THREE.BufferAttribute(d.lines.attr, 3));
  const lines = new THREE.Points(lnGeo, pointMaterial(LINE_VERT, {
    ...U, uLS: { value: RHYTHM.lineStart }, uLE: { value: RHYTHM.lineEnd }, uSize: { value: lk('web.line_size_m', 0.022) },
    uBright: { value: lk('lines.brightness', 1.2) * lk('web.line_gain', 0.75) },
    uEvid: { value: col('colors.evidence', [0.92, 0.98, 1.0]) }, uInfer: { value: col('colors.inferred', [0.62, 0.74, 0.86]) },
    uImag: { value: col('colors.imagined', [0.45, 0.92, 1.0]) }, uEmber: { value: col('colors.ember', [0.75, 0.2, 0.05]) },
    uFrame: { value: lk('lines.frame_brightness', 0.5) }, uTw: { value: lk('lines.twinkle', 1.0) },
    uRuinB: { value: lk('lines.ruin_outline', true) ? lk('lines.ruin_outline_brightness', 0.6) : 0 },
    uShowG: { value: lk('lines.show_growth', true) ? 1 : 0 } }));
  lines.renderOrder = 31;
  embers.frustumCulled = lines.frustumCulled = false;

  grp.add(air, embers, occ, landed, lines);
  return { grp, cloudGeo, lnGeo, d };
}

// ---------------------------------------------------------------- 舞台：渲染器、场景、天空、灯、发光

export function makeUniforms() {
  // 所有点共用的 uniform；含义见文件头
  return {
    uTime: { value: 0 }, uP: { value: 0 }, uRuinP: { value: 0 }, uLineP: { value: 0 }, uConfAmt: { value: 0 }, uEmberOn: { value: 0 }, uScale: { value: 1 },
    uFog: { value: lk('web.fog', 0.028) }, uNear: { value: 0 }, uDissolve: { value: 0 }, uEmberGlow: { value: 0 },
    uGain: { value: new THREE.Vector4(1, 1, 1, 1) }, uCloudGain: { value: 1 }, uCharAmt: { value: 1 },
  };
}

export function makeStage() {
  const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1 : 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = lk('web.exposure', 1.0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070b14, lk('web.fog', 0.028));
  scene.background = new THREE.Color(0x03050a);
  const world = new THREE.Group();          // Rhino 坐标
  world.rotation.x = -Math.PI / 2;
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 600);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight),
    lk('web.bloom.strength', 0.5), lk('web.bloom.radius', 0.35), lk('web.bloom.threshold', 0.22));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GRADE);
  composer.addPass(grade);
  const G = lk('web.grade', {});
  grade.uniforms.uGrain.value = G.grain ?? 0.045;
  grade.uniforms.uVignette.value = G.vignette ?? 0.55;
  grade.uniforms.uSplit.value = G.split ?? 1.0;

  // 夜晚 HDRI：只做环境光和反射，背景仍是下面的夜空球
  const pmrem = new THREE.PMREMGenerator(renderer);
  new RGBELoader().load(new URL('./assets/hdri/hansaplatz_1k.hdr', import.meta.url).href, (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose(); pmrem.dispose();
  }, undefined, (e) => console.warn('HDRI 没加载上', e));

  // 画质分档：低档降分辨率、关发光
  const PR0 = renderer.getPixelRatio();
  quality.on((lv) => {
    renderer.setPixelRatio(lv >= 2 ? PR0 : Math.min(PR0, 1));
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloom.enabled = lv >= 1 || !isMobile;
  });

  // 天空：深蓝黑渐变的大球
  {
    const g = new THREE.SphereGeometry(400, 32, 16);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y;
        vec3 c = mix(vec3(0.045,0.06,0.10), vec3(0.008,0.012,0.028), smoothstep(-0.02, 0.45, h));
        gl_FragColor = vec4(c, 1.0); }`,
    });
    scene.add(new THREE.Mesh(g, m));
  }
  scene.add(new THREE.HemisphereLight(0x3a4c78, 0x0c0907, 0.35));
  const moon = new THREE.DirectionalLight(0x8fa6d8, 0.25);
  moon.position.set(-30, 60, 20);
  scene.add(moon);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });
  return { renderer, scene, world, camera, composer, bloom, grade };
}

// 后期：胶片颗粒、暗角、冷青的暗部和偏橙的亮部（在 OutputPass 之后，显示空间里调）
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.045 }, uVignette: { value: 0.55 }, uSplit: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVignette, uSplit; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      float warm = clamp((c.r - c.b) * 2.0, 0.0, 1.0);
      vec3 shadowTint = vec3(0.86, 1.0, 1.06), hiTint = vec3(1.07, 0.98, 0.88);
      vec3 tint = mix(shadowTint, hiTint, smoothstep(0.1, 0.55, l) * (0.4 + 0.6 * warm));
      c = mix(c, c * tint + vec3(0.0, 0.006, 0.012) * (1.0 - l), uSplit);
      vec2 q = vUv - 0.5;
      c *= mix(1.0, smoothstep(0.85, 0.2, length(q * vec2(1.0, 0.8)) ), uVignette);
      c += (hash(vUv * vec2(1931.0, 1173.0) + fract(uTime * 7.13)) - 0.5) * uGrain * (0.6 + 0.4 * (1.0 - l));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export const td = (p) => new THREE.Vector3(p[0], p[2], -p[1]);   // Rhino → Three
export function lerp3(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
export function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
