// MILK RUN — audiomanager. Eén doorlopende soundtrack: Lesters
// "MEDICINE 8-bit - MILK RUN" (config.SOUNDTRACK), geloopt over de hele run.
// De stilte-era (2014) dimt de muziek (duck); The Return brengt ze terug.
// Valt terug op een neutrale synth-arpeggio als de file niet laadt.
// iOS: AudioContext ontgrendelt pas na een user gesture (unlock()).

(function () {
  const CFG = window.MILKRUN_CONFIG;
  const STORE = window.MILKRUN_STORE;
  let ctx = null;
  let master = null;   // eindvolume (mute)
  let music = null;    // soundtrack-bus (duck)
  let muted = STORE.get('milkrun_muted') === '1';
  let buffer = null, loading = null;
  let src = null, synthStop = null, wantPlaying = false;
  let pendingSpawn = null; // geparkeerde soundtrack-start (wacht op ctx==='running')
  let sessionEl = null; // stille <audio>-loop: laat iOS de ringschakelaar negeren

  function ensureCtx() {
    if (!ctx) {
      // iOS 16.4+: expliciet het playback-kanaal claimen, dan negeert Web Audio
      // de ringschakelaar ook op de speaker (fix 7/7, oortjes-uit-bug). Oudere
      // iOS valt terug op de stille <audio>-loop (startSession).
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.85;
      master.connect(ctx.destination);
      music = ctx.createGain();
      music.gain.value = 1;
      music.connect(master);
      // Zodra iOS de context (async) op 'running' zet, alsnog de geparkeerde
      // soundtrack-start afvuren. Lost de "audio faalt bij eerste play" op.
      ctx.onstatechange = () => { if (ctx.state === 'running') runPending(); };
    }
    return ctx;
  }

  // Voert een geparkeerde soundtrack-start uit (max één keer per parkering).
  function runPending() {
    if (pendingSpawn) { const f = pendingSpawn; pendingSpawn = null; f(); }
  }

  function unlock() {
    if (!ensureCtx()) return;
    // iOS kan 'suspended' OF 'interrupted' zijn (lock/telefoontje); resume kan
    // rejecten zolang de onderbreking loopt, dus altijd met catch. Na een
    // geslaagde resume ook een geparkeerde soundtrack-start afvuren.
    if (ctx.state !== 'running') ctx.resume().then(runPending).catch(() => {});
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(master); s.start(0);
    startSession();
    loadSoundtrack(); // begin alvast te laden tijdens splash/inschrijfstap
  }

  // Onhoorbare, loopende <audio> op het playback-kanaal: hierdoor speelt de
  // game-audio op iOS ook met de ringschakelaar op stil.
  function startSession() {
    if (sessionEl) return;
    try {
      sessionEl = document.createElement('audio');
      sessionEl.loop = true;
      sessionEl.setAttribute('playsinline', '');
      // 0,25 s stilte, WAV, base64 (audible-kanaal, geen muted-vlag).
      // Fix 7/7 (oortjes-uit-bug): dit was 1 sample; zo'n bijna-nul-loop kan op
      // iOS stokken, waardoor de playback-sessie wegvalt en de speaker bij de
      // eerste run gedempt blijft met de ringschakelaar op stil.
      sessionEl.src = 'data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YdAHAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
      sessionEl.volume = 0.01;
      sessionEl.play().catch(() => {});
    } catch (e) { sessionEl = null; }
  }

  // Goedkope zelfheling na achtergrond/lock: overal aanroepbaar. Vuurt ook een
  // eventueel geparkeerde soundtrack-start af (eerste-play-race op iPhone).
  function heal() {
    if (ctx && ctx.state !== 'running') ctx.resume().then(runPending).catch(() => {});
    else runPending();
    if (sessionEl && sessionEl.paused) sessionEl.play().catch(() => {});
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) heal();
  });
  window.addEventListener('pointerdown', heal, { passive: true });

  function loadSoundtrack() {
    if (!CFG.SOUNDTRACK || buffer || loading || !ensureCtx()) return loading;
    loading = fetch(CFG.SOUNDTRACK)
      .then(r => r.arrayBuffer())
      .then(ab => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then(buf => { buffer = buf; return buf; })
      // reset 'loading' bij falen, anders blijft de guard hangen en komt de echte
      // MEDICINE-track na een netwerk-blip nooit meer terug (permanent synth).
      .catch(() => { loading = null; return null; });
    return loading;
  }

  // Neutrale fallback-arpeggio (bewust geen echte riff) als de file faalt.
  function startSynth() {
    if (!ensureCtx()) return () => {};
    const notes = [0, 4, 7, 12, 16, 12, 7, 4];
    const step = 60 / 128 / 2;
    let next = ctx.currentTime + 0.05, i = 0;
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    gain.connect(music);
    const timer = setInterval(() => {
      while (next < ctx.currentTime + 0.2) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = 220 * Math.pow(2, notes[i % notes.length] / 12);
        g.gain.setValueAtTime(0.2, next);
        g.gain.exponentialRampToValueAtTime(0.001, next + step * 0.9);
        o.connect(g); g.connect(gain);
        o.start(next); o.stop(next + step);
        next += step; i++;
      }
    }, 90);
    return () => {
      clearInterval(timer);
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      setTimeout(() => gain.disconnect(), 500);
    };
  }

  // Start de soundtrack ECHT, maar alleen als de context draait. Draait ze nog
  // niet (iOS resumet async na de gesture), dan parkeren we de start en vuren
  // ze af zodra ctx 'running' wordt (onstatechange) of bij de eerste gesture
  // in het spel (heal). Zo faalt de eerste play niet meer op iPhone.
  function spawnFromBuffer(buf, my) {
    if (src !== my || !wantPlaying || my.node) return; // verouderd of al bezig
    if (!buf) { synthStop = startSynth(); return; } // file faalde: neutrale synth
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      pendingSpawn = () => spawnFromBuffer(buf, my);
      return;
    }
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    s.connect(music);
    s.start(0, (CFG.SOUNDTRACK_OFFSET || 0) % buf.duration);
    my.node = s;
  }

  function startSoundtrack() {
    if (!ensureCtx()) return;
    wantPlaying = true;
    stopSources();
    pendingSpawn = null;
    if (ctx.state !== 'running') ctx.resume().then(runPending).catch(() => {});
    music.gain.cancelScheduledValues(ctx.currentTime);
    music.gain.setValueAtTime(1, ctx.currentTime);
    loadSoundtrack();
    const my = {};
    src = my;
    Promise.resolve(loading).then(buf => spawnFromBuffer(buf, my));
  }

  function stopSources() {
    if (synthStop) { synthStop(); synthStop = null; }
    if (src && src.node) { try { src.node.stop(); } catch (e) {} }
    src = null;
  }

  function stopAll() {
    wantPlaying = false;
    pendingSpawn = null;
    if (!ctx) return;
    music.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    setTimeout(() => {
      if (wantPlaying) return; // een nieuwe startSoundtrack nam over: niet afbreken
      stopSources();
      if (music) { music.gain.cancelScheduledValues(ctx.currentTime); music.gain.setValueAtTime(1, ctx.currentTime); }
    }, 600);
  }

  // De 2014-stilte: muziek zakt weg; The Return: zwelt terug aan.
  function setDuck(on) {
    if (!ctx) return;
    music.gain.cancelScheduledValues(ctx.currentTime);
    music.gain.setTargetAtTime(on ? 0.08 : 1, ctx.currentTime, on ? 0.8 : 0.25);
  }

  // ---- sfx -----------------------------------------------------------------
  function blip(freq, dur, type, vol) {
    if (!ensureCtx() || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.25, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur);
  }

  const sfx = {
    pickup: () => { blip(880, 0.08); setTimeout(() => blip(1320, 0.1), 60); },
    hit: () => blip(110, 0.25, 'sawtooth', 0.4),
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.18), i * 120)),
    gameover: () => [392, 330, 262, 196].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.3), i * 150))
  };

  function setMuted(m) {
    muted = m;
    STORE.set('milkrun_muted', m ? '1' : '0');
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.05);
  }

  window.MILKRUN_AUDIO = {
    unlock, startSoundtrack, stopAll, setDuck, sfx, setMuted, heal,
    isMuted: () => muted
  };

  // Voorladen + decoderen al bij het laden: een AudioContext mag SUSPENDED
  // aangemaakt worden zonder gesture (geen geluid), en decodeAudioData werkt
  // daarop. Zo is de buffer klaar vóór de eerste play en start de MEDICINE-track
  // meteen bij de eerste gesture i.p.v. pas na een replay (fix iPhone-eerste-play).
  try { loadSoundtrack(); } catch (e) {}
})();
