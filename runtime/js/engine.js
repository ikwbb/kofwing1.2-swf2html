// Display list, timelines and MovieClip API for the KOF Wing HTML5 port.
// Character data (shapes, sprites, texts, sounds) comes from data.js, generated from the
// original SWF by tools/build_data.py; game logic comes from code.js.
'use strict';
(function () {
  const KOF = window.KOF;
  const $ = KOF.$;
  const G = KOF.G;
  const B = KOF.B;
  const TL = -16384; // timeline depth offset (AS2 reports timeline depths as negative)

  let DATA, CHARS, EXPORT_BY_ID = {};
  let instanceCounter = 1;
  let recCounter = 1;

  // ---------------------------------------------------------------- matrices
  function mmul(p, m) { // p * m  (apply m first, then p)
    return [
      p[0] * m[0] + p[2] * m[1], p[1] * m[0] + p[3] * m[1],
      p[0] * m[2] + p[2] * m[3], p[1] * m[2] + p[3] * m[3],
      p[0] * m[4] + p[2] * m[5] + p[4], p[1] * m[4] + p[3] * m[5] + p[5],
    ];
  }
  function minv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return [1, 0, 0, 1, -m[4], -m[5]];
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function mpt(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  const IDM = [1, 0, 0, 1, 0, 0];
  const IDCX = [1, 1, 1, 1, 0, 0, 0, 0];
  function cxmul(p, c) {
    return [p[0] * c[0], p[1] * c[1], p[2] * c[2], p[3] * c[3],
      p[0] * c[4] + p[4], p[1] * c[5] + p[5], p[2] * c[6] + p[6], p[3] * c[7] + p[7]];
  }
  KOF.mmul = mmul; KOF.minv = minv; KOF.mpt = mpt;

  // ---------------------------------------------------------------- action queue
  const Q = [[], [], []]; // 0 init, 1 construct, 2 normal
  function enqueue(pri, clip, fn) { Q[pri].push([clip, fn]); }
  function drain() {
    let guard = 0;
    for (; ;) {
      let item = null;
      for (let p = 0; p < 3; p++) if (Q[p].length) { item = Q[p].shift(); break; }
      if (!item) break;
      if (++guard > 200000) { console.warn('action queue runaway'); Q[0].length = Q[1].length = Q[2].length = 0; break; }
      const [clip, fn] = item;
      if (clip && clip.__d && clip.__d.removed) continue;
      try { fn(); } catch (e) { KOF.reportError(e, clip && clip.__d && clip.__d.where); }
    }
  }
  KOF.drain = drain;

  function runCode(key, self, scopeClip) {
    const fn = KOF.code[key];
    if (!fn) return;
    fn.call(self, KOF.scopeOf(scopeClip));
  }
  KOF.runCode = runCode;

  // ---------------------------------------------------------------- node internals
  function hidden(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, enumerable: false, configurable: true }); }

  function newInternal(kind, def, id) {
    return {
      kind, def, id, parent: null, depth: 0, name: '',
      m: IDM.slice(), sx: 1, sy: 1, rx: 0, ry: 0, cx: IDCX, visible: true,
      rec: 0, timeline: false, scripted: false, removed: false,
      children: null, byDepth: null, frame: 0, playing: false,
      clipEv: null, tell: null, scope: null, ratio: 0, mask: null, maskOwner: null,
      clipDepth: 0, gfx: null, initialized: false,
    };
  }
  function setMatrix(d, m) {
    d.m = m.slice();
    d.sx = Math.hypot(m[0], m[1]);
    d.sy = Math.hypot(m[2], m[3]);
    if (m[0] * m[3] - m[1] * m[2] < 0) { d.sy = -d.sy; }
    d.rx = Math.atan2(m[1], m[0]);
    d.ry = Math.atan2(-m[2], m[3]);
    if (d.sy < 0) d.ry = Math.atan2(m[2], -m[3]);
  }
  function recompose(d) {
    const m = d.m;
    m[0] = d.sx * Math.cos(d.rx); m[1] = d.sx * Math.sin(d.rx);
    m[2] = -d.sy * Math.sin(d.ry); m[3] = d.sy * Math.cos(d.ry);
  }

  // ---------------------------------------------------------------- MovieClip
  function MovieClip() { }
  MovieClip.__native = true;
  KOF.MovieClip = MovieClip;
  B.MovieClip = MovieClip;
  const MP = MovieClip.prototype;

  function makeClip(def, id, proto) {
    const o = Object.create(proto || MP);
    const d = newInternal('clip', def, id);
    hidden(o, '__d', d);
    d.children = []; d.byDepth = new Map();
    d.frame = 0; d.playing = true;
    return o;
  }

  function classFor(id) {
    const names = EXPORT_BY_ID[id];
    if (!names) return null;
    for (const n of names) if (typeof KOF.classes[n] === "function") return KOF.classes[n];
    return null;
  }

  // create a display object for a character id
  function createChar(cid) {
    const def = CHARS[cid];
    if (!def) return null;
    let o;
    switch (def.t) {
      case 'sprite': {
        const cls = classFor(cid);
        o = makeClip(def, cid, cls ? cls.prototype : MP);
        if (cls) o.__d.cls = cls;
        break;
      }
      case 'etext':
        o = KOF.makeTextField(def, cid);
        break;
      case 'button':
        o = Object.create(KOF.Button.prototype);
        hidden(o, '__d', newInternal('button', def, cid));
        o.__d.state = 1;
        break;
      default:
        o = {};
        hidden(o, '__d', newInternal(def.t, def, cid));
    }
    return o;
  }

  function insertChild(parent, child, depth) {
    const pd = parent.__d, cd = child.__d;
    cd.parent = parent; cd.depth = depth;
    pd.byDepth.set(depth, child);
    const arr = pd.children;
    let i = arr.length;
    while (i > 0 && arr[i - 1].__d.depth > depth) i--;
    arr.splice(i, 0, child);
  }
  function detachChild(parent, child) {
    const pd = parent.__d, cd = child.__d;
    if (pd.byDepth.get(cd.depth) === child) pd.byDepth.delete(cd.depth);
    const i = pd.children.indexOf(child);
    if (i >= 0) pd.children.splice(i, 1);
    if (cd.name && Object.prototype.hasOwnProperty.call(parent, cd.name) && parent[cd.name] === child) delete parent[cd.name];
  }
  function setName(parent, child, name) {
    const cd = child.__d;
    if (cd.name && parent[cd.name] === child) delete parent[cd.name];
    cd.name = name;
    if (name) {
      try { parent[name] = child; } catch (e) { }
    }
  }

  function markRemoved(o) {
    const d = o.__d;
    if (!d || d.removed) return;
    d.removed = true;
    if (d.kind === 'clip') {
      if (d.clipEv && d.clipEv.unload) for (const k of d.clipEv.unload) try { runCode(k, o, o); } catch (e) { KOF.reportError(e, 'unload'); }
      if (typeof o.onUnload === 'function') try { o.onUnload(); } catch (e) { KOF.reportError(e, 'onUnload'); }
      for (const c of d.children) markRemoved(c);
      KOF.audio && KOF.audio.stopOwner(o);
    }
    if (KOF.focusClip === o) KOF.focusClip = null;
  }
  function removeChild(parent, child) {
    detachChild(parent, child);
    markRemoved(child);
  }

  // ---------------------------------------------------------------- timeline states
  function stateAt(def, f) {
    if (!def.states) { def.states = [new Map()]; }
    const st = def.states;
    for (let i = st.length; i <= f; i++) {
      const prev = st[i - 1];
      const cur = new Map(prev);
      const ops = def.frames[i - 1] || [];
      for (const op of ops) {
        if (op.rm !== undefined) { cur.delete(op.rm); continue; }
        if (op.d === undefined) continue;
        const old = cur.get(op.d);
        if (op.mv) {
          if (!old) continue;
          const r = Object.assign({}, old);
          if (op.c !== undefined && op.c !== old.c) { r.c = op.c; r.id = recCounter++; r.ev = op.ev; }
          if (op.m) r.m = op.m;
          if (op.cx) r.cx = op.cx;
          if (op.r !== undefined) r.r = op.r;
          if (op.n !== undefined) r.n = op.n;
          if (op.cd !== undefined) r.cd = op.cd;
          r.moved = true;
          cur.set(op.d, r);
        } else if (op.c !== undefined) {
          cur.set(op.d, { id: recCounter++, c: op.c, m: op.m || IDM, cx: op.cx || null, r: op.r || 0, n: op.n, cd: op.cd || 0, ev: op.ev, blend: op.blend });
        }
      }
      st.push(cur);
    }
    return st[f];
  }

  function applyRec(child, rec, initial) {
    const d = child.__d;
    if (initial || !d.scripted) {
      setMatrix(d, rec.m || IDM);
      d.cx = rec.cx || IDCX;
    }
    d.ratio = rec.r || 0;
    d.clipDepth = rec.cd || 0;
  }

  function instantiateFromRec(parent, rec, depth) {
    const child = createChar(rec.c);
    if (!child) return null;
    const d = child.__d;
    d.rec = rec.id; d.timeline = true;
    applyRec(child, rec, true);
    insertChild(parent, child, depth);
    let nm = rec.n;
    if (!nm && d.kind === 'clip') nm = 'instance' + (instanceCounter++);
    if (nm) setName(parent, child, nm);
    if (rec.ev) {
      d.clipEv = {};
      for (const [names, key] of rec.ev) for (const n of names) (d.clipEv[n.split(':')[0]] = d.clipEv[n.split(':')[0]] || []).push(key);
    }
    if (d.kind === 'clip') initClip(child, null, true);
    else if (d.kind === 'etext') KOF.textFieldPlaced(child, parent);
    return child;
  }

  // set up a freshly created clip: frame 1, class constructor, load events
  function initClip(clip, initObj, fromTimeline) {
    const d = clip.__d;
    d.where = 'clip ' + d.id;
    if (initObj) for (const k in initObj) clip[k] = initObj[k];
    if (d.clipEv) {
      if (d.clipEv.initialize) for (const k of d.clipEv.initialize) enqueue(0, clip, () => runCode(k, clip, clip));
      if (d.clipEv.construct) for (const k of d.clipEv.construct) enqueue(1, clip, () => runCode(k, clip, clip));
    }
    // frame 1 display list (children get created and queue their own actions)
    if (d.def && d.def.frames && d.def.frames.length) gotoFrame(clip, 1, true, true);
    else d.frame = 1;
    if (d.cls) {
      if (fromTimeline) enqueue(1, clip, () => Function.prototype.apply.call(d.cls, clip, []));
      else { try { Function.prototype.apply.call(d.cls, clip, []); } catch (e) { KOF.reportError(e, 'ctor ' + d.id); } }
    }
    enqueue(2, clip, () => fireLoad(clip));
  }
  function fireLoad(clip) {
    const d = clip.__d;
    if (d.loaded) return;
    d.loaded = true;
    if (d.clipEv && d.clipEv.load) for (const k of d.clipEv.load) runCode(k, clip, clip);
    if (typeof clip.onLoad === 'function') clip.onLoad();
  }

  function queueFrameActions(clip, f) {
    const d = clip.__d;
    const ops = d.def.frames[f - 1];
    if (!ops) return;
    for (const op of ops) {
      if (op.i) { if (!KOF.initDone[op.i]) { KOF.initDone[op.i] = 1; enqueue(0, clip, () => runCode(op.i, KOF.root, KOF.root)); } }
    }
    for (const op of ops) {
      if (op.a) enqueue(2, clip, () => runCode(op.a, clip, clip));
      else if (op.snd !== undefined) KOF.audio && KOF.audio.timelineSound(clip, op);
    }
  }

  function gotoFrame(clip, f, play, first) {
    const d = clip.__d;
    const def = d.def;
    if (!def || !def.frames) return;
    const total = def.frames.length;
    // AS2 converts non-numbers to strings first: the fighters' skill names are one-element arrays like ["sk1"]
    if (f !== null && typeof f === 'object') f = String(f);
    if (typeof f === 'string') {
      let lf = def.labels[f];
      if (lf === undefined) {
        if (!def.labelsLC) { def.labelsLC = {}; for (const k in def.labels) { const lk = k.toLowerCase(); if (!(lk in def.labelsLC)) def.labelsLC[lk] = def.labels[k]; } }
        lf = def.labelsLC[f.toLowerCase()];
      }
      if (lf === undefined) {
        const n = Number(f);
        if (!isNaN(n) && f !== '') f = n; else { d.playing = play; return; }
      } else f = lf;
    }
    f = Math.floor(Number(f));
    if (!(f >= 1)) f = 1;
    if (f > total) f = total;
    d.playing = play && total > 1;
    if (f === d.frame && !first) return;
    d.frame = f;
    // #initclip blocks of this frame run before its children are created
    const fops = def.frames[f - 1];
    if (fops) for (const op of fops) {
      if (op.i && !KOF.initDone[op.i]) { KOF.initDone[op.i] = 1; try { runCode(op.i, KOF.root, KOF.root); } catch (e) { KOF.reportError(e, op.i); } }
    }
    const st = stateAt(def, f);
    // reconcile timeline children
    const seen = new Set();
    for (const [depth, rec] of st) {
      const di = depth + TL;
      seen.add(di);
      const cur = d.byDepth.get(di);
      if (cur && cur.__d.rec === rec.id) { applyRec(cur, rec, false); continue; }
      if (cur) {
        if (!cur.__d.timeline) continue; // script owns this depth
        removeChild(clip, cur);
      }
      instantiateFromRec(clip, rec, di);
    }
    for (const c of d.children.slice()) {
      const cd = c.__d;
      if (cd.timeline && cd.depth < 0 && !seen.has(cd.depth)) removeChild(clip, c);
    }
    queueFrameActions(clip, f);
  }
  KOF.gotoFrame = gotoFrame;

  function advance(clip) {
    const d = clip.__d;
    if (!d.def || !d.def.frames) return;
    const total = d.def.frames.length;
    if (total <= 1) { d.playing = false; return; }
    let nf = d.frame + 1;
    if (nf > total) nf = 1;
    gotoFrame(clip, nf, true);
  }

  // ---------------------------------------------------------------- frame tick
  function collect(clip, out) {
    out.push(clip);
    const ch = clip.__d.children;
    for (let i = ch.length - 1; i >= 0; i--) { const c = ch[i]; if (c.__d.kind === 'clip') collect(c, out); }
  }
  KOF.tick = function () {
    const list = [];
    collect(KOF.root, list);
    for (const clip of list) {
      const d = clip.__d;
      if (d.removed) continue;
      if (d.clipEv && d.clipEv.enterFrame) for (const k of d.clipEv.enterFrame) enqueue(2, clip, () => runCode(k, clip, clip));
      if (typeof clip.onEnterFrame === 'function') enqueue(2, clip, () => { if (typeof clip.onEnterFrame === 'function') clip.onEnterFrame(); });
      if (d.playing) advance(clip);
    }
    drain();
    KOF.updateTextVars && KOF.updateTextVars();
  };

  // ---------------------------------------------------------------- AS2 properties
  function defAccessor(name, get, set) {
    Object.defineProperty(MP, name, {
      get() { return this.__d ? get.call(this) : undefined; },
      set(v) {
        if (!this.__d) { Object.defineProperty(this, name, { value: v, writable: true, enumerable: true, configurable: true }); return; }
        if (set) set.call(this, v);
      },
      enumerable: false, configurable: true,
    });
  }
  function markScripted(d) { d.scripted = true; }
  defAccessor('_x', function () { return this.__d.m[4]; }, function (v) { v = Number(v); if (isNaN(v)) return; const d = this.__d; d.m[4] = v; markScripted(d); });
  defAccessor('_y', function () { return this.__d.m[5]; }, function (v) { v = Number(v); if (isNaN(v)) return; const d = this.__d; d.m[5] = v; markScripted(d); });
  defAccessor('_xscale', function () { return this.__d.sx * 100; }, function (v) { v = Number(v); if (isNaN(v)) return; const d = this.__d; d.sx = v / 100; recompose(d); markScripted(d); });
  defAccessor('_yscale', function () { return this.__d.sy * 100; }, function (v) { v = Number(v); if (isNaN(v)) return; const d = this.__d; d.sy = v / 100; recompose(d); markScripted(d); });
  defAccessor('_rotation', function () { return this.__d.rx * 180 / Math.PI; }, function (v) {
    v = Number(v); if (isNaN(v)) return; const d = this.__d;
    v = ((v % 360) + 540) % 360 - 180;
    const r = v * Math.PI / 180; const delta = r - d.rx; d.rx = r; d.ry += delta; recompose(d); markScripted(d);
  });
  defAccessor('_alpha', function () { return this.__d.cx[3] * 100; }, function (v) { v = Number(v); if (isNaN(v)) return; const d = this.__d; d.cx = d.cx.slice(); d.cx[3] = v / 100; markScripted(d); });
  defAccessor('_visible', function () { return this.__d.visible; }, function (v) { this.__d.visible = !!v && v !== 'false'; });
  defAccessor('_currentframe', function () { return this.__d.frame || 1; });
  defAccessor('_totalframes', function () { const d = this.__d; return d.def && d.def.frames ? d.def.frames.length : 1; });
  defAccessor('_framesloaded', function () { return this._totalframes; });
  defAccessor('_name', function () { return this.__d.name; }, function (v) { const d = this.__d; if (d.parent) setName(d.parent, this, String(v)); else d.name = String(v); });
  defAccessor('_parent', function () { return this.__d.parent || undefined; }, function () { });
  // _root honours _lockroot (characters are attached with _lockroot = true)
  function rootOf(o) {
    for (let c = o; c && c.__d; c = c.__d.parent) if (c._lockroot === true) return c;
    return KOF.root;
  }
  KOF.rootOf = rootOf;
  defAccessor('_root', function () { return rootOf(this); });
  defAccessor('_level0', function () { return KOF.root; });
  defAccessor('_global', function () { return G; });
  defAccessor('_target', function () {
    const parts = []; let o = this;
    while (o && o !== KOF.root) { parts.unshift(o.__d.name); o = o.__d.parent; }
    return '/' + parts.join('/');
  });
  defAccessor('_url', function () { return location.href; });
  defAccessor('_quality', function () { return 'HIGH'; });
  defAccessor('_highquality', function () { return 1; });
  defAccessor('_focusrect', function () { return false; });
  defAccessor('_soundbuftime', function () { return 5; });
  defAccessor('_droptarget', function () { return ''; });
  defAccessor('_xmouse', function () { return mpt(minv(worldMatrix(this)), KOF.mouseX, KOF.mouseY)[0]; });
  defAccessor('_ymouse', function () { return mpt(minv(worldMatrix(this)), KOF.mouseX, KOF.mouseY)[1]; });
  defAccessor('_width', function () { const b = boundsIn(this, this.__d.parent); return b ? b[2] - b[0] : 0; }, function (v) {
    v = Number(v); if (isNaN(v)) return; const b = boundsIn(this, null, true); if (!b) return; const w = b[2] - b[0]; if (!w) return;
    const d = this.__d; d.sx = v / w * Math.sign(d.sx || 1) * (Math.abs(Math.cos(d.rx)) || 1); recompose(d); markScripted(d);
  });
  defAccessor('_height', function () { const b = boundsIn(this, this.__d.parent); return b ? b[3] - b[1] : 0; }, function (v) {
    v = Number(v); if (isNaN(v)) return; const b = boundsIn(this, null, true); if (!b) return; const h = b[3] - b[1]; if (!h) return;
    const d = this.__d; d.sy = v / h * Math.sign(d.sy || 1); recompose(d); markScripted(d);
  });
  KOF.defAccessor = defAccessor;

  // helpers so other display-object kinds (TextField, Button) share the transform props
  KOF.copyTransformProps = function (proto) {
    for (const n of ['_x', '_y', '_xscale', '_yscale', '_rotation', '_alpha', '_visible', '_name', '_parent', '_root', '_target', '_width', '_height', '_xmouse', '_ymouse']) {
      Object.defineProperty(proto, n, Object.getOwnPropertyDescriptor(MP, n));
    }
  };

  // ---------------------------------------------------------------- geometry
  function worldMatrix(o) {
    let m = o.__d.m;
    let p = o.__d.parent;
    while (p) { m = mmul(p.__d.m, m); p = p.__d.parent; }
    return m;
  }
  KOF.worldMatrix = worldMatrix;
  function matrixTo(o, space) { // o local -> space local
    const w = worldMatrix(o);
    if (!space) return w;
    return mmul(minv(worldMatrix(space)), w);
  }
  function localBounds(o) { // in o's own coordinates (union of content)
    const d = o.__d;
    let b = null;
    const add = (bb, m) => {
      if (!bb) return;
      const pts = [mpt(m, bb[0], bb[1]), mpt(m, bb[2], bb[1]), mpt(m, bb[0], bb[3]), mpt(m, bb[2], bb[3])];
      for (const [x, y] of pts) {
        if (!b) b = [x, y, x, y];
        else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
      }
    };
    if (d.kind === 'clip') {
      if (d.gfx && d.gfx.bounds) add(d.gfx.bounds, IDM);
      for (const c of d.children) {
        const cd = c.__d;
        if (cd.kind === 'clip' && !cd.visible && false) continue;
        add(localBounds(c), cd.m);
      }
      if (d.bitmaps) for (const bm of d.bitmaps) add([0, 0, bm.data.width, bm.data.height], IDM);
    } else if (d.kind === 'button') {
      for (const c of KOF.buttonChildren(o)) add(localBounds(c), c.__d.m);
    } else if (d.kind === 'etext') {
      add(d.tf ? [d.tf.x, d.tf.y, d.tf.x + d.tf.w, d.tf.y + d.tf.h] : d.def.b, IDM);
    } else if (d.def && d.def.b) {
      add(d.def.b, d.kind === 'text' ? IDM : IDM);
    }
    return b;
  }
  function boundsIn(o, space, local) {
    const lb = localBounds(o);
    if (!lb) return null;
    const m = local ? IDM : (space ? matrixTo(o, space) : worldMatrix(o));
    const pts = [mpt(m, lb[0], lb[1]), mpt(m, lb[2], lb[1]), mpt(m, lb[0], lb[3]), mpt(m, lb[2], lb[3])];
    let b = [pts[0][0], pts[0][1], pts[0][0], pts[0][1]];
    for (const [x, y] of pts) { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    return b;
  }
  KOF.boundsIn = boundsIn;
  KOF.localBounds = localBounds;

  // point hit against actual content (shape bounds level)
  function hitPoint(o, x, y, shape) {
    const d = o.__d;
    if (!shape) { const b = boundsIn(o, null); return !!b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; }
    if (d.kind === 'clip') {
      if (!d.visible && o !== KOF.root) { /* invisible clips still hit-test in Flash */ }
      for (const c of d.children) if (hitPoint(c, x, y, true)) return true;
      if (d.gfx && d.gfx.bounds) { const b = boundsIn(o, null); if (b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return true; }
      return false;
    }
    if (d.kind === 'button') { for (const c of KOF.buttonChildren(o, 8)) if (hitPoint(c, x, y, true)) return true; return false; }
    const b = boundsIn(o, null);
    if (!b || !(x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) return false;
    if (d.kind === 'shape' && KOF.shapeHit) {
      const lp = mpt(minv(worldMatrix(o)), x, y);
      return KOF.shapeHit(d.id, lp[0], lp[1]);
    }
    return true;
  }
  KOF.hitPoint = hitPoint;

  // ---------------------------------------------------------------- MovieClip methods
  function method(name, fn) {
    Object.defineProperty(MP, name, { value: function () { if (!this || !this.__d || this.__d.kind !== 'clip') return undefined; return fn.apply(this, arguments); }, writable: true, enumerable: false, configurable: true });
  }
  method('play', function () { this.__d.playing = this._totalframes > 1; });
  method('stop', function () { this.__d.playing = false; });
  method('gotoAndStop', function (f) { gotoFrame(this, f, false); });
  method('gotoAndPlay', function (f) { gotoFrame(this, f, true); });
  method('nextFrame', function () { gotoFrame(this, (this.__d.frame || 1) + 1, false); });
  method('prevFrame', function () { gotoFrame(this, Math.max(1, (this.__d.frame || 1) - 1), false); });
  method('__callFrame', function (f) {
    const d = this.__d; if (!d.def) return;
    if (typeof f === 'string') f = d.def.labels[f]; if (!f) return;
    const ops = d.def.frames[f - 1] || [];
    for (const op of ops) if (op.a) runCode(op.a, this, this);
  });
  method('attachMovie', function (linkage, name, depth, init) {
    const cid = DATA.exports[linkage];
    if (cid === undefined) return undefined;
    depth = Math.floor(Number(depth)) || 0;
    const old = this.__d.byDepth.get(depth);
    if (old) removeChild(this, old);
    const c = createChar(cid);
    if (!c) return undefined;
    insertChild(this, c, depth);
    setName(this, c, String(name));
    if (c.__d.kind === 'clip') initClip(c, init, false);
    return c;
  });
  method('createEmptyMovieClip', function (name, depth) {
    depth = Math.floor(Number(depth)) || 0;
    const old = this.__d.byDepth.get(depth);
    if (old) removeChild(this, old);
    const c = makeClip(null, 0, MP);
    c.__d.frame = 1; c.__d.playing = false; c.__d.loaded = true;
    insertChild(this, c, depth);
    setName(this, c, String(name));
    return c;
  });
  method('duplicateMovieClip', function (name, depth, init) {
    const d = this.__d, p = d.parent;
    if (!p) return undefined;
    depth = Math.floor(Number(depth)) || 0;
    const old = p.__d.byDepth.get(depth);
    if (old) removeChild(p, old);
    const c = d.def ? createChar(d.id) : makeClip(null, 0, Object.getPrototypeOf(this));
    if (!c) return undefined;
    const cd = c.__d;
    cd.m = d.m.slice(); cd.sx = d.sx; cd.sy = d.sy; cd.rx = d.rx; cd.ry = d.ry; cd.cx = d.cx; cd.visible = d.visible;
    cd.clipEv = d.clipEv; cd.scripted = true;
    insertChild(p, c, depth);
    setName(p, c, String(name));
    if (cd.kind === 'clip') { if (cd.def) initClip(c, init, false); else { cd.frame = 1; if (init) for (const k in init) c[k] = init[k]; } }
    return c;
  });
  method('removeMovieClip', function () {
    const d = this.__d; const p = d.parent;
    if (!p || d.depth < 0 && d.timeline && false) return;
    if (d.depth < 0 && d.depth >= -16384 && d.timeline) return; // Flash refuses to remove timeline clips at negative depth
    removeChild(p, this);
  });
  method('unloadMovie', function () { const d = this.__d; for (const c of d.children.slice()) removeChild(this, c); d.def = null; });
  method('loadMovie', function () { });
  method('loadMovieNum', function () { });
  method('getDepth', function () { return this.__d.depth; });
  method('getNextHighestDepth', function () { let m = -1; for (const c of this.__d.children) if (c.__d.depth > m) m = c.__d.depth; return Math.max(0, m + 1); });
  method('getInstanceAtDepth', function (dp) { return this.__d.byDepth.get(Number(dp)); });
  method('swapDepths', function (t) {
    const d = this.__d, p = d.parent; if (!p) return;
    const pd = p.__d;
    let other, nd;
    if (t != null && typeof t === 'object') { other = t; if (other.__d.parent !== p) return; nd = other.__d.depth; }
    else { nd = Math.floor(Number(t)); if (isNaN(nd)) return; other = pd.byDepth.get(nd); }
    const od = d.depth;
    detachChild(p, this);
    if (other && other !== this) { detachChild(p, other); insertChild(p, other, od); other.__d.timeline = false; if (other.__d.name) p[other.__d.name] = other; }
    insertChild(p, this, nd);
    d.timeline = false;
    if (d.name) p[d.name] = this;
  });
  method('getBytesLoaded', function () { return 1; });
  method('getBytesTotal', function () { return 1; });
  method('getSWFVersion', function () { return 8; });
  method('hitTest', function (a, b, shape) {
    if (this.__d.removed) return false;
    if (a != null && typeof a === 'object') {
      if (!a.__d || a.__d.removed) return false;
      const b1 = boundsIn(this, null), b2 = boundsIn(a, null);
      if (!b1 || !b2) return false;
      return b1[0] <= b2[2] && b2[0] <= b1[2] && b1[1] <= b2[3] && b2[1] <= b1[3];
    }
    return hitPoint(this, Number(a), Number(b), !!shape);
  });
  method('getBounds', function (space) {
    const b = boundsIn(this, space && space.__d ? space : null);
    if (!b) return { xMin: 6710886.35, xMax: 6710886.35, yMin: 6710886.35, yMax: 6710886.35 };
    return { xMin: b[0], yMin: b[1], xMax: b[2], yMax: b[3] };
  });
  method('getRect', function (space) { return this.getBounds(space); });
  method('localToGlobal', function (pt) { if (!pt) return; const p = mpt(worldMatrix(this), Number(pt.x) || 0, Number(pt.y) || 0); pt.x = p[0]; pt.y = p[1]; });
  method('globalToLocal', function (pt) { if (!pt) return; const p = mpt(minv(worldMatrix(this)), Number(pt.x) || 0, Number(pt.y) || 0); pt.x = p[0]; pt.y = p[1]; });
  method('setMask', function (m) {
    const d = this.__d;
    if (d.mask && d.mask.__d) d.mask.__d.maskOwner = null;
    d.mask = (m && m.__d) ? m : null;
    if (d.mask) d.mask.__d.maskOwner = this;
  });
  method('startDrag', function () { });
  method('stopDrag', function () { });
  method('getURL', function () { });
  method('createTextField', function (name, depth, x, y, w, h) {
    depth = Math.floor(Number(depth)) || 0;
    const old = this.__d.byDepth.get(depth);
    if (old) removeChild(this, old);
    const tf = KOF.makeTextField({ t: 'etext', b: [0, 0, Number(w) || 100, Number(h) || 20], h: 12, color: [0, 0, 0, 255], var: '', text: '' }, 0);
    tf.__d.m[4] = Number(x) || 0; tf.__d.m[5] = Number(y) || 0;
    insertChild(this, tf, depth);
    setName(this, tf, String(name));
    return tf;
  });
  method('attachBitmap', function (bmp, depth) {
    const d = this.__d; (d.bitmaps = d.bitmaps || []).push({ data: bmp, depth: Number(depth) || 0 });
  });
  // drawing API
  function gfx(o) { const d = o.__d; return d.gfx || (d.gfx = { cmds: [], bounds: null, x: 0, y: 0 }); }
  function gb(g, x, y, pad) {
    pad = pad || 0;
    if (!g.bounds) g.bounds = [x - pad, y - pad, x + pad, y + pad];
    else { g.bounds[0] = Math.min(g.bounds[0], x - pad); g.bounds[1] = Math.min(g.bounds[1], y - pad); g.bounds[2] = Math.max(g.bounds[2], x + pad); g.bounds[3] = Math.max(g.bounds[3], y + pad); }
  }
  method('clear', function () { const d = this.__d; d.gfx = null; });
  method('lineStyle', function (t, c, a) { gfx(this).cmds.push(['ls', t, c, a]); });
  method('beginFill', function (c, a) { gfx(this).cmds.push(['bf', c, a === undefined ? 100 : a]); });
  method('beginGradientFill', function (type, colors, alphas) { gfx(this).cmds.push(['bf', colors && colors[0], alphas ? alphas[0] : 100]); });
  method('endFill', function () { gfx(this).cmds.push(['ef']); });
  method('moveTo', function (x, y) { const g = gfx(this); g.cmds.push(['m', +x, +y]); gb(g, +x, +y); });
  method('lineTo', function (x, y) { const g = gfx(this); g.cmds.push(['l', +x, +y]); gb(g, +x, +y); });
  method('curveTo', function (cx, cy, x, y) { const g = gfx(this); g.cmds.push(['q', +cx, +cy, +x, +y]); gb(g, +x, +y); gb(g, +cx, +cy); });

  // ---------------------------------------------------------------- boot
  KOF.initDone = {};
  KOF.boot = function (data) {
    DATA = KOF.data = data;
    CHARS = data.chars;
    for (const n in data.exports) (EXPORT_BY_ID[data.exports[n]] = EXPORT_BY_ID[data.exports[n]] || []).push(n);
    KOF.exportById = EXPORT_BY_ID;
    const rootDef = { t: 'sprite', frames: data.root.frames, labels: data.root.labels };
    const root = KOF.root = makeClip(rootDef, 0, MP);
    root.__d.name = '_level0';
    root.__d.loaded = true;
    root.__d.where = 'root';
    gotoFrame(root, 1, true, true);
    drain();
  };
  KOF.createChar = createChar;
  KOF.removeChild = removeChild;
})();
