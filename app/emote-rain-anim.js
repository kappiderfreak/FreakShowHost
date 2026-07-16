/*
 * Gemeinsame Emoji-Regen-Animation für Overlay UND Kontrollpanel-Vorschau.
 * Ein einziger Ort, an dem die Bewegungen leben, damit Vorschau und echtes
 * Overlay garantiert gleich aussehen.
 *
 *   window.KappiRainAnim.play(cfg, root, opts)
 *
 * cfg    – Nutzer-Einstellung { name, size, count, colorMode, colorValue,
 *          animation, showName, namePos }
 * root   – Container-Element (document.body im Overlay, ein Mini-Monitor-DIV
 *          in der Vorschau). Muss position:relative/fixed/absolute sein, wenn
 *          nicht das <body> mit fixed-Layer benutzt wird.
 * opts   – { fixed:Boolean (Layer position:fixed statt absolute),
 *            width, height (Maße des Spielfelds; sonst aus root/Fenster),
 *            avatarUrl (Bild-URL; sonst aus cfg.name),
 *            sizeScale (Emoji-Größe skalieren – Vorschau < 1) }
 *
 * Reine DOM/rAF-Physik, KEIN Netzwerk. Alle Animationen laufen über denselben
 * Physik-Loop (Position + Geschwindigkeit + Schwerkraft), nur die Startwerte
 * unterscheiden sich je nach Animationsart.
 */
(function () {
  'use strict';

  var STYLE_ID = 'kappi-rainanim-style';
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent =
      '.kappi-ra-layer{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:2000}' +
      '.kappi-ra-layer.fixed{position:fixed}' +
      '.kappi-ra-p{position:absolute;top:0;left:0;will-change:transform;pointer-events:none;isolation:isolate}' +
      '.kappi-ra-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}' +
      '.kappi-ra-tint{position:absolute;inset:0;border-radius:50%;mix-blend-mode:color}' +
      '.kappi-ra-name{position:absolute;z-index:2001;pointer-events:none;color:#fff;' +
      'font:700 26px system-ui,Segoe UI,sans-serif;padding:6px 14px;opacity:0;' +
      'transition:opacity .3s ease;text-shadow:0 2px 8px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.95)}';
    document.head.appendChild(s);
  }

  function clampNum(v, d, min, max) { v = Number(v); if (!isFinite(v)) v = d; return Math.max(min, Math.min(max, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function avatarFor(name) { return 'https://unavatar.io/twitch/' + encodeURIComponent(String(name || '').toLowerCase()); }

  // Liste der unterstützten Animationen (auch fürs Kontrollpanel-Dropdown nützlich).
  var ANIMATIONS = ['rain', 'fountain-center', 'fountain-left', 'fountain-right', 'fountain-top', 'fountain-all', 'corners', 'balloon', 'shootingstar'];

  // FORMEN: das Avatar-BILD bekommt die Form (clip-path). Geometrische Formen als Prozent-Polygon
  // (skalieren mit der Größe); Herz/Fisch via SVG-clipPath (objectBoundingBox 0..1, skaliert auch).
  // 'circle' = Standard (border-radius:50%, kein clip). Auch fürs Panel-Dropdown nützlich.
  var SHAPES = {
    circle: '',
    square: 'inset(0)',
    rounded: 'inset(0 round 20%)',
    triangle: 'polygon(50% 3%, 97% 97%, 3% 97%)',
    diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
    pentagon: 'polygon(50% 0%, 98% 38%, 79% 97%, 21% 97%, 2% 38%)',
    hexagon: 'polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0% 50%)',
    star: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
    heart: 'url(#kappi-shape-heart)',
    fish: 'url(#kappi-shape-fish)'
  };
  function ensureShapeDefs() {
    if (document.getElementById('kappi-shape-defs')) return;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('id', 'kappi-shape-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.innerHTML =
      '<defs>' +
      '<clipPath id="kappi-shape-heart" clipPathUnits="objectBoundingBox">' +
      '<path d="M0.5,0.9 C0.15,0.64 0,0.4 0,0.26 C0,0.11 0.13,0.03 0.28,0.03 C0.39,0.03 0.47,0.12 0.5,0.2 C0.53,0.12 0.61,0.03 0.72,0.03 C0.87,0.03 1,0.11 1,0.26 C1,0.4 0.85,0.64 0.5,0.9 Z"/>' +
      '</clipPath>' +
      '<clipPath id="kappi-shape-fish" clipPathUnits="objectBoundingBox">' +
      '<path d="M0.02,0.5 C0.1,0.22 0.45,0.16 0.7,0.36 L0.98,0.2 L0.82,0.5 L0.98,0.8 L0.7,0.64 C0.45,0.84 0.1,0.78 0.02,0.5 Z"/>' +
      '</clipPath>' +
      '</defs>';
    (document.body || document.documentElement).appendChild(svg);
  }
  function shapeClipFor(shape) { return (shape && SHAPES.hasOwnProperty(shape)) ? SHAPES[shape] : ''; }

  // Startwerte je Partikel für eine Animationsart. Liefert {x,y,vx,vy} in px/s.
  // W,H = Spielfeldmaße. size = Emoji-Größe. i,count = Index für Streuung.
  function seed(anim, i, count, W, H, size) {
    var g0 = 2.0 * H;            // Schwerkraft-Bezug (px/s^2), skaliert mit Höhe
    var up = 1.95 * H;           // Absprung nach oben (erreicht ~90% Höhe)
    var spread = 0.55 * H;       // seitliche Streuung
    switch (anim) {
      case 'fountain-center':
        return { x: W / 2 - size / 2, y: H - size, vx: rnd(-spread, spread), vy: -rnd(up * 0.8, up) };
      case 'fountain-left':
        return { x: -size * 0.2, y: H * rnd(0.55, 0.98) - size, vx: rnd(up * 0.55, up * 0.9), vy: -rnd(up * 0.45, up * 0.75) };
      case 'fountain-right':
        return { x: W - size * 0.8, y: H * rnd(0.55, 0.98) - size, vx: -rnd(up * 0.55, up * 0.9), vy: -rnd(up * 0.45, up * 0.75) };
      case 'fountain-top':
        return { x: W / 2 - size / 2, y: -size, vx: rnd(-spread, spread), vy: rnd(up * 0.20, up * 0.45) };
      case 'fountain-all': {
        // Alle vier Fontänen gleichzeitig – jede Emoji einer der vier zuordnen.
        var quad = ['fountain-center', 'fountain-left', 'fountain-right', 'fountain-top'];
        return seed(quad[i % 4], i, count, W, H, size);
      }
      case 'corners': {
        // Vier Ecken; jede spritzt diagonal nach innen.
        var c = i % 4;
        var sx = (c === 1 || c === 3) ? W - size * 0.8 : -size * 0.2;   // rechts bei 1,3
        var sy = (c >= 2) ? H - size : -size * 0.2;                     // unten bei 2,3
        var dirx = (c === 1 || c === 3) ? -1 : 1;
        var vyy = (c >= 2) ? -rnd(up * 0.5, up * 0.85) : rnd(up * 0.15, up * 0.4);
        return { x: sx, y: sy, vx: dirx * rnd(up * 0.5, up * 0.95), vy: vyy };
      }
      case 'balloon': {
        // Zufällig über den Monitor verteilt, stehen still und WACHSEN, bis sie „platzen".
        return {
          x: rnd(size * 0.2, Math.max(size * 0.2, W - size * 1.2)),
          y: rnd(size * 0.2, Math.max(size * 0.2, H - size * 1.2)),
          vx: 0, vy: 0, gMul: 0,
          balloon: true, scale0: rnd(0.15, 0.30), grow: rnd(0.45, 0.85), popAt: rnd(1.7, 2.6)
        };
      }
      case 'shootingstar': {
        // Sternschnuppe: diagonal in bestimmtem Winkel quer über den Monitor (keine Schwerkraft).
        var fromLeft = (i % 2 === 0);
        var speed = rnd(1.1, 1.6) * Math.max(W, H);
        var ang = rnd(0.55, 0.80);   // ~32-46° nach unten
        return {
          x: fromLeft ? -size : (W + size),
          y: rnd(-size, H * 0.4),
          vx: Math.cos(ang) * speed * (fromLeft ? 1 : -1),
          vy: Math.sin(ang) * speed,
          gMul: 0, star: true
        };
      }
      case 'rain':
      default: {
        // Von oberhalb hereinfallen – Höhe & Zeit streuen wie echter Regen.
        var startY = -size - Math.random() * (H * 0.7);
        return { x: rnd(0, Math.max(0, W - size)), y: startY, vx: rnd(-0.03, 0.03) * H, vy: rnd(0.30, 0.62) * H, gMul: 0.18 };
      }
    }
  }

  function play(cfg, root, opts) {
    if (!cfg) return;
    ensureStyle();
    opts = opts || {};
    root = root || document.body;

    var fixed = !!opts.fixed;
    var W = opts.width || (fixed ? window.innerWidth : (root.clientWidth || root.offsetWidth || 400));
    var H = opts.height || (fixed ? window.innerHeight : (root.clientHeight || root.offsetHeight || 225));
    var sizeScale = opts.sizeScale > 0 ? opts.sizeScale : 1;

    var size = clampNum(cfg.size, 64, 8, 400) * sizeScale;
    var count = clampNum(cfg.count, 16, 1, 120);
    var pOpacity = clampNum(cfg.opacity, 100, 0, 100) / 100; // Deckkraft der Emojis (0..1)
    var mode = cfg.colorMode || 'original';
    var color = /^#[0-9a-f]{6}$/i.test(cfg.colorValue || '') ? cfg.colorValue : '#83f28f';
    var anim = ANIMATIONS.indexOf(cfg.animation) >= 0 ? cfg.animation : 'rain';
    var url = opts.avatarUrl || avatarFor(cfg.name);
    var shapeClip = shapeClipFor(cfg.shape); // Form-Maske fürs Bild (leer = Kreis-Standard)
    if (shapeClip) ensureShapeDefs();

    // Eigener Layer je Abspiel-Vorgang – so überlagern sich mehrere Regen sauber
    // und lassen sich am Ende komplett entfernen.
    var layer = document.createElement('div');
    layer.className = 'kappi-ra-layer' + (fixed ? ' fixed' : '');
    root.appendChild(layer);

    var parts = [];
    for (var i = 0; i < count; i++) {
      var st = seed(anim, i, count, W, H, size);
      var p = document.createElement('span');
      p.className = 'kappi-ra-p';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      // WICHTIG: sofort an die Startposition setzen + während der Verzögerung
      // unsichtbar. Sonst „klebt" das Emoji während der Wartezeit sichtbar oben
      // links (0,0), weil der Transform sonst erst im ersten aktiven Frame käme.
      p.style.opacity = '0';
      p.style.transform = 'translate(' + st.x.toFixed(1) + 'px,' + st.y.toFixed(1) + 'px)';

      var img = document.createElement('img');
      img.className = 'kappi-ra-img';
      img.src = url; img.alt = '';
      if (mode === 'bw') img.style.filter = 'grayscale(1)';
      if (shapeClip) { img.style.clipPath = shapeClip; img.style.webkitClipPath = shapeClip; img.style.borderRadius = '0'; }
      p.appendChild(img);

      var hue = Math.round((i / count) * 360);
      if (mode === 'tint') {
        var ov = document.createElement('span'); ov.className = 'kappi-ra-tint'; ov.style.background = color;
        if (shapeClip) { ov.style.clipPath = shapeClip; ov.style.webkitClipPath = shapeClip; ov.style.borderRadius = '0'; }
        p.appendChild(ov);
      } else if (mode === 'rainbow') {
        var ov2 = document.createElement('span'); ov2.className = 'kappi-ra-tint'; ov2.style.background = 'hsl(' + hue + ',90%,55%)';
        if (shapeClip) { ov2.style.clipPath = shapeClip; ov2.style.webkitClipPath = shapeClip; ov2.style.borderRadius = '0'; }
        p.appendChild(ov2);
      } else if (mode === 'border') {
        var ring = Math.max(2, Math.round(size * 0.09));
        img.style.boxShadow = '0 0 0 ' + ring + 'px hsl(' + hue + ',90%,55%)';
      }

      // Sternschnuppe: Warmer Kometen-Schweif ENTGEGEN der Flugrichtung (box-shadow, bewegt sich mit).
      if (st.star) {
        var mag = Math.hypot(st.vx, st.vy) || 1;
        var tl = size * 1.7;
        img.style.boxShadow = (-st.vx / mag * tl).toFixed(0) + 'px ' + (-st.vy / mag * tl).toFixed(0) + 'px ' +
          Math.round(size * 0.9) + 'px ' + Math.round(size * 0.12) + 'px hsla(45,100%,75%,.55)';
      }

      layer.appendChild(p);
      parts.push({
        el: p,
        x: st.x, y: st.y, vx: st.vx, vy: st.vy,
        gMul: st.gMul || 1,
        rot: (st.star || st.balloon) ? 0 : rnd(-40, 40),
        vrot: (st.balloon || st.star) ? 0 : rnd(-180, 180),
        delay: (anim === 'rain') ? rnd(0, 1.6) : (anim === 'balloon' ? rnd(0, 1.2) : rnd(0, 0.35)),
        started: false, life: 0,
        balloon: !!st.balloon, scale0: st.scale0, grow: st.grow, popAt: st.popAt, popping: null,
        star: !!st.star
      });
    }

    // Name einblenden (optional) – innerhalb des Spielfelds positioniert.
    if (cfg.showName && cfg.name) {
      var nm = document.createElement('div');
      nm.className = 'kappi-ra-name';
      nm.textContent = opts.displayName || cfg.name;
      if (!fixed) nm.style.fontSize = Math.max(9, Math.round(H * 0.06)) + 'px';
      var pos = cfg.namePos || 'bottom-left';
      var m = (fixed ? 28 : Math.max(6, Math.round(H * 0.04))) + 'px';
      if (pos === 'bottom-left') { nm.style.left = m; nm.style.bottom = m; }
      else if (pos === 'bottom-right') { nm.style.right = m; nm.style.bottom = m; }
      else if (pos === 'top-left') { nm.style.left = m; nm.style.top = m; }
      else if (pos === 'top-right') { nm.style.right = m; nm.style.top = m; }
      else { nm.style.left = '50%'; nm.style.top = '50%'; nm.style.transform = 'translate(-50%,-50%)'; }
      layer.appendChild(nm);
      requestAnimationFrame(function () { nm.style.opacity = '1'; });
      setTimeout(function () { nm.style.opacity = '0'; }, 3200);
    }

    var G = 2.0 * H;               // Schwerkraft px/s^2
    var last = 0;
    var maxLife = 9;              // Sicherheits-Ende in Sekunden
    var alive = parts.length;

    function frame(ts) {
      if (!last) last = ts;
      var dt = Math.min(0.05, (ts - last) / 1000); // dt kappen (Tab-Wechsel)
      last = ts;
      alive = 0;
      for (var k = 0; k < parts.length; k++) {
        var q = parts[k];
        if (!q.el) continue;
        if (q.delay > 0) { q.delay -= dt; alive++; continue; }
        if (!q.started) { q.started = true; q.el.style.opacity = String(pOpacity); } // jetzt erst sichtbar (mit eingestellter Deckkraft)
        q.life += dt;
        // Luftballon: auf der Stelle wachsen; bei popAt kurz aufblähen + ausblenden = platzen, dann weg.
        if (q.balloon) {
          if (q.popping == null && (q.scale0 + q.grow * q.life) >= q.popAt) q.popping = q.life;
          if (q.popping != null) {
            var pt = q.life - q.popping;
            var ps = q.popAt * (1 + pt * 5);
            q.el.style.opacity = String(Math.max(0, pOpacity * (1 - pt / 0.16)));
            q.el.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px) scale(' + ps.toFixed(2) + ')';
            if (pt > 0.16 || q.life > maxLife) { if (q.el.parentNode) q.el.parentNode.removeChild(q.el); q.el = null; }
            else alive++;
          } else {
            var bs = Math.min(q.popAt, q.scale0 + q.grow * q.life);
            q.el.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px) scale(' + bs.toFixed(2) + ')';
            alive++;
          }
          continue;
        }
        var g = G * q.gMul;
        q.vy += g * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.rot += q.vrot * dt;
        q.el.style.transform = 'translate(' + q.x.toFixed(1) + 'px,' + q.y.toFixed(1) + 'px) rotate(' + q.rot.toFixed(1) + 'deg)';
        // Weg, wenn unten raus (oder seitlich weit weg / Zeit abgelaufen).
        var out = q.y > H + size * 1.4 || q.life > maxLife || q.x < -size * 3 || q.x > W + size * 3;
        if (out) { if (q.el.parentNode) q.el.parentNode.removeChild(q.el); q.el = null; }
        else alive++;
      }
      if (alive > 0) { requestAnimationFrame(frame); }
      else { if (layer.parentNode) layer.parentNode.removeChild(layer); }
    }
    requestAnimationFrame(frame);

    // Harte Obergrenze: Layer nach maxLife+1s auf jeden Fall entfernen.
    setTimeout(function () { if (layer.parentNode) layer.parentNode.removeChild(layer); }, (maxLife + 1) * 1000);

    return layer;
  }

  window.KappiRainAnim = { play: play, ANIMATIONS: ANIMATIONS };
})();
