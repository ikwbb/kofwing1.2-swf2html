#!/usr/bin/env python3
"""Download JPEXS Free Flash Decompiler (FFDec) 22.0.2 into third_party/ffdec/.

FFDec is GPL-3.0 (its library is LGPL-3.0) and is not part of this repository; it is only
run as an external program to render shapes and export sounds. Needs Java 8 or newer.
"""
import hashlib, io, os, sys, urllib.request, zipfile

URL = 'https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version22.0.2/ffdec_22.0.2.zip'
SHA256 = 'cbfe78d9d4134e29921f43c3d9f49a94c904ed5046d2d856cc83c0a1b130dfce'
DEST = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'third_party', 'ffdec')


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None  # optional: an already downloaded ffdec_22.0.2.zip
    if os.path.isfile(os.path.join(DEST, 'ffdec.jar')):
        print('already installed:', DEST); return
    if src:
        data = open(src, 'rb').read()
    else:
        print('downloading', URL)
        data = urllib.request.urlopen(URL).read()
    got = hashlib.sha256(data).hexdigest()
    if got != SHA256: sys.exit('checksum mismatch: %s (expected %s)' % (got, SHA256))
    os.makedirs(DEST, exist_ok=True)
    zipfile.ZipFile(io.BytesIO(data)).extractall(DEST)
    print('installed FFDec to', DEST)


if __name__ == '__main__':
    main()
