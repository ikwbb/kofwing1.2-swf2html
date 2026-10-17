import sys, os, re, json, pickle
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from swfparse import SWF
import deobjs

D = None
def init(path):
    global D
    D = open(path, 'rb').read()

def work(item):
    import time
    key, start, end = item
    t0 = time.time()
    try:
        t = deobjs.Tracer(D)
        lines = t.trace(start, end)
        body = '\n'.join(lines)
        body = deobjs.finalize_calls(body)
        decl = sorted(set(re.findall(r'(?<![\w$.])(\$[st]\d+|r\d+)(?=\s*=[^=])', body)) | {'r0', 'r1', 'r2', 'r3'})
        ind = '\n    '
        js = 'function ($sc) {\n  var %s;\n  with ($sc) {%s%s\n  }\n}' % (', '.join(decl), ind, ind.join(body.split('\n')))
        dt = time.time() - t0
        if dt > 5: sys.stderr.write('slow %s %.1fs\n' % (key, dt))
        return key, js, None
    except Exception as ex:
        import traceback
        return key, 'function ($sc) { /* failed */ }', traceback.format_exc()

if __name__ == '__main__':
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    swf = SWF(src)
    items = swf.code
    if len(sys.argv) > 3:
        items = [i for i in items if re.match(sys.argv[3], i[0])]
    with Pool(min(8, os.cpu_count() or 4), initializer=init, initargs=(src,)) as pool:
        res = list(pool.imap(work, items, chunksize=2))
    errs = [r for r in res if r[2]]
    for e in errs[:5]: print(e[0], e[2])
    print('units', len(res), 'errors', len(errs))
    with open(os.path.join(outdir, 'code.js'), 'w') as f:
        f.write('// Generated from %s ActionScript 2 by tools/build_code.py. Do not redistribute.\n' % os.path.basename(src))
        f.write('var $ = KOF.$;\nKOF.code = {\n')
        for key, js, _ in res:
            f.write('%s: %s,\n' % (json.dumps(key), js))
        f.write('};\n')
