/*
 * /plan/<token> invite page logic (lane P1-1). Loaded by site/404.html, which
 * GitHub Pages serves for every unknown path (no rewrites on Pages).
 *
 * Data comes ONLY from migration 203's anon RPCs, keyed by the invite token:
 *   rpc/get_plan_invite       -> title, venue_name, venue_address, start_time,
 *                                host_first_name, attendee_count
 *   rpc/submit_plan_web_rsvp  -> accepted, reason
 * The page never sees or sends a plan id. Every value is written with
 * textContent (never innerHTML), so plan text cannot inject markup.
 *
 * Pure helpers are exported for jest (__tests__/unit/site/plan-invite-page.test.ts).
 */
(function () {
  'use strict';

  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

  /** '/plan/<token>' (optional trailing slash) -> token, else null. */
  function parsePlanToken(pathname) {
    if (typeof pathname !== 'string') return null;
    var m = pathname.match(/^\/plan\/([^/?#]+)\/?$/);
    if (!m) return null;
    return TOKEN_RE.test(m[1]) ? m[1] : null;
  }

  function formatStart(iso, locale) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString(locale || undefined, {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  function goingLabel(n) {
    var c = typeof n === 'number' && n > 0 ? n : 0;
    return c === 1 ? '1 person going' : c + ' people going';
  }

  var REASON_COPY = {
    invalid_name: 'Please add your name.',
    invalid_email: 'That email doesn’t look right.',
    invalid_response: 'Pick yes or no.',
    rate_limited: 'Lots of replies just came in. Try again in a few minutes.',
    token_full: 'This invite has reached its reply limit. Ask the host to add you in Loop.',
    not_found: 'This invite is no longer active.',
  };
  function reasonCopy(reason) {
    return REASON_COPY[reason] || 'Something went wrong. Please try again.';
  }

  function rpc(cfg, name, body) {
    return fetch(cfg.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.publishableKey },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) throw new Error('rpc ' + name + ' ' + res.status);
      return res.json();
    });
  }

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).hidden = false; }
  function hide(id) { el(id).hidden = true; }
  function text(id, value) { el(id).textContent = value || ''; }

  function renderInvite(inv) {
    text('inv-host', inv.host_first_name ? inv.host_first_name + ' invited you' : 'You’re invited');
    text('inv-title', inv.title || inv.venue_name || 'A plan on Loop');
    text('inv-venue', inv.venue_name && inv.venue_name !== inv.title ? inv.venue_name : '');
    text('inv-address', inv.venue_address);
    text('inv-time', formatStart(inv.start_time));
    text('inv-going', goingLabel(inv.attendee_count));
    hide('inv-loading');
    show('inv-card');
  }

  function fail(message) {
    hide('inv-loading');
    text('inv-error', message);
    show('inv-error');
  }

  function start() {
    var cfg = window.LOOP_PLAN_CONFIG || {};
    var token = parsePlanToken(window.location.pathname);
    if (!/^\/plan\//.test(window.location.pathname)) return; // ordinary 404
    hide('nf');
    show('inv');
    if (!token) { fail('This invite link isn’t valid.'); return; }
    if (!cfg.supabaseUrl || !cfg.publishableKey) { fail('This invite can’t be loaded right now.'); return; }
    if (cfg.appStoreUrl) el('inv-store').href = cfg.appStoreUrl;

    rpc(cfg, 'get_plan_invite', { p_token: token }).then(function (rows) {
      if (!Array.isArray(rows) || rows.length === 0) { fail('This invite is no longer active.'); return; }
      renderInvite(rows[0]);
    }).catch(function () { fail('This invite can’t be loaded right now.'); });

    var form = el('inv-form');
    var choice = null;
    ['yes', 'no'].forEach(function (r) {
      el('inv-' + r).addEventListener('click', function () { choice = r; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!choice) return;
      var btns = form.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
      hide('inv-form-error');
      rpc(cfg, 'submit_plan_web_rsvp', {
        p_token: token,
        p_name: el('inv-name').value,
        p_email: el('inv-email').value || null,
        p_response: choice,
      }).then(function (rows) {
        var r = Array.isArray(rows) ? rows[0] : null;
        if (r && r.accepted) {
          hide('inv-form');
          text('inv-done-title', choice === 'yes' ? 'You’re in.' : 'Thanks for letting them know.');
          show('inv-done');
          return;
        }
        throw new Error((r && r.reason) || 'unknown');
      }).catch(function (err) {
        text('inv-form-error', reasonCopy(err && err.message));
        show('inv-form-error');
        for (var j = 0; j < btns.length; j++) btns[j].disabled = false;
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parsePlanToken: parsePlanToken, formatStart: formatStart, goingLabel: goingLabel, reasonCopy: reasonCopy, TOKEN_RE: TOKEN_RE };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
