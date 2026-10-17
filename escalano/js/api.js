/*
  ESCALANO transport (SPEC.md, sectie 5).

  window.ESCALANO_API: resolve(), getState(code, since), create(), score(), admin().
  Endpoint, in volgorde: URL-param ?api= > ESCALANO_CONFIG.ENDPOINT > /api (als ping binnen 3 s
  antwoordt) > lokale modus. De lokale modus is dezelfde API op localStorage
  (escalano-local-<code>), met een geheugenkopie als localStorage ontbreekt.

  Alle functies geven een promise op het JSON-antwoord ({ok:true, ...} of {ok:false, error}).
  Alleen een echte netwerkfout laat de promise falen; de lokale modus faalt nooit.
*/
(function () {
  'use strict';

  var CONFIG = window.ESCALANO_CONFIG || {};
  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var PING_TIMEOUT = 3000;
  var ADMIN_TYPES = ['players', 'start', 'correct', 'end', 'resume'];
  var LOCAL_PREFIX = 'escalano-local-';

  var mode = null;        // 'remote' | 'local' | null (nog niet bepaald)
  var endpoint = '';
  var resolving = null;   // de ene resolve-promise

  // ---------- hulpjes ----------

  function urlParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); } catch (e) { return null; }
  }

  function toInt(v) {
    var s = v === null || v === undefined ? '' : String(v).trim();
    if (!/^-?\d{1,9}$/.test(s)) return null;
    return parseInt(s, 10);
  }

  function cleanText(v, max) {
    var s = (v === null || v === undefined ? '' : String(v)).trim();
    if (!s || s.length > max) return null;
    return s;
  }

  function validPin(pin) {
    return /^\d{4,8}$/.test(String(pin === undefined || pin === null ? '' : pin));
  }

  function validScore(sa, sb) {
    return sa !== null && sb !== null && sa >= 0 && sb >= 0 && sa <= 21 && sb <= 21 && sa + sb === 21;
  }

  // Zelfde regels als de server: 8..24 namen, veelvoud van 4, 1..24 tekens, uniek.
  function validatePlayers(arr) {
    if (!Array.isArray(arr)) return null;
    if (arr.length < 8 || arr.length > 24 || arr.length % 4 !== 0) return null;
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== 'string') return null;
      var name = cleanText(arr[i], 24);
      if (!name) return null;
      var key = name.toLowerCase();
      if (seen[key]) return null;
      seen[key] = true;
      out.push(name);
    }
    return out;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function fail(code) {
    return { ok: false, error: code };
  }

  function normCode(v) {
    return String(v || '').trim().toUpperCase();
  }

  // ---------- opslag voor de lokale modus ----------

  var memory = {};  // terugval: privevenster, headless browser, geblokkeerde opslag
  var storageOk = null;   // een keer geprobeerd bij resolve(): false = opslag staat uit of zit vol (de app zegt het dan)

  function probeStorage() {
    try {
      window.localStorage.setItem('escalano-probe', '1');
      window.localStorage.removeItem('escalano-probe');
      storageOk = true;
    } catch (e) {
      storageOk = false;
    }
    return storageOk;
  }

  function storageGet(key) {
    try {
      var v = window.localStorage.getItem(key);
      if (v !== null) return v;
    } catch (e) { /* geen opslag */ }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function storageSet(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(key, value); } catch (e) { storageOk = false; /* geen opslag (uit of vol), geheugen volstaat in dit tabblad */ }
  }

  function readLocal(code) {
    var raw = storageGet(LOCAL_PREFIX + code);
    if (!raw) return null;
    try {
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== 'object' || !obj.event || !Array.isArray(obj.log)) return null;
      return obj;
    } catch (e) { return null; }
  }

  function writeLocal(code, obj) {
    storageSet(LOCAL_PREFIX + code, JSON.stringify(obj));
  }

  function publicEvent(ev) {
    // De pin gaat nooit naar de views.
    return {
      code: ev.code, name: ev.name, players: ev.players.slice(),
      courts: ev.courts, plannedRounds: ev.plannedRounds, createdAt: ev.createdAt
    };
  }

  function newLocalCode() {
    for (var tries = 0; tries < 50; tries++) {
      var code = '';
      for (var i = 0; i < 6; i++) code += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
      if (!readLocal(code)) return code;
    }
    return null;
  }

  function localCurrentCourts(store) {
    for (var i = store.log.length - 1; i >= 0; i--) {
      var e = store.log[i];
      if (e.type === 'players') {
        var p = e.data && e.data.players;
        if (Array.isArray(p) && p.length >= 8) return p.length / 4;
        break;
      }
    }
    return store.event.courts;
  }

  function localAppend(code, store, type, by, data) {
    var seq = store.log.length + 1;
    store.log.push({ seq: seq, ts: nowIso(), type: type, by: by, data: data });
    writeLocal(code, store);
    return { ok: true, seq: seq };
  }

  var local = {
    getState: function (code, since) {
      code = normCode(code);
      var store = readLocal(code);
      if (!store) return fail('unknown');
      var s = toInt(since);
      if (s === null || s < 0) s = 0;
      return {
        ok: true,
        event: publicEvent(store.event),
        log: store.log.filter(function (e) { return e.seq > s; }),
        seq: store.log.length
      };
    },

    create: function (o) {
      var name = cleanText(o.name, 60);
      if (!name) return fail('bad');
      var players = validatePlayers(o.players);
      if (!players) return fail('bad');
      var planned = o.plannedRounds === undefined || o.plannedRounds === null || o.plannedRounds === '' ? 9 : toInt(o.plannedRounds);
      if (planned === null || planned < 1 || planned > 99) return fail('bad');
      if (!validPin(o.pin)) return fail('bad');
      var code = newLocalCode();
      if (!code) return fail('busy');
      writeLocal(code, {
        event: {
          code: code, createdAt: nowIso(), name: name, courts: players.length / 4,
          plannedRounds: planned, players: players, pin: String(o.pin)
        },
        log: []
      });
      return { ok: true, code: code };
    },

    score: function (o) {
      var code = normCode(o.e);
      var store = readLocal(code);
      if (!store) return fail('unknown');
      var round = toInt(o.round), court = toInt(o.court), sa = toInt(o.sa), sb = toInt(o.sb);
      if (round === null || round < 1) return fail('bad');
      if (court === null || court < 0 || court >= localCurrentCourts(store)) return fail('bad');
      if (!validScore(sa, sb)) return fail('bad');
      var by = String(o.by || '').trim();
      if (by.length > 24) return fail('bad');
      return localAppend(code, store, 'score', by, { round: round, court: court, sa: sa, sb: sb });
    },

    admin: function (o) {
      var code = normCode(o.e);
      var store = readLocal(code);
      if (!store) return fail('unknown');
      if (!validPin(o.pin) || String(o.pin) !== String(store.event.pin)) return fail('pin');
      var type = String(o.type || '');
      if (ADMIN_TYPES.indexOf(type) === -1) return fail('bad');
      var data = o.data;
      if (data === undefined || data === null) data = {};
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (e) { return fail('bad'); }
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('bad');
      if (JSON.stringify(data).length > 4000) return fail('bad');
      if (type === 'players') {
        var players = validatePlayers(data.players);
        if (!players) return fail('bad');
        var started = store.log.some(function (e) { return e.type === 'start'; });
        if (started) return fail('setup');
        data = { players: players };
      }
      return localAppend(code, store, type, 'organisator', data);
    },

    // Zet een kant-en-klaar event + log in de lokale opslag (demo). Geeft false als het al bestaat,
    // tenzij opts.force: dan wordt het overschreven. seededAt onthoudt wanneer (de demo verjaart na 2 u).
    seed: function (code, event, log, opts) {
      code = normCode(code);
      if (readLocal(code) && !(opts && opts.force)) return false;
      writeLocal(code, { event: event, log: log || [], seededAt: Date.now() });
      return true;
    },
    // Wanneer de lokale opslag voor deze code gezet is (ms), of null.
    seededAt: function (code) {
      var raw = storageGet(LOCAL_PREFIX + normCode(code));
      if (!raw) return null;
      try { var o = JSON.parse(raw); return o && typeof o.seededAt === 'number' ? o.seededAt : null; } catch (e) { return null; }
    }
  };

  // ---------- de echte backend ----------

  function withQuery(url, qs) {
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + qs;
  }

  function encode(params) {
    return Object.keys(params).map(function (k) {
      var v = params[k];
      if (v === undefined || v === null) v = '';
      return encodeURIComponent(k) + '=' + encodeURIComponent(String(v));
    }).join('&');
  }

  function remoteGet(params) {
    return window.fetch(withQuery(endpoint, encode(params)), { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      });
  }

  function remotePost(params) {
    // Form-body: geen preflight, en Apps Script antwoordt na zijn 302 met een leesbaar JSON.
    return window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encode(params)
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function ping(url) {
    if (typeof window.fetch !== 'function') return Promise.resolve(false);
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, PING_TIMEOUT);
    var opts = { method: 'GET', cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;
    return window.fetch(withQuery(url, 'a=ping'), opts)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { clearTimeout(timer); return !!(j && j.ok && j.service === 'escalano'); })
      .catch(function () { clearTimeout(timer); return false; });
  }

  function setMode(m, url) {
    mode = m;
    endpoint = url || '';
    return { mode: mode, endpoint: endpoint };
  }

  // ---------- publiek ----------

  function resolve(opts) {
    if (resolving) return resolving;
    var force = opts && opts.forceLocal;
    if (storageOk === null) probeStorage();
    resolving = (function () {
      if (force) return Promise.resolve(setMode('local', ''));
      var fromUrl = urlParam('api');
      if (fromUrl) return Promise.resolve(setMode('remote', fromUrl));
      if (CONFIG.ENDPOINT) return Promise.resolve(setMode('remote', CONFIG.ENDPOINT));
      return ping('/api').then(function (ok) {
        return ok ? setMode('remote', '/api') : setMode('local', '');
      });
    })();
    return resolving;
  }

  function ready() {
    return mode ? Promise.resolve() : resolve().then(function () { return undefined; });
  }

  window.ESCALANO_API = {
    resolve: resolve,
    mode: function () { return mode; },
    endpoint: function () { return endpoint; },

    getState: function (code, since) {
      return ready().then(function () {
        if (mode === 'local') return local.getState(code, since);
        return remoteGet({ a: 'state', e: normCode(code), since: toInt(since) || 0 });
      });
    },

    create: function (o) {
      return ready().then(function () {
        if (mode === 'local') return local.create(o);
        return remotePost({
          a: 'create', name: o.name, players: JSON.stringify(o.players),
          plannedRounds: o.plannedRounds, pin: o.pin
        });
      });
    },

    score: function (o) {
      return ready().then(function () {
        if (mode === 'local') return local.score(o);
        return remotePost({
          a: 'score', e: normCode(o.e), round: o.round, court: o.court, sa: o.sa, sb: o.sb, by: o.by || ''
        });
      });
    },

    admin: function (o) {
      return ready().then(function () {
        if (mode === 'local') return local.admin(o);
        return remotePost({
          a: 'admin', e: normCode(o.e), pin: o.pin, type: o.type,
          data: JSON.stringify(o.data && typeof o.data === 'object' ? o.data : {})
        });
      });
    },

    // Alleen lokaal (demo): zet een event met log klaar als het er nog niet is (of opnieuw met {force: true}).
    seedLocal: local.seed,
    localSeededAt: local.seededAt,
    // true = localStorage werkt; false = uit of vol (de lokale modus leeft dan alleen in dit tabblad); null = nog niet geprobeerd.
    storageOk: function () { return storageOk; },
    validatePlayers: validatePlayers,
    validPin: validPin
  };
}());
