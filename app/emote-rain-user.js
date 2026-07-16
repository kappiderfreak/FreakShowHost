// Emoji-Regen pro Zuschauer: Schreibt ein konfigurierter, aktiver User im Chat,
// faellt kurz ein Regen aus seinem Profilbild. Konfiguration kommt von der Bridge
// (/emote-rain-users), Test ueber /emote-rain-test. Twitch/YouTube/Kick-Chat.
(function () {
  'use strict';
  if (window.__KAPPI_EMOTE_RAIN_USER_ACTIVE__) return;
  window.__KAPPI_EMOTE_RAIN_USER_ACTIVE__ = true;

  var USERS_URL = location.origin + '/emote-rain-users';
  var TEST_URL = location.origin + '/emote-rain-test';
  var POLL_MS = 3000;
  var TEST_POLL_MS = 700;
  var COOLDOWN_MS = 4000; // pro User: nicht bei jeder Nachricht neu regnen

  var users = {};          // login(lowercase) -> config
  var lastTestToken = -1;
  var cooldown = {};       // login -> Zeitpunkt der letzten Begrüßung (ms)
  var greetMs = 0;         // Begrüßungs-Pause in ms; 0 = jede Nachricht (nur 4s-Spamschutz)
  var GREETLOG_KEY = 'kappi.er.greetlog';
  var didGreetReset = false; // „Bei Stream-Start neu begrüßen": nur EINMAL pro Overlay-Session

  function loadGreetLog() {
    try {
      var raw = window.localStorage.getItem(GREETLOG_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (obj && typeof obj === 'object') {
        for (var k in obj) { var t = Number(obj[k]); if (isFinite(t)) cooldown[k] = t; }
      }
    } catch (e) {}
  }
  function saveGreetLog() {
    try {
      var now = Date.now();
      var keep = Math.max(greetMs, 60000); // abgelaufene Einträge verwerfen -> Datei klein halten
      var out = {};
      for (var k in cooldown) { if ((now - cooldown[k]) < keep) out[k] = cooldown[k]; }
      window.localStorage.setItem(GREETLOG_KEY, JSON.stringify(out));
    } catch (e) {}
  }

  function avatarUrl(name) { return 'https://unavatar.io/twitch/' + encodeURIComponent(String(name || '').toLowerCase()); }
  function clampNum(v, d, min, max) { v = Number(v); if (!isFinite(v)) v = d; return Math.max(min, Math.min(max, v)); }
  // Nur echte Strings/Zahlen zurueckgeben -> nie "[object Object]".
  function asStr(v) { return (typeof v === 'string') ? v : (typeof v === 'number' ? String(v) : ''); }

  function ensureStyle() {
    if (document.getElementById('kappi-er-style')) return;
    var s = document.createElement('style');
    s.id = 'kappi-er-style';
    s.textContent =
      '@keyframes kappiErFall{0%{transform:translateY(var(--sy,-40vh)) rotate(0deg)}' +
      '100%{transform:translateY(130vh) rotate(var(--r,0deg))}}' +
      '.kappi-er-p{position:fixed;top:0;left:0;z-index:2000;pointer-events:none;isolation:isolate;' +
      'will-change:transform;animation:kappiErFall linear both}' +
      '.kappi-er-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}' +
      '.kappi-er-tint{position:absolute;inset:0;border-radius:50%;mix-blend-mode:color}' +
      '.kappi-er-name{position:fixed;z-index:2001;pointer-events:none;color:#fff;' +
      'font:700 26px system-ui,Segoe UI,sans-serif;padding:6px 14px;opacity:0;' +
      'transition:opacity .3s ease;text-shadow:0 2px 8px rgba(0,0,0,.95),0 0 3px rgba(0,0,0,.95)}';
    document.head.appendChild(s);
  }

  function showName(cfg, name) {
    ensureStyle();
    var el = document.createElement('div');
    el.className = 'kappi-er-name';
    el.textContent = name;
    var pos = cfg.namePos || 'bottom-left';
    var m = '28px';
    if (pos === 'bottom-left') { el.style.left = m; el.style.bottom = m; }
    else if (pos === 'bottom-right') { el.style.right = m; el.style.bottom = m; }
    else if (pos === 'top-left') { el.style.left = m; el.style.top = m; }
    else if (pos === 'top-right') { el.style.right = m; el.style.top = m; }
    else { el.style.left = '50%'; el.style.top = '50%'; el.style.transform = 'translate(-50%,-50%)'; }
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; });
    setTimeout(function () {
      el.style.opacity = '0';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 450);
    }, 3500);
  }

  function rain(cfg, displayName) {
    if (!cfg || !cfg.name) return;
    // Neue, gemeinsame Engine (Animationsarten + Regenbogen/Farbrand). Fällt auf
    // die alte einfache Variante zurück, falls emote-rain-anim.js nicht geladen ist.
    if (window.KappiRainAnim && window.KappiRainAnim.play) {
      window.KappiRainAnim.play(cfg, document.body, {
        fixed: true,
        avatarUrl: avatarUrl(cfg.name),
        displayName: asStr(displayName) || asStr(cfg.name)
      });
      return;
    }
    ensureStyle();
    var size = clampNum(cfg.size, 64, 16, 240);
    var count = clampNum(cfg.count, 16, 1, 80);
    var mode = cfg.colorMode || 'original';
    var color = /^#[0-9a-f]{6}$/i.test(cfg.colorValue || '') ? cfg.colorValue : '#83f28f';
    var url = avatarUrl(cfg.name);

    for (var i = 0; i < count; i++) {
      var p = document.createElement('span');
      p.className = 'kappi-er-p';
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = (Math.random() * 100) + 'vw';
      var dur = 2.6 + Math.random() * 3.0;
      p.style.animationDuration = dur.toFixed(2) + 's';
      // Start-Zeit UND Start-Hoehe streuen -> rieselt wie echter Regen statt als Block.
      p.style.animationDelay = (Math.random() * 1.8).toFixed(2) + 's';
      // Start klar oberhalb des Bildschirms (inkl. Emoji-Hoehe) -> faellt von oben
      // herein statt als Reihe am oberen Rand zu materialisieren.
      var above = size + 40 + Math.random() * (window.innerHeight * 0.7);
      p.style.setProperty('--sy', '-' + above.toFixed(0) + 'px');
      p.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');

      var img = document.createElement('img');
      img.className = 'kappi-er-img';
      img.src = url;
      img.alt = '';
      if (mode === 'bw') img.style.filter = 'grayscale(1)';
      p.appendChild(img);

      if (mode === 'tint') {
        var ov = document.createElement('span');
        ov.className = 'kappi-er-tint';
        ov.style.background = color;
        p.appendChild(ov);
      }

      p.addEventListener('animationend', function () { if (this.parentNode) this.parentNode.removeChild(this); });
      document.body.appendChild(p);
      (function (el, total) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, (total + 2) * 1000); })(p, dur + 1);
    }

    var label = asStr(displayName) || asStr(cfg.name);
    if (cfg.showName && label) showName(cfg, label);
  }

  // --- Chat-Nachricht -> Namen bestimmen ---
  function chatUser(data) {
    data = data || {};
    var m = (data.message && typeof data.message === 'object') ? data.message : {};
    var u = (data.user && typeof data.user === 'object') ? data.user : {};
    var uStr = (typeof data.user === 'string') ? data.user : '';
    var login = (asStr(m.username) || asStr(u.login) || asStr(u.name) || uStr ||
                 asStr(data.userName) || asStr(data.username)).toLowerCase();
    var display = asStr(m.displayName) || asStr(u.displayName) || asStr(u.name) ||
                  asStr(data.displayName) || login;
    return { login: login, display: display };
  }

  function onChat(payload) {
    var data = payload && payload.data ? payload.data : payload;
    var cu = chatUser(data);
    if (!cu.login) return;
    var cfg = users[cu.login];
    if (!cfg || cfg.enabled === false) return;
    var now = Date.now();
    var period = greetMs > 0 ? greetMs : COOLDOWN_MS;
    if (cooldown[cu.login] && (now - cooldown[cu.login]) < period) return;
    cooldown[cu.login] = now;
    rain(cfg, cu.display);
    if (greetMs > 0) saveGreetLog(); // Begrüßung merken (übersteht Neustart)
  }

  // --- Streamer.bot Custom-Event -> Emoji-Regen fuer den zugeordneten User ---
  // Ausloesen per Schalter (cfg.triggerOn) ueber einen Custom-Event-Namen
  // (cfg.trigger; leer = Username). Streamer.bot sendet { "<trigger>": true }.
  // KEIN Begruessungs-Cooldown hier: ein bewusster Trigger spielt immer.
  function onCustom(payload) {
    var data = payload && payload.data ? payload.data : {};
    // Die lokale Client-Bibliothek verpackt CPH.WebsocketBroadcastJson eine Ebene tief
    // ({event:{...},data:{Trigger:true}}) – eine Ebene auspacken, sonst matcht nichts.
    if (data && data.event && data.event.source === 'General' && data.event.type === 'Custom' &&
        data.data && typeof data.data === 'object') { data = data.data; }
    for (var key in users) {
      if (!users.hasOwnProperty(key)) continue;
      var cfg = users[key];
      if (!cfg || cfg.enabled === false || !cfg.triggerOn) continue;
      var trig = (asStr(cfg.trigger) || asStr(cfg.name)).trim();
      if (trig && data[trig] === true) rain(cfg, cfg.name);
    }
  }

  // --- Konfiguration von der Bridge laden ---
  function loadUsers() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', USERS_URL + '?t=' + Date.now(), true);
      xhr.timeout = 2500;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var r = JSON.parse(xhr.responseText || '{}');
          var arr = Array.isArray(r.users) ? r.users : [];
          var map = {};
          for (var i = 0; i < arr.length; i++) { var u = arr[i]; if (u && u.name) map[String(u.name).toLowerCase()] = u; }
          users = map;
          var gh = Number(r.greetHours); if (!isFinite(gh) || gh < 0) gh = 0; if (gh > 24) gh = 24;
          greetMs = gh * 3600000;
          // „Bei Stream-Start neu begrüßen": beim ERSTEN Laden nach Overlay-Start
          // die gemerkten Begrüßungen einmal leeren -> jeder wird wieder begrüßt.
          if (r.greetResetOnStart && !didGreetReset) {
            didGreetReset = true;
            cooldown = {};
            try { window.localStorage.removeItem(GREETLOG_KEY); } catch (e2) {}
          }
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  // --- Test-Trigger von der Einstellungsseite ---
  function pollTest() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', TEST_URL + '?t=' + Date.now(), true);
      xhr.timeout = 1200;
      xhr.onload = function () {
        if (xhr.status < 200 || xhr.status >= 300) return;
        try {
          var r = JSON.parse(xhr.responseText || '{}');
          var token = Number(r.token) || 0;
          if (lastTestToken < 0) { lastTestToken = token; return; }
          if (token > lastTestToken) {
            lastTestToken = token;
            var cfg = users[String(r.name || '').toLowerCase()];
            if (cfg) rain(cfg, cfg.name);
          }
        } catch (e) {}
      };
      xhr.send();
    } catch (e) {}
  }

  function bindChat() {
    if (window.client && typeof window.client.on === 'function') {
      window.client.on('Twitch.ChatMessage', onChat);
      window.client.on('Kick.ChatMessage', onChat);
      window.client.on('YouTube.Message', onChat);
      window.client.on('General.Custom', onCustom); // Streamer.bot-Trigger
    }
  }

  function start() {
    loadGreetLog();
    bindChat();
    loadUsers();
    setInterval(loadUsers, POLL_MS);
    pollTest();
    setInterval(pollTest, TEST_POLL_MS);
  }

  // Fuer Tests von aussen erreichbar.
  window.kappiEmoteRainUsers = {
    reload: loadUsers,
    rainFor: function (name) { var cfg = users[String(name || '').toLowerCase()]; if (cfg) rain(cfg, cfg.name); return !!cfg; },
    status: function () { return { active: true, users: users }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
