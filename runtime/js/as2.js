// AS2 language helpers used by the generated code (code.js) and the AS2 global objects.
// The generated code calls these through the `$` object.
'use strict';
(function () {
  const KOF = window.KOF = window.KOF || {};
  const SCT = KOF.SCT = Symbol('scopeTarget');
  const G = KOF.G = {};          // _global
  const B = KOF.B = {};          // builtins visible through the scope chain

  // ---------- scope chain (frame / event / function scopes) ----------
  const REG_RE = /^r\d+$/;
  function lookup(clip, k) {
    if (k in clip) return clip[k];
    if (k in G) return G[k];
    if (k in B) return B[k];
    return globalThis[k];
  }
  KOF.lookup = lookup;
  const scopeHandler = {
    has(t, k) {
      if (typeof k !== 'string') return false;
      const c = k.charCodeAt(0);
      if (c === 36) return false; // $
      if (k === 'arguments' || k === 'undefined' || REG_RE.test(k)) return false;
      return true;
    },
    get(t, k) {
      if (k === SCT) return t;
      if (typeof k !== 'string') return undefined;
      return lookup(t, k);
    },
    set(t, k, v) {
      if (!(k in t) && (k in G)) G[k] = v; else t[k] = v;
      return true;
    },
  };
  KOF.scopeOf = function (clip) {
    let d = clip.__d;
    if (d) { return d.scope || (d.scope = new Proxy(clip, scopeHandler)); }
    return new Proxy(clip, scopeHandler);
  };

  // ---------- path resolution ----------
  function resolveClipPath(base, path) {
    if (path == null) return undefined;
    if (typeof path === 'object' || typeof path === 'function') return path;
    path = String(path);
    if (path === '') return base;
    let cur = base;
    let parts;
    if (path.indexOf('/') >= 0) {
      if (path[0] === '/') { cur = KOF.root; path = path.slice(1); }
      parts = path.split('/');
    } else parts = path.split('.');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === '' ) continue;
      if (cur == null) return undefined;
      if (p === '..') cur = cur._parent;
      else if (p === '_root') cur = KOF.rootOf(cur); else if (p === '_level0') cur = KOF.root;
      else if (p === '_parent') cur = cur._parent;
      else if (p === '_global') cur = G;
      else if (p === 'this') cur = cur;
      else if (i === 0 && !(p in cur)) cur = lookup(cur, p);
      else cur = cur[p];
    }
    return cur;
  }
  KOF.resolveClipPath = resolveClipPath;

  function splitVarPath(name) {
    name = String(name);
    let i = name.lastIndexOf(':');
    if (i >= 0) return [name.slice(0, i), name.slice(i + 1)];
    i = name.lastIndexOf('.');
    if (i >= 0 && name.indexOf('/') < 0) return [name.slice(0, i), name.slice(i + 1)];
    return [null, name];
  }

  const $ = KOF.$ = {};
  $.m = function (o, k) { return o == null ? undefined : o[k]; };
  $.sm = function (o, k, v) { if (o != null && (typeof o === 'object' || typeof o === 'function')) o[k] = v; };
  $.cm = function (o, k, a) {
    if (o == null) return undefined;
    const f = o[k];
    if (typeof f !== 'function') return undefined;
    return f.apply(o, a);
  };
  $.call = function (f, a) { return typeof f === 'function' ? f.apply(undefined, a) : undefined; };
  $.lc = function (f, a) { return typeof f === 'function' ? f.apply(undefined, a) : undefined; };
  $.cf = function (sc, name, a) {
    const clip = sc[SCT];
    let f, self;
    if (name in clip) { f = clip[name]; self = clip; }
    else if (name in G) { f = G[name]; self = G; }
    else if (name in B) { f = B[name]; self = undefined; }
    else { f = globalThis[name]; self = undefined; }
    if (typeof f !== 'function') return undefined;
    return f.apply(self, a);
  };
  $.nw = function (C, a) {
    if (typeof C !== 'function') return undefined;
    return new C(...a);
  };
  $.gv = function (sc, name) {
    const clip = sc[SCT];
    const [path, v] = splitVarPath(name);
    if (path === null) {
      if (v.indexOf('/') >= 0) return resolveClipPath($.T(sc), v);
      return lookup(clip, v);
    }
    const t = resolveClipPath($.T(sc), path);
    return t == null ? undefined : t[v];
  };
  $.sv = function (sc, name, val) {
    const clip = sc[SCT];
    const [path, v] = splitVarPath(name);
    if (path === null) { sc[v] = val; return; }
    const t = resolveClipPath($.T(sc), path);
    if (t != null) t[v] = val;
  };
  $.del = function (o, k) { if (o == null) return false; return delete o[k]; };
  $.del2 = function (sc, k) { const c = sc[SCT]; if (k in c) return delete c[k]; if (k in G) return delete G[k]; return false; };
  $.T = function (sc) { const c = sc[SCT]; return (c.__d && c.__d.tell) || c; };
  $.tgt = function (sc, t) { if (t == null) return undefined; if (typeof t === 'object') return t; return resolveClipPath($.T(sc), t); };
  $.tell = function (sc, p) { const c = sc[SCT]; if (!c.__d) return; c.__d.tell = (p === '' || p == null) ? null : $.tgt({ [SCT]: c }, p); };
  $.trace = function (v) { if (KOF.debug) console.log('[trace]', v); };
  $.getURL = function () { };
  $.rm = function (sc, t) { t = $.tgt(sc, t); if (t && t.removeMovieClip) t.removeMovieClip(); };
  $.dup = function (sc, s, name, depth) { s = $.tgt(sc, s); if (s && s.duplicateMovieClip) s.duplicateMovieClip(name, depth); };
  $.startDrag = function () { };
  $.endDrag = function () { };
  $.stopSounds = function () { KOF.audio && KOF.audio.stopAll(); };
  $.toggleQuality = function () { };
  $.cast = function (C, o) { return (typeof C === 'function' && o instanceof C) ? o : null; };
  $.ext = function (sub, sup) {
    if (typeof sub !== 'function' || typeof sup !== 'function') return;
    const p = Object.create(sup.prototype);
    Object.defineProperty(p, '__constructor__', { value: sup, writable: true, enumerable: false, configurable: true });
    Object.defineProperty(p, 'constructor', { value: sub, writable: true, enumerable: false, configurable: true });
    sub.prototype = p;
  };
  $.forin = function (o) {
    const keys = [];
    if (o != null && (typeof o === 'object' || typeof o === 'function')) {
      for (const k in o) keys.push(k);
      keys.reverse();
    }
    let i = 0;
    return { next() { return i < keys.length ? keys[i++] : null; } };
  };
  $.callFrame = function (sc, f) { const t = $.T(sc); if (t && t.__callFrame) t.__callFrame(f); };
  const ownerCache = new WeakMap();
  function ownerOf(self, callee) {
    let o = ownerCache.get(callee);
    if (o) return o;
    if (callee.prototype && Object.prototype.hasOwnProperty.call(callee.prototype, '__constructor__')) {
      // constructor of a class
    }
    let p = Object.getPrototypeOf(self);
    while (p) {
      if (p.constructor === callee && Object.prototype.hasOwnProperty.call(p, 'constructor')) { o = p; break; }
      const names = Object.getOwnPropertyNames(p);
      let hit = false;
      for (const n of names) {
        const desc = Object.getOwnPropertyDescriptor(p, n);
        if (desc && desc.value === callee) { hit = true; break; }
      }
      if (hit) { o = p; break; }
      p = Object.getPrototypeOf(p);
    }
    if (o) ownerCache.set(callee, o);
    return o;
  }
  $.supc = function (self, callee, a) {
    let C = callee.prototype && callee.prototype.__constructor__;
    if (!C) { const o = ownerOf(self, callee); C = o && o.__constructor__; }
    if (typeof C === 'function' && !C.__native) return C.apply(self, a);
  };
  $.supm = function (self, callee, name, a) {
    const o = ownerOf(self, callee);
    const sp = o ? Object.getPrototypeOf(o) : null;
    const f = sp ? sp[name] : undefined;
    return typeof f === 'function' ? f.apply(self, a) : undefined;
  };
  $.supg = function (self, callee, name) { const o = ownerOf(self, callee); const sp = o ? Object.getPrototypeOf(o) : null; return sp ? sp[name] : undefined; };
  $.sadd = function (a, b) { return String(a) + String(b); };
  $.eq1 = function (a, b) { return Number(a) == Number(b); };
  $.and1 = function (a, b) { return !!a && !!b; };
  $.or1 = function (a, b) { return !!a || !!b; };
  $.int = function (x) { x = Number(x); return isFinite(x) ? Math.trunc(x) : 0; };
  $.typeOf = function (x) {
    if (x === null) return 'null';
    if (x && x.__d && x.__d.kind === 'clip') return 'movieclip';
    return typeof x;
  };
  $.ord = function (s) { s = String(s); return s.length ? s.charCodeAt(0) : 0; };
  $.slen = function (s) { return String(s).length; };
  $.random = function (n) { return Math.floor(Math.random() * Number(n)) || 0; };
  $.targetPath = function (c) { return c && c._target !== undefined ? c._target : undefined; };
  $.substr = function (s, i, c) { s = String(s); i = Math.max(0, $.int(i) - 1); return s.substr(i, $.int(c)); };
  $.getProp = function (t, i) { return t ? t[KOF.PROPS[i]] : undefined; };
  $.setProp = function (t, i, v) { if (t) t[KOF.PROPS[i]] = v; };
  KOF.PROPS = ['_x', '_y', '_xscale', '_yscale', '_currentframe', '_totalframes', '_alpha', '_visible', '_width', '_height', '_rotation', '_target', '_framesloaded', '_name', '_droptarget', '_url', '_highquality', '_focusrect', '_soundbuftime', '_quality', '_xmouse', '_ymouse'];

  // ---------- AS2 flavoured built-ins ----------
  const t0 = performance.now();
  B.getTimer = function () { return Math.floor(performance.now() - t0); };
  B.trace = $.trace;
  B.int = $.int;
  B.random = $.random;
  B.targetPath = $.targetPath;
  B.escape = function (s) { return escape(String(s)); };
  B.unescape = function (s) { return unescape(String(s)); };
  B.getVersion = function () { return 'WIN 8,0,0,0'; };
  B.fscommand = function () { };
  B.updateAfterEvent = function () { };
  B.ASSetPropFlags = function (o, names, set) {
    if (o == null) return;
    if (set & 1) {
      const list = names == null ? Object.keys(o) : (typeof names === 'string' ? names.split(',') : names);
      for (const n of list) {
        const d = Object.getOwnPropertyDescriptor(o, n);
        if (d && d.configurable) { d.enumerable = false; Object.defineProperty(o, n, d); }
      }
    }
  };
  B.ASnative = function () { return function () { }; };
  B._global = G;
  Object.defineProperty(B, '_level0', { get() { return KOF.root; } });
  Object.defineProperty(B, '_root', { get() { return KOF.root; } });

  // intervals (driven by the frame clock so they pause with the game)
  const intervals = new Map(); let nextIv = 1;
  function addTimer(args, repeat) {
    let fn, self, ms, extra;
    if (typeof args[0] === 'function') { fn = args[0]; self = undefined; ms = args[1]; extra = args.slice(2); }
    else { self = args[0]; fn = self ? self[args[1]] : undefined; ms = args[2]; extra = args.slice(3); const nm = args[1]; fn = function () { const f = self && self[nm]; if (typeof f === 'function') return f.apply(self, arguments); }; }
    if (typeof fn !== 'function') return 0;
    const id = nextIv++;
    ms = Math.max(1, Number(ms) || 1);
    intervals.set(id, { fn, self, ms, extra, next: performance.now() + ms, repeat });
    return id;
  }
  B.setInterval = function () { return addTimer(Array.from(arguments), true); };
  B.setTimeout = function () { return addTimer(Array.from(arguments), false); };
  B.clearInterval = B.clearTimeout = function (id) { intervals.delete(id); };
  KOF.runIntervals = function (now) {
    for (const [id, iv] of intervals) {
      if (now >= iv.next) {
        let n = 0;
        while (now >= iv.next && n < 4) {
          iv.next += iv.ms; n++;
          if (!iv.repeat) intervals.delete(id);
          try { iv.fn.apply(iv.self, iv.extra); } catch (e) { KOF.reportError(e, 'interval'); }
          if (!iv.repeat || !intervals.has(id)) break;
        }
        if (now >= iv.next) iv.next = now + iv.ms;
      }
    }
  };
  KOF.clearIntervals = function () { intervals.clear(); };

  // Array extras
  Array.CASEINSENSITIVE = 1; Array.DESCENDING = 2; Array.UNIQUESORT = 4; Array.RETURNINDEXEDARRAY = 8; Array.NUMERIC = 16;
  const nativeSort = Array.prototype.sort;
  function cmpFor(opts) {
    return function (a, b) {
      let x = a, y = b;
      if (opts & 16) { x = Number(x); y = Number(y); return (x - y) || 0; }
      x = String(x); y = String(y);
      if (opts & 1) { x = x.toLowerCase(); y = y.toLowerCase(); }
      return x < y ? -1 : x > y ? 1 : 0;
    };
  }
  Object.defineProperty(Array.prototype, 'sort', {
    value: function (f, opts) {
      if (typeof f === 'number') { opts = f; f = undefined; }
      opts = opts | 0;
      let cmp = f || cmpFor(opts);
      const c2 = (opts & 2) ? (a, b) => -cmp(a, b) : cmp;
      if (opts & 8) { const idx = this.map((v, i) => i); nativeSort.call(idx, (i, j) => c2(this[i], this[j])); return idx; }
      return nativeSort.call(this, c2);
    }, writable: true, configurable: true, enumerable: false,
  });
  Object.defineProperty(Array.prototype, 'sortOn', {
    value: function (field, opts) {
      opts = opts | 0;
      const fields = Array.isArray(field) ? field : [field];
      const base = cmpFor(opts);
      const cmp = (a, b) => { for (const f of fields) { const r = base(a && a[f], b && b[f]); if (r) return r; } return 0; };
      const c2 = (opts & 2) ? (a, b) => -cmp(a, b) : cmp;
      if (opts & 8) { const idx = this.map((v, i) => i); nativeSort.call(idx, (i, j) => c2(this[i], this[j])); return idx; }
      return nativeSort.call(this, c2);
    }, writable: true, configurable: true, enumerable: false,
  });
  Object.defineProperty(Object.prototype, 'watch', { value: function () { return false; }, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(Object.prototype, 'unwatch', { value: function () { return false; }, writable: true, configurable: true, enumerable: false });
  Object.defineProperty(Object.prototype, 'addProperty', { value: function (name, getter, setter) { Object.defineProperty(this, name, { get: typeof getter === 'function' ? getter : undefined, set: typeof setter === 'function' ? setter : undefined, configurable: true, enumerable: false }); return true; }, writable: true, configurable: true, enumerable: false });
  Object.registerClass = function (name, cls) { KOF.classes[name] = cls; return true; };
  KOF.classes = {};

  // System / misc stubs
  B.System = { capabilities: { language: 'zh-CN', os: 'Windows', version: 'WIN 8,0,0,0', playerType: 'PlugIn', screenResolutionX: 1920, screenResolutionY: 1080 }, useCodepage: false, security: { allowDomain() { }, allowInsecureDomain() { }, loadPolicyFile() { } }, showSettings() { } };
  B.Mouse = { hide() { KOF.canvas && (KOF.canvas.style.cursor = 'none'); }, show() { KOF.canvas && (KOF.canvas.style.cursor = ''); }, addListener() { }, removeListener() { } };
  B.Selection = { setFocus() { }, getFocus() { return null; } };
  B.Accessibility = { isActive() { return false; } };
  function Stub() { }
  Stub.prototype = { load() { }, send() { }, sendAndLoad() { }, connect() { return false; }, close() { }, addRequestHeader() { } };
  B.LoadVars = B.XML = B.XMLSocket = B.LocalConnection = B.NetConnection = B.NetStream = B.ContextMenu = B.ContextMenuItem = function () { };
  for (const n of ['LoadVars', 'XML', 'XMLSocket', 'LocalConnection', 'NetConnection', 'NetStream', 'ContextMenu', 'ContextMenuItem']) { B[n] = function () { }; B[n].prototype = Object.create(Stub.prototype); }
  B.ContextMenu.prototype.hideBuiltInItems = function () { };
  B.ContextMenu.prototype.customItems = [];

  // SharedObject -> localStorage
  const soCache = {};
  B.SharedObject = {
    getLocal(name) {
      if (soCache[name]) return soCache[name];
      let data = {};
      try { data = JSON.parse(localStorage.getItem('kofwing.so.' + name) || '{}') || {}; } catch (e) { }
      const so = { data, flush() { try { localStorage.setItem('kofwing.so.' + name, JSON.stringify(this.data)); } catch (e) { } return true; }, clear() { this.data = {}; this.flush(); }, getSize() { return 1; } };
      return soCache[name] = so;
    },
  };

  KOF.reportError = function (e, where) {
    KOF.errCount = (KOF.errCount || 0) + 1;
    if (KOF.errCount < 200) console.warn('[as2 error]', where, e);
  };
})();
