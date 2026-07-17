FreakShow – Streaming-Overlay-Host (Stand: 12.07.2026)
===========================================================

FreakShow.exe ist ein eigenstaendiger Overlay-Host: WebView2-Overlay-Fenster,
Tray-Menue, Monitorwahl, Einzelinstanz, Windows-Autostart und die eingebettete
PowerShell-Bridge (HTTP auf Port 18081) laufen in EINEM Prozess.

Start & Bedienung
-----------------
1. FreakShow.exe starten (Overlay + Bridge starten zusammen).
2. Einstellungen: Doppelklick auf das Tray-Symbol (oeffnet http://127.0.0.1:18081/).
3. Beenden: Tray-Symbol rechtsklicken -> Beenden.

Ordnerstruktur
--------------
  FreakShow.exe            Host (Host.cs, EmbeddedBridge.ps1 als Ressource)
  app\                     Anwendung: index.html (Overlay), websocket-diagnose.html
                           (Einstellungsseite) + 16 Overlay-JS-Module
  Content\                 Nur Medien: images\, backgrounds\, media\videos\
                           (Video-Effekte: <Gruppe>\<Effekt>\<Effekt>.js/.webm/.json),
                           uploads\ (html-overlays\ nur optional fuer eigene lokale Seiten)
  data\config\             Dauerhafte Einstellungen (JSON, inkl. ui-state.json,
                           allowed-ips.json, pause-hotkey.json, websocket-config.json)
  data\state\              Laufzeitzustand (overlay-output.json, video-pause.json ...)

Funktionen (Auszug, Stand Juli 2026)
------------------------------------
- Streamer.bot-Anbindung (WebSocket, Host/Port in den Einstellungen; Status-Anzeige
  zeigt den ECHTEN Verbindungsstatus des Overlay-PCs auf jedem Geraet).
- 82 Video-Effektmodule mit eigenen Custom-Triggern + zentral verwaltete Videos,
  Bilder-/Text-Overlays (Notizen) mit Streamer.bot-Triggern, Roter Teppich (Emote-
  Regen), externe Overlay-Links mit Live-Vorschau.
- Einstellungen liegen SERVERSEITIG (data\config\ui-state.json) und werden zwischen
  allen Browsern/PCs synchronisiert (kein localStorage/Cookies noetig).
- LAN-Zugriff: Seite auch von anderen Geraeten erreichbar (http://<Host-IP>:18081).
  IP-Freigabeliste unter Einstellungen -> Verbindungen -> Erlaubte Geraete
  (leer = alle im Heimnetz; dieser PC bleibt immer erlaubt).
- Globales Tastenkuerzel (auch im Spiel) fuer die Overlay-Ausgabe:
  Einstellungen -> Pause. Konfig in data\config\pause-hotkey.json.
- WebSocket-Relay auf 127.0.0.1:18082 fuer HTTPS-Overlays (z. B. ChatRD).
- Bekannte externe Links (ChatRD, Tawmae, MustachedManiac) werden dateilos
  aus dem Internet in den Arbeitsspeicher geladen. Lokale HTML-Kopien sind nicht noetig.
- Oberflaeche dreisprachig (Deutsch/Englisch/Spanisch), Hintergrund als Bild ODER
  Video (Live-Wallpaper).

Hinweise
--------
- "Aufraeumen" (Gruppen-Organizer) sortiert Videos nach Content\media\videos\
  und haelt Einstellungen, Effekt-JS und app\index.html automatisch konsistent.
- Die Bridge lauscht auf 0.0.0.0:18081 (LAN) und zusaetzlich auf [::1]; Aenderungen
  sind token-geschuetzt, abgelehnte Geraete erhalten HTTP 403.

Build
-----
Build.ps1 erstellt die EXE mit dem vorhandenen Windows-.NET-Framework-Compiler
(csc.exe); ein separates .NET-SDK ist nicht erforderlich. EmbeddedBridge.ps1 wird
als Ressource eingebettet: Aenderungen an Host.cs ODER EmbeddedBridge.ps1 brauchen
einen Rebuild; app\- und Content\-Dateien wirken nach einem Seiten-/Overlay-Reload.
