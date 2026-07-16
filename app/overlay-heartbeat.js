/*
 * Lebenszeichen (Heartbeat): meldet der Bridge alle 3 s, dass das Overlay laeuft.
 * Bleibt das Lebenszeichen aus (Overlay/EXE geschlossen), faehrt die Bridge sich
 * selbst herunter und raeumt uebrig gebliebene Prozesse (WebView2) auf - damit nach
 * dem Schliessen nichts mehr im Hintergrund haengt. Laeuft nur im echten Overlay.
 */
(function () {
  'use strict';
  if (window.__KAPPI_HEARTBEAT_ACTIVE__) return;
  window.__KAPPI_HEARTBEAT_ACTIVE__ = true;

  var URL_ = location.origin + '/heartbeat';
  // Echter Streamer.bot-Verbindungsstatus DIESES (Host-)Overlays: window.client ist der
  // gemeinsame SB-Client; offener Socket (readyState 1) = verbunden. Wird mitgemeldet,
  // damit die Einstellungsseite auf JEDEM PC den echten Host-Status zeigen kann.
  function isSbConnected() {
    try { return !!(window.client && window.client.socket && window.client.socket.readyState === 1); } catch (e) { return false; }
  }
  function beat() {
    try {
      var x = new XMLHttpRequest();
      x.open('POST', URL_, true);
      x.timeout = 2000;
      x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({
        source: 'overlay',
        sbConnected: isSbConnected(),
        viewportWidth: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0)),
        viewportHeight: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0)),
        devicePixelRatio: Number(window.devicePixelRatio) || 1
      }));
    } catch (e) {}
  }
  function start() {
    beat();
    window.setInterval(beat, 3000);
  }
  if (document.body) start();
  else window.addEventListener('DOMContentLoaded', start);
})();
