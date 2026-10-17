/* ESCALANO platform: kleine hulpjes rond de browser, zonder opbouw van de pagina en zonder afhankelijkheden.
   window.ESCALANO_PLATFORM = { tick, thud, copy, share, fullscreen, keepAwake, setTheme, relativeTime, clock }

   Elke functie faalt stil. Een toestel dat iets niet kan (trillen, delen, wakker blijven) krijgt gewoon
   geen effect, nooit een fout in de console en nooit een gebroken scherm. app.js roept deze hulpjes aan
   achter een guard, zodat het bord ook werkt als dit bestand ontbreekt. */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.ESCALANO_PLATFORM) return;

  var nav = typeof navigator !== 'undefined' ? navigator : null;
  var doc = typeof document !== 'undefined' ? document : null;
  function noop() {}

  // ---------- voelbaar: tick en thud ----------

  function vibrate(ms) {
    // iOS Safari kent navigator.vibrate niet (dan gebeurt er niets); Android trilt kort.
    // Sommige browsers gooien een fout als de gebruiker nog niet getikt heeft: ook die slikken we.
    try {
      if (nav && typeof nav.vibrate === 'function') nav.vibrate(ms);
    } catch (e) { /* stil */ }
  }
  function tick() { vibrate(8); }    // een tegel of cijfer gekozen
  function thud() { vibrate(30); }   // een score verstuurd

  // ---------- kopiëren ----------

  function copyFallback(text) {
    // Zonder https (bv. de tv op het lokale netwerk) bestaat navigator.clipboard niet. Dan zetten we de tekst
    // in een verborgen textarea, selecteren hem en vragen de browser om te kopiëren. De focus geven we daarna
    // terug aan wat de gebruiker vasthad, zodat niets op het scherm verspringt.
    try {
      if (!doc || !doc.body) return false;
      var vorige = doc.activeElement;
      var ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.setAttribute('aria-hidden', 'true');
      ta.tabIndex = -1;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.padding = '0';
      ta.style.border = '0';
      ta.style.opacity = '0';
      ta.style.pointerEvents = 'none';
      doc.body.appendChild(ta);
      try { ta.focus({ preventScroll: true }); } catch (e1) { ta.focus(); }
      ta.select();
      try { ta.setSelectionRange(0, ta.value.length); } catch (e2) { /* oudere browsers */ }
      var ok = false;
      try { ok = doc.execCommand('copy'); } catch (e3) { ok = false; }
      doc.body.removeChild(ta);
      if (vorige && typeof vorige.focus === 'function') {
        try { vorige.focus({ preventScroll: true }); } catch (e4) { /* stil */ }
      }
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function copy(text) {
    // Belooft altijd een boolean (true = het staat op het klembord), wordt nooit afgewezen.
    return new Promise(function (resolve) {
      try {
        var s = text === null || text === undefined ? '' : String(text);
        if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
          nav.clipboard.writeText(s).then(
            function () { resolve(true); },
            function () { resolve(copyFallback(s)); }   // geweigerd (geen focus, geen toestemming): de oude weg
          );
        } else {
          resolve(copyFallback(s));
        }
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ---------- delen ----------

  function share(opts) {
    // navigator.share opent het deelvenster van het toestel (WhatsApp staat daar meteen tussen). Dat kan alleen
    // op https en meteen na een tik. Waar het niet kan, kopiëren we de tekst en zegt de app "Gekopieerd".
    // Resultaat: 'shared', 'copied' of false. Sluit de gebruiker het deelvenster zelf, dan is het false:
    // we kopiëren dan niet stiekem iets achter zijn rug.
    return new Promise(function (resolve) {
      try {
        var o = opts || {};
        var text = o.text ? String(o.text) : '';
        var url = o.url ? String(o.url) : '';
        var plat = text && url && text.indexOf(url) === -1 ? text + ' ' + url : (text || url);
        var data = {};
        if (o.title) data.title = String(o.title);
        if (text) data.text = text;
        // Staat de link al in de tekst, dan gaat hij niet ook als url mee: WhatsApp zou hem anders twee keer tonen.
        if (url && !(text && text.indexOf(url) !== -1)) data.url = url;
        var kan = nav && typeof nav.share === 'function' &&
          (typeof nav.canShare !== 'function' || nav.canShare(data));
        if (!kan) {
          copy(plat).then(function (ok) { resolve(ok ? 'copied' : false); });
          return;
        }
        nav.share(data).then(
          function () { resolve('shared'); },
          function (err) {
            if (err && err.name === 'AbortError') { resolve(false); return; }
            copy(plat).then(function (ok) { resolve(ok ? 'copied' : false); });
          }
        );
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ---------- volledig scherm ----------

  function fullscreen() {
    // Zet volledig scherm aan, of weer uit als het al aan staat (de tv: toets f).
    // iPhone kent dit niet voor een webpagina; dan gebeurt er niets. Geeft true als de vraag gesteld is.
    try {
      if (!doc) return false;
      var el = doc.documentElement;
      var p;
      if (doc.fullscreenElement || doc.webkitFullscreenElement) {
        if (doc.exitFullscreen) p = doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) p = doc.webkitExitFullscreen();
        else return false;
      } else {
        if (el.requestFullscreen) p = el.requestFullscreen();
        else if (el.webkitRequestFullscreen) p = el.webkitRequestFullscreen();
        else return false;
      }
      if (p && typeof p.catch === 'function') p.catch(noop);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- scherm wakker houden ----------

  var lock = null;
  var wilWakker = false;
  var luistert = false;
  var geweigerdTot = 0;   // na een weigering (batterij bijna leeg, spaarstand) een minuut niet opnieuw vragen

  function vraagLock() {
    try {
      if (!wilWakker || lock || !nav || !nav.wakeLock || !doc || doc.visibilityState !== 'visible') return;
      if (Date.now() < geweigerdTot) return;
      nav.wakeLock.request('screen').then(function (l) {
        if (!wilWakker) { l.release().then(noop, noop); return; }
        lock = l;
        l.addEventListener('release', function () { lock = null; });
      }, function () {
        // geweigerd (batterij bijna leeg, geen https): het scherm valt dan gewoon in slaap; niet elke 4 s hameren
        geweigerdTot = Date.now() + 60000;
      });
    } catch (e) { /* stil */ }
  }

  function keepAwake(aan) {
    // Houdt het scherm wakker: de tv de hele avond, de gsm tijdens het spelen. De browser laat de lock los
    // zodra het tabblad verborgen is (andere app, scherm uit); daarom vragen we hem opnieuw aan bij
    // visibilitychange. keepAwake(false) laat los. Geeft true als de vraag gesteld kon worden.
    try {
      if (aan === false) {
        wilWakker = false;
        if (lock) { var l = lock; lock = null; l.release().then(noop, noop); }
        return true;
      }
      wilWakker = true;
      if (!luistert && doc) {
        luistert = true;
        doc.addEventListener('visibilitychange', vraagLock);
      }
      if (!nav || !nav.wakeLock) return false;
      vraagLock();
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- themakleur ----------

  function setTheme(color) {
    // Kleurt de browserbalk en, als app geïnstalleerd, de statusbalk: creme op papier (gsm, beheer, landing),
    // donkergroen op de tv. index.html begint met creme; app.js zet dit per weergave. Lege waarde: niets.
    try {
      if (!doc || !doc.head) return false;
      var c = String(color === null || color === undefined ? '' : color).trim();
      if (!c) return false;
      var meta = doc.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = doc.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        doc.head.appendChild(meta);
      }
      if (meta.getAttribute('content') !== c) meta.setAttribute('content', c);
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- tijd ----------

  function relativeTime(ts) {
    // Hoe lang geleden: "net" (minder dan een minuut), "3 min", "1 u", "1 u 12 min".
    // ts mag een ISO-tekst, een Date of milliseconden zijn. Onbekend of ongeldig: "".
    // Een tijdstip dat door een klokverschil nog in de toekomst ligt, telt als "net".
    try {
      var t;
      if (ts instanceof Date) t = ts.getTime();
      else if (typeof ts === 'number') t = ts;
      else if (ts) t = Date.parse(String(ts));
      if (typeof t !== 'number' || !isFinite(t)) return '';
      var min = Math.floor((Date.now() - t) / 60000);
      if (min < 1) return 'net';
      if (min < 60) return min + ' min';
      var u = Math.floor(min / 60);
      var rest = min % 60;
      return rest ? u + ' u ' + rest + ' min' : u + ' u';
    } catch (e) {
      return '';
    }
  }

  function clock(d) {
    // "21:42" in de tijd van het toestel, altijd twee cijfers. Zonder argument: nu.
    try {
      var x = d instanceof Date ? d : new Date();
      var h = x.getHours();
      var m = x.getMinutes();
      if (!isFinite(h) || !isFinite(m)) return '';
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    } catch (e) {
      return '';
    }
  }

  window.ESCALANO_PLATFORM = Object.freeze({
    tick: tick,
    thud: thud,
    copy: copy,
    share: share,
    fullscreen: fullscreen,
    keepAwake: keepAwake,
    setTheme: setTheme,
    relativeTime: relativeTime,
    clock: clock
  });
})();
