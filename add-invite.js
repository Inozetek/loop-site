/*
 * /add/<token> friend invite page (LoopApp migration 227). Served by 404.html,
 * like /plan/<token>. Reads ONE anon RPC, preview_friend_invite, keyed by the
 * opaque token: first name, avatar and banner only. Never a user id, last
 * name, address, location or phone. Text is written with textContent, never as
 * markup. Expired, used, cancelled and blocked invites all read the same.
 */
(function () {
  'use strict';

  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

  /** '/add/<token>' (optional trailing slash) -> token, else null. */
  function parseAddToken(pathname) {
    if (typeof pathname !== 'string') return null;
    var m = pathname.match(/^\/add\/([^/?#]+)\/?$/);
    if (!m) return null;
    return TOKEN_RE.test(m[1]) ? m[1] : null;
  }

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).hidden = false; }
  function hide(id) { el(id).hidden = true; }

  function fail(message) {
    hide('add-loading');
    el('add-error').textContent = message;
    show('add-error');
  }

  function start() {
    if (!/^\/add\//.test(window.location.pathname)) return; // not ours
    var cfg = window.LOOP_PLAN_CONFIG || {};
    var token = parseAddToken(window.location.pathname);
    hide('nf');
    show('add');
    if (!token) { fail('This invite isn’t available.'); return; }
    if (!cfg.supabaseUrl || !cfg.publishableKey) { fail('This invite can’t be loaded right now.'); return; }
    if (cfg.appStoreUrl) el('add-store').href = cfg.appStoreUrl;
    el('add-open').href = 'loopapp://add/' + token;

    fetch(cfg.supabaseUrl + '/rest/v1/rpc/preview_friend_invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
      body: JSON.stringify({ p_token: token }),
    }).then(function (res) {
      if (!res.ok) throw new Error('rpc ' + res.status);
      return res.json();
    }).then(function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) { fail('This invite isn’t available.'); return; }
      var inv = rows[0];
      var first = inv.first_name || 'Your friend';
      el('add-title').textContent = first + ' wants to be friends on Loop';
      el('add-initial').textContent = first.charAt(0).toUpperCase();
      if (typeof inv.avatar_url === 'string' && /^https:\/\//.test(inv.avatar_url)) {
        el('add-avatar').src = inv.avatar_url;
        show('add-avatar');
        hide('add-initial');
      }
      hide('add-loading');
      show('add-card');
    }).catch(function () { fail('This invite can’t be loaded right now.'); });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseAddToken: parseAddToken };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
