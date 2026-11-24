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
 * Planner funnel lane 3: when the host attached 2-3 Loop-picked options, the
 * guest votes with one tap per option (tap again to undo), no account. Data
 * from migration 236's anon RPCs, keyed by the same token:
 *   rpc/get_plan_invite_options -> kind, ordinal, slot_start, venue_name,
 *                                  venue_address, basis, votes, locked
 *   rpc/vote_plan_option_web    -> accepted, reason, voter_key
 * The page never says "you're all free": a web guest's availability is never
 * known. A time option claims only its basis ("Everyone on Loop is free" /
 * "Host is free"). The voter key (or the RSVP guest key) is kept in
 * localStorage (try/catch).
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

  /** "<host> invited you", or a neutral line when the RPC gives no host name. */
  function hostLine(inv) {
    var host = inv && typeof inv.host_first_name === 'string' ? inv.host_first_name.trim() : '';
    return host ? host + ' invited you' : 'You’re invited';
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
    var host = typeof inv.host_first_name === 'string' ? inv.host_first_name.trim() : '';
    var title = host && what
      ? host + ' invited you: ' + what
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

  /** RPC option rows -> { time: [...], place: [...] }; a kind with < 2 options is not a vote and is dropped unless locked. */
  function groupOptions(rows) {
    var out = { time: [], place: [] };
    if (!Array.isArray(rows)) return out;
    rows.forEach(function (o) {
      if (!o || (o.kind !== 'time' && o.kind !== 'place')) return;
      var ord = typeof o.ordinal === 'number' ? o.ordinal : 0;
      if (ord < 1 || ord > 3) return;
      if (o.kind === 'time' && (typeof o.slot_start !== 'string' || isNaN(new Date(o.slot_start).getTime()))) return;
      if (o.kind === 'place' && (typeof o.venue_name !== 'string' || !o.venue_name.trim())) return;
      out[o.kind].push(o);
    });
    ['time', 'place'].forEach(function (k) {
      out[k].sort(function (a, b) { return a.ordinal - b.ordinal; });
      var anyLocked = out[k].some(function (o) { return o.locked === true; });
      if (out[k].length < 2 && !anyLocked) out[k] = [];
    });
    return out;
  }

  function voteHeading(kind, locked) {
    if (locked) return kind === 'time' ? 'Time locked in' : 'Place locked in';
    return kind === 'time' ? 'Vote on a time' : 'Vote on a place';
  }

  function optionTitle(o, locale) {
    if (!o) return '';
    return o.kind === 'time' ? formatStart(o.slot_start, locale) : (o.venue_name || '').trim();
  }

  /** The small line under an option. Claims exactly its basis, nothing more. */
  function optionTag(o) {
    if (!o) return '';
    if (o.kind === 'time') {
      if (o.basis === 'all_free') return 'Everyone on Loop is free';
      if (o.basis === 'host_free') return 'Host is free';
      return '';
    }
    return typeof o.venue_address === 'string' ? o.venue_address.trim() : '';
  }

  function votesLabel(n) {
    var c = typeof n === 'number' && n > 0 ? n : 0;
    if (c === 0) return 'No votes yet';
    return c === 1 ? '1 vote' : c + ' votes';
  }

  /**
   * Per-token JSON store: memory first (this page session), then localStorage.
   * Gate 2026-11-24: with storage blocked, every tap used to mint a new voter,
   * so tap-again could never undo. Memory keeps the voter key + votes anyway.
   */
  function makeStore(getStorage, prefix) {
    var mem = {};
    function copy(v) { return v == null ? null : JSON.parse(JSON.stringify(v)); }
    return {
      load: function (token) {
        if (Object.prototype.hasOwnProperty.call(mem, token)) return copy(mem[token]);
        try { return JSON.parse(getStorage().getItem(prefix + token) || 'null'); } catch (e) { return null; }
      },
      save: function (token, value) {
        mem[token] = copy(value);
        try { getStorage().setItem(prefix + token, JSON.stringify(value)); } catch (e) { /* private mode */ }
      },
    };
  }

  /** Normalise a stored vote state. */
  function voteState(v) {
    return v && typeof v === 'object' && v.on && typeof v.on === 'object' ? v : { on: {} };
  }

  /**
   * An un-vote with no voter key has nothing on the server to undo (no key
   * means this browser never landed a vote): it is a local change only, never
   * an RPC that would come back 'not_found'.
   */
  function needsServerCall(key, on) {
    return on === true || Boolean(key);
  }

  var REASON_COPY = {
    vote_failed: 'Couldn\u2019t update your vote. Please try again.',
    closed: 'Voting on this has closed.',
    invalid_option: 'That option is no longer available.',
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

  function browserStorage() { return window.localStorage; }
  var rsvpStore = makeStore(browserStorage, 'loop:plan-rsvp:');
  var voteStore = makeStore(browserStorage, 'loop:plan-vote:');
  function loadRsvp(token) { return rsvpStore.load(token); }
  function saveRsvp(token, value) { rsvpStore.save(token, value); }

  function loadVotes(token) { return voteState(voteStore.load(token)); }
  function saveVotes(token, value) { voteStore.save(token, value); }

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
    text('inv-host', hostLine(inv));
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

  function renderOptions(groups, votes, onTap) {
    var box = el('inv-options');
    while (box.firstChild) box.removeChild(box.firstChild);
    var any = false;
    ['time', 'place'].forEach(function (kind) {
      var list = groups[kind];
      if (!list || list.length === 0) return;
      any = true;
      var locked = list.some(function (o) { return o.locked === true; });
      var h = document.createElement('p');
      h.className = 'inv-vote-h';
      h.textContent = voteHeading(kind, locked);
      box.appendChild(h);
      list.forEach(function (o) {
        var mine = votes.on[kind + '-' + o.ordinal] === true;
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'inv-opt' + (mine || o.locked === true ? ' on' : '');
        b.disabled = locked;
        b.setAttribute('aria-pressed', mine ? 'true' : 'false');
        var t = document.createElement('span');
        t.className = 'inv-opt-t';
        t.textContent = optionTitle(o) + (o.locked === true ? ' \u2713' : '');
        var sub = document.createElement('span');
        sub.className = 'inv-opt-s';
        var tag = optionTag(o);
        sub.textContent = (tag ? tag + ' \u00b7 ' : '') + votesLabel(o.votes);
        b.appendChild(t);
        b.appendChild(sub);
        if (!locked) b.addEventListener('click', function () { onTap(o, !mine); });
        box.appendChild(b);
      });
    });
    box.hidden = !any;
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

    var voting = false;
    function loadOptions() {
      return rpc(cfg, 'get_plan_invite_options', { p_token: token }).then(function (rows) {
        renderOptions(groupOptions(rows), loadVotes(token), tapOption);
      });
    }
    function tapOption(o, on) {
      if (voting) return;
      voting = true;
      hide('inv-vote-error');
      var votes = loadVotes(token);
      var rsvp = loadRsvp(token) || {};
      var key = votes.key || rsvp.key || null;
      if (!needsServerCall(key, on)) {
        votes.on[o.kind + '-' + o.ordinal] = false;
        saveVotes(token, votes);
        voting = false;
        loadOptions().catch(function () { /* a stale tally is fine */ });
        return;
      }
      rpc(cfg, 'vote_plan_option_web', { p_token: token, p_voter_key: key, p_kind: o.kind, p_ordinal: o.ordinal, p_on: on }).then(function (rows) {
        var r = Array.isArray(rows) ? rows[0] : null;
        if (!r || !r.accepted) throw new Error((r && r.reason) || 'unknown');
        votes.key = r.voter_key || key;
        votes.on[o.kind + '-' + o.ordinal] = on;
        saveVotes(token, votes);
      }).catch(function (err) {
        var reason = err && err.message;
        // An un-vote that fails is never "this invite is no longer active".
        text('inv-vote-error', reasonCopy(!on && reason === 'not_found' ? 'vote_failed' : reason));
        show('inv-vote-error');
      }).then(function () {
        voting = false;
        return loadOptions();
      }).catch(function () { /* a stale tally is fine */ });
    }
    loadOptions().catch(function () { /* no options shown; the invite still works */ });

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
      reasonCopy: reasonCopy, hostLine: hostLine, groupOptions: groupOptions, voteHeading: voteHeading,
      optionTitle: optionTitle, optionTag: optionTag, votesLabel: votesLabel,
      makeStore: makeStore, voteState: voteState, needsServerCall: needsServerCall, pitchLine: pitchLine, facesFor: facesFor, goingNames: goingNames,
      previewMeta: previewMeta, TOKEN_RE: TOKEN_RE,
    };
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
