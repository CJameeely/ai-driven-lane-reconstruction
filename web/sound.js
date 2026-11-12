// 灾后重建 · 声音：弄堂的生活声、火后的风声和余烬、修复聚拢时的落灰声
// 素材是 assets/sound/ 里的 Freesound CC0 录音（来源见 assets/CREDITS.md）。
// 浏览器不允许自动出声，页面上的声音开关点一次才 enable()。之后每帧 setMix() 给四路的目标音量（0~1），
// update(dt) 平滑过去，并按音量随机触发自行车铃、狗叫、锅铲、噼啪和落灰这些短声。

const SND = new URL('./assets/sound/', import.meta.url).href;
const FILES = ['rain', 'radio', 'apartment', 'bell', 'wok', 'dog', 'wind', 'crackle', 'dust', 'dust2'];

export class Soundscape {
  constructor() {
    this.ctx = null; this.on = false;
    this.mix = { life: 1, fire: 0, ember: 0, dust: 0 };
    this.next = {};                      // 各种短声下一次触发的时间（秒）
  }

  async enable() {
    if (this.ctx) { await this.ctx.resume(); this.on = true; return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.recDest = ctx.createMediaStreamDestination();      // 录制时把声音一起录进去
    this.master.connect(this.recDest);
    const bus = () => { const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master); return g; };
    this.bus = { life: bus(), fire: bus(), ember: bus(), dust: bus() };
    this.buf = {};
    await Promise.all(FILES.map(async (f) => {
      try { this.buf[f] = await ctx.decodeAudioData(await (await fetch(SND + f + '.mp3')).arrayBuffer()); }
      catch (e) { console.warn('[sound] 没加载上 ' + f, e); }
    }));
    // 一直循环的底子
    this.loop('rain', this.bus.life, 0.55);
    this.loop('apartment', this.bus.life, 0.22, { lp: 2400 });
    this.loop('radio', this.bus.life, 0.1, { lp: 1600, hp: 280 });
    this.loop('wind', this.bus.fire, 0.75, { lp: 700 });
    this.loop('crackle', this.bus.ember, 0.35);
    const t = ctx.currentTime;
    this.next = { bell: t + 6, dog: t + 11, wok: t + 3, crackle: t, dust: t };
    this.on = true;
  }

  async toggle() { if (this.on) { await this.ctx.suspend(); this.on = false; } else await this.enable(); return this.on; }

  stream() { return this.recDest ? this.recDest.stream : null; }

  chain(dest, { lp, hp, pan } = {}) {
    // 滤波和声像：远处的声音切掉高频
    let node = dest;
    const ctx = this.ctx;
    if (pan !== undefined) { const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(node); node = p; }
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.connect(node); node = f; }
    if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; f.connect(node); node = f; }
    return node;
  }

  loop(name, dest, gain, opt = {}) {
    const b = this.buf[name];
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(this.chain(dest, opt));
    s.start(0, Math.random() * b.duration);
  }

  shot(name, dest, gain, { offset = 0, dur, rate = 1, fade = 0.05, ...opt } = {}) {
    // 放一段：从 offset 开始，dur 秒，头尾淡入淡出
    const b = this.buf[name];
    if (!b) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = b; s.playbackRate.value = rate;
    const d = Math.min(dur ?? b.duration, b.duration - offset);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + fade);
    g.gain.setValueAtTime(gain, t + Math.max(fade, d / rate - fade));
    g.gain.linearRampToValueAtTime(0, t + d / rate);
    s.connect(g); g.connect(this.chain(dest, opt));
    s.start(t, offset, d);
  }

  setMix(m) { Object.assign(this.mix, m); }

  update() {
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, M = this.mix;
    for (const k of Object.keys(this.bus)) this.bus[k].gain.setTargetAtTime(Math.max(0, Math.min(1, M[k] ?? 0)), t, 0.6);
    const R = Math.random, pan = () => (R() - 0.5) * 1.4;
    if (M.life > 0.05) {
      if (t > this.next.bell) { this.shot('bell', this.bus.life, 0.22, { offset: R() * 8, dur: 2.5, lp: 5000, pan: pan() }); this.next.bell = t + 25 + R() * 35; }
      if (t > this.next.dog) {
        const n = 1 + Math.floor(R() * 3);
        for (let i = 0; i < n; i++) setTimeout(() => this.shot('dog', this.bus.life, 0.16, { lp: 1800, pan: -0.6 + R() * 0.3, rate: 0.95 + R() * 0.1 }), i * (350 + R() * 300));
        this.next.dog = t + 18 + R() * 30;
      }
      if (t > this.next.wok) {
        const b = this.buf.wok;
        if (b) this.shot('wok', this.bus.life, 0.16, { offset: R() * (b.duration - 10), dur: 5 + R() * 4, fade: 0.8, lp: 2800, pan: pan() });
        this.next.wok = t + 16 + R() * 26;
      }
    }
    if (M.ember > 0.05 && t > this.next.crackle) {
      const b = this.buf.crackle;
      if (b) this.shot('crackle', this.bus.ember, 0.5, { offset: R() * (b.duration - 0.4), dur: 0.15 + R() * 0.3, rate: 0.8 + R() * 0.5, fade: 0.01, pan: pan() });
      this.next.crackle = t + (0.08 + R() * 0.5) / M.ember;
    }
    if (M.dust > 0.05 && t > this.next.dust) {
      const name = R() < 0.6 ? 'dust' : 'dust2', b = this.buf[name];
      if (b) this.shot(name, this.bus.dust, 0.35 + R() * 0.3, { offset: R() * (b.duration - 0.5), dur: 0.2 + R() * 0.35, rate: 0.9 + R() * 0.6, fade: 0.04, hp: 1200, pan: pan() });
      this.next.dust = t + (0.06 + R() * 0.25) / M.dust;
    }
  }
}
