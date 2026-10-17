#!/usr/bin/env python3
"""One-command build: kof_wing_12.swf -> playable HTML5 game in dist/.

    python3 build.py path/to/kof_wing_12.swf            # output in ./dist
    python3 build.py kof_wing_12.swf -o out --ffdec /path/to/ffdec.jar

Steps (each one is skipped when its output already exists, use --clean to redo):
  1. JPEXS FFDec renders shapes to PNG, morph shapes to SVG, sounds to MP3  (build/ffdec/)
  2. tools/build_code.py deobfuscates every AS2 code block and emits JavaScript  (build/code.js)
  3. tools/build_data.py writes timelines/fonts/texts, sounds and WebP shape bitmaps  (dist/)
  4. the hand-written runtime (runtime/) is copied next to the generated files  (dist/)
"""
import argparse, hashlib, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(HERE, 'tools')
KNOWN_SHA256 = '96a16c32ca98ad391cd5e56109d9ca5f0bc64b17e705ae31e7d2a71df6306b40'


def log(msg):
    print('==> ' + msg, flush=True)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''): h.update(b)
    return h.hexdigest()


def find_ffdec(arg):
    cands = [arg, os.environ.get('FFDEC_JAR'), os.path.join(HERE, 'third_party', 'ffdec', 'ffdec.jar')]
    for c in cands:
        if c and os.path.isfile(c): return ['java', '-jar', c]
    for exe in ('ffdec', 'ffdec.sh', 'ffdec-cli'):
        p = shutil.which(exe)
        if p: return [p]
    sys.exit('FFDec not found. Run `python3 tools/get_ffdec.py` once, or pass --ffdec /path/to/ffdec.jar '
             '(or set FFDEC_JAR). See README.')


def run(cmd, **kw):
    print('    $ ' + ' '.join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kw)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('swf', help='your copy of kof_wing_12.swf')
    ap.add_argument('-o', '--out', default=os.path.join(HERE, 'dist'), help='output folder (default: dist/)')
    ap.add_argument('--work', default=os.path.join(HERE, 'build'), help='intermediate files (default: build/)')
    ap.add_argument('--ffdec', help='path to ffdec.jar')
    ap.add_argument('--clean', action='store_true', help='delete build/ and the output folder first')
    a = ap.parse_args()

    swf, out, work = os.path.abspath(a.swf), os.path.abspath(a.out), os.path.abspath(a.work)
    if not os.path.isfile(swf): sys.exit('no such file: ' + swf)
    try:
        import PIL.features
        if not PIL.features.check('webp'): sys.exit('Pillow was built without WebP support')
    except ImportError:
        sys.exit('Pillow is required: python3 -m pip install -r requirements.txt')

    digest = sha256(swf)
    if digest != KNOWN_SHA256:
        print('warning: SHA-256 %s differs from the tested kof_wing_12.swf (%s).\n'
              '         Other builds may convert but are untested.' % (digest, KNOWN_SHA256))
    if a.clean:
        for d in (work, out): shutil.rmtree(d, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    os.makedirs(out, exist_ok=True)

    assets = os.path.join(work, 'ffdec')
    if not os.path.isdir(os.path.join(assets, 'shapes')):
        log('1/4 exporting shapes, morph shapes and sounds with FFDec (takes a few minutes)')
        tmp = assets + '.tmp'
        shutil.rmtree(tmp, ignore_errors=True)
        run(find_ffdec(a.ffdec) + ['-format', 'shape:png,morphshape:svg,sound:mp3_wav',
                                   '-export', 'shape,morphshape,sound', tmp, swf])
        os.rename(tmp, assets)
    else:
        log('1/4 FFDec export already in %s, skipping' % assets)

    code = os.path.join(work, 'code.js')
    if not os.path.isfile(code):
        log('2/4 deobfuscating ActionScript and converting it to JavaScript')
        run([sys.executable, os.path.join(TOOLS, 'build_code.py'), swf, work])
    else:
        log('2/4 %s already exists, skipping' % code)

    log('3/4 writing data.js, sounds.js and shape bitmaps')
    run([sys.executable, os.path.join(TOOLS, 'build_data.py'), swf, assets, out])

    log('4/4 copying the runtime')
    shutil.copy(code, os.path.join(out, 'code.js'))
    rt = os.path.join(HERE, 'runtime')
    for root, _, files in os.walk(rt):
        dst = os.path.join(out, os.path.relpath(root, rt))
        os.makedirs(dst, exist_ok=True)
        for f in files: shutil.copy(os.path.join(root, f), os.path.join(dst, f))

    if shutil.which('node'):
        run(['node', '--check', os.path.join(out, 'code.js')])
    log('done. Open %s in a browser.' % os.path.join(out, 'index.html'))


if __name__ == '__main__':
    main()
