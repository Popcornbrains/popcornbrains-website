// MILK RUN — de tijdlijn 1996 → 2026 als data, met CORRECTE cijfers uit
// Ultratop 50 Vlaanderen (ultratop.be, geraadpleegd 2026-07-02; details in
// DATA-CAPTURE.md). Vier #1-hits: Walk On Water '00, Whisper '04,
// Blackout '09, Storm '10. Comeback: The Return '23 → Unstoppable '25 (#2,
// 23 weken) → Medicine '26. Muziek = één doorlopende soundtrack (config);
// de stilte-era dimt ze (duck), The Return brengt ze terug.
// Kleuren: K=#232321 G=#6e6e6a L=#b8b8b2 W=#ffffff (monochroom, 4 tinten).

(function () {
  const K = '#232321', G = '#6e6e6a', L = '#b8b8b2', W = '#ffffff';
  const HORIZON = 272;

  function clouds(g, t, shade, y0) {
    for (let i = 0; i < 4; i++) {
      const x = ((i * 61 - t * 6) % 220 + 220) % 220 - 20;
      const y = y0 + (i % 2) * 18;
      g.fillStyle = shade;
      g.fillRect(x, y, 14, 3); g.fillRect(x + 3, y - 2, 8, 2);
    }
  }

  function crowd(g, t, rows, bounce) {
    for (let r = 0; r < rows; r++) {
      const y = 320 - 8 - r * 7;
      for (let x = 2 + (r % 2) * 3; x < 180; x += 6) {
        const b = bounce ? Math.round(Math.abs(Math.sin(t * 4 + x * 0.7 + r))) : 0;
        g.fillStyle = r === rows - 1 ? G : K;
        g.fillRect(x, y - b, 3, 3);
        if ((x * 7 + r * 13) % 31 === 0) { g.fillStyle = L; g.fillRect(x + 1, y - b - 2, 1, 2); }
      }
    }
  }

  function beams(g, t, alpha) {
    g.save();
    g.globalAlpha = alpha; g.strokeStyle = W; g.lineWidth = 1;
    for (const [cx, ph] of [[20, 0], [160, 2.1]]) {
      const a = Math.PI / 2 + Math.sin(t * 1.3 + ph) * 0.7;
      g.beginPath(); g.moveTo(cx, 0);
      g.lineTo(cx + Math.cos(a) * 340, Math.sin(a) * 340);
      g.stroke();
    }
    g.restore();
  }

  const BACKDROPS = {
    farm(g, t) {
      clouds(g, t, G, 40);
      g.fillStyle = G; g.fillRect(0, HORIZON, 180, 1);
      for (let i = 0; i < 8; i++) {
        const x = ((i * 34 - t * 26) % 260 + 260) % 260 - 30;
        g.fillStyle = K; g.fillRect(x, HORIZON - 10, 2, 10);
        g.fillStyle = L; g.fillRect(x - 2, HORIZON - 11, 6, 2);
      }
    },
    club(g, t) {
      g.fillStyle = G; g.fillRect(0, HORIZON, 180, 1);
      // verticale lichtbalken die op de maat schuiven
      for (let i = 0; i < 5; i++) {
        const x = ((i * 44 + t * 30) % 220) - 20;
        g.save();
        g.globalAlpha = 0.12 + 0.08 * Math.sin(t * 6 + i);
        g.fillStyle = W; g.fillRect(x, 0, 8, HORIZON);
        g.restore();
      }
      crowd(g, t, 2, true);
    },
    water(g, t) {
      clouds(g, t, K, 34);
      g.fillStyle = G; g.fillRect(0, HORIZON, 180, 1);
      for (let r = 0; r < 6; r++) {
        const y = HORIZON + 6 + r * 8;
        for (let x = 0; x < 180; x += 12) {
          const o = (x + t * (14 + r * 4)) % 24 < 12 ? 0 : 5;
          g.fillStyle = r < 2 ? L : G;
          g.fillRect((x + o) % 180, y, 6, 1);
        }
      }
      if (Math.floor(t * 7) % 11 === 0) {
        g.fillStyle = W;
        g.fillRect((t * 53) % 180, HORIZON + 10 + (t * 31) % 30, 1, 1);
      }
    },
    arena(g, t) {
      g.fillStyle = K; g.fillRect(0, HORIZON - 26, 180, 26);
      beams(g, t, 0.35);
      crowd(g, t, 3, true);
    },
    blackout(g, t) {
      g.fillStyle = K; g.fillRect(0, HORIZON - 26, 180, 26);
      crowd(g, t, 3, false);
    },
    storm(g, t) {
      g.fillStyle = G; g.fillRect(0, HORIZON, 180, 1);
      for (let i = 0; i < 26; i++) {
        const x = ((i * 29 + t * 150) % 200) - 10;
        const y = (i * 47 + t * 260) % 320;
        g.fillStyle = i % 3 ? G : L;
        g.fillRect(x, y, 1, 5); g.fillRect(x - 1, y + 5, 1, 3);
      }
    },
    stilte(g, t) {
      g.fillStyle = K; g.fillRect(0, HORIZON, 180, 1);
      for (let i = 0; i < 9; i++) {
        const x = (i * 41 + 13) % 180, y = (i * 67 + 29) % 200;
        g.fillStyle = ((Math.floor(t) + i) % 4) ? K : G;
        g.fillRect(x, y, 1, 1);
      }
    },
    finale(g, t, p) {
      // AFAS Dome-koepel groeit vanaf de horizon naar je toe
      const r = 20 + p * 95;
      g.save();
      g.globalAlpha = 0.25 + p * 0.75;
      g.strokeStyle = W; g.lineWidth = 2;
      g.beginPath(); g.arc(90, HORIZON + 8, r, Math.PI, 0); g.stroke();
      g.globalAlpha = 0.2 + p * 0.4; g.strokeStyle = L; g.lineWidth = 1;
      g.beginPath(); g.arc(90, HORIZON + 8, r * 0.72, Math.PI, 0); g.stroke();
      g.restore();
      if (p > 0.45) crowd(g, t, Math.min(3, Math.floor(p * 4)), true);
      g.fillStyle = G; g.fillRect(0, HORIZON, 180, 1);
    }
  };

  // Era = één visueel + moeilijkheidssegment (backdrop, density, speed, backdrop-fx).
  // songs[] = de HUD-momenten BINNEN die era. Elke song krijgt zijn EIGEN moment
  // (geen duo-labels meer, fix 2/7): n = naam, y = releasejaar (= HUD-jaar én
  // strand-jaar), d = schermtijd in seconden (grote hits langer), b = optionele
  // chart-banner, m = optioneel visueel motief dat game.js tekent (fix 2/7 punt 3).
  // hero = midscherm-moment (fix 3/7, Storm-rapport bevinding 1): ALLEEN de
  // campagne-climax (THE RETURN + de Medicine-finale) mag het speelveld in;
  // alle andere chart-feiten leven in de vaste strip onderaan (#strip).
  // Songnamen/jaren/cijfers: Ultratop 50 Vlaanderen, zie DATA-CAPTURE.md.
  const ERAS = {
    HORIZON,
    // VOLLEDIGE discografie (beslissing Lester 2/7): ELKE charted single uit de
    // Ultratop 50 Vlaanderen komt voor, in releasevolgorde, elk zijn eigen moment.
    // Grote/#1-hits krijgen langere schermtijd (d), kleinere een korte flits.
    list: [
      { id: 'la-vache',   density: 0.50, speed: 30, backdrop: 'farm', songs: [
        // La Vache = geen Ultratop 50 Vlaanderen-notering, wel de internationale
        // doorbraak: grote hit in Frankrijk (goud, 300.000+, per DanceVibes/Wikipedia).
        // Inside Of Me: 1998-release, geen UT50-notering, wel de begin-klassieker
        // (DATA-CAPTURE.md). Beslissing Lester 7/7: 12s op 1996 was te lang; La Vache
        // 12→7 + Inside Of Me 5 = zelfde era-duur, de HUD springt na 7s naar 1998.
        // Geen strip-banner meer (beslissing Lester 7/7: te veel info in het begin);
        // het Frankrijk-feit blijft in DATA-CAPTURE. Het spark-motief blijft.
        { n: 'LA VACHE', y: 1996, d: 7, m: 'spark' },
        { n: 'INSIDE OF ME', y: 1998, d: 5 } ] },
      { id: 'in-my-eyes', density: 0.60, speed: 33, backdrop: 'club', songs: [
        { n: 'IN MY EYES',        y: 1999, d: 4 },
        { n: 'PROMISE',           y: 1999, d: 2 },
        { n: 'OCEANS',            y: 1999, d: 2 },
        { n: 'LOSING LOVE',       y: 1999, d: 3 } ] },
      { id: 'walk',       density: 0.65, speed: 35, backdrop: 'water', songs: [
        { n: 'WALK ON WATER',     y: 2000, d: 7, b: 'EERSTE #1', m: 'bubble' },
        { n: 'LAND OF THE LIVING', y: 2000, d: 3 },
        { n: "LIVIN' A LIE",      y: 2001, d: 2 },
        { n: 'NEVER AGAIN',       y: 2001, d: 2 },
        { n: 'WIDE AWAKE',        y: 2001, d: 3 },
        { n: 'SLEEPWALKER',       y: 2002, d: 2 },
        { n: 'BREATHE WITHOUT YOU', y: 2002, d: 2 },
        { n: 'TIME',              y: 2003, d: 2 },
        { n: 'THE SUN ALWAYS SHINES ON TV', y: 2003, d: 2 } ] },
      { id: 'whisper',    density: 0.75, speed: 37, backdrop: 'arena', songs: [
        // Supersized-compensatie (beslissing Lester 7/7): de 4s van het nieuwe
        // moment komen UIT deze era zelf (I Don't Care/Whisper/Go To Hell/Sunrise
        // elk -1s), zodat de era-duur 28s blijft en elke era-overgang op exact
        // dezelfde soundtrack-seconde valt als vóór de toevoeging (run = 148s).
        { n: "I DON'T CARE",      y: 2004, d: 2 },
        { n: 'WHISPER',           y: 2004, d: 6, b: 'WHISPER · #1', m: 'spark' },
        { n: 'BLIND',             y: 2005, d: 2 },
        { n: 'GO TO HELL',        y: 2005, d: 4, m: 'flames' },
        { n: 'TAINTED LOVE',      y: 2006, d: 2 },
        { n: 'RUN',               y: 2006, d: 2 },
        { n: 'NO ANGEL',          y: 2006, d: 2 },
        // Milk Inc. Supersized, 30/09/2006: de allereerste eigen Sportpaleis-show
        // (10 jaar Milk Inc.). Bron: Wikipedia (NL: naam Supersized; EN: datum
        // 30 sept 2006), gecheckt 7/7. Geen single, dus geen chartclaim in de banner.
        { n: 'SUPERSIZED',        y: 2006, d: 4, b: 'EERSTE KEER SPORTPALEIS' },
        { n: 'SUNRISE',           y: 2007, d: 2 },
        { n: 'TONIGHT',           y: 2007, d: 2 } ] },
      { id: 'blackout',   density: 0.80, speed: 39, backdrop: 'blackout', songs: [
        { n: 'FOREVER',           y: 2008, d: 5, m: 'hearts' },
        { n: 'RACE',              y: 2008, d: 2 },
        // pulse NU per-song: de zwart-flits hoort enkel bij BLACKOUT zelf (niet
        // Forever/Race). Langer + moeilijker + grijpbare ster-bonussen.
        { n: 'BLACKOUT',          y: 2009, d: 10, b: 'BLACKOUT · #1', pulse: true, bonus: true } ] },
      { id: 'storm',      density: 0.85, speed: 41, backdrop: 'storm', fx: 'drift', songs: [
        // Storm: wel een UT50-#1 (zie DATA-CAPTURE), maar bewust GEEN strip-banner
        // (beslissing Lester 7/7: voelde in de praktijk niet als een grote hit).
        { n: 'STORM',             y: 2010, d: 6 },
        { n: 'CHASING THE WIND',  y: 2010, d: 2 },
        { n: 'FIRE',              y: 2011, d: 4, m: 'flames' },
        { n: 'SHADOW',            y: 2011, d: 2 },
        { n: "I'LL BE THERE",     y: 2011, d: 2 },
        { n: 'MIRACLE',           y: 2012, d: 2 },
        { n: 'LAST NIGHT A DJ',   y: 2013, d: 3 },
        { n: "SWEET CHILD O' MINE", y: 2013, d: 2 },
        { n: 'IMAGINATION',       y: 2013, d: 3 } ] },
      { id: 'stilte',     density: 0,    speed: 22, backdrop: 'stilte', fx: 'stilte', duck: true, songs: [
        // yTo (beslissing Lester 7/7): de HUD-jaren tellen tijdens de stilte door
        // van 2014 naar 2023 (een tik per ~0,67s), zodat de stille jaren zichtbaar
        // passeren tot The Return. game.js interpoleert in currentYear().
        { n: "DON'T SAY GOODBYE", y: 2014, d: 6, yTo: 2023 } ] },
      // Vanaf de comeback versnelt de run (na de trage stilte-era): tegen de sleur.
      { id: 'return',     density: 0.60, speed: 44, backdrop: 'arena', comeback: true, songs: [
        { n: 'THE RETURN',        y: 2023, d: 6, b: 'THE RETURN', hero: true } ] },
      { id: 'unstoppable', density: 0.65, speed: 48, backdrop: 'finale', fx: 'pills', songs: [
        { n: 'UNSTOPPABLE',       y: 2025, d: 6 } ] },
      { id: 'medicine',   density: 0.60, speed: 52, backdrop: 'finale', fx: 'pills', songs: [
        // Finale = de prestatie: Medicine, voor het eerst genomineerd voor de
        // Zomerhit. Twee banner-beats (duidelijk over Medicine) + grijpbare
        // ster-bonussen (de "fan-bonus" op het einde). Feitcheck 2/7: "eerste"
        // verdedigbaar, "ooit" niet 100% (geen publieke nominatielijst < 2016).
        { n: 'MEDICINE',          y: 2026, d: 6, b: 'MEDICINE · GENOMINEERD', bonus: true, m: 'spark', hero: true },
        { n: 'MEDICINE',          y: 2026, d: 5, b: 'VOOR HET EERST IN DE ZOMERHIT', bonus: true, m: 'hearts', hero: true } ] }
    ],
    draw(g, era, t, p) { BACKDROPS[era.backdrop](g, t, p); },
    total() { return this.list.reduce((s, e) => s + e.dur, 0); }
  };
  // era.dur = som van de song-schermtijden: één timeline-klok voor de hele run.
  ERAS.list.forEach(e => { e.dur = e.songs.reduce((s, x) => s + x.d, 0); });
  window.MILKRUN_ERAS = ERAS;
})();
