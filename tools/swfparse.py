# SWF (v8, AS2) tag parser: produces a JSON-friendly description of every character,
# timeline and code unit.  Code bodies are returned as (start, end) byte ranges.
import struct

class Bits:
    def __init__(s, d, p): s.d = d; s.p = p; s.b = 0
    def ub(s, n):
        v = 0
        d = s.d
        for _ in range(n):
            v = (v << 1) | ((d[s.p] >> (7 - s.b)) & 1); s.b += 1
            if s.b == 8: s.b = 0; s.p += 1
        return v
    def sb(s, n):
        v = s.ub(n)
        if n and v & (1 << (n - 1)): v -= 1 << n
        return v
    def align(s):
        if s.b: s.b = 0; s.p += 1
        return s.p

def rect(d, p):
    b = Bits(d, p); n = b.ub(5)
    r = [b.sb(n) / 20, b.sb(n) / 20, b.sb(n) / 20, b.sb(n) / 20]  # xmin xmax ymin ymax
    return [r[0], r[2], r[1], r[3]], b.align()  # -> x0 y0 x1 y1

def matrix(d, p):
    b = Bits(d, p); m = [1, 0, 0, 1, 0, 0]
    if b.ub(1): n = b.ub(5); m[0] = b.sb(n) / 65536; m[3] = b.sb(n) / 65536
    if b.ub(1): n = b.ub(5); m[1] = b.sb(n) / 65536; m[2] = b.sb(n) / 65536
    n = b.ub(5); m[4] = b.sb(n) / 20; m[5] = b.sb(n) / 20
    return [round(x, 6) for x in m], b.align()

def cxform(d, p, alpha=True):
    b = Bits(d, p); ha = b.ub(1); hm = b.ub(1); n = b.ub(4)
    k = 4 if alpha else 3
    mul = [1, 1, 1, 1]; add = [0, 0, 0, 0]
    if hm: mul[:k] = [b.sb(n) / 256 for _ in range(k)]
    if ha: add[:k] = [b.sb(n) for _ in range(k)]
    return mul + add, b.align()

def cstr(d, p):
    e = d.index(b'\0', p); return d[p:e].decode('utf8', 'replace'), e + 1

def shape_paths(d, p, nfill, nline, units=1.0):
    """Parse glyph SHAPE records -> SVG path string (font units scaled by `units`)."""
    b = Bits(d, p)
    x = y = 0; out = []
    fb, lb = nfill, nline
    def f(v): return ('%.2f' % (v * units)).rstrip('0').rstrip('.')
    while True:
        if b.ub(1) == 0:
            fl = b.ub(5)
            if fl == 0: break
            if fl & 1:
                n = b.ub(5); x = b.sb(n); y = b.sb(n); out.append('M%s %s' % (f(x), f(y)))
            if fl & 2: b.ub(fb)
            if fl & 4: b.ub(fb)
            if fl & 8: b.ub(lb)
            if fl & 16: break  # new styles: not in glyphs
        else:
            if b.ub(1):
                n = b.ub(4) + 2
                if b.ub(1): x += b.sb(n); y += b.sb(n)
                elif b.ub(1): y += b.sb(n)
                else: x += b.sb(n)
                out.append('L%s %s' % (f(x), f(y)))
            else:
                n = b.ub(4) + 2
                cx = x + b.sb(n); cy = y + b.sb(n); x = cx + b.sb(n); y = cy + b.sb(n)
                out.append('Q%s %s %s %s' % (f(cx), f(cy), f(x), f(y)))
    return ''.join(out)

EV = [(0, 0x80, 'keyUp'), (0, 0x40, 'keyDown'), (0, 0x20, 'mouseUp'), (0, 0x10, 'mouseDown'), (0, 0x08, 'mouseMove'), (0, 0x04, 'unload'), (0, 0x02, 'enterFrame'), (0, 0x01, 'load'),
      (1, 0x80, 'dragOver'), (1, 0x40, 'rollOut'), (1, 0x20, 'rollOver'), (1, 0x10, 'releaseOutside'), (1, 0x08, 'release'), (1, 0x04, 'press'), (1, 0x02, 'initialize'), (1, 0x01, 'data'),
      (2, 0x04, 'construct'), (2, 0x02, 'keyPress'), (2, 0x01, 'dragOut')]

FILTER_SIZES = {0: 23, 1: 9, 2: 15, 3: 27, 6: 80}
def skip_filters(d, q):
    n = d[q]; q += 1
    for _ in range(n):
        fid = d[q]; q += 1
        if fid in FILTER_SIZES: q += FILTER_SIZES[fid]
        elif fid in (4, 7): nc = d[q]; q += 1 + nc * 5 + 19
        elif fid == 5: mx, my = d[q], d[q + 1]; q += 2 + 8 + 4 * mx * my + 4 + 1
    return q

class SWF:
    def __init__(self, path):
        d = self.d = open(path, 'rb').read()
        assert d[:3] == b'FWS'
        self.version = d[3]
        self.bounds, p = rect(d, 8)
        self.fps = d[p + 1] + d[p] / 256
        self.nframes = struct.unpack_from('<H', d, p + 2)[0]
        self.chars = {}
        self.exports = {}
        self.code = []   # (key, start, end, kind)
        self.bg = '#000000'
        self.root = self.timeline(p + 4, len(d), 0)

    def addcode(self, key, start, end):
        self.code.append((key, start, end))
        return key

    def timeline(self, p, end, sid):
        d = self.d
        frames = [[]]; labels = {}
        frame = 0; place_i = 0
        while p < end:
            h = struct.unpack_from('<H', d, p)[0]; t = h >> 6; l = h & 63; p += 2
            if l == 63: l = struct.unpack_from('<I', d, p)[0]; p += 4
            body = p; tend = p + l
            ops = frames[-1]
            if t == 0: break
            elif t == 1: frames.append([]); frame += 1
            elif t == 9: self.bg = '#%02x%02x%02x' % tuple(d[body:body + 3])
            elif t == 43: labels[cstr(d, body)[0]] = frame + 1
            elif t == 12: ops.append({'a': self.addcode('f%d_%d_%d' % (sid, frame + 1, len(ops)), body, tend)})
            elif t == 59:
                cid = struct.unpack_from('<H', d, body)[0]
                ops.append({'i': self.addcode('i%d' % cid, body + 2, tend), 'ic': cid})
            elif t == 56:
                n = struct.unpack_from('<H', d, body)[0]; q = body + 2
                for i in range(n):
                    cid = struct.unpack_from('<H', d, q)[0]; nm, q = cstr(d, q + 2); self.exports[nm] = cid
            elif t in (26, 70):
                fl = d[body]; q = body + 1; fl3 = 0
                if t == 70: fl3 = d[q]; q += 1
                o = {'d': struct.unpack_from('<H', d, q)[0]}; q += 2
                if t == 70 and (fl3 & 0x08 or (fl3 & 0x10 and fl & 2)): o['cls'], q = cstr(d, q)
                if fl & 1: o['mv'] = 1
                if fl & 2: o['c'] = struct.unpack_from('<H', d, q)[0]; q += 2
                if fl & 4: o['m'], q = matrix(d, q)
                if fl & 8: o['cx'], q = cxform(d, q)
                if fl & 16: o['r'] = struct.unpack_from('<H', d, q)[0]; q += 2
                if fl & 32: o['n'], q = cstr(d, q)
                if fl & 64: o['cd'] = struct.unpack_from('<H', d, q)[0]; q += 2
                if t == 70:
                    if fl3 & 0x01: q = skip_filters(d, q)
                    if fl3 & 0x02: o['blend'] = d[q]; q += 1
                    if fl3 & 0x04: q += 1
                    if fl3 & 0x20: o['vis'] = d[q]; q += 5
                if fl & 128:
                    q += 2 + 4; evs = []
                    while True:
                        ef = d[q:q + 4]; q += 4
                        if ef == b'\0\0\0\0': break
                        sz = struct.unpack_from('<I', d, q)[0]; q += 4; ae = q + sz
                        names = [nm for (bi, m, nm) in EV if ef[bi] & m]
                        key = None
                        if ef[2] & 0x02:
                            names = [x if x != 'keyPress' else 'keyPress:%d' % d[q] for x in names]; q += 1
                        key = self.addcode('e%d_%d_%d_%d' % (sid, frame + 1, place_i, len(evs)), q, ae)
                        evs.append([names, key])
                        q = ae
                    o['ev'] = evs
                place_i += 1
                ops.append(o)
            elif t == 4:
                cid, dep = struct.unpack_from('<HH', d, body)
                o = {'d': dep, 'c': cid}; q = body + 4
                o['m'], q = matrix(d, q)
                if q < tend: o['cx'], q = cxform(d, q, False)
                ops.append(o)
            elif t in (5, 28):
                dep = struct.unpack_from('<H', d, body + (2 if t == 5 else 0))[0]
                ops.append({'rm': dep})
            elif t == 15:
                sid2 = struct.unpack_from('<H', d, body)[0]; fl = d[body + 2]
                o = {'snd': sid2}
                if fl & 0x20: o['stop'] = 1
                if fl & 0x10: o['nomul'] = 1
                q = body + 3
                if fl & 1: q += 4
                if fl & 2: q += 4
                if fl & 4: o['loops'] = struct.unpack_from('<H', d, q)[0]; q += 2
                ops.append(o)
            elif t == 39:
                cid, nf = struct.unpack_from('<HH', d, body)
                tl = self.timeline(body + 4, tend, cid)
                self.chars[cid] = dict(t='sprite', **tl)
            elif t in (2, 22, 32, 83):
                cid = struct.unpack_from('<H', d, body)[0]
                b, q = rect(d, body + 2)
                self.chars[cid] = {'t': 'shape', 'b': b}
            elif t == 46:
                cid = struct.unpack_from('<H', d, body)[0]
                b, q = rect(d, body + 2)
                self.chars[cid] = {'t': 'morph', 'b': b}
            elif t in (6, 21, 35, 20, 36):
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = {'t': 'bitmap'}
            elif t in (11, 33):
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = self.text(body, tend, t == 33)
            elif t == 37:
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = self.edittext(body + 2)
            elif t in (48, 75):
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = self.font(body, tend, t == 75)
            elif t == 10:
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = {'t': 'font', 'glyphs': [], 'codes': [], 'em': 1024}
            elif t == 13 or t == 62:
                pass
            elif t == 34:
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = self.button2(body, tend, cid)
            elif t == 7:
                cid = struct.unpack_from('<H', d, body)[0]
                self.chars[cid] = {'t': 'button', 'recs': [], 'acts': []}
            elif t == 14:
                cid = struct.unpack_from('<H', d, body)[0]
                fl = d[body + 2]
                self.chars[cid] = {'t': 'sound', 'fmt': fl >> 4, 'rate': (5512, 11025, 22050, 44100)[(fl >> 2) & 3],
                                   'stereo': fl & 1, 'samples': struct.unpack_from('<I', d, body + 3)[0]}
            p = tend
        if not frames[-1] and len(frames) > 1: frames.pop()
        return {'frames': frames, 'labels': labels}

    def text(self, body, tend, rgba):
        d = self.d
        b, q = rect(d, body + 2)
        m, q = matrix(d, q)
        gb, ab = d[q], d[q + 1]; q += 2
        recs = []
        cur = {}
        while q < tend:
            fl = d[q]; q += 1
            if fl == 0: break
            rec = {}
            if fl & 8: rec['font'] = struct.unpack_from('<H', d, q)[0]; q += 2
            if fl & 4:
                if rgba: rec['color'] = list(d[q:q + 4]); q += 4
                else: rec['color'] = list(d[q:q + 3]) + [255]; q += 3
            if fl & 1: rec['x'] = struct.unpack_from('<h', d, q)[0] / 20; q += 2
            if fl & 2: rec['y'] = struct.unpack_from('<h', d, q)[0] / 20; q += 2
            if fl & 8: rec['h'] = struct.unpack_from('<H', d, q)[0] / 20; q += 2
            n = d[q]; q += 1
            bb = Bits(d, q); gl = []
            for _ in range(n):
                gi = bb.ub(gb); adv = bb.sb(ab); gl.append([gi, adv / 20])
            q = bb.align()
            rec['g'] = gl
            recs.append(rec)
        return {'t': 'text', 'b': b, 'm': m, 'recs': recs}

    def edittext(self, q):
        d = self.d
        b, q = rect(d, q)
        f1, f2 = d[q], d[q + 1]; q += 2
        o = {'t': 'etext', 'b': b, 'wrap': bool(f1 & 0x40), 'multi': bool(f1 & 0x20), 'pass': bool(f1 & 0x10),
             'ro': bool(f1 & 0x08), 'auto': bool(f2 & 0x40), 'noSel': bool(f2 & 0x10), 'border': bool(f2 & 0x08),
             'html': bool(f2 & 0x02), 'outl': bool(f2 & 0x01)}
        if f1 & 0x01: o['font'] = struct.unpack_from('<H', d, q)[0]; q += 2
        if f2 & 0x80: o['fontCls'], q = cstr(d, q)
        if f1 & 0x01: o['h'] = struct.unpack_from('<H', d, q)[0] / 20; q += 2
        if f1 & 0x04: o['color'] = list(d[q:q + 4]); q += 4
        if f1 & 0x02: o['max'] = struct.unpack_from('<H', d, q)[0]; q += 2
        if f2 & 0x20:
            o['align'] = d[q]; o['lm'], o['rm'], o['ind'] = [x / 20 for x in struct.unpack_from('<HHH', d, q + 1)]
            o['lead'] = struct.unpack_from('<h', d, q + 7)[0] / 20; q += 9
        o['var'], q = cstr(d, q)
        if f1 & 0x80: o['text'], q = cstr(d, q)
        return o

    def font(self, body, tend, v3):
        d = self.d
        q = body + 2
        fl = d[q]; q += 2
        nl = d[q]; q += 1
        name = d[q:q + nl].split(b'\0')[0].decode('utf8', 'replace'); q += nl
        n = struct.unpack_from('<H', d, q)[0]; q += 2
        wide = fl & 0x08
        base = q
        offs = []
        for i in range(n):
            if wide: offs.append(struct.unpack_from('<I', d, q)[0]); q += 4
            else: offs.append(struct.unpack_from('<H', d, q)[0]); q += 2
        if n:
            cto = struct.unpack_from('<I' if wide else '<H', d, q)[0]; q += 4 if wide else 2
        glyphs = []
        for i in range(n):
            gp = base + offs[i]
            nb = d[gp]
            try: glyphs.append(shape_paths(d, gp + 1, nb >> 4, nb & 15, 1.0))
            except Exception: glyphs.append('')
        codes = []
        o = {'t': 'font', 'name': name, 'bold': bool(fl & 1), 'italic': bool(fl & 2), 'em': 20480 if v3 else 1024}
        if n:
            q = base + cto
            for i in range(n):
                if fl & 0x04: codes.append(struct.unpack_from('<H', d, q)[0]); q += 2
                else: codes.append(d[q]); q += 1
            if fl & 0x80:
                o['ascent'], o['descent'], o['leading'] = struct.unpack_from('<HHh', d, q); q += 6
                o['adv'] = list(struct.unpack_from('<%dh' % n, d, q)); q += 2 * n
        o['glyphs'] = glyphs; o['codes'] = codes
        return o

    def button2(self, body, tend, cid):
        d = self.d
        q = body + 2
        menu = d[q] & 1; q += 1
        off = struct.unpack_from('<H', d, q)[0]
        aq = q + off if off else tend
        q += 2
        recs = []
        while q < tend:
            fl = d[q]; q += 1
            if fl == 0: break
            ch, dep = struct.unpack_from('<HH', d, q); q += 4
            m, q = matrix(d, q)
            cx, q = cxform(d, q)
            if fl & 0x10: q = skip_filters(d, q)
            if fl & 0x20: q += 1
            recs.append({'st': fl & 15, 'c': ch, 'd': dep, 'm': m, 'cx': cx})
        acts = []
        if off:
            q = aq; i = 0
            while True:
                sz, cond = struct.unpack_from('<HH', d, q); ae = q + sz if sz else tend
                acts.append([cond, self.addcode('b%d_%d' % (cid, i), q + 4, ae)]); i += 1
                if not sz: break
                q = ae
        return {'t': 'button', 'menu': menu, 'recs': recs, 'acts': acts}
