// Canvas renderer, text fields, buttons and the AS2 Color / TextFormat classes.
'use strict';
(function () {
  const KOF = window.KOF;
  const B = KOF.B;
  const { mmul } = KOF;
  const IDCX = [1, 1, 1, 1, 0, 0, 0, 0];

  // ---------------------------------------------------------------- shape images
  const images = new Map();     // shape id -> HTMLImageElement / canvas
  let atlas = null;             // optional: {id: [page, x, y, w, h]}
  const pages = [];
  KOF.loadAtlas = function (manifest, base) {
    atlas = manifest.map;
    const ps = manifest.pages.map((src) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = base + src;
      pages.push(im);
    }));
    return ps;
  };
  function shapeImage(id) {
    let im = images.get(id);
    if (im !== undefined) return im && im.complete !== false && (im.naturalWidth !== 0 || im.width) ? im : null;
    if (atlas && atlas[id]) {
      const [p, x, y, w, h] = atlas[id];
      im = { atlas: pages[p], x, y, w, h, complete: true, width: w };
      images.set(id, im);
      return pages[p] && pages[p].complete ? im : null;
    }
    im = new Image();
    im.src = 'assets/shapes/' + id + '.webp';
    images.set(id, im);
    return null;
  }
  KOF.shapeImage = shapeImage;
  KOF.imageEl = function (id) { return images.get(id); };
  KOF.shapeHit = function () { return true; };

  // tinted copies (colour transforms other than alpha)
  const tintCache = new Map();
  function tinted(id, im, cx) {
    const key = id + '|' + cx.slice(0, 3).map((v) => v.toFixed(2)).join(',') + '|' + cx.slice(4, 7).map((v) => Math.round(v)).join(',');
    let c = tintCache.get(key);
    if (c) return c;
    const w = im.atlas ? im.w : im.naturalWidth || im.width, h = im.atlas ? im.h : im.naturalHeight || im.height;
    if (!w || !h) return null;
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const draw = () => { if (im.atlas) g.drawImage(im.atlas, im.x, im.y, w, h, 0, 0, w, h); else g.drawImage(im, 0, 0); };
    draw();
    const mr = Math.min(1, Math.max(0, cx[0])), mg = Math.min(1, Math.max(0, cx[1])), mb = Math.min(1, Math.max(0, cx[2]));
    if (mr < 1 || mg < 1 || mb < 1) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${mr * 255},${mg * 255},${mb * 255})`; g.fillRect(0, 0, w, h);
    }
    const ar = cx[4], ag = cx[5], ab = cx[6];
    if (ar > 0 || ag > 0 || ab > 0) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgb(${Math.max(0, ar)},${Math.max(0, ag)},${Math.max(0, ab)})`; g.fillRect(0, 0, w, h);
    }
    if (ar < 0 || ag < 0 || ab < 0) {
      g.globalCompositeOperation = 'difference';
      g.fillStyle = 'white'; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgb(${Math.max(0, -ar)},${Math.max(0, -ag)},${Math.max(0, -ab)})`; g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'difference';
      g.fillStyle = 'white'; g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'destination-in';
    draw();
    if (tintCache.size > 600) tintCache.delete(tintCache.keys().next().value);
    tintCache.set(key, c);
    return c;
  }

  // ---------------------------------------------------------------- fonts / glyphs
  const glyphCache = new Map();
  function glyphPath(fontId, gi) {
    const k = fontId * 65536 + gi;
    let p = glyphCache.get(k);
    if (p === undefined) {
      const f = KOF.data.chars[fontId];
      const s = f && f.glyphs && f.glyphs[gi];
      p = s ? new Path2D(s) : null;
      glyphCache.set(k, p);
    }
    return p;
  }
  function fontCodeMap(f) {
    if (!f.codeMap) { f.codeMap = new Map(); (f.codes || []).forEach((c, i) => f.codeMap.set(c, i)); }
    return f.codeMap;
  }

  // ---------------------------------------------------------------- render tree
  let ctx, canvas, scale = 1, dpr = 1;
  const offPool = [];
  function getOff(w, h) {
    let c = offPool.pop();
    if (!c) { c = document.createElement('canvas'); }
    if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    return c;
  }
  function putOff(c) { offPool.push(c); }

  function cxcat(p, c) {
    if (c === IDCX) return p;
    return [p[0] * c[0], p[1] * c[1], p[2] * c[2], p[3] * c[3],
      p[0] * c[4] + p[4], p[1] * c[5] + p[5], p[2] * c[6] + p[6], p[3] * c[7] + p[7]];
  }
  function isTint(cx) { return cx[0] !== 1 || cx[1] !== 1 || cx[2] !== 1 || cx[4] !== 0 || cx[5] !== 0 || cx[6] !== 0; }
  // (ox, oy): device-pixel origin of the layer currently drawn into (0 for the stage canvas)
  let ox = 0, oy = 0;
  function setT(g, m) { g.setTransform(m[0] * scale, m[1] * scale, m[2] * scale, m[3] * scale, m[4] * scale - ox, m[5] * scale - oy); }
  KOF.setT = setT;

  // Device-pixel box of node o drawn under parent matrix pm, clipped to the target g; null when empty.
  function devBox(g, o, pm) {
    const lb = KOF.localBounds(o);
    if (!lb) return null;
    const m = mmul(pm, o.__d.m);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of [[lb[0], lb[1]], [lb[2], lb[1]], [lb[0], lb[3]], [lb[2], lb[3]]]) {
      const x = (m[0] * px + m[2] * py + m[4]) * scale, y = (m[1] * px + m[3] * py + m[5]) * scale;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    }
    x0 = Math.max(Math.floor(x0) - 1, ox); y0 = Math.max(Math.floor(y0) - 1, oy);
    x1 = Math.min(Math.ceil(x1) + 1, ox + g.canvas.width); y1 = Math.min(Math.ceil(y1) + 1, oy + g.canvas.height);
    return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
  }
  // A mask that is a single fully opaque rectangle (most HUD masks) can be a clip path instead of a layer.
  function rectMask(o, pm) {
    let m = mmul(pm, o.__d.m);
    for (;;) {
      const d = o.__d;
      if (d.kind === 'shape') return d.def.op ? { m, b: d.def.b } : null;
      if (d.kind !== 'clip' || d.gfx || d.bitmaps || d.mask || d.children.length !== 1) return null;
      o = d.children[0];
      m = mmul(m, o.__d.m);
    }
  }
  // Draw content masked by a mask node: clip path for rectangles, otherwise an offscreen layer the size of the mask.
  function drawMasked(g, maskNode, maskPm, drawContent) {
    const r = rectMask(maskNode, maskPm);
    if (r) {
      g.save();
      setT(g, r.m);
      g.beginPath(); g.rect(r.b[0], r.b[1], r.b[2] - r.b[0], r.b[3] - r.b[1]); g.clip();
      drawContent(g);
      g.restore();
      return;
    }
    const box = devBox(g, maskNode, maskPm);
    if (!box) return;
    const w = box[2] - box[0], h = box[3] - box[1];
    const sox = ox, soy = oy;
    const layer = getOff(w, h), lg = layer.getContext('2d');
    const mk = getOff(w, h), mg = mk.getContext('2d');
    ox = box[0]; oy = box[1];
    try { drawContent(lg); drawNode(mg, maskNode, maskPm, IDCX, true); } finally { ox = sox; oy = soy; }
    lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalAlpha = 1; lg.globalCompositeOperation = 'destination-in';
    lg.drawImage(mk, 0, 0, w, h, 0, 0, w, h);
    lg.globalCompositeOperation = 'source-over';
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(layer, 0, 0, w, h, box[0] - ox, box[1] - oy, w, h);
    putOff(layer); putOff(mk);
  }

  function drawNode(g, o, pm, pcx, isMaskPass) {
    const d = o.__d;
    if (!d.visible && !isMaskPass) return;
    if (d.maskOwner && !isMaskPass) return; // used as a mask by setMask
    const m = mmul(pm, d.m);
    const cx = cxcat(pcx, d.cx);
    if (cx[3] <= 0 && cx[7] <= 0 && !isMaskPass) return;
    if (d.mask && d.mask.__d && !d.mask.__d.removed) {
      // setMask: the mask lives elsewhere in the tree, so it is drawn with its own world matrix
      const saved = d.mask;
      const mpar = saved.__d.parent;
      const mm = mpar ? (KOF.inBitmapDraw ? null : KOF.worldMatrix(mpar)) : [1, 0, 0, 1, 0, 0];
      d.mask = null;
      if (!mm) { try { drawNode(g, o, pm, pcx, false); } finally { d.mask = saved; } return; }
      try { drawMasked(g, saved, mm, (lg) => drawNode(lg, o, pm, pcx, false)); } finally { d.mask = saved; }
      return;
    }
    switch (d.kind) {
      case 'clip': drawClip(g, o, m, cx, isMaskPass); break;
      case 'shape': case 'morph': drawShape(g, d, m, cx); break;
      case 'text': drawText(g, d, m, cx); break;
      case 'etext': KOF.drawTextField(g, o, m, cx, scale); break;
      case 'button': for (const c of KOF.buttonChildren(o)) drawNode(g, c, m, cx, isMaskPass); break;
    }
  }
  function drawClip(g, o, m, cx, isMaskPass) {
    const d = o.__d;
    if (d.gfx) drawGfx(g, d.gfx, m, cx);
    if (d.bitmaps) for (const bm of d.bitmaps) { if (bm.data && bm.data.canvas) { setT(g, m); g.globalAlpha = Math.max(0, Math.min(1, cx[3])); g.drawImage(bm.data.canvas, 0, 0, bm.data.width, bm.data.height); } }
    const ch = d.children;
    for (let i = 0; i < ch.length; i++) {
      const c = ch[i];
      const cd = c.__d;
      if (cd.clipDepth) {
        // timeline mask layer: children with depth in (depth, clipDepth] are masked
        const limit = cd.clipDepth - 16384;
        const masked = [];
        let j = i + 1;
        while (j < ch.length && ch[j].__d.depth <= limit) { masked.push(ch[j]); j++; }
        if (masked.length) drawMasked(g, c, m, (lg) => { for (const mc of masked) drawNode(lg, mc, m, cx, isMaskPass); });
        i = j - 1;
        continue;
      }
      drawNode(g, c, m, cx, isMaskPass);
    }
  }
  function lerpPath(a, b, t) {
    const na = a.match(/-?[\d.]+(e-?\d+)?/g), nb = b.match(/-?[\d.]+(e-?\d+)?/g);
    if (!na || !nb || na.length !== nb.length) return t < 0.5 ? a : b;
    let i = 0;
    return a.replace(/-?[\d.]+(e-?\d+)?/g, () => { const v = +na[i] + (+nb[i] - na[i]) * t; i++; return v.toFixed(2); });
  }
  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    return [16, 8, 0].map(s => ((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * t);
  }
  function drawMorph(g, d, m, cx) {
    const t = (d.ratio || 0) / 65535;
    setT(g, m);
    g.globalAlpha = 1;
    for (const p of d.def.mp) {
      const c = lerpHex(p.f[0], p.f[1], t), a = (p.a[0] + (p.a[1] - p.a[0]) * t) * 255;
      g.fillStyle = colorStr(c, cx);
      g.globalAlpha = Math.max(0, Math.min(1, (a * cx[3] + cx[7]) / 255));
      g.fill(new Path2D(lerpPath(p.d[0], p.d[1], t)), 'evenodd');
    }
  }
  function drawShape(g, d, m, cx) {
    if (d.def.mp) return drawMorph(g, d, m, cx);
    const im = shapeImage(d.id);
    if (!im) return;
    const b = d.def.b;
    setT(g, m);
    let a = cx[3] + cx[7] / 255;
    g.globalAlpha = a > 1 ? 1 : a < 0 ? 0 : a;
    if (isTint(cx)) {
      const t = tinted(d.id, im, cx);
      if (t) g.drawImage(t, b[0], b[1], b[2] - b[0], b[3] - b[1]);
      return;
    }
    if (im.atlas) g.drawImage(im.atlas, im.x, im.y, im.w, im.h, b[0], b[1], b[2] - b[0], b[3] - b[1]);
    else g.drawImage(im, b[0], b[1], b[2] - b[0], b[3] - b[1]);
  }
  function colorStr(c, cx) {
    const r = Math.max(0, Math.min(255, c[0] * cx[0] + cx[4])), gg = Math.max(0, Math.min(255, c[1] * cx[1] + cx[5])), b = Math.max(0, Math.min(255, c[2] * cx[2] + cx[6]));
    return `rgb(${r | 0},${gg | 0},${b | 0})`;
  }
  function drawText(g, d, m, cx) {
    const def = d.def;
    const tm = mmul(m, def.m);
    let font = null, color = [0, 0, 0, 255], h = 12, x = 0, y = 0;
    for (const rec of def.recs) {
      if (rec.font !== undefined) font = rec.font;
      if (rec.color) color = rec.color;
      if (rec.h !== undefined) h = rec.h;
      if (rec.x !== undefined) x = rec.x;
      if (rec.y !== undefined) y = rec.y;
      const f = KOF.data.chars[font];
      if (!f) continue;
      const s = h / f.em;
      g.fillStyle = colorStr(color, cx);
      let a = (color[3] / 255) * cx[3] + cx[7] / 255;
      g.globalAlpha = Math.max(0, Math.min(1, a));
      for (const [gi, adv] of rec.g) {
        const p = glyphPath(font, gi);
        if (p) {
          const gm = mmul(tm, [s, 0, 0, s, x, y]);
          setT(g, gm);
          g.fill(p, 'evenodd');
        }
        x += adv;
      }
    }
  }
  function drawGfx(g, gx, m, cx) {
    setT(g, m);
    let fill = null, stroke = null, lw = 1;
    let open = false;
    g.beginPath();
    const flush = () => {
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
      g.beginPath();
    };
    const col = (c, a) => { c = Number(c) || 0; return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${Math.max(0, Math.min(1, (a === undefined ? 100 : a) / 100 * cx[3]))})`; };
    for (const c of gx.cmds) {
      switch (c[0]) {
        case 'ls': flush(); stroke = c[1] === undefined || c[1] === null || isNaN(c[1]) ? null : col(c[2], c[3]); lw = Math.max(1, Number(c[1]) || 1); break;
        case 'bf': flush(); fill = col(c[1], c[2]); break;
        case 'ef': flush(); fill = null; break;
        case 'm': g.moveTo(c[1], c[2]); break;
        case 'l': g.lineTo(c[1], c[2]); break;
        case 'q': g.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
      }
    }
    flush();
  }

  // BitmapData.draw: render a clip's content (ignoring its own transform) into a bitmap canvas
  KOF.drawToBitmap = function (g, o, M, res) {
    const d = o.__d; if (!d) return;
    const saved = scale, vis = d.visible, sox = ox, soy = oy;
    scale = res; d.visible = true; ox = oy = 0; KOF.inBitmapDraw = true;
    try { drawNode(g, o, mmul(M, KOF.minv(d.m)), IDCX, false); } finally { scale = saved; d.visible = vis; ox = sox; oy = soy; KOF.inBitmapDraw = false; }
  };
  KOF.render = function () {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = KOF.data.bg || '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    drawNode(g, KOF.root, [1, 0, 0, 1, 0, 0], IDCX, false);
  };
  KOF.setCanvas = function (c) {
    canvas = c; ctx = c.getContext('2d');
    KOF.canvas = c;
  };
  // The game is 660x485; drawing it at more than 2x that adds little detail but costs a lot of
  // fill rate on high-DPI tablets, so the backing store is capped (and lowered further if frames run slow).
  KOF.maxScale = 2;
  let lastCss = null;
  KOF.resize = function (cssW, cssH) {
    lastCss = [cssW, cssH];
    dpr = window.devicePixelRatio || 1;
    const W = KOF.data.stage[0], H = KOF.data.stage[1];
    const s = Math.min(cssW / W, cssH / H);
    canvas.style.width = Math.floor(W * s) + 'px';
    canvas.style.height = Math.floor(H * s) + 'px';
    scale = Math.max(0.5, Math.min(s * dpr, KOF.maxScale));
    canvas.width = Math.floor(W * scale); canvas.height = Math.floor(H * scale);
    KOF.viewScale = s;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
  };
  KOF.lowerQuality = function () {
    if (KOF.maxScale <= 1 || !lastCss) return false;
    KOF.maxScale = Math.max(1, KOF.maxScale - 0.25);
    KOF.resize(lastCss[0], lastCss[1]);
    return true;
  };

  // ---------------------------------------------------------------- buttons
  function Button() { }
  KOF.Button = Button;
  B.Button = Button;
  KOF.copyTransformProps(Button.prototype);
  Object.defineProperty(Button.prototype, 'enabled', { get() { return this.__d.enabled !== false; }, set(v) { this.__d.enabled = !!v; }, configurable: true });
  KOF.buttonChildren = function (o, stateOverride) {
    const d = o.__d;
    const st = stateOverride || d.state || 1;
    d.kids = d.kids || {};
    if (!d.kids[st]) {
      const list = [];
      for (const r of d.def.recs) {
        if (!(r.st & st)) continue;
        const c = KOF.createChar(r.c);
        if (!c) continue;
        c.__d.m = r.m.slice(); c.__d.cx = r.cx; c.__d.parent = o; c.__d.depth = r.d;
        if (c.__d.kind === 'clip') { KOF.gotoFrame(c, 1, true, true); }
        list.push(c);
      }
      list.sort((a, b) => a.__d.depth - b.__d.depth);
      d.kids[st] = list;
    }
    return d.kids[st];
  };

  // ---------------------------------------------------------------- Color
  function Color(t) { this.__t = t; }
  Color.prototype.setRGB = function (rgb) {
    const t = this.__t; if (!t || !t.__d) return;
    rgb = Number(rgb) || 0;
    const d = t.__d; const a = d.cx;
    d.cx = [0, 0, 0, a[3], (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, a[7]];
  };
  Color.prototype.getRGB = function () { const t = this.__t; if (!t || !t.__d) return 0; const c = t.__d.cx; return ((c[4] & 255) << 16) | ((c[5] & 255) << 8) | (c[6] & 255); };
  Color.prototype.setTransform = function (o) {
    const t = this.__t; if (!t || !t.__d || !o) return;
    const d = t.__d; const c = d.cx.slice();
    const n = (v, def) => { v = Number(v); return isNaN(v) ? def : v; };
    if (o.ra !== undefined) c[0] = n(o.ra, 100) / 100;
    if (o.ga !== undefined) c[1] = n(o.ga, 100) / 100;
    if (o.ba !== undefined) c[2] = n(o.ba, 100) / 100;
    if (o.aa !== undefined) c[3] = n(o.aa, 100) / 100;
    if (o.rb !== undefined) c[4] = n(o.rb, 0);
    if (o.gb !== undefined) c[5] = n(o.gb, 0);
    if (o.bb !== undefined) c[6] = n(o.bb, 0);
    if (o.ab !== undefined) c[7] = n(o.ab, 0);
    d.cx = c;
  };
  Color.prototype.getTransform = function () {
    const t = this.__t; const c = t && t.__d ? t.__d.cx : IDCX;
    return { ra: c[0] * 100, ga: c[1] * 100, ba: c[2] * 100, aa: c[3] * 100, rb: c[4], gb: c[5], bb: c[6], ab: c[7] };
  };
  B.Color = Color;

  // ---------------------------------------------------------------- TextField / TextFormat
  function TextFormat(font, size, color, bold, italic, underline, url, target, align, leftMargin, rightMargin, indent, leading) {
    this.font = font; this.size = size; this.color = color; this.bold = bold; this.italic = italic; this.underline = underline;
    this.url = url; this.target = target; this.align = align; this.leftMargin = leftMargin; this.rightMargin = rightMargin; this.indent = indent; this.leading = leading;
  }
  TextFormat.prototype.getTextExtent = function (s) { return { width: String(s).length * (this.size || 12) * 0.6, height: (this.size || 12) * 1.2, textFieldWidth: String(s).length * (this.size || 12) * 0.6 + 4, textFieldHeight: (this.size || 12) * 1.2 + 4 }; };
  B.TextFormat = TextFormat;

  function TextField() { }
  KOF.TextField = TextField;
  B.TextField = TextField;
  KOF.copyTransformProps(TextField.prototype);
  const TP = TextField.prototype;
  function stripHtml(s) {
    return String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n$/, '');
  }
  function htmlColor(s) { const m = /color\s*=\s*["']?#([0-9a-f]{6})/i.exec(String(s)); return m ? parseInt(m[1], 16) : null; }
  KOF.makeTextField = function (def, cid) {
    const o = Object.create(TP);
    const d = {
      kind: 'etext', def, id: cid, parent: null, depth: 0, name: '', m: [1, 0, 0, 1, 0, 0], sx: 1, sy: 1, rx: 0, ry: 0, cx: IDCX, visible: true,
      rec: 0, timeline: false, scripted: false, removed: false, ratio: 0, clipDepth: 0,
      tf: { x: def.b[0], y: def.b[1], w: def.b[2] - def.b[0], h: def.b[3] - def.b[1] },
      text: def.text !== undefined ? (def.html ? stripHtml(def.text) : String(def.text)) : '',
      html: !!def.html, htmlColor: def.html ? htmlColor(def.text || '') : null,
      fmt: { font: null, size: def.h || 12, color: def.color ? (def.color[0] << 16 | def.color[1] << 8 | def.color[2]) : 0, align: ['left', 'right', 'center', 'justify'][def.align || 0] || 'left', bold: false },
      variable: def.var || null, autoSize: def.auto ? 'left' : 'none', wordWrap: !!def.wrap, multiline: !!def.multi,
      border: !!def.border, background: false, bgColor: 0xffffff, borderColor: 0, embed: !!def.outl,
    };
    Object.defineProperty(o, '__d', { value: d, writable: true, enumerable: false, configurable: true });
    return o;
  };
  KOF.textFieldPlaced = function (tf, parent) { tf.__d.owner = parent; };
  function textVarTarget(tf) {
    const d = tf.__d;
    if (!d.variable) return null;
    const v = String(d.variable);
    let owner = d.parent || d.owner; if (!owner) return null;
    let path = null, name = v;
    const i = Math.max(v.lastIndexOf('.'), v.lastIndexOf(':'));
    if (i >= 0) { path = v.slice(0, i); name = v.slice(i + 1); }
    const t = path ? KOF.resolveClipPath(owner, path) : owner;
    return t ? [t, name] : null;
  }
  KOF.updateTextVars = function () {
    // bound variables are read at draw time; nothing to do per tick
  };
  function tfText(tf) {
    const d = tf.__d;
    const vt = textVarTarget(tf);
    if (vt) {
      const v = vt[0][vt[1]];
      if (v !== undefined) { const s = String(v); d.text = d.html ? stripHtml(s) : s; if (d.html) d.htmlColor = htmlColor(s); }
    }
    return d.text;
  }
  function defp(name, get, set) { Object.defineProperty(TP, name, { get, set: set || function () { }, configurable: true, enumerable: false }); }
  defp('text', function () { return tfText(this); }, function (v) {
    const d = this.__d; d.text = v === undefined ? '' : String(v);
    const vt = textVarTarget(this); if (vt) vt[0][vt[1]] = d.text;
  });
  defp('htmlText', function () { return tfText(this); }, function (v) {
    const d = this.__d; v = v === undefined ? '' : String(v);
    d.text = d.html ? stripHtml(v) : v; if (d.html) d.htmlColor = htmlColor(v);
    const vt = textVarTarget(this); if (vt) vt[0][vt[1]] = v;
  });
  defp('textColor', function () { return this.__d.fmt.color; }, function (v) { this.__d.fmt.color = Number(v) || 0; this.__d.htmlColor = null; });
  defp('variable', function () { return this.__d.variable; }, function (v) { this.__d.variable = v; });
  defp('autoSize', function () { return this.__d.autoSize; }, function (v) { this.__d.autoSize = v === true ? 'left' : v === false ? 'none' : String(v); });
  defp('wordWrap', function () { return this.__d.wordWrap; }, function (v) { this.__d.wordWrap = !!v; });
  defp('multiline', function () { return this.__d.multiline; }, function (v) { this.__d.multiline = !!v; });
  defp('html', function () { return this.__d.html; }, function (v) { this.__d.html = !!v; });
  defp('border', function () { return this.__d.border; }, function (v) { this.__d.border = !!v; });
  defp('background', function () { return this.__d.background; }, function (v) { this.__d.background = !!v; });
  defp('backgroundColor', function () { return this.__d.bgColor; }, function (v) { this.__d.bgColor = Number(v) || 0; });
  defp('borderColor', function () { return this.__d.borderColor; }, function (v) { this.__d.borderColor = Number(v) || 0; });
  defp('embedFonts', function () { return this.__d.embed; }, function (v) { this.__d.embed = !!v; });
  defp('selectable', function () { return false; });
  defp('type', function () { return 'dynamic'; });
  defp('length', function () { return tfText(this).length; });
  defp('textWidth', function () { return measure(this).w; });
  defp('textHeight', function () { return measure(this).h; });
  defp('maxChars', function () { return null; });
  defp('restrict', function () { return null; });
  defp('scroll', function () { return 1; });
  defp('maxscroll', function () { return 1; });
  defp('bottomScroll', function () { return 1; });
  Object.defineProperty(TP, 'setTextFormat', { value: function () { const f = arguments[arguments.length - 1]; applyFmt(this, f); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'setNewTextFormat', { value: function (f) { applyFmt(this, f); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'getTextFormat', { value: function () { const f = this.__d.fmt; return new TextFormat(f.font, f.size, f.color, f.bold, false, false, '', '', f.align); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'getNewTextFormat', { value: function () { return this.getTextFormat(); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'removeTextField', { value: function () { const p = this.__d.parent; if (p) KOF.removeChild(p, this); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'getDepth', { value: function () { return this.__d.depth; }, writable: true, configurable: true });
  Object.defineProperty(TP, 'swapDepths', { value: function (t) { return KOF.MovieClip.prototype.swapDepths.call(this, t); }, writable: true, configurable: true });
  Object.defineProperty(TP, 'replaceSel', { value: function () { }, writable: true, configurable: true });
  Object.defineProperty(TP, 'addListener', { value: function () { }, writable: true, configurable: true });
  function applyFmt(tf, f) {
    if (!f) return; const d = tf.__d.fmt;
    if (f.font != null) d.font = f.font; if (f.size != null) d.size = Number(f.size) || d.size;
    if (f.color != null) { d.color = Number(f.color) || 0; tf.__d.htmlColor = null; }
    if (f.bold != null) d.bold = !!f.bold; if (f.align != null) d.align = f.align;
  }
  function cssFont(d) {
    const f = d.def.font !== undefined ? KOF.data.chars[d.def.font] : null;
    let fam = d.fmt.font || (f && f.name) || 'sans-serif';
    if (/^_sans$|arial|verdana|tahoma/i.test(fam)) fam = 'Arial, Helvetica, sans-serif';
    else if (/^_serif$|times/i.test(fam)) fam = 'Times New Roman, serif';
    else if (/^_typewriter$|courier/i.test(fam)) fam = 'Courier New, monospace';
    else fam = `"${fam}", "Microsoft YaHei", "PingFang SC", "SimHei", sans-serif`;
    const bold = d.fmt.bold || (f && f.bold);
    return `${bold ? 'bold ' : ''}${d.fmt.size}px ${fam}`;
  }
  let mctx = null;
  function lines(tf) {
    const d = tf.__d;
    const txt = tfText(tf);
    let ls = String(txt).split(/\r\n|\r|\n/);
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = cssFont(d);
    if (d.wordWrap) {
      const w = d.tf.w - 4; const out = [];
      for (const l of ls) {
        let cur = '';
        for (const ch of l) {
          if (mctx.measureText(cur + ch).width > w && cur) { out.push(cur); cur = ch.trim() ? ch : ''; }
          else cur += ch;
        }
        out.push(cur);
      }
      ls = out;
    }
    return ls;
  }
  function measure(tf) {
    const ls = lines(tf); const d = tf.__d;
    mctx.font = cssFont(d);
    let w = 0; for (const l of ls) w = Math.max(w, mctx.measureText(l).width);
    return { w, h: ls.length * d.fmt.size * 1.2 };
  }
  KOF.drawTextField = function (g, tf, m, cx, scale) {
    const d = tf.__d;
    const txt = tfText(tf);
    const r = d.tf;
    KOF.setT(g, m);
    g.globalAlpha = Math.max(0, Math.min(1, cx[3] + cx[7] / 255));
    if (d.background) { const c = d.bgColor; g.fillStyle = `rgb(${c >> 16 & 255},${c >> 8 & 255},${c & 255})`; g.fillRect(r.x, r.y, r.w, r.h); }
    if (d.border) { const c = d.borderColor; g.strokeStyle = `rgb(${c >> 16 & 255},${c >> 8 & 255},${c & 255})`; g.lineWidth = 1; g.strokeRect(r.x, r.y, r.w, r.h); }
    if (txt === '' || txt == null) return;
    const col = d.htmlColor !== null && d.htmlColor !== undefined ? d.htmlColor : d.fmt.color;
    g.fillStyle = colorStr([col >> 16 & 255, col >> 8 & 255, col & 255], cx);
    const ls = lines(tf);
    const font = d.def.font !== undefined ? KOF.data.chars[d.def.font] : null;
    const useGlyphs = font && font.glyphs && font.glyphs.length && d.embed && !d.fmt.font;
    const size = d.fmt.size; const lh = size * 1.15 + (d.def.lead || 0);
    g.font = cssFont(d);
    g.textBaseline = 'alphabetic';
    let y = r.y + 2 + size * 0.9;
    for (const l of ls) {
      let w;
      if (useGlyphs) {
        const cm = fontCodeMap(font); const s = size / font.em; w = 0;
        for (const ch of l) { const gi = cm.get(ch.charCodeAt(0)); w += gi !== undefined && font.adv ? font.adv[gi] / 20 * (size / (font.em / 20)) : size * 0.5; }
      } else w = g.measureText(l).width;
      let x = r.x + 2 + (d.def.lm || 0);
      if (d.fmt.align === 'center') x = r.x + (r.w - w) / 2; else if (d.fmt.align === 'right') x = r.x + r.w - 2 - w;
      if (useGlyphs) {
        const cm = fontCodeMap(font); const s = size / font.em;
        for (const ch of l) {
          const gi = cm.get(ch.charCodeAt(0));
          if (gi !== undefined) {
            const p = glyphPath(d.def.font, gi);
            if (p) { const gm = mmul(m, [s, 0, 0, s, x, y]); KOF.setT(g, gm); g.fill(p, 'evenodd'); }
            x += font.adv ? font.adv[gi] / 20 * (size / (font.em / 20)) : size * 0.5;
          } else {
            KOF.setT(g, m);
            g.fillText(ch, x, y); x += g.measureText(ch).width;
          }
        }
        KOF.setT(g, m);
      } else {
        g.fillText(l, x, y);
      }
      y += lh;
    }
  };
})();
