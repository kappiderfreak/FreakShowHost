/*
 * Instanz-Waechter: Es darf immer nur EINE Overlay-Instanz Ton/Bild ausgeben.
 * Jede geladene index.html registriert sich mit einer eindeutigen ID bei der
 * Bridge (/overlay-instance). Sieht eine Instanz beim Abfragen, dass eine
 * NEUERE Instanz registriert ist, schaltet sie sich selbst komplett stumm:
 * alle Videos/Audios stoppen, Seite leeren, Fenster schliessen (falls erlaubt).
 * Damit ist Doppel-Ton (Echo) durch doppelt gestartete Overlays, Browser-Tabs
 * oder eingebettete Kopien (z. B. in Streamer.bot) technisch unmoeglich.
 * Abschaltbar fuer Tests per URL-Parameter ?instanceGuard=0
 */
(function () {
  'use strict';

  if (/[?&]instanceGuard=0/.test(window.location.search || '')) return;
  if (window.__KAPPI_INSTANCE_GUARD_ACTIVE__) return;
  window.__KAPPI_INSTANCE_GUARD_ACTIVE__ = true;

  var URL_ = location.origin + '/overlay-instance';
  var ID = String(Date.now()) + '-' + Math.floor(Math.random() * 1000000000);
  var registered = false;
  var dead = false;

  function register() {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', URL_, true);
      x.timeout = 1500;
      x.setRequestHeader('Content-Type', 'application/json');
      x.onload = function () { if (x.status >= 200 && x.status < 300) registered = true; };
      x.send(JSON.stringify({ id: ID }));
    } catch (e) {}
  }

  function shutdown() {
    if (dead) return;
    dead = true;
    window.__KAPPI_INSTANCE_DEACTIVATED__ = true;
    try { if (window.console && console.warn) console.warn('[Kappi Instanz-Waechter] Neuere Overlay-Instanz erkannt - diese Instanz wird stummgeschaltet.'); } catch (e) {}
    // 1) Alle Medien hart stoppen (removeChild allein stoppt den Ton nicht!)
    try {
      var meds = document.querySelectorAll('video, audio');
      for (var i = 0; i < meds.length; i++) {
        try { meds[i].pause(); } catch (e) {}
        try { meds[i].muted = true; meds[i].volume = 0; meds[i].removeAttribute('src'); meds[i].load(); } catch (e) {}
      }
    } catch (e) {}
    // 2) Seite komplett leeren -> auch iframes (externe Links) verstummen,
    //    und spaetere appendChild-Versuche der Module laufen ins Leere.
    try { if (document.body && document.body.parentNode) document.body.parentNode.removeChild(document.body); } catch (e) {}
    // 3) Fenster schliessen, falls der Host das erlaubt.
    try { window.close(); } catch (e) {}
  }

  function check() {
    if (dead || !registered) return; // erst pruefen, wenn die eigene Registrierung durch ist
    try {
      var x = new XMLHttpRequest();
      x.open('GET', URL_ + '?t=' + Date.now(), true);
      x.timeout = 1500;
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) return;
        try {
          var r = JSON.parse(x.responseText || '{}');
          if (r && r.id && r.id !== ID) shutdown();
        } catch (e) {}
      };
      x.send();
    } catch (e) {}
  }

  register();
  // Registrierung nachholen, falls die Bridge beim Start noch nicht lief.
  window.setInterval(function () { if (!registered && !dead) register(); }, 2000);
  window.setInterval(check, 1200);
})();
