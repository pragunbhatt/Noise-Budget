// NOISE BUDGET — stealth game. Rendering: pre-baked arena, dynamic lightmap, bloom.
const T = 40, W = 24, H = 16, VW = W * T, VH = H * T;
const cv = document.getElementById('c'), g = cv.getContext('2d');
const STATE = {
  patrol:['PATROL','#43e8ff'], investigate:['INVESTIGATING','#ffc14d'],
  chase:['ALERT · CHASING','#ff3d63'], search:['SEARCHING','#ff9a4d']
};
const SNEAK = { speed: 85, reach: 65 }, RUN = { speed: 175, reach: 200 };
let MAP, PATROL, SIGHT = 230, GSPD = 1;
const HALF_FOV = 0.55;

const $ = id => document.getElementById(id);
const hud = { level:$("hLevel"), data:$('hData'), dist:$('hDist'), mode:$('hMode'), guard:$('hGuard'), time:$('hTime') };
const over = $('over');

const wall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || MAP[y][x] === '#';
const wallAt = (x, y) => wall(Math.floor(x / T), Math.floor(y / T));
const tileOf = p => [Math.floor(p.x / T), Math.floor(p.y / T)];
const center = (x, y) => ({ x: x * T + T / 2, y: y * T + T / 2 });
const rnd = (a = 1) => (Math.random() - .5) * a;
const angDiff = (a, b) => ((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

function layer(w = VW, h = VH) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ---------- baked static arena ---------- */
const bake = layer();
function bakeArena() {
  const b = bake.getContext('2d');
  let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  b.fillStyle = '#070a15'; b.fillRect(0, 0, VW, VH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (wall(x, y)) continue;
    const gr = b.createLinearGradient(x*T, y*T, x*T+T, y*T+T);
    gr.addColorStop(0, (x+y)%2 ? '#121a33' : '#0f1630'); gr.addColorStop(1, '#0a1022');
    b.fillStyle = gr; b.fillRect(x*T, y*T, T, T);
    b.strokeStyle = 'rgba(80,130,255,.10)'; b.strokeRect(x*T+.5, y*T+.5, T-1, T-1);
    for (let i = 0; i < 5; i++) { b.fillStyle = `rgba(140,180,255,${r()*.06})`; b.fillRect(x*T+r()*T, y*T+r()*T, 2, 2); }
    b.fillStyle = 'rgba(80,140,255,.2)';                       // corner studs
    [[3,3],[T-5,3],[3,T-5],[T-5,T-5]].forEach(([a,c]) => b.fillRect(x*T+a, y*T+c, 2, 2));
  }
  // wall drop shadows
  b.save(); b.shadowColor = 'rgba(0,0,0,.9)'; b.shadowBlur = 18; b.shadowOffsetY = 8; b.fillStyle = '#000';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wall(x, y)) b.fillRect(x*T, y*T, T, T);
  b.restore();
  // wall bodies: raised block with bevel
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!wall(x, y)) continue;
    const gr = b.createLinearGradient(x*T, y*T, x*T, y*T+T);
    gr.addColorStop(0, '#2a3470'); gr.addColorStop(.5, '#1a2150'); gr.addColorStop(1, '#10163a');
    b.fillStyle = gr; b.fillRect(x*T, y*T, T, T);
    b.fillStyle = 'rgba(160,190,255,.14)'; b.fillRect(x*T, y*T, T, 2); b.fillRect(x*T, y*T, 2, T);
    b.fillStyle = 'rgba(0,0,0,.35)'; b.fillRect(x*T, y*T+T-3, T, 3);
    b.fillStyle = 'rgba(120,150,255,.08)'; b.fillRect(x*T+8, y*T+8, T-16, T-16);
  }
  // neon trim on wall edges that face floor
  b.save(); b.lineWidth = 2; b.strokeStyle = '#5b7cff'; b.shadowColor = '#5b7cff'; b.shadowBlur = 10; b.beginPath();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!wall(x, y)) continue; const X = x*T, Y = y*T;
    if (!wall(x, y-1)) { b.moveTo(X, Y); b.lineTo(X+T, Y); }
    if (!wall(x, y+1)) { b.moveTo(X, Y+T); b.lineTo(X+T, Y+T); }
    if (!wall(x-1, y)) { b.moveTo(X, Y); b.lineTo(X, Y+T); }
    if (!wall(x+1, y)) { b.moveTo(X+T, Y); b.lineTo(X+T, Y+T); }
  }
  b.stroke(); b.restore();
}

const lightmap = layer(), lm = lightmap.getContext('2d');
const bloom = layer(VW / 4, VH / 4), bl = bloom.getContext('2d');

/* ---------- state ---------- */
let P, G, items, exit, dist, ripples, parts, trail, t, ended, won, time, shake, flash;
let stepT = 0, beatT = 0, prevState = 'patrol';
let mouse = { x: 0, y: 0 }, keys = {};

/* ---------- levels, progress, menu ---------- */
let save = { unlocked: 1, best: [] };
try { Object.assign(save, JSON.parse(localStorage.nbSave || '{}')); } catch (e) {}
const persist = () => { try { localStorage.nbSave = JSON.stringify(save); } catch (e) {} };
let cur = 0, inMenu = true;
const menuEl = $('menu'), grid = $('grid');
function startLevel(i) {
  cur = i; const L = LEVELS[i];
  MAP = L.map; PATROL = L.patrol; SIGHT = L.sight; GSPD = L.speed;
  bakeArena(); reset(); inMenu = false; menuEl.classList.add('hidden');
  hud.level.textContent = `${i + 1} · ${L.name}`;
}
function saveWin() {
  const b = save.best[cur]; if (!b || time < b) save.best[cur] = time;
  save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, cur + 2)); persist();
}
function openMenu() { buildMenu(); inMenu = true; menuEl.classList.remove('hidden'); over.classList.add('hidden'); }
function thumb(L) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#0a1022'; x.fillRect(0, 0, 96, 64);
  const col = { '#': '#3a4cc0', C: '#4dffa0', E: '#ffffff', S: '#ff4fa3' };
  L.map.forEach((row, y) => [...row].forEach((ch, xx) => { if (col[ch]) { x.fillStyle = col[ch]; x.fillRect(xx * 4, y * 4, 4, 4); } }));
  return c;
}
function buildMenu() {
  grid.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const locked = i >= save.unlocked, b = document.createElement('button');
    b.className = 'card' + (locked ? ' locked' : '') + (save.best[i] ? ' done' : ''); b.disabled = locked;
    b.appendChild(thumb(L));
    b.insertAdjacentHTML('beforeend', `<span class="num">${String(i + 1).padStart(2, '0')}</span><strong>${L.name}</strong><small>${L.desc}</small><em>${locked ? '🔒 LOCKED' : save.best[i] ? '★ BEST ' + save.best[i].toFixed(1) + 's' : 'NEW'}</em>`);
    b.onclick = () => startLevel(i); grid.appendChild(b);
  });
}

function reset() {
  items = []; let s = { x: 1, y: 1 };
  MAP.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === 'C') items.push({ ...center(x, y), got: false });
    if (c === 'S') s = { x, y };
    if (c === 'E') exit = center(x, y);
  }));
  P = { ...center(s.x, s.y), r: 9, reach: 0, drawReach: 0, sneak: false, moving: false };
  const w0 = PATROL[0];
  G = { ...center(w0[0], w0[1]), a: 0, state: 'patrol', path: [], wp: 1, tgt: null, wait: 0, lost: 0, rt: 0 };
  dist = 3; ripples = []; parts = []; trail = []; t = 0; ended = false; won = false; time = 0; shake = 0; flash = 0;
  over.classList.add('hidden'); stepT = 0; beatT = 0; prevState = 'patrol';
}

/* ---------- physics & AI helpers ---------- */
function blocked(x, y, r) {
  return wallAt(x-r, y-r) || wallAt(x+r, y-r) || wallAt(x-r, y+r) || wallAt(x+r, y+r);
}
function move(o, dx, dy, r) {
  if (!blocked(o.x + dx, o.y, r)) o.x += dx;
  if (!blocked(o.x, o.y + dy, r)) o.y += dy;
}
function los(a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8);
  for (let i = 1; i < n; i++) if (wallAt(a.x + (b.x-a.x)*i/n, a.y + (b.y-a.y)*i/n)) return false;
  return true;
}
function findPath(s, e) {              // breadth-first search on the tile grid
  const k = (x, y) => y * W + x, prev = new Map([[k(...s), null]]), q = [s];
  while (q.length) {
    const [x, y] = q.shift(); if (x === e[0] && y === e[1]) break;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (wall(nx, ny) || prev.has(k(nx, ny))) continue;
      prev.set(k(nx, ny), [x, y]); q.push([nx, ny]);
    }
  }
  if (!prev.has(k(...e))) return [];
  const out = []; let c = e; while (c) { out.unshift(c); c = prev.get(k(...c)); }
  return out.slice(1).map(([x, y]) => center(x, y));
}
const routeTo = p => { G.path = findPath(tileOf(G), tileOf(p)); };
function burst(x, y, n, c, sp = 300) {
  for (let i = 0; i < n; i++) parts.push({ x, y, vx: rnd(sp), vy: rnd(sp), l: 1, c });
}
function throwDistraction() {
  if (ended || inMenu) return;
  if (dist <= 0) { SFX.empty(); return; }
  const dx = mouse.x - P.x, dy = mouse.y - P.y, d = Math.hypot(dx, dy) || 1;
  let m = Math.min(d, 240), x, y;
  do { x = P.x + dx/d*m; y = P.y + dy/d*m; m -= 8; } while (blocked(x, y, 3) && m > 10);
  if (blocked(x, y, 3)) return;
  dist--; SFX.throw(); SFX.clink();
  ripples.push({ x, y, r: 0, max: 300, col: '#ffc14d', life: 1, slow: true });
  ripples.push({ x, y, r: 0, max: 200, col: '#ffffff', life: .7, slow: true });
  burst(x, y, 26, '#ffc14d');
  if (Math.hypot(G.x - x, G.y - y) < 300 && G.state !== 'chase') {
    G.state = 'investigate'; G.tgt = { x, y }; G.wait = 0; routeTo(G.tgt);
  }
}

/* ---------- update ---------- */
function update(dt) {
  if (ended || inMenu) return;
  time += dt; t += dt;
  const ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  const iy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const len = Math.hypot(ix, iy); P.sneak = !!keys.shift; P.moving = len > 0;
  const mode = P.sneak ? SNEAK : RUN;
  if (len) move(P, ix/len*mode.speed*dt, iy/len*mode.speed*dt, P.r);
  P.reach = len ? mode.reach : 0;
  P.drawReach += (P.reach - P.drawReach) * Math.min(1, dt * 10);
  if (len) {
    stepT -= dt; if (stepT <= 0) { SFX.step(P.sneak); stepT = P.sneak ? .5 : .26; }
    trail.push({ x: P.x, y: P.y, l: 1, c: P.sneak ? '#43e8ff' : '#ff4fa3' });
    if (!P.sneak && Math.random() < .5) ripples.push({ x: P.x, y: P.y, r: 4, max: 34, col: '#ff4fa3', life: .5 });
  }
  trail.forEach(q => q.l -= dt * 2.2); trail = trail.filter(q => q.l > 0);

  for (const it of items) if (!it.got && Math.hypot(it.x-P.x, it.y-P.y) < 20) {
    it.got = true; SFX.pickup(); burst(it.x, it.y, 40, '#4dffa0', 340); flash = .35;
    ripples.push({ x: it.x, y: it.y, r: 0, max: 120, col: '#4dffa0', life: 1 });
  }
  const left = items.filter(i => !i.got).length;
  if (!left && Math.hypot(exit.x-P.x, exit.y-P.y) < 22) {
    ended = won = true; saveWin();
    burst(P.x, P.y, 80, '#4dffa0', 500); SFX.win(); showEnd();
  }

  // guard senses
  const d = Math.hypot(P.x - G.x, P.y - G.y);
  const inCone = d < SIGHT && Math.abs(angDiff(Math.atan2(P.y-G.y, P.x-G.x), G.a)) < HALF_FOV;
  const sees = (inCone || d < 42) && los(G, P);
  if (sees) { G.state = 'chase'; G.lost = 0; }
  else if (G.state === 'chase') {
    G.lost += dt;
    if (G.lost > 2) { G.state = 'search'; G.tgt = { x: P.x, y: P.y }; routeTo(G.tgt); G.wait = 0; }
  } else if (P.reach > 0 && d < P.reach) {
    G.state = 'investigate'; G.tgt = { x: P.x, y: P.y }; G.wait = 0;
    if (t - G.rt > .5) { routeTo(G.tgt); G.rt = t; }
  }

  // guard movement
  let speed = 70, target = null;
  if (G.state === 'chase') { speed = 150; target = P; }
  else {
    if (G.path.length) target = G.path[0];
    else if (G.state === 'patrol') {
      const w = PATROL[G.wp]; routeTo(center(w[0], w[1])); G.wp = (G.wp + 1) % PATROL.length;
    } else {                                     // arrived: look around, then resume patrol
      G.wait += dt; G.a += dt * 2.2;
      if (G.wait > (G.state === 'search' ? 2.5 : 1.8)) {
        G.state = 'patrol'; G.wait = 0;
        let bi = 0, bd = 1e9;
        PATROL.forEach((w, i) => { const dd = Math.hypot(w[0]*T+20-G.x, w[1]*T+20-G.y); if (dd < bd) { bd = dd; bi = i; } });
        G.wp = bi;
      }
    }
    if (G.state !== 'patrol') speed = 105;
  }
  speed *= GSPD;
  if (target) {
    const dx = target.x - G.x, dy = target.y - G.y, dd = Math.hypot(dx, dy);
    if (dd < 4) { if (G.path[0] === target) G.path.shift(); }
    else {
      G.a += angDiff(Math.atan2(dy, dx), G.a) * Math.min(1, dt * 9);
      move(G, dx/dd*speed*dt, dy/dd*speed*dt, 9);
    }
  }
  if (G.state !== prevState) {                    // audio cues on guard state changes
    if (G.state === 'chase') SFX.alert();
    else if (G.state === 'investigate' && prevState !== 'chase') SFX.investigate();
    else if (G.state === 'patrol') SFX.calm();
    prevState = G.state;
  }
  if (G.state === 'chase') { beatT -= dt; if (beatT <= 0) { SFX.heartbeat(); beatT = .55; } }
  if (d < 20 && !ended) { ended = true; won = false; shake = 1; SFX.lose(); burst(P.x, P.y, 90, '#ff3d63', 500); showEnd(); }

  ripples.forEach(r => { r.r += (r.max - r.r) * dt * 3 + 30 * dt; r.life -= dt * (r.slow ? .55 : .9); });
  ripples = ripples.filter(r => r.life > 0);
  parts.forEach(p => { p.x += p.vx*dt; p.y += p.vy*dt; p.vx *= .97; p.vy *= .97; p.l -= dt*1.3; });
  parts = parts.filter(p => p.l > 0);
  shake = Math.max(0, shake - dt * 1.5); flash = Math.max(0, flash - dt);
}

function showEnd() {
  over.className = won ? 'win' : 'lose';
  const isLast = cur === LEVELS.length - 1;
  $('oTitle').textContent = won ? 'ESCAPED' : 'CAPTURED';
  $('oSub').textContent = won
    ? `Level ${cur + 1} cleared in ${time.toFixed(1)}s · distractions left ${dist}${isLast ? ' · ALL LEVELS COMPLETE' : ''}`
    : 'The guard caught you.';
  $('bNext').style.display = won && !isLast ? '' : 'none';
}

/* ---------- render ---------- */
function conePoly() {
  const pts = [[G.x, G.y]];
  for (let i = -12; i <= 12; i++) {
    const a = G.a + i * (HALF_FOV / 12); let r = 0;
    while (r < SIGHT && !wallAt(G.x + Math.cos(a)*r, G.y + Math.sin(a)*r)) r += 5;
    pts.push([G.x + Math.cos(a)*r, G.y + Math.sin(a)*r]);
  }
  return pts;
}
function tracePoly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); }
function radial(c, x, y, r, stops) {
  const gr = c.createRadialGradient(x, y, 0, x, y, r); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr;
}
function glowDot(x, y, r, col, a = 1) {
  g.globalAlpha = a; g.fillStyle = radial(g, x, y, r, [[0, col], [1, 'transparent']]); g.fillRect(x-r, y-r, r*2, r*2); g.globalAlpha = 1;
}

function draw() {
  const col = P.sneak ? '#43e8ff' : '#ff4fa3', gc = STATE[G.state][1], cone = conePoly();
  g.save();
  if (shake) g.translate(rnd(18) * shake, rnd(18) * shake);
  g.drawImage(bake, 0, 0);

  // exit portal
  const ready = !items.some(i => !i.got), pulse = .5 + .5 * Math.sin(t * 4);
  g.save(); g.translate(exit.x, exit.y);
  glowDot(0, 0, ready ? 50 + pulse*10 : 28, ready ? '#4dffa0' : '#6a7aa8', ready ? .8 : .25);
  g.strokeStyle = ready ? '#4dffa0' : '#56648f'; g.lineWidth = 2; g.shadowColor = g.strokeStyle; g.shadowBlur = ready ? 18 : 0;
  g.rotate(t * (ready ? 1.5 : .3)); g.strokeRect(-13, -13, 26, 26); g.rotate(-t * (ready ? 3 : .6)); g.strokeRect(-8, -8, 16, 16);
  g.restore();

  // guard vision cone
  tracePoly(g, cone);
  const cc = G.state === 'chase' ? '255,61,99' : '255,220,120';
  g.fillStyle = radial(g, G.x, G.y, SIGHT, [[0, `rgba(${cc},.55)`], [.7, `rgba(${cc},.14)`], [1, `rgba(${cc},0)`]]); g.fill();
  g.strokeStyle = `rgba(${cc},.35)`; g.lineWidth = 1; g.stroke();

  // guard route
  if (G.path.length && G.state !== 'patrol') {
    g.strokeStyle = 'rgba(255,193,77,.45)'; g.setLineDash([3, 7]); g.lineWidth = 2; g.beginPath(); g.moveTo(G.x, G.y);
    G.path.forEach(p => g.lineTo(p.x, p.y)); g.stroke(); g.setLineDash([]);
    const e = G.path[G.path.length - 1]; g.strokeStyle = '#ffc14d'; g.beginPath(); g.arc(e.x, e.y, 6 + pulse*2, 0, 7); g.stroke();
  }

  // noise ripples
  g.lineWidth = 2;
  ripples.forEach(r => { g.globalAlpha = Math.max(0, r.life) * .85; g.strokeStyle = r.col; g.shadowColor = r.col; g.shadowBlur = 12; g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke(); });
  g.globalAlpha = 1; g.shadowBlur = 0;

  // player noise reach (live) + max reach guide
  if (P.drawReach > 3) {
    g.fillStyle = radial(g, P.x, P.y, P.drawReach, [[0, col + '00'], [.8, col + '22'], [1, col + '66']]);
    g.beginPath(); g.arc(P.x, P.y, P.drawReach, 0, 7); g.fill();
    g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = 16; g.lineWidth = 2; g.stroke(); g.shadowBlur = 0;
  }
  g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 1; g.setLineDash([3, 6]); g.beginPath();
  g.arc(P.x, P.y, P.sneak ? SNEAK.reach : RUN.reach, 0, 7); g.stroke(); g.setLineDash([]);

  // collectibles
  items.forEach(it => {
    if (it.got) return;
    const b = Math.sin(t * 3 + it.x) * 3;
    glowDot(it.x, it.y, 36, '#4dffa0', .7);
    g.save(); g.translate(it.x, it.y + b); g.rotate(t * 2); g.shadowColor = '#4dffa0'; g.shadowBlur = 16;
    g.fillStyle = '#4dffa0'; g.beginPath(); g.moveTo(0, -9); g.lineTo(8, 0); g.lineTo(0, 9); g.lineTo(-8, 0); g.closePath(); g.fill();
    g.fillStyle = '#eafff3'; g.beginPath(); g.moveTo(0, -4); g.lineTo(3, 0); g.lineTo(0, 4); g.lineTo(-3, 0); g.closePath(); g.fill();
    g.restore();
  });

  // trail
  trail.forEach(q => { g.globalAlpha = q.l * .35; g.fillStyle = q.c; g.beginPath(); g.arc(q.x, q.y, 6 * q.l, 0, 7); g.fill(); });
  g.globalAlpha = 1;

  // guard body
  g.save(); g.translate(G.x, G.y);
  glowDot(0, 0, 34, gc, .6);
  g.rotate(G.a); g.shadowColor = gc; g.shadowBlur = 18; g.fillStyle = '#10142c'; g.strokeStyle = gc; g.lineWidth = 3;
  g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill(); g.stroke();
  g.fillStyle = gc; g.beginPath(); g.moveTo(15, 0); g.lineTo(5, -6); g.lineTo(5, 6); g.closePath(); g.fill();
  g.restore();
  if (G.state !== 'patrol') {
    g.font = "24px 'Bebas Neue', Impact, sans-serif"; g.textAlign = 'center'; g.fillStyle = gc; g.shadowColor = gc; g.shadowBlur = 10;
    g.fillText(G.state === 'chase' ? '!' : '?', G.x, G.y - 20 - Math.sin(t * 8) * 2); g.shadowBlur = 0;
  }

  // player
  g.save(); g.translate(P.x, P.y);
  glowDot(0, 0, 30, col, .55);
  g.shadowColor = col; g.shadowBlur = 20; g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, P.r, 0, 7); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
  g.restore();

  // particles
  g.shadowBlur = 0;
  parts.forEach(p => { g.globalAlpha = Math.max(0, p.l); g.fillStyle = p.c; g.fillRect(p.x, p.y, 3, 3); });
  g.globalAlpha = 1;

  // throw aim
  const ad = Math.hypot(mouse.x - P.x, mouse.y - P.y) || 1, am = Math.min(ad, 240);
  const ax = P.x + (mouse.x-P.x)/ad*am, ay = P.y + (mouse.y-P.y)/ad*am;
  if (dist > 0 && !ended) {
    g.strokeStyle = 'rgba(255,193,77,.5)'; g.lineWidth = 1; g.setLineDash([2, 5]); g.beginPath(); g.moveTo(P.x, P.y); g.lineTo(ax, ay); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.arc(ax, ay, 6, 0, 7); g.stroke();
  }

  // ---- darkness + lights ----
  lm.globalCompositeOperation = 'source-over'; lm.clearRect(0, 0, VW, VH);
  lm.fillStyle = 'rgba(2,4,12,.6)'; lm.fillRect(0, 0, VW, VH);
  lm.globalCompositeOperation = 'destination-out';
  const hole = (x, y, r, a = 1) => { lm.globalAlpha = a; lm.fillStyle = radial(lm, x, y, r, [[0, '#000'], [.5, 'rgba(0,0,0,.6)'], [1, 'transparent']]); lm.fillRect(x-r, y-r, r*2, r*2); };
  hole(P.x, P.y, 190); hole(G.x, G.y, 110);
  items.forEach(it => !it.got && hole(it.x, it.y, 70)); hole(exit.x, exit.y, ready ? 110 : 60);
  ripples.forEach(r => r.slow && hole(r.x, r.y, 120, r.life));
  lm.globalAlpha = 1; tracePoly(lm, cone);
  lm.fillStyle = radial(lm, G.x, G.y, SIGHT, [[0, 'rgba(0,0,0,.9)'], [1, 'rgba(0,0,0,.15)']]); lm.fill();
  g.drawImage(lightmap, 0, 0);

  // colored light wash
  g.globalCompositeOperation = 'lighter';
  glowDot(P.x, P.y, 160, col, .16); glowDot(G.x, G.y, 130, gc, .2);
  g.globalCompositeOperation = 'source-over';

  // bloom: blurred half-res copy added back
  bl.clearRect(0, 0, bloom.width, bloom.height);
  bl.filter = 'blur(5px) brightness(1.4)'; bl.drawImage(cv, 0, 0, bloom.width, bloom.height); bl.filter = 'none';
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = .6; g.drawImage(bloom, 0, 0, VW, VH);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';

  // vignette + pickup flash + chase tint
  g.fillStyle = radial(g, VW/2, VH/2, 640, [[.45, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.75)']]); g.fillRect(0, 0, VW, VH);
  if (flash) { g.fillStyle = `rgba(77,255,160,${flash * .25})`; g.fillRect(0, 0, VW, VH); }
  if (G.state === 'chase' && !ended) {
    g.fillStyle = radial(g, VW/2, VH/2, 560, [[.5, 'rgba(255,40,80,0)'], [1, `rgba(255,40,80,${.22 + .1*Math.sin(t*10)})`]]); g.fillRect(0, 0, VW, VH);
  }
  g.restore();
  updateHud();
}

function updateHud() {
  const set = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  set(hud.data, `${items.filter(i => i.got).length}/3`);
  set(hud.dist, '◆ '.repeat(dist) + '◇ '.repeat(3 - dist));
  set(hud.mode, !P.moving ? 'STILL · 0' : P.sneak ? `SNEAK · ${SNEAK.reach}` : `RUN · ${RUN.reach}`);
  hud.mode.style.color = !P.moving ? '#8a9ac8' : P.sneak ? '#43e8ff' : '#ff4fa3';
  set(hud.guard, STATE[G.state][0]); hud.guard.style.color = STATE[G.state][1];
  set(hud.time, time.toFixed(1) + 's' + (save.best[cur] ? `  ·  best ${save.best[cur].toFixed(1)}s` : ''));
}

/* ---------- input & loop ---------- */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); keys[k] = 1; SFX.init();
  if (k === 'm') SFX.toggle();
  if (k === ' ' || k === '1' || k === '2' || k === '3') { throwDistraction(); e.preventDefault(); }
  if (k === 'r' && !inMenu) reset();
  if (k === 'escape') openMenu();
  if (k === 'n' && ended && won && cur < LEVELS.length - 1) startLevel(cur + 1);
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = 0);
addEventListener('blur', () => keys = {});
cv.addEventListener('mousemove', e => {
  const b = cv.getBoundingClientRect(); mouse.x = (e.clientX - b.left) * VW / b.width; mouse.y = (e.clientY - b.top) * VH / b.height;
});
cv.addEventListener('mousedown', () => SFX.init());
cv.addEventListener('mousedown', () => { if (!inMenu && !ended) throwDistraction(); });
$('bRetry').onclick = () => reset();
$('bMenu').onclick = openMenu;
$('bNext').onclick = () => startLevel(cur + 1);
$('menuBtn').onclick = openMenu;

startLevel(0); openMenu();
let last = performance.now();
(function loop(n) {
  const dt = Math.min(.05, (n - last) / 1000); last = n;
  update(dt); draw(); requestAnimationFrame(loop);
})(last);
