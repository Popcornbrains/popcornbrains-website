// MILK RUN — funnel: splash → inschrijfstap → game → eindscherm → stem-CTA.
// Inschrijving POST naar het Apps Script-endpoint (backend/RUNBOOK.md).
// Zonder endpoint: demo-modus, maar ALLEEN op lokale hosts; op een publieke
// host faalt inschrijven dan luid (geen stille dataverdwijning).
// Entries gaan eerst in een outbox (localStorage) en worden pas geschrapt als
// de POST vertrokken is; bij het laden proberen we de outbox opnieuw.

(function () {
  const CFG = window.MILKRUN_CONFIG;
  const AUD = window.MILKRUN_AUDIO;
  const STORE = window.MILKRUN_STORE;
  const $ = id => document.getElementById(id);

  const LOCAL = /^(localhost|127\.|192\.168\.|10\.|100\.)/.test(location.hostname);

  // Instagram/Facebook in-app browsers (en generieke Android WebView): daar is
  // navigator.share (zeker met files) afwezig of onbetrouwbaar. De score-kaart-
  // viewer + kopieer-link is er het HOOFDpad, geen fallback (fix 3/7).
  const WEBVIEW = /instagram|fbav|fban|fb_iab|line\/|; wv\)/i.test(navigator.userAgent || '');

  let lastRes = null;   // laatste eindresultaat (voor de deel-kaart)
  let challenge = 0;    // uitdaging-score uit ?beat= (0 = geen uitdaging)

  const screens = { splash: $('screen-splash'), signup: $('screen-signup'), end: $('screen-end') };
  function show(name) {
    for (const k in screens) screens[k].hidden = (k !== name);
    if (!name) for (const k in screens) screens[k].hidden = true;
  }

  // ---- wedstrijdvenster (reglement §3) --------------------------------------
  function contestState(now) {
    const t = (now || new Date()).getTime();
    if (t < new Date(CFG.ROUND_START).getTime()) return 'voor';
    if (t > new Date(CFG.FINALE).getTime()) return 'na';
    return 'open';
  }

  // ---- backend --------------------------------------------------------------
  function post(payload) {
    const body = new URLSearchParams(payload).toString();
    return fetch(CFG.ENDPOINT, {
      method: 'POST', mode: 'no-cors', keepalive: true,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
  }

  function outbox() { return JSON.parse(STORE.get('milkrun_outbox') || '[]'); }
  function setOutbox(rows) { STORE.set('milkrun_outbox', JSON.stringify(rows)); }

  function flushOutbox() {
    if (!CFG.ENDPOINT) return;
    const rows = outbox();
    if (!rows.length) return;
    setOutbox([]);
    rows.forEach(row => {
      post(row).catch(() => setOutbox(outbox().concat([row])));
    });
  }

  function send(payload) {
    payload.week = CFG.votingRound(new Date());
    if (!CFG.ENDPOINT) {
      if (LOCAL) { // demo-modus voor lokale tests
        const rows = JSON.parse(STORE.get('milkrun_demo_rows') || '[]');
        rows.push(Object.assign({ at: new Date().toISOString() }, payload));
        STORE.set('milkrun_demo_rows', JSON.stringify(rows));
        return Promise.resolve();
      }
      return payload.type === 'entry' ? Promise.reject(new Error('geen endpoint')) : Promise.resolve();
    }
    if (payload.type === 'entry') {
      // outbox-first: bij netwerkfalen blijft de rij staan en proberen we later
      setOutbox(outbox().concat([payload]));
      return post(payload).then(() => {
        setOutbox(outbox().filter(r => JSON.stringify(r) !== JSON.stringify(payload)));
      }).catch(() => {});
    }
    return post(payload).catch(() => {});
  }
  const ping = type => send({ type });

  // ---- inschrijfstap -------------------------------------------------------
  const form = $('signup-form');
  const status = () => STORE.get('milkrun_signup') || '';

  function handleSignup(f, doneEl) {
    const firstname = f.querySelector('[name=firstname]').value.trim();
    const lastname = f.querySelector('[name=lastname]').value.trim();
    const email = f.querySelector('[name=email]').value.trim();
    const guess = f.querySelector('[name=guess]').value.trim();
    const kennisEl = f.querySelector('[name=kennis]:checked');
    const kennis = kennisEl ? kennisEl.value : '';
    const rules = f.querySelector('[name=rules]').checked;
    const optinRegoli = f.querySelector('[name=optin_regoli]').checked;
    const optinSony = f.querySelector('[name=optin_sony]').checked;
    const trap = f.querySelector('[name=website]').value; // honeypot
    const err = f.querySelector('.form-error');
    err.textContent = '';
    if (trap) return true; // bot: doe alsof alles OK is
    const state = contestState();
    if (state === 'voor') { err.textContent = 'DE WEDSTRIJD START OP MA 6 JULI OM 12:00.'; return false; }
    if (state === 'na') { err.textContent = 'DE WEDSTRIJD IS AFGELOPEN.'; return false; }
    if (!firstname || !lastname) { err.textContent = 'VUL JE VOOR- EN ACHTERNAAM IN.'; return false; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = 'VUL EEN GELDIG E-MAILADRES IN.'; return false; }
    if (!/^\d{1,9}$/.test(guess)) { err.textContent = 'DE SCHIFTINGSVRAAG VRAAGT EEN GETAL.'; return false; }
    if (!kennis) { err.textContent = 'BEANTWOORD DE KENNISVRAAG OM MEE TE DINGEN.'; return false; }
    if (kennis !== 'medicine') { err.textContent = 'DAT IS NIET DE NIEUWSTE SINGLE. TIP: JE STEMT ER STRAKS VOOR.'; return false; }
    if (!rules) { err.textContent = 'AKKOORD MET HET REGLEMENT IS NODIG OM MEE TE DINGEN.'; return false; }
    if (!CFG.ENDPOINT && !LOCAL) { err.textContent = 'INSCHRIJVEN KAN EVEN NIET. SPELEN WEL!'; return false; }
    send({
      type: 'entry', firstname, lastname, email, guess, kennis,
      optin_regoli: optinRegoli ? 'ja' : 'nee',
      optin_sony: optinSony ? 'ja' : 'nee',
      // legacy-veld: houdt een nog-niet-geredeploye backend een opt-in-signaal
      // zodat er in het overgangsvenster geen toestemming verloren gaat
      newsletter: (optinRegoli || optinSony) ? 'ja' : 'nee'
    });
    STORE.set('milkrun_signup', 'done');
    if (doneEl) { doneEl.hidden = false; f.hidden = true; }
    return true;
  }

  // ---- game-koppeling ------------------------------------------------------
  function startGame() {
    // Elke start is een user gesture: ontgrendel/hervat audio hier, zodat ook
    // de EERSTE run (via formulier-submit of skip, zonder PRESS START-unlock in
    // dezelfde gesture) muziek heeft. Fix "muziek start niet bij eerste run".
    AUD.unlock();
    show(null);
    $('share-view').hidden = true;
    ping('play');
    window.MILKRUN_GAME.start();
  }

  function fmtScore(n) { return String(n).padStart(5, '0'); }

  function onEnd(res) {
    lastRes = res;
    ping(res.win ? 'win' : 'over');
    $('end-title').textContent = res.win ? 'U WIN' : 'GAME OVER';
    // ook een verlies is een prestatie (fix 3/7): toon hoe ver je vloog
    $('end-sub').textContent = res.win
      ? 'JE VLOOG 30 JAAR MILK INC. UIT'
      : (res.year >= 2026
          ? 'JE HAALDE 2026 · NET NIET GELAND'
          : res.year > 1996
          ? 'JE VLOOG ' + (res.year - 1996) + ' JAAR VER · TOT ' + res.year
          : 'GESTRAND BIJ DE START · DE KOE WIL NOG EENS');
    $('end-score').textContent = fmtScore(res.score);
    const round = CFG.votingRound(new Date());
    const key = 'milkrun_best_r' + round;
    const best = Math.max(res.score, parseInt(STORE.get(key) || '0', 10));
    STORE.set(key, String(best));
    $('end-best').textContent = 'BESTE DEZE STEMRONDE: ' + fmtScore(best);

    // stem-CTA of ticketfallback zolang de nominatie er niet is
    const cta = $('cta-vote');
    if (CFG.VOTE_URL) {
      cta.href = CFG.VOTE_URL + (CFG.VOTE_URL.indexOf('?') > -1 ? '&' : '?') + CFG.UTM;
      cta.textContent = 'STEM NU OP MEDICINE';
      $('cta-note').textContent = 'VRT ZOMERHIT · ELKE WEEK OPNIEUW STEMMEN';
    } else {
      cta.href = CFG.TICKETS_URL;
      cta.textContent = 'TICKETS FOREVER · 23+24 OKT';
      $('cta-note').textContent = 'STEMMEN OP MEDICINE KAN VANAF MA 6 JULI 12:00';
    }

    // uitdaging (deep-link ?beat=): vier winst of toon het te kloppen doel
    const ch = $('end-challenge');
    if (ch) {
      if (challenge && res.score > challenge) {
        ch.textContent = 'JE KLOPTE DE UITDAGING · ' + fmtScore(challenge);
        ch.hidden = false;
      } else if (challenge) {
        ch.textContent = 'NOG NIET GEKLOPT · DOEL ' + fmtScore(challenge);
        ch.hidden = false;
      } else {
        ch.hidden = true;
      }
    }

    $('second-chance').hidden = status() === 'done' || contestState() !== 'open';
    show('end');
  }

  // ---- events --------------------------------------------------------------
  $('btn-start').addEventListener('click', () => {
    AUD.unlock();
    if (status()) startGame(); else show('signup');
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (handleSignup(form)) startGame();
  });
  $('btn-skip').addEventListener('click', () => {
    STORE.set('milkrun_signup', 'skipped');
    startGame();
  });

  const form2 = $('signup-form-2');
  form2.addEventListener('submit', e => {
    e.preventDefault();
    handleSignup(form2, $('second-done'));
  });

  $('btn-replay').addEventListener('click', () => { AUD.unlock(); startGame(); });
  $('cta-vote').addEventListener('click', () => ping('cta'));

  // Deel-knop: succes alleen claimen als het kopiëren echt lukte.
  const shareBtn = $('btn-share');
  const shareLabel = shareBtn.textContent;
  let shareTimer = null;
  function legacyCopy(text) {
    return new Promise((res, rej) => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? res() : rej(new Error('copy faalde'));
    });
  }
  // Android-webviews HEBBEN navigator.clipboard maar weigeren writeText vaak
  // (NotAllowedError): bij een reject alsnog de execCommand-weg proberen
  // (review r3, bevestigd: anders faalt KOPIEER DE LINK exact in de webviews
  // waarvoor de viewer gebouwd is).
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
  }
  function flashShare(text) {
    clearTimeout(shareTimer);
    shareBtn.textContent = text;
    shareTimer = setTimeout(() => { shareBtn.textContent = shareLabel; }, 1600);
  }
  function resetShare() { clearTimeout(shareTimer); shareBtn.textContent = shareLabel; }

  function shareUrlWith(score) {
    const u = CFG.SHARE_URL || '';
    return u + (u.indexOf('?') > -1 ? '&' : '?') + 'beat=' + score;
  }
  // Vergelijkende share (fix 3/7, de Wordle-les): een vraag lokt een antwoord uit.
  // De stem-CTA staat NIET meer in de tekst, die draagt de deel-kaart al
  // (STEM OP MEDICINE · VRT ZOMERHIT). De tekst is puur brag + uitdaging.
  function shareText(res) {
    const url = shareUrlWith(res.score);
    if (res.win) {
      return 'IK VLOOG 30 JAAR MILK INC. UIT · SCORE ' + fmtScore(res.score) +
        '. KLOP JE MIJ? ' + url;
    }
    if (res.year >= 2026) {
      // verder dan 2026 kan niet: bij een verlies in het eindjaar wordt de
      // score de uitdaging (review r3)
      return 'IK HAALDE 2026 IN MILK RUN · SCORE ' + fmtScore(res.score) +
        '. KLOP JE MIJN SCORE? ' + url;
    }
    if (res.year) {
      return 'IK GERAAKTE TOT ' + res.year + ' IN MILK RUN · SCORE ' + fmtScore(res.score) +
        '. KAN JIJ VERDER? ' + url;
    }
    return 'IK VLOOG DOOR 30 JAAR MILK INC. · SCORE ' + fmtScore(res.score) +
      '. KLOP JE MIJ? ' + url;
  }
  // share_ok telt maximaal ÉÉN keer per share_tap (review r3: anders kan de
  // kopieerknop de conversieratio boven 100% duwen).
  let shareOkSent = false;
  function shareOk() {
    if (shareOkSent) return;
    shareOkSent = true;
    ping('share_ok');
  }

  function textShare(text) {
    if (navigator.share && !WEBVIEW) {
      navigator.share({ text }).then(() => { shareOk(); resetShare(); }).catch(resetShare);
      return;
    }
    copyText(text).then(
      () => { shareOk(); flashShare('GEKOPIEERD!'); },
      () => flashShare('KOPIËREN LUKTE NIET')
    );
  }
  function downloadCard(out, text) {
    if (out && out.blob && window.URL && URL.createObjectURL) {
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(out.blob);
        a.download = 'milk-run-score.png';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        copyText(text).catch(() => {});
        flashShare('KAART OPGESLAGEN');
        shareOk();
        return;
      } catch (e) {}
    }
    textShare(text);
  }

  shareBtn.addEventListener('click', () => {
    ping('share_tap'); // taps en voltooide shares apart meten (fix 3/7)
    shareOkSent = false;
    const res = lastRes || {
      win: $('end-title').textContent === 'U WIN',
      score: parseInt($('end-score').textContent, 10) || 0,
      year: 0
    };
    const text = shareText(res);
    // 1) probeer een ÉCHTE afbeelding te delen (score-card) — dat is wat mensen delen
    if (window.MILKRUN_SHARECARD && (WEBVIEW || navigator.canShare)) {
      flashShare('KAART MAKEN...');
      window.MILKRUN_SHARECARD.build(res).then(out => {
        if (WEBVIEW) { openCardViewer(out, text); return; } // in-app browser: viewer is het hoofdpad
        if (out.file && navigator.canShare({ files: [out.file] })) {
          navigator.share({ files: [out.file], text, title: 'MILK RUN' })
            .then(() => { shareOk(); resetShare(); }).catch(resetShare);
        } else if (navigator.share) {
          navigator.share({ text }).then(() => { shareOk(); resetShare(); })
            .catch(err => {
              // annuleren is geen falen: geen download, geen share_ok (review r3)
              if (err && err.name === 'AbortError') { resetShare(); return; }
              downloadCard(out, text);
            });
        } else {
          downloadCard(out, text);
        }
      }).catch(() => textShare(text));
    } else {
      textShare(text);
    }
  });

  // ---- score-kaart-viewer (webview-hoofdpad): tonen, link kopiëren, sluiten ----
  const shareView = $('share-view'), shareImg = $('share-img');
  const copyBtn = $('btn-copylink');
  const copyLabel = copyBtn.textContent;
  let copyTimer = null, shareImgUrl = null;
  function flashCopy(t) {
    clearTimeout(copyTimer);
    copyBtn.textContent = t;
    copyTimer = setTimeout(() => { copyBtn.textContent = copyLabel; }, 1600);
  }
  function openCardViewer(out, text) {
    resetShare();
    try {
      if (shareImgUrl) { URL.revokeObjectURL(shareImgUrl); shareImgUrl = null; }
      if (out && out.blob && window.URL && URL.createObjectURL) {
        shareImgUrl = URL.createObjectURL(out.blob);
        shareImg.src = shareImgUrl;
      } else if (out && out.canvas) {
        shareImg.src = out.canvas.toDataURL('image/png');
      } else { textShare(text); return; }
      shareView.hidden = false;
    } catch (e) { textShare(text); }
  }
  $('btn-shareclose').addEventListener('click', () => { shareView.hidden = true; });
  copyBtn.addEventListener('click', () => {
    const res = lastRes || {
      win: $('end-title').textContent === 'U WIN',
      score: parseInt($('end-score').textContent, 10) || 0,
      year: 0
    };
    copyText(shareText(res)).then(
      () => { shareOk(); flashCopy('GEKOPIEERD!'); },
      () => flashCopy('KOPIËREN LUKTE NIET')
    );
  });

  const mute = $('btn-mute');
  function muteLabel() { mute.textContent = AUD.isMuted() ? 'GELUID: UIT' : 'GELUID: AAN'; }
  mute.addEventListener('click', () => { AUD.setMuted(!AUD.isMuted()); muteLabel(); });
  muteLabel();

  // ---- init ----------------------------------------------------------------
  window.MILKRUN_GAME.init({
    stage: $('stage'),
    canvas: $('game'),
    hud: {
      year: $('hud-year'), label: $('hud-label'),
      score: $('hud-score'), meter: $('hud-meter'), banner: $('banner'),
      strip: $('strip'), tutor: $('tutor')
    },
    onEnd
  });
  // Uitdaging via ?beat=score: toon het op de splash (fix 2/7 punt 4).
  (function initChallenge() {
    const m = /[?&]beat=(\d{1,7})/.exec(location.search);
    if (!m) return;
    challenge = parseInt(m[1], 10) || 0;
    const el = $('challenge');
    if (challenge && el) { el.textContent = 'JE BENT UITGEDAAGD · KLOP ' + fmtScore(challenge); el.hidden = false; }
  })();
  flushOutbox();
  show('splash');
})();
