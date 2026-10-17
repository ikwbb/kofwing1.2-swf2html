// Keyboard / mouse input, the AS2 Key / Stage / Sound objects, and the main loop.
'use strict';
(function () {
  const KOF = window.KOF;
  const B = KOF.B;

  // ---------------------------------------------------------------- Key
  const down = new Set();
  let lastCode = 0, lastAscii = 0;
  const keyListeners = [];
  const Key = {
    BACKSPACE: 8, CAPSLOCK: 20, CONTROL: 17, DELETEKEY: 46, DOWN: 40, END: 35, ENTER: 13, ESCAPE: 27, HOME: 36,
    INSERT: 45, LEFT: 37, PGDN: 34, PGUP: 33, RIGHT: 39, SHIFT: 16, SPACE: 32, TAB: 9, UP: 38, ALT: 18,
    isDown(c) { return down.has(Number(c)); },
    isToggled() { return false; },
    getCode() { return lastCode; },
    getAscii() { return lastAscii; },
    addListener(o) { if (o && keyListeners.indexOf(o) < 0) keyListeners.push(o); },
    removeListener(o) { const i = keyListeners.indexOf(o); if (i >= 0) { keyListeners.splice(i, 1); return true; } return false; },
    _listeners: keyListeners,
  };
  B.Key = Key;
  KOF.keysDown = down;

  function eachClip(fn) {
    const walk = (c) => { fn(c); for (const k of c.__d.children.slice()) if (k.__d.kind === 'clip') walk(k); };
    walk(KOF.root);
  }
  function clipKeyEvents(type, code) {
    eachClip((c) => {
      const ev = c.__d.clipEv;
      if (ev && ev[type]) for (const k of ev[type]) KOF.runCode(k, c, c);
      if (type === 'keyDown' && ev && ev.keyPress) {
        // keyPress events are stored as "keyPress:<code>"
      }
    });
  }
  function keyEvent(type, e) {
    let code = e.keyCode;
    if (code === 0) return;
    if (type === 'keyDown') { if (down.has(code) && false) return; down.add(code); lastCode = code; lastAscii = e.key && e.key.length === 1 ? e.key.charCodeAt(0) : 0; }
    else down.delete(code);
    if (!KOF.running) return;
    try {
      for (const l of keyListeners.slice()) {
        const f = l[type === 'keyDown' ? 'onKeyDown' : 'onKeyUp'];
        if (typeof f === 'function') f.call(l);
      }
      clipKeyEvents(type, code);
      KOF.buttonKey && type === 'keyDown' && KOF.buttonKey(code);
    } catch (err) { KOF.reportError(err, 'key'); }
    KOF.drain();
  }
  const GAME_KEYS = new Set([32, 37, 38, 39, 40, 9, 13]);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    if (GAME_KEYS.has(e.keyCode) || (e.keyCode >= 48 && e.keyCode <= 90) || (e.keyCode >= 96 && e.keyCode <= 111) || e.keyCode >= 186) e.preventDefault();
    queueKey('keyDown', e);
  });
  window.addEventListener('keyup', (e) => queueKey('keyUp', e));
  // The fighters' command reader drops a direction pressed within 10 ms of the previous one,
  // so keys pressed together (S+D for a diagonal) are handed to the game at least 12 ms apart, in order.
  const keyQueue = []; let lastKeyAt = 0, keyTimer = 0;
  // With a Chinese/Japanese IME switched on, browsers can report keyCode 229 instead of the real key,
  // which would leave a key stuck "down"; the physical key (e.code) gives the Flash key code instead.
  function codeOf(e) {
    const c = e.code || '';
    let m;
    if ((m = /^Key([A-Z])$/.exec(c))) return m[1].charCodeAt(0);
    if ((m = /^Digit(\d)$/.exec(c))) return 48 + Number(m[1]);
    if ((m = /^Numpad(\d)$/.exec(c))) return 96 + Number(m[1]);
    const named = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, NumpadEnter: 13, Space: 32, Escape: 27, Tab: 9, Backspace: 8, ShiftLeft: 16, ShiftRight: 16 };
    if (named[c]) return named[c];
    if ((m = /^F(\d+)$/.exec(c))) return 111 + Number(m[1]);
    return e.keyCode;
  }
  function queueKey(type, e) {
    const keyCode = e.code ? codeOf(e) : e.keyCode;
    keyQueue.push([type, { keyCode, key: e.key }]);
    pumpKeys();
  }
  function pumpKeys() {
    keyTimer = 0;
    while (keyQueue.length) {
      const wait = lastKeyAt + 12 - performance.now();
      if (wait > 0) { if (!keyTimer) keyTimer = setTimeout(pumpKeys, wait); return; }
      const [type, ev] = keyQueue.shift();
      lastKeyAt = performance.now();
      keyEvent(type, ev);
    }
  }
  window.addEventListener('blur', () => { down.clear(); keyQueue.length = 0; });

  // ---------------------------------------------------------------- mouse
  KOF.mouseX = 0; KOF.mouseY = 0;
  let pressed = null, hover = null;
  function stagePos(e) {
    const r = KOF.canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / KOF.viewScale, (e.clientY - r.top) / KOF.viewScale];
  }
  function isInteractive(o) {
    const d = o.__d;
    if (d.kind === 'button') return d.enabled !== false;
    if (d.kind === 'clip') return o.enabled !== false && (typeof o.onPress === 'function' || typeof o.onRelease === 'function' || typeof o.onRollOver === 'function' || typeof o.onRollOut === 'function' || typeof o.onReleaseOutside === 'function');
    return false;
  }
  // topmost interactive object under the point
  function pick(o, x, y) {
    const d = o.__d;
    if (!d.visible || d.removed) return null;
    if (d.kind === 'clip') {
      for (let i = d.children.length - 1; i >= 0; i--) {
        const r = pick(d.children[i], x, y);
        if (r) return r;
      }
      if (isInteractive(o) && o !== KOF.root) {
        const ha = o.hitArea && o.hitArea.__d ? o.hitArea : o;
        if (KOF.hitPoint(ha, x, y, true)) return o;
      }
      return null;
    }
    if (d.kind === 'button' && isInteractive(o)) {
      if (KOF.hitPoint(o, x, y, true)) return o;
    }
    return null;
  }
  function buttonActions(o, mask) {
    const d = o.__d;
    if (d.kind !== 'button') return;
    for (const [cond, key] of d.def.acts) {
      if (cond & mask) KOF.runCode(key, d.parent, d.parent);
    }
  }
  function callEv(o, name) { const f = o[name]; if (typeof f === 'function') { try { f.call(o); } catch (e) { KOF.reportError(e, name); } } }
  function setState(o, st) { if (o.__d.kind === 'button') o.__d.state = st; else if (o.__d.kind === 'clip' && o.__d.def && o.__d.def.labels) { const L = o.__d.def.labels; const n = st === 1 ? '_up' : st === 2 ? '_over' : '_down'; if (L[n]) o.gotoAndStop(n); } }
  function mouseEvents(type) {
    eachClip((c) => {
      const ev = c.__d.clipEv;
      if (ev && ev[type]) for (const k of ev[type]) KOF.runCode(k, c, c);
    });
    const ml = KOF.mouseListeners;
    for (const l of ml.slice()) { const f = l['on' + type[0].toUpperCase() + type.slice(1)]; if (typeof f === 'function') f.call(l); }
  }
  KOF.mouseListeners = [];
  B.Mouse.addListener = function (o) { if (KOF.mouseListeners.indexOf(o) < 0) KOF.mouseListeners.push(o); };
  B.Mouse.removeListener = function (o) { const i = KOF.mouseListeners.indexOf(o); if (i >= 0) KOF.mouseListeners.splice(i, 1); };

  function onMove(e) {
    [KOF.mouseX, KOF.mouseY] = stagePos(e);
    if (!KOF.running) return;
    const t = pick(KOF.root, KOF.mouseX, KOF.mouseY);
    if (t !== hover) {
      if (hover && !hover.__d.removed) { if (hover.__d.kind === 'button') buttonActions(hover, 0x02); callEv(hover, pressed === hover ? 'onDragOut' : 'onRollOut'); setState(hover, 1); }
      hover = t;
      if (hover) { if (hover.__d.kind === 'button') buttonActions(hover, 0x01); callEv(hover, 'onRollOver'); setState(hover, pressed === hover ? 4 : 2); }
    }
    KOF.canvas.style.cursor = hover && hover.useHandCursor !== false ? 'pointer' : '';
    mouseEvents('mouseMove');
    KOF.drain();
  }
  function onDown(e) {
    [KOF.mouseX, KOF.mouseY] = stagePos(e);
    KOF.audio && KOF.audio.unlock();
    if (!KOF.running) return;
    const t = pick(KOF.root, KOF.mouseX, KOF.mouseY);
    pressed = t;
    if (t) { if (t.__d.kind === 'button') buttonActions(t, 0x04); callEv(t, 'onPress'); setState(t, 4); }
    mouseEvents('mouseDown');
    KOF.drain();
  }
  function onUp(e) {
    [KOF.mouseX, KOF.mouseY] = stagePos(e);
    if (!KOF.running) return;
    const t = pick(KOF.root, KOF.mouseX, KOF.mouseY);
    if (pressed && !pressed.__d.removed) {
      if (t === pressed) { if (t.__d.kind === 'button') buttonActions(t, 0x08); callEv(t, 'onRelease'); setState(t, 2); }
      else { if (pressed.__d.kind === 'button') buttonActions(pressed, 0x40); callEv(pressed, 'onReleaseOutside'); setState(pressed, 1); }
    }
    pressed = null;
    mouseEvents('mouseUp');
    KOF.drain();
  }
  KOF.buttonKey = function (code) {
    // DefineButton2 keyPress conditions (cond >> 9)
    const walk = (o) => {
      const d = o.__d;
      if (d.kind === 'button') { for (const [cond, key] of d.def.acts) { const k = cond >> 9; if (k && (k === code || (k >= 32 && String.fromCharCode(k).toUpperCase().charCodeAt(0) === code))) KOF.runCode(key, d.parent, d.parent); } }
      if (d.kind === 'clip') for (const c of d.children.slice()) walk(c);
    };
    walk(KOF.root);
  };
  KOF.pick = pick;
  KOF.bindMouse = function (c) {
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture && c.setPointerCapture(e.pointerId); onDown(e); });
    c.addEventListener('pointerup', onUp);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  // ---------------------------------------------------------------- Stage
  B.Stage = { width: 660, height: 485, scaleMode: 'showAll', align: '', showMenu: false, addListener() { }, removeListener() { } };

  // ---------------------------------------------------------------- audio
  const audio = KOF.audio = {
    ctx: null, buffers: {}, master: null, playing: [], muted: false, globalVol: 1,
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
        this.master.gain.value = this.muted ? 0 : 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    buffer(id) {
      let b = this.buffers[id];
      if (b) return b.buf || null;
      if (!this.ctx) return null;
      const src = KOF.sounds && KOF.sounds[id];
      if (!src) return null;
      b = this.buffers[id] = { buf: null };
      const bin = atob(src); const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      this.ctx.decodeAudioData(arr.buffer).then((x) => { b.buf = x; if (b.pending) { const p = b.pending; b.pending = null; p.forEach((f) => f()); } }, () => { });
      return null;
    },
    play(id, opts) {
      if (!this.ctx) return null;
      const buf = this.buffer(id);
      const inst = { id, owner: opts.owner, sound: opts.sound, src: null, gain: null, stopped: false, loops: opts.loops || 0, offset: opts.offset || 0 };
      const go = () => {
        if (inst.stopped) return;
        const b = this.buffers[id].buf;
        const s = this.ctx.createBufferSource(); s.buffer = b;
        const g = this.ctx.createGain(); g.gain.value = opts.volume === undefined ? 1 : opts.volume;
        s.connect(g); g.connect(this.master);
        if (inst.loops > 1) { s.loop = true; inst.loopEnd = this.ctx.currentTime + b.duration * inst.loops - inst.offset; }
        s.onended = () => { this.remove(inst); if (!inst.stopped && inst.sound && typeof inst.sound.onSoundComplete === 'function') { try { inst.sound.onSoundComplete(); } catch (e) { KOF.reportError(e, 'sound'); } KOF.drain(); } };
        s.start(0, Math.min(inst.offset, b.duration));
        if (inst.loops > 1) s.stop(inst.loopEnd);
        inst.src = s; inst.gain = g; inst.started = this.ctx.currentTime;
      };
      if (buf) go(); else if (this.buffers[id]) { (this.buffers[id].pending = this.buffers[id].pending || []).push(go); }
      this.playing.push(inst);
      return inst;
    },
    remove(inst) { const i = this.playing.indexOf(inst); if (i >= 0) this.playing.splice(i, 1); },
    stopInst(inst) { inst.stopped = true; try { inst.src && inst.src.stop(); } catch (e) { } this.remove(inst); },
    stopAll() { for (const p of this.playing.slice()) this.stopInst(p); },
    stopOwner(o) { },
    stopId(id) { for (const p of this.playing.slice()) if (p.id === id) this.stopInst(p); },
    isPlaying(id) { return this.playing.some((p) => p.id === id); },
    ownerVolume(o) {
      let v = this.globalVol;
      while (o && o.__d) { if (o.__d.soundVol !== undefined) v *= o.__d.soundVol; o = o.__d.parent; }
      return v;
    },
    timelineSound(clip, op) {
      if (op.stop) { this.stopId(op.snd); return; }
      if (op.nomul && this.isPlaying(op.snd)) return;
      this.play(op.snd, { owner: clip, loops: op.loops, volume: this.ownerVolume(clip) });
    },
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 1; },
  };

  function Sound(target) { Object.defineProperty(this, '__t', { value: target && target.__d ? target : null, enumerable: false, writable: true }); Object.defineProperty(this, '__s', { value: { id: null, vol: 100, insts: [] }, enumerable: false, writable: true }); }
  Sound.prototype.attachSound = function (name) { const id = KOF.data.exports[name]; this.__s.id = id === undefined ? null : id; };
  Sound.prototype.start = function (off, loops) {
    const s = this.__s;
    if (s.id === null) return;
    const vol = (s.vol / 100) * (this.__t ? audio.ownerVolume(this.__t) : audio.globalVol);
    const inst = audio.play(s.id, { owner: this.__t, sound: this, offset: Number(off) || 0, loops: Number(loops) || 0, volume: vol });
    if (inst) { s.insts = s.insts.filter((i) => !i.stopped && audio.playing.indexOf(i) >= 0); s.insts.push(inst); }
  };
  Sound.prototype.stop = function (name) {
    if (name !== undefined) { const id = KOF.data.exports[name]; if (id !== undefined) audio.stopId(id); return; }
    const s = this.__s;
    if (this.__t || s.insts.length) for (const i of s.insts) audio.stopInst(i);
    else audio.stopAll();
    s.insts = [];
  };
  Sound.prototype.setVolume = function (v) {
    v = Number(v); if (isNaN(v)) return; const s = this.__s; s.vol = v;
    if (this.__t) this.__t.__d.soundVol = v / 100;
    else if (!s.id) audio.globalVol = v / 100;
    for (const i of s.insts) if (i.gain) i.gain.gain.value = (v / 100) * (this.__t ? 1 : 1);
  };
  Sound.prototype.getVolume = function () { return this.__s.vol; };
  Sound.prototype.setPan = function () { };
  Sound.prototype.getPan = function () { return 0; };
  Sound.prototype.setTransform = function () { };
  Sound.prototype.getTransform = function () { return { ll: 100, lr: 0, rr: 100, rl: 0 }; };
  Sound.prototype.loadSound = function () { };
  Object.defineProperty(Sound.prototype, 'duration', { get() { const b = this.__s.id !== null && audio.buffers[this.__s.id]; return b && b.buf ? Math.round(b.buf.duration * 1000) : 0; } });
  Object.defineProperty(Sound.prototype, 'position', { get() { const i = this.__s.insts[this.__s.insts.length - 1]; return i && audio.ctx && i.started !== undefined ? Math.round((audio.ctx.currentTime - i.started) * 1000) : 0; } });
  B.Sound = Sound;

  // ---------------------------------------------------------------- BitmapData (minimal)
  // bitmaps are kept at 2x so stage backgrounds stay sharp when the canvas is scaled up
  const BMRES = 2;
  function BitmapData(w, h, transparent, fill) {
    this.width = Math.max(1, Number(w) | 0); this.height = Math.max(1, Number(h) | 0);
    this.transparent = transparent !== false;
    const c = this.canvas = document.createElement('canvas'); c.width = this.width * BMRES; c.height = this.height * BMRES;
    this.g = c.getContext('2d');
    this.rectangle = { x: 0, y: 0, width: this.width, height: this.height };
    fill = Number(fill) || 0;
    if (fill || !this.transparent) this.fillRect(this.rectangle, fill);
  }
  BitmapData.prototype.draw = function (src, matrix) {
    if (!src || !src.__d) return;
    const M = matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty] : [1, 0, 0, 1, 0, 0];
    KOF.drawToBitmap(this.g, src, M, BMRES);
    this.g.setTransform(1, 0, 0, 1, 0, 0); this.g.globalAlpha = 1; this.g.globalCompositeOperation = 'source-over';
  };
  BitmapData.prototype.dispose = function () { this.canvas.width = this.canvas.height = 1; };
  BitmapData.prototype.fillRect = function (r, c) {
    if (!r) return;
    const a = this.transparent ? ((c >>> 24) & 255) / 255 : 1;
    const g = this.g; g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(r.x * BMRES, r.y * BMRES, r.width * BMRES, r.height * BMRES);
    if (a > 0) { g.fillStyle = `rgba(${c >> 16 & 255},${c >> 8 & 255},${c & 255},${a})`; g.fillRect(r.x * BMRES, r.y * BMRES, r.width * BMRES, r.height * BMRES); }
  };
  BitmapData.prototype.copyPixels = function (src, r, pt) {
    if (!src || !src.canvas || !r) return;
    const g = this.g, px = pt ? Number(pt.x) || 0 : 0, py = pt ? Number(pt.y) || 0 : 0;
    let sx = Number(r.x) || 0, sy = Number(r.y) || 0, w = Number(r.width) || 0, h = Number(r.height) || 0, dx = px, dy = py;
    if (sx < 0) { dx -= sx; w += sx; sx = 0; } if (sy < 0) { dy -= sy; h += sy; sy = 0; }
    w = Math.min(w, src.width - sx); h = Math.min(h, src.height - sy);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(px * BMRES, py * BMRES, (Number(r.width) || 0) * BMRES, (Number(r.height) || 0) * BMRES);
    if (w > 0 && h > 0) g.drawImage(src.canvas, sx * BMRES, sy * BMRES, w * BMRES, h * BMRES, dx * BMRES, dy * BMRES, w * BMRES, h * BMRES);
  };
  BitmapData.prototype.clone = function () { const b = new BitmapData(this.width, this.height, this.transparent, 0); b.g.drawImage(this.canvas, 0, 0); return b; };
  BitmapData.prototype.getPixel32 = function (x, y) { let p; try { p = this.g.getImageData(x * BMRES, y * BMRES, 1, 1).data; } catch (e) { return 0; } return ((p[3] << 24) | (p[0] << 16) | (p[1] << 8) | p[2]) >>> 0; };
  BitmapData.prototype.getPixel = function (x, y) { return this.getPixel32(x, y) & 0xffffff; };
  B.flash = { display: { BitmapData }, geom: { Point: function (x, y) { this.x = x || 0; this.y = y || 0; }, Rectangle: function (x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; }, Matrix: function (a, b, c, d, tx, ty) { this.a = a === undefined ? 1 : a; this.b = b || 0; this.c = c || 0; this.d = d === undefined ? 1 : d; this.tx = tx || 0; this.ty = ty || 0; }, ColorTransform: function () { } }, filters: {} };
  for (const f of ['GlowFilter', 'BlurFilter', 'DropShadowFilter', 'ColorMatrixFilter', 'BevelFilter', 'GradientGlowFilter', 'ConvolutionFilter']) B.flash.filters[f] = function () { };
  B.flash.geom.Matrix.prototype = { scale(x, y) { this.a *= x; this.d *= y; this.tx *= x; this.ty *= y; }, translate(x, y) { this.tx += x; this.ty += y; }, identity() { this.a = this.d = 1; this.b = this.c = this.tx = this.ty = 0; } };

  // ---------------------------------------------------------------- main loop
  KOF.running = false;
  KOF.paused = false;
  let acc = 0, last = 0, slowAvg = 16, slowCount = 0;
  KOF.frameTime = 1000 / 40;
  KOF.stats = { ticks: 0, tickMs: 0, renderMs: 0 };
  function loop(now) {
    requestAnimationFrame(loop);
    if (!KOF.running) return;
    if (!last) last = now;
    let dt = now - last; last = now;
    if (dt > 250) dt = KOF.frameTime;
    if (KOF.paused) return;
    acc += dt;
    let n = 0;
    while (acc >= KOF.frameTime && n < 4) {
      acc -= KOF.frameTime; n++;
      const t0 = performance.now();
      try { KOF.runIntervals(now); KOF.tick(); } catch (e) { KOF.reportError(e, 'tick'); }
      KOF.stats.tickMs = performance.now() - t0; KOF.stats.ticks++;
    }
    if (n === 4) acc = 0;
    // slow device: if frames keep taking longer than the game's 25 ms for ~2 s, draw at a lower resolution
    slowAvg = slowAvg * 0.95 + dt * 0.05;
    if (++slowCount > 80) { slowCount = 0; if (slowAvg > 30 && KOF.lowerQuality()) slowAvg = KOF.frameTime; }
    if (n) {
      const t1 = performance.now();
      try { KOF.render(); } catch (e) { KOF.reportError(e, 'render'); }
      KOF.stats.renderMs = performance.now() - t1;
    }
  }
  KOF.start = function () { KOF.running = true; last = 0; requestAnimationFrame(loop); };
  // manual stepping for tests
  KOF.step = function (n) { for (let i = 0; i < (n || 1); i++) { KOF.runIntervals(performance.now()); KOF.tick(); } KOF.render(); };
})();
