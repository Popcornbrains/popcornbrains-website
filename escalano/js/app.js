/*
  ESCALANO live scorebord: de weergaven (SPEC.md, sectie 6).

  Een URL, vier weergaven: landing (geen e), speler (e), tv (e&tv), beheer (beheer, e&beheer).
  ?demo zet een lokaal voorbeeldtoernooi klaar (16 namen) zonder backend.
  Alle toernooilogica zit in js/engine.js (ESCALANO_ENGINE.derive); hier alleen tonen en versturen.
*/
(function () {
  'use strict';

  // Zelftest-haak: elke fout komt in window.__escalano_errors (nul is de lat).
  window.__escalano_errors = window.__escalano_errors || [];
  function noteError(msg) {
    window.__escalano_errors.push(msg);
    // Ook in de DOM, zodat een headless --dump-dom het kan lezen.
    try { document.documentElement.setAttribute('data-escalano-errors', JSON.stringify(window.__escalano_errors)); } catch (e) { /* niets */ }
  }
  window.addEventListener('error', function (ev) {
    noteError(String(ev && ev.message ? ev.message : ev));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    noteError('promise: ' + String(r && r.message ? r.message : r));
  });

  var ENGINE = window.ESCALANO_ENGINE;
  var API = window.ESCALANO_API;
  var CONFIG = window.ESCALANO_CONFIG || {};
  var POINTS = ENGINE.POINTS;
  var DEMO_CODE = 'DEMO';
  var POLL_MS = 4000;
  var BACKOFF = [5000, 10000, 20000];
  var ARM_MS = 8000;
  var ARM_MIN_MS = 600;   // een tweede tik binnen 600 ms na het wapenen telt niet (stuiterende duim)
  var QUIET_MS = 1200;    // na een cijfertik blijft het scherm zo lang stil: geen render van de poll
  var MSG_MS = 4000;      // een bevestiging onder beheer verdwijnt na 4 s
  var COPIED_MS = 2000;   // "Gekopieerd" blijft 2 s staan
  var OVERLAY_MS = 3000;  // tv: "Ronde 4 gespeeld" blijft 3 s staan (4 s bij 20 of 24 spelers, zie overlayMs)
  var ORIGIN_MS = 10000;  // tv: daarna 10 s "van veld 3" op de treden en rangpijlen in de stand
  var PULSE_MS = 700;     // tv: een trede pulseert een keer als een score landt
  var WEG_MS = 300;       // een toast vervaagt 300 ms voor hij weggaat (de JS bepaalt de tijd, niet de CSS)
  var LAATST_MS = 20 * 3600000;   // de landing onthoudt het laatste toernooi 20 u
  var SIZES = [8, 12, 16, 20, 24];
  var BRAND = 'assets/brand/';

  function overlayMs(st) {
    return st && st.players && st.players.length >= 20 ? 4000 : OVERLAY_MS;
  }

  // ---------- platform (js/platform.js, optioneel) ----------
  // Elke helper wordt pas bij de aanroep opgezocht en mag ontbreken: de app werkt met en zonder.

  function pf(name) {
    var p = window.ESCALANO_PLATFORM;
    return p && typeof p[name] === 'function' ? p[name] : null;
  }
  function tick() { var f = pf('tick'); if (f) { try { f(); } catch (e) { /* stil */ } } }
  function thud() { var f = pf('thud'); if (f) { try { f(); } catch (e) { /* stil */ } } }

  function copyFallback(text) {
    return new Promise(function (resolve) {
      var done = function (ok) { resolve(!!ok); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(copyViaTextarea(text)); });
          return;
        }
      } catch (e) { /* valt terug */ }
      done(copyViaTextarea(text));
    });
  }
  function copyViaTextarea(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '-100px';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    } catch (e) { return false; }
  }
  // -> Promise<boolean>
  function copyText(text) {
    var f = pf('copy');
    if (f) {
      try { return Promise.resolve(f(text)).then(function (r) { return !!r; }, function () { return copyFallback(text); }); } catch (e) { /* valt terug */ }
    }
    return copyFallback(text);
  }
  // -> Promise<'shared'|'copied'|false>
  function shareText(o) {
    var f = pf('share');
    if (f) {
      try { return Promise.resolve(f(o)).then(function (r) { return r || false; }, function () { return false; }); } catch (e) { /* valt terug */ }
    }
    return copyText(o.text).then(function (ok) { return ok ? 'copied' : false; });
  }
  // "12 min", "1 u 05 min"; "net" onder de minuut.
  function relTime(ts) {
    var f = pf('relativeTime');
    if (f) { try { var r = f(ts); if (r) return String(r); } catch (e) { /* eigen versie */ } }
    var t = Date.parse(ts);
    if (!isFinite(t)) return '';
    var min = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (min < 1) return 'net';
    if (min < 60) return min + ' min';
    var m = min % 60;
    return Math.floor(min / 60) + ' u ' + (m < 10 ? '0' : '') + m + ' min';
  }
  function clockText() {
    var f = pf('clock');
    if (f) { try { var r = f(); if (r) return String(r); } catch (e) { /* eigen versie */ } }
    var d = new Date();
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
  }
  function reducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // ---------- iconen (inline SVG, 1.75 px lijn, currentColor) ----------

  var ICONS = {
    omhoog: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    omlaag: '<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>',
    gelijk: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    vink: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    kopieer: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    deel: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>'
  };
  function icoon(name, cls) {
    return '<svg class="icoon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }
  // De beweging als badge: omhoog mosterd, omlaag roze, blijft creme op groen.
  function bewegingBadge(dir) {
    var name = dir > 0 ? 'omhoog' : dir < 0 ? 'omlaag' : 'gelijk';
    var cls = dir > 0 ? 'beweging--op' : dir < 0 ? 'beweging--af' : 'beweging--blijft';
    return '<span class="beweging ' + cls + '" aria-hidden="true">' + icoon(name) + '</span>';
  }

  // ---------- URL en weergave ----------

  var params = new URLSearchParams(window.location.search);
  var P = {
    e: (params.get('e') || '').trim().toUpperCase(),
    v: toInt(params.get('v')),
    tv: params.has('tv'),
    beheer: params.has('beheer'),
    demo: params.has('demo'),
    api: params.get('api') || ''
  };
  if (P.demo && !P.e) P.e = DEMO_CODE;
  var VIEW = (!P.e && !P.beheer) ? 'landing' : P.tv ? 'tv' : P.beheer ? 'beheer' : 'speler';
  document.documentElement.setAttribute('data-view', VIEW);

  var app = document.getElementById('app');

  // ---------- hulpjes ----------

  function toInt(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim();
    return /^-?\d{1,9}$/.test(s) ? parseInt(s, 10) : null;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "2", "2 en 4", "2, 3 en 4"
  function listNl(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];
  }

  var memPrefs = {};
  function pref(key) {
    try {
      var v = window.localStorage.getItem(key);
      if (v !== null) return v;
    } catch (e) { /* geen opslag */ }
    return Object.prototype.hasOwnProperty.call(memPrefs, key) ? memPrefs[key] : null;
  }
  function setPref(key, value) {
    if (value === null) {
      delete memPrefs[key];
      try { window.localStorage.removeItem(key); } catch (e) { /* geen opslag */ }
      return;
    }
    memPrefs[key] = value;
    try { window.localStorage.setItem(key, value); } catch (e) { /* geen opslag */ }
  }

  function baseUrl() {
    return window.location.origin + window.location.pathname.replace(/index\.html?$/i, '');
  }
  // Link naar deze pagina met het event erin (plus ?api= als die gebruikt wordt).
  function link(extra) {
    var parts = [P.demo ? 'demo' : 'e=' + encodeURIComponent(P.e)];
    if (extra) parts.push(extra);
    if (P.api) parts.push('api=' + encodeURIComponent(P.api));
    return baseUrl() + '?' + parts.join('&');
  }
  function shortUrl(u) {
    return u.replace(/^https?:\/\//, '');
  }

  var qrCache = {};
  function qrSvg(text) {
    if (qrCache[text]) return qrCache[text];
    var svg = '';
    try {
      var q = window.qrcode(0, 'M');
      q.addData(text);
      q.make();
      svg = q.createSvgTag({ scalable: true, margin: 2 })
        .replace(/fill="black"/g, 'fill="#123D33"')
        .replace(/fill="white"/g, 'fill="none"');
    } catch (e) {
      svg = '';
    }
    qrCache[text] = svg;
    return svg;
  }

  // Voorbij de geplande rondes: "Extra ronde 10", nooit "Ronde 10 van 9".
  function isExtra(st) {
    return !!st && st.status === 'live' && st.round > st.plannedRounds;
  }
  function rondeTekst(st, round) {
    var r = round === undefined ? st.round : round;
    return (st && r > st.plannedRounds ? 'Extra ronde ' : 'Ronde ') + r;
  }
  // Zonder toestand (het bord laadt nog) geen pil: nooit "Nog niet gestart" voor een toernooi dat misschien loopt.
  function roundLabel(st) {
    if (!st) return '';
    if (st.status === 'setup') return 'Nog niet gestart';
    if (st.status === 'done') return 'Afgelopen';
    if (isExtra(st)) return 'Extra ronde ' + st.round;
    return 'Ronde ' + st.round + ' van ' + st.plannedRounds;
  }

  // De by-waarde uit de API ('organisator') leesbaar in een zin.
  function byLabel(by) {
    var s = String(by || '').trim();
    return s === 'organisator' ? 'de organisator' : s;
  }

  // "Veld 2 staat nog open" / "Veld 2 en 4 staan nog open"
  function openVeldenZin(st) {
    var m = missingCourts(st);
    if (!m.length) return '';
    return 'Veld ' + listNl(m.map(String)) + ' van ' + rondeTekst(st).toLowerCase() + (m.length === 1 ? ' staat' : ' staan') + ' nog open, die punten tellen niet mee.';
  }

  function missingCourts(st) {
    var out = [];
    if (!st || !st.current) return out;
    for (var c = 0; c < st.courts; c++) if (!st.current.scores[c]) out.push(c + 1);
    return out;
  }

  function waitingText(st) {
    if (!st || st.status !== 'live' || !st.current) return '';
    var m = missingCourts(st);
    if (m.length === 0) return '';
    if (m.length === st.courts) return 'Wachten op alle velden.';
    return 'Wachten op veld ' + listNl(m.map(String)) + '.';
  }

  // Jouw potje in de open ronde: veld, partner, tegenstanders.
  function myMatch(st, i) {
    if (!st || !st.current || i === null || i === 'anon') return null;
    var ms = st.current.matches;
    for (var c = 0; c < ms.length; c++) {
      var m = ms[c];
      if (m.a.indexOf(i) >= 0) return { court: c, team: 'a', partner: m.a[0] === i ? m.a[1] : m.a[0], opp: m.b };
      if (m.b.indexOf(i) >= 0) return { court: c, team: 'b', partner: m.b[0] === i ? m.b[1] : m.b[0], opp: m.a };
    }
    return null;
  }

  function sentence(st, i, withRound) {
    var mm = myMatch(st, i);
    if (!mm) return '';
    var n = st.players;
    var core = 'jij speelt op veld ' + (mm.court + 1) + ' met <strong>' + esc(n[mm.partner]) + '</strong>, tegen ' +
      esc(n[mm.opp[0]]) + ' en ' + esc(n[mm.opp[1]]) + '.';
    return withRound ? rondeTekst(st) + ': ' + core : 'J' + core.slice(1);
  }

  // De titel van de winnaar komt uit de engine (SPEC 1, v1.3): El Campeón bij m, La Campeona bij v,
  // de dubbelvorm alleen als het geslacht niet gekend is. Nooit hier zelf beslissen.
  function winnerTitle(st, w) {
    return ENGINE.titleFor(st, w && typeof w.i === 'number' ? w.i : null);
  }

  // ---------- M/V (v1.3, SPEC 6.4): alleen om de titel van de winnaar te kiezen, nergens anders getoond ----------

  // "Eva (v)" of "Noor (M)": de markering hoort nooit bij de naam.
  var MARKER = /\s*\(\s*([mv])\s*\)\s*$/i;
  function parseNaam(raw) {
    var s = String(raw === undefined || raw === null ? '' : raw).trim();
    var m = MARKER.exec(s);
    return m ? { name: s.slice(0, m.index).trim(), g: m[1].toLowerCase() } : { name: s, g: null };
  }
  // De regels van een plakvak: elke naam met zijn markering (of null), lege regels weg.
  function parseLines(raw) {
    return String(raw || '').split(/\r?\n/).map(parseNaam).filter(function (x) { return !!x.name; });
  }
  function isG(x) { return x === 'm' || x === 'v'; }
  function geldigeRij(g, n) {
    if (!Array.isArray(g) || g.length !== n) return false;
    for (var i = 0; i < n; i++) if (!isG(g[i])) return false;
    return true;
  }
  function alleM(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push('m');
    return out;
  }
  // De keuze van dit toestel (escalano-g-CODE), anders wat de laatste start of end meestuurde, anders iedereen M.
  function gendersFor(st) {
    var n = st && st.players ? st.players.length : 0;
    var eigen = null;
    try { eigen = JSON.parse(pref('escalano-g-' + P.e) || 'null'); } catch (e) { eigen = null; }
    if (geldigeRij(eigen, n)) return eigen.slice();
    if (st && geldigeRij(st.genders, n)) return st.genders.slice();
    return alleM(n);
  }
  function saveGenders(code, g) {
    if (code) setPref('escalano-g-' + code, JSON.stringify(g));
  }
  // Een nieuwe spelerslijst: een markering wint, wie al gekend was houdt zijn keuze (op naam), de rest is M.
  function realign(oudeNamen, oudeG, nieuweNamen, markering) {
    var opNaam = {};
    (oudeNamen || []).forEach(function (nm, i) {
      var k = String(nm || '').trim().toLowerCase();
      if (k && oudeG && isG(oudeG[i])) opNaam[k] = oudeG[i];
    });
    return nieuweNamen.map(function (nm, i) {
      if (markering && isG(markering[i])) return markering[i];
      return opNaam[String(nm || '').trim().toLowerCase()] || 'm';
    });
  }
  // Het M/V-paar: twee knoppen van 48 px, de gekozen ingedrukt. Zichtbaar M en V, voor een schermlezer "Eva: vrouw".
  // M is de stille standaard, V valt op: alleen de vrouwen vragen een tik.
  function mvPaarHtml(act, i, g, naam) {
    var wie = String(naam || '').trim() || 'Speler ' + (i + 1);
    function knop(x, woord) {
      var aan = g === x;
      return '<button type="button" class="mv mv--' + x + (aan ? ' is-aan' : '') + '" data-act="' + act + '" data-i="' + i + '" data-g="' + x + '" aria-pressed="' + aan + '" aria-label="' + esc(wie + ': ' + woord) + '">' + x.toUpperCase() + '</button>';
    }
    return '<span class="mv-paar">' + knop('m', 'man') + knop('v', 'vrouw') + '</span>';
  }
  // De lijst voor setup en live: elke speler in startvolgorde met zijn M/V-paar.
  function mvLijstHtml(st) {
    var g = gendersFor(st);
    return '<div class="mv-lijst">' + st.players.map(function (nm, i) {
      return '<div class="mv-rij"><span class="mv-naam">' + esc(nm) + '</span>' + mvPaarHtml('mv', i, g[i], nm) + '</div>';
    }).join('') + '</div>';
  }
  var MV_ZIN = 'Tik V bij de vrouwen: zo krijgt de winnaar de juiste titel.';

  // "5e": in het Nederlands eindigt elk rangtelwoord hier op e.
  function rangTekst(idx) {
    return (idx + 1) + 'e';
  }

  // Het veld (0-based) waarop speler i in een lijst van matches staat, of null.
  function courtOf(matches, i) {
    for (var c = 0; c < matches.length; c++) {
      if (matches[c].a.indexOf(i) >= 0 || matches[c].b.indexOf(i) >= 0) return c;
    }
    return null;
  }

  // De beweging van speler i na de laatst gesloten ronde: {from, to, dir} (dir 1 = klimt, -1 = zakt, 0 = blijft), of null.
  function moveOf(st, i) {
    if (!st || !st.current || !st.rounds.length || typeof i !== 'number') return null;
    var from = courtOf(st.rounds[st.rounds.length - 1].matches, i);
    var to = courtOf(st.current.matches, i);
    if (from === null || to === null) return null;
    return { from: from, to: to, dir: to < from ? 1 : to > from ? -1 : 0 };
  }

  // "Je klimt naar veld 2" / "Je zakt naar veld 3" / "Je blijft op veld 1"
  function moveSentence(mv) {
    if (!mv) return '';
    if (mv.dir > 0) return 'Je klimt naar veld ' + (mv.to + 1);
    if (mv.dir < 0) return 'Je zakt naar veld ' + (mv.to + 1);
    return 'Je blijft op veld ' + (mv.to + 1);
  }

  // Wanneer de open ronde begon: de ts van de score die de vorige ronde sloot, of van de start.
  function roundOpenedAt(st) {
    if (!st || st.status !== 'live' || !st.current) return null;
    var last = st.rounds[st.rounds.length - 1];
    var best = null;
    if (last) {
      last.matches.forEach(function (m) { if (m.ts && (best === null || m.ts > best)) best = m.ts; });
    } else {
      store.log.forEach(function (e) { if (e && e.type === 'start' && e.ts && best === null) best = e.ts; });
    }
    return best;
  }

  // Het stuk "bezig sinds 12 min" (tikt zelf verder, zie tickers()).
  function sindsHtml(st, cls) {
    var ts = roundOpenedAt(st);
    if (!ts) return '';
    var rel = relTime(ts);
    if (!rel) return '';
    return '<span class="' + cls + ' cijfers" data-tick="sinds" data-ts="' + esc(ts) + '">' + esc(sindsTekst(rel)) + '</span>';
  }
  // "bezig sinds 12 min"; de eerste minuut "net begonnen" (SPEC 9.3).
  function sindsTekst(rel) {
    return rel === 'net' ? 'net begonnen' : 'bezig sinds ' + rel;
  }

  // De rondestippen: gevuld = gespeeld, open = de ronde bezig, leeg = nog te spelen. Altijd de geplande rondes
  // (negen stippen bij negen rondes); een extra ronde staat alleen in het label.
  function stippenHtml(st) {
    if (!st || st.status === 'setup' || st.plannedRounds > 12) return '';
    var played = Math.min(st.rounds.length, st.plannedRounds);
    var total = st.plannedRounds;
    var h = '<span class="stippen" role="img" aria-label="' + played + ' van ' + total + ' rondes gespeeld">';
    for (var r = 1; r <= total; r++) {
      var cls = r <= played ? ' is-gespeeld' : (st.status === 'live' && r === played + 1 && played < total) ? ' is-bezig' : '';
      h += '<i class="stip' + cls + '"></i>';
    }
    return h + '</span>';
  }

  // ---------- toestand ----------

  var store = { event: null, log: [], seen: {}, state: null, prevState: null, lastSeq: 0, conn: 'init', retry: 0, unknown: false };

  var ui = {
    // speler
    me: null, court: null, team: 'a', sa: null, armed: false, armTimer: null, armedAt: 0,
    sending: null,      // {round, court, sa, sb} zolang een score onderweg is: de kaart toont de score, nooit een lege editor
    sendMsg: '', sent: null, roundAtLoad: null,
    editorRound: null, editorCourt: null,   // de editor onthoudt zijn eigen ronde en veld (een gesloten ronde verstuurt nooit)
    pickerOpen: false,  // anoniem met een veld-QR: de veldkeuze is een regel, "Ander veld?" klapt ze open
    showStand: null,    // null = de standaard van de weergave (open na afloop, dicht tijdens het spel)
    openDetails: {},    // elk ander uitklapblok (data-details) onthoudt open/dicht over een render heen
    quietUntil: 0,      // tot wanneer een render van de poll wacht (net een cijfer gekozen)
    wisselFx: false,    // de ingegeven-kaart vervaagt naar de nieuwe opstelling
    // beheer
    pin: null, pinDraft: '', pinErr: '', corr: null,
    endEd: { armed: false, armTimer: null, armedAt: 0 },
    startEd: { armed: false, armTimer: null, armedAt: 0 },
    busy: false, msg: '', msgWeg: false, msgTimer: null, msgWegTimer: null, pending: null, playersDraft: null, showPrev: false, showPlayers: false, showPunten: false, puntenRound: null,
    copied: null, copiedTimer: null,   // welke link net gekopieerd of gedeeld is: {key, txt}
    showLinks: null,    // open in setup, dicht vanaf live (bepaald bij de eerste toestand)
    create: { n: 16, names: [], genders: [], name: '', planned: CONFIG.PLANNED_ROUNDS || 9, pin: '', err: '', errField: '', paste: '' },
    showCode: false
  };

  // tv: de eenmalige effecten (puls, overgang, herkomst), nooit toestand van het toernooi zelf
  var tvFx = { round: null, seen: {}, overlay: null, originUntil: 0, prevRanks: null, timer: null, toast: false };

  function isFoutMsg(txt) {
    return /^Niet gelukt|^Geen|niet verstuurd/.test(txt || '');
  }

  // Een bericht onder beheer dat na 4 s (fout: 8 s) vanzelf verdwijnt; de laatste 300 ms vervaagt hij.
  // De JS bepaalt de tijd: een render tussendoor zet de toast niet opnieuw op vol.
  function setMsg(text) {
    ui.msg = text || '';
    ui.msgWeg = false;
    clearTimeout(ui.msgTimer);
    clearTimeout(ui.msgWegTimer);
    if (!ui.msg) return;
    var ms = isFoutMsg(ui.msg) ? MSG_MS * 2 : MSG_MS;
    ui.msgWegTimer = setTimeout(function () { ui.msgWeg = true; render(); }, ms - WEG_MS);
    ui.msgTimer = setTimeout(function () { ui.msg = ''; ui.msgWeg = false; render(); }, ms);
  }

  // Het toestel onthoudt het laatste toernooi (SPEC 6.1): de landing biedt "Verder met ..." aan, 20 u lang.
  function rememberLast() {
    if (!P.e || P.demo || !store.event || !store.state) return;
    try {
      setPref('escalano-laatst', JSON.stringify({ code: P.e, view: VIEW, name: store.event.name, status: store.state.status, at: Date.now() }));
      var gezien = {};
      try { gezien = JSON.parse(pref('escalano-gezien') || '{}') || {}; } catch (e) { gezien = {}; }
      gezien[P.e] = Date.now();
      setPref('escalano-gezien', JSON.stringify(gezien));
    } catch (e) { /* geen opslag */ }
  }
  function lastEvent() {
    try {
      var o = JSON.parse(pref('escalano-laatst') || 'null');
      if (!o || !o.code || !o.name || typeof o.at !== 'number' || Date.now() - o.at > LAATST_MS) return null;
      return o;
    } catch (e) { return null; }
  }
  // Na een nieuw toernooi: pincodes, naamkeuzes en M/V van toernooien die meer dan 30 dagen niet gezien zijn, opruimen.
  function pruneOld(keepCode) {
    try {
      var gezien = {};
      try { gezien = JSON.parse(pref('escalano-gezien') || '{}') || {}; } catch (e) { gezien = {}; }
      var ls = window.localStorage, weg = [];
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i), m = /^escalano-(pin|me|g)-(.+)$/.exec(k || '');
        if (!m || m[2] === keepCode || m[2] === DEMO_CODE) continue;
        if (!gezien[m[2]] || Date.now() - gezien[m[2]] > 30 * 86400000) weg.push(k);
      }
      weg.forEach(function (k) { setPref(k, null); });
    } catch (e) { /* geen opslag */ }
  }

  function loadPrefs() {
    var me = pref('escalano-me-' + P.e);
    // Alleen in de demo: ?me=3 of ?me=anon kiest meteen een speler (om de gsm-weergave te tonen).
    if (P.demo && params.get('me') !== null) me = params.get('me');
    if (me === 'anon') ui.me = 'anon';
    else if (me !== null && toInt(me) !== null) ui.me = toInt(me);
    ui.pin = pref('escalano-pin-' + P.e);
  }

  // ---------- ophalen (polling) ----------

  var pollTimer = null;
  var inflight = false;
  var pollAgain = false;   // een eigen schrijfactie kwam binnen terwijl een poll liep: meteen nog eens
  var failures = 0;

  function schedule(ms) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms);
  }

  function poll() {
    if (!P.e || document.hidden) return;
    if (inflight) { pollAgain = true; return; }
    inflight = true;
    pollAgain = false;
    clearTimeout(pollTimer);
    API.getState(P.e, store.lastSeq).then(function (res) {
      inflight = false;
      if (!res || !res.ok) {
        if (res && res.error === 'unknown') {
          store.unknown = true;
          // Met een bord op het scherm: de server kent het toernooi niet meer, het bord blijft staan.
          store.conn = store.state ? 'onbekend' : (API.mode() === 'local' ? 'local' : 'ok');
          renderPoll();
          schedule(POLL_MS * 3);
          return;
        }
        throw new Error(res && res.error ? res.error : 'bad');
      }
      store.unknown = false;
      var refetch = merge(res);
      failures = 0;
      store.conn = API.mode() === 'local' ? 'local' : 'ok';
      store.retry = 0;
      if (!refetch) resolvePending();
      renderPoll();
      // Wakker houden alleen bij een overgang (eerste toestand, status wisselt), niet bij elke poll.
      if (store.state && store.state.status !== awakeStatus) { awakeStatus = store.state.status; keepAwake(); }
      schedule(refetch || pollAgain ? 0 : POLL_MS);
    }).catch(function () {
      inflight = false;
      var wait = BACKOFF[Math.min(failures, BACKOFF.length - 1)];
      failures += 1;
      store.conn = 'lost';
      store.retry = wait / 1000;
      renderPoll();
      schedule(wait);
    });
  }

  // Een render vanuit de poll: alleen als er iets veranderde (seq, verbinding, status), en nooit
  // terwijl de score-invoer gewapend is of net een cijfer kreeg; dan wacht hij tot de invoer stil is.
  var lastPollSig = '';
  var renderQueued = false;
  var quietTimer = null;
  function pollSig() {
    var st = store.state;
    return [store.lastSeq, store.conn, store.unknown ? 1 : 0, st ? st.status : '-', st ? st.round : 0, ui.pending ? ui.pending.seq : 0, ui.msg].join('|');
  }
  function editorBusy() {
    return ui.armed || (ui.corr && ui.corr.armed) || Date.now() < ui.quietUntil;
  }
  function renderPoll() {
    var sig = pollSig();
    if (sig === lastPollSig && !renderQueued) return;
    lastPollSig = sig;
    // De ronde sloot of het eigen veld kreeg een score onder een gewapende editor: niet wachten, meteen tonen
    // (ontwapend, met de eerlijke regel). Anders wacht de render tot de invoer stil is.
    if (staleEditors()) { render(); return; }
    // Gewapend: geen timer-lus, disarm() haalt de wachtende render op. Stil na een cijfer: een timer tot het stil is.
    if (editorBusy()) { renderQueued = true; if (Date.now() < ui.quietUntil) scheduleQuiet(); return; }
    render();
  }

  // De score-editor van de speler: nog geldig voor deze toestand? Zo niet: ontwapenen en de eerlijke regel klaarzetten.
  function playerStale() {
    var st = store.state;
    if (VIEW !== 'speler' || !st || ui.sending || ui.editorRound === null || (!ui.armed && ui.sa === null)) return false;
    var moved = st.status !== 'live' || !st.current || st.round !== ui.editorRound ||
      (ui.editorCourt !== null && !!st.current.scores[ui.editorCourt]);
    if (!moved) return false;
    ui.sendMsg = staleLine(st, ui.editorRound, ui.editorCourt);
    ui.sa = null;
    disarm(ui);
    return true;
  }
  // "Veld 4 is intussen ingegeven door Bram: 9 tegen 12. Jouw score is niet verstuurd."
  function staleLine(st, round, court) {
    if (st.status !== 'live') return 'Het toernooi is intussen afgesloten. Jouw score is niet verstuurd.';
    var m = null;
    if (round < st.round) { var rd = st.rounds[round - 1]; m = rd && court !== null ? rd.matches[court] : null; }
    else if (st.current && court !== null) m = st.current.scores[court] || null;
    if (!m) return 'Ronde ' + round + ' is intussen gesloten. Jouw score is niet verstuurd.';
    return 'Veld ' + (court + 1) + ' is intussen ingegeven' + (m.by ? ' door ' + byLabel(m.by) : '') + ': ' + m.sa + ' tegen ' + m.sb + '. Jouw score is niet verstuurd.';
  }
  // De correctie-editor van de organisator: leeg als hij nog klopt, anders de eerlijke regel (SPEC 9.4).
  function corrStale(st) {
    var c = ui.corr;
    if (!c || !st || c.ns !== 'corr') return '';
    if (st.status !== 'live' || !st.current) return 'Het toernooi loopt niet meer. Jouw invoer is niet verstuurd.';
    var hasScores = Object.keys(st.current.scores).length > 0;
    var via = hasScores ? ' Toch aanpassen? Dat kan via Punten aanpassen.' : ' Toch aanpassen? Dat kan via Vorige ronde corrigeren.';
    if (st.round !== c.openRound) {
      if (c.prev) return 'Ronde ' + c.openRound + ' is intussen gesloten: ronde ' + c.round + ' ligt vast voor de indeling. Jouw invoer is niet verstuurd. Punten kan je nog aanpassen.';
      var rd = st.rounds[c.round - 1], m = rd ? rd.matches[c.court] : null;
      if (!m) return 'Ronde ' + c.round + ' is intussen gesloten. Jouw invoer is niet verstuurd.';
      return 'Veld ' + (c.court + 1) + ' van ronde ' + c.round + ' is intussen ingegeven' + (m.by ? ' door ' + byLabel(m.by) : '') + ': ' + m.sa + ' tegen ' + m.sb + '. Jouw invoer is niet verstuurd.' + via;
    }
    if (c.prev) {
      return hasScores ? 'Ronde ' + st.round + ' heeft intussen een score: ronde ' + c.round + ' ligt vast voor de indeling. Jouw invoer is niet verstuurd. Punten kan je nog aanpassen.' : '';
    }
    var s = st.current.scores[c.court];
    if (!s || (s.sa === c.openSa && s.sb === c.openSb)) return '';
    return 'Veld ' + (c.court + 1) + ' van ronde ' + c.round + ' is intussen ingegeven' + (s.by ? ' door ' + byLabel(s.by) : '') + ': ' + s.sa + ' tegen ' + s.sb + '. Jouw invoer is niet verstuurd. Toch aanpassen? Dat kan via Corrigeer.';
  }
  function dropStaleCorr() {
    var msg = corrStale(store.state);
    if (!msg) return false;
    disarm(ui.corr);
    ui.corr = null;
    setMsg(msg);
    return true;
  }
  function staleEditors() {
    if (VIEW === 'speler') return playerStale();
    if (VIEW === 'beheer' && ui.corr) return dropStaleCorr();
    return false;
  }
  function scheduleQuiet() {
    clearTimeout(quietTimer);
    var wait = Math.max(50, ui.quietUntil - Date.now() + 50);
    quietTimer = setTimeout(flushQueued, wait);
  }
  function flushQueued() {
    if (!renderQueued) return;
    if (editorBusy()) { if (Date.now() < ui.quietUntil) scheduleQuiet(); return; }
    render();
  }
  // Net een cijfer of tegel gekozen: het scherm blijft even stil voor de poll.
  function holdQuiet() {
    ui.quietUntil = Date.now() + QUIET_MS;
    if (renderQueued) scheduleQuiet();
  }

  // Geeft true als de hele log opnieuw opgehaald moet worden (de server begon opnieuw).
  function merge(res) {
    store.event = res.event;
    var serverSeq = toInt(res.seq) || 0;
    if (serverSeq < store.lastSeq) {
      // De server is opnieuw begonnen: dit antwoord niet toepassen, vanaf 0 opnieuw ophalen.
      // Het oude bord blijft staan tot de volledige log terug is.
      store.log = [];
      store.seen = {};
      store.lastSeq = 0;
      return true;
    }
    var fresh = 0;
    (res.log || []).forEach(function (e) {
      var s = toInt(e && e.seq);
      if (s === null || store.seen[s]) return;
      store.seen[s] = true;
      store.log.push(e);
      fresh += 1;
    });
    store.lastSeq = Math.max(store.lastSeq, serverSeq);
    // Niets nieuws: niet opnieuw afleiden, en prevState blijft de toestand van voor de laatste echte wijziging.
    if (!fresh && store.state) return false;
    store.prevState = store.state;
    store.state = ENGINE.derive(store.event, store.log);
    if (ui.roundAtLoad === null && store.state.status !== 'setup') ui.roundAtLoad = store.state.round;
    if (ui.showLinks === null) ui.showLinks = store.state.status === 'setup';
    // Van setup naar live: het links-blok klapt een keer dicht, zodat de open velden bovenaan staan.
    if (store.prevState && store.prevState.status === 'setup' && store.state.status === 'live') ui.showLinks = false;
    // De verstuurde score staat in het bord: het "Versturen" mag weg (de kaart toont nu Ingegeven, vers vanaf nu).
    if (ui.sending && ui.sent && store.seen[ui.sent.seq]) { ui.sending = null; ui.sent.at = Date.now(); }
    rememberLast();
    return false;
  }

  // Een organisator-bericht wordt pas bevestigd door de poll die de nieuwe seq bevat,
  // nooit door de ok van de server alleen: de server kent de spelregels niet, de engine wel.
  function resolvePending() {
    var p = ui.pending;
    if (!p || !store.state || !store.seen[p.seq]) return;
    ui.pending = null;
    var ign = null;
    store.state.ignored.forEach(function (x) { if (x.seq === p.seq) ign = x.reason; });
    setMsg(ign ? p.fail(ign) : p.ok);
    if (!ign && typeof p.then === 'function') p.then();
  }

  function setPending(seq, okMsg, failFn, thenFn) {
    if (seq === null) { setMsg(okMsg); return; }
    ui.pending = { seq: seq, ok: okMsg, fail: failFn, then: thenFn };
    ui.msg = 'Verstuurd, even wachten op het bord.';
    clearTimeout(ui.msgTimer);
    if (store.seen[seq]) resolvePending();   // de poll was sneller dan dit bericht
  }

  // ---------- scherm wakker houden, volledig scherm ----------

  var wakeLock = null;
  var awakeStatus = null;   // de status waarvoor de wake lock het laatst gevraagd is
  function keepAwake() {
    if (document.hidden) return;
    var want = VIEW === 'tv' || (VIEW === 'speler' && store.state && store.state.status === 'live');
    if (!want) return;
    var f = pf('keepAwake');
    if (f) { try { f(); } catch (e) { /* stil */ } return; }
    if (!navigator.wakeLock || wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* mag stil mislukken */ });
  }

  function toggleFullscreen() {
    var f = pf('fullscreen');
    if (f) { try { f(); } catch (e) { /* stil */ } return; }
    var d = document;
    if (d.fullscreenElement) {
      if (d.exitFullscreen) d.exitFullscreen().catch(function () {});
    } else if (d.documentElement.requestFullscreen) {
      d.documentElement.requestFullscreen().catch(function () {});
    }
  }

  // Eenmalig, buiten #app (een render wist het niet): "Druk op f voor volledig scherm", 4 s.
  function tvToast() {
    if (tvFx.toast || document.fullscreenElement) return;
    tvFx.toast = true;
    try {
      var el = document.createElement('div');
      el.className = 'tv-toast';
      el.setAttribute('role', 'status');
      el.textContent = 'Druk op f voor volledig scherm';
      document.body.appendChild(el);
      setTimeout(function () { el.classList.add('is-weg'); }, 4000);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4400);
    } catch (e) { /* stil */ }
  }

  // De tijd die zelf verder tikt zonder render: "bezig sinds 12 min" en de klok op de tv.
  function tickers() {
    var els = app.querySelectorAll('[data-tick]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i], kind = el.getAttribute('data-tick'), txt = '';
      if (kind === 'sinds') { var rel = relTime(el.getAttribute('data-ts')); txt = rel ? sindsTekst(rel) : ''; }
      else if (kind === 'klok') txt = clockText();
      if (txt && el.textContent !== txt) el.textContent = txt;
    }
  }
  setInterval(tickers, 10000);

  // ---------- gedeelde stukken ----------

  function kopHtml(st, label) {
    var txt = label !== undefined ? label : roundLabel(st);
    var stippen = label === undefined ? stippenHtml(st) : '';
    // In een toernooi linkt het woordmerk naar de eigen pagina, nooit naar de landing (de app heeft geen terugknop).
    var home = P.e ? link(VIEW === 'tv' ? 'tv' : VIEW === 'beheer' ? 'beheer' : '') : baseUrl();
    return '<header class="kop">' +
      '<a class="woordmerk" href="' + esc(home) + '" aria-label="ESCALANO">' +
      '<img src="' + BRAND + 'escalano-woordmerk.svg" alt="ESCALANO" width="1800" height="710"></a>' +
      (txt ? '<span class="pil-groep"><span class="pil' + (st && st.status === 'live' ? '' : ' pil--stil') + ' cijfers">' + esc(txt) + '</span>' + stippen + '</span>' : '') +
      '</header>';
  }

  // De verbinding als rustige regel: een stip, en bij verlies een zin die zegt wat er gebeurt.
  function verbindingHtml() {
    var cls = 'dot', txt = '';
    if (store.conn === 'lost') { cls += ' dot--kwijt'; txt = 'Even geen verbinding, we proberen opnieuw'; }
    else if (store.conn === 'onbekend') { cls += ' dot--kwijt'; txt = 'Server kent dit toernooi niet meer'; }
    else if (store.conn === 'local') { cls += ' dot--lokaal'; txt = 'Lokaal, zonder verbinding'; }
    else if (store.conn === 'ok') { cls += ' dot--ok'; txt = 'Live'; }
    else { txt = 'Verbinden'; }
    var h = '<p class="verbinding' + (store.conn === 'lost' || store.conn === 'onbekend' ? ' verbinding--kwijt' : '') + '" role="status"><span class="' + cls + '" aria-hidden="true"></span>' + esc(txt) + '</p>';
    // Lokale modus zonder opslag (privevenster, geblokkeerd): zeggen wat er na een herlaad gebeurt.
    if (store.conn === 'local' && typeof API.storageOk === 'function' && API.storageOk() === false) {
      h += '<p class="melding melding--fout">Opslag staat uit op dit toestel: na een herlaad is dit bord weg.</p>';
    }
    return h;
  }

  // Een uitklapblok met een plus-icoon (inline SVG, 1.75 px) dat bij openen een kruis wordt.
  function summaryHtml(labelHtml) {
    return '<summary><span class="label">' + labelHtml + '</span>' + icoon('plus', 'stand-icoon') + '</summary>';
  }
  // Open of dicht van een uitklapblok met sleutel key (onthouden in de toggle-listener), anders de standaard.
  function detailsOpen(key, standaard) {
    return Object.prototype.hasOwnProperty.call(ui.openDetails, key) ? !!ui.openDetails[key] : !!standaard;
  }
  function detailsHtml(key, labelHtml, inner, standaard) {
    return '<details class="stand" data-details="' + key + '"' + (detailsOpen(key, standaard) ? ' open' : '') + '>' + summaryHtml(labelHtml) + inner + '</details>';
  }

  function standTableHtml(st, meIndex) {
    if (!st || !st.standings.length) return '<p class="melding">Nog geen stand.</p>';
    var rows = st.standings.map(function (r, idx) {
      var cls = (r.i === meIndex ? ' is-ik' : '') + (idx === 0 ? ' is-eerste' : '');
      return '<tr class="' + cls.trim() + '"><td class="rang">' + (idx + 1) + '</td><td>' + esc(r.name) + '</td>' +
        '<td class="r">' + r.pt + '</td><td class="r klein">' + r.w + '</td></tr>';
    }).join('');
    return '<table class="standtabel"><thead><tr><th>#</th><th>Speler</th><th class="r">Punten</th><th class="r">Gewonnen</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // De stand: open of dicht zoals de gebruiker hem liet (ui.showStand), anders de standaard van de weergave.
  function standDetailsHtml(st, meIndex, standaard) {
    var open = ui.showStand === null ? !!standaard : ui.showStand;
    return '<details class="stand" data-details="stand"' + (open ? ' open' : '') + '>' + summaryHtml('Stand') +
      standTableHtml(st, meIndex) + '</details>';
  }

  function winnaarHtml(st) {
    var w = st.standings[0];
    if (!w) return '';
    return '<section class="winnaar verschijnt" aria-label="Winnaar">' +
      '<img src="' + BRAND + 'escalano-beeldmerk-creme.svg" alt="" width="400" height="400">' +
      '<p class="winnaar-titel">' + esc(winnerTitle(st, w)) + '</p>' +
      '<p class="winnaar-naam">' + esc(w.name) + '</p>' +
      '<p class="winnaar-punten cijfers">' + w.pt + ' punten</p></section>';
  }

  // Score-invoer: twee tegels, raster 0..21, bevestigen in twee stappen.
  // ed = {team, sa, armed}; ns = 'score' (speler) of 'corr' (beheer).
  // mine = 'a' | 'b' | null: de eigen ploeg van de speler (de knop spreekt dan vanuit zijn kant).
  function editorHtml(ns, ed, m, names, confirmLabel, mine) {
    var sa = ed.sa, sb = sa === null ? null : POINTS - sa;
    function tile(team, pair, val) {
      var active = ed.team === team;
      // Vanuit de speler: "Jullie" op de eigen tegel, "Zij" op de andere (13 px label); anoniem geen opschrift.
      var kop = mine ? (team === mine ? '<span class="label label--terra">Jullie</span>' : '<span class="label">Zij</span>') : '';
      return '<button type="button" class="tegel' + (active ? ' is-actief' : '') + '" data-act="tile" data-ns="' + ns + '" data-team="' + team + '" aria-pressed="' + active + '">' +
        kop + '<span class="tegel-namen"><span>' + esc(names[pair[0]]) + '</span><span>' + esc(names[pair[1]]) + '</span></span>' +
        '<span class="tegel-cijfer' + (val === null ? ' is-leeg' : '') + ' cijfers">' + (val === null ? '·' : val) + '</span></button>';
    }
    var activeVal = ed.team === 'a' ? sa : sb;
    var grid = '';
    for (var n = 0; n <= POINTS; n++) {
      grid += '<button type="button" class="knop' + (activeVal === n ? ' is-gekozen' : '') + '" data-act="num" data-ns="' + ns + '" data-n="' + n + '" aria-pressed="' + (activeVal === n) + '">' + n + '</button>';
    }
    // De score in woorden: vanuit de speler ("jullie 14, zij 7") of neutraal ("14 tegen 7" met de namen eronder).
    var mijn = mine === 'b' ? sb : sa, hun = mine === 'b' ? sa : sb;
    var scoreTxt = mine ? ': jullie ' + mijn + ', zij ' + hun : ' ' + sa + ' tegen ' + sb;
    var namenLijn = mine ? '' : '<p class="melding cijfers">' + esc(names[m.a[0]]) + ' en ' + esc(names[m.a[1]]) + ' ' + sa + ', ' + esc(names[m.b[0]]) + ' en ' + esc(names[m.b[1]]) + ' ' + sb + '</p>';
    var confirm;
    if (ed.sending) {
      // Een beheer-actie onderweg (Apps Script: 1 tot 3 s): de knop zegt het en is uit.
      confirm = '<button type="button" class="knop knop--primair" disabled>Versturen</button>' + namenLijn;
    } else if (sa === null) {
      confirm = '<button type="button" class="knop knop--primair" disabled>' + esc(confirmLabel) + '</button>' +
        '<p class="melding">' + (mine ? 'Tik jullie punten.' : 'Tik de punten van een ploeg.') + ' Samen altijd ' + POINTS + '.</p>';
    } else if (ed.armed) {
      // Kort en op een regel: "Nog eens: jullie 14, zij 7" of "Nog eens: 14 tegen 7".
      confirm = '<button type="button" class="knop knop--primair knop--gewapend" data-act="confirm" data-ns="' + ns + '">Nog eens' + (mine ? scoreTxt : ':' + scoreTxt) + '</button>' +
        namenLijn + '<button type="button" class="knop knop--stil" data-act="cancel" data-ns="' + ns + '">Toch niet</button>';
    } else {
      confirm = '<button type="button" class="knop knop--primair" data-act="confirm" data-ns="' + ns + '">' + esc(confirmLabel) + scoreTxt + '</button>' + namenLijn;
    }
    return '<div class="blok"><div class="tegels">' + tile('a', m.a, sa) + tile('b', m.b, sb) + '</div>' +
      '<div class="rooster" role="group" aria-label="Punten">' + grid + '</div>' +
      '<div class="bevestig">' + confirm + '</div></div>';
  }

  function scoredTilesHtml(m, s, names) {
    function tile(pair, val, wins) {
      return '<div class="tegel is-vast' + (wins ? ' wint' : '') + '">' +
        '<span class="tegel-namen"><span>' + esc(names[pair[0]]) + '</span><span>' + esc(names[pair[1]]) + '</span></span>' +
        '<span class="tegel-cijfer cijfers">' + val + '</span>' +
        (wins ? '<span class="label label--terra">Gewonnen</span>' : '') + '</div>';
    }
    return '<div class="tegels">' + tile(m.a, s.sa, s.sa > s.sb) + tile(m.b, s.sb, s.sb > s.sa) + '</div>';
  }

  // ---------- landing ----------

  function renderLanding() {
    var apiQs = P.api ? '&api=' + encodeURIComponent(P.api) : '';
    var last = lastEvent();
    // Met geheugen: eerst "Verder met ESCALANO #1" (of "Eindstand van ..."), dan de code, dan aanmaken stil.
    // Zonder: "Ik heb een code" is de hoofdknop (een organisator, veel spelers).
    var verder = last
      ? '<a class="knop knop--primair" href="?e=' + encodeURIComponent(last.code) + (last.view === 'tv' ? '&tv' : last.view === 'beheer' ? '&beheer' : '') + apiQs + '">' +
        (last.status === 'done' ? 'Eindstand van ' : 'Verder met ') + esc(last.name) + '</a>'
      : '';
    var code = ui.showCode
      ? '<form class="landing-code" data-form="code"><label class="visueel-verborgen" for="code">Code</label>' +
        '<input class="invoer invoer--code" id="code" name="code" maxlength="6" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text" autocapitalize="characters" placeholder="K7M3PQ" required autofocus>' +
        '<button type="submit" class="knop' + (last ? '' : ' knop--primair') + '">Naar het bord</button></form>'
      : '<button type="button" class="knop' + (last ? '' : ' knop--primair') + '" data-act="show-code">Ik heb een code</button>';
    var maak = '<a class="knop' + (last ? ' knop--stil' : '') + '" href="?beheer' + apiQs + '">Toernooi aanmaken</a>';
    return '<section class="landing"><div class="landing-inhoud">' +
      '<div class="landing-merk">' +
      '<img class="beeldmerk" src="' + BRAND + 'escalano-beeldmerk.svg" alt="" width="400" height="400">' +
      '<img class="woordmerk" src="' + BRAND + 'escalano-woordmerk.svg" alt="ESCALANO" width="1800" height="710">' +
      '<p class="landing-slogan">Play your way up.</p></div>' +
      '<p class="tagline">Good game. Good company.</p>' +
      '<div class="landing-acties">' + verder + code + maak + '</div></div><div class="strepen" aria-hidden="true"></div></section>';
  }

  // "Wie ben jij?" per veld (SPEC 6.2): de vier namen van veld 1, dan veld 2, ...; voor de start de opstelling van
  // ronde 1, na afloop alfabetisch. Met een veld-QR (v) eerst dat veld onder "Op veld 2 spelen", de rest ingeklapt.
  function wieBenJijHtml(st, names) {
    function knop(i) { return '<button type="button" class="knop" data-act="pick-me" data-i="' + i + '">' + esc(names[i]) + '</button>'; }
    function groep(label, idx) { return '<div class="groep">' + (label ? '<p class="label">' + esc(label) + '</p>' : '') + '<div class="namen">' + idx.map(knop).join('') + '</div></div>'; }
    var h = '';
    if (st.status === 'done') {
      var alles = names.map(function (n, i) { return i; }).sort(function (a, b) { return names[a].localeCompare(names[b]); });
      h = groep('', alles);
    } else {
      var matches = st.current ? st.current.matches : ENGINE.firstRound(names.length);
      var eigen = P.v !== null && P.v >= 1 && P.v <= matches.length ? P.v - 1 : null;
      var rest = matches.map(function (m, c) { return c === eigen ? '' : groep('Veld ' + (c + 1), m.a.concat(m.b)); }).join('');
      if (eigen !== null) {
        var m0 = matches[eigen];
        h = groep('Op veld ' + (eigen + 1) + ' spelen', m0.a.concat(m0.b)) +
          detailsHtml('anderen', 'Iemand anders', '<div class="blok">' + rest + '</div>', false);
      } else {
        h = rest;
      }
    }
    return '<section class="blok"><h1 class="label held-naam">' + esc(store.event.name) + '</h1><h2 class="zin">Wie ben jij?</h2>' +
      '<button type="button" class="knop knop--stil knop--link" data-act="pick-me" data-i="anon">Alleen een score ingeven</button>' +
      h + '</section>';
  }

  // Zodra het eigen veld binnen is wordt de held het wachten: "Veld 2 speelt nog", wie daar speelt, "bezig sinds 12 min".
  function waitHeroHtml(st) {
    var m = missingCourts(st);
    if (!m.length || !st.current) return '';
    var n = st.players;
    var zin = 'Veld ' + listNl(m.map(String)) + (m.length === 1 ? ' speelt' : ' spelen') + ' nog';
    var wie = m.map(function (c) {
      var mt = st.current.matches[c - 1];
      return (m.length > 1 ? 'Veld ' + c + ': ' : '') + esc(n[mt.a[0]]) + ' en ' + esc(n[mt.a[1]]) + ' tegen ' + esc(n[mt.b[0]]) + ' en ' + esc(n[mt.b[1]]);
    }).join('. ');
    var sinds = sindsHtml(st, 'sinds');
    return '<p class="zin" role="status">' + zin + '</p><p class="tekst">' + wie + (sinds ? ', ' + sinds : '') + '</p>';
  }

  // ---------- speler ----------

  function renderSpeler() {
    var st = store.state;
    var h = '<div class="pagina">';
    if (!st) {
      h += kopHtml(null) + '<h1 class="titel">' + (store.unknown ? 'Code ' + esc(P.e) + ' bestaat niet.' : 'Even geduld, het bord laadt.') + '</h1>';
      h += store.unknown ? '<p class="tekst">Kijk de code na op het veldbordje of vraag ze aan de organisator.</p><a class="knop knop--link" href="' + esc(baseUrl()) + '">Naar de startpagina</a>' : '';
      return h + verbindingHtml() + '</div>';
    }
    var names = st.players;
    var meIndex = typeof ui.me === 'number' && ui.me < names.length ? ui.me : null;
    var naam = '<h1 class="label held-naam">' + esc(store.event.name) + '</h1>';

    h += kopHtml(st);

    if (ui.me === null) {
      // Eerste bezoek: wie ben jij?
      h += wieBenJijHtml(st, names);
      if (st.status === 'done') h += winnaarHtml(st) + standDetailsHtml(st, null, true);
      return h + verbindingHtml() + '</div>';
    }

    if (st.status === 'setup') {
      h += '<section class="held">' + naam + '<p class="zin">Het toernooi is nog niet gestart.</p><p class="tekst">De organisator start zo. Deze pagina ververst vanzelf.</p></section>';
      h += meIndex !== null ? '<p class="melding">Jij bent ' + esc(names[meIndex]) + '. <button type="button" class="knop knop--stil" data-act="reset-me">Niet jij?</button></p>' : '';
      return h + verbindingHtml() + '</div>';
    }

    if (st.status === 'done') {
      h += naam + winnaarHtml(st);
      if (meIndex !== null) h += jijHtml(st, meIndex);
      h += standDetailsHtml(st, meIndex, true);
      return h + verbindingHtml() + '</div>';
    }

    // live
    var cur = st.current;
    var mm = meIndex !== null ? myMatch(st, meIndex) : null;
    var court = null;
    if (meIndex !== null) {
      court = mm ? mm.court : null;
    } else {
      if (ui.court === null && P.v !== null && P.v >= 1 && P.v <= st.courts) ui.court = P.v - 1;
      court = ui.court !== null && ui.court < st.courts ? ui.court : null;
    }
    if (ui.editorRound !== st.round) {
      // Nieuwe ronde: de eigen ploeg is standaard de actieve tegel.
      // Stond er een ingegeven-kaart, dan vervaagt die naar de nieuwe opstelling (render() maakt de overgang).
      // Stond er een getypte score die niet verstuurd was, dan blijft de eerlijke regel staan.
      var eerlijk = ui.sendMsg && /niet verstuurd/.test(ui.sendMsg) ? ui.sendMsg
        : (ui.editorRound !== null && ui.sa !== null ? staleLine(st, ui.editorRound, ui.editorCourt) : '');
      if (ui.editorRound !== null && ui.sent && ui.sent.round === ui.editorRound) ui.wisselFx = true;
      ui.editorRound = st.round; ui.sa = null; ui.team = mm ? mm.team : 'a'; disarm(ui); ui.sendMsg = eerlijk;
    }
    ui.editorCourt = court;
    var s = court !== null ? cur.scores[court] : null;
    if (meIndex !== null) {
      var mv = moveOf(st, meIndex);
      var heldZin = s ? waitHeroHtml(st) : '';
      h += '<section class="held' + (ui.wisselFx ? ' wissel' : ' verschijnt') + '">' + naam +
        (mv ? '<p class="beweging-zin">' + bewegingBadge(mv.dir) + '<span>' + esc(moveSentence(mv)) + '</span></p>' : '') +
        (heldZin || '<p class="zin">' + sentence(st, meIndex, ui.roundAtLoad !== null && st.round > ui.roundAtLoad) + '</p>') + '</section>';
    } else {
      var vast = P.v !== null && court === P.v - 1 && !ui.pickerOpen;
      h += '<section class="blok">' + naam + (vast
        // Met een veld-QR: een regel ("Veld 2" en "Ander veld?"), de volledige keuze alleen op vraag.
        ? '<div class="rij"><span class="pil pil--stil">Veld ' + (court + 1) + '</span><button type="button" class="knop knop--stil" data-act="other-court">Ander veld?</button></div>'
        : '<p class="label">Welk veld?</p><div class="velden">' +
          cur.matches.map(function (m, c) {
            return '<button type="button" class="knop' + (court === c ? ' is-gekozen' : '') + '" data-act="pick-court" data-c="' + c + '" aria-pressed="' + (court === c) + '">Veld ' + (c + 1) + '</button>';
          }).join('') + '</div>') + '</section>';
    }
    if (isExtra(st)) h += '<p class="melding">De organisator beslist of deze ronde nog gespeeld wordt.</p>';

    // Een score van een vorige ronde die niet telde (de ronde sloot terwijl je nog bevestigde): een keer zeggen.
    if (ui.sent && ui.sent.round < st.round && ui.sent.round === st.round - 1 && st.rounds[ui.sent.round - 1]) {
      var oud = st.rounds[ui.sent.round - 1].matches[ui.sent.court];
      var telde = oud && oud.sa === ui.sent.sa && oud.sb === ui.sent.sb && !st.ignored.some(function (x) { return x.seq === ui.sent.seq; });
      if (oud && !telde) {
        h += '<p class="tekst"><strong>Je score van ronde ' + ui.sent.round + ' telde niet: veld ' + (ui.sent.court + 1) + ' was al ingegeven' +
          (oud.by ? ' door ' + esc(byLabel(oud.by)) : '') + ', ' + oud.sa + ' tegen ' + oud.sb + '.</strong> Klopt dat niet? Zeg het aan de organisator.</p>';
      }
    }

    if (court !== null) {
      var m = cur.matches[court];
      h += '<section class="kaart' + (ui.wisselFx ? ' wissel' : '') + '" aria-label="Veld ' + (court + 1) + '"><div class="kaart-kop"><span class="label' + (court === 0 ? ' label--mosterd' : '') + '">Veld ' + (court + 1) + '</span><span class="label cijfers">' + esc(rondeTekst(st)) + '</span></div>';
      if (s) {
        var myBy = meIndex !== null ? names[meIndex] : '';
        var ignored = ui.sent && st.ignored.some(function (x) { return x.seq === ui.sent.seq; });
        var mine = (ui.sent && ui.sent.round === st.round && ui.sent.court === court && ui.sent.sa === s.sa && ui.sent.sb === s.sb &&
          (s.by || '') === myBy && !ignored) || (!!myBy && (s.by || '') === myBy);   // ook na een herlaad: eigen naam = eigen score
        h += scoredTilesHtml(m, s, names);
        if (mine) {
          // De bevestiging: het vinkje tekent zich in 300 ms, de score groot, "Ingegeven".
          var vers = ui.sent && ui.sent.round === st.round && ui.sent.court === court && Date.now() - (ui.sent.at || 0) < 2000;
          h += '<div class="ingegeven' + (vers ? ' is-vers' : '') + '" role="status"><span class="vink" aria-hidden="true">' + icoon('vink') + '</span>' +
            '<div><span class="label label--terra">Ingegeven</span><p class="groot cijfers">' + (mm ? 'Jullie ' + (mm.team === 'a' ? s.sa : s.sb) + ', zij ' + (mm.team === 'a' ? s.sb : s.sa) : s.sa + ' tegen ' + s.sb) + '</p>' +
            '<p class="melding">Fout? Zeg het aan de organisator.</p></div></div>';
        } else {
          // Vanuit de speler ("jullie 13, zij 8") als zijn ploeg bekend is; anoniem neutraal.
          var al = mm ? 'jullie ' + (mm.team === 'a' ? s.sa : s.sb) + ', zij ' + (mm.team === 'a' ? s.sb : s.sa) : s.sa + ' tegen ' + s.sb;
          h += '<p class="tekst"><strong>Veld ' + (court + 1) + ' staat al ingegeven' + (s.by ? ' door ' + esc(byLabel(s.by)) : '') + ': ' + al + '.</strong> Klopt dat niet? Zeg het aan de organisator.</p>';
          if (ui.sendMsg) h += '<p class="melding melding--fout" role="status">' + esc(ui.sendMsg) + '</p>';
        }
      } else if (ui.sending) {
        // Tussen de tik en de bevestiging blijft de score staan: nooit een lege editor.
        h += scoredTilesHtml(m, { sa: ui.sending.sa, sb: ui.sending.sb }, names) + '<p class="melding" role="status">Versturen</p>';
      } else {
        h += editorHtml('score', ui, m, names, 'Bevestig', mm ? mm.team : null);
        if (ui.sendMsg) h += '<p class="melding melding--fout" role="status">' + esc(ui.sendMsg) + '</p>';
      }
      h += '</section>';
    }

    // De wachtlijn onder de kaart alleen zonder kaart, of anoniem als het gekozen veld binnen is; met een naam
    // staat het wachten in de held. Nooit "Wachten op alle velden" bij iemand die nog moet spelen.
    var wait = (court === null || (s && meIndex === null)) ? waitingText(st) : '';
    if (wait) h += '<p class="melding cijfers" role="status">' + esc(wait) + '</p>';

    // Jouw plaats, live: "Jij: 5e, 38 punten" (pas zodra er een ronde gesloten is).
    if (meIndex !== null) h += jijHtml(st, meIndex);

    // Wie je bent staat onder de kaart (boven de vouw telt elke pixel voor de score).
    if (meIndex !== null) {
      h += '<p class="melding">Jij bent ' + esc(names[meIndex]) + '. <button type="button" class="knop knop--stil" data-act="reset-me">Niet jij?</button></p>';
    } else {
      h += '<p class="melding"><button type="button" class="knop knop--stil" data-act="reset-me">Toch je naam kiezen</button></p>';
    }

    h += standDetailsHtml(st, meIndex, false);
    return h + verbindingHtml() + '</div>';
  }

  // "Jij: 5e, 38 punten", onder de kaart; leeg zolang er geen ronde gesloten is.
  function jijHtml(st, meIndex) {
    if (!st.rounds.length) return '';
    for (var idx = 0; idx < st.standings.length; idx++) {
      var r = st.standings[idx];
      if (r.i === meIndex) {
        return '<p class="jij cijfers">Jij: <strong class="jij-rang">' + rangTekst(idx) + '</strong>, <span class="jij-punten">' + r.pt + ' punten</span></p>';
      }
    }
    return '';
  }

  // ---------- tv ----------

  function renderTv() {
    var st = store.state, ev = store.event;
    var h = '<div class="tv">';
    if (!st) {
      h += '<header class="tv-kop"><div class="tv-merk"><img src="' + BRAND + 'escalano-woordmerk-creme.svg" alt="ESCALANO" width="1800" height="710"></div>' +
        '<h1 class="tv-titel">' + (store.unknown ? 'Code ' + esc(P.e) + ' bestaat niet.' : 'Even geduld, het bord laadt.') + '</h1><span></span></header>' +
        '<div></div><div class="tv-strepen" aria-hidden="true"></div></div>';
      return h;
    }
    var names = st.players;
    var n = st.standings.length;
    var cols = n >= 20 ? 2 : 1;
    var now = Date.now();
    tvEffects(st, now);
    var overlay = tvFx.overlay && now < tvFx.overlay.until ? tvFx.overlay : null;
    var origin = st.status === 'live' && now < tvFx.originUntil && st.rounds.length > 0;

    // Verbinding kwijt is ver-veld-nieuws: de pil wordt terracotta, het laatste bord blijft staan.
    var pil = store.conn === 'lost' ? '<span class="tv-pil tv-pil--kwijt">Verbinding kwijt</span>' :
      store.conn === 'onbekend' ? '<span class="tv-pil tv-pil--kwijt">Server kent dit toernooi niet meer</span>' :
      st.status === 'live' ? '<span class="tv-pil cijfers">' + esc(roundLabel(st)) + '</span>' :
      '<span class="tv-pil tv-pil--stil">' + esc(roundLabel(st)) + '</span>';
    var sinds = st.status === 'live' && store.conn !== 'lost' && store.conn !== 'onbekend' ? sindsHtml(st, 'tv-sinds') : '';
    // Een tijdblok onder de pil: de klok en de verstreken tijd, een maat (24 px), nooit twee hoeken.
    var tijd = '<div class="tv-tijd"><span class="tv-klok cijfers" data-tick="klok">' + esc(clockText()) + '</span>' + sinds + '</div>';
    h = '<div class="tv' + (st.status === 'done' ? ' tv--klaar' : '') + '">';
    h += '<header class="tv-kop"><div class="tv-merk"><img src="' + BRAND + 'escalano-woordmerk-creme.svg" alt="ESCALANO" width="1800" height="710"></div>' +
      '<h1 class="tv-titel">' + esc(ev.name) + '</h1><div class="tv-pil-groep">' + pil + tijd + '</div></header>';

    h += '<div class="tv-main" data-cols="' + cols + '"><div class="tv-links">';
    if (st.status === 'done') {
      var w = st.standings[0], p2 = st.standings[1], p3 = st.standings[2];
      // De kroning onthult zich in 1,2 s: de titel, dan de naam, dan het podium.
      h += '<section class="kroning" aria-label="Winnaar">' +
        '<img class="onthul" style="--d:0ms" src="' + BRAND + 'escalano-beeldmerk-creme.svg" alt="" width="400" height="400">' +
        '<p class="kroning-titel onthul" style="--d:0ms">' + esc(winnerTitle(st, w)) + '</p>' +
        '<p class="kroning-naam onthul" style="--d:400ms">' + esc(w ? w.name : '') + '</p>' +
        '<p class="kroning-punten cijfers onthul" style="--d:400ms">' + (w ? w.pt : 0) + ' punten</p>' +
        '<ol class="podium onthul" style="--d:800ms">' +
        (p2 ? '<li><span class="rang">2</span><span class="naam">' + esc(p2.name) + '</span><span class="punten cijfers">' + p2.pt + '</span></li>' : '') +
        (p3 ? '<li><span class="rang">3</span><span class="naam">' + esc(p3.name) + '</span><span class="punten cijfers">' + p3.pt + '</span></li>' : '') +
        '</ol></section>';
    } else {
      var matches = st.current ? st.current.matches : ENGINE.firstRound(names.length);
      var scores = st.current ? st.current.scores : {};
      var prevMatches = origin ? st.rounds[st.rounds.length - 1].matches : null;
      // De treden klimmen naar rechts zoals het beeldmerk (SPEC 6.3, v1.3): --n zet de schuinte, de CSS de rest.
      h += '<section class="trap' + (overlay ? ' is-nieuw' : '') + '" data-courts="' + matches.length + '" style="--n:' + matches.length + '" aria-label="Velden">' +
        matches.map(function (m, c) {
          var s = scores[c];
          var landed = s && tvFx.seen[st.round + ':' + c] && now - tvFx.seen[st.round + ':' + c] < PULSE_MS;
          function naam(i) {
            var from = prevMatches ? courtOf(prevMatches, i) : null;
            var pijl = from === null ? '' : bewegingBadge(from > c ? 1 : from < c ? -1 : 0);
            return '<span>' + pijl + esc(names[i]) + '</span>';
          }
          function team(pair, cls, side) {
            return '<div class="trede-team trede-team--' + side + (cls ? ' ' + cls : '') + '">' + naam(pair[0]) + naam(pair[1]) + '</div>';
          }
          var aCls = s ? (s.sa > s.sb ? 'wint' : 'verliest') : '';
          var bCls = s ? (s.sb > s.sa ? 'wint' : 'verliest') : '';
          var score;
          if (s) {
            score = '<div class="trede-score cijfers"><span>' + s.sa + '</span><i aria-hidden="true"></i><span>' + s.sb + '</span></div>';
          } else if (origin && prevMatches) {
            // Tien seconden na de wissel: klein en stil onder "Speelt" waar de spelers van deze trede vandaan komen
            // (de pijlen per naam dragen de beweging; de speelstatus blijft zichtbaar).
            var van = [];
            m.a.concat(m.b).forEach(function (i) { var f = courtOf(prevMatches, i); if (f !== null && van.indexOf(f + 1) < 0) van.push(f + 1); });
            van.sort(function (x, y) { return x - y; });
            score = '<div class="trede-score trede-score--stapel"><span class="trede-wacht">Speelt</span><span class="trede-van">van veld ' + esc(listNl(van.map(String))) + '</span></div>';
          } else {
            score = '<div class="trede-score"><span class="trede-wacht">' + (st.status === 'setup' ? 'Start' : 'Speelt') + '</span></div>';
          }
          return '<div class="trede' + (landed ? ' is-geland' : '') + '" data-c="' + c + '" style="--i:' + c + '"><div class="trede-veld">Veld ' + (c + 1) + '</div>' +
            team(m.a, aCls, 'a') + score + team(m.b, bCls, 'b') + '</div>';
        }).join('') + '</section>';
      if (overlay) h += tvOverlayHtml(st, overlay);
    }

    // qr-balk: de ronde staat al in de pil, hier alleen de wachtlijn (ver-veld-groot), de verbinding en de klok
    var local = store.conn === 'local' && !P.demo;
    var phone = link('');
    var wait = waitingText(st);
    var scanTxt = st.status === 'setup' ? 'Scan en zoek je naam' : st.status === 'done' ? 'Scan voor de eindstand' : 'Scan en geef je score in';
    h += '<footer class="tv-qr' + (st.status === 'setup' ? ' tv-qr--groot' : '') + '">';
    if (local) {
      h += '<span class="tv-lokaal"><span class="dot dot--lokaal" aria-hidden="true"></span>Lokaal, zonder verbinding</span><div></div>';
    } else {
      h += '<div class="tv-qr-code" role="img" aria-label="QR-code naar ' + esc(phone) + '">' + qrSvg(phone) + '</div>' +
        '<div class="tv-qr-tekst"><h3>' + scanTxt + '</h3><p class="url">' + esc(shortUrl(P.demo ? phone : baseUrl() + '?e=' + P.e)) + '</p></div>';
    }
    h += '<div class="tv-status">' + (wait ? '<p class="wacht cijfers">' + esc(wait.replace(/\.$/, '')) + '</p>' : '') +
      (local ? '' : '<div class="tv-status-rij">' + verbindingHtml() + '</div>') + '</div>';
    h += '</footer></div>';

    // stand: de leider pas in mosterd als er een ronde gesloten is; klein label alleen het veld ("V3");
    // de pijlkolom is er altijd (niets verschuift), tien seconden na een wissel staat er een rangpijl in.
    var pijlen = origin && tvFx.prevRanks;
    h += '<aside class="tv-stand" aria-label="Stand"><h2>Stand</h2><ol data-cols="' + cols + '"' + (cols === 2 ? ' style="grid-template-rows: repeat(' + Math.ceil(n / 2) + ', minmax(0, 1fr))"' : '') + '>' +
      st.standings.map(function (r, idx) {
        var klein = (r.court !== null && st.status === 'live') ? 'V' + (r.court + 1) : '';
        var pijl = '<span class="rang-pijl" aria-hidden="true"></span>';
        if (pijlen) {
          var was = tvFx.prevRanks[r.name];
          var d = typeof was === 'number' ? (was > idx ? 1 : was < idx ? -1 : 0) : 0;
          pijl = '<span class="rang-pijl' + (d > 0 ? ' is-op' : d < 0 ? ' is-af' : ' is-gelijk') + '" role="img" aria-label="' + (d > 0 ? 'gestegen' : d < 0 ? 'gezakt' : 'gelijk') + '">' + icoon(d > 0 ? 'omhoog' : d < 0 ? 'omlaag' : 'gelijk') + '</span>';
        }
        var puntenCls = 'punten cijfers' + (st.status === 'setup' ? ' punten--stil' : '');
        return '<li' + (idx === 0 && st.rounds.length ? ' class="is-leider"' : '') + '><span class="rang">' + (idx + 1) + '</span>' + pijl + '<span class="naam">' + esc(r.name) + '</span><span class="klein">' + esc(klein) + '</span><span class="' + puntenCls + '">' + r.pt + '</span></li>';
      }).join('') + '</ol></aside></div>';

    h += '<div class="tv-strepen" aria-hidden="true"></div></div>';
    return h;
  }

  // Wat er net gebeurde, afgeleid uit de vorige en de nieuwe toestand: een score die landt (puls),
  // een ronde die sluit (overgang + herkomst + rangpijlen). Zet alleen tijdstempels; de CSS doet de rest.
  function tvEffects(st, now) {
    var first = tvFx.round === null;
    if (st.current) {
      Object.keys(st.current.scores).forEach(function (c) {
        var key = st.round + ':' + c;
        if (!tvFx.seen[key]) tvFx.seen[key] = first ? 1 : now;   // 1 = al gezien bij het laden (nooit 0: dat is leeg)
      });
    }
    if (!first && st.status === 'live' && tvFx.round !== null && st.round > tvFx.round && st.rounds.length) {
      var prev = store.prevState;
      tvFx.prevRanks = {};
      if (prev && prev.standings) prev.standings.forEach(function (r, idx) { tvFx.prevRanks[r.name] = idx; });
      var ms = overlayMs(st);
      tvFx.overlay = { round: st.round - 1, until: now + ms, ms: ms };
      tvFx.originUntil = now + ms + ORIGIN_MS;
      clearTimeout(tvFx.timer);
      tvFx.timer = setTimeout(function () {
        render();
        tvFx.timer = setTimeout(render, ORIGIN_MS + 50);
      }, ms + 50);
    }
    if (st.status === 'live' || first) tvFx.round = st.round;
    if (st.status !== 'live') { tvFx.overlay = null; }
  }

  // "Ronde 4 gespeeld" met alleen de klimmers (naam, pijl, nieuw veld) in twee kolommen, 3 s (4 s bij 20 of 24
  // spelers), dekkend over de treden. Wie zakt of blijft leest het daarna op zijn trede.
  function tvOverlayHtml(st, overlay) {
    var names = st.players;
    var prev = st.rounds[overlay.round - 1];
    if (!prev || !st.current) return '';
    var klimmers = [];
    prev.matches.forEach(function (m, c) {
      m.a.concat(m.b).forEach(function (i) {
        var to = courtOf(st.current.matches, i);
        if (to !== null && to < c) klimmers.push({ i: i, to: to });
      });
    });
    klimmers.sort(function (x, y) { return x.to - y.to || names[x.i].localeCompare(names[y.i]); });
    var h = '<div class="tv-overlay" role="status" style="--ovl:' + (overlay.ms || OVERLAY_MS) + 'ms"><p class="tv-overlay-titel">' + esc(rondeTekst(st, overlay.round)) + ' gespeeld</p>';
    if (klimmers.length) {
      h += '<p class="tv-overlay-kop">Wie klimt</p><div class="tv-bewegingen">' + klimmers.map(function (p) {
        return '<div class="tv-beweging"><span class="naam">' + esc(names[p.i]) + '</span>' + bewegingBadge(1) +
          '<span class="naar cijfers">veld ' + (p.to + 1) + '</span></div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }

  // ---------- beheer ----------

  // Per startveld vier naamvelden, elk met zijn M/V-paar (standaard M).
  function startveldenHtml(n, names, genders) {
    var h = '';
    for (var c = 0; c < n / 4; c++) {
      h += '<fieldset class="startveld"><legend><span class="pil' + (c === 0 ? '' : ' pil--roze') + '">Veld ' + (c + 1) + '</span>' +
        (c === 0 ? '<span class="melding">Sterkste spelers</span>' : '') + '</legend><div class="startveld-rij startveld-rij--namen">';
      var fout = '';
      for (var k = 0; k < 4; k++) {
        var i = 4 * c + k;
        h += '<div class="naam-veld"><input class="invoer" name="p' + i + '" maxlength="24" autocomplete="off" enterkeyhint="next" data-next="1" placeholder="Speler ' + (i + 1) + '" value="' + esc(names[i] || '') + '" aria-label="Speler ' + (i + 1) + ', veld ' + (c + 1) + '"' + invalidAttr('p' + i) + ' required>' +
          mvPaarHtml('mv-create', i, genders[i] === 'v' ? 'v' : 'm', names[i]) + '</div>';
        fout = fout || foutHtml('p' + i);
      }
      h += '</div>' + fout + '</fieldset>';
    }
    return h;
  }

  // "12 van 16 namen": de regels in de plak-textarea (een markering telt niet mee), of (zonder plak) de ingevulde velden.
  function namenTeller(paste, names, n) {
    var lines = parseLines(paste).length;
    var filled = 0;
    for (var i = 0; i < n; i++) if (names[i] && String(names[i]).trim()) filled += 1;
    return Math.max(lines, filled) + ' van ' + n + ' namen';
  }

  // De fouttekst staat onder het foute veld (aria-invalid gestyled); alleen een fout zonder veld staat onderaan.
  function foutHtml(field) {
    var c = ui.create;
    return c.err && c.errField === field ? '<p class="fout" role="alert" data-fout-tekst="1">' + esc(c.err) + '</p>' : '';
  }
  function invalidAttr(field) {
    return ui.create.errField === field ? ' aria-invalid="true" data-fout="1"' : '';
  }

  function renderCreate() {
    var c = ui.create;
    var opts = [8, 12, 16, 20, 24].map(function (n) {
      return '<option value="' + n + '"' + (c.n === n ? ' selected' : '') + '>' + n + ' spelers, ' + (n / 4) + ' velden</option>';
    }).join('');
    return '<div class="pagina pagina--breed">' + kopHtml(null, 'Nieuw') +
      '<h1 class="titel">Nieuw toernooi</h1>' +
      '<form class="blok" data-form="create" novalidate>' +
      '<div class="veld"><label for="naam">Naam van de avond</label><input class="invoer" id="naam" name="name" maxlength="60" value="' + esc(c.name) + '" placeholder="ESCALANO #1" enterkeyhint="next" data-next="1"' + invalidAttr('name') + ' required>' + foutHtml('name') + '</div>' +
      '<div class="veld"><label for="n">Aantal spelers</label><div class="select-wrap"><select class="invoer" id="n" name="n" data-change="n">' + opts + '</select></div></div>' +
      '<div class="veld"><label for="paste">Plak de namen, een per regel, sterkste eerst</label>' +
      '<textarea class="invoer" id="paste" name="paste" rows="8" data-paste="1" placeholder="Noor&#10;Bram&#10;Mila (v)&#10;Daan"' + invalidAttr('paste') + '>' + esc(c.paste) + '</textarea>' + foutHtml('paste') +
      '<div class="rij rij--tussen"><span class="teller cijfers" data-teller="1" aria-live="polite">' + esc(namenTeller(c.paste, c.names, c.n)) + '</span>' +
      '<button type="button" class="knop knop--klein" data-act="paste-fill">Zet de namen in de velden</button></div></div>' +
      '<div class="veld"><span class="label">Startopstelling</span><p class="melding">Per startveld vier namen. Veld 1 zijn de sterkste spelers; speler 1 speelt met speler 4, speler 2 met 3. Je kan de velden ook zelf aanpassen.</p>' +
      '<p class="melding">' + esc(MV_ZIN) + '</p></div>' +
      startveldenHtml(c.n, c.names, c.genders) +
      '<div class="startveld-rij">' +
      '<div class="veld"><label for="planned">Geplande rondes</label><input class="invoer" id="planned" name="plannedRounds" type="number" inputmode="numeric" min="1" max="99" value="' + esc(c.planned) + '" enterkeyhint="next" data-next="1"' + invalidAttr('plannedRounds') + ' required>' + foutHtml('plannedRounds') + '</div>' +
      '<div class="veld"><label for="pin">Pincode (4 tot 8 cijfers)</label><input class="invoer" id="pin" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="off" value="' + esc(c.pin) + '" enterkeyhint="done"' + invalidAttr('pin') + ' required>' + foutHtml('pin') +
      '<p class="melding">Kies liefst 6 tot 8 cijfers.</p></div>' +
      '</div>' +
      foutHtml('') +
      '<button type="submit" class="knop knop--primair"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Even geduld' : 'Maak het toernooi aan') + '</button>' +
      '</form>' + verbindingHtml() + '</div>';
  }

  // Een link met "Kopieer" (2 s "Gekopieerd") en, voor de gsm-link, "Deel" (klaar voor de WhatsApp-groep).
  function linkRijHtml(key, label, url, deel) {
    var cp = ui.copied && ui.copied.key === key ? ui.copied : null;
    var kop = '<button type="button" class="knop knop--klein knop--icoon' + (cp && cp.act === 'copy' ? ' is-klaar' : '') + '" data-act="copy" data-key="' + key + '" data-text="' + esc(url) + '" aria-label="Kopieer de link ' + esc(label) + '">' +
      icoon(cp && cp.act === 'copy' ? 'vink' : 'kopieer') + '<span>' + (cp && cp.act === 'copy' ? esc(cp.txt) : 'Kopieer') + '</span></button>';
    var share = deel ? '<button type="button" class="knop knop--klein knop--icoon' + (cp && cp.act === 'share' ? ' is-klaar' : '') + '" data-act="share" data-key="' + key + '" data-url="' + esc(url) + '" data-text="' + esc(deel) + '" aria-label="Deel de link ' + esc(label) + '">' +
      icoon(cp && cp.act === 'share' ? 'vink' : 'deel') + '<span>' + (cp && cp.act === 'share' ? esc(cp.txt) : 'Deel') + '</span></button>' : '';
    return '<div class="link-rij"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + '<span>' + esc(shortUrl(url)) + '</span></a><div class="link-acties">' + kop + share + '</div></div>';
  }

  function linksHtml(st) {
    var phone = link('');
    var h = '<div class="links">' +
      linkRijHtml('gsm', 'Spelers (gsm)', phone, 'ESCALANO vanavond: geef je score in via ' + phone) +
      linkRijHtml('tv', 'Tv', link('tv')) +
      linkRijHtml('beheer', 'Beheer', link('beheer'));
    for (var c = 0; c < st.courts; c++) h += linkRijHtml('v' + (c + 1), 'Veld ' + (c + 1) + ' (veldbordje)', link('v=' + (c + 1)));
    return h + '</div><button type="button" class="knop" data-act="print">Print de QR-codes</button>';
  }

  function printHtml(st) {
    var cards = [['Alle velden', link(''), 'Scan en geef je score in']];
    for (var c = 0; c < st.courts; c++) cards.push(['Veld ' + (c + 1), link('v=' + (c + 1)), 'Scan en geef je score in']);
    return '<section class="print-qr" aria-hidden="true">' + cards.map(function (k) {
      return '<div class="print-kaart"><img src="' + BRAND + 'escalano-logo.svg" alt=""><p class="veldnaam">' + esc(k[0]) + '</p>' + qrSvg(k[1]) + '<p class="scan">' + esc(k[2]) + '</p><p class="url">' + esc(shortUrl(k[1])) + '</p></div>';
    }).join('') + '</section>';
  }

  // Een veld in beheer: de ploegen, de score, en "Corrigeer" (editor vooraf ingevuld) of "Score ingeven" (nog geen score).
  function beheerVeldHtml(m, s, names, c, round, ns) {
    var editing = ui.corr && ui.corr.round === round && ui.corr.court === c && ui.corr.ns === ns;
    // Een veld zonder score is het luidste element (terracotta rand), een veld met score is stil.
    var score = s ? '<span class="beheer-score cijfers">' + s.sa + ' : ' + s.sb + '</span>' : '<span class="beheer-score is-leeg">Nog geen score</span>';
    var h = '<section class="kaart' + (s ? ' kaart--stil' : ' kaart--open') + '"><div class="beheer-veld"><span class="pil' + (c === 0 ? '' : ' pil--roze') + '">Veld ' + (c + 1) + '</span>' +
      '<div class="beheer-teams"><span' + (s && s.sa > s.sb ? ' class="wint"' : '') + '>' + esc(names[m.a[0]]) + ' + ' + esc(names[m.a[1]]) + '</span>' +
      '<span' + (s && s.sb > s.sa ? ' class="wint"' : '') + '>' + esc(names[m.b[0]]) + ' + ' + esc(names[m.b[1]]) + '</span></div>' + score + '</div>';
    if (s && s.by) h += '<p class="melding">Ingegeven door ' + esc(byLabel(s.by)) + '.</p>';
    if (editing) {
      // De kaart zegt al Corrigeer: de knop zegt "Bevestig 13 tegen 8", kort en op een regel.
      h += editorHtml(ns, ui.corr, m, names, 'Bevestig', null) +
        '<button type="button" class="knop knop--stil" data-act="corr-close">Toch niet</button>';
    } else {
      h += '<button type="button" class="knop knop--klein" data-act="corr-open" data-ns="' + ns + '" data-round="' + round + '" data-c="' + c + '"' + (s ? ' data-sa="' + s.sa + '"' : '') + '>' + (s ? 'Corrigeer' : 'Score ingeven') + '</button>';
    }
    return h + '</section>';
  }

  function renderBeheer() {
    if (!P.e) return renderCreate();
    var st = store.state;
    var h = '<div class="pagina pagina--breed">';
    if (!st) {
      h += kopHtml(null) + '<h1 class="titel">' + (store.unknown ? 'Code ' + esc(P.e) + ' bestaat niet.' : 'Even geduld, het bord laadt.') + '</h1>';
      return h + verbindingHtml() + '</div>';
    }
    var names = st.players;
    h += kopHtml(st) + '<h1 class="titel">' + esc(store.event.name) + '</h1>';

    if (!ui.pin) {
      h += '<form class="kaart" data-form="pin" novalidate><div class="veld"><label for="pin">Pincode van de organisator</label>' +
        '<input class="invoer invoer--code" id="pin" name="pin" inputmode="numeric" pattern="[0-9]{4,8}" maxlength="8" autocomplete="off" value="' + esc(ui.pinDraft) + '" required autofocus></div>' +
        (ui.pinErr ? '<p class="fout" role="alert">' + esc(ui.pinErr) + '</p>' : '') +
        '<p class="melding">Je pincode wordt gecontroleerd bij je eerste actie.</p>' +
        '<button type="submit" class="knop knop--primair">Ga verder</button></form>';
      return h + verbindingHtml() + '</div>';
    }

    // Het grote codeblok alleen in setup; vanaf live leeft de code in de samenvatting van de links.
    var linksKop = st.status === 'setup' ? 'Links en QR-codes' : 'Code <span class="cijfers">' + esc(P.e) + '</span>, links en QR-codes';
    var links = '<details class="stand"' + (ui.showLinks ? ' open' : '') + ' data-details="links">' + summaryHtml(linksKop) + linksHtml(st) + '</details>';
    if (st.status === 'setup') h += '<section class="blok"><p class="label">Code</p><p class="code-groot">' + esc(P.e) + '</p>' + links + '</section>';
    else if (st.status === 'live') h += links;
    // De bevestiging van een actie: een regel die na 4 s verdwijnt (setMsg); fouten blijven 8 s; de laatste 300 ms vervaagt hij.
    if (ui.msg) h += '<p class="melding melding--toast' + (isFoutMsg(ui.msg) ? ' melding--fout' : '') + (ui.msgWeg ? ' is-weg' : '') + '" role="status">' + esc(ui.msg) + '</p>';

    if (st.status === 'setup') {
      var first = ENGINE.firstRound(names.length);
      h += '<section class="blok"><h2 class="zin">Startopstelling</h2>' +
        first.map(function (m, c) {
          return '<div class="kaart"><div class="beheer-veld"><span class="pil' + (c === 0 ? '' : ' pil--roze') + '">Veld ' + (c + 1) + '</span>' +
            '<div class="beheer-teams"><span>' + esc(names[m.a[0]]) + ' + ' + esc(names[m.a[1]]) + '</span><span>' + esc(names[m.b[0]]) + ' + ' + esc(names[m.b[1]]) + '</span></div><span></span></div></div>';
        }).join('') + '</section>';
      h += '<details class="stand"' + (ui.showPlayers ? ' open' : '') + ' data-details="spelers">' + summaryHtml('Spelers aanpassen') +
        '<form class="blok" data-form="players"><p class="melding">Een naam per regel, in startvolgorde. 8, 12, 16, 20 of 24 namen.</p>' +
        '<textarea class="invoer" name="players" rows="10" aria-label="Spelers">' + esc(ui.playersDraft !== null ? ui.playersDraft : names.join('\n')) + '</textarea>' +
        '<button type="submit" class="knop"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Versturen' : 'Bewaar spelers') + '</button></form></details>';
      // De laatste controle voor de start: elke speler met zijn M/V-paar (gaat mee met start).
      h += '<section class="blok mv-blok" aria-label="Spelers (M/V)"><p class="label">Spelers (M/V)</p><p class="melding">' + esc(MV_ZIN) + '</p>' + mvLijstHtml(st) + '</section>';
      h += '<div class="beheer-acties">' + (ui.startEd.armed
        ? '<button type="button" class="knop knop--primair knop--gewapend" data-act="start">Nog eens: starten</button><button type="button" class="knop knop--stil" data-act="start-cancel">Toch niet</button>'
        : '<button type="button" class="knop knop--primair" data-act="start-arm"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Versturen' : 'Start het toernooi') + '</button>') + '</div>';
      return h + verbindingHtml() + '</div>' + printHtml(st);
    }

    if (st.status === 'done') {
      // Eerst de winnaar en "Deel de eindstand", dan de stand, dan de links, dan "Toch verder spelen".
      var tvUrl = link('tv');
      var cpE = ui.copied && ui.copied.key === 'eind' ? ui.copied : null;
      h += winnaarHtml(st) +
        '<div class="beheer-acties">' +
        '<button type="button" class="knop knop--primair knop--icoon' + (cpE ? ' is-klaar' : '') + '" data-act="share" data-key="eind" data-url="' + esc(tvUrl) + '" data-text="' + esc('ESCALANO: de eindstand staat op ' + tvUrl) + '">' + icoon(cpE ? 'vink' : 'deel') + '<span>' + (cpE ? esc(cpE.txt) : 'Deel de eindstand') + '</span></button></div>' +
        standDetailsHtml(st, null, true) + links +
        '<div class="beheer-acties"><button type="button" class="knop" data-act="resume"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Versturen' : 'Toch verder spelen') + '</button></div>';
      return h + verbindingHtml() + '</div>' + printHtml(st);
    }

    // live
    var cur = st.current;
    var wait = waitingText(st);
    var hasScores = Object.keys(cur.scores).length > 0;
    h += '<section class="blok"><div class="ronde-kop"><h2 class="zin cijfers">' + esc(rondeTekst(st)) + (wait ? ': ' + wait.charAt(0).toLowerCase() + wait.slice(1) : '') + '</h2>' + sindsHtml(st, 'melding') + '</div>';
    if (isExtra(st)) h += '<p class="melding">Geplande rondes gespeeld: sluit af, of laat ronde ' + st.round + ' spelen.</p>';
    h += cur.matches.map(function (m, c) { return beheerVeldHtml(m, cur.scores[c], names, c, st.round, 'corr'); }).join('') + '</section>';

    if (st.rounds.length > 0) {
      var prev = st.rounds[st.rounds.length - 1];
      h += '<section class="blok"><p class="label">Vorige ronde</p>';
      if (hasScores) {
        h += '<p class="melding">Ronde ' + (st.round - 1) + ' ligt vast voor de indeling. Punten kan je nog aanpassen.</p>';
      } else if (ui.showPrev) {
        h += '<p class="melding">Pas je hier een score aan, dan verandert de indeling van ronde ' + st.round + '. Dit kan tot de eerste score van ronde ' + st.round + ' binnen is. Zeg het aan de spelers.</p>' +
          prev.matches.map(function (m, c) { return beheerVeldHtml(m, m, names, c, st.round - 1, 'corr'); }).join('') +
          '<button type="button" class="knop knop--stil" data-act="prev-close">Verberg ronde ' + (st.round - 1) + '</button>';
      } else {
        h += '<button type="button" class="knop" data-act="prev-open">Vorige ronde corrigeren</button>';
      }
      h += '</section>';

      // Punten aanpassen in elke gesloten ronde: alleen de punten (data.pointsOnly), de indeling blijft (regel 3.2 c).
      h += '<details class="stand"' + (ui.showPunten ? ' open' : '') + ' data-details="punten">' + summaryHtml('Punten aanpassen') +
        '<div class="blok"><p class="melding">Een score die verkeerd om stond, de hele avond fixbaar. Alleen de punten veranderen, de indeling van de rondes erna blijft zoals gespeeld.</p>' +
        st.rounds.map(function (rd, r) {
          var open = ui.puntenRound === r + 1;
          return '<details class="stand"' + (open ? ' open' : '') + ' data-details="ronde-' + (r + 1) + '">' + summaryHtml('<span class="cijfers">' + esc(rondeTekst(st, r + 1)) + '</span>') + '<div class="blok">' +
            rd.matches.map(function (m, c) { return beheerVeldHtml(m, m, names, c, r + 1, 'punten'); }).join('') + '</div></details>';
        }).join('') + '</div></details>';
    }

    h += standDetailsHtml(st, null, false);
    // Een vergissing in M/V herstellen tijdens de avond; de keuze gaat mee met "Toernooi afsluiten".
    h += detailsHtml('mv', 'Spelers (M/V)', '<div class="blok mv-blok"><p class="melding">' + esc(MV_ZIN) + ' Je keuze gaat mee als je afsluit.</p>' + mvLijstHtml(st) + '</div>', false);
    var endWarn = hasScores && missingCourts(st).length ? openVeldenZin(st) + ' Toch afsluiten?' : '';
    h += '<div class="beheer-acties">' + (ui.endEd.armed
      ? (endWarn ? '<p class="melding melding--fout" role="alert">' + esc(endWarn) + '</p>' : '') +
        '<button type="button" class="knop knop--primair knop--gewapend" data-act="end">Nog eens: afsluiten</button><button type="button" class="knop knop--stil" data-act="end-cancel">Toch niet</button>'
      : '<button type="button" class="knop" data-act="end-arm"' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? 'Versturen' : 'Toernooi afsluiten') + '</button>') + '</div>';
    h += verbindingHtml() + '</div>' + printHtml(st);
    return h;
  }

  // ---------- renderen ----------

  // Een render schrijft #app alleen als de html echt verschilt; focus, cursor en scrollpositie
  // overleven de schrijfbeurt. window.__escalano_renders telt de schrijfbeurten (zelftest).
  var lastHtml = '';
  window.__escalano_renders = 0;
  function render() {
    renderQueued = false;
    var h;
    if (VIEW === 'landing') h = renderLanding();
    else if (VIEW === 'tv') h = renderTv();
    else if (VIEW === 'beheer') h = renderBeheer();
    else h = renderSpeler();
    if (h === lastHtml) { ui.wisselFx = false; return; }
    lastHtml = h;

    // wat de focus had (id of naam) en waar de cursor stond
    var active = document.activeElement, key = null, sel = null;
    if (active && active !== document.body && app.contains(active)) {
      if (active.id) key = '#' + cssId(active.id);
      else if (active.name) key = '[name="' + active.name + '"]';
      else if (active.getAttribute && active.getAttribute('data-act')) {
        key = '[data-act="' + active.getAttribute('data-act') + '"]';
        ['data-n', 'data-i', 'data-g'].forEach(function (a) { var v = active.getAttribute(a); if (v) key += '[' + a + '="' + v + '"]'; });
      }
      try { if (typeof active.selectionStart === 'number') sel = [active.selectionStart, active.selectionEnd]; } catch (e) { sel = null; }
    }
    var y = window.scrollY || window.pageYOffset || 0;
    // De wissel naar de nieuwe opstelling is een reeks, geen dubbeldruk: de nieuwe kaart verschijnt (CSS .wissel),
    // er staat nooit een tweede kaart over de eerste.
    ui.wisselFx = false;

    app.innerHTML = h;
    window.__escalano_renders += 1;

    var terug = key ? app.querySelector(key) : null;
    if (terug) {
      try { terug.focus({ preventScroll: true }); } catch (e) { try { terug.focus(); } catch (e2) { /* niets */ } }
      if (sel && terug.setSelectionRange) { try { terug.setSelectionRange(sel[0], sel[1]); } catch (e) { /* niets */ } }
    } else {
      var auto = app.querySelector('[autofocus]');
      if (auto && VIEW !== 'tv') { try { auto.focus({ preventScroll: true }); } catch (e) { /* niets */ } }
    }
    var y2 = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(y2 - y) > 1) { try { window.scrollTo(0, y); } catch (e) { /* niets */ } }
    tickers();
  }

  function cssId(id) {
    try { return window.CSS && window.CSS.escape ? window.CSS.escape(id) : id.replace(/[^\w-]/g, '\\$&'); } catch (e) { return id; }
  }

  // ---------- acties ----------

  function editorFor(ns) {
    return ns === 'score' ? ui : ui.corr;
  }

  // Wapenen: de eerste tik wapent, de tweede verstuurt. Een tweede tik binnen 600 ms telt niet,
  // en na 8 s ontwapent de knop vanzelf. Geldt voor score, correctie, starten en afsluiten.
  function arm(ed) {
    ed.armed = true;
    ed.armedAt = Date.now();
    clearTimeout(ed.armTimer);
    ed.armTimer = setTimeout(function () { ed.armed = false; render(); }, ARM_MS);
  }

  function disarm(ed) {
    ed.armed = false;
    clearTimeout(ed.armTimer);
    // Een render die op de gewapende knop wachtte, komt nu (na de actie die hem ontwapende).
    if (renderQueued && !editorBusy()) setTimeout(flushQueued, 0);
  }

  // true als de tweede tik te snel na het wapenen komt (stuiterende duim): dan niets doen.
  function tooSoon(ed) {
    return ed.armed && Date.now() - (ed.armedAt || 0) < ARM_MIN_MS;
  }

  // Leesbare reden als de engine een organisator-actie negeerde.
  function ignoredMsg(type, reason, round) {
    var st = store.state;
    if (reason === 'already_scored') return 'Niet gelukt: ronde ' + (st ? st.round : '') + ' heeft intussen al een score.';
    if (reason === 'wrong_round') return 'Niet gelukt: ronde ' + round + ' is intussen niet meer te corrigeren.';
    if (reason === 'not_live') return type === 'end' ? 'Niet gelukt: het toernooi was al afgesloten.' : 'Niet gelukt: het toernooi loopt niet.';
    if (reason === 'not_setup') return 'Niet gelukt: het toernooi was al gestart.';
    if (reason === 'not_done') return 'Niet gelukt: het toernooi loopt nog.';
    if (reason === 'bad_players') return 'Niet gelukt: de spelerslijst klopt niet.';
    return 'Niet gelukt. Probeer opnieuw.';
  }

  function admin(type, data) {
    if (ui.busy) return Promise.resolve(null);
    ui.busy = true; setMsg(''); ui.pending = null; render();
    return API.admin({ e: P.e, pin: ui.pin, type: type, data: data || {} }).then(function (res) {
      ui.busy = false;
      if (res && res.ok) { poll(); return res; }
      var err = res && res.error;
      if (err === 'pin') { ui.pin = null; setPref('escalano-pin-' + P.e, null); ui.pinErr = 'Pincode klopt niet. Probeer opnieuw.'; }
      else if (err === 'setup') setMsg('Niet gelukt: het toernooi is al gestart.');
      else if (err === 'busy') setMsg('Niet gelukt: de server is even bezet. Probeer opnieuw.');
      else setMsg('Niet gelukt. Probeer opnieuw.');
      render();
      return res;
    }).catch(function () {
      ui.busy = false; setMsg('Geen verbinding. Probeer opnieuw.'); render();
      return null;
    });
  }

  // Kopieer of deel: de knop zegt 2 s "Gekopieerd" of "Gedeeld" en keert dan terug.
  function markCopied(key, act, txt) {
    ui.copied = { key: key, act: act, txt: txt };
    clearTimeout(ui.copiedTimer);
    ui.copiedTimer = setTimeout(function () { ui.copied = null; render(); }, COPIED_MS);
    render();
  }

  // Een organisator-actie met een bericht dat pas na de volgende poll bevestigd wordt.
  function adminConfirmed(type, data, okMsg, thenFn) {
    return admin(type, data).then(function (res) {
      if (res && res.ok) {
        setPending(toInt(res.seq), okMsg, function (reason) { return ignoredMsg(type, reason, data && data.round); }, thenFn);
        render();
      }
      return res;
    });
  }

  var actions = {
    'show-code': function () { ui.showCode = true; render(); },

    'pick-me': function (el) {
      var v = el.getAttribute('data-i');
      ui.me = v === 'anon' ? 'anon' : toInt(v);
      ui.editorRound = null;   // de editor begint opnieuw met de eigen ploeg actief
      setPref('escalano-me-' + P.e, String(ui.me));
      render();
    },
    'reset-me': function () { ui.me = null; ui.court = null; ui.editorRound = null; setPref('escalano-me-' + P.e, null); render(); },
    'pick-court': function (el) { ui.court = toInt(el.getAttribute('data-c')); ui.sa = null; ui.team = 'a'; disarm(ui); ui.sendMsg = ''; render(); },

    tile: function (el) {
      var ed = editorFor(el.getAttribute('data-ns'));
      if (!ed) return;
      tick();
      ed.team = el.getAttribute('data-team') === 'b' ? 'b' : 'a';
      disarm(ed);
      holdQuiet();
      render();
    },
    num: function (el) {
      var ed = editorFor(el.getAttribute('data-ns'));
      if (!ed) return;
      var n = toInt(el.getAttribute('data-n'));
      if (n === null) return;
      tick();
      ed.sa = ed.team === 'a' ? n : POINTS - n;
      disarm(ed);
      holdQuiet();
      render();
    },
    cancel: function (el) { var ed = editorFor(el.getAttribute('data-ns')); if (ed) { disarm(ed); render(); } },
    confirm: function (el) {
      var ns = el.getAttribute('data-ns');
      var ed = editorFor(ns);
      if (!ed || ed.sa === null || ed.sending) return;
      if (!ed.armed) { tick(); arm(ed); render(); return; }
      if (tooSoon(ed)) return;
      tick();
      disarm(ed);
      ui.quietUntil = 0;   // de stilte na een cijfertik geldt niet meer: de poll mag meteen tonen wat er landt
      if (ns === 'score') sendScore(); else sendCorrection();
    },

    copy: function (el) {
      var key = el.getAttribute('data-key'), text = el.getAttribute('data-text') || '';
      copyText(text).then(function (ok) {
        if (ok) { tick(); markCopied(key, 'copy', 'Gekopieerd'); }
        else markCopied(key, 'copy', 'Niet gelukt');
      });
    },
    share: function (el) {
      var key = el.getAttribute('data-key'), url = el.getAttribute('data-url') || '', text = el.getAttribute('data-text') || url;
      shareText({ title: 'ESCALANO', text: text, url: url }).then(function (r) {
        if (r === 'shared') markCopied(key, 'share', 'Gedeeld');
        else if (r === 'copied') markCopied(key, 'share', 'Gekopieerd');
        else markCopied(key, 'share', 'Niet gelukt');
      });
    },

    'corr-open': function (el) {
      // Vooraf ingevuld met de huidige score (een cijfer verschuiven volstaat); leeg als er nog geen is.
      // De editor onthoudt de open ronde en de score van dat moment: sluit de ronde of komt er intussen een
      // andere score, dan verstuurt hij nooit (corrStale). Een lopende wapentimer stopt eerst.
      if (ui.corr) disarm(ui.corr);
      var st = store.state;
      var ns = el.getAttribute('data-ns') || 'corr';
      var round = toInt(el.getAttribute('data-round')), court = toInt(el.getAttribute('data-c'));
      var open = st && st.current && st.status === 'live' && round === st.round && court !== null ? st.current.scores[court] : null;
      ui.corr = {
        ns: ns, round: round, court: court,
        team: 'a', sa: toInt(el.getAttribute('data-sa')), armed: false, armTimer: null, armedAt: 0, sending: false,
        openRound: st ? st.round : null,
        prev: ns === 'corr' && !!st && round === st.round - 1,
        openSa: open ? open.sa : null, openSb: open ? open.sb : null
      };
      render();
      // De editor in beeld: de beslissing (tegels, raster, bevestigen) nooit onder de vouw.
      var ed = app.querySelector('.kaart .tegels');
      if (ed) { try { ed.closest('.kaart').scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (e) { /* niets */ } }
    },
    'corr-close': function () { if (ui.corr) disarm(ui.corr); ui.corr = null; render(); },
    'prev-open': function () { if (ui.corr) disarm(ui.corr); ui.showPrev = true; ui.corr = null; render(); },
    'prev-close': function () { if (ui.corr) disarm(ui.corr); ui.showPrev = false; ui.corr = null; render(); },
    'start-arm': function () { arm(ui.startEd); render(); },
    'start-cancel': function () { disarm(ui.startEd); render(); },
    start: function () {
      if (tooSoon(ui.startEd)) return;
      disarm(ui.startEd);
      // M/V gaat mee met de start (SPEC 3.2, v1.3); dit toestel onthoudt de keuze ook zelf.
      var g = gendersFor(store.state);
      saveGenders(P.e, g);
      adminConfirmed('start', { genders: g }, 'Toernooi gestart.');
    },
    'end-arm': function () { arm(ui.endEd); render(); },
    'end-cancel': function () { disarm(ui.endEd); render(); },
    end: function () {
      if (tooSoon(ui.endEd)) return;
      disarm(ui.endEd);
      // Een verbetering van tijdens de avond gaat opnieuw mee.
      adminConfirmed('end', { genders: gendersFor(store.state) }, 'Toernooi afgesloten.');
    },
    // M/V in setup en live: lokaal per toernooi (escalano-g-CODE), verstuurd met start en end.
    mv: function (el) {
      var st = store.state, i = toInt(el.getAttribute('data-i')), x = el.getAttribute('data-g');
      if (!st || i === null || i < 0 || i >= st.players.length || !isG(x)) return;
      var g = gendersFor(st);
      if (g[i] === x) return;
      tick();
      g[i] = x;
      saveGenders(P.e, g);
      render();
    },
    // M/V in het aanmaakformulier: eerst de getypte velden bewaren, dan de keuze zetten.
    'mv-create': function (el) {
      var i = toInt(el.getAttribute('data-i')), x = el.getAttribute('data-g');
      if (i === null || i < 0 || i >= 24 || !isG(x)) return;
      var form = el.closest('form');
      if (form) readCreateForm(form);
      if ((ui.create.genders[i] || 'm') !== x) tick();
      ui.create.genders[i] = x;
      render();
    },
    resume: function () { adminConfirmed('resume', {}, 'Verder spelen.'); },
    'paste-fill': function (el) {
      var form = el.closest('form');
      if (form) { readCreateForm(form); fillFromPaste(form); }
    },
    print: function () { try { window.print(); } catch (e) { /* niets */ } }
  };

  // De namen uit een plakvak, zonder markering ("Eva (v)" wordt "Eva").
  function pasteLines(raw) {
    return parseLines(raw).map(function (x) { return x.name; });
  }
  function telwoord(n) {
    return n === 1 ? 'een' : n === 2 ? 'twee' : n === 3 ? 'drie' : String(n);
  }
  // "17 namen geplakt. Kies 16 of 20 spelers: haal er een weg of voeg er drie toe."
  function pasteFout(count) {
    var lager = null, hoger = null;
    SIZES.forEach(function (n) {
      if (n < count && (lager === null || n > lager)) lager = n;
      if (n > count && (hoger === null || n < hoger)) hoger = n;
    });
    var opties = [];
    if (lager !== null) opties.push('haal er ' + telwoord(count - lager) + ' weg');
    if (hoger !== null) opties.push('voeg er ' + telwoord(hoger - count) + ' toe');
    var kies = lager !== null && hoger !== null ? lager + ' of ' + hoger : String(lager !== null ? lager : hoger);
    return count + ' namen geplakt. Kies ' + kies + ' spelers: ' + opties.join(' of ') + '.';
  }

  // De plak-textarea vult de naamvelden in een keer en zet het aantal; een aantal dat geen 8, 12, 16, 20 of 24 is
  // wordt geweigerd met de fout onder de textarea (nooit stil afgekapt). "Eva (v)" zet V bij Eva; zonder
  // markering houdt een bekende naam zijn keuze, een nieuwe naam is M.
  function fillFromPaste(form) {
    var c = ui.create;
    var raw = String((form.elements.paste && form.elements.paste.value) || '');
    c.paste = raw;
    var parsed = parseLines(raw);
    if (!parsed.length) return;
    if (SIZES.indexOf(parsed.length) < 0) {
      c.err = pasteFout(parsed.length); c.errField = 'paste';
      render(); scrollToFout();
      return;
    }
    var list = parsed.map(function (x) { return x.name; });
    var g = realign(c.names.slice(0, 24), c.genders, list, parsed.map(function (x) { return x.g; }));
    c.n = list.length;
    for (var i = 0; i < 24; i++) { c.names[i] = list[i] || ''; c.genders[i] = g[i] || 'm'; }
    c.err = ''; c.errField = '';
    render();
  }

  // De teller "12 van 16 namen" tikt mee bij elke toets, ter plekke (geen render, de cursor blijft staan).
  function updateTeller(form) {
    var el = form.querySelector('[data-teller]');
    if (!el) return;
    var names = [];
    for (var i = 0; i < 24; i++) { var inp = form.elements['p' + i]; names[i] = inp ? inp.value : ''; }
    var n = toInt(form.elements.n && form.elements.n.value) || ui.create.n;
    var txt = namenTeller(form.elements.paste ? form.elements.paste.value : '', names, n);
    if (el.textContent !== txt) el.textContent = txt;
  }

  function sendScore() {
    var st = store.state;
    var meIndex = typeof ui.me === 'number' ? ui.me : null;
    var mm = meIndex !== null ? myMatch(st, meIndex) : null;
    var court = mm ? mm.court : ui.court;
    if (!st || st.status !== 'live' || !st.current || court === null || ui.sa === null || ui.sending) return;
    // De editor verstuurt alleen in zijn eigen ronde en op een veld zonder score. Sloot de ronde of kwam er
    // intussen een andere score (de render wachtte op de gewapende knop), dan de eerlijke regel, nooit een POST.
    var round = ui.editorRound !== null ? ui.editorRound : st.round;
    if (st.round !== round || st.current.scores[court]) {
      ui.sendMsg = staleLine(st, round, court);
      ui.sa = null; disarm(ui); render();
      return;
    }
    var sa = ui.sa, sb = POINTS - sa;
    // Tussen de tik en de bevestiging blijft de score staan ("Versturen"), tot de poll hem in het bord zet.
    ui.sending = { round: round, court: court, sa: sa, sb: sb }; ui.sendMsg = ''; render();
    API.score({ e: P.e, round: round, court: court, sa: sa, sb: sb, by: meIndex !== null ? st.players[meIndex] : '' }).then(function (res) {
      if (res && res.ok) {
        thud();
        ui.sent = { round: round, court: court, sa: sa, sb: sb, seq: toInt(res.seq), at: Date.now() };
        ui.sa = null;
        if (ui.sent.seq === null) ui.sending = null;   // zonder seq kan de poll hem niet herkennen
        poll();
      } else {
        ui.sending = null;
        ui.sendMsg = 'Niet gelukt. Probeer opnieuw.';
      }
      render();
    }).catch(function () {
      ui.sending = null;
      ui.sendMsg = 'Geen verbinding. De score is niet verstuurd. Probeer opnieuw.';
      render();
    });
  }

  function sendCorrection() {
    var c = ui.corr;
    if (!c || c.sa === null || c.sending) return;
    // Sloot de ronde of kreeg het veld intussen een andere score: de eerlijke regel, geen POST (SPEC 9.4).
    if (dropStaleCorr()) { render(); return; }
    var data = { round: c.round, court: c.court, sa: c.sa, sb: POINTS - c.sa };
    // "Punten aanpassen" raakt alleen de punten: de engine mag nooit een ronde herschikken waar de spelers al staan.
    if (c.ns === 'punten') data.pointsOnly = true;
    c.sending = true;
    // ui.corr blijft staan tot de server ja zegt: bij een foute pin komt de correctie meteen terug.
    adminConfirmed('correct', data, 'Gecorrigeerd: veld ' + (data.court + 1) + ' van ronde ' + data.round + ', ' + data.sa + ' tegen ' + data.sb + '.',
      function () { ui.showPrev = false; }).then(function (res) {
      c.sending = false;
      if (res && res.ok) { thud(); if (ui.corr === c) ui.corr = null; }
      render();
    });
  }

  var forms = {
    code: function (form) {
      var code = String(form.code.value || '').trim().toUpperCase();
      if (!code) return;
      window.location.search = '?e=' + encodeURIComponent(code) + (P.api ? '&api=' + encodeURIComponent(P.api) : '');
    },
    pin: function (form) {
      var pin = String(form.pin.value || '').trim();
      if (!API.validPin(pin)) { ui.pinErr = 'Een pincode heeft 4 tot 8 cijfers.'; ui.pinDraft = pin; render(); return; }
      ui.pin = pin; ui.pinErr = ''; ui.pinDraft = '';
      setPref('escalano-pin-' + P.e, pin);
      // Een correctie die op een foute pin strandde, staat er nog: meteen opnieuw aanbieden.
      if (ui.corr && ui.corr.sa !== null) setMsg('Nog eens bevestigen: veld ' + (ui.corr.court + 1) + ', ' + ui.corr.sa + ' tegen ' + (POINTS - ui.corr.sa) + '.');
      render();
    },
    players: function (form) {
      var raw = String(form.players.value || '');
      ui.playersDraft = raw;
      // Ook hier hoort "(v)" nooit bij de naam; M/V volgt de namen naar hun nieuwe plaats.
      var parsed = parseLines(raw);
      var list = parsed.map(function (x) { return x.name; });
      var fout = playersError(list);
      if (fout) { setMsg('Niet gelukt: ' + fout.msg); ui.showPlayers = true; render(); return; }
      ui.showPlayers = true;
      var st = store.state;
      var nieuweG = realign(st ? st.players : [], gendersFor(st), list, parsed.map(function (x) { return x.g; }));
      adminConfirmed('players', { players: list }, 'Spelers bewaard.', function () { ui.playersDraft = null; ui.showPlayers = false; saveGenders(P.e, nieuweG); });
    },
    create: function (form) {
      readCreateForm(form);
      var c = ui.create;
      var list = [];
      for (var i = 0; i < c.n; i++) list.push(c.names[i] || '');
      c.err = ''; c.errField = '';
      var fout = playersError(list);
      var geplakt = pasteLines(c.paste).length;
      if (!c.name.trim()) { c.err = 'Geef de avond een naam.'; c.errField = 'name'; }
      // Een geplakte lijst die niet overeenkomt met het gekozen aantal wordt nooit afgekapt verstuurd.
      else if (geplakt && geplakt !== c.n) { c.err = geplakt + ' namen geplakt, ' + c.n + ' spelers gekozen. Pas een van beide aan.'; c.errField = 'paste'; }
      else if (fout) { c.err = fout.msg; c.errField = fout.field; }
      else if (!API.validPin(c.pin)) { c.err = 'De pincode heeft 4 tot 8 cijfers.'; c.errField = 'pin'; }
      else if (toInt(c.planned) === null || toInt(c.planned) < 1 || toInt(c.planned) > 99) { c.err = 'Geplande rondes: 1 tot 99.'; c.errField = 'plannedRounds'; }
      if (c.err) { render(); scrollToFout(); return; }
      ui.busy = true; render();
      API.create({ name: c.name.trim(), players: list.map(function (s) { return s.trim(); }), plannedRounds: toInt(c.planned), pin: c.pin }).then(function (res) {
        ui.busy = false;
        if (res && res.ok && res.code) {
          setPref('escalano-pin-' + res.code, c.pin);
          // M/V vanaf het aanmaken bewaard per toernooi (escalano-g-CODE), in startvolgorde.
          var g = [];
          for (var j = 0; j < list.length; j++) g.push(c.genders[j] === 'v' ? 'v' : 'm');
          saveGenders(res.code, g);
          window.location.search = '?e=' + encodeURIComponent(res.code) + '&beheer' + (P.api ? '&api=' + encodeURIComponent(P.api) : '');
          return;
        }
        c.err = res && res.error === 'limit' ? 'Niet gelukt: vandaag zijn er al te veel toernooien aangemaakt. Probeer morgen opnieuw.' : 'Niet gelukt. Probeer opnieuw.';
        render();
      }).catch(function () {
        ui.busy = false; c.err = 'Geen verbinding. Probeer opnieuw.'; render();
      });
    }
  };

  // Benoemt de eerste fout in een spelerslijst: {msg, field} of null als alles klopt.
  function playersError(list) {
    if ([8, 12, 16, 20, 24].indexOf(list.length) < 0) return { msg: 'Dat klopt nog niet: 8, 12, 16, 20 of 24 namen, elke naam een keer, hoogstens 24 tekens.', field: '' };
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var name = String(list[i] || '').trim();
      if (!name) return { msg: 'Speler ' + (i + 1) + ' is leeg.', field: 'p' + i };
      if (name.length > 24) return { msg: 'Speler ' + (i + 1) + ': hoogstens 24 tekens.', field: 'p' + i };
      var key = name.toLowerCase();
      if (seen[key] !== undefined) return { msg: name + ' staat er twee keer in.', field: 'p' + i };
      seen[key] = i;
    }
    return API.validatePlayers(list) ? null : { msg: 'Elke speler een eigen naam, en elke naam een keer.', field: '' };
  }

  // Na een formulierfout: naar het foute veld scrollen en het de focus geven (anders naar de fouttekst).
  function scrollToFout() {
    var el = app.querySelector('[data-fout]') || app.querySelector('[data-fout-tekst]');
    if (!el) return;
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { try { el.scrollIntoView(); } catch (e2) { /* niets */ } }
    if (el.focus) { try { el.focus({ preventScroll: true }); } catch (e) { /* niets */ } }
  }

  function readCreateForm(form) {
    var c = ui.create;
    c.name = String(form.name.value || '');
    c.planned = String(form.plannedRounds.value || '');
    c.pin = String(form.pin.value || '');
    c.paste = String((form.elements.paste && form.elements.paste.value) || '');
    for (var i = 0; i < 24; i++) {
      var inp = form.elements['p' + i];
      if (!inp) continue;
      // "Eva (v)" in een naamveld: de markering zet M/V en verdwijnt uit de naam.
      var p = parseNaam(inp.value);
      if (p.g) { c.names[i] = p.name; c.genders[i] = p.g; }
      else c.names[i] = String(inp.value || '');
    }
  }

  // ---------- demo: lokaal voorbeeldtoernooi met 16 namen ----------

  // De demo wordt opnieuw gezet als de vorige ouder is dan 2 u (een doorgespeeld bord is geen demo meer), of met ?demo&vers.
  function seedDemo() {
    var at = typeof API.localSeededAt === 'function' ? API.localSeededAt(DEMO_CODE) : null;
    var force = params.has('vers') || !at || Date.now() - at > 2 * 3600000;
    var names = ['Noor', 'Bram', 'Mila', 'Daan', 'Eva', 'Luc', 'Lotte', 'Seppe', 'Fien', 'Jonas', 'Lien', 'Wout', 'Amber', 'Tuur', 'Jules', 'Nel'];
    var t0 = Date.now() - 75 * 60000;   // de demo-avond begon 75 min geleden: de tijden lezen als live
    function iso(min) { return new Date(t0 + min * 60000).toISOString(); }
    var event = { code: DEMO_CODE, name: 'ESCALANO demo', players: names, courts: 4, plannedRounds: 9, createdAt: iso(0), pin: '1234' };
    var log = [];
    function add(type, by, data, min) {
      log.push({ seq: log.length + 1, ts: iso(min), type: type, by: by, data: data });
    }
    add('start', 'organisator', {}, 5);
    var rounds = [[14, 12, 8, 15], [11, 13, 9, 16], [12, 10, 14, 7]];
    var min = 10;
    rounds.forEach(function (sas, r) {
      var st = ENGINE.derive(event, log);
      sas.forEach(function (sa, c) {
        var m = st.current.matches[c];
        add('score', names[m.a[0]], { round: r + 1, court: c, sa: sa, sb: POINTS - sa }, min);
        min += 4;
      });
      min += 6;
    });
    // Ronde 4: veld 1 en 3 zijn binnen, veld 2 en 4 spelen nog.
    var st4 = ENGINE.derive(event, log);
    add('score', names[st4.current.matches[0].a[0]], { round: 4, court: 0, sa: 13, sb: 8 }, min);
    add('score', names[st4.current.matches[2].b[0]], { round: 4, court: 2, sa: 9, sb: 12 }, min + 3);
    API.seedLocal(DEMO_CODE, event, log, { force: force });
    setPref('escalano-pin-' + DEMO_CODE, '1234');
  }

  // ---------- start ----------

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el || !app.contains(el)) return;
    var fn = actions[el.getAttribute('data-act')];
    if (!fn) return;
    ev.preventDefault();
    fn(el, ev);
  });
  app.addEventListener('submit', function (ev) {
    var form = ev.target.closest('form[data-form]');
    if (!form) return;
    ev.preventDefault();
    var fn = forms[form.getAttribute('data-form')];
    if (fn) fn(form);
  });
  app.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el && el.getAttribute && el.getAttribute('data-change') === 'n') {
      var form = el.closest('form');
      if (form) readCreateForm(form);
      ui.create.n = toInt(el.value) || 16;
      render();
    }
  });
  app.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el) return;
    if (el.name === 'pin' && VIEW === 'beheer' && P.e) ui.pinDraft = el.value;
    // Het klad van "Spelers aanpassen" overleeft een render tussendoor (een poll, een verlopen wapentimer).
    if (el.name === 'players' && VIEW === 'beheer') ui.playersDraft = el.value;
    var form = el.closest ? el.closest('form[data-form="create"]') : null;
    if (form) updateTeller(form);
  });
  // Aanmaakformulier: Enter springt naar het volgende veld, verstuurt nooit.
  app.addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (ev.key !== 'Enter' || !el || !el.getAttribute || !el.getAttribute('data-next')) return;
    var form = el.closest('form[data-form="create"]');
    if (!form) return;
    ev.preventDefault();
    var fields = Array.prototype.slice.call(form.querySelectorAll('input.invoer, select.invoer'));
    var idx = fields.indexOf(el);
    var next = fields[idx + 1];
    if (next) { try { next.focus(); } catch (e) { /* niets */ } }
  });
  // De plak-textarea vult de velden ook bij het verlaten (change), niet bij elke toets.
  app.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el && el.getAttribute && el.getAttribute('data-paste')) {
      var form = el.closest('form');
      if (form) { readCreateForm(form); fillFromPaste(form); }
    }
  });
  // Open/dicht van de uitklapblokken onthouden over een render heen.
  // Elk blok met data-details onthoudt zijn open/dicht: de bekende in hun eigen vlag, de rest in ui.openDetails.
  app.addEventListener('toggle', function (ev) {
    var el = ev.target;
    var key = el && el.getAttribute ? el.getAttribute('data-details') : null;
    if (!key) return;
    if (key === 'punten') ui.showPunten = el.open;
    else if (key === 'links') ui.showLinks = el.open;
    else if (key === 'stand') ui.showStand = el.open;
    else if (key === 'spelers') ui.showPlayers = el.open;
    else if (key.indexOf('ronde-') === 0) { var r = toInt(key.slice(6)); if (el.open) ui.puntenRound = r; else if (ui.puntenRound === r) ui.puntenRound = null; }
    else ui.openDetails[key] = el.open;
  }, true);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { poll(); keepAwake(); }
  });
  window.addEventListener('storage', function (ev) {
    if (ev.key && ev.key.indexOf('escalano-local-') === 0) poll();
  });
  if (VIEW === 'tv') {
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'f' || ev.key === 'F') toggleFullscreen();
    });
  }

  function init() {
    var theme = pf('setTheme');
    if (theme) { try { theme(VIEW === 'tv' ? '#123D33' : '#F3E4C7'); } catch (e) { /* stil */ } }
    if (VIEW === 'landing') { render(); return; }
    if (VIEW === 'beheer' && !P.e) {
      API.resolve().then(function () { store.conn = API.mode() === 'local' ? 'local' : 'ok'; render(); });
      render();
      return;
    }
    render();
    API.resolve({ forceLocal: P.demo }).then(function () {
      if (P.demo) seedDemo();
      loadPrefs();
      render();
      poll();
      keepAwake();
      if (VIEW === 'tv') setTimeout(tvToast, 800);
    });
  }

  init();
}());
