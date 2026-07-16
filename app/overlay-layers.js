/*
 * Overlay-Ebenen-Priorität.
 * Liest die Reihenfolge (oben -> unten) von der Bridge (/overlay-layers) und
 * setzt daraus per injiziertem <style> den z-index je Overlay-Kategorie.
 * So kann in den Einstellungen per Ziehen bestimmt werden, was bei Überlappung
 * oben liegt. Läuft im echten Overlay (index.html).
 */
(function () {
  'use strict';

  var BRIDGE = location.origin + '/overlay-layers';
  var CATS = ['endgame', 'images', 'overlays', 'emote', 'video'];
  var DEFAULT = ['endgame', 'images', 'overlays', 'emote', 'video']; // oben -> unten (Endgame-Speckzettel standardmaessig oben)
  var SELECTORS = {
    // Endgame-Speckzettel: hatte einen festen Riesen-z-index (2147483000). Das !important
    // hier zieht ihn ins Ebenen-System, damit er einsortiert werden kann.
    endgame: '#kappi-cheatsheet',
    images: '#kappi-image-overlays',
    overlays: '#kappi-external-overlay-layer, #kappi-giphy-sb-layer',
    // WICHTIG: auch die AKTUELLE Emote-Rain-Engine (emote-rain-anim.js -> .kappi-ra-*)
    // muss hier stehen. Sonst behaelt ihr Layer seinen festen z-index (2000) und rutscht
    // bei Videos (die ueber das Ebenen-System ~1.000.000 bekommen) dahinter = "Layer-Shift".
    emote: '.kappi-er-p, #kappi-emote-rain-layer, .kappi-rain-item-simple, .kappi-ra-layer, .kappi-ra-p',
    emoteName: '.kappi-er-name, .kappi-ra-name',
    video: 'video[data-kappi-video-id], .kappi-video-chroma-canvas'
  };
  var lastKey = '';

  function ensureStyle() {
    var s = document.getElementById('kappi-layer-priority');
    if (!s) {
      s = document.createElement('style');
      s.id = 'kappi-layer-priority';
      (document.head || document.documentElement).appendChild(s);
    }
    return s;
  }

  function applyOrder(order) {
    var n = order.length;
    var css = [];
    for (var i = 0; i < n; i++) {
      var cat = order[i];
      var z = (n - i) * 1000000;
      if (SELECTORS[cat]) css.push(SELECTORS[cat] + ' { z-index: ' + z + ' !important; }');
      if (cat === 'emote') css.push(SELECTORS.emoteName + ' { z-index: ' + (z + 1) + ' !important; }');
    }
    ensureStyle().textContent = css.join('\n');
  }

  function normalize(order) {
    var clean = [];
    if (order && order.length) {
      for (var i = 0; i < order.length; i++) {
        var k = String(order[i]);
        if (CATS.indexOf(k) >= 0 && clean.indexOf(k) < 0) clean.push(k);
      }
    }
    // Fehlende Kategorien an ihrer STANDARD-Position (CATS-Reihenfolge) einfuegen, nicht
    // hinten anhaengen -> neu ergaenztes Endgame landet oben, nicht unter den Videos.
    for (var j = 0; j < CATS.length; j++) {
      var key = CATS[j];
      if (clean.indexOf(key) >= 0) continue;
      var insertAt = clean.length;
      for (var d = j + 1; d < CATS.length; d++) {
        var pos = clean.indexOf(CATS[d]);
        if (pos >= 0) { insertAt = pos; break; }
      }
      clean.splice(insertAt, 0, key);
    }
    return clean;
  }

  function fetchAndApply() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', BRIDGE + '?t=' + Date.now(), true);
      xhr.timeout = 2500;
      xhr.onload = function () {
        try {
          var r = JSON.parse(xhr.responseText || '{}');
          var order = normalize(r.order);
          var key = order.join(',');
          if (key !== lastKey) { lastKey = key; applyOrder(order); }
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  lastKey = DEFAULT.join(',');
  applyOrder(DEFAULT);
  fetchAndApply();
  setInterval(fetchAndApply, 3000);
})();
