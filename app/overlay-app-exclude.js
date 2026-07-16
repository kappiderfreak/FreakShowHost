/*
 * App-Ausnahmen: Solange eine in den Einstellungen gewaehlte App im VORDERGRUND
 * ist, schaltet sich das Overlay komplett ab (alles unsichtbar, Ton gestoppt,
 * keine neuen Videos) - damit es nichts verdeckt. Sobald die App nicht mehr
 * das aktive Fenster ist, kommt sofort alles zurueck.
 * Die Bridge (/excluded-apps) meldet ueber "suspend", ob abgeschaltet werden soll.
 * Laeuft im echten Overlay (index.html).
 */
(function () {
  'use strict';
  if (window.__KAPPI_APP_EXCLUDE_ACTIVE__) return;
  window.__KAPPI_APP_EXCLUDE_ACTIVE__ = true;

  var URL_ = location.origin + '/excluded-apps';
  var POLL_MS = 150;   // schnell nachziehen -> Hotkey/Overlay-Ausgabe schaltet fast verzoegerungsfrei (war 600)
  var suspended = false;

  function ensureStyle() {
    if (document.getElementById('kappi-app-suspend-style')) return;
    var s = document.createElement('style');
    s.id = 'kappi-app-suspend-style';
    // Alles ausblenden -> Overlay komplett unsichtbar, die App dahinter frei sichtbar.
    s.textContent = 'html.kappi-app-suspended body { visibility: hidden !important; }';
    (document.head || document.documentElement).appendChild(s);
  }

  function stopAllMedia() {
    // WICHTIG: nur ausblenden stoppt den Ton NICHT -> pausieren + entfernen.
    var meds = document.querySelectorAll('video, audio');
    for (var i = 0; i < meds.length; i++) {
      var m = meds[i];
      try { m.pause(); } catch (e) {}
      try { m.muted = true; m.volume = 0; m.removeAttribute('src'); m.load(); } catch (e) {}
      try { if (m.parentNode) m.parentNode.removeChild(m); } catch (e) {}
    }
  }

  function apply(on) {
    if (on === suspended) return;
    suspended = on;
    window.__KAPPI_OVERLAY_SUSPENDED__ = on;
    ensureStyle();
    document.documentElement.classList.toggle('kappi-app-suspended', on);
    if (on) {
      stopAllMedia();
      try { if (window.console && console.log) console.log('[Kappi App-Ausnahme] Vordergrund-App aktiv -> Overlay aus.'); } catch (e) {}
    } else {
      try { if (window.console && console.log) console.log('[Kappi App-Ausnahme] Overlay wieder an.'); } catch (e) {}
    }
  }

  function poll() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', URL_ + '?t=' + Date.now(), true);
      x.timeout = 1500;
      x.onload = function () {
        if (x.status < 200 || x.status >= 300) return;
        try { var r = JSON.parse(x.responseText || '{}'); apply(!!r.suspend); } catch (e) {}
      };
      x.send();
    } catch (e) {}
  }

  ensureStyle();
  poll();
  window.setInterval(poll, POLL_MS);
})();
