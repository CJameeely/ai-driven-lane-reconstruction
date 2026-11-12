// 灾后重建 · 弄堂：PBR 材质、夜晚的灯、湿地面和积水反光、程序化的生活细节、画质分档
// lib.js 引用并转出，影片页和叙事页共用。素材在 assets/（全部 CC0，来源见 assets/CREDITS.md）。
//
// 坐标是 Rhino 的（米，Z 向上），整组放在 lib.js 的 world 里。弄堂沿 x，废墟这一排正面朝 -y（y=0），
// 对面一排正面朝 +y（y=-LANE_W）。每户按石库门的格局：临弄堂是天井围墙和石门框，退进 2.4m 是前楼立面，
// 上面坡屋顶；窗、门、晾衣、空调、盆栽这些按种子随机分布。烧毁的那栋周围不放生活细节，只有焦黑和灰。
//
// 画质三档（quality.level）：2 高（积水实时反射、三盏灯带阴影、全部细节）、1 中（反射降到四分之一分辨率、
// 一盏灯带阴影）、0 低（没有实时反射和阴影，细节减半）。页面按帧率自动往下降。

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE, PUDDLE } from './glsl.js';

export const LANE_W = 8;                        // 弄堂宽（米）
const ASSETS = new URL('./assets/', import.meta.url).href;

export const quality = {
  level: 2, fns: [],
  set(l) { l = Math.max(0, Math.min(2, l)); if (l === this.level) return; this.level = l; this.fns.forEach((f) => f(l)); },
  on(f) { this.fns.push(f); f(this.level); },
};

function rng(seed) {                     // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- 材质

// 贴图一张覆盖的实际尺寸（米），来自 Poly Haven 的 dimensions
const TEX_SIZE = {
  red_brick: 1.4, brick_wall_10: 1.9, concrete_wall_008: 2.71, black_painted_planks: 1.6,
  wood_peeling_paint_weathered: 0.76, grey_plaster: 1.0, grey_roof_tiles: 3.0, concrete_pavement: 1.8,
};
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function tex(name, suf, srgb, size) {
  const key = name + suf + size;
  if (texCache.has(key)) return texCache.get(key);
  const t = texLoader.load(`${ASSETS}tex/${name}/${name}_${suf}_1k.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size, 1 / size);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, t);
  return t;
}

export function uvMeters(g) {
  // 世界坐标的 UV（米）：每个三角形按法向投到最接近的坐标面，贴图的 repeat 再按实际尺寸缩放
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position.array, n = p.length / 3, uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const o = t * 3;
    const ux = p[o + 3] - p[o], uy = p[o + 4] - p[o + 1], uz = p[o + 5] - p[o + 2];
    const vx = p[o + 6] - p[o], vy = p[o + 7] - p[o + 1], vz = p[o + 8] - p[o + 2];
    const nx = Math.abs(uy * vz - uz * vy), ny = Math.abs(uz * vx - ux * vz), nz = Math.abs(ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) {
      const x = p[o + k * 3], y = p[o + k * 3 + 1], z = p[o + k * 3 + 2];
      const [a, b] = nz >= nx && nz >= ny ? [x, y] : nx >= ny ? [y, z] : [x, z];
      uv[(t + k) * 2] = a; uv[(t + k) * 2 + 1] = b;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function weathering(m, k) {
  // 雨水流痕和墙根返潮：竖向拉长的噪声，越往下越暗
  m.customProgramCacheKey = () => 'weather';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWeather = { value: k };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP;\nuniform float uWeather;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float st = smoothstep(0.15, 0.85, snoise(vec3((vRP.x + vRP.y) * 2.3, vRP.z * 0.12, 3.0)));
        float grime = 0.5 + 0.5 * snoise(vRP * 0.35);
        float foot = 1.0 - smoothstep(0.0, 0.8, vRP.z);
        diffuseColor.rgb *= 1.0 - uWeather * (0.55 * st * grime + 0.45 * foot);`);
  };
}

export function pbr(name, { tint = 0xffffff, rough = 1, weather = 0.3, env = 0.15, side = THREE.FrontSide } = {}) {
  const s = TEX_SIZE[name] || 2;
  const m = new THREE.MeshStandardMaterial({
    map: tex(name, 'diff', true, s), normalMap: tex(name, 'nor_gl', false, s), roughnessMap: tex(name, 'arm', false, s),
    color: tint, roughness: rough, metalness: 0, envMapIntensity: env, side,
  });
  if (weather > 0) weathering(m, weather);
  return m;
}

export function ruinMaterial(U) {
  // 废墟：同一种清水红砖，按 uCharAmt 烧黑，断口附近更黑，余烬时断口发暗红光
  const m = pbr('red_brick', { weather: 0, env: 0.25 });
  m.customProgramCacheKey = () => 'ruin';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uEmberGlow = U.uEmberGlow;
    sh.uniforms.uCharAmt = U.uCharAmt;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP;\nattribute float aChar;\nvarying float vChar;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = position;\nvChar = aChar;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRP;\nvarying float vChar;\nuniform float uEmberGlow;\nuniform float uCharAmt;\n' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float crack = smoothstep(0.035, 0.0, abs(snoise(vRP * vec3(0.7, 0.7, 1.6))));
        float soot = mix(0.55, 0.06, vChar) * (1.0 - 0.7 * crack) * (0.7 + 0.5 * snoise(vRP * 0.4));
        float st = smoothstep(0.1, 0.8, snoise(vec3((vRP.x + vRP.y) * 2.3, vRP.z * 0.12, 3.0)));
        diffuseColor.rgb *= mix(1.0 - 0.25 * st, soot, uCharAmt);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, uCharAmt);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.9, 0.22, 0.05) * pow(vChar, 14.0) * uEmberGlow * max(0.0, snoise(vRP * 3.0));`);
  };
  return m;
}

// 亮着的窗：窗帘（随机颜色、褶皱、中间拉开一条缝）和偶尔走过的人影；aWin = (种子, 是否有人影)
const litUniforms = { uTime: { value: 0 } };
function litWindowMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 1, roughness: 0.2 });
  m.customProgramCacheKey = () => 'litwin';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = litUniforms.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aWin;\nvarying vec2 vWin;\nvarying vec2 vWUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin;\nvWUv = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWin;\nvarying vec2 vWUv;\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float s = vWin.x;
        vec2 q = vWUv;
        vec3 room = vec3(1.0, 0.62, 0.30) * (0.9 + 0.3 * q.y);
        vec3 cloth = mix(vec3(0.95, 0.78, 0.55), mix(vec3(0.75, 0.32, 0.22), vec3(0.45, 0.62, 0.42), step(0.5, fract(s * 7.0))), step(0.45, s));
        float fold = 0.75 + 0.25 * sin(q.x * (40.0 + 30.0 * s) + s * 20.0);
        float gap0 = 0.3 + 0.25 * fract(s * 3.1), gap1 = gap0 + 0.08 + 0.3 * fract(s * 5.7);
        float open = step(gap0, q.x) * step(q.x, gap1);
        vec3 col = mix(cloth * room * fold * 0.5, room * 0.8, open);
        // 人影：横着走过，头和身子两块暗斑，每隔一阵出现一次
        if (vWin.y > 0.5) {
          float per = 9.0 + 8.0 * s, ph = fract(uTime / per + s * 5.0);
          float x = mix(-0.4, 1.4, ph / 0.5);
          float on = step(ph, 0.5);
          float body = smoothstep(0.18, 0.12, length((q - vec2(x, 0.25)) * vec2(1.3, 0.6)));
          float head = smoothstep(0.1, 0.07, length(q - vec2(x, 0.68)));
          col *= 1.0 - 0.8 * on * max(body, head);
        }
        totalEmissiveRadiance = col * (0.55 + 0.3 * fract(s * 13.0));`);
  };
  return m;
}

// ---------------------------------------------------------------- 模型

const gltf = new GLTFLoader();
const modelCache = new Map();
function loadModel(name) {
  if (!modelCache.has(name)) {
    modelCache.set(name, gltf.loadAsync(`${ASSETS}models/${name}/${name}_1k.gltf`).then((g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 0.4; } });
      return g.scene;
    }).catch((e) => { console.warn('[lane] 模型没加载上：' + name, e); return null; }));
  }
  return modelCache.get(name);
}
function placeModel(parent, name, pos, yaw = 0, scale = 1) {
  // glTF 是 Y 向上：先绕 X 转 90° 到 Rhino 的 Z 向上，模型正面就朝 -y；yaw 绕 Z 转
  const holder = new THREE.Group();
  holder.position.set(...pos);
  holder.rotation.z = yaw;
  parent.add(holder);
  loadModel(name).then((s) => {
    if (!s) return;
    const c = s.clone(true);
    c.rotation.x = Math.PI / 2;
    c.scale.setScalar(scale);
    holder.add(c);
  });
  return holder;
}

// ---------------------------------------------------------------- 弄堂

function box(x0, x1, y0, y1, z0, z1) {
  const g = new THREE.BoxGeometry(Math.max(Math.abs(x1 - x0), 1e-3), Math.max(Math.abs(y1 - y0), 1e-3), Math.max(Math.abs(z1 - z0), 1e-3));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

function gable(x0, x1, y0, y1, z0, z1, over = 0.3, th = 0.12) {
  // 人字屋面，屋脊沿 x；截面画在 yz，沿 x 拉伸
  const s = new THREE.Shape();
  s.moveTo(y0 - over, z0); s.lineTo((y0 + y1) / 2, z1); s.lineTo(y1 + over, z0); s.lineTo(y1 + over, z0 - th);
  s.lineTo((y0 + y1) / 2, z1 - th); s.lineTo(y0 - over, z0 - th); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false });
  g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, x0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
  return g;
}

function mergeList(list, extra = []) {
  // 合并前统一成非索引、只留 position/normal/uv（加上 extra 里的自定义属性）
  const keep = new Set(['position', 'normal', 'uv', ...extra]);
  const gs = list.map((g) => {
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.uv) uvMeters(g);
    for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(gs);
}

function plateTexture(num) {
  // 门牌：蓝底白字，只有编号
  const c = document.createElement('canvas'); c.width = 128; c.height = 80;
  const x = c.getContext('2d');
  x.fillStyle = '#1d3f7a'; x.fillRect(0, 0, 128, 80);
  x.strokeStyle = '#e8eef5'; x.lineWidth = 4; x.strokeRect(6, 6, 116, 68);
  x.fillStyle = '#f2f5f8'; x.font = 'bold 44px Helvetica, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(String(num), 64, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const haloTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,200,130,0.6)'); gr.addColorStop(0.2, 'rgba(255,165,95,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

export function buildLane(info, opts = {}) {
  const seed = opts.seed ?? 7;
  const r = rng(seed);
  const lane = new THREE.Group();
  const fine = new THREE.Group();            // 低档时减半的细节
  lane.add(fine);
  const { row, depth, eave, ridge } = info;
  const unit = row / Math.max(1, Math.round(row / 3.6));
  const ruinMin = [-0.6, -1.2], ruinMax = [row + unit * 0.9, depth + 0.5];
  const nearRuin = (x0, x1, fc) => fc > 0 && x1 > -1.5 && x0 < row + unit + 1.5;

  const G = { red: [], grey: [], stone: [], door: [], wood: [], plaster: [], roof: [], glass: [], lit: [], iron: [], pipe: [], ridge: [], brass: [], mail: [] };
  const plates = [];
  let num = 6 + Math.floor(r() * 30) * 2;

  const house = (x0, w, yFront, fc) => {
    const inn = fc > 0 ? 1 : -1;             // 从正面往进深的方向（y）
    const Y = (d) => yFront + inn * d;
    const B = (xa, xb, d0, d1, z0, z1) => box(xa, xb, Math.min(Y(d0), Y(d1)), Math.max(Y(d0), Y(d1)), z0, z1);
    const h = eave + (r() - 0.5) * 0.5, top = ridge + (h - eave);
    const hc = 3.4 + r() * 0.6;              // 天井围墙高
    const cx = x0 + w / 2, dw = 1.45, dh = 2.7;
    const greyBody = r() < 0.6;
    const wallList = greyBody ? G.grey : G.red, bandList = greyBody ? G.red : G.grey;
    const tidy = !nearRuin(x0, x0 + w, fc);

    // 天井围墙，门洞两侧和门洞上方
    wallList.push(B(x0, cx - dw / 2, 0, 0.24, 0, hc), B(cx + dw / 2, x0 + w, 0, 0.24, 0, hc), B(cx - dw / 2, cx + dw / 2, 0, 0.24, dh, hc));
    // 两户之间天井的隔墙
    wallList.push(B(x0 - 0.12, x0 + 0.12, 0.24, 2.4, 0, hc - 0.3));
    // 腰线和墙脚抹灰（门两侧）
    for (const z of [1.0, 2.0, 3.0]) if (z < hc - 0.3) bandList.push(B(x0, cx - dw / 2 - 0.3, -0.012, 0, z, z + 0.12), B(cx + dw / 2 + 0.3, x0 + w, -0.012, 0, z, z + 0.12));
    G.plaster.push(B(x0, cx - dw / 2 - 0.3, -0.02, 0, 0, 0.45), B(cx + dw / 2 + 0.3, x0 + w, -0.02, 0, 0, 0.45));
    // 石门框：两侧门柱、门楣、三角或弧形门头，墙顶压顶
    G.stone.push(B(cx - dw / 2 - 0.3, cx - dw / 2, -0.12, 0.02, 0, dh + 0.1), B(cx + dw / 2, cx + dw / 2 + 0.3, -0.12, 0.02, 0, dh + 0.1));
    G.stone.push(B(cx - dw / 2 - 0.42, cx + dw / 2 + 0.42, -0.16, 0.02, dh, dh + 0.32));
    G.stone.push(B(x0, x0 + w, -0.06, 0.3, hc, hc + 0.1));
    {
      const s = new THREE.Shape();
      const hw = dw / 2 + 0.3;
      if (r() < 0.5) { s.moveTo(-hw, 0); s.lineTo(0, 0.42); s.lineTo(hw, 0); s.closePath(); }
      else { const R = (hw * hw + 0.35 * 0.35) / 0.7; s.moveTo(-hw, 0); s.absarc(0, 0.35 - R, R, Math.PI / 2 + Math.asin(hw / R), Math.PI / 2 - Math.asin(hw / R), true); s.closePath(); }
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: false, curveSegments: 10 });
      g.rotateX(Math.PI / 2);             // 截面在 xz，沿 -y 拉伸
      g.translate(cx, Math.max(Y(-0.14), Y(0)) , dh + 0.32);
      G.stone.push(g);
    }
    // 黑漆木门两扇，退进门洞；铜门环
    G.door.push(B(cx - dw / 2, cx - 0.008, 0.12, 0.17, 0, dh), B(cx + 0.008, cx + dw / 2, 0.12, 0.17, 0, dh));
    for (const sx of [-1, 1]) {
      const t = new THREE.TorusGeometry(0.055, 0.009, 6, 16);
      t.rotateX(Math.PI / 2);
      t.translate(cx + sx * 0.16, Y(0.11), 1.25);
      G.brass.push(t);
    }
    // 门牌（只有编号）和信箱
    plates.push({ pos: [cx + dw / 2 + 0.55, Y(-0.012), 2.25], num, out: -inn });
    num += 2;
    if (tidy && r() < 0.55) G.mail.push(B(cx - dw / 2 - 0.85, cx - dw / 2 - 0.5, -0.12, 0, 1.15, 1.55));

    // 前楼：退进 2.4m，墙到檐口；坡屋顶；可能有晒台或老虎窗
    const bodyList = r() < 0.5 ? G.red : G.grey;
    bodyList.push(B(x0, x0 + w, 2.4, depth, 0, h));
    const terrace = r() < 0.22;
    if (terrace) {
      G.roof.push(gable(x0 - 0.04, x0 + w + 0.04, Math.min(Y(4.4), Y(depth)), Math.max(Y(4.4), Y(depth)), h, top - 0.6));
      G.plaster.push(B(x0, x0 + w, 2.4, 4.4, h, h + 0.08));
      // 晒台铁栏杆：前沿和两侧，立杆 12cm 一根
      const zr = h + 0.08;
      G.iron.push(B(x0 + 0.05, x0 + w - 0.05, 2.42, 2.46, zr + 0.95, zr + 1.0));
      for (let x = x0 + 0.08; x < x0 + w - 0.05; x += 0.12) G.iron.push(B(x, x + 0.018, 2.42, 2.44, zr, zr + 0.95));
      for (const xs of [x0 + 0.06, x0 + w - 0.08]) {
        G.iron.push(B(xs, xs + 0.03, 2.42, 4.4, zr + 0.95, zr + 1.0));
        for (let d = 2.5; d < 4.4; d += 0.12) G.iron.push(B(xs, xs + 0.018, d, d + 0.018, zr, zr + 0.95));
      }
    } else {
      G.roof.push(gable(x0 - 0.04, x0 + w + 0.04, Math.min(Y(2.4), Y(depth)), Math.max(Y(2.4), Y(depth)), h, top));
    }
    G.ridge.push(box(x0 - 0.04, x0 + w + 0.04, Y((terrace ? 4.4 + depth : 2.4 + depth) / 2) - 0.09, Y((terrace ? 4.4 + depth : 2.4 + depth) / 2) + 0.09, (terrace ? top - 0.6 : top) - 0.05, (terrace ? top - 0.6 : top) + 0.12));
    if (!terrace && r() < 0.4) {
      // 老虎窗：前坡上凸出的小屋，正面一扇窗
      const run = (depth - 2.4) / 2, slope = (top - h) / run;
      const d0 = 2.4 + 0.7, zb = h + slope * 0.7;
      G.plaster.push(B(cx - 0.65, cx + 0.65, d0, d0 + 1.3, zb - 0.2, zb + 1.1));
      G.roof.push((() => {
        const g = new THREE.ExtrudeGeometry((() => { const s = new THREE.Shape(); s.moveTo(-0.78, 0); s.lineTo(0, 0.45); s.lineTo(0.78, 0); s.closePath(); return s; })(), { depth: 1.5, bevelEnabled: false });
        g.rotateX(Math.PI / 2);
        g.translate(cx, Math.max(Y(d0 - 0.1), Y(d0 + 1.4)), zb + 1.1);
        return g;
      })());
      addWindow(cx, d0, zb + 0.1, 0.8, 0.75, 0.04);
    }

    // 前楼窗：二层两扇，有的三层再一扇；窗框、窗台、玻璃或亮灯
    function addWindow(wx, d, z0, ww, wh, sill = 0.1) {
      const lit = r() < 0.38;
      const pane = B(wx - ww / 2, wx + ww / 2, d - 0.012, d - 0.004, z0, z0 + wh);
      if (lit) {
        const n = pane.attributes.position.count;
        const s = r(), ghost = r() < 0.3 ? 1 : 0;
        pane.setAttribute('aWin', new THREE.BufferAttribute(new Float32Array(n * 2).map((_, i) => (i % 2 ? ghost : s)), 2));
        G.lit.push(pane);
      } else G.glass.push(pane);
      const f = 0.06;
      G.wood.push(B(wx - ww / 2 - f, wx + ww / 2 + f, d - 0.07, d, z0 + wh, z0 + wh + f), B(wx - ww / 2 - f, wx + ww / 2 + f, d - 0.07, d, z0 - f, z0),
        B(wx - ww / 2 - f, wx - ww / 2, d - 0.07, d, z0, z0 + wh), B(wx + ww / 2, wx + ww / 2 + f, d - 0.07, d, z0, z0 + wh),
        B(wx - 0.02, wx + 0.02, d - 0.05, d, z0, z0 + wh), B(wx - ww / 2, wx + ww / 2, d - 0.05, d, z0 + wh * 0.62, z0 + wh * 0.62 + 0.035));
      if (sill) G.stone.push(B(wx - ww / 2 - 0.12, wx + ww / 2 + 0.12, d - sill - 0.04, d, z0 - f - 0.07, z0 - f));
      return lit;
    }
    const winZ = Math.max(hc + 0.5, 3.9);
    for (const sx of [-1, 1]) addWindow(cx + sx * w * 0.24, 2.4, winZ, 0.95, 1.4);
    if (h > winZ + 2.6) addWindow(cx, 2.4, winZ + 1.9, 0.8, 0.9);

    // 雨水管：前楼檐口到围墙顶，再沿围墙到地面
    const px = x0 + 0.1;
    G.pipe.push(cyl(px, Y(2.4 - 0.06), hc, h, 0.032), cyl(px, Y(-0.06), 0, hc + 0.1, 0.035));
    G.pipe.push(B(px - 0.1, px + 0.1, 2.4 - 0.2, 2.4, h - 0.25, h));
    // 檐沟
    G.pipe.push(B(x0, x0 + w, 2.4 - 0.16, 2.4, h - 0.08, h + 0.02));

    // 空调外机、电表箱
    const yaw = inn > 0 ? 0 : Math.PI;
    if (tidy && r() < 0.45) placeModel(lane, 'exterior_aircon_unit', [x0 + w - 0.62, Y(-0.3), 2.25 + r() * 0.5], yaw, 0.85);
    if (tidy && r() < 0.3) placeModel(lane, 'power_box_01', [x0 + 0.55, Y(-0.08), 1.55], yaw);

    // 墙根：盆栽、木凳、自行车、煤球炉
    if (tidy) {
      const yo = Y(-0.32);
      const spots = [x0 + 0.35, x0 + 0.75, cx + dw / 2 + 0.4, x0 + w - 0.4].filter(() => r() < 0.45);
      spots.forEach((x) => placeModel(fine, r() < 0.5 ? 'potted_plant_02' : 'potted_plant_04', [x, yo, 0], r() * 6.28, 0.7 + r() * 0.4));
      if (r() < 0.12) placeModel(fine, 'chinese_stool', [x0 + w - 0.7, Y(-0.5), 0], r() * 6.28);
      if (r() < 0.14) bicycle(fine, cx + dw / 2 + 0.95, Y(-0.25), inn);
      if (r() < 0.15) stove(fine, x0 + 0.5, Y(-0.35), r() < 0.4);
    }
  };

  function cyl(x, y, z0, z1, rad) {
    const g = new THREE.CylinderGeometry(rad, rad, z1 - z0, 8);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, (z0 + z1) / 2);
    return g;
  }

  // 程序化的小东西：自行车、煤球炉
  const metalM = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.7, envMapIntensity: 0.6 });
  function bicycle(parent, x, y, inn) {
    // 侧面靠墙：车身沿 x，两只轮子、三角车架、车把、座
    const parts = [];
    const tube = (a, b, rad = 0.016) => {
      const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const g = new THREE.CylinderGeometry(rad, rad, v.length(), 6);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize()));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      parts.push(g);
    };
    for (const wx of [-0.52, 0.52]) {
      const t = new THREE.TorusGeometry(0.33, 0.018, 6, 28); t.rotateX(Math.PI / 2); t.translate(wx, 0, 0.35); parts.push(t);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 8; tube([wx - Math.cos(a) * 0.32, 0, 0.35 - Math.sin(a) * 0.32], [wx + Math.cos(a) * 0.32, 0, 0.35 + Math.sin(a) * 0.32], 0.003); }
    }
    tube([-0.52, 0, 0.35], [-0.08, 0, 0.36]); tube([-0.08, 0, 0.36], [-0.15, 0, 0.82]); tube([-0.52, 0, 0.35], [-0.15, 0, 0.82]);
    tube([-0.15, 0, 0.82], [0.38, 0, 0.84]); tube([-0.08, 0, 0.36], [0.38, 0, 0.84]); tube([0.38, 0, 0.84], [0.52, 0, 0.35]);
    tube([0.38, 0, 0.84], [0.34, 0, 1.0]); tube([0.34, -0.25, 1.0], [0.34, 0.25, 1.0], 0.012);
    tube([-0.15, 0, 0.82], [-0.17, 0, 0.92], 0.012); { const s = box(-0.27, -0.07, -0.06, 0.06, 0.92, 0.97); parts.push(s); }
    const m = new THREE.Mesh(mergeList(parts), metalM);
    m.position.set(x, y, 0); m.rotation.x = -inn * 0.14; m.castShadow = true;
    parent.add(m);
  }
  const stoveM = new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.85, envMapIntensity: 0.3 });
  function stove(parent, x, y, lit) {
    const g = new THREE.CylinderGeometry(0.15, 0.16, 0.36, 14); g.rotateX(Math.PI / 2); g.translate(0, 0, 0.18);
    const m = new THREE.Mesh(g, stoveM); m.position.set(x, y, 0); m.castShadow = true; parent.add(m);
    const t = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, emissive: lit ? 0xff5a1a : 0x000000, emissiveIntensity: lit ? 0.9 : 0 }));
    t.position.set(x, y, 0.362); parent.add(t);
  }

  // 摆房子：左边紧贴废墟，右边隔一块空地（露出废墟的右山墙），对面隔弄堂一排
  const xs = [];
  for (let k = 1; k <= 5; k++) xs.push([-unit * k, unit, 0, 1]);
  for (let x = row + unit; x < row + unit * 10; x += unit) xs.push([x, unit, 0, 1]);
  for (let x = -unit * 5; x < row + unit * 10; x += unit) xs.push([x, unit, -LANE_W, -1]);
  xs.forEach(([x, w, yf, fc]) => house(x, w, yf, fc));

  // 远景：两排房子后面各再一排，只有墙身、坡屋顶和零星亮着的后窗（亭子间、灶披间），高处看过去不空
  const backRow = (y0, y1, face) => {
    for (let x = -unit * 8; x < row + unit * 14; x += unit) {
      const h = eave - 0.6 + (r() - 0.5) * 0.8, t = ridge - 0.6 + (h - eave);
      (r() < 0.5 ? G.red : G.grey).push(box(x, x + unit, y0, y1, 0, h));
      G.roof.push(gable(x - 0.04, x + unit + 0.04, y0, y1, h, t));
      G.ridge.push(box(x - 0.04, x + unit + 0.04, (y0 + y1) / 2 - 0.09, (y0 + y1) / 2 + 0.09, t - 0.05, t + 0.12));
      for (const wx of [x + unit * 0.3, x + unit * 0.7]) {
        if (r() > 0.3) continue;
        const pane = box(wx - 0.35, wx + 0.35, face - 0.01, face + 0.01, h - 2.2, h - 1.2);
        const n = pane.attributes.position.count, sd = r();
        pane.setAttribute('aWin', new THREE.BufferAttribute(new Float32Array(n * 2).map((_, i) => (i % 2 ? 0 : sd)), 2));
        G.lit.push(pane);
      }
    }
  };
  backRow(depth + 2.5, depth + 2.5 + 11, depth + 2.49);
  backRow(-LANE_W - depth - 2.5 - 11, -LANE_W - depth - 2.5, -LANE_W - depth - 2.49);

  const M = {
    red: pbr('red_brick'), grey: pbr('brick_wall_10', { tint: 0xb4bcc4 }), stone: pbr('concrete_wall_008', { tint: 0x8f897e, weather: 0.45 }),
    door: pbr('black_painted_planks', { tint: 0x8a8a8a, weather: 0.1, env: 0.5 }), wood: pbr('wood_peeling_paint_weathered', { weather: 0 }),
    plaster: pbr('grey_plaster', { tint: 0xb9b6ae, weather: 0.45 }), roof: pbr('grey_roof_tiles', { tint: 0x9a9a9a, weather: 0, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.18, metalness: 0.0, envMapIntensity: 0.3 }),
    lit: litWindowMaterial(),
    iron: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.6, envMapIntensity: 0.5 }),
    pipe: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.5, envMapIntensity: 0.5 }),
    ridge: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.8 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 1, envMapIntensity: 1 }),
    mail: new THREE.MeshStandardMaterial({ color: 0x173823, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.2 }),
  };
  for (const [k, list] of Object.entries(G)) {
    if (!list.length) continue;
    const mesh = new THREE.Mesh(mergeList(list, k === 'lit' ? ['aWin'] : []), M[k]);
    mesh.castShadow = k !== 'lit' && k !== 'glass';
    mesh.receiveShadow = true;
    (k === 'iron' || k === 'brass' || k === 'mail' ? fine : lane).add(mesh);
  }
  for (const p of plates) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.125), new THREE.MeshStandardMaterial({ map: plateTexture(p.num), roughness: 0.3, envMapIntensity: 0.6 }));
    m.position.set(...p.pos);
    m.rotation.x = p.out < 0 ? Math.PI / 2 : -Math.PI / 2;
    if (p.out > 0) m.rotation.z = Math.PI;
    fine.add(m);
  }

  // 空地上的碎砖（废墟旁边，只有焦黑的碎砖）
  {
    const g = [];
    const rr = rng(5);
    for (let i = 0; i < 90; i++) {
      const x = row + 0.3 + rr() * (unit - 0.6), y = -0.4 + rr() * (depth - 0.5), s = 0.12 + rr() * 0.35;
      const b = new THREE.BoxGeometry(s, s * (0.5 + rr() * 0.6), s * 0.45);
      b.rotateZ(rr() * 3); b.rotateX(rr() * 0.6);
      b.translate(x, y, s * 0.18);
      g.push(b);
    }
    const m = new THREE.Mesh(mergeList(g), pbr('red_brick', { tint: 0x2a1a16, weather: 0 }));
    m.castShadow = m.receiveShadow = true;
    lane.add(m);
  }

  // 地面：水泥石板，雨后整体微湿，一块块积水更暗更光滑；废墟周围是灰
  const groundU = { uRuinMin: { value: new THREE.Vector2(...ruinMin) }, uRuinMax: { value: new THREE.Vector2(...ruinMax) } };
  {
    const g = new THREE.PlaneGeometry(260, 260, 1, 1);
    g.translate(row / 2, -LANE_W / 2, -0.012);
    uvMeters(g);
    const m = pbr('concrete_pavement', { tint: 0x6c7076, weather: 0, env: 0.12 });
    m.customProgramCacheKey = () => 'ground';
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, groundU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = position;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP;\n' + NOISE + PUDDLE)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          float ash = ashMask(vRP.xy);
          float pd = puddle(vRP.xy) * (1.0 - ash);
          float stain = smoothstep(0.2, 0.8, snoise(vec3(vRP.xy * 0.45, 2.0)));
          diffuseColor.rgb *= mix(0.62, 0.32, pd) * (1.0 - 0.25 * stain);
          roughnessFactor = mix(roughnessFactor * 0.55, 0.04, pd);
          vec3 ashCol = vec3(0.035, 0.032, 0.03) * (0.7 + 0.6 * snoise(vec3(vRP.xy * 3.0, 1.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, ashCol, ash * 0.9);
          roughnessFactor = mix(roughnessFactor, 0.95, ash);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          normal = normalize(mix(normal, nonPerturbedNormal, pd));`);
    };
    const ground = new THREE.Mesh(g, m);
    ground.receiveShadow = true;
    lane.add(ground);
  }

  // 积水的实时反射：只在积水遮罩里叠加，雨点让倒影轻轻抖
  let reflector = null;
  {
    const g = new THREE.PlaneGeometry(row + unit * 16, LANE_W + 0.6, 1, 1);
    g.translate(row / 2 + unit * 2, -LANE_W / 2, 0);
    const shader = {
      name: 'PuddleReflector',
      uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uTime: { value: 0 }, uStrength: { value: 0.75 }, ...THREE.UniformsUtils.clone(groundU) },
      vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vRP; varying vec3 vW;
        void main() { vUv = textureMatrix * vec4(position, 1.0); vRP = position; vW = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uStrength; varying vec4 vUv; varying vec3 vRP; varying vec3 vW;
        ${NOISE}${PUDDLE}
        void main() {
          float m = puddle(vRP.xy) * (1.0 - ashMask(vRP.xy));
          if (m < 0.01) discard;
          vec2 off = vec2(snoise(vec3(vRP.xy * 7.0, uTime * 1.6)), snoise(vec3(vRP.xy * 7.0 + 9.0, uTime * 1.6))) * 0.006;
          vec3 c = texture2DProj(tDiffuse, vUv + vec4(off * vUv.w, 0.0, 0.0)).rgb;
          vec3 v = normalize(cameraPosition - vW);
          float fres = 0.25 + 0.75 * pow(1.0 - abs(v.y), 4.0);
          gl_FragColor = vec4(c * m * fres * uStrength, 1.0);
        }`,
    };
    reflector = new Reflector(g, { clipBias: 0.003, textureWidth: 512, textureHeight: 512, shader });
    reflector.material.transparent = true;
    reflector.material.blending = THREE.AdditiveBlending;
    reflector.material.depthWrite = false;
    reflector.position.z = 0.004;
    reflector.renderOrder = 1;
    lane.add(reflector);
  }

  // 电线：横跨弄堂，也沿墙走
  {
    const wires = [];
    const rr = rng(17 + seed);
    for (let x = -14; x < row + 44; x += 4 + rr() * 6) {
      const z = 6.0 + rr() * 1.4, sag = 0.4 + rr() * 0.4, x2 = x + (rr() - 0.5) * 3;
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, 2.2, z), new THREE.Vector3((x + x2) / 2, -LANE_W / 2, z - sag * 2), new THREE.Vector3(x2, -LANE_W - 2.2, z));
      wires.push(new THREE.TubeGeometry(c, 24, 0.011, 4, false));
    }
    for (const [y, z] of [[2.35, 5.6], [2.3, 5.9], [-LANE_W - 2.35, 5.7], [-0.04, 3.55], [-LANE_W + 0.04, 3.6]]) {
      for (let x = -unit * 5; x < row + unit * 10; x += 5) {
        if (y > -1 && y < 3 && x > -2 && x < row + unit + 1) continue;   // 废墟正面不走线
        const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + 2.5, y, z - 0.25), new THREE.Vector3(x + 5, y, z));
        wires.push(new THREE.TubeGeometry(c, 12, 0.009, 4, false));
      }
    }
    lane.add(new THREE.Mesh(mergeList(wires), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.6 })));
  }

  // 晾衣竿和衣服：衣服下摆轻轻摆
  const clothU = { uTime: { value: 0 } };
  {
    const poles = [], clothes = [];
    const rr = rng(23 + seed);
    const palette = [[0.5, 0.49, 0.46], [0.12, 0.15, 0.24], [0.36, 0.1, 0.08], [0.5, 0.42, 0.3], [0.16, 0.24, 0.19], [0.58, 0.58, 0.56], [0.22, 0.2, 0.23]];
    for (let x = -14; x < row + 36; x += 4 + rr() * 6) {
      if (x > -2.5 && x < row + unit + 1) continue;          // 烧毁的那栋前面不晾衣服
      const z = 3.7 + rr() * 0.7;
      const g = new THREE.CylinderGeometry(0.022, 0.022, LANE_W + 0.6, 6);
      g.rotateZ((rr() - 0.5) * 0.18);
      g.translate(x, -LANE_W / 2, z);
      poles.push(g);
      for (let y = -0.8 - rr() * 0.6; y > -LANE_W + 0.8; y -= 0.55 + rr() * 0.6) {
        if (rr() < 0.45) continue;
        const wdt = 0.28 + rr() * 0.3, hgt = 0.35 + rr() * 0.45;
        const c = new THREE.PlaneGeometry(wdt, hgt, 3, 4);
        c.rotateX(Math.PI / 2); c.rotateZ(Math.PI / 2);   // 布面在 yz，沿竿子挂
        c.translate(x, y, z - hgt / 2 - 0.02);
        const col = palette[Math.floor(rr() * palette.length)];
        const n = c.attributes.position.count;
        const cc = new Float32Array(n * 3), top = new Float32Array(n);
        for (let i = 0; i < n; i++) { cc.set(col, i * 3); top[i] = z - 0.02; }
        c.setAttribute('color', new THREE.BufferAttribute(cc, 3));
        c.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
        clothes.push(c);
      }
    }
    lane.add(new THREE.Mesh(mergeList(poles), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.6 })));
    if (clothes.length) {
      const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.05 });
      m.customProgramCacheKey = () => 'cloth';
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = clothU.uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aTop;\nuniform float uTime;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float hang = clamp(aTop - position.z, 0.0, 2.0);
            transformed.x += (sin(uTime * 1.3 + position.y * 1.7) * 0.06 + sin(uTime * 2.9 + position.y * 4.0) * 0.015) * hang * hang * 1.6;`);
      };
      const mesh = new THREE.Mesh(mergeList(clothes, ['color', 'aTop']), m);
      mesh.castShadow = true;
      fine.add(mesh);
    }
  }

  // 落叶：贴地的小片，墙根多一点；烧毁的那栋周围没有
  {
    const rr = rng(31 + seed);
    const leaf = new THREE.PlaneGeometry(0.07, 0.045);
    const N = 420;
    const inst = new THREE.InstancedMesh(leaf, new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), N);
    const o = new THREE.Object3D(), c = new THREE.Color();
    let k = 0;
    for (let i = 0; i < N * 3 && k < N; i++) {
      const x = -unit * 5 + rr() * (row + unit * 15);
      const y = rr() < 0.6 ? (rr() < 0.5 ? -0.25 - rr() * 0.8 : -LANE_W + 0.25 + rr() * 0.8) : -rr() * LANE_W;
      if (x > ruinMin[0] - 1 && x < ruinMax[0] + 1 && y > -2.5) continue;
      o.position.set(x, y, 0.003 + rr() * 0.004);
      o.rotation.set(0, 0, rr() * 6.28);
      o.scale.setScalar(0.7 + rr() * 0.8);
      o.updateMatrix();
      inst.setMatrixAt(k, o.matrix);
      inst.setColorAt(k, c.setHSL(0.07 + rr() * 0.06, 0.55, 0.12 + rr() * 0.15));
      k++;
    }
    inst.count = k;
    fine.add(inst);
  }

  // 灯：墙上的路灯和门灯，暖黄；离废墟最近的三盏带阴影（高档 3 盏、中档 1 盏）
  const lamps = [
    { p: [row * 0.5, -LANE_W + 0.3, 3.3], aim: [row * 0.5, -1.5, 0.3], shadow: 1, k: 2.6 },
    { p: [row + unit + 0.45, -0.3, 3.3], aim: [row + unit * 0.4, -4.5, 0], shadow: 2 },
    { p: [-unit * 1.5, -0.3, 3.2], aim: [-unit * 1.5, -4, 0], shadow: 3 },
    { p: [row + unit * 5.5, -0.3, 3.25] }, { p: [row + unit * 3.0, -LANE_W + 0.3, 3.25] },
    { p: [-unit * 4.0, -LANE_W + 0.3, 3.2] }, { p: [row + unit * 8.5, -LANE_W + 0.3, 3.2] },
  ];
  const spots = [];
  for (const L of lamps) {
    const out = L.p[1] > -LANE_W / 2 ? -1 : 1;
    placeModel(lane, 'industrial_wall_sconce', [L.p[0], L.p[1] - out * 0.02, L.p[2] - 0.1], out < 0 ? 0 : Math.PI, 1.3);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(4) }));
    bulb.position.set(L.p[0], L.p[1] + out * 0.18, L.p[2] - 0.12);
    lane.add(bulb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.scale.set(2.2, 2.2, 1);
    halo.position.copy(bulb.position);
    lane.add(halo);
    if (L.shadow) {
      const s = new THREE.SpotLight(0xffa25a, 26 * (L.k || 1), 26, 1.1, 0.8, 2);
      s.position.copy(bulb.position);
      s.target.position.set(...L.aim);
      s.shadow.mapSize.set(1024, 1024);
      s.shadow.bias = -0.0004;
      s.shadow.normalBias = 0.02;
      s.userData.rank = L.shadow;
      lane.add(s, s.target);
      spots.push(s);
    } else {
      const l = new THREE.PointLight(0xffa25a, 7, 12, 2);
      l.position.copy(bulb.position);
      lane.add(l);
    }
  }

  quality.on((lv) => {
    spots.forEach((s) => { s.castShadow = s.userData.rank <= [0, 1, 3][lv]; });
    reflector.visible = lv >= 1;
    const rt = reflector.getRenderTarget();
    const k = lv >= 2 ? 0.5 : 0.25;
    rt.setSize(Math.max(256, Math.round(innerWidth * k)), Math.max(256, Math.round(innerHeight * k)));
    fine.children.forEach((c, i) => { c.visible = lv >= 1 || i % 2 === 0; });
  });

  return {
    group: lane,
    update(t) {
      litUniforms.uTime.value = t;
      clothU.uTime.value = t;
      reflector.material.uniforms.uTime.value = t;
    },
  };
}
