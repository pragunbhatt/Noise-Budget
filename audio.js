// Synthesized sound effects (Web Audio) — no asset files needed.
const SFX = (() => {
  let ac, master, muted = false, noiseBuf;
  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = muted ? 0 : .5; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    drone();
  }
  const ok = () => ac && ac.state === 'running';
  function env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(f, dur, { type = 'sine', vol = .3, slide = 0, delay = 0, attack = .005 } = {}) {
    if (!ok()) return; const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
    env(g, t, attack, vol, dur); o.connect(g).connect(master); o.start(t); o.stop(t + dur + .05);
  }
  function noise(dur, { vol = .3, freq = 1000, q = 1, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
    if (!ok()) return; const t = ac.currentTime + delay, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq + sweep), t + dur);
    env(g, t, .003, vol, dur); s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + dur + .05);
  }
  function drone() {                      // quiet ambient hum
    const g = ac.createGain(); g.gain.value = .035; g.connect(master);
    [55, 82.5].forEach((f, i) => {
      const o = ac.createOscillator(), l = ac.createOscillator(), lg = ac.createGain();
      o.type = 'sawtooth'; o.frequency.value = f; l.frequency.value = .08 + i * .05; lg.gain.value = 6;
      l.connect(lg).connect(o.frequency); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      o.connect(lp).connect(g); o.start(); l.start();
    });
  }
  return {
    init,
    toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : .5; return muted; },
    step(sneak) { sneak ? noise(.06, { vol: .05, freq: 500, q: .8 }) : noise(.09, { vol: .2, freq: 260, q: 1.2 }); },
    throw() { noise(.18, { vol: .12, freq: 900, q: 2, sweep: 1500 }); },
    clink() { [1800, 2650, 3400].forEach((f, i) => tone(f, .35, { type: 'triangle', vol: .1 / (i + 1), delay: .22 })); noise(.08, { vol: .18, freq: 3000, delay: .22 }); },
    pickup() { [660, 880, 1320].forEach((f, i) => tone(f, .25, { type: 'sine', vol: .18, delay: i * .07 })); },
    investigate() { tone(520, .12, { type: 'square', vol: .06 }); tone(700, .16, { type: 'square', vol: .06, delay: .1 }); },
    alert() { tone(880, .5, { type: 'sawtooth', vol: .16, slide: -500 }); tone(110, .5, { type: 'square', vol: .12, slide: -40 }); noise(.3, { vol: .1, freq: 2000, sweep: -1500 }); },
    calm() { tone(440, .2, { vol: .08 }); tone(330, .3, { vol: .08, delay: .15 }); },
    heartbeat() { tone(60, .15, { vol: .35, slide: -20 }); tone(55, .15, { vol: .28, slide: -20, delay: .16 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .5, { type: 'triangle', vol: .2, delay: i * .12 })); },
    lose() { tone(200, .9, { type: 'sawtooth', vol: .25, slide: -170 }); noise(.7, { vol: .3, freq: 1200, sweep: -1000 }); tone(70, 1, { vol: .35, slide: -30 }); },
    empty() { tone(150, .1, { type: 'square', vol: .08 }); },
  };
})();
