// MILK RUN — centrale configuratie.
// Alles wat op ma 6/7 (of later) moet wisselen, wisselt HIER, nergens anders.

window.MILKRUN_CONFIG = {
  // De VRT Zomerhit-stempagina. Op vraag van Lester (2/7) alvast live gezet
  // alsof de stemming loopt; ma 6/7 checken of dit de definitieve link blijft.
  VOTE_URL: 'https://www.vrt.be/interactie/stem/zomerhit/',

  // Google Apps Script web-app URL (backend/RUNBOOK.md). Gekoppeld 7/7/2026:
  // inschrijvingen gaan naar de private Sheet "MILK RUN - inschrijvingen".
  ENDPOINT: 'https://script.google.com/macros/s/AKfycbyaKckaXBJ1leG_FAiK8v0XxB0w03-4h8wqKFaaquwR-EegiwJc0p3s9xssdY02Kv61og/exec',

  // Ticketfallback zolang VOTE_URL leeg is.
  TICKETS_URL: 'https://www.afas-dome.be/nl/evenement/milk-inc-4fceea50',

  // UTM zodat kliks vanuit de game meetbaar zijn aan VRT-zijde.
  UTM: 'utm_source=milkrun&utm_medium=game&utm_campaign=zomerhit2026',

  // Het 2014-eerbetoon ("HET WERD STIL") staat UIT tot Regi & Linda hun zegen
  // geven; de veilige versie is een puur muzikale pauze zonder tekst.
  SHOW_2014_TRIBUTE: false,

  // DE soundtrack: Lesters "MEDICINE 8-bit - MILK RUN", geloopt over de hele
  // run (bron: brand-assets/milk-inc/audio/8bit/medicine-milk-run.mp3).
  // De 2014-stilte dimt ze, The Return brengt ze terug.
  SOUNDTRACK: 'assets/audio/milk-run.m4a',
  SOUNDTRACK_OFFSET: 0,

  // Stemrondes (VRT-reglement 2026): ronde 1 start ma 6/7, eindigt za 11/7
  // 23:58, daarna wekelijks tot de finale za 29/8. Weekly best-score reset.
  ROUND_START: '2026-07-06T12:00:00+02:00',
  ROUND_1_END: '2026-07-11T23:58:00+02:00',
  FINALE: '2026-08-29T20:00:00+02:00',

  SHARE_URL: 'https://popcornbrains.com/milk-run/',

  // Het merk-adres onderaan de deel-kaart. De game LEEFT op popcornbrains.com
  // (de deep-link ?beat= blijft daarheen wijzen), maar de kaart draagt het
  // publieksmerk milkinc.be, dat is waar fans Milk Inc. kennen.
  SHARE_CARD_HOST: 'milkinc.be'
};

// Veilige opslag: Safari met "Blokkeer alle cookies" gooit op localStorage;
// dan vallen we terug op een in-memory object zodat PRESS START blijft werken.
window.MILKRUN_STORE = (function () {
  const mem = {};
  return {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return (k in mem) ? mem[k] : null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  };
})();

window.MILKRUN_CONFIG.votingRound = function (now) {
  const t = (now || new Date()).getTime();
  const start = new Date(this.ROUND_START).getTime();
  if (t < start) return 0; // preview, stemmen nog niet open
  const r1end = new Date(this.ROUND_1_END).getTime();
  if (t <= r1end) return 1;
  const week = 7 * 24 * 3600 * 1000;
  return Math.min(8, 2 + Math.floor((t - r1end) / week));
};
