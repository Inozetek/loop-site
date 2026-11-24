/*
 * /plan/<token> invite page logic. Loaded by site/404.html, which GitHub Pages
 * serves for every unknown path (no rewrites on Pages).
 *
 * Planner funnel lane 2 (Nick approved 2026-11-24): ONE tap "I'm in" first,
 * then "what should we call you?"; who's-going faces; and the line
 * "<host> didn't pick this spot. Loop did." ONLY when the plan carries the
 * loop_picked_spot tag. No email is asked here (email claim is a later lane).
 *
 * Data comes ONLY from migration 235's anon RPCs, keyed by the invite token:
 *   rpc/get_plan_invite_guest -> title, venue_name, venue_address, start_time,
 *                                host_first_name, host_avatar_url,
 *                                attendee_count, loop_picked_spot, going[]
 *   rpc/tap_plan_web_rsvp     -> accepted, reason, guest_key
 *   rpc/name_plan_web_rsvp    -> accepted, reason
 * The page never sees or sends a plan id. Every value is written with
 * textContent / element properties (never as markup), so plan text cannot
 * inject anything. The guest key is kept in localStorage (try/catch) only so a
 * revisit can still add a name; losing it costs nothing but that.
 *
 * Pure helpers are exported for jest (__tests__/unit/site/plan-invite-page.test.ts)
 * and for the per-plan link preview (infra/plan-preview-worker).
 */
(function () {
  'use strict';

  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var MAX_FACES = 8;

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

  /** The Loop-picked line, or null. Strictly the boolean true from the RPC. */
  function pitchLine(inv) {
    if (!inv || inv.loop_picked_spot !== true) return null;
    var host = typeof inv.host_first_name === 'string' ? inv.host_first_name.trim() : '';
    return host ? host + ' didn’t pick this spot. Loop did.' : 'Loop picked this spot.';
  }

  /** RPC `going` -> faces. Https avatars only; nothing is invented. */
  function facesFor(going) {
    if (!Array.isArray(going)) return [];
    var out = [];
    for (var i = 0; i < going.length && out.length < MAX_FACES; i++) {
      var g = going[i] || {};
      var name = typeof g.first_name === 'string' ? g.first_name.trim() : '';
      if (!name) continue;
      var avatar = typeof g.avatar_url === 'string' && /^https:\/\//.test(g.avatar_url) ? g.avatar_url : null;
      out.push({ name: name, avatar: avatar, initial: name.charAt(0).toUpperCase() });
    }
    return out;
  }

  /** "Ana and Ben are going" / "Ana, Ben and 3 more are going". */
  function goingNames(faces, count) {
    if (!faces || faces.length === 0) return '';
    var shown = faces.slice(0, 2).map(function (f) { return f.name; });
    var total = typeof count === 'number' && count > faces.length ? count : faces.length;
    var more = total - shown.length;
    if (shown.length === 1 && more === 0) return shown[0] + ' is going';
    if (more === 0) return shown[0] + ' and ' + shown[1] + ' are going';
    return shown.join(', ') + ' and ' + more + ' more are going';
  }

  /** Per-plan title/description for the tab and the link preview. Real fields only. */
  function previewMeta(inv, locale) {
    inv = inv || {};
    var what = inv.title || inv.venue_name || '';
    var title = inv.host_first_name && what
      ? inv.host_first_name + ' invited you: ' + what
      : what || 'You’re invited on Loop';
    var parts = [];
    if (inv.venue_name && inv.venue_name !== what) parts.push(inv.venue_name);
    var when = inv.start_time ? formatStart(inv.start_time, locale) : '';
    if (when) parts.push(when);
    if (typeof inv.attendee_count === 'number' && inv.attendee_count > 0) parts.push(goingLabel(inv.attendee_count));
    return {
      title: title,
      description: parts.length ? parts.join(' · ') : 'Tap to see the plan and say you’re in.',
    };
  }

  var REASON_COPY = {
    invalid_name: 'Please add your name.',
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

  function storeKey(token) { return 'loop:plan-rsvp:' + token; }
  function loadRsvp(token) {
    try { return JSON.parse(window.localStorage.getItem(storeKey(token)) || 'null'); } catch (e) { return null; }
  }
  function saveRsvp(token, value) {
    try { window.localStorage.setItem(storeKey(token), JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).hidden = false; }
  function hide(id) { el(id).hidden = true; }
  function text(id, value) { el(id).textContent = value || ''; }

  function renderFaces(faces) {
    var row = el('inv-faces');
    while (row.firstChild) row.removeChild(row.firstChild);
    faces.forEach(function (f) {
      var node;
      if (f.avatar) {
        node = document.createElement('img');
        node.src = f.avatar;
        node.alt = f.name;
        node.referrerPolicy = 'no-referrer';
      } else {
        node = document.createElement('span');
        node.textContent = f.initial;
        node.setAttribute('aria-label', f.name);
      }
      node.className = 'inv-face';
      row.appendChild(node);
    });
    row.hidden = faces.length === 0;
  }

  function renderInvite(inv) {
    var meta = previewMeta(inv);
    document.title = meta.title + ' · Loop';
    text('inv-host', inv.host_first_name ? inv.host_first_name + ' invited you' : 'You’re invited');
    text('inv-title', inv.title || inv.venue_name || 'A plan on Loop');
    text('inv-venue', inv.venue_name && inv.venue_name !== inv.title ? inv.venue_name : '');
    text('inv-address', inv.venue_address);
    text('inv-time', formatStart(inv.start_time));
    var faces = facesFor(inv.going);
    renderFaces(faces);
    text('inv-going', goingNames(faces, inv.attendee_count) || goingLabel(inv.attendee_count));
    var pitch = pitchLine(inv);
    text('inv-pitch', pitch);
    el('inv-pitch').hidden = !pitch;
    hide('inv-loading');
    show('inv-card');
  }

  function fail(message) {
    hide('inv-loading');
    text('inv-error', message);
    show('inv-error');
  }

  function showDone(choice, named) {
    hide('inv-choice');
    text('inv-done-title', choice === 'yes' ? 'You’re in.' : 'Thanks for letting them know.');
    show('inv-done');
    if (choice === 'yes' && !named) show('inv-name-step');
    else hide('inv-name-step');
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

    function load() {
      return rpc(cfg, 'get_plan_invite_guest', { p_token: token }).then(function (rows) {
        if (!Array.isArray(rows) || rows.length === 0) { fail('This invite is no longer active.'); return; }
        renderInvite(rows[0]);
      });
    }
    load().catch(function () { fail('This invite can’t be loaded right now.'); });

    var prior = loadRsvp(token);
    if (prior && (prior.choice === 'yes' || prior.choice === 'no')) showDone(prior.choice, prior.named);

    ['yes', 'no'].forEach(function (choice) {
      el('inv-' + choice).addEventListener('click', function () {
        el('inv-yes').disabled = true;
        el('inv-no').disabled = true;
        hide('inv-tap-error');
        rpc(cfg, 'tap_plan_web_rsvp', { p_token: token, p_response: choice }).then(function (rows) {
          var r = Array.isArray(rows) ? rows[0] : null;
          if (!r || !r.accepted) throw new Error((r && r.reason) || 'unknown');
          saveRsvp(token, { choice: choice, key: r.guest_key, named: false });
          showDone(choice, false);
          load().catch(function () { /* the tap landed; a stale count is fine */ });
        }).catch(function (err) {
          text('inv-tap-error', reasonCopy(err && err.message));
          show('inv-tap-error');
          el('inv-yes').disabled = false;
          el('inv-no').disabled = false;
        });
      });
    });

    el('inv-name-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var saved = loadRsvp(token) || {};
      var btn = el('inv-name-save');
      btn.disabled = true;
      hide('inv-name-error');
      rpc(cfg, 'name_plan_web_rsvp', { p_token: token, p_guest_key: saved.key || null, p_name: el('inv-name').value }).then(function (rows) {
        var r = Array.isArray(rows) ? rows[0] : null;
        if (!r || !r.accepted) throw new Error((r && r.reason) || 'unknown');
        saved.named = true;
        saveRsvp(token, saved);
        hide('inv-name-step');
        load().catch(function () { /* named; a stale face list is fine */ });
      }).catch(function (err) {
        text('inv-name-error', reasonCopy(err && err.message));
        show('inv-name-error');
        btn.disabled = false;
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parsePlanToken: parsePlanToken, formatStart: formatStart, goingLabel: goingLabel,
      reasonCopy: reasonCopy, pitchLine: pitchLine, facesFor: facesFor, goingNames: goingNames,
      previewMeta: previewMeta, TOKEN_RE: TOKEN_RE,
    };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
