// Boot: preload shape images, then start the game when the player clicks.
'use strict';
(function () {
  const KOF = window.KOF;
  const canvas = document.getElementById('stage');
  KOF.setCanvas(canvas);
  KOF.data = KOF_DATA;
  const fit = () => KOF.resize(window.innerWidth, window.innerHeight);
  fit();
  window.addEventListener('resize', fit);
  KOF.bindMouse(canvas);

  const ids = Object.keys(KOF_DATA.chars).filter((k) => KOF_DATA.chars[k].t === 'shape' || (KOF_DATA.chars[k].t === 'morph' && !KOF_DATA.chars[k].mp));
  let done = 0;
  const bar = document.querySelector('#bar > div');
  const msg = document.getElementById('msg');
  const startBtn = document.getElementById('start');
  const total = ids.length;
  let i = 0;
  function next() {
    while (i < ids.length && i - done < 24) {
      const id = Number(ids[i++]);
      KOF.shapeImage(id);
      const im = KOF.imageEl(id);
      const fin = () => { done++; bar.style.width = (100 * done / total) + '%'; if (done === total) ready(); else next(); };
      if (im.complete) setTimeout(fin, 0); else { im.onload = fin; im.onerror = fin; }
    }
  }
  function ready() {
    msg.textContent = 'Click to start';
    startBtn.style.display = 'block';
    if (KOF.autostart) begin();
  }
  function begin() {
    if (KOF.running) return;
    KOF.audio.unlock();
    document.getElementById('loading').style.display = 'none';
    KOF.installPatches();
    KOF.boot(KOF_DATA);
    KOF.patchRoot(KOF.root);
    KOF.render();
    KOF.start();
    canvas.focus();
  }
  startBtn.addEventListener('click', begin);
  KOF.begin = begin;
  const mute = document.getElementById('mute');
  mute.addEventListener('click', () => { KOF.audio.setMuted(!KOF.audio.muted); mute.textContent = 'Sound: ' + (KOF.audio.muted ? 'off' : 'on'); canvas.focus(); });
  next();
})();
