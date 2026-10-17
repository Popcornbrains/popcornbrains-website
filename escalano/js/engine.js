/*
  ESCALANO toernooimotor (SPEC.md, sectie 3).

  Pure functies: geen DOM, geen Date, geen toeval, geen fetch.
  Werkt als klassiek browserscript (window.ESCALANO_ENGINE)
  en in node via require (module.exports).

  De logica is die van het 12-spelersbord (output/escalano/escalano-scorebord-12.html),
  veralgemeend naar elk aantal velden: zelfde teamvormen, zelfde kostfunctie. Bij gelijke kost
  kiest de motor sinds v1.3 de evenwichtigste splitsing op startpositie (het 12-bord nam blind
  de eerste). Het bestand blijft ASCII: letters met een accent staan er als \u-escape in.
*/
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports) {
    module.exports = factory();
  } else {
    root.ESCALANO_ENGINE = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var POINTS = 21;
  var MIN_PLAYERS = 8;
  var MAX_PLAYERS = 24;
  var DEFAULT_PLANNED_ROUNDS = 9;
  // Een herhaalde partner weegt tien keer zwaarder dan een herhaalde tegenstander.
  var PARTNER_WEIGHT = 10;

  // ---------- hulpjes ----------

  // Sleutel voor een paar spelers, laagste index eerst: "x-y".
  function key2(x, y) {
    return x < y ? x + '-' + y : y + '-' + x;
  }

  // Geheel getal uit een getal of een numerieke string, anders null.
  // Een -0 wordt 0: zo blijft een state ook na een JSON-rondreis strikt gelijk.
  function toInt(v) {
    var n = null;
    if (typeof v === 'number' && Number.isInteger(v)) n = v;
    else if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) n = parseInt(v.trim(), 10);
    return n === 0 ? 0 : n;
  }

  // Vaste collator voor de naam-tiebreak: tv en gsm sorteren gelijke spelers identiek,
  // los van de taal van het toestel. Zonder Intl valt het terug op localeCompare met 'nl'.
  var COLLATOR = null;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function') COLLATOR = new Intl.Collator('nl');
  } catch (err) {
    COLLATOR = null;
  }
  function compareNames(x, y) {
    return COLLATOR ? COLLATOR.compare(x, y) : x.localeCompare(y, 'nl');
  }

  function isStringList(p) {
    return Array.isArray(p) && p.every(function (x) { return typeof x === 'string'; });
  }

  // 8..24 spelers, veelvoud van 4.
  function isValidPlayerCount(n) {
    return Number.isInteger(n) && n % 4 === 0 && n >= MIN_PLAYERS && n <= MAX_PLAYERS;
  }

  function isPair(t) {
    return Array.isArray(t) && t.length === 2 && Number.isInteger(t[0]) && Number.isInteger(t[1]);
  }

  // Een gespeelde match: twee teams van twee en een geldige score.
  function isPlayedMatch(m) {
    return !!m && typeof m === 'object' && isPair(m.a) && isPair(m.b) && isValidScore(m.sa, m.sb);
  }

  // Beide gehele getallen, 0..21, samen 21.
  function isValidScore(sa, sb) {
    return Number.isInteger(sa) && Number.isInteger(sb) && sa >= 0 && sb >= 0 && sa + sb === POINTS;
  }

  // Een label voor "wie" en "wanneer", doorgegeven zoals het in de log staat.
  function labelOf(v) {
    return typeof v === 'string' ? v : null;
  }
  function stampOf(v) {
    return typeof v === 'string' || typeof v === 'number' ? v : null;
  }

  // ---------- het format ----------

  // Ronde 1: per veld de vier spelers in startvolgorde, 1+4 tegen 2+3.
  function firstRound(nPlayers) {
    var n = toInt(nPlayers);
    var out = [];
    if (n === null || n < 4) return out;
    var courts = Math.floor(n / 4);
    for (var c = 0; c < courts; c++) {
      out.push({ a: [4 * c, 4 * c + 3], b: [4 * c + 1, 4 * c + 2] });
    }
    return out;
  }

  // Telt per paar hoe vaak ze partners (P) en tegenstanders (O) waren.
  function history(rounds) {
    var P = {};
    var O = {};
    rounds.forEach(function (r) {
      var matches = r && Array.isArray(r.matches) ? r.matches : [];
      matches.forEach(function (m) {
        if (!m || !isPair(m.a) || !isPair(m.b)) return;
        P[key2(m.a[0], m.a[1])] = (P[key2(m.a[0], m.a[1])] || 0) + 1;
        P[key2(m.b[0], m.b[1])] = (P[key2(m.b[0], m.b[1])] || 0) + 1;
        m.a.forEach(function (x) {
          m.b.forEach(function (y) { O[key2(x, y)] = (O[key2(x, y)] || 0) + 1; });
        });
      });
    });
    return { P: P, O: O };
  }

  // Herhalingskost van een splitsing: 10 x eerdere partnerschappen + eerdere ontmoetingen.
  function cost(a, b, H) {
    var c = PARTNER_WEIGHT * ((H.P[key2(a[0], a[1])] || 0) + (H.P[key2(b[0], b[1])] || 0));
    a.forEach(function (x) {
      b.forEach(function (y) { c += H.O[key2(x, y)] || 0; });
    });
    return c;
  }

  // Onevenwicht van een splitsing op startpositie (index = startplaats, lager = sterker):
  // het verschil tussen de sommen van de startplaatsen van beide teams. 0 is perfect in balans.
  function imbalance(o) {
    return Math.abs((o.a[0] + o.a[1]) - (o.b[0] + o.b[1]));
  }

  // Winnaars een veld omhoog, verliezers een veld omlaag; op veld 1 blijven de winnaars,
  // op het laatste veld de verliezers. De twee paren die samenkomen worden gesplitst:
  // je vorige partner wordt je tegenstander. Van de twee splitsingen nemen we die met de
  // laagste herhalingskost. Bij gelijke kost (v1.3) de evenwichtigste op startpositie, de
  // sterkste met de zwakste zoals in ronde 1; is ook dat gelijk, dan de eerste.
  // In ronde 2 kosten beide splitsingen altijd 0, dus daar beslist altijd de balans.
  function nextRound(played, previousRounds, courts) {
    if (!Array.isArray(played) || played.length === 0 || !played.every(isPlayedMatch)) return [];
    var n = toInt(courts);
    if (n === null || n !== played.length) n = played.length;
    var H = history(Array.isArray(previousRounds) ? previousRounds : []);
    var res = played.map(function (m) {
      var aWins = m.sa > m.sb;
      return { win: aWins ? m.a : m.b, lose: aWins ? m.b : m.a };
    });
    var out = [];
    for (var c = 0; c < n; c++) {
      var g1, g2;
      if (n === 1) { g1 = res[0].win; g2 = res[0].lose; }
      else if (c === 0) { g1 = res[0].win; g2 = res[1].win; }
      else if (c === n - 1) { g1 = res[c - 1].lose; g2 = res[c].lose; }
      else { g1 = res[c - 1].lose; g2 = res[c + 1].win; }
      var o1 = { a: [g1[0], g2[0]], b: [g1[1], g2[1]] };
      var o2 = { a: [g1[0], g2[1]], b: [g1[1], g2[0]] };
      var k1 = cost(o1.a, o1.b, H);
      var k2 = cost(o2.a, o2.b, H);
      var second = k2 < k1 || (k2 === k1 && imbalance(o2) < imbalance(o1));
      out.push(second ? o2 : o1);
    }
    return out;
  }

  // ---------- stand en partners ----------

  // Alleen gesloten rondes tellen. Open ronde bepaalt enkel "court".
  function standings(players, rounds, current) {
    var rows = players.map(function (name, i) {
      return { i: i, name: name, pt: 0, w: 0, v1: 0, court: null };
    });
    rounds.forEach(function (r) {
      r.matches.forEach(function (m, c) {
        m.a.forEach(function (x) {
          if (!rows[x]) return;
          rows[x].pt += m.sa;
          if (m.sa > m.sb) rows[x].w += 1;
          if (c === 0) rows[x].v1 += 1;
        });
        m.b.forEach(function (x) {
          if (!rows[x]) return;
          rows[x].pt += m.sb;
          if (m.sb > m.sa) rows[x].w += 1;
          if (c === 0) rows[x].v1 += 1;
        });
      });
    });
    if (current) {
      current.matches.forEach(function (m, c) {
        m.a.concat(m.b).forEach(function (x) { if (rows[x]) rows[x].court = c; });
      });
    }
    rows.sort(function (p, q) {
      return q.pt - p.pt || q.w - p.w || q.v1 - p.v1 || compareNames(p.name, q.name);
    });
    return rows;
  }

  // Per speler de verschillende partners tot nu toe, in volgorde van eerste keer.
  function partnersOf(nPlayers, rounds) {
    var out = {};
    for (var i = 0; i < nPlayers; i++) out[i] = [];
    function add(x, y) {
      if (!out[x]) return;
      if (out[x].indexOf(y) === -1) out[x].push(y);
    }
    rounds.forEach(function (r) {
      r.matches.forEach(function (m) {
        add(m.a[0], m.a[1]); add(m.a[1], m.a[0]);
        add(m.b[0], m.b[1]); add(m.b[1], m.b[0]);
      });
    });
    return out;
  }

  // ---------- geslachten en titel (v1.3) ----------

  // Enkel om de titel van de winnaar te kiezen; nergens anders gebruikt.
  var TITLE_M = 'El Campe\u00f3n';
  var TITLE_V = 'La Campeona';
  var TITLE_BOTH = TITLE_M + ' / ' + TITLE_V;

  // Een geslacht: 'm' of 'v', een hoofdletter mag. Al de rest is null.
  function genderOf(x) {
    if (x === 'm' || x === 'M') return 'm';
    if (x === 'v' || x === 'V') return 'v';
    return null;
  }

  // Een geldige rij: een array met precies n items, elk 'm' of 'v'. Geeft een nieuwe rij in
  // kleine letters terug, of null zodra er iets niet klopt.
  function gendersOf(g, n) {
    if (!Array.isArray(g) || g.length !== n) return null;
    var out = [];
    for (var i = 0; i < n; i++) {
      var x = genderOf(g[i]);
      if (x === null) return null;
      out.push(x);
    }
    return out;
  }

  // Alleen een AANVAARDE start of end roept dit op. Een ongeldige of ontbrekende rij wordt stil
  // genegeerd: de entry zelf telt wel, en de vorige geldige rij blijft staan.
  function takeGenders(st, g) {
    var parsed = gendersOf(g, st.players.length);
    if (parsed) st.genders = parsed;
  }

  // De titel voor speler i: TITLE_M bij m, TITLE_V bij v, de dubbelvorm als het geslacht niet
  // gekend is. Gooit nooit: elke onbekende input geeft de dubbelvorm.
  function titleFor(state, playerIndex) {
    var g = state && Array.isArray(state.genders) ? state.genders : null;
    var ok = g && Number.isInteger(playerIndex) && playerIndex >= 0 && playerIndex < g.length;
    var x = ok ? genderOf(g[playerIndex]) : null;
    if (x === 'm') return TITLE_M;
    if (x === 'v') return TITLE_V;
    return TITLE_BOTH;
  }

  // ---------- derive: event + log -> state ----------

  function reject(st, seq, reason) {
    st.ignored.push({ seq: seq, reason: reason });
  }

  // Alle velden van de open ronde ingegeven? Dan sluit de ronde en start de volgende.
  function closeIfComplete(st) {
    var cur = st.current;
    for (var c = 0; c < st.courts; c++) {
      if (!cur.scores[c]) return;
    }
    var played = cur.matches.map(function (m, c) {
      var s = cur.scores[c];
      return { a: m.a.slice(), b: m.b.slice(), sa: s.sa, sb: s.sb, by: s.by, ts: s.ts };
    });
    st.rounds.push({ matches: played });
    st.round += 1;
    st.current = { round: st.round, matches: nextRound(played, st.rounds, st.courts), scores: {} };
  }

  function hasAnyScore(cur) {
    return Object.keys(cur.scores).length > 0;
  }

  function apply(st, e) {
    if (!e || typeof e !== 'object') { reject(st, null, 'bad_type'); return; }
    var seq = toInt(e.seq);
    if (seq !== null && seq > st.lastSeq) st.lastSeq = seq;
    var d = e.data && typeof e.data === 'object' ? e.data : {};
    var by = labelOf(e.by);
    var ts = stampOf(e.ts);
    var round, court, sa, sb;

    switch (e.type) {

      case 'players':
        if (st.status !== 'setup') { reject(st, seq, 'not_setup'); return; }
        if (!isStringList(d.players) || !isValidPlayerCount(d.players.length)) { reject(st, seq, 'bad_players'); return; }
        st.players = d.players.slice();
        st.courts = st.players.length / 4;
        return;

      case 'start':
        if (st.status !== 'setup') { reject(st, seq, 'not_setup'); return; }
        if (!isValidPlayerCount(st.players.length)) { reject(st, seq, 'bad_players'); return; }
        st.status = 'live';
        st.round = 1;
        st.current = { round: 1, matches: firstRound(st.players.length), scores: {} };
        takeGenders(st, d.genders);
        return;

      case 'score':
        if (st.status !== 'live') { reject(st, seq, 'not_live'); return; }
        round = toInt(d.round);
        if (round !== st.round) { reject(st, seq, 'wrong_round'); return; }
        court = toInt(d.court);
        if (court === null || court < 0 || court >= st.courts) { reject(st, seq, 'bad_court'); return; }
        sa = toInt(d.sa); sb = toInt(d.sb);
        if (!isValidScore(sa, sb)) { reject(st, seq, 'bad_score'); return; }
        if (st.current.scores[court]) { reject(st, seq, 'already_scored'); return; }
        st.current.scores[court] = { sa: sa, sb: sb, by: by, ts: ts };
        closeIfComplete(st);
        return;

      case 'correct':
        // SPEC 3.2: (a) open ronde, (b) laatste gesloten ronde met een lege open ronde,
        // (c) elke andere gesloten ronde: alleen de punten (v1.1).
        if (st.status !== 'live') { reject(st, seq, 'not_live'); return; }
        round = toInt(d.round);
        if (round === null || round < 1 || round > st.round) { reject(st, seq, 'wrong_round'); return; }
        court = toInt(d.court);
        if (court === null || court < 0 || court >= st.courts) { reject(st, seq, 'bad_court'); return; }
        sa = toInt(d.sa); sb = toInt(d.sb);
        if (!isValidScore(sa, sb)) { reject(st, seq, 'bad_score'); return; }
        if (round === st.round) {
          // (a) Open ronde: zet of overschrijf de score van dat veld; sluit de ronde als dit het laatste veld was.
          st.current.scores[court] = { sa: sa, sb: sb, by: by, ts: ts };
          closeIfComplete(st);
          return;
        }
        // Gesloten ronde: overschrijf de punten van die match. Stand, w, v1 en partners volgen vanzelf.
        var m = st.rounds[round - 1].matches[court];
        m.sa = sa; m.sb = sb; m.by = by; m.ts = ts;
        if (d.pointsOnly !== true && round === st.round - 1 && !hasAnyScore(st.current)) {
          // (b) Laatste gesloten ronde en de open ronde is nog leeg: herbereken de indeling.
          st.current.matches = nextRound(st.rounds[round - 1].matches, st.rounds, st.courts);
        }
        // (c) Anders alleen de punten: een score die verkeerd om getypt was blijft de hele avond
        // te herstellen, de latere indelingen blijven zoals ze gespeeld zijn. Met pointsOnly: true
        // (v1.2, "Punten aanpassen") geldt (c) ook waar (b) zou gelden: de organisator beloofde
        // geen herindeling, en de spelers staan al op hun veld.
        return;

      case 'end':
        if (st.status !== 'live') { reject(st, seq, 'not_live'); return; }
        st.status = 'done';
        // Een verbetering tijdens de avond: de organisator stuurt de rij opnieuw mee (v1.3).
        takeGenders(st, d.genders);
        return;

      case 'resume':
        if (st.status !== 'done') { reject(st, seq, 'not_done'); return; }
        st.status = 'live';
        return;

      default:
        reject(st, seq, 'bad_type');
    }
  }

  // De enige functie die de views nodig hebben. Gooit nooit; slechte input wordt genegeerd.
  function derive(event, log) {
    var ev = event && typeof event === 'object' ? event : {};
    var players = isStringList(ev.players) ? ev.players.slice() : [];
    var planned = toInt(ev.plannedRounds);
    var st = {
      status: 'setup',
      players: players,
      courts: Math.floor(players.length / 4),
      plannedRounds: planned !== null && planned > 0 ? planned : DEFAULT_PLANNED_ROUNDS,
      rounds: [],
      round: 0,
      current: null,
      standings: [],
      partnersOf: {},
      genders: null,
      lastSeq: 0,
      ignored: []
    };
    var entries = Array.isArray(log) ? log.slice() : [];
    // Stabiel op seq sorteren: een geldige log is al gesorteerd, dit verandert dan niets.
    // Gelijke seq met andere inhoud: de volgorde in de array beslist. Dat komt in de app niet
    // voor (beide backends delen seq uit onder een lock en app.js laat een geziene seq vallen),
    // maar wie ooit twee logs samenvoegt, weet zo wat er gebeurt.
    entries = entries.map(function (e, i) { return { e: e, i: i, s: e && typeof e === 'object' ? toInt(e.seq) : null }; })
      .sort(function (p, q) {
        if (p.s === null && q.s === null) return p.i - q.i;
        if (p.s === null) return 1;
        if (q.s === null) return -1;
        return p.s - q.s || p.i - q.i;
      })
      .map(function (w) { return w.e; });
    entries.forEach(function (e) { apply(st, e); });
    st.standings = standings(st.players, st.rounds, st.current);
    st.partnersOf = partnersOf(st.players.length, st.rounds);
    return st;
  }

  return {
    POINTS: POINTS,
    isValidScore: isValidScore,
    firstRound: firstRound,
    nextRound: nextRound,
    derive: derive,
    key2: key2,
    titleFor: titleFor
  };
}));
