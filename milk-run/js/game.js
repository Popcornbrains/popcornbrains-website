// MILK RUN — engine. Interne resolutie 180x320 (chunky pixels), fixed
// timestep 60Hz, één input: HOLD = stijgen, RELEASE = dalen.
// Fouten kosten Medicine-meter (geen insta-dood); meter leeg = GAME OVER
// met het jaar waarin je strandde. De tijdlijn zelf komt uit eras.js.

(function () {
  const W = 180, H = 320;
  const ERAS = window.MILKRUN_ERAS;
  const SPR = window.MILKRUN_SPRITES;
  const AUD = window.MILKRUN_AUDIO;
  const CFG = window.MILKRUN_CONFIG;
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const K = '#232321', G = '#6e6e6a', L = '#b8b8b2', WH = '#ffffff';

  let canvas, g, hud, onEnd;
  let raf = null, last = 0, acc = 0;
  const DT = 1 / 60;
  const WARMUP = 4; // korte opwarmronde zonder poorten; 10 s voelde saai (Lester-test 2/7 avond)

  const S = {}; // volledige runstate, gereset in start()

  function reset() {
    S.mode = 'play';           // play | stilte | landing | done
    S.holding = false;
    S.t = 0;                   // totale runtijd
    S.eraIdx = 0; S.eraT = 0; S.songIdx = 0; S.songT = 0;
    S.cowY = 150; S.vy = 0;
    S.meter = 100; S.score = 0;
    S.invuln = 0; S.shake = 0; S.flash = 0;
    S.obstacles = []; S.pickups = [];
    S.spawnT = 1.6; S.gapCenter = 150; S.pillT = 0; S.starT = 0;
    S.bannerT = 0; S.banner = ''; S.strip = '';
    S.motif = ''; S.motes = []; S.moteT = 0;
    S.landing = { x: 200, done: 0 };
    S.strobe = 0;
    S.revived = false; // één tweede kans per run (fix 3/7: completion = de KPI)
    S.revT = 0;        // eigen banner-klok voor TWEEDE KANS (enterSong mag die niet wissen)
    S.tutor = 0;       // 0 = toon HOU VAST, 1 = toon LAAT LOS, 2 = klaar
    enterSong();
  }

  function era() { return ERAS.list[S.eraIdx]; }
  function song() { return era().songs[S.songIdx]; }

  // HUD-jaar én strand-jaar = het releasejaar van de zichtbare song.
  // yTo (stilte-era): de jaren tellen door naar het volgende hoofdstuk, zodat
  // de stille jaren 2014→2023 zichtbaar passeren (beslissing Lester 7/7).
  function currentYear() {
    const s = song();
    if (s.yTo) return s.y + (s.yTo - s.y) * Math.min(1, S.songT / s.d);
    return s.y;
  }

  // Elke song zijn eigen moment: label, jaar, chart-banner en motief.
  // Fix 3/7 (Storm-rapport bevinding 1): chart-feiten leven in de vaste strip
  // onderaan; het midscherm is gereserveerd voor de 3 campagne-momenten
  // (onboarding-cue, THE RETURN, Medicine-finale) via song().hero.
  function enterSong() {
    const e = era(), s = song();
    S.songT = 0;
    S.strip = '';
    if (e.id === 'stilte') {
      S.banner = CFG.SHOW_2014_TRIBUTE ? 'HET WERD STIL' : '';
    } else if (s.hero) {
      S.banner = s.b || '';
      S.strip = s.b || '';
    } else {
      S.banner = '';
      S.strip = s.b || '';
    }
    S.bannerT = S.banner ? 2.4 : 0;
    S.motif = s.m || '';
    S.moteT = 0;
  }

  // ---- update --------------------------------------------------------------
  function update(dt) {
    S.t += dt; S.eraT += dt; S.songT += dt;
    // banner-klokken bovenaan: lopen dan ook af tijdens landing/stilte
    // (review r3: bevroren TWEEDE KANS-banner op het landing-pad)
    S.bannerT = Math.max(0, S.bannerT - dt);
    S.revT = Math.max(0, S.revT - dt);
    const e = era();

    // song-overgang BINNEN de era: elke song krijgt zijn eigen moment
    if (S.songT >= song().d && S.songIdx < e.songs.length - 1) {
      S.songIdx++;
      enterSong();
    }

    // era-overgang
    if (S.eraT >= e.dur) {
      if (S.eraIdx < ERAS.list.length - 1) {
        S.eraIdx++; S.eraT = 0; S.songIdx = 0;
        const ne = era();
        enterSong();
        AUD.setDuck(!!ne.duck);
        if (ne.comeback) S.strobe = REDUCED ? 0.001 : 0.5; // THE RETURN
        if (ne.id === 'stilte') { S.obstacles = []; S.pickups = []; S.shake = 0; S.invuln = 0; }
      } else if (S.mode === 'play') {
        S.mode = 'landing'; S.obstacles = []; S.shake = 0; S.invuln = 0;
      }
    }

    // physics
    const drift = e.fx === 'drift' ? 26 : 0;
    if (S.mode === 'stilte' || e.id === 'stilte') {
      // autopiloot: zachte glide naar het midden, geen input nodig
      S.vy += (170 - S.cowY) * 0.8 * dt - S.vy * 0.9 * dt;
    } else if (S.mode === 'landing') {
      const targetY = ERAS.HORIZON - 22;
      S.vy += (targetY - S.cowY) * 1.6 * dt - S.vy * 1.2 * dt;
      S.landing.x = Math.max(96, S.landing.x - 46 * dt);
      S.landing.done += dt;
      if (S.landing.done > 2.6 && S.mode !== 'done') return finish(true);
    } else {
      S.vy += (S.holding ? -300 : 320) * dt + drift * dt;
    }
    S.vy = Math.max(-120, Math.min(130, S.vy));
    S.cowY += S.vy * dt;
    if (S.cowY < 44) { S.cowY = 44; S.vy = Math.max(0, S.vy); }
    if (S.cowY > 296) { S.cowY = 296; S.vy = Math.min(0, S.vy); }

    if (S.mode === 'landing' || e.id === 'stilte') { tickPickups(e, dt); tickMotes(dt); post(); return; }

    // opwarmronde (fix 3/7): de eerste seconden geen poorten, wel noten om het
    // oppikken te leren; de cue-tekst verdwijnt na de eerste hold+release
    if (S.tutor < 2 && S.t > WARMUP) setTutor('');
    if (S.t < WARMUP) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = 1.15;
        S.pickups.push({ x: W + 10, y: 80 + Math.random() * 160, kind: 'note' });
      }
    } else
    // spawner: poorten met gegarandeerde corridor
    if (e.density > 0) {
      S.spawnT -= dt;
      if (S.spawnT <= 0) {
        S.spawnT = 1.9 / e.density;
        let gap = Math.max(80, 100 - S.eraIdx * 3) + (song().pulse ? 8 : 0);
        // af en toe een krappe poort (beslissing Lester 7/7): vanaf era 2 wordt
        // ~18% van de poorten smaller. Pas NA de leerzone (era 0-1 heeft ook al
        // mildere schade); floor 64 houdt ze haalbaar (koelijf = 9px hoog).
        if (S.eraIdx >= 2 && Math.random() < 0.18) gap = Math.max(64, Math.round(gap * 0.78));
        const step = (Math.random() - 0.5) * 84;
        S.gapCenter = Math.max(66, Math.min(250, S.gapCenter + step));
        S.obstacles.push({ x: W + 14, gapY: S.gapCenter, gap, w: 12, scored: false });
        // pickups IN de corridor: het veilige pad beloont
        const n = 1 + (Math.random() < 0.4 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          S.pickups.push({
            x: W + 40 + i * 22,
            y: S.gapCenter + (Math.random() - 0.5) * gap * 0.4,
            kind: Math.random() < 0.45 ? 'pill' : 'note'
          });
        }
      }
    }
    if (e.fx === 'pills') { // finale: pillenregen, alleen maar feest
      S.pillT -= dt;
      if (S.pillT <= 0) {
        S.pillT = 0.5;
        S.pickups.push({ x: W + 10, y: 30 + Math.random() * 240, kind: 'pill', fall: 26 });
      }
    }
    if (song().bonus) { // grijpbare ster-bonussen (blackout + medicine-finale): +100 elk
      S.starT -= dt;
      if (S.starT <= 0) {
        S.starT = 1.1;
        S.pickups.push({ x: W + 12, y: 40 + Math.random() * 210, kind: 'star' });
      }
    }

    // beweging + botsing (hitbox = het witte koelijf, jetpack blijft vrij)
    const v = e.speed;
    const cowBox = { x: 32, y: S.cowY - 4, w: 10, h: 9 };
    for (const o of S.obstacles) {
      o.x -= v * dt;
      if (!o.scored && o.x + o.w < cowBox.x) { o.scored = true; S.score += 15; }
      if (S.invuln <= 0 && cowBox.x < o.x + o.w && cowBox.x + cowBox.w > o.x) {
        const top = o.gapY - o.gap / 2, bot = o.gapY + o.gap / 2;
        if (cowBox.y < top || cowBox.y + cowBox.h > bot) {
          // mildere schade in de eerste era's (fix 3/7): casuals moeten het
          // einde halen, de speed-ramp op het eind blijft de uitdaging
          S.meter -= (S.eraIdx < 2 ? 12 : 18); S.invuln = 1.2;
          if (!REDUCED) S.shake = 0.3;
          AUD.sfx.hit();
          if (S.meter <= 0) {
            if (!S.revived) {
              // één tweede kans per run: halve meter terug, korte adempauze.
              // Eigen klok (revT), zodat enterSong() de melding niet wegveegt.
              S.revived = true;
              S.meter = 50; S.invuln = 2.2;
              S.revT = 1.6;
              AUD.sfx.pickup();
            } else return finish(false);
          }
        }
      }
    }
    S.obstacles = S.obstacles.filter(o => o.x > -20);
    tickPickups(e, dt, v, cowBox);

    // passieve score laag: pickups (noot 30 / pill 60 / ster 100) drijven de score
    // en dus de variatie tussen goed en zwak spelen. Overleven zelf = +15/poort.
    S.score += 2 * dt;
    S.invuln = Math.max(0, S.invuln - dt);
    S.shake = Math.max(0, S.shake - dt);
    S.strobe = Math.max(0, S.strobe - dt);
    tickMotes(dt);
    post();
  }

  function tickPickups(e, dt, v, cowBox) {
    const speed = v || e.speed;
    for (const p of S.pickups) {
      p.x -= speed * dt;
      if (p.fall) p.y += p.fall * dt;
      if (cowBox && !p.hit &&
          p.x > cowBox.x - 6 && p.x < cowBox.x + cowBox.w + 8 &&
          p.y > cowBox.y - 7 && p.y < cowBox.y + cowBox.h + 5) {
        p.hit = true;
        if (p.kind === 'pill') { S.meter = Math.min(100, S.meter + 12); S.score += 60; }
        else if (p.kind === 'star') { S.score += 100; } // ster-bonus
        else S.score += 30; // muzieknoot
        AUD.sfx.pickup();
      }
    }
    S.pickups = S.pickups.filter(p => !p.hit && p.x > -12 && p.y < H + 10);
  }

  // ---- decoratieve motieven (fix 2/7 punt 3): puur visueel, geen gameplay ----
  function spawnMote(kind) {
    let m;
    if (kind === 'flames') {
      m = { x: 10 + Math.random() * (W - 20), y: H - 4, vx: (Math.random() - 0.5) * 10, vy: -42 - Math.random() * 30, shape: 'flame', ttl: 1.5 };
    } else if (kind === 'hearts') {
      m = { x: 12 + Math.random() * (W - 24), y: H - 8, vx: (Math.random() - 0.5) * 8, vy: -26 - Math.random() * 14, shape: 'heart', ttl: 2.3 };
    } else if (kind === 'bubble') {
      m = { x: 8 + Math.random() * (W - 16), y: H - 4, vx: (Math.random() - 0.5) * 6, vy: -30 - Math.random() * 22, shape: 'bubble', ttl: 1.8 };
    } else { // spark: twinkelt rustig in de lucht
      m = { x: 8 + Math.random() * (W - 16), y: 28 + Math.random() * 190, vx: 0, vy: -5, shape: 'spark', ttl: 1.0 };
    }
    m.life = 0; m.ph = Math.random() * 6;
    S.motes.push(m);
  }

  function tickMotes(dt) {
    S.moteT -= dt;
    if (S.motif && S.moteT <= 0 && era().id !== 'stilte' && S.motes.length < 26) {
      spawnMote(S.motif);
      S.moteT = REDUCED ? 0.6 : (S.motif === 'hearts' ? 0.5 : 0.28);
    }
    for (const m of S.motes) {
      m.x += m.vx * dt; m.y += m.vy * dt;
      m.vx += Math.sin((m.life + m.ph) * 3) * 8 * dt; // zachte sway
      m.life += dt;
    }
    S.motes = S.motes.filter(m => m.life < m.ttl && m.y > -12 && m.x > -14 && m.x < W + 14);
  }

  function finish(win) {
    S.mode = 'done';
    setTutor('');
    if (hud.strip) { hud.strip.hidden = true; lastStrip = null; }
    hud.banner.hidden = true;
    cancelAnimationFrame(raf); raf = null;
    AUD.stopAll();
    if (win) AUD.sfx.win(); else AUD.sfx.gameover();
    const year = Math.floor(currentYear());
    onEnd({ win, score: Math.floor(S.score), year });
  }

  // ---- render --------------------------------------------------------------
  function render() {
    g.save();
    if (S.shake > 0) g.translate((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    g.fillStyle = '#000000'; g.fillRect(-4, -4, W + 8, H + 8);

    const e = era();
    const p = Math.min(1, S.eraT / e.dur);
    ERAS.draw(g, e, S.t, p);

    // decoratieve motieven (achter de poorten, laag alpha, per song)
    for (const m of S.motes) {
      const fade = Math.max(0, 1 - m.life / m.ttl);
      if (fade <= 0.02) continue;
      g.save();
      g.globalAlpha = 0.6 * fade;
      const mx = Math.round(m.x), my = Math.round(m.y);
      if (m.shape === 'heart') g.drawImage(SPR.heart, mx, my);
      else if (m.shape === 'flame') g.drawImage(SPR.flame, mx, my);
      else if (m.shape === 'bubble') {
        g.fillStyle = L;
        g.fillRect(mx, my, 3, 1); g.fillRect(mx, my + 2, 3, 1);
        g.fillRect(mx, my + 1, 1, 1); g.fillRect(mx + 2, my + 1, 1, 1);
      } else { // spark
        g.fillStyle = WH; g.fillRect(mx, my, 1, 1);
        if (Math.floor(m.life * 12) % 2 === 0) {
          g.fillStyle = L;
          g.fillRect(mx - 1, my, 1, 1); g.fillRect(mx + 1, my, 1, 1);
          g.fillRect(mx, my - 1, 1, 1); g.fillRect(mx, my + 1, 1, 1);
        }
      }
      g.restore();
    }

    // poorten
    for (const o of S.obstacles) {
      const top = o.gapY - o.gap / 2, bot = o.gapY + o.gap / 2;
      g.fillStyle = K;
      g.fillRect(o.x, 0, o.w, top);
      g.fillRect(o.x, bot, o.w, H - bot);
      g.fillStyle = G;
      g.fillRect(o.x, top - 3, o.w, 3);
      g.fillRect(o.x, bot, o.w, 3);
      g.fillStyle = L;
      g.fillRect(o.x, top - 1, o.w, 1);
      g.fillRect(o.x, bot, o.w, 1);
    }

    // pickups
    for (const pk of S.pickups) {
      const spr = pk.kind === 'pill' ? SPR.pill : pk.kind === 'star' ? SPR.star : SPR.note;
      g.drawImage(spr, Math.round(pk.x), Math.round(pk.y));
    }

    // landingspodium
    if (S.mode === 'landing') {
      const lx = S.landing.x;
      g.fillStyle = K; g.fillRect(lx, ERAS.HORIZON - 6, W - lx + 10, H);
      g.fillStyle = WH; g.fillRect(lx, ERAS.HORIZON - 8, W - lx + 10, 2);
      g.fillStyle = L; g.fillRect(lx + 6, ERAS.HORIZON - 14, 3, 6);
      g.fillRect(lx + 14, ERAS.HORIZON - 14, 3, 6);
    }

    // koe (knippert bij invuln)
    if (S.invuln <= 0 || Math.floor(S.t * 12) % 2 === 0) {
      g.drawImage(SPR.cow, 24, Math.round(S.cowY - 6));
      if (S.holding && S.mode === 'play' && Math.floor(S.t * 14) % 2 === 0) {
        g.fillStyle = WH; g.fillRect(27, Math.round(S.cowY + 3), 2, 3);
        g.fillStyle = L; g.fillRect(26, Math.round(S.cowY + 6), 2, 2);
      }
    }

    // blackout-puls: ENKEL tijdens de song 'BLACKOUT' (song().pulse), niet de hele
    // era. Sneller (1.8s-cyclus) + langer donker → meer flitsen, moeilijker; de
    // corridors zijn er ook ruimer (gap +8) en er vallen ster-bonussen.
    if (song().pulse) {
      const c = (S.t % 1.8) / 1.8;
      let dim = 0;
      if (c > 0.55) {
        dim = Math.min(1, Math.sin((c - 0.55) / 0.45 * Math.PI) * 1.4);
        if (REDUCED) dim = Math.min(0.6, dim);
      }
      if (dim > 0.02) { g.fillStyle = 'rgba(0,0,0,' + dim.toFixed(2) + ')'; g.fillRect(0, 0, W, H); }
    }
    // comeback-strobe (zacht, en uit bij reduced motion)
    if (S.strobe > 0 && !REDUCED) {
      const a = Math.floor(S.strobe * 10) % 2 === 0 ? 0.5 * S.strobe : 0;
      if (a > 0.02) { g.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; g.fillRect(0, 0, W, H); }
    }
    g.restore();
  }

  // ---- HUD (DOM) ----------------------------------------------------------
  let lastYear = 0, lastScore = -1, lastMeter = -1, lastLabel = null, lastStrip = null;

  // onboarding-cue (fix 3/7): één woordgroep, DOM-overlay, blink via CSS
  function setTutor(txt) {
    if (!hud.tutor) return;
    if (txt) { hud.tutor.textContent = txt; hud.tutor.hidden = false; }
    else { hud.tutor.hidden = true; S.tutor = 2; }
  }

  function post() {
    const y = Math.floor(currentYear());
    if (y !== lastYear) { hud.year.textContent = y; lastYear = y; }
    const sc = Math.floor(S.score);
    if (sc !== lastScore) { hud.score.textContent = String(sc).padStart(5, '0'); lastScore = sc; }
    // levend = altijd minstens 1 blokje zichtbaar
    const m = S.meter > 0 ? Math.min(10, Math.max(1, Math.round(S.meter / 10))) : 0;
    if (m !== lastMeter) {
      hud.meter.textContent = '■'.repeat(m) + '□'.repeat(10 - m);
      lastMeter = m;
    }
    // het label = de song die NU zijn eigen moment krijgt (fix 2/7, geen duo's)
    const label = song().n;
    if (label !== lastLabel) { hud.label.textContent = label; lastLabel = label; }
    if (S.revT > 0) { hud.banner.textContent = 'TWEEDE KANS!'; hud.banner.hidden = false; }
    else if (S.bannerT > 0) { hud.banner.textContent = S.banner; hud.banner.hidden = false; }
    else hud.banner.hidden = true;
    // vaste feiten-strip onderaan: constant, altijd dezelfde plek
    if (hud.strip && S.strip !== lastStrip) {
      hud.strip.textContent = S.strip;
      hud.strip.hidden = !S.strip;
      lastStrip = S.strip;
    }
  }

  // ---- loop + input --------------------------------------------------------
  function frame(ts) {
    if (!last) last = ts;
    acc += Math.min(0.1, (ts - last) / 1000);
    last = ts;
    while (acc >= DT) { update(DT); acc -= DT; if (S.mode === 'done') return; }
    render();
    raf = requestAnimationFrame(frame);
  }

  function hold(on) {
    S.holding = on;
    // tutor-progressie: HOU VAST → (eerste hold) LAAT LOS → (eerste release) weg
    if (on && S.tutor === 0) { S.tutor = 1; setTutor('LAAT LOS ▼'); }
    else if (!on && S.tutor === 1) setTutor('');
  }

  function bindInput() {
    // Op window (ook de letterbox-zones op lange schermen telt mee), maar
    // ALLEEN tijdens het spelen: anders blokkeert preventDefault de focus op
    // de formuliervelden (bevestigde launch-blocker uit de review).
    window.addEventListener('pointerdown', e => {
      if (!raf || S.mode === 'done') return;
      if (e.target.closest && e.target.closest('#btn-mute')) return;
      e.preventDefault();
      hold(true);
    }, { passive: false });
    window.addEventListener('pointerup', () => hold(false));
    window.addEventListener('pointercancel', () => hold(false));
    window.addEventListener('keydown', e => {
      if (!raf) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); hold(true); }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space' || e.code === 'ArrowUp') hold(false);
    });
  }

  window.MILKRUN_GAME = {
    init(opts) {
      canvas = opts.canvas;
      canvas.width = W; canvas.height = H;
      g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      hud = opts.hud; onEnd = opts.onEnd;
      bindInput();
    },
    start() {
      reset();
      setTutor('HOU VAST ▲');
      S.tutor = 0;
      AUD.startSoundtrack();
      AUD.setDuck(false);
      last = 0; acc = 0;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop() { cancelAnimationFrame(raf); raf = null; AUD.stopAll(); }
  };
})();
