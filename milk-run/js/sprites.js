// MILK RUN — pixel-art als data. Monochroom: W=wit, K=ink, G=midgrijs,
// L=lichtgrijs, punt=transparant. Alles wordt 1 cel = 1 interne pixel.

(function () {
  const PAL = { W: '#ffffff', K: '#232321', G: '#6e6e6a', L: '#b8b8b2' };

  // De La Vache-koe met jetpack, vliegend naar rechts. 20x12.
  const COW = [
    '....................',
    '..........WW..WW....',
    '.....GG..WWWWWWWW...',
    '....GLLG.WWKWWWWW...',
    '....GLLG.WWWWWWKK...',
    '....GLLG.WWWWWWWW...',
    '.....GG.WWWKKWWWW...',
    '........WWWKKWWWW...',
    '........WWWWWWWW....',
    '.........WW...WW....',
    '.........KW...KW....',
    '....................'
  ];

  const PILL = [
    '.WWWKK.',
    'WWWWKKK',
    'WWWWKKK',
    '.WWWKK.'
  ];

  const NOTE = [
    '...WW.',
    '...WWW',
    '...W..',
    '...W..',
    '...W..',
    '..WW..',
    '.WWW..',
    '.WW...'
  ];

  const STAR = [
    '..W..',
    '.WWW.',
    'WWWWW',
    '.WWW.',
    '..W..'
  ];

  // Motief-sprites (fix 2/7 punt 3): hartjes bij Forever, vlammetjes bij Go To
  // Hell / Fire. Monochroom, in de 4 brand-tinten.
  const HEART = [
    '.W.W.',
    'WWWWW',
    'WWWWW',
    '.WWW.',
    '..W..'
  ];

  const FLAME = [
    '..W..',
    '.WLW.',
    'WLWLW',
    'WLLLW',
    '.WGW.'
  ];

  function render(art) {
    const w = art[0].length, h = art.length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = art[y][x];
        if (PAL[ch]) { g.fillStyle = PAL[ch]; g.fillRect(x, y, 1, 1); }
      }
    }
    return c;
  }

  window.MILKRUN_SPRITES = {
    cow: render(COW),
    pill: render(PILL),
    note: render(NOTE),
    star: render(STAR),
    heart: render(HEART),
    flame: render(FLAME),
    PAL
  };
})();
