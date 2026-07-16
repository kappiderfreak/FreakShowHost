# Fehlerbehebung

## Steuerungsseite öffnet nicht

- Nur eine FreakShow-Instanz starten.
- Lokal `http://127.0.0.1:18081/` prüfen.
- Alte Bridge oder Anwendung beenden, wenn sie Port `18081` belegt.
- FreakShow über das Tray-Menü sauber beenden und neu starten.

## Streamer.bot bleibt „nicht verbunden“

- WebSocket-Server in Streamer.bot aktivieren.
- Host und Port kontrollieren; lokal bevorzugt `127.0.0.1`, über LAN die IPv4 des Streamer.bot-PCs.
- **Verbinden** erneut anklicken.
- Den echten Status **Overlay-PC ↔ Streamer.bot** prüfen.
- Bei Zugriff von einem zweiten PC kann nur die Widget-Vorschau getrennt wirken; die Hostanzeige ist maßgeblich.

## Video bleibt anfangs leer

Videos werden bewusst nicht vollständig vorab geladen. Nach dem Wechsel wartet die Vorschau auf Metadaten und den ersten darstellbaren Frame. Bei sehr großen oder langsam dekodierbaren Dateien:

- kurz warten, bis Dauer und Bild erscheinen;
- WebM oder MP4 mit browserfreundlichem Codec verwenden;
- Medien auf einer schnellen lokalen SSD ablegen;
- nicht mehrere alte FreakShow-/Bridge-Instanzen parallel betreiben.

## Overlay erscheint nur auf dem Desktop

- Overlay-Ausgabe aus- und wieder einschalten.
- App-Ausnahmen kontrollieren; die aktive Anwendung darf dort nicht versehentlich eingetragen sein.
- Manche Spiele im exklusiven Vollbild können Desktop-Overlays verdecken. Randloses Vollbild testen.
- FreakShow über das Tray-Menü neu starten, wenn Windows die Always-on-top-Reihenfolge verloren hat.

## Vorschau bleibt nach Minimieren zu klein

- Fenster maximieren und einen kurzen Moment auf die Neuberechnung warten.
- Wenn der Browser einen alten Stand hält: Seite einmal neu laden.
- Bei einem entfernten Browser prüfen, ob dieser wirklich die aktuelle Hostversion geladen hat.

## Externes HTTPS-Overlay zeigt „disconnected“

Bekannte Anbieter wie ChatRD, Tawmae und MustachedManiac werden in der Vorschau dateilos über FreakShow geladen. Prüfen:

- Seite einmal vollständig neu laden, damit die aktuelle Vorschau-Route verwendet wird.
- Hat der FreakShow-PC Internetzugang zum Anbieter?
- Ist **Overlay-PC ↔ Streamer.bot** grün?
- Wurde der Link mit dem richtigen Anbieterprofil erkannt?

Bei einem unbekannten Anbieter bleibt die Vorschau ein direkter HTTPS-Link. Dann kann der Browser auf einem anderen PC eine lokale `ws://`-Verbindung weiterhin blockieren. Wenn die echte Overlay-Ausgabe funktioniert, ist das kein Fehler des Hosts.

## Zweiter PC erreicht die Seite nicht

- `http://<IP-des-FreakShow-PCs>:18081/` verwenden.
- Beide Geräte müssen sich im selben privaten Netzwerk befinden.
- Firewallfreigabe nur für private Netzwerke setzen.
- Unter **Verbindungen → Erlaubte Geräte** die Client-IP freigeben.

## Logs

Laufzeitprotokolle liegen unter `Logs/`. Vor dem Weitergeben immer nach IP-Adressen, Namen, URLs, Tokens und lokalen Pfaden suchen und diese entfernen. Der Logordner wird von Git ignoriert.
