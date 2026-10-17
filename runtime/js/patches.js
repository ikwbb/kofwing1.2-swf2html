// Port-specific patches: the original SWF shipped with a third-party ad SDK (FlashAds)
// and a web portal shell. Those are replaced with no-op stand-ins so the game starts directly.
'use strict';
(function () {
  const KOF = window.KOF;
  const G = KOF.G;
  function FlashAds(id, root, w, h, loadingAd) {
    FlashAds.THIS = this;
    if (!loadingAd) return; // banner ads: nothing to show
    setTimeout(() => { const r = KOF.root; if (r && typeof r.adExit === 'function') { try { r.adExit(); } catch (e) { KOF.reportError(e, 'adExit'); } KOF.drain(); } }, 0);
  }
  FlashAds.setForbidExit = function (f) { FlashAds.funFinal = f; };
  FlashAds.forceExit = function () { };
  FlashAds.setDefaultAd = function () { };
  FlashAds.prototype.startForceExit = function () { };
  KOF.installPatches = function () {
    G.FlashAds = FlashAds;
  };
  // Round reset: a fighter still walking from the previous round's win pose kept its walk
  // handler (it only stops when the forward key is released), so it marched forward before
  // "Fight". Stop that leftover movement whenever the game resets the fighters for a round.
  const MOVING = new Set(['end', 'walk_f', 'walk_b', 'dash_f', 'dash_b', 'run']);
  function stopLeftoverMove(role) {
    if (!role || !role.__d || !MOVING.has(String(role.status_1))) return;
    delete role.onEnterFrame;
    role.status_1 = 'stand';
  }
  KOF.patchRoot = function (root) {
    let roleReset;
    const existing = root.role_reset;
    Object.defineProperty(root, 'role_reset', {
      configurable: true, enumerable: true,
      get() { return roleReset; },
      set(f) {
        roleReset = typeof f !== 'function' ? f : function () {
          stopLeftoverMove(root.P1_role); stopLeftoverMove(root.P2_role);
          return f.apply(this, arguments);
        };
      },
    });
    if (existing !== undefined) root.role_reset = existing;
  };
})();
