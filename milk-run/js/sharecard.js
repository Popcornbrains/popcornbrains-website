// MILK RUN — deelbare score-card (fix 2/7 punt 4). Rendert het eindresultaat als
// een branded, monochrome AFBEELDING die mensen echt delen (story/WhatsApp), met
// een uitdaag-hook. Vanilla canvas, geen dependencies. Space Mono = de game-font.

(function () {
  const CFG = window.MILKRUN_CONFIG;
  const SPR = window.MILKRUN_SPRITES;
  const WIDTH = 1080, HEIGHT = 1350; // 4:5, past op story én WhatsApp-preview
  const F = 'Space Mono';

  // De font moet geladen zijn vóór we op canvas tekenen (anders valt Safari terug
  // op een systeemfont). Faalt zacht: dan tekenen we met de fallback-monospace.
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all([
      document.fonts.load('700 132px "' + F + '"'),
      document.fonts.load('400 40px "' + F + '"')
    ]).then(() => document.fonts.ready).catch(() => {});
  }

  // Canvas heeft geen betrouwbare letter-spacing overal: zelf uitspreiden, gecentreerd.
  function spaced(g, str, cx, y, ls) {
    const prev = g.textAlign;
    g.textAlign = 'left';
    const widths = [];
    let total = 0;
    for (let i = 0; i < str.length; i++) { const w = g.measureText(str[i]).width + ls; widths.push(w); total += w; }
    total -= ls;
    let x = cx - total / 2;
    for (let i = 0; i < str.length; i++) { g.fillText(str[i], x, y); x += widths[i]; }
    g.textAlign = prev;
  }

  function hostFromUrl(u) {
    try { return new URL(u).host.toUpperCase(); } catch (e) { return 'POPCORNBRAINS.COM'; }
  }

  function draw(res) {
    const c = document.createElement('canvas');
    c.width = WIDTH; c.height = HEIGHT;
    const g = c.getContext('2d');
    const CX = WIDTH / 2;

    // achtergrond + wit kader (zoals de desktop-stage)
    g.fillStyle = '#000000'; g.fillRect(0, 0, WIDTH, HEIGHT);
    g.strokeStyle = '#ffffff'; g.lineWidth = 6;
    g.strokeRect(40, 40, WIDTH - 80, HEIGHT - 80);

    // CRT-scanlines voor textuur (subtiel)
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 46; y < HEIGHT - 46; y += 6) g.fillRect(46, y, WIDTH - 92, 2);

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';

    // eyebrow
    g.fillStyle = '#b8b8b2';
    g.font = '400 34px "' + F + '"';
    spaced(g, '1996 → 2026 · 30 JAAR MILK INC.', CX, 168, 6);

    // titel
    g.fillStyle = '#ffffff';
    g.font = '700 132px "' + F + '"';
    g.fillText('MILK RUN', CX, 300);

    // koe-sprite groot en pixel-crisp
    g.imageSmoothingEnabled = false;
    const sc = 16, cw = SPR.cow.width * sc, chh = SPR.cow.height * sc;
    g.drawImage(SPR.cow, Math.round(CX - cw / 2), 360, cw, chh);

    // resultaat
    g.fillStyle = '#ffffff';
    g.font = '700 96px "' + F + '"';
    g.fillText(res.win ? 'U WIN' : 'GAME OVER', CX, 690);
    g.fillStyle = '#b8b8b2';
    g.font = '400 40px "' + F + '"';
    spaced(g, res.win ? 'IK VLOOG 30 JAAR MILK INC. UIT'
      : (res.year ? 'IK GERAAKTE TOT ' + res.year : 'IK VLOOG DOOR 30 JAAR MILK INC.'), CX, 752, 3);

    // era-voortgang 1996 → 2026 (fix 3/7): de vergelijkende uitdaging in beeld.
    // Verlies capt op 0.96: een GAME OVER-kaart mag nooit een volle (winst)balk tonen.
    const frac = res.win ? 1 : Math.max(0, Math.min(0.96, ((res.year || 1996) - 1996) / 30));
    const bx = 240, bw = 600, by = 786, bh = 20;
    g.strokeStyle = '#6e6e6a'; g.lineWidth = 3;
    g.strokeRect(bx, by, bw, bh);
    if (frac > 0) { g.fillStyle = '#ffffff'; g.fillRect(bx + 4, by + 4, Math.round((bw - 8) * frac), bh - 8); }
    g.fillStyle = '#6e6e6a';
    g.font = '400 26px "' + F + '"';
    g.textAlign = 'left'; g.fillText('1996', bx, by + bh + 30);
    g.textAlign = 'right'; g.fillText('2026', bx + bw, by + bh + 30);
    g.textAlign = 'center';

    // score
    g.fillStyle = '#6e6e6a';
    g.font = '400 36px "' + F + '"';
    spaced(g, 'SCORE', CX, 872, 10);
    g.fillStyle = '#ffffff';
    g.font = '700 200px "' + F + '"';
    g.fillText(String(res.score).padStart(5, '0'), CX, 1052);

    // uitdaging: vergelijkend, een vraag lokt een antwoord uit (fix 3/7).
    // Bij verlies in het eindjaar 2026 is "verder" onmogelijk → score-variant (review r3).
    g.fillStyle = '#ffffff';
    g.font = '700 46px "' + F + '"';
    spaced(g, (res.win || !res.year || res.year >= 2026)
      ? 'KLOP MIJN SCORE' : 'KAN JIJ VERDER DAN ' + res.year + '?', CX, 1156, 4);

    // footer
    g.fillStyle = '#b8b8b2';
    g.font = '400 34px "' + F + '"';
    spaced(g, 'STEM OP MEDICINE · VRT ZOMERHIT', CX, 1226, 3);
    g.fillStyle = '#6e6e6a';
    g.font = '400 32px "' + F + '"';
    spaced(g, (CFG.SHARE_CARD_HOST || hostFromUrl(CFG.SHARE_URL)).toUpperCase(), CX, 1282, 3);

    return c;
  }

  function toBlob(canvas) {
    return new Promise(res => {
      try { canvas.toBlob ? canvas.toBlob(b => res(b), 'image/png') : res(null); }
      catch (e) { res(null); }
    });
  }

  window.MILKRUN_SHARECARD = {
    // Rendert de kaart en levert { canvas, blob, file } (blob/file kunnen null zijn).
    build(res) {
      return fontsReady().then(() => {
        const canvas = draw(res);
        return toBlob(canvas).then(blob => {
          let file = null;
          if (blob && window.File) {
            try { file = new File([blob], 'milk-run-score.png', { type: 'image/png' }); } catch (e) { file = null; }
          }
          return { canvas, blob, file };
        });
      });
    }
  };
})();
