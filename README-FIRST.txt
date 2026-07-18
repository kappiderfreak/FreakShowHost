FreakShow 1.1.3
===============

DEUTSCH
-------
FreakShow ist eine eigenstaendige Windows-Steuerung fuer interaktive
Streaming-Overlays. Videos, Bilder, Notizen, Zuschauer-Effekte und externe
Web-Overlays werden ueber eine gemeinsame Browser-Oberflaeche verwaltet.

Schnellstart:
1. Den kompletten Ordner entpacken. Die EXE nicht einzeln aus dem ZIP starten.
2. FreakShow.exe starten.
3. Die Steuerungsseite per Doppelklick auf das Tray-Symbol oder ueber
   http://127.0.0.1:18081/ oeffnen.
4. Unter Einstellungen -> Verbindungen die Adresse und den WebSocket-Port von
   Streamer.bot eintragen. In Streamer.bot muss der WebSocket-Server laufen.
5. Eigene Medien in Content\ ablegen oder ueber die Steuerungsseite hinzufuegen.

Updates:
- Im Tray-Menue "Nach Updates suchen" anklicken.
- Neue Versionen werden geladen, per SHA-256 geprueft, sicher ausgetauscht und
  FreakShow wird danach automatisch neu gestartet.
- Content, data, Logs und WebView2UserData werden niemals ueberschrieben.
- Bei einem Kopierfehler wird automatisch die vorherige Version wiederhergestellt.

Voraussetzungen:
- Windows 10 oder Windows 11 (64-Bit)
- Microsoft Edge WebView2 Runtime (auf aktuellen Windows-Systemen vorhanden)
- Schreibzugriff auf den entpackten FreakShow-Ordner fuer automatische Updates
- Streamer.bot ist nur fuer Trigger, Chat und Rewards erforderlich

Wichtig:
- Nur eine Instanz starten. Die Ports 18081 und 18082 muessen frei sein.
- Das Paket enthaelt keine persoenlichen Medien, IP-Freigaben, Zugangsdaten,
  Notizen oder gespeicherten Streamer.bot-Verbindungen.
- Windows SmartScreen kann bei einer unsignierten EXE eine Warnung anzeigen.
- Zum Beenden das Tray-Symbol rechtsklicken und Beenden waehlen.


ENGLISH
-------
FreakShow is a self-contained Windows control center for interactive streaming
overlays. Videos, images, notes, viewer effects and external web overlays are
managed from one browser-based interface.

Quick start:
1. Extract the complete folder. Do not run the EXE directly from the ZIP file.
2. Start FreakShow.exe.
3. Open the control page by double-clicking the tray icon or by visiting
   http://127.0.0.1:18081/.
4. Open Settings -> Connections and enter the host and WebSocket port of
   Streamer.bot. The WebSocket server must be enabled in Streamer.bot.
5. Put your own media in Content\ or add it through the control page.

Updates:
- Click "Check for updates" in the tray menu.
- New versions are downloaded, verified with SHA-256, safely replaced and
  FreakShow restarts automatically.
- Content, data, Logs and WebView2UserData are never overwritten.
- A failed copy automatically restores the previous version.

Requirements:
- Windows 10 or Windows 11 (64-bit)
- Microsoft Edge WebView2 Runtime (included with current Windows versions)
- Write access to the extracted FreakShow folder for automatic updates
- Streamer.bot is only required for triggers, chat and rewards

Important:
- Run one instance only. Ports 18081 and 18082 must be available.
- This package contains no personal media, IP allow-list, credentials, notes or
  saved Streamer.bot connection details.
- Windows SmartScreen may warn about an unsigned EXE on first run.
- To quit, right-click the tray icon and choose Exit.
