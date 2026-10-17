# usage: build_data.py <game.swf> <ffdec export dir> <out dir>
# Writes <out>/data.js (timelines, placements, fonts, texts, buttons, exports), <out>/sounds.js
# (MP3, base64) and <out>/assets/shapes/<id>.webp (FFDec PNG renders, re-encoded losslessly).
import sys, os, re, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swfparse import SWF


def morph_paths(svg):
    # morph shapes: FFDec exports them as animated SVG; keep the start/end paths and fills to interpolate by ratio
    mp = []
    for pm in re.finditer(r'<path [^>]*fill="(#[0-9a-f]{6})"[^>]*>(.*?)</path>', open(svg).read(), re.S):
        an = dict(re.findall(r'attributeName="([a-z-]+)"[^>]*values="([^"]*)"', pm.group(2)))
        if 'd' not in an: continue
        d0, d1 = an['d'].split(';')
        f0, f1 = an.get('fill', pm.group(1) + ';' + pm.group(1)).split(';')
        a0, a1 = an.get('fill-opacity', '1;1').split(';')
        mp.append({'d': [d0, d1], 'f': [f0, f1], 'a': [float(a0), float(a1)]})
    return mp


def conv(job):
    # shape bitmaps: FFDec PNG renders re-encoded as lossless WebP (about half the size)
    from PIL import Image
    assets, out, cid = job
    p = '%s/shapes/%d.png' % (assets, cid)
    if not os.path.exists(p): return 0
    Image.open(p).save('%s/assets/shapes/%d.webp' % (out, cid), 'WEBP', lossless=True, method=4)
    return 1


def main(src, assets, out):
    from PIL import Image
    name = os.path.basename(src)
    os.makedirs(out + '/assets/shapes', exist_ok=True)
    s = SWF(src)
    chars = {}
    for cid, c in s.chars.items():
        if c['t'] == 'bitmap': continue
        chars[cid] = c
        if c['t'] == 'morph':
            sp = '%s/morphshapes/%d.svg' % (assets, cid)
            if os.path.exists(sp): c['mp'] = morph_paths(sp)
    # shapes whose bitmap is a fully opaque rectangle: used as masks they become a cheap clip path at runtime
    for cid, c in chars.items():
        if c['t'] != 'shape': continue
        p = '%s/shapes/%d.png' % (assets, cid)
        if not os.path.exists(p): continue
        im = Image.open(p)
        if im.mode != 'RGBA': c['op'] = 1; continue
        w, h = im.size
        if w > 2 and h > 2 and im.getchannel('A').crop((1, 1, w - 1, h - 1)).getextrema()[0] >= 250: c['op'] = 1
    data = {'stage': [s.bounds[2], s.bounds[3]], 'fps': s.fps, 'bg': s.bg, 'chars': chars, 'exports': s.exports, 'root': s.root}
    with open(out + '/data.js', 'w') as f:
        f.write('// Generated from %s by tools/build_data.py. Do not redistribute.\nKOF_DATA = ' % name)
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    snd = {}
    files = {}
    for fn in os.listdir(assets + '/sounds'):
        head = fn.split('.')[0].split('_')[0]
        if head.lstrip('-').isdigit(): files[int(head)] = fn
    for cid, c in s.chars.items():
        if c['t'] == 'sound':
            fn = files.get(cid)
            if fn and fn.endswith('.mp3'): snd[cid] = base64.b64encode(open(assets + '/sounds/' + fn, 'rb').read()).decode()
            else: print('no mp3 for sound', cid, fn)
    with open(out + '/sounds.js', 'w') as f:
        f.write('// Sounds from %s (MP3, base64). Do not redistribute.\nKOF.sounds = ' % name)
        json.dump(snd, f, separators=(',', ':'))
        f.write(';\n')
    from multiprocessing import Pool
    jobs = [(assets, out, cid) for cid, c in s.chars.items() if c['t'] in ('shape', 'morph') and not c.get('mp')]
    with Pool(min(8, os.cpu_count() or 4)) as pool: n = sum(pool.map(conv, jobs, chunksize=32))
    print('chars', len(chars), 'sounds', len(snd), 'shapes', n)


if __name__ == '__main__':
    main(*sys.argv[1:4])
