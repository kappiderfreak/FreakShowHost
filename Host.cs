using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using System.Management.Automation;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class HostLog
{
    private static readonly object Sync = new object();
    public static string FilePath;

    public static void Write(string message)
    {
        try
        {
            lock (Sync)
            {
                File.AppendAllText(FilePath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine, Encoding.UTF8);
            }
        }
        catch { }
    }
}

internal sealed class EmbeddedBridge : IDisposable
{
    private readonly string contentRoot;
    private readonly string exePath;
    private Thread thread;
    private PowerShell shell;
    private volatile bool disposed;

    public EmbeddedBridge(string contentRoot, string exePath)
    {
        this.contentRoot = contentRoot;
        this.exePath = exePath;
    }

    public void Start()
    {
        thread = new Thread(Run);
        thread.IsBackground = true;
        thread.Name = "FreakShow embedded bridge";
        thread.Start();
    }

    private static string ResourceText(string name)
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        {
            if (stream == null) throw new InvalidOperationException("Embedded resource missing: " + name);
            using (StreamReader reader = new StreamReader(stream, Encoding.UTF8, true)) return reader.ReadToEnd();
        }
    }

    private void Run()
    {
        try
        {
            string script = ResourceText("EmbeddedBridge.ps1");
            PowerShell ps = PowerShell.Create();
            shell = ps;
            ps.AddScript(script, false);
            ps.AddParameter("Port", 18081);
            string baseDir = Path.GetDirectoryName(exePath);
            string dataConfig = Path.Combine(baseDir, "data", "config");
            string dataState = Path.Combine(baseDir, "data", "state");
            ps.AddParameter("SettingsPath", Path.Combine(dataConfig, "emote-rain-settings.json"));
            ps.AddParameter("PositionPreviewPath", Path.Combine(dataState, "overlay-position-preview.json"));
            ps.AddParameter("ExternalLinksPath", Path.Combine(dataConfig, "external-overlay-links.json"));
            ps.AddParameter("VideoOverlaysPath", Path.Combine(dataConfig, "video-overlay-settings.json"));
            ps.AddParameter("VideoPausePath", Path.Combine(dataState, "video-pause.json"));
            ps.AddParameter("EmoteRainUsersPath", Path.Combine(dataConfig, "emote-rain-users.json"));
            ps.AddParameter("OverlayLayersPath", Path.Combine(dataConfig, "overlay-layers.json"));
            ps.AddParameter("ImageOverlaysPath", Path.Combine(dataConfig, "image-overlays.json"));
            ps.AddParameter("ExcludedAppsPath", Path.Combine(dataConfig, "excluded-apps.json"));
            ps.AddParameter("OverlayOutputPath", Path.Combine(dataState, "overlay-output.json"));
            ps.AddParameter("CheatsheetPath", Path.Combine(dataConfig, "cheatsheet.json"));
            ps.AddParameter("OverlayMonitorPath", Path.Combine(dataConfig, "overlay-monitor.json"));
            ps.AddParameter("PauseHotkeyPath", Path.Combine(dataConfig, "pause-hotkey.json"));
            ps.AddParameter("UiStatePath", Path.Combine(dataConfig, "ui-state.json"));
            ps.AddParameter("AllowedIpsPath", Path.Combine(dataConfig, "allowed-ips.json"));
            ps.AddParameter("WebSocketConfigPath", Path.Combine(dataConfig, "websocket-config.json"));
            ps.AddParameter("AppRoot", Path.Combine(baseDir, "app"));
            ps.AddParameter("ContentRoot", contentRoot);
            ps.AddParameter("OverlayExePath", exePath);
            ps.AddParameter("SettingsPagePath", Path.Combine(baseDir, "app", "websocket-diagnose.html"));
            ps.AddParameter("EmbeddedHost", true);
            ps.Streams.Error.DataAdded += delegate(object sender, DataAddedEventArgs e)
            {
                try { HostLog.Write("BRIDGE ERROR: " + ps.Streams.Error[e.Index].ToString()); } catch { }
            };
            HostLog.Write("Embedded bridge starting on 127.0.0.1:18081");
            ps.Invoke();
            if (!disposed) HostLog.Write("Embedded bridge stopped unexpectedly.");
        }
        catch (Exception ex)
        {
            HostLog.Write("Embedded bridge fatal error: " + ex);
        }
    }

    public void Dispose()
    {
        disposed = true;
        try { if (shell != null) shell.Stop(); } catch { }
        try { if (shell != null) shell.Dispose(); } catch { }
        shell = null;
        try { if (thread != null && thread.IsAlive) thread.Join(2000); } catch { }
    }
}

internal sealed class OverlayForm : Form
{
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_TOPMOST = 0x8;
    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int GWL_EXSTYLE = -20;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_NOOWNERZORDER = 0x0200;
    private const uint SWP_NOSENDCHANGING = 0x0400;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int index);

    [DllImport("user32.dll", EntryPoint = "GetWindowLong", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int index);

    private readonly string contentRoot;
    private readonly WebView2 web;
    private readonly System.Windows.Forms.Timer monitorTimer;
    private readonly System.Windows.Forms.Timer sbStartupTimer;
    private NotifyIcon tray;
    private int lastMonitor = -999;
    private DateTime lastTopMostFailureLog = DateTime.MinValue;
    private DateTime sbStartupWatchStarted = DateTime.MinValue;
    private DateTime lastSbStartupReload = DateTime.MinValue;
    private int sbStartupReloads;
    private bool sbStatusCheckInFlight;

    // --- Globales Tastenkuerzel: schaltet die "Overlay-Ausgabe" systemweit um (auch im Spiel) ---
    // Die Taste kommt aus data/config/pause-hotkey.json (von der Einstellungsseite gesetzt),
    // die Umschaltung schreibt data/state/overlay-output.json (dasselbe wie der UI-Schalter).
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    private const int WM_HOTKEY = 0x0312;
    private const int HOTKEY_ID = 0xB001;
    private const uint MOD_ALT = 0x0001, MOD_CONTROL = 0x0002, MOD_SHIFT = 0x0004, MOD_NOREPEAT = 0x4000;
    private string lastHotkeyRaw = null;

    public OverlayForm(string contentRoot)
    {
        this.contentRoot = contentRoot;
        Text = "FreakShow";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        Bounds = Screen.PrimaryScreen.Bounds;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.Magenta;
        TransparencyKey = Color.Magenta;
        DoubleBuffered = true;

        web = new WebView2();
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = Color.Transparent;
        Controls.Add(web);

        monitorTimer = new System.Windows.Forms.Timer();
        monitorTimer.Interval = 1500;
        monitorTimer.Tick += delegate { ApplySelectedMonitor(); SyncHotkeyRegistration(); EnsureTopMost("timer"); };

        // Zweite Absicherung fuer den Windows-Autostart: Wenn die LAN-Verbindung
        // beim ersten WebView-Start noch nicht bereit war, wird nur die Overlay-Seite
        // begrenzt neu geladen. Das entspricht dem erfolgreichen manuellen Neustart,
        // ohne Bridge, Einstellungen oder die ganze EXE neu zu starten.
        sbStartupTimer = new System.Windows.Forms.Timer();
        sbStartupTimer.Interval = 5000;
        sbStartupTimer.Tick += async delegate { await CheckStreamerBotStartupAsync(); };

        Load += delegate { InitializeAsync(); };
        FormClosed += delegate { try { UnregisterHotKey(Handle, HOTKEY_ID); } catch { } try { sbStartupTimer.Stop(); } catch { } if (tray != null) { tray.Visible = false; tray.Dispose(); } };
        CreateTray();
    }

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_NOACTIVATE;
            return cp;
        }
    }

    protected override bool ShowWithoutActivation { get { return true; } }

    private static IntPtr GetExtendedStyle(IntPtr hWnd)
    {
        return IntPtr.Size == 8 ? GetWindowLongPtr64(hWnd, GWL_EXSTYLE) : GetWindowLongPtr32(hWnd, GWL_EXSTYLE);
    }

    // Ein exklusives Vollbild oder ein fremdes Fenster kann die Z-Reihenfolge des
    // click-through Overlays verschieben. Da WS_EX_NOACTIVATE keinen Fokus erlaubt,
    // kann sich das Fenster danach nicht durch Anklicken selbst wieder nach vorne holen.
    // Deshalb wird die Topmost-Band-Position ohne Aktivierung regelmaessig aufgefrischt.
    private void EnsureTopMost(string reason)
    {
        if (IsDisposed || Disposing || !IsHandleCreated || !Visible) return;
        try
        {
            long exStyle = GetExtendedStyle(Handle).ToInt64();
            bool hadTopMostStyle = (exStyle & WS_EX_TOPMOST) != 0;
            bool ok = SetWindowPos(
                Handle,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING);

            if (ok)
            {
                if (!hadTopMostStyle) HostLog.Write("Overlay topmost state restored (" + reason + ").");
                lastTopMostFailureLog = DateTime.MinValue;
            }
            else if ((DateTime.UtcNow - lastTopMostFailureLog).TotalSeconds >= 30)
            {
                lastTopMostFailureLog = DateTime.UtcNow;
                HostLog.Write("Overlay topmost refresh FAILED (" + reason + "), Win32=" + Marshal.GetLastWin32Error() + ".");
            }
        }
        catch (Exception ex)
        {
            if ((DateTime.UtcNow - lastTopMostFailureLog).TotalSeconds >= 30)
            {
                lastTopMostFailureLog = DateTime.UtcNow;
                HostLog.Write("Overlay topmost refresh error (" + reason + "): " + ex.Message);
            }
        }
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        EnsureTopMost("shown");
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (Visible && IsHandleCreated)
        {
            try { BeginInvoke((MethodInvoker)delegate { EnsureTopMost("visible"); }); } catch { }
        }
    }

    private async void InitializeAsync()
    {
        try
        {
            ApplySelectedMonitor();
            string data = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "WebView2UserData");
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions("--disable-http-cache --disk-cache-size=1 --autoplay-policy=no-user-gesture-required");
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, data, options);
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.IsZoomControlEnabled = false;
            web.CoreWebView2.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs e)
            {
                e.State = CoreWebView2PermissionState.Allow;
            };
            web.CoreWebView2.ProcessFailed += delegate
            {
                HostLog.Write("WebView2 process failed; reloading overlay.");
                try { web.Reload(); } catch { }
            };
            await WaitForBridge();
            await WaitForStreamerBotEndpoint();
            web.Source = new Uri("http://127.0.0.1:18081/content/index.html");
            sbStartupWatchStarted = DateTime.UtcNow;
            lastSbStartupReload = DateTime.MinValue;
            sbStartupReloads = 0;
            sbStartupTimer.Start();
            monitorTimer.Start();
            HostLog.Write("Overlay navigation started.");
        }
        catch (Exception ex)
        {
            HostLog.Write("WebView2 initialization failed: " + ex);
            MessageBox.Show("FreakShow konnte WebView2 nicht starten.\n\n" + ex.Message, "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private static async System.Threading.Tasks.Task WaitForBridge()
    {
        for (int i = 0; i < 40; i++)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:18081/health?t=" + DateTime.UtcNow.Ticks);
                request.Timeout = 500;
                request.ReadWriteTimeout = 500;
                using (HttpWebResponse response = (HttpWebResponse)await request.GetResponseAsync())
                {
                    if ((int)response.StatusCode == 200) return;
                }
            }
            catch { }
            await System.Threading.Tasks.Task.Delay(150);
        }
        throw new InvalidOperationException("Die eingebettete Bridge konnte Port 18081 nicht bereitstellen. Läuft die alte Bridge noch?");
    }

    // Windows kann Autostart-Programme starten, bevor die Netzwerkkarte bereits
    // eine Route zum Streamer.bot-PC besitzt. In diesem kurzen Fenster erzeugte
    // WebSockets koennen in WebView2 haengen bleiben. Die Bridge und Einstellungen
    // laufen sofort; nur die erste Overlay-Navigation wartet maximal 25 Sekunden.
    private static async System.Threading.Tasks.Task WaitForStreamerBotEndpoint()
    {
        string host = null;
        int port = 0;
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "websocket-config.json");
            if (!File.Exists(file)) return;
            string json = File.ReadAllText(file);
            Match mh = Regex.Match(json, "\\\"host\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"", RegexOptions.IgnoreCase);
            Match mp = Regex.Match(json, "\\\"port\\\"\\s*:\\s*(\\d+)", RegexOptions.IgnoreCase);
            if (!mh.Success || !mp.Success || !Int32.TryParse(mp.Groups[1].Value, out port) || port < 1 || port > 65535) return;
            host = mh.Groups[1].Value.Trim();
            if (String.IsNullOrWhiteSpace(host)) return;
        }
        catch (Exception ex)
        {
            HostLog.Write("Streamer.bot startup endpoint config could not be read: " + ex.Message);
            return;
        }

        for (int attempt = 0; attempt < 50; attempt++)
        {
            if (await CanConnectTcpAsync(host, port, 450))
            {
                HostLog.Write("Streamer.bot endpoint reachable; starting overlay navigation.");
                return;
            }
            await System.Threading.Tasks.Task.Delay(500);
        }
        HostLog.Write("Streamer.bot endpoint not reachable after startup wait; loading overlay with reconnect protection.");
    }

    private static async System.Threading.Tasks.Task<bool> CanConnectTcpAsync(string host, int port, int timeoutMs)
    {
        using (TcpClient client = new TcpClient())
        {
            try
            {
                System.Threading.Tasks.Task connect = client.ConnectAsync(host, port);
                System.Threading.Tasks.Task finished = await System.Threading.Tasks.Task.WhenAny(connect, System.Threading.Tasks.Task.Delay(timeoutMs));
                if (finished != connect)
                {
                    try { client.Close(); } catch { }
                    System.Threading.Tasks.Task observeFailure = connect.ContinueWith(
                        delegate(System.Threading.Tasks.Task t) { var ignored = t.Exception; },
                        System.Threading.Tasks.TaskContinuationOptions.OnlyOnFaulted);
                    return false;
                }
                await connect;
                return client.Connected;
            }
            catch { return false; }
        }
    }

    private async System.Threading.Tasks.Task CheckStreamerBotStartupAsync()
    {
        if (sbStatusCheckInFlight || sbStartupWatchStarted == DateTime.MinValue || web.CoreWebView2 == null) return;
        sbStatusCheckInFlight = true;
        try
        {
            if (await ReadHostStreamerBotStatusAsync())
            {
                sbStartupTimer.Stop();
                HostLog.Write("Streamer.bot startup connection confirmed.");
                return;
            }

            double elapsed = (DateTime.UtcNow - sbStartupWatchStarted).TotalSeconds;
            int[] reloadAtSeconds = new int[] { 20, 50, 90 };
            if (sbStartupReloads < reloadAtSeconds.Length &&
                elapsed >= reloadAtSeconds[sbStartupReloads] &&
                (lastSbStartupReload == DateTime.MinValue || (DateTime.UtcNow - lastSbStartupReload).TotalSeconds >= 15))
            {
                sbStartupReloads++;
                lastSbStartupReload = DateTime.UtcNow;
                HostLog.Write("Streamer.bot still disconnected during startup; reloading overlay page (attempt " + sbStartupReloads + "/3).");
                try { web.Reload(); } catch (Exception ex) { HostLog.Write("Startup overlay reload failed: " + ex.Message); }
            }

            if (elapsed >= 180 && sbStartupReloads >= reloadAtSeconds.Length)
            {
                sbStartupTimer.Stop();
                HostLog.Write("Streamer.bot startup watch ended after 3 overlay reloads; normal client reconnect remains active.");
            }
        }
        catch (Exception ex)
        {
            HostLog.Write("Streamer.bot startup status check failed: " + ex.Message);
        }
        finally
        {
            sbStatusCheckInFlight = false;
        }
    }

    private static async System.Threading.Tasks.Task<bool> ReadHostStreamerBotStatusAsync()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:18081/host-status?t=" + DateTime.UtcNow.Ticks);
            request.Timeout = 1000;
            request.ReadWriteTimeout = 1000;
            request.KeepAlive = false;
            request.Proxy = null;
            using (HttpWebResponse response = (HttpWebResponse)await request.GetResponseAsync())
            using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8))
            {
                string json = await reader.ReadToEndAsync();
                return Regex.IsMatch(json, "\\\"overlayRunning\\\"\\s*:\\s*true", RegexOptions.IgnoreCase) &&
                       Regex.IsMatch(json, "\\\"sbConnected\\\"\\s*:\\s*true", RegexOptions.IgnoreCase);
            }
        }
        catch { return false; }
    }

    private int ReadMonitorIndex()
    {
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "overlay-monitor.json");
            if (!File.Exists(file)) return 0;
            Match m = Regex.Match(File.ReadAllText(file), "\\\"index\\\"\\s*:\\s*(-?\\d+)", RegexOptions.IgnoreCase);
            int value;
            if (m.Success && Int32.TryParse(m.Groups[1].Value, out value)) return value;
        }
        catch { }
        return 0;
    }

    private void ApplySelectedMonitor()
    {
        int index = ReadMonitorIndex();
        Screen[] screens = Screen.AllScreens;
        if (screens.Length == 0) return;
        if (index < 0 || index >= screens.Length) index = 0;
        if (index == lastMonitor && Bounds == screens[index].Bounds) return;
        lastMonitor = index;
        Bounds = screens[index].Bounds;
        EnsureTopMost("monitor");
        HostLog.Write("Overlay moved to monitor " + index + " (" + Bounds.Width + "x" + Bounds.Height + ").");
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        lastHotkeyRaw = null;                 // nach (Neu-)Erzeugung des Fensters neu registrieren
        try { SyncHotkeyRegistration(); } catch { }
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID) { ToggleOverlayOutput(); }
        base.WndProc(ref m);
    }

    // Liest data/config/pause-hotkey.json und (de)registriert den globalen Hotkey NUR bei Aenderung.
    // Wird beim Start (OnHandleCreated) und danach im monitorTimer (alle 1,5s) aufgerufen.
    private void SyncHotkeyRegistration()
    {
        if (!IsHandleCreated) return;
        string raw = "";
        try
        {
            string f = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "config", "pause-hotkey.json");
            if (File.Exists(f)) raw = File.ReadAllText(f);
        }
        catch { }
        if (raw == lastHotkeyRaw) return;
        lastHotkeyRaw = raw;

        int vk = 0; uint mods = 0;
        try
        {
            Match mv = Regex.Match(raw, "\\\"vk\\\"\\s*:\\s*(\\d+)");
            if (mv.Success) Int32.TryParse(mv.Groups[1].Value, out vk);
            if (Regex.IsMatch(raw, "\\\"ctrl\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_CONTROL;
            if (Regex.IsMatch(raw, "\\\"alt\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_ALT;
            if (Regex.IsMatch(raw, "\\\"shift\\\"\\s*:\\s*true", RegexOptions.IgnoreCase)) mods |= MOD_SHIFT;
        }
        catch { }

        try { UnregisterHotKey(Handle, HOTKEY_ID); } catch { }
        if (vk > 0 && vk <= 255)
        {
            bool ok = false;
            try { ok = RegisterHotKey(Handle, HOTKEY_ID, mods | MOD_NOREPEAT, (uint)vk); } catch { }
            HostLog.Write("Global hotkey " + (ok ? "registered" : "FAILED (already used by another app?)") + " vk=" + vk + " mods=" + mods);
        }
        else
        {
            HostLog.Write("Global hotkey cleared (no key set).");
        }
    }

    // Schaltet die Overlay-Ausgabe um (data/state/overlay-output.json) - identisch zum UI-Schalter.
    private void ToggleOverlayOutput()
    {
        try
        {
            string file = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "data", "state", "overlay-output.json");
            bool enabled = true;   // Standard: Ausgabe an (wie in der Bridge)
            try { if (File.Exists(file)) enabled = !Regex.IsMatch(File.ReadAllText(file), "\\\"enabled\\\"\\s*:\\s*false", RegexOptions.IgnoreCase); } catch { }
            bool next = !enabled;
            string dir = Path.GetDirectoryName(file);
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            File.WriteAllText(file, "{\"enabled\":" + (next ? "true" : "false") + "}");
            HostLog.Write("Global hotkey toggled overlay output -> " + (next ? "ON" : "OFF"));
        }
        catch (Exception ex) { HostLog.Write("Hotkey toggle failed: " + ex.Message); }
    }

    private static void OpenSettings()
    {
        try { Process.Start("http://127.0.0.1:18081/"); }
        catch (Exception ex) { HostLog.Write("Could not open settings: " + ex.Message); }
    }

    private void CreateTray()
    {
        tray = new NotifyIcon();
        try
        {
            string ico = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "OverlayIcon.ico");
            tray.Icon = File.Exists(ico) ? new Icon(ico) : Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch { tray.Icon = SystemIcons.Application; }
        tray.Text = "FreakShow";
        ContextMenuStrip menu = new ContextMenuStrip();
        ToolStripMenuItem settings = new ToolStripMenuItem("Einstellungen öffnen");
        settings.Click += delegate { OpenSettings(); };
        ToolStripMenuItem visibility = new ToolStripMenuItem("Overlay anzeigen/ausblenden");
        visibility.Click += delegate
        {
            Visible = !Visible;
            if (Visible) EnsureTopMost("tray");
        };
        ToolStripMenuItem exit = new ToolStripMenuItem("Beenden");
        exit.Click += delegate { Application.Exit(); };
        menu.Items.Add(settings);
        menu.Items.Add(visibility);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(exit);
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { OpenSettings(); };
        tray.Visible = true;
    }
}

internal static class Program
{
    private static Mutex mutex;
    private static EmbeddedBridge bridge;

    [STAThread]
    private static void Main(string[] args)
    {
        bool created;
        mutex = new Mutex(true, "Local\\FreakShow.SingleInstance", out created);
        if (!created)
        {
            try { Process.Start("http://127.0.0.1:18081/"); } catch { }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        string baseDir = Path.GetDirectoryName(Application.ExecutablePath);
        string logsDir = Path.Combine(baseDir, "Logs");
        Directory.CreateDirectory(logsDir);
        HostLog.FilePath = Path.Combine(logsDir, "FreakShow.log");
        Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e) { HostLog.Write("UI ERROR: " + e.Exception); };
        AppDomain.CurrentDomain.UnhandledException += delegate(object sender, UnhandledExceptionEventArgs e) { HostLog.Write("FATAL: " + e.ExceptionObject); };

        string contentRoot = ResolveContentRoot(args, baseDir);
        string appDir = Path.Combine(baseDir, "app");
        if (String.IsNullOrEmpty(contentRoot) || !File.Exists(Path.Combine(appDir, "index.html")) || !File.Exists(Path.Combine(appDir, "websocket-diagnose.html")))
        {
            MessageBox.Show("Kein gültiger Content-Ordner gefunden.\nBitte FreakShow.config.json prüfen.", "FreakShow", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        HostLog.Write("Host starting. ContentRoot=" + contentRoot);
        bridge = new EmbeddedBridge(contentRoot, Application.ExecutablePath);
        bridge.Start();
        try { Application.Run(new OverlayForm(contentRoot)); }
        finally
        {
            if (bridge != null) bridge.Dispose();
            if (mutex != null) { try { mutex.ReleaseMutex(); } catch { } mutex.Dispose(); }
            HostLog.Write("Host stopped.");
        }
    }

    private static string ResolveContentRoot(string[] args, string baseDir)
    {
        for (int i = 0; i < args.Length - 1; i++)
        {
            if (String.Equals(args[i], "--content-root", StringComparison.OrdinalIgnoreCase)) return Normalize(args[i + 1]);
        }
        string env = Environment.GetEnvironmentVariable("FREAKSHOW_CONTENT_ROOT");
        if (!String.IsNullOrWhiteSpace(env)) return Normalize(env);
        string config = Path.Combine(baseDir, "FreakShow.config.json");
        try
        {
            if (File.Exists(config))
            {
                Match m = Regex.Match(File.ReadAllText(config), "\\\"ContentRoot\\\"\\s*:\\s*\\\"((?:\\\\.|[^\\\"])*)\\\"", RegexOptions.IgnoreCase);
                if (m.Success)
                {
                    string value = m.Groups[1].Value.Replace("\\\\", "\\").Replace("\\\"", "\"");
                    return Normalize(value);
                }
            }
        }
        catch (Exception ex) { HostLog.Write("Config read failed: " + ex.Message); }
        string local = Path.Combine(baseDir, "Content");
        if (Directory.Exists(local)) return Normalize(local);
        return null;
    }

    private static string Normalize(string path)
    {
        try { return Path.GetFullPath(Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'))); }
        catch { return null; }
    }
}
