/* Munchy Kart - Monpad's Telegram mini-game (Phaser 3, free engine). Pseudo-3D road, milk to collect,
   hazards that spill it, rivals you can zap. Score = milk carried at the flag. */
(() => {
const W = 720, H = 1280, HY = 470;                 // logical size, horizon line
const SEG = 200, ROAD = 2200, CAM_H = 1000, CAM_D = 0.84, DRAW = 110, LANES = 3;
const TRACK_SEGS = 360, LEN = TRACK_SEGS * SEG;
const MAX_SPEED = 9500, BOOST_SPEED = 14500, ACCEL = 5200, BRAKE_OFF = 4200, OFFROAD_MAX = 3600;
const PLAYER_Z = CAM_H * CAM_D, RACE_SECS = 60;
const tg = window.Telegram && window.Telegram.WebApp; if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (a, b, p) => a + (b - a) * (p * p * (3 - 2 * p));

// ---------- track: curve per segment ----------
const segs = [];
function addSection(n, curve) { for (let i = 0; i < n; i++) segs.push({ curve: i < 12 ? ease(0, curve, i / 12) : (i > n - 12 ? ease(curve, 0, (i - (n - 12)) / 12) : curve) }); }
[[30,0],[40,2.2],[26,0],[44,-2.6],[22,0],[36,3.2],[20,0],[48,-3.4],[24,0],[40,2.4],[20,0],[10,-1],[0,0]].forEach(([n, c]) => n && addSection(n, c));
while (segs.length < TRACK_SEGS) segs.push({ curve: 0 });
segs.length = TRACK_SEGS;
segs.forEach((s, i) => { s.i = i; s.z = i * SEG; });

// ---------- items (milk, hazards, boosts, decor, rivals) ----------
let milk = [], hazards = [], boosts = [], decor = [], rivals = [];
function seedTrack() {
  milk = []; hazards = []; boosts = []; decor = []; rivals = [];
  for (let i = 18; i < TRACK_SEGS - 4; i += 5) {                     // milk trails weaving through the lanes
    const lane = Math.sin(i / 9) * 0.55 + (Math.random() - 0.5) * 0.25;
    milk.push({ z: i * SEG, x: clamp(lane, -0.85, 0.85), taken: false });
    if (Math.random() < 0.35) milk.push({ z: i * SEG + SEG * 2, x: clamp(lane + (Math.random() < .5 ? .35 : -.35), -.85, .85), taken: false });
  }
  for (let i = 34; i < TRACK_SEGS - 6; i += 17) hazards.push({ z: i * SEG, x: rnd(-.7, .7), hit: false });
  for (let i = 60; i < TRACK_SEGS - 6; i += 90) boosts.push({ z: i * SEG, x: rnd(-.5, .5), taken: false });
  for (let i = 4; i < TRACK_SEGS; i += 6) decor.push({ z: i * SEG, x: (i / 6 % 2 ? 1 : -1) * rnd(1.35, 2.6), kind: Math.random() < .62 ? 'dg' : 'dr', s: rnd(.8, 1.4) });
  const tints = [0xff4d6d, 0x39a8ff, 0xffb02e, 0x3dffa0, 0xc86bff];
  for (let k = 0; k < 5; k++) rivals.push({ z: 3000 + k * 6500, x: rnd(-.6, .6), v: MAX_SPEED * rnd(.66, .86), tint: tints[k], phase: rnd(0, 6), stun: 0 });
}

// ---------- the game scene ----------
class Race extends Phaser.Scene {
  constructor() { super('race'); }
  preload() {
    this.load.image('sky', 'assets/sky.jpg'); this.load.image('driver', 'assets/driver.png'); this.load.image('coin', 'assets/coin.png');
  }
  makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const tex = (key, w, h, fn) => { g.clear(); fn(g); g.generateTexture(key, w, h); };
    tex('milk', 64, 120, (g) => { g.fillStyle(0xf4f6ff); g.fillRoundedRect(10, 34, 44, 82, 12); g.fillStyle(0xbcd4ff); g.fillRoundedRect(18, 6, 28, 34, 7); g.fillStyle(0x6a45f0); g.fillRoundedRect(14, 62, 36, 28, 6); g.fillStyle(0xffffff, .55); g.fillRoundedRect(14, 40, 8, 70, 4); g.fillStyle(0x4a2cc0); g.fillRoundedRect(18, 2, 28, 10, 4); });
    tex('candleR', 70, 260, (g) => { g.fillStyle(0xff4d6d); g.fillRoundedRect(8, 44, 54, 212, 6); g.fillStyle(0xff9fb0); g.fillRect(8, 44, 12, 212); g.fillStyle(0xb01a3a); g.fillRect(50, 44, 12, 212); g.fillStyle(0xff4d6d); g.fillRect(32, 0, 6, 50); });
    tex('candleG', 70, 260, (g) => { g.fillStyle(0x39ff88); g.fillRoundedRect(8, 44, 54, 212, 6); g.fillStyle(0xb8ffd2); g.fillRect(8, 44, 12, 212); g.fillStyle(0x12a851); g.fillRect(50, 44, 12, 212); g.fillStyle(0x39ff88); g.fillRect(32, 0, 6, 50); });
    tex('hazard', 120, 200, (g) => { g.fillStyle(0xff2d55, .25); g.fillEllipse(60, 120, 120, 150); g.fillStyle(0xff4d6d); g.fillRoundedRect(30, 40, 60, 156, 7); g.fillStyle(0xffb0c0); g.fillRect(30, 40, 13, 156); g.fillStyle(0xb01a3a); g.fillRect(77, 40, 13, 156); g.fillStyle(0xff4d6d); g.fillRect(56, 4, 8, 40); g.fillStyle(0xffffff, .9); g.fillTriangle(60, 96, 46, 132, 74, 132); });
    tex('boost', 110, 200, (g) => { g.fillStyle(0x39ff88, .22); g.fillEllipse(55, 110, 110, 160); g.fillStyle(0x39ff88); g.fillRoundedRect(28, 38, 54, 150, 6); g.fillStyle(0xd9ffe8); g.fillRect(28, 38, 12, 150); g.fillStyle(0x39ff88); g.fillRect(52, 4, 6, 38); g.fillStyle(0xffffff); g.fillTriangle(55, 70, 36, 112, 74, 112); g.fillTriangle(55, 108, 36, 150, 74, 150); });
    const kart = (key, body) => tex(key, 360, 190, (g) => {
      g.fillStyle(0x000000, .35); g.fillEllipse(180, 172, 330, 40);
      g.fillStyle(0x15121f); g.fillRoundedRect(10, 84, 74, 96, 16); g.fillRoundedRect(276, 84, 74, 96, 16);
      g.fillStyle(0x2c2740); g.fillRoundedRect(18, 92, 14, 80, 6); g.fillRoundedRect(328, 92, 14, 80, 6);
      g.fillStyle(body); g.fillRoundedRect(58, 74, 244, 84, 22);
      g.fillStyle(0xffffff, .22); g.fillRoundedRect(70, 80, 220, 18, 9);
      g.fillStyle(0x1a1530); g.fillRoundedRect(86, 58, 188, 26, 8); g.fillRect(150, 22, 60, 40);
      g.fillStyle(0xff3355); g.fillRoundedRect(70, 120, 34, 16, 5); g.fillRoundedRect(256, 120, 34, 16, 5);
      g.fillStyle(0x7dffb0); g.fillCircle(116, 160, 9); g.fillCircle(244, 160, 9);
    });
    kart('kart', 0x6a45f0); [0xff4d6d, 0x39a8ff, 0xffb02e, 0x3dffa0, 0xc86bff].forEach((c, i) => kart('rk' + i, c));
    tex('head', 120, 120, (g) => { g.fillStyle(0xf2efff); g.fillCircle(60, 62, 46); g.fillStyle(0x15121f); g.fillRoundedRect(22, 50, 76, 26, 12); g.fillStyle(0x7dffb0); g.fillRect(34, 58, 52, 8); });
    g.destroy();
  }
  create() {
    this.makeTextures(); seedTrack();
    this.sky = this.add.image(W / 2, 0, 'sky').setOrigin(.5, 0).setDisplaySize(W * 1.9, HY + 60).setDepth(0);
    this.gfx = this.add.graphics().setDepth(1);
    this.pool = []; this.beam = this.add.graphics().setDepth(900);
    this.driver = this.add.image(W / 2, 905, 'driver').setDepth(600).setScale(.5);
    this.kartSpr = this.add.image(W / 2, 985, 'kart').setDepth(590).setScale(1.5);
    this.spark = this.add.particles(0, 0, 'coin', { speed: { min: 80, max: 380 }, angle: { min: 215, max: 325 }, lifespan: 700, scale: { start: .5, end: 0 }, gravityY: 500, emitting: false }).setDepth(800);
    this.hud();
    this.reset();
    this.input.addPointer(3);
    this.keys = this.input.keyboard.addKeys({ l: 'LEFT', r: 'RIGHT', a: 'A', d: 'D', f: 'SPACE', f2: 'UP' });
    this.touch = { l: false, r: false, f: false };
    const btn = (x, y, label, key, big) => {
      const r = big ? 84 : 62; const c = this.add.circle(x, y, r, 0x6a45f0, .38).setStrokeStyle(4, 0xd9ccff, .6).setDepth(950).setInteractive();
      this.add.text(x, y, label, { fontFamily: 'Russo One', fontSize: big ? 44 : 52, color: '#fff' }).setOrigin(.5).setDepth(951);
      c.on('pointerdown', () => { this.touch[key] = true; c.setFillStyle(0x39ff88, .5); }); const up = () => { this.touch[key] = false; c.setFillStyle(0x6a45f0, .38); };
      c.on('pointerup', up); c.on('pointerout', up); c.on('pointerupoutside', up);
    };
    btn(95, 1195, '<', 'l'); btn(255, 1195, '>', 'r'); btn(615, 1185, 'ZAP', 'f', true);
    this.input.keyboard.on('keydown-SPACE', () => this.zap());
  }
  hud() {
    const f = (size, color = '#fff') => ({ fontFamily: 'Russo One', fontSize: size, color, stroke: '#1b0a52', strokeThickness: 8 });
    this.add.image(60, 64, 'milk').setScale(.6).setDepth(950);
    this.milkTxt = this.add.text(104, 28, '0', f(64, '#ffffff')).setDepth(950);
    this.timeTxt = this.add.text(W - 36, 30, '60', f(64, '#39ff88')).setOrigin(1, 0).setDepth(950);
    this.msg = this.add.text(W / 2, 330, '', f(60, '#ffd75e')).setOrigin(.5).setDepth(960).setAlpha(0);
    this.speedBar = this.add.graphics().setDepth(950);
  }
  reset() {
    this.pos = 0; this.speed = 0; this.px = 0; this.milkN = 0; this.t = RACE_SECS; this.boost = 0; this.stun = 0; this.over = false; this.lap = 0; this.shield = 0;
    this.skyOff = 0; this.cool = 0; this.combo = 0; this.comboT = 0;
    seedTrack(); this.msg.setAlpha(0); this.milkTxt.setText('0');
    this.setEnd(false);
  }
  setEnd(on) {
    if (this.endObjs) this.endObjs.forEach((o) => o.destroy()); this.endObjs = [];
    if (!on) return;
    const best = Math.max(+(localStorage.getItem('mk_best') || 0), this.milkN); localStorage.setItem('mk_best', best);
    const s = { fontFamily: 'Russo One', fontSize: 54, color: '#fff', stroke: '#1b0a52', strokeThickness: 8 };
    const shade = this.add.rectangle(W / 2, H / 2, W, H, 0x07040f, .72).setDepth(1000);
    const t1 = this.add.text(W / 2, 360, 'FINISH!', { ...s, fontSize: 96, color: '#39ff88' }).setOrigin(.5).setDepth(1001);
    const t2 = this.add.text(W / 2, 500, 'MILK  ' + this.milkN, { ...s, fontSize: 84 }).setOrigin(.5).setDepth(1001);
    const t3 = this.add.text(W / 2, 600, 'BEST  ' + best, { ...s, color: '#d9ccff' }).setOrigin(.5).setDepth(1001);
    const b = this.add.rectangle(W / 2, 800, 440, 130, 0x39ff88).setStrokeStyle(6, 0xffffff).setDepth(1001).setInteractive();
    const bt = this.add.text(W / 2, 800, 'RACE AGAIN', { ...s, color: '#07040f', stroke: '#39ff88', strokeThickness: 0, fontSize: 52 }).setOrigin(.5).setDepth(1002);
    b.on('pointerdown', () => this.reset());
    this.endObjs = [shade, t1, t2, t3, b, bt];
    if (window.MunchyKart && window.MunchyKart.onFinish) window.MunchyKart.onFinish({ milk: this.milkN });
  }
  flash(text, color) { this.msg.setText(text).setColor(color || '#ffd75e').setAlpha(1).setScale(1.25); this.tweens.killTweensOf(this.msg); this.tweens.add({ targets: this.msg, alpha: 0, scale: 1, duration: 900, delay: 250 }); }
  seg(z) { return segs[Math.floor(((z % LEN) + LEN) % LEN / SEG) % TRACK_SEGS]; }
  zap() {
    if (this.over || this.cool > 0) return; this.cool = .32;
    let best = null;
    for (const r of rivals) { let d = r.z - (this.pos + PLAYER_Z); if (d < 0) d += LEN; if (d > 400 && d < SEG * 40 && Math.abs(r.x - this.px) < .42 && (!best || d < best.d)) best = { r, d }; }
    this.beam.clear(); this.beamT = .12; this.beamHit = best;
    if (best) { const r = best.r; r.stun = 1.4; r.v *= .6; const n = 3; for (let i = 0; i < n; i++) milk.push({ z: r.z + (i + 1) * 380, x: clamp(r.x + rnd(-.4, .4), -.9, .9), taken: false, fresh: true }); this.flash('ZAPPED!  +MILK DROP', '#39ff88'); this.cameras.main.shake(120, .006); }
  }
  update(_, dtms) {
    const dt = Math.min(dtms, 50) / 1000;
    if (!this.over) {
      this.t -= dt; this.cool -= dt; this.comboT -= dt; if (this.comboT <= 0) this.combo = 0;
      const left = this.keys.l.isDown || this.keys.a.isDown || this.touch.l, right = this.keys.r.isDown || this.keys.d.isDown || this.touch.r;
      if ((this.keys.f.isDown || this.keys.f2.isDown || this.touch.f) && this.cool <= 0) this.zap();
      const steer = (right ? 1 : 0) - (left ? 1 : 0);
      const target = this.boost > 0 ? BOOST_SPEED : (Math.abs(this.px) > 1.02 ? OFFROAD_MAX : MAX_SPEED) * (this.stun > 0 ? .35 : 1);
      this.speed += (this.speed < target ? ACCEL : -BRAKE_OFF) * dt; this.speed = clamp(this.speed, 0, BOOST_SPEED);
      if (this.speed > target && this.boost <= 0) this.speed = Math.max(target, this.speed - BRAKE_OFF * dt);
      this.boost -= dt; this.stun -= dt;
      const sp = this.speed / MAX_SPEED, cur = this.seg(this.pos + PLAYER_Z).curve;
      this.px += steer * dt * 2.1 * sp - cur * dt * sp * .62; this.px = clamp(this.px, -2.2, 2.2);
      const prev = this.pos; this.pos += this.speed * dt; if (this.pos >= LEN) { this.pos -= LEN; this.lap++; milk.forEach((m) => { if (!m.fresh) m.taken = false; }); hazards.forEach((h) => (h.hit = false)); boosts.forEach((b) => (b.taken = false)); milk = milk.filter((m) => !m.fresh); }
      this.collide(prev, this.pos);
      rivals.forEach((r) => { r.stun = Math.max(0, r.stun - dt); const base = MAX_SPEED * .8; r.v += ((r.stun > 0 ? 0 : base * (.8 + .1 * Math.sin(r.phase))) - r.v) * Math.min(1, dt * 1.2) ; r.z = (r.z + r.v * dt * (r.stun > 0 ? .5 : 1)) % LEN; r.phase += dt * .7; r.x = clamp(r.x + Math.sin(r.phase * 1.7) * dt * .5, -.85, .85); });
      if (this.t <= 0) { this.t = 0; this.over = true; this.speed = 0; this.setEnd(true); }
    }
    this.skyOff -= this.seg(this.pos + PLAYER_Z).curve * dt * (this.speed / MAX_SPEED) * 90;
    this.sky.x = W / 2 + clamp(this.skyOff, -120, 120);
    this.render();
    this.milkTxt.setText(String(this.milkN)); this.timeTxt.setText(String(Math.ceil(this.t))).setColor(this.t < 10 ? '#ff4d6d' : '#39ff88');
    this.speedBar.clear().fillStyle(0xffffff, .2).fillRoundedRect(W / 2 - 150, 100, 300, 14, 7).fillStyle(this.boost > 0 ? 0x39ff88 : 0xc9bcff, .95).fillRoundedRect(W / 2 - 150, 100, 300 * clamp(this.speed / BOOST_SPEED, 0, 1), 14, 7);
    if (this.beamT > 0) { this.beamT -= dt; if (this.beamT <= 0) this.beam.clear(); }
  }
  collide(a, b) {
    const hit = (z) => { const pz = this.pos + PLAYER_Z; let d = z - pz; if (d < -LEN / 2) d += LEN; if (d > LEN / 2) d -= LEN; return d; };
    for (const m of milk) if (!m.taken) { const d = hit(m.z); if (Math.abs(d) < 360 && Math.abs(m.x - this.px) < .3) { m.taken = true; this.combo++; this.comboT = 1.6; this.milkN += this.combo >= 5 ? 2 : 1; this.spark.emitParticleAt(W / 2 + (m.x - this.px) * 160, 800, 3); if (this.combo === 5) this.flash('COMBO x2!', '#ffd75e'); } }
    for (const h of hazards) if (!h.hit) { const d = hit(h.z); if (Math.abs(d) < 320 && Math.abs(h.x - this.px) < .26) { h.hit = true; this.combo = 0; if (this.shield > 0) { this.shield = 0; continue; } const lose = Math.min(this.milkN, 4); this.milkN -= lose; this.stun = .7; this.speed *= .45; this.cameras.main.shake(200, .014); this.flash('SPILLED -' + lose, '#ff4d6d'); for (let i = 0; i < lose; i++) milk.push({ z: this.pos + PLAYER_Z + 900 + i * 420, x: clamp(this.px + rnd(-.5, .5), -.9, .9), taken: false, fresh: true }); } }
    for (const bo of boosts) if (!bo.taken) { const d = hit(bo.z); if (Math.abs(d) < 360 && Math.abs(bo.x - this.px) < .3) { bo.taken = true; this.boost = 1.8; this.flash('BOOST!', '#39ff88'); } }
  }
  proj(z, x, camX) { const cz = z; const sc = CAM_D / cz; return { sc, x: W / 2 + sc * (x - camX) * W / 2, y: HY + sc * CAM_H * H / 2 * .62, w: sc * ROAD * W / 2 }; }
  render() {
    const g = this.gfx; g.clear();
    g.fillStyle(0x1c0f4a, 1).fillRect(0, HY - 2, W, H - HY + 2);
    const base = Math.floor(this.pos / SEG), off = (this.pos % SEG) / SEG;
    const camX = this.px * ROAD;
    let dx = -(segs[base % TRACK_SEGS].curve * off), x = 0, maxY = H;
    const pts = [];
    for (let n = 0; n < DRAW; n++) {
      const s = segs[(base + n) % TRACK_SEGS]; const wrap = (base + n) >= TRACK_SEGS ? LEN : 0;
      const zc = (base + n) * SEG - this.pos + 1; const zn = zc + SEG;
      const a = this.proj(Math.max(zc, 1), 0, camX - x), b = this.proj(zn, 0, camX - x - dx);
      pts.push({ s, a, b, n, x }); x += dx; dx += s.curve;
    }
    for (let n = DRAW - 1; n >= 0; n--) {
      const { s, a, b } = pts[n]; if (b.y >= a.y) continue; const idx = (base + n);
      const lit = Math.floor(idx / 3) % 2;
      g.fillStyle(lit ? 0x2a1766 : 0x24135a, 1).fillRect(0, b.y, W, a.y - b.y + 1);
      const poly = (c, ax, aw, bx, bw) => { g.fillStyle(c, 1); g.fillPoints([{ x: ax - aw, y: a.y }, { x: ax + aw, y: a.y }, { x: bx + bw, y: b.y }, { x: bx - bw, y: b.y }], true); };
      poly(lit ? 0x8a6cff : 0xe8e0ff, a.x, a.w * 1.13, b.x, b.w * 1.13);
      poly(lit ? 0x3a3457 : 0x353050, a.x, a.w, b.x, b.w);
      if (lit) for (let l = 1; l < LANES; l++) { const o = (l / LANES * 2 - 1); poly(0xc8c0ff, a.x + a.w * o, a.w * .018, b.x + b.w * o, b.w * .018); }
    }
    // sprites back to front
    let pi = 0; const use = (key) => { let im = this.pool[pi]; if (!im) { im = this.add.image(0, 0, key).setOrigin(.5, 1); this.pool[pi] = im; } im.setTexture(key).setVisible(true).clearTint(); pi++; return im; };
    const place = (key, item, worldW, xoff, tint) => {
      for (let n = DRAW - 1; n >= 1; n--) {
        const p = pts[n]; const sz = p.s.z; if (item.seg !== (base + n) % TRACK_SEGS) continue;
        const sc = p.a.sc; const tex = this.textures.get(key).getSourceImage(); const w = sc * worldW * W / 2, h = w * tex.height / tex.width; if (w < 3) continue;
        const im = use(key); im.setPosition(p.a.x + sc * xoff * ROAD * W / 2, p.a.y).setDisplaySize(w, h).setDepth(10 + (DRAW - n)); if (tint) im.setTint(tint); if (item.alpha != null) im.setAlpha(item.alpha); else im.setAlpha(1);
      }
    };
    const idxOf = (z) => Math.floor((((z % LEN) + LEN) % LEN) / SEG) % TRACK_SEGS;
    const list = [];
    decor.forEach((d) => list.push({ k: d.kind === 'dg' ? 'candleG' : 'candleR', seg: idxOf(d.z), w: 260 * d.s, x: d.x }));
    milk.forEach((m) => !m.taken && list.push({ k: 'milk', seg: idxOf(m.z), w: 230, x: m.x }));
    hazards.forEach((h) => !h.hit && list.push({ k: 'hazard', seg: idxOf(h.z), w: 330, x: h.x }));
    boosts.forEach((b) => !b.taken && list.push({ k: 'boost', seg: idxOf(b.z), w: 300, x: b.x }));
    rivals.forEach((r, i) => list.push({ k: 'rk' + i, seg: idxOf(r.z), w: 560, x: r.x, alpha: r.stun > 0 && Math.floor(this.t * 14) % 2 ? .4 : 1, rival: true }));
    for (const it of list) place(it.k, it, it.w, it.x, null);
    for (let i = pi; i < this.pool.length; i++) this.pool[i].setVisible(false);
    // player kart
    const bob = Math.sin(this.pos / 700) * 3 + (this.stun > 0 ? Math.sin(this.t * 60) * 6 : 0);
    const lean = (this.keys.l.isDown || this.keys.a.isDown || this.touch.l ? -1 : 0) + (this.keys.r.isDown || this.keys.d.isDown || this.touch.r ? 1 : 0);
    this.kartSpr.setPosition(W / 2 + lean * 14, 985 + bob).setAngle(lean * 4).setTint(this.boost > 0 ? 0xbfffe0 : 0xffffff);
    this.driver.setPosition(W / 2 + lean * 16, 899 + bob).setAngle(lean * 3);
    this.cameras.main.setZoom(1);
    if (this.beamT > 0 && this.beamHit) { const r = this.beamHit.r; const sc = CAM_D / Math.max(this.beamHit.d, 200); this.beam.clear().lineStyle(14, 0x39ff88, .9).beginPath().moveTo(W / 2 + 80, 905).lineTo(W / 2 + (r.x - this.px) * sc * ROAD * W / 2, HY + sc * CAM_H * H / 2 * .62 - 60).strokePath().lineStyle(5, 0xffffff, 1).beginPath().moveTo(W / 2 + 80, 905).lineTo(W / 2 + (r.x - this.px) * sc * ROAD * W / 2, HY + sc * CAM_H * H / 2 * .62 - 60).strokePath(); }
    else if (this.beamT > 0) { this.beam.clear().lineStyle(10, 0x39ff88, .7).beginPath().moveTo(W / 2 + 80, 905).lineTo(W / 2 + 80 + (this.px * -10), HY + 60).strokePath(); }
  }
}

window.MunchyKart = window.MunchyKart || {};
new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: W, height: H, backgroundColor: '#07040f', scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, render: { antialias: true, powerPreference: 'high-performance' }, scene: Race });
window.addEventListener('error', (e) => { const el = document.getElementById('err'); el.style.display = 'block'; el.textContent = e.message; });
})();
