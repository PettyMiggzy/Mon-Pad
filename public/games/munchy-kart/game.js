/* Munchy Kart - Monpad's Telegram mini-game (Phaser 3, free engine).
   Garage (buy cars, boosts, upgrades with milk) -> Race (pseudo-3D, collect milk, dodge red candles, zap rivals).
   Progress is stored on this device (localStorage). A server-side wallet and leaderboard come later. */
(() => {
const W = 720, H = 1280, HY = 470;
const SEG = 200, ROAD = 2200, CAM_H = 1000, CAM_D = 0.84, DRAW = 110, LANES = 3;
const TRACK_SEGS = 360, LEN = TRACK_SEGS * SEG;
const MAX_SPEED = 9500, BOOST_SPEED = 14500, ACCEL = 5200, BRAKE_OFF = 4200, OFFROAD_MAX = 3600;
const PLAYER_Z = CAM_H * CAM_D, RACE_SECS = 60;
const tg = window.Telegram && window.Telegram.WebApp; if (tg) { try { tg.ready(); tg.expand(); } catch (e) {} }
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FIXED_RACE_DT = 1 / 60;
const MSG_MAX_W = W * 0.88;

/** Seeded PRNG (mulberry32). Same seed -> same [0,1) sequence. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Autopilot tuning (deterministic; no random choices). */
const AUTOPILOT = {
  LOOK_AHEAD_Z: 3400,
  MILK_COLLECT_X: 0.34,
  HAZARD_AVOID_Z: 1500,
  HAZARD_LANE_X: 0.3,
  STEER_DEADZONE: 0.05,
  STEER_FULL: 0.22,
  LANE_CENTER_PULL: 0.12,
  NITRO_MIN_T: 42,
  NITRO_CLEAR_Z: 2600,
  NITRO_LANE_X: 0.35,
  ZAP_RIVAL_X: 0.42,
  ZAP_MIN_Z: 400,
  ZAP_MAX_Z: SEG * 40,
};
const ease = (a, b, p) => a + (b - a) * (p * p * (3 - 2 * p));
const FONT = 'Russo One';

// ---------- catalog ----------
const CARS = [
  { id: 1, name: 'Munchy', price: 0, speed: 1.0, accel: 1.0, grip: 1.0, blurb: 'The classic purple kart.' },
  { id: 2, name: 'Zoomer', price: 250, speed: 1.12, accel: 0.95, grip: 0.95, blurb: 'Fast on the straights.' },
  { id: 3, name: 'Cookie Cruiser', price: 400, speed: 0.98, accel: 1.1, grip: 1.18, blurb: 'Sticks to every corner.' },
  { id: 4, name: 'Moonshot', price: 700, speed: 1.08, accel: 1.25, grip: 1.0, blurb: 'Rocket-quick launch.' },
  { id: 5, name: 'Gold Whale', price: 1500, speed: 1.2, accel: 1.1, grip: 1.1, blurb: 'The flex. Best all round.' },
];
const BOOSTS = [
  { id: 'nitro', name: 'Nitro', price: 30, icon: 'N', blurb: '+60% speed for 2 sec. Tap NITRO in a race.' },
  { id: 'shield', name: 'Shield', price: 25, icon: 'S', blurb: 'Blocks one spill. Used at the start.' },
  { id: 'magnet', name: 'Milk Magnet', price: 40, icon: 'M', blurb: 'Pulls milk in for 12 sec at the start.' },
];
const UPGRADES = [
  { id: 'engine', name: 'Engine', max: 3, prices: [120, 260, 520], blurb: '+4% top speed per level.' },
  { id: 'zap', name: 'Gatling Zap', max: 3, prices: [60, 140, 300], blurb: 'Faster zaps per level.' },
  { id: 'tires', name: 'Tires', max: 3, prices: [90, 200, 400], blurb: 'Tighter steering per level.' },
];

// ---------- save ----------
const KEY = 'mk_save_v1';
const fresh = () => ({ milk: 0, cars: [1], car: 1, inv: { nitro: 0, shield: 0, magnet: 0 }, up: { engine: 0, zap: 0, tires: 0 }, best: 0, races: 0 });
let save = fresh();
try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s) save = { ...fresh(), ...s, inv: { ...fresh().inv, ...s.inv }, up: { ...fresh().up, ...s.up } }; } catch (e) {}
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) {} cloudQueue(); };

// ---------- cloud (optional wallet sync) ----------
// Loadout (car, cars, boosts, upgrades) syncs to /api/game/loadout with a wallet signature.
// Milk stays on this device until the server can verify races.
const cloud = { addr: null, last: '', timer: null, busy: false };
const loadoutOf = (s) => ({ car: s.car, cars: s.cars, inv: s.inv, up: s.up });
const loadoutMessage = (w, n) => `Mon-Pad Munchy Kart: save loadout for ${w} nonce ${n}`;
const shortAddr = (a) => a.slice(0, 6) + '…' + a.slice(-4);
async function cloudApi(method, body) {
  const q = method === 'GET' ? `?wallet=${cloud.addr}` : '';
  const r = await fetch('/api/game/loadout' + q, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}
async function cloudSave() {
  if (!cloud.addr || cloud.busy) return;
  const lo = loadoutOf(save), snap = JSON.stringify(lo);
  if (snap === cloud.last) return;
  cloud.busy = true;
  try {
    const cur = await cloudApi('GET');
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [loadoutMessage(cloud.addr, cur.nonce), cloud.addr] });
    await cloudApi('PUT', { wallet: cloud.addr, loadout: lo, signature });
    cloud.last = snap;
  } catch (e) { /* offline or signature declined: local save still holds */ }
  cloud.busy = false;
}
function cloudQueue() { if (!cloud.addr) return; clearTimeout(cloud.timer); cloud.timer = setTimeout(cloudSave, 3000); }
async function cloudConnect() {
  if (!window.ethereum) throw new Error('No wallet found');
  const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  cloud.addr = addr.toLowerCase();
  const d = await cloudApi('GET');
  if (d.nonce > 0) { // this wallet already has a saved loadout: it wins
    const lo = d.loadout;
    save.car = lo.car; save.cars = lo.cars; save.inv = { ...save.inv, ...lo.inv }; save.up = { ...save.up, ...lo.up };
    cloud.last = JSON.stringify(loadoutOf(save));
    persist();
  } else { cloud.last = ''; await cloudSave(); }
  return cloud.addr;
}
const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

// ---------- track ----------
const segs = [];
function addSection(n, curve) { for (let i = 0; i < n; i++) segs.push({ curve: i < 12 ? ease(0, curve, i / 12) : (i > n - 12 ? ease(curve, 0, (i - (n - 12)) / 12) : curve) }); }
[[30,0],[40,2.2],[26,0],[44,-2.6],[22,0],[36,3.2],[20,0],[48,-3.4],[24,0],[40,2.4],[20,0],[10,-1]].forEach(([n, c]) => addSection(n, c));
while (segs.length < TRACK_SEGS) segs.push({ curve: 0 });
segs.length = TRACK_SEGS;
let milk = [], hazards = [], boosts = [], decor = [], rivals = [];
function seedTrack(playerCar, rng = Math.random) {
  const r = (a, b) => a + rng() * (b - a);
  milk = []; hazards = []; boosts = []; decor = []; rivals = [];
  for (let i = 18; i < TRACK_SEGS - 4; i += 5) {
    const lane = Math.sin(i / 9) * 0.55 + (rng() - 0.5) * 0.25;
    milk.push({ z: i * SEG, x: clamp(lane, -0.85, 0.85), taken: false });
    if (rng() < 0.35) milk.push({ z: i * SEG + SEG * 2, x: clamp(lane + (rng() < .5 ? .35 : -.35), -.85, .85), taken: false });
  }
  for (let i = 34; i < TRACK_SEGS - 6; i += 17) hazards.push({ z: i * SEG, x: r(-.7, .7), hit: false });
  for (let i = 60; i < TRACK_SEGS - 6; i += 90) boosts.push({ z: i * SEG, x: r(-.5, .5), taken: false });
  for (let i = 4; i < TRACK_SEGS; i += 6) decor.push({ z: i * SEG, x: (i / 6 % 2 ? 1 : -1) * r(1.35, 2.6), kind: rng() < .62 ? 'candleG' : 'candleR', s: r(.8, 1.4) });
  const others = CARS.filter((c) => c.id !== playerCar).map((c) => c.id);
  for (let k = 0; k < 4; k++) rivals.push({ z: 3000 + k * 8000, x: r(-.6, .6), v: MAX_SPEED * r(.66, .86), car: others[k % others.length], phase: r(0, 6), stun: 0, spin: 0 });
}
const idxOf = (z) => Math.floor((((z % LEN) + LEN) % LEN) / SEG) % TRACK_SEGS;

// ---------- shared UI ----------
const txt = (sc, x, y, s, size, color = '#fff', o = {}) => sc.add.text(x, y, s, { fontFamily: FONT, fontSize: size, color, stroke: '#1b0a52', strokeThickness: Math.round(size / 8), ...o }).setOrigin(o.ox ?? 0.5, o.oy ?? 0.5);
function button(sc, x, y, w, h, label, color, onClick, textColor = '#07040f') {
  const r = sc.add.rectangle(x, y, w, h, color).setStrokeStyle(5, 0xffffff, .9).setInteractive({ useHandCursor: true });
  const t = sc.add.text(x, y, label, { fontFamily: FONT, fontSize: Math.min(46, h * .5), color: textColor }).setOrigin(.5);
  r.on('pointerdown', () => { r.setScale(.96); t.setScale(.96); }); r.on('pointerup', () => { r.setScale(1); t.setScale(1); onClick(); }); r.on('pointerout', () => { r.setScale(1); t.setScale(1); });
  return { r, t, set(l, c) { t.setText(l); r.setFillStyle(c); } };
}
const backdrop = (sc) => { const g = sc.add.graphics(); g.fillGradientStyle(0x2a1370, 0x2a1370, 0x07040f, 0x07040f, 1).fillRect(0, 0, W, H); sc.add.image(W / 2, 0, 'sky').setOrigin(.5, 0).setDisplaySize(W * 1.9, 560).setAlpha(.55); };

// ---------- boot ----------
class Boot extends Phaser.Scene {
  constructor() { super('boot'); }
  preload() {
    const b = this.add.rectangle(W / 2, H / 2, 10, 14, 0x39ff88);
    this.load.on('progress', (p) => b.setSize(Math.max(10, 480 * p), 14));
    this.load.image('sky', 'assets/sky.jpg'); this.load.image('coin', 'assets/coin.png');
    for (const c of CARS) for (let k = 0; k < 7; k++) this.load.image(`car${c.id}_${k}`, `assets/cars/car${c.id}_${k}.webp`);
    ['milk', 'candleR', 'candleG'].forEach((n) => this.load.image(n, `assets/props/${n}.webp`));
  }
  create() { (document.fonts ? document.fonts.load('40px "Russo One"') : Promise.resolve()).catch(() => {}).then(() => this.scene.start('garage')); }
}

// ---------- garage ----------
class Garage extends Phaser.Scene {
  constructor() { super('garage'); }
  create() {
    this.tab = 'cars'; this.view = save.car;
    backdrop(this);
    this.add.image(52, 68, 'milk').setDisplaySize(40, 112).setOrigin(.5, .5);
    this.milkTxt = txt(this, 100, 68, '', 50, '#fff', { ox: 0 });
    txt(this, W - 40, 68, 'GARAGE', 44, '#d9ccff', { ox: 1 });
    this.walletTxt = txt(this, W - 40, 112, cloud.addr ? shortAddr(cloud.addr) : 'CONNECT WALLET', 26, '#9a8cd8', { ox: 1 }).setInteractive({ useHandCursor: true });
    this.walletTxt.on('pointerup', () => {
      if (cloud.addr) return;
      cloudConnect().then((a) => { this.walletTxt.setText(shortAddr(a)); this.say('Wallet synced', '#39ff88'); this.draw(); })
        .catch((e) => this.say(e.message === 'No wallet found' ? 'No wallet found' : 'Wallet sync failed', '#ff6d8a'));
    });
    this.body = this.add.container(0, 0);
    this.tabs = ['cars', 'boosts', 'upgrades'].map((t, i) => {
      const x = 130 + i * 230;
      const r = this.add.rectangle(x, 168, 210, 66, 0x2a1370).setStrokeStyle(4, 0xb7a4ff, .6).setInteractive({ useHandCursor: true });
      const l = txt(this, x, 168, t.toUpperCase(), 28, '#d9ccff');
      r.on('pointerup', () => { this.tab = t; this.draw(); });
      return { t, r, l };
    });
    // One RACE button: the race plays itself (autopilot). Each race gets a fresh random seed; ?seed=...&auto=1 still replays one.
    button(this, W / 2, H - 110, 560, 120, 'RACE', 0x39ff88, () => { persist(); this.scene.start('race', { seed: (Math.random() * 1e9 | 0) >>> 0, autopilot: true }); });
    this.toast = txt(this, W / 2, 232, '', 30, '#ffd75e').setAlpha(0).setDepth(50);
    this.draw();
    const qp = new URLSearchParams(location.search);
    if (qp.get('auto') === '1' && qp.has('seed')) {
      const seed = parseInt(qp.get('seed'), 10) >>> 0;
      persist();
      this.scene.start('race', { seed, autopilot: true, skipPersist: qp.get('persist') !== '1' });
    }
  }
  say(m, c = '#ffd75e') { this.toast.setText(m).setColor(c).setAlpha(1); this.tweens.killTweensOf(this.toast); this.tweens.add({ targets: this.toast, alpha: 0, delay: 1100, duration: 400 }); }
  buy(price) { if (save.milk < price) { this.say('Not enough milk', '#ff6d8a'); return false; } save.milk -= price; persist(); return true; }
  draw() {
    this.body.removeAll(true);
    this.milkTxt.setText(String(save.milk));
    this.tabs.forEach(({ t, r, l }) => { r.setFillStyle(this.tab === t ? 0x6a45f0 : 0x2a1370); l.setColor(this.tab === t ? '#ffffff' : '#d9ccff'); });
    const add = (o) => { this.body.add(o); return o; };
    if (this.tab === 'cars') {
      const c = carById(this.view), owned = save.cars.includes(c.id), equipped = save.car === c.id;
      const glow = add(this.add.ellipse(W / 2, 800, 500, 80, 0x7a55ff, .35));
      const img = add(this.add.image(W / 2, 800, `car${c.id}_3`).setOrigin(.5, 1)); img.setDisplaySize(440, 440 * img.height / img.width);
      this.tweens.add({ targets: img, y: 790, yoyo: true, repeat: -1, duration: 1400, ease: 'Sine.inOut' });
      add(txt(this, W / 2, 275, c.name.toUpperCase(), 60, '#ffffff'));
      add(txt(this, W / 2, 330, c.blurb, 26, '#c9bcff', { stroke: '#000', strokeThickness: 0 }));
      [['SPEED', c.speed], ['ACCEL', c.accel], ['GRIP', c.grip]].forEach(([n, v], i) => {
        const y = 850 + i * 46; add(txt(this, 120, y, n, 26, '#d9ccff', { ox: 0 }));
        add(this.add.rectangle(280, y, 300, 16, 0xffffff, .15).setOrigin(0, .5));
        add(this.add.rectangle(280, y, 300 * clamp((v - .8) / .5, .05, 1), 16, 0x39ff88).setOrigin(0, .5));
      });
      const L = add(txt(this, 60, 640, '<', 90, '#fff')).setInteractive({ useHandCursor: true }); L.on('pointerup', () => { this.view = this.view <= 1 ? CARS.length : this.view - 1; this.draw(); });
      const R = add(txt(this, W - 60, 640, '>', 90, '#fff')).setInteractive({ useHandCursor: true }); R.on('pointerup', () => { this.view = this.view >= CARS.length ? 1 : this.view + 1; this.draw(); });
      const b = button(this, W / 2, 1035, 520, 90, '', 0x6a45f0, () => {
        if (owned) { save.car = c.id; persist(); this.say('Equipped ' + c.name, '#39ff88'); this.draw(); }
        else if (this.buy(c.price)) { save.cars.push(c.id); save.car = c.id; persist(); this.say('Bought ' + c.name + '!', '#39ff88'); this.draw(); }
      }, '#ffffff');
      b.set(equipped ? 'EQUIPPED' : owned ? 'EQUIP' : 'BUY  ' + c.price + ' MILK', equipped ? 0x3a8a60 : owned ? 0x6a45f0 : 0xffb02e);
      if (!owned) b.t.setColor('#07040f'); [b.r, b.t].forEach(add);
    } else {
      const list = this.tab === 'boosts' ? BOOSTS : UPGRADES;
      list.forEach((it, i) => {
        const y = 330 + i * 190;
        const have = this.tab === 'boosts' ? save.inv[it.id] : save.up[it.id];
        const card = add(this.add.rectangle(W / 2, y, 640, 160, 0x24106a, .92).setStrokeStyle(4, 0xb7a4ff, .5));
        add(txt(this, 70, y - 38, it.name, 38, '#fff', { ox: 0 })); add(txt(this, 70, y + 8, it.blurb, 21, '#c9bcff', { ox: 0, stroke: '#000', strokeThickness: 0, wordWrap: { width: 360 } }));
        add(txt(this, 70, y + 52, this.tab === 'boosts' ? 'OWNED  ' + have : 'LEVEL  ' + have + ' / ' + it.max, 24, '#39ff88', { ox: 0 }));
        const maxed = this.tab === 'upgrades' && have >= it.max;
        const price = this.tab === 'boosts' ? it.price : it.prices[Math.min(have, it.max - 1)];
        const b = button(this, 560, y, 190, 90, maxed ? 'MAX' : String(price), maxed ? 0x3a8a60 : 0xffb02e, () => {
          if (maxed) return;
          if (!this.buy(price)) return;
          if (this.tab === 'boosts') save.inv[it.id]++; else save.up[it.id]++;
          persist(); this.say(it.name + (this.tab === 'boosts' ? ' added' : ' upgraded'), '#39ff88'); this.draw();
        }); [b.r, b.t].forEach(add);
      });
      add(txt(this, W / 2, 940, 'Earn milk by racing. Collect bottles, dodge red candles.', 24, '#9a8cd8', { stroke: '#000', strokeThickness: 0 }));
    }
  }
}

// ---------- race ----------
class Race extends Phaser.Scene {
  constructor() { super('race'); }
  init(data = {}) {
    this.raceSeed = data.seed != null ? data.seed >>> 0 : null;
    this.autopilot = !!data.autopilot;
    this.skipPersist = !!data.skipPersist;
    this.syncSim = !!data.syncSim;
    this.fixedStep = (this.autopilot && this.raceSeed != null) || this.syncSim;
    this.stepAcc = 0;
    this.autoSteer = 0;
    this.zapCount = 0;
    this.spillCount = 0;
  }
  create() {
    this.car = carById(save.car); this.mk = (n) => this.textures.exists(n);
    if (this.raceSeed != null) {
      this.rng = mulberry32(this.raceSeed);
      seedTrack(this.car.id, () => this.rng());
    } else {
      this.rng = null;
      seedTrack(this.car.id);
    }
    this.sky = this.add.image(W / 2, 0, 'sky').setOrigin(.5, 0).setDisplaySize(W * 1.9, HY + 60).setDepth(0);
    this.gfx = this.add.graphics().setDepth(1); this.pool = [];
    this.zapBolts = [];
    this.zapMuzzleGfx = this.add.graphics().setDepth(925);
    this.zapSprPool = [];
    for (let zi = 0; zi < 4; zi++) {
      const spr = this.add.image(0, 0, 'candleG').setOrigin(0.5, 1).setDepth(920).setVisible(false);
      this.zapSprPool.push(spr);
    }
    this.zapTrail = this.add.particles(0, 0, 'coin', {
      speed: { min: 15, max: 90 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 180, max: 320 },
      scale: { start: 0.22, end: 0 },
      alpha: { start: 0.85, end: 0 },
      tint: 0x39ff88,
      emitting: false,
    }).setDepth(919);
    this.zapImpactFx = this.add.particles(0, 0, 'coin', {
      speed: { min: 120, max: 480 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 280, max: 520 },
      scale: { start: 0.45, end: 0 },
      tint: [0x39ff88, 0xffffff, 0xbfffe0],
      emitting: false,
    }).setDepth(921);
    this.rivalBoom = this.add.particles(0, 0, 'coin', {
      speed: { min: 90, max: 520 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 320, max: 560 },
      scale: { start: 0.5, end: 0 },
      tint: [0xff6d8a, 0xffb02e, 0xffffff],
      emitting: false,
    }).setDepth(924);
    this.milkPop = this.add.particles(0, 0, 'coin', {
      speed: { min: 50, max: 220 },
      angle: { min: 230, max: 310 },
      lifespan: 480,
      scale: { start: 0.35, end: 0 },
      tint: [0xffffff, 0xd9ccff],
      gravityY: 280,
      emitting: false,
    }).setDepth(801);
    this.nitroFx = this.add.particles(0, 0, 'coin', {
      speed: { min: 50, max: 240 },
      angle: { min: 235, max: 305 },
      lifespan: { min: 280, max: 420 },
      scale: { start: 0.4, end: 0 },
      tint: [0x39ff88, 0xffffaa],
      emitting: false,
    }).setDepth(588);
    this.fxGfx = this.add.graphics().setDepth(585);
    this.shieldGfx = this.add.graphics().setDepth(595);
    this.recoilY = 0;
    this.kartSpr = this.add.image(W / 2, 1010, `car${this.car.id}_3`).setOrigin(.5, 1).setDepth(590);
    this.kartSpr.setDisplaySize(420, 420 * this.kartSpr.height / this.kartSpr.width);
    this.spark = this.add.particles(0, 0, 'coin', { speed: { min: 80, max: 380 }, angle: { min: 215, max: 325 }, lifespan: 700, scale: { start: .4, end: 0 }, gravityY: 500, emitting: false }).setDepth(800);
    const f = (size, color = '#fff') => ({ fontFamily: FONT, fontSize: size, color, stroke: '#1b0a52', strokeThickness: 8 });
    this.add.image(48, 62, 'milk').setDisplaySize(36, 100).setDepth(950);
    this.milkTxt = this.add.text(100, 28, '0', f(64)).setDepth(950);
    this.timeTxt = this.add.text(W - 36, 30, '60', f(64, '#39ff88')).setOrigin(1, 0).setDepth(950);
    this.msg = this.add.text(W / 2, 330, '', f(58, '#ffd75e')).setOrigin(.5).setDepth(960).setAlpha(0);
    this.speedBar = this.add.graphics().setDepth(950);
    this.input.addPointer(3);
    this.keys = this.input.keyboard.addKeys({ l: 'LEFT', r: 'RIGHT', a: 'A', d: 'D', f: 'SPACE', n: 'N' });
    this.touch = { l: false, r: false };
    const btn = (x, y, label, onDown, onUp, big) => {
      const r = big ? 84 : 62; const c = this.add.circle(x, y, r, 0x6a45f0, .4).setStrokeStyle(4, 0xd9ccff, .6).setDepth(950).setInteractive();
      this.add.text(x, y, label, { fontFamily: FONT, fontSize: label.length > 2 ? 30 : 48, color: '#fff' }).setOrigin(.5).setDepth(951);
      c.on('pointerdown', () => { c.setFillStyle(0x39ff88, .5); onDown(); }); const up = () => { c.setFillStyle(0x6a45f0, .4); onUp && onUp(); }; c.on('pointerup', up); c.on('pointerout', up); c.on('pointerupoutside', up);
    };
    btn(95, 1195, '<', () => (this.touch.l = true), () => (this.touch.l = false)); btn(255, 1195, '>', () => (this.touch.r = true), () => (this.touch.r = false));
    btn(615, 1185, 'ZAP', () => this.zap(), null, true);
    if (save.inv.nitro > 0) { this.nitroBtn = true; btn(455, 1100, 'NITRO', () => this.nitro()); }
    this.input.keyboard.on('keydown-SPACE', () => this.zap()); this.input.keyboard.on('keydown-N', () => this.nitro());
    this.reset();
    if (this.syncSim) {
      let guard = 0;
      while (!this.over && guard < 5000) {
        this.simulationStep(FIXED_RACE_DT);
        this.updateZapBolts(FIXED_RACE_DT);
        guard++;
      }
    }
  }
  reset() {
    Object.assign(this, { pos: 0, speed: 0, px: 0, milkN: 0, t: RACE_SECS, boost: 0, stun: 0, over: false, shield: 0, magnet: 0, skyOff: 0, cool: 0, combo: 0, comboT: 0, lean: 0, recoilY: 0 });
    this.zapBolts = [];
    this.zapSprPool.forEach((s) => s.setVisible(false));
    this.fxGfx.clear();
    this.shieldGfx.clear();
    this.raceNitro = save.inv.nitro;
    if (this.skipPersist) {
      if (save.inv.shield > 0) this.shield = 1;
      if (save.inv.magnet > 0) this.magnet = 12;
    } else {
      if (save.inv.shield > 0) { save.inv.shield--; this.shield = 1; }
      if (save.inv.magnet > 0) { save.inv.magnet--; this.magnet = 12; }
      persist();
    }
    this.milkTxt.setText('0');
    if (this.shield) this.flash('SHIELD ON', '#7dffb0'); else if (this.magnet) this.flash('MAGNET ON', '#7dffb0');
  }
  nitroLeft() { return this.skipPersist ? this.raceNitro : save.inv.nitro; }
  flash(text, color) {
    this.msg.setText(text).setColor(color || '#ffd75e').setAlpha(1).setScale(1);
    const pop = 1.25;
    const rawW = this.msg.width;
    const popScale = rawW * pop > MSG_MAX_W ? (MSG_MAX_W / rawW) : pop;
    const endScale = rawW > MSG_MAX_W ? MSG_MAX_W / rawW : 1;
    this.msg.setScale(popScale);
    this.tweens.killTweensOf(this.msg);
    this.tweens.add({ targets: this.msg, alpha: 0, scale: endScale, duration: 900, delay: 250 });
  }
  nitro() {
    if (this.over || this.nitroLeft() <= 0 || this.boost > 0.2) return;
    if (this.skipPersist) this.raceNitro--; else { save.inv.nitro--; persist(); }
    this.boost = 2.0; this.flash('NITRO!', '#39ff88');
    this.nitroFx.emitParticleAt(W / 2, 980, 14);
  }
  bumpMilkHud() {
    this.tweens.killTweensOf(this.milkTxt);
    this.milkTxt.setScale(1);
    this.tweens.add({ targets: this.milkTxt, scale: 1.28, duration: 100, yoyo: true, ease: 'Quad.out' });
  }
  zapRecoil() {
    this.recoilY = 20;
    this.tweens.killTweensOf(this);
    this.tweens.add({ targets: this, recoilY: 0, duration: 240, ease: 'Quad.out' });
  }
  seg(z) { return segs[idxOf(z)]; }
  zapOrigin() { return { sx: W / 2 + 44, sy: 868 }; }
  zapAim() {
    const { sx, sy } = this.zapOrigin();
    let best = null;
    for (const r of rivals) {
      let d = r.z - (this.pos + PLAYER_Z);
      if (d < 0) d += LEN;
      if (d > 400 && d < SEG * 40 && Math.abs(r.x - this.px) < .42 && (!best || d < best.d)) best = { r, d };
    }
    let ex = sx;
    let ey = HY + 100;
    const aimAt = (laneX, dist, yOff) => {
      const sc = CAM_D / Math.max(dist, 200);
      ex = W / 2 + (laneX - this.px) * sc * ROAD * W / 2;
      ey = HY + sc * CAM_H * H / 2 * .62 + yOff;
    };
    if (best) aimAt(best.r.x, best.d, -60);
    else {
      const side = this.rng ? (this.rng() < .5 ? -.15 : .15) : (Math.random() < .5 ? -.15 : .15);
      aimAt(this.px + side, 2200, -20);
    }
    return { sx, sy, ex, ey, best };
  }
  relZ(z) {
    const pz = this.pos + PLAYER_Z;
    let d = z - pz;
    if (d < -LEN / 2) d += LEN;
    if (d > LEN / 2) d -= LEN;
    return d;
  }
  autopilotThink() {
    const A = AUTOPILOT;
    let targetX = -this.px * A.LANE_CENTER_PULL;
    let bestM = null;
    for (const m of milk) {
      if (m.taken) continue;
      const d = this.relZ(m.z);
      if (d < 120 || d > A.LOOK_AHEAD_Z) continue;
      if (!bestM || d < bestM.d) bestM = { d, x: m.x };
    }
    if (bestM) targetX = bestM.x;
    for (const h of hazards) {
      if (h.hit) continue;
      const d = this.relZ(h.z);
      if (d < 80 || d > A.HAZARD_AVOID_Z) continue;
      if (Math.abs(h.x - this.px) < A.HAZARD_LANE_X + 0.15) {
        targetX = clamp(this.px + (this.px >= h.x ? 0.55 : -0.55), -0.85, 0.85);
      }
    }
    const dx = targetX - this.px;
    if (Math.abs(dx) < A.STEER_DEADZONE) this.autoSteer = 0;
    else if (Math.abs(dx) >= A.STEER_FULL) this.autoSteer = dx > 0 ? 1 : -1;
    else this.autoSteer = dx / A.STEER_FULL;
    if (this.cool <= 0) {
      for (const r of rivals) {
        let d = r.z - (this.pos + PLAYER_Z);
        if (d < 0) d += LEN;
        if (d > A.ZAP_MIN_Z && d < A.ZAP_MAX_Z && Math.abs(r.x - this.px) < A.ZAP_RIVAL_X) {
          this.zap();
          break;
        }
      }
    }
    if (this.nitroLeft() > 0 && this.boost <= 0.2 && this.t >= A.NITRO_MIN_T) {
      let clear = true;
      for (const h of hazards) {
        if (h.hit) continue;
        const d = this.relZ(h.z);
        if (d > 0 && d < A.NITRO_CLEAR_Z && Math.abs(h.x - this.px) < A.NITRO_LANE_X) clear = false;
      }
      if (clear) this.nitro();
    }
  }
  muzzleFlash(x, y) {
    const g = this.zapMuzzleGfx;
    g.clear().fillStyle(0xffffff, 0.95).fillCircle(x, y, 32).fillStyle(0x39ff88, 0.75).fillCircle(x, y, 20);
    g.setAlpha(1);
    this.tweens.killTweensOf(g);
    this.tweens.add({ targets: g, alpha: 0, duration: 140, onComplete: () => { g.clear(); g.setAlpha(1); } });
  }
  resolveZapHit(best, ex, ey) {
    this.zapImpactFx.emitParticleAt(ex, ey, 14);
    const ring = this.add.circle(ex, ey, 8, 0x39ff88, 0.85).setDepth(923);
    this.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 220, onComplete: () => ring.destroy() });
    if (best) {
      const r = best.r;
      r.stun = 1.4;
      r.v *= .6;
      r.spin = 2.6;
      this.rivalBoom.emitParticleAt(ex, ey, 16);
      const jx = () => (this.rng ? (this.rng() * 2 - 1) * 0.4 : rnd(-.4, .4));
      for (let i = 0; i < 3; i++) milk.push({ z: r.z + (i + 1) * 380, x: clamp(r.x + jx(), -.9, .9), taken: false, fresh: true });
      this.flash('ZAPPED!  +MILK DROP', '#39ff88');
      this.cameras.main.shake(120, .006);
    }
  }
  updateZapBolts(dt) {
    for (let i = this.zapBolts.length - 1; i >= 0; i--) {
      const b = this.zapBolts[i];
      b.t += dt / b.dur;
      const p = clamp(b.t, 0, 1);
      const ep = p * p * (3 - 2 * p);
      const x = b.sx + (b.ex - b.sx) * ep;
      const y = b.sy + (b.ey - b.sy) * ep;
      const ang = Phaser.Math.RadToDeg(Math.atan2(b.ey - b.sy, b.ex - b.sx)) + 90;
      b.spr.setVisible(true).setPosition(x, y).setDisplaySize(36 + ep * 28, 52 + ep * 36).setAngle(ang).setTint(0xffffff);
      if (p < 1 && Math.random() < 0.55) this.zapTrail.emitParticleAt(x, y, 1);
      if (p >= 1 && !b.resolved) {
        b.resolved = true;
        b.spr.setVisible(false);
        this.resolveZapHit(b.best, b.ex, b.ey);
        this.zapBolts.splice(i, 1);
      }
    }
  }
  zap() {
    const cd = [.34, .28, .23, .18][save.up.zap];
    if (this.over || this.cool > 0) return;
    this.zapCount++;
    this.cool = cd;
    const aim = this.zapAim();
    const spr = this.zapSprPool.find((s) => !s.visible) || this.zapSprPool[0];
    this.zapBolts.push({ ...aim, t: 0, dur: 0.26, spr, resolved: false });
    this.muzzleFlash(aim.sx, aim.sy);
    this.zapRecoil();
  }
  simulationStep(dt) {
    const c = this.car;
    const topSpeed = MAX_SPEED * c.speed * (1 + save.up.engine * .04), accel = ACCEL * c.accel, steerK = 2.1 * c.grip * (1 + save.up.tires * .1);
    if (this.over) return;
    this.t -= dt; this.cool -= dt; this.comboT -= dt; this.magnet -= dt; if (this.comboT <= 0) this.combo = 0;
    if (this.autopilot) this.autopilotThink();
    const left = this.autopilot ? this.autoSteer < -0.15 : (this.keys.l.isDown || this.keys.a.isDown || this.touch.l);
    const right = this.autopilot ? this.autoSteer > 0.15 : (this.keys.r.isDown || this.keys.d.isDown || this.touch.r);
    if (!this.autopilot && this.keys.f.isDown && this.cool <= 0) this.zap();
    const steer = this.autopilot ? clamp(this.autoSteer, -1, 1) : (right ? 1 : 0) - (left ? 1 : 0);
    this.lean += (steer - this.lean) * Math.min(1, dt * 10);
    const target = this.boost > 0 ? topSpeed * 1.6 : (Math.abs(this.px) > 1.02 ? OFFROAD_MAX : topSpeed) * (this.stun > 0 ? .35 : 1);
    this.speed += (this.speed < target ? accel : -BRAKE_OFF) * dt; this.speed = clamp(this.speed, 0, BOOST_SPEED * 1.2);
    if (this.speed > target && this.boost <= 0) this.speed = Math.max(target, this.speed - BRAKE_OFF * dt);
    this.boost -= dt; this.stun -= dt;
    const sp = this.speed / MAX_SPEED, cur = this.seg(this.pos + PLAYER_Z).curve;
    this.px += steer * dt * steerK * sp - cur * dt * sp * .62; this.px = clamp(this.px, -2.2, 2.2);
    this.pos += this.speed * dt;
    if (this.pos >= LEN) { this.pos -= LEN; milk.forEach((m) => { if (!m.fresh) m.taken = false; }); hazards.forEach((h) => (h.hit = false)); boosts.forEach((b) => (b.taken = false)); milk = milk.filter((m) => !m.fresh); }
    this.collide();
    rivals.forEach((r) => {
      r.stun = Math.max(0, r.stun - dt);
      if (r.spin > 0) r.spin = Math.max(0, r.spin - dt * 2.2);
      const base = MAX_SPEED * .8;
      r.v += ((r.stun > 0 ? 0 : base * (.8 + .1 * Math.sin(r.phase))) - r.v) * Math.min(1, dt * 1.2);
      r.z = (r.z + r.v * dt * (r.stun > 0 ? .5 : 1)) % LEN;
      r.phase += dt * .7;
      r.x = clamp(r.x + Math.sin(r.phase * 1.7) * dt * .5, -.85, .85);
    });
    if (this.boost > 0 && this.speed > MAX_SPEED * 0.4) {
      const ky = 1010 - (this.recoilY || 0);
      const puff = this.rng ? this.rng() : Math.random();
      if (puff < 0.48) this.nitroFx.emitParticleAt(W / 2 - 18, ky - 36, 1);
    }
    if (this.t <= 0) { this.t = 0; this.over = true; this.speed = 0; this.finish(); }
  }
  update(_, dtms) {
    let dt = Math.min(dtms, 50) / 1000;
    if (this.fixedStep) {
      this.stepAcc += dt;
      const cap = 12;
      let n = 0;
      while (this.stepAcc >= FIXED_RACE_DT && n < cap) {
        this.stepAcc -= FIXED_RACE_DT;
        this.simulationStep(FIXED_RACE_DT);
        this.updateZapBolts(FIXED_RACE_DT);
        n++;
      }
      dt = FIXED_RACE_DT * n;
    } else {
      this.simulationStep(dt);
      this.updateZapBolts(dt);
    }
    if (!dt) dt = FIXED_RACE_DT;
    this.skyOff -= this.seg(this.pos + PLAYER_Z).curve * dt * (this.speed / MAX_SPEED) * 90; this.sky.x = W / 2 + clamp(this.skyOff, -120, 120);
    this.render();
    this.milkTxt.setText(String(this.milkN)); this.timeTxt.setText(String(Math.ceil(this.t))).setColor(this.t < 10 ? '#ff4d6d' : '#39ff88');
    this.speedBar.clear().fillStyle(0xffffff, .2).fillRoundedRect(W / 2 - 150, 100, 300, 14, 7).fillStyle(this.boost > 0 ? 0x39ff88 : 0xc9bcff, .95).fillRoundedRect(W / 2 - 150, 100, 300 * clamp(this.speed / (BOOST_SPEED * 1.2), 0, 1), 14, 7);
  }
  collide() {
    const rel = (z) => { const pz = this.pos + PLAYER_Z; let d = z - pz; if (d < -LEN / 2) d += LEN; if (d > LEN / 2) d -= LEN; return d; };
    const mw = this.magnet > 0 ? .75 : .3;
    for (const m of milk) if (!m.taken) {
      const d = rel(m.z);
      if (Math.abs(d) < (this.magnet > 0 ? 700 : 360) && Math.abs(m.x - this.px) < mw) {
        m.taken = true; this.combo++; this.comboT = 1.6; this.milkN += this.combo >= 5 ? 2 : 1;
        const px = W / 2 + (m.x - this.px) * 160;
        this.spark.emitParticleAt(px, 800, 3);
        this.milkPop.emitParticleAt(px, 780, 4);
        this.bumpMilkHud();
        if (this.combo === 5) this.flash('COMBO x2!', '#ffd75e');
      }
    }
    const spillR = () => (this.rng ? this.rng() * 1 - 0.5 : Math.random() - 0.5);
    for (const h of hazards) if (!h.hit) { const d = rel(h.z); if (Math.abs(d) < 320 && Math.abs(h.x - this.px) < .26) { h.hit = true; this.combo = 0; if (this.shield > 0) { this.shield = 0; this.milkPop.emitParticleAt(W / 2, 900, 8); this.cameras.main.shake(100, .008); this.flash('SHIELD BLOCKED IT', '#7dffb0'); continue; } const lose = Math.min(this.milkN, 4); this.milkN -= lose; this.spillCount++; this.stun = .7; this.speed *= .45; this.cameras.main.shake(200, .014); this.flash('SPILLED -' + lose, '#ff4d6d'); for (let i = 0; i < lose; i++) milk.push({ z: this.pos + PLAYER_Z + 900 + i * 420, x: clamp(this.px + spillR() * .5, -.9, .9), taken: false, fresh: true }); } }
    for (const bo of boosts) if (!bo.taken) { const d = rel(bo.z); if (Math.abs(d) < 360 && Math.abs(bo.x - this.px) < .3) { bo.taken = true; this.boost = 1.8; this.flash('BOOST!', '#39ff88'); } }
  }
  raceResult() {
    return {
      seed: this.raceSeed,
      autopilot: this.autopilot,
      milk: this.milkN,
      pos: Math.floor(this.pos),
      zaps: this.zapCount,
      spills: this.spillCount,
      car: this.car.id,
    };
  }
  finish() {
    const result = this.raceResult();
    window.MunchyKart.lastRaceResult = result;
    if (!this.skipPersist) {
      save.milk += this.milkN; save.races++; const newBest = this.milkN > save.best; if (newBest) save.best = this.milkN; persist();
    }
    if (window.MunchyKart && window.MunchyKart.onFinish) window.MunchyKart.onFinish(result);
    this.add.rectangle(W / 2, H / 2, W, H, 0x07040f, .75).setDepth(1000);
    const z = (y, s, size, color) => txt(this, W / 2, y, s, size, color).setDepth(1001);
    const newBest = !this.skipPersist && this.milkN > save.best;
    z(300, 'FINISH!', 100, '#39ff88'); z(440, '+' + this.milkN + ' MILK', 84, '#ffffff');
    if (!this.skipPersist) { z(560, 'WALLET  ' + save.milk, 44, '#ffd75e'); z(630, newBest ? 'NEW BEST!' : 'BEST  ' + save.best, 40, newBest ? '#39ff88' : '#d9ccff'); }
    const again = () => this.scene.restart({ seed: (Math.random() * 1e9 | 0) >>> 0, autopilot: true, skipPersist: this.skipPersist });
    const b1 = button(this, W / 2, 780, 520, 120, 'RACE AGAIN', 0x39ff88, again); const b2 = button(this, W / 2, 930, 520, 110, 'GARAGE', 0x6a45f0, () => this.scene.start('garage'), '#ffffff');
    [b1.r, b1.t, b2.r, b2.t].forEach((o) => o.setDepth(1002));
  }
  proj(z, x, camX) { const sc = CAM_D / z; return { sc, x: W / 2 + sc * (x - camX) * W / 2, y: HY + sc * CAM_H * H / 2 * .62, w: sc * ROAD * W / 2 }; }
  render() {
    const g = this.gfx; g.clear(); g.fillStyle(0x1c0f4a, 1).fillRect(0, HY - 2, W, H - HY + 2);
    const base = Math.floor(this.pos / SEG), off = (this.pos % SEG) / SEG, camX = this.px * ROAD;
    let dx = -(segs[base % TRACK_SEGS].curve * off), x = 0; const pts = [];
    for (let n = 0; n < DRAW; n++) { const s = segs[(base + n) % TRACK_SEGS]; const zc = (base + n) * SEG - this.pos + 1; const a = this.proj(Math.max(zc, 1), 0, camX - x), b = this.proj(zc + SEG, 0, camX - x - dx); pts.push({ s, a, b, n }); x += dx; dx += s.curve; }
    for (let n = DRAW - 1; n >= 0; n--) {
      const { a, b } = pts[n]; if (b.y >= a.y) continue; const lit = Math.floor((base + n) / 3) % 2;
      g.fillStyle(lit ? 0x2a1766 : 0x24135a, 1).fillRect(0, b.y, W, a.y - b.y + 1);
      const poly = (c, ax, aw, bx, bw) => { g.fillStyle(c, 1); g.fillPoints([{ x: ax - aw, y: a.y }, { x: ax + aw, y: a.y }, { x: bx + bw, y: b.y }, { x: bx - bw, y: b.y }], true); };
      poly(lit ? 0x8a6cff : 0xe8e0ff, a.x, a.w * 1.13, b.x, b.w * 1.13); poly(lit ? 0x3a3457 : 0x353050, a.x, a.w, b.x, b.w);
      if (lit) for (let l = 1; l < LANES; l++) { const o = (l / LANES * 2 - 1); poly(0xc8c0ff, a.x + a.w * o, a.w * .018, b.x + b.w * o, b.w * .018); }
    }
    let pi = 0; const use = (key) => { let im = this.pool[pi]; if (!im) { im = this.add.image(0, 0, key).setOrigin(.5, 1); this.pool[pi] = im; } im.setTexture(key).setVisible(true); pi++; return im; };
    const list = [];
    decor.forEach((d) => list.push({ k: d.kind, seg: idxOf(d.z), w: 130 * d.s, x: d.x }));
    milk.forEach((m) => !m.taken && list.push({ k: 'milk', seg: idxOf(m.z), w: 250, x: m.x }));
    hazards.forEach((h) => !h.hit && list.push({ k: 'candleR', seg: idxOf(h.z), w: 150, x: h.x }));
    boosts.forEach((b) => !b.taken && list.push({ k: 'candleG', seg: idxOf(b.z), w: 190, x: b.x }));
    rivals.forEach((r) => list.push({
      k: `car${r.car}_3`, seg: idxOf(r.z), w: 560, x: r.x,
      alpha: r.stun > 0 && Math.floor(this.t * 14) % 2 ? .4 : 1,
      ang: (r.spin || 0) * 38,
    }));
    for (const it of list) for (let n = DRAW - 1; n >= 1; n--) {
      const p = pts[n]; if (it.seg !== (base + n) % TRACK_SEGS) continue; const sc = p.a.sc; const tex = this.textures.get(it.k).getSourceImage();
      const w = sc * it.w * W / 2, h = w * tex.height / tex.width; if (w < 3) continue;
      const im = use(it.k);
      im.setPosition(p.a.x + sc * it.x * ROAD * W / 2, p.a.y + h * .06).setDisplaySize(w, h).setDepth(10 + (DRAW - n)).setAlpha(it.alpha == null ? 1 : it.alpha);
      im.setAngle(it.ang || 0);
    }
    for (let i = pi; i < this.pool.length; i++) this.pool[i].setVisible(false);
    const bob = Math.sin(this.pos / 700) * 3 + (this.stun > 0 ? Math.sin(this.t * 60) * 6 : 0);
    const kx = W / 2 + this.lean * 14;
    const ky = 1010 + bob - (this.recoilY || 0);
    this.fxGfx.clear();
    if (this.speed > MAX_SPEED * 0.5 && !this.over) {
      const lines = clamp(Math.floor(this.speed / MAX_SPEED * 10), 4, 12);
      for (let li = 0; li < lines; li++) {
        const lx = kx + (Math.random() - 0.5) * 280;
        const ly = 720 + Math.random() * 280;
        this.fxGfx.lineStyle(2, 0xffffff, 0.06 + Math.random() * 0.1);
        this.fxGfx.lineBetween(lx, ly, lx + (Math.random() - 0.5) * 16, ly + 48 + Math.random() * 80);
      }
    }
    this.shieldGfx.clear();
    if (this.shield > 0) {
      const pulse = 0.5 + Math.sin(this.t * 9) * 0.12;
      this.shieldGfx.lineStyle(5, 0x7dffb0, pulse);
      this.shieldGfx.strokeCircle(kx, ky - 115, 125);
      this.shieldGfx.fillStyle(0x7dffb0, 0.07);
      this.shieldGfx.fillCircle(kx, ky - 115, 125);
    }
    const k = clamp(Math.round(3 - this.lean * 3), 0, 6); // frames 0..6 run right-turn..left-turn, so lean +1 (steer right) must pick frame 0
    this.kartSpr.setTexture(`car${this.car.id}_${k}`).setPosition(kx, ky).setTint(this.boost > 0 ? 0xbfffe0 : 0xffffff);
  }
}

window.MunchyKart = window.MunchyKart || {};
const mkGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#07040f',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [Boot, Garage, Race],
});
window.MunchyKart.game = mkGame;
window.MunchyKart.AUTOPILOT = AUTOPILOT;
window.MunchyKart.runDeterministicAutopilot = (seed) => {
  const s = seed >>> 0;
  return new Promise((resolve) => {
    window.MunchyKart.onFinish = (r) => resolve(r);
    mkGame.scene.start('race', { seed: s, autopilot: true, skipPersist: true, syncSim: true });
  });
};
window.MunchyKart.startAutopilotRace = (seed, opts = {}) => new Promise((resolve) => {
  const s = seed >>> 0;
  window.MunchyKart.onFinish = (r) => resolve(r);
  mkGame.scene.start('race', { seed: s, autopilot: true, skipPersist: !!opts.skipPersist, syncSim: !!opts.syncSim });
});
const mkHost = document.getElementById('game');
const mkRefresh = () => {
  const sm = mkGame.scale;
  if (!sm || !sm.canvas) return;
  try { sm.refresh(); } catch (_) { /* scale not ready yet */ }
};
if (mkHost && typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => mkRefresh()).observe(mkHost);
}
window.addEventListener('orientationchange', mkRefresh);
mkGame.events.once('ready', () => { mkRefresh(); requestAnimationFrame(mkRefresh); });
window.addEventListener('error', (e) => { const el = document.getElementById('err'); if (el) { el.style.display = 'block'; el.textContent = e.message; } });
})();
