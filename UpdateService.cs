using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal sealed class UpdateManifest
{
    public string version { get; set; }
    public string packageUrl { get; set; }
    public string sha256 { get; set; }
    public string releaseUrl { get; set; }
    public string minimumVersion { get; set; }
}

internal sealed class TimeoutWebClient : WebClient
{
    protected override WebRequest GetWebRequest(Uri address)
    {
        WebRequest request = base.GetWebRequest(address);
        request.Timeout = 15000;
        HttpWebRequest http = request as HttpWebRequest;
        if (http != null)
        {
            http.ReadWriteTimeout = 15000;
            http.UserAgent = "FreakShow/" + FreakShowVersion.Current + " updater";
            http.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        }
        return request;
    }
}

internal static class UpdateService
{
    private const string DefaultManifestUrl = "https://raw.githubusercontent.com/kappiderfreak/FreakShow/main/update-manifest.json";
    private static readonly Regex Sha256Pattern = new Regex("^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant);

    public static async Task<UpdateManifest> CheckAsync()
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        string overrideUrl = Environment.GetEnvironmentVariable("FREAKSHOW_UPDATE_MANIFEST_URL");
        bool testOverride = !String.IsNullOrWhiteSpace(overrideUrl);
        Uri manifestUri = new Uri(testOverride ? overrideUrl.Trim() : DefaultManifestUrl, UriKind.Absolute);
        ValidateManifestUri(manifestUri, testOverride);

        string separator = String.IsNullOrEmpty(manifestUri.Query) ? "?" : "&";
        Uri uncachedUri = manifestUri.IsFile
            ? manifestUri
            : new Uri(manifestUri.AbsoluteUri + separator + "t=" + DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture));
        string json;
        try
        {
            using (TimeoutWebClient client = new TimeoutWebClient())
            {
                json = await client.DownloadStringTaskAsync(uncachedUri);
            }
        }
        catch (WebException ex)
        {
            HttpWebResponse response = ex.Response as HttpWebResponse;
            if (response != null && response.StatusCode == HttpStatusCode.NotFound)
            {
                HostLog.Write("Update manifest is not published yet; treating current build as up to date.");
                return null;
            }
            throw;
        }

        UpdateManifest manifest = new JavaScriptSerializer().Deserialize<UpdateManifest>(json);
        ValidateManifest(manifest, testOverride);
        Version remote = ParseVersion(manifest.version);
        Version current = ParseVersion(FreakShowVersion.Current);
        return remote > current ? manifest : null;
    }

    public static async Task<string> DownloadPackageAsync(UpdateManifest manifest, string baseDir)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        if (manifest == null) throw new ArgumentNullException("manifest");
        ValidateManifest(manifest, !String.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("FREAKSHOW_UPDATE_MANIFEST_URL")));
        EnsureInstallDirectoryWritable(baseDir);

        string updatesDir = Path.Combine(baseDir, "Updates");
        Directory.CreateDirectory(updatesDir);
        string safeVersion = Regex.Replace(manifest.version ?? "update", "[^0-9A-Za-z._-]", "_");
        string finalPath = Path.Combine(updatesDir, "FreakShow-update-" + safeVersion + ".zip");
        string downloadPath = finalPath + ".download";

        TryDeleteFile(downloadPath);
        if (File.Exists(finalPath) && String.Equals(CalculateSha256(finalPath), manifest.sha256, StringComparison.OrdinalIgnoreCase))
            return finalPath;
        TryDeleteFile(finalPath);

        using (TimeoutWebClient client = new TimeoutWebClient())
        {
            await client.DownloadFileTaskAsync(new Uri(manifest.packageUrl, UriKind.Absolute), downloadPath);
        }

        string actual = CalculateSha256(downloadPath);
        if (!String.Equals(actual, manifest.sha256, StringComparison.OrdinalIgnoreCase))
        {
            TryDeleteFile(downloadPath);
            throw new InvalidDataException("SHA-256 stimmt nicht. Das Update wurde verworfen.");
        }

        File.Move(downloadPath, finalPath);
        return finalPath;
    }

    public static void LaunchUpdater(string packagePath, UpdateManifest manifest, string baseDir)
    {
        string installedUpdater = Path.Combine(baseDir, "FreakShowUpdater.exe");
        if (!File.Exists(installedUpdater)) throw new FileNotFoundException("FreakShowUpdater.exe fehlt.", installedUpdater);

        string updatesDir = Path.Combine(baseDir, "Updates");
        Directory.CreateDirectory(updatesDir);
        string runner = Path.Combine(updatesDir, "FreakShowUpdater-run-" + Guid.NewGuid().ToString("N") + ".exe");
        File.Copy(installedUpdater, runner, true);

        string restart = Path.Combine(baseDir, "FreakShow.exe");
        string arguments =
            "--package " + Quote(packagePath) +
            " --target " + Quote(baseDir) +
            " --pid " + Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture) +
            " --restart " + Quote(restart) +
            " --version " + Quote(manifest.version) +
            " --sha256 " + Quote(manifest.sha256) +
            " --language " + Quote(UpdateText.CurrentLanguage);

        ProcessStartInfo start = new ProcessStartInfo(runner, arguments);
        start.WorkingDirectory = baseDir;
        start.UseShellExecute = false;
        Process process = Process.Start(start);
        if (process == null) throw new InvalidOperationException("Der Update-Helfer konnte nicht gestartet werden.");
        HostLog.Write("Updater launched for version " + manifest.version + ".");
    }

    public static string ConsumeSuccessfulUpdate(string baseDir)
    {
        string marker = Path.Combine(baseDir, "Updates", "last-update.json");
        try
        {
            if (!File.Exists(marker)) return null;
            string json = File.ReadAllText(marker);
            File.Delete(marker);
            Dictionary<string, object> data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            object value;
            if (data != null && data.TryGetValue("version", out value)) return Convert.ToString(value, CultureInfo.InvariantCulture);
        }
        catch (Exception ex) { HostLog.Write("Update marker could not be consumed: " + ex.Message); }
        return null;
    }

    public static void CleanupArtifacts(string baseDir)
    {
        string updatesDir = Path.Combine(baseDir, "Updates");
        try
        {
            if (!Directory.Exists(updatesDir)) return;
            foreach (string file in Directory.GetFiles(updatesDir, "FreakShowUpdater-run-*.exe")) TryDeleteFile(file);
            foreach (string file in Directory.GetFiles(updatesDir, "*.download")) TryDeleteFile(file);
            foreach (string dir in Directory.GetDirectories(updatesDir, "staging-*")) TryDeleteDirectory(dir);

            DirectoryInfo[] backups = new DirectoryInfo(updatesDir).GetDirectories("backup-*");
            Array.Sort(backups, delegate(DirectoryInfo a, DirectoryInfo b) { return b.CreationTimeUtc.CompareTo(a.CreationTimeUtc); });
            for (int i = 2; i < backups.Length; i++) TryDeleteDirectory(backups[i].FullName);

            FileInfo[] packages = new DirectoryInfo(updatesDir).GetFiles("FreakShow-update-*.zip");
            Array.Sort(packages, delegate(FileInfo a, FileInfo b) { return b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc); });
            for (int i = 2; i < packages.Length; i++) TryDeleteFile(packages[i].FullName);
        }
        catch (Exception ex) { HostLog.Write("Update cleanup failed: " + ex.Message); }
    }

    public static void ScheduleCleanup(string baseDir)
    {
        Task.Run(async delegate
        {
            await Task.Delay(10000);
            CleanupArtifacts(baseDir);
        });
    }

    private static void ValidateManifest(UpdateManifest manifest, bool testOverride)
    {
        if (manifest == null) throw new InvalidDataException("Update-Manifest fehlt oder ist ungültig.");
        ParseVersion(manifest.version);
        if (!Sha256Pattern.IsMatch(manifest.sha256 ?? "")) throw new InvalidDataException("Update-Manifest enthält keine gültige SHA-256-Prüfsumme.");
        Uri packageUri;
        if (!Uri.TryCreate(manifest.packageUrl, UriKind.Absolute, out packageUri)) throw new InvalidDataException("Update-Downloadadresse ist ungültig.");
        ValidatePackageUri(packageUri, testOverride);
        if (!String.IsNullOrWhiteSpace(manifest.minimumVersion)) ParseVersion(manifest.minimumVersion);
    }

    private static void ValidateManifestUri(Uri uri, bool testOverride)
    {
        if (testOverride && (uri.IsFile || uri.IsLoopback)) return;
        if (!String.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(uri.Host, "raw.githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(uri.AbsolutePath, "/kappiderfreak/FreakShow/main/update-manifest.json", StringComparison.Ordinal))
            throw new InvalidDataException("Nicht vertrauenswürdige Update-Manifestadresse.");
    }

    private static void ValidatePackageUri(Uri uri, bool testOverride)
    {
        if (testOverride && (uri.IsFile || uri.IsLoopback)) return;
        if (!String.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            !String.Equals(uri.Host, "github.com", StringComparison.OrdinalIgnoreCase) ||
            !uri.AbsolutePath.StartsWith("/kappiderfreak/FreakShow/releases/download/", StringComparison.Ordinal))
            throw new InvalidDataException("Nicht vertrauenswürdige Update-Downloadadresse.");
    }

    private static Version ParseVersion(string value)
    {
        if (String.IsNullOrWhiteSpace(value)) throw new InvalidDataException("Versionsnummer fehlt.");
        string normalized = value.Trim().TrimStart('v', 'V');
        int suffix = normalized.IndexOf('-');
        if (suffix >= 0) normalized = normalized.Substring(0, suffix);
        string[] parts = normalized.Split('.');
        if (parts.Length < 2 || parts.Length > 4) throw new InvalidDataException("Ungültige Versionsnummer: " + value);
        while (normalized.Split('.').Length < 4) normalized += ".0";
        Version parsed;
        if (!Version.TryParse(normalized, out parsed)) throw new InvalidDataException("Ungültige Versionsnummer: " + value);
        return parsed;
    }

    private static string CalculateSha256(string path)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream stream = File.OpenRead(path))
        {
            byte[] hash = sha.ComputeHash(stream);
            return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }
    }

    private static void EnsureInstallDirectoryWritable(string baseDir)
    {
        string probe = Path.Combine(baseDir, ".freakshow-update-write-test-" + Guid.NewGuid().ToString("N"));
        try { File.WriteAllText(probe, "ok"); }
        finally { TryDeleteFile(probe); }
    }

    private static string Quote(string value)
    {
        return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void TryDeleteDirectory(string path)
    {
        try { if (Directory.Exists(path)) Directory.Delete(path, true); } catch { }
    }
}

internal static class UpdateText
{
    private static string configuredLanguage;

    public static void Initialize(string baseDir)
    {
        try
        {
            string statePath = Path.Combine(baseDir, "data", "config", "ui-state.json");
            if (!File.Exists(statePath)) return;
            Match match = Regex.Match(File.ReadAllText(statePath), "\\\"lang\\\"\\s*:\\s*\\\"(de|en|es)\\\"", RegexOptions.IgnoreCase);
            if (match.Success) configuredLanguage = match.Groups[1].Value.ToLowerInvariant();
        }
        catch { }
    }

    private static string Language
    {
        get
        {
            string language = !String.IsNullOrWhiteSpace(configuredLanguage)
                ? configuredLanguage
                : CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.ToLowerInvariant();
            return language == "de" || language == "es" ? language : "en";
        }
    }

    public static string CurrentLanguage { get { return Language; } }

    private static string Pick(string de, string en, string es)
    {
        return Language == "de" ? de : (Language == "es" ? es : en);
    }

    public static string OpenSettings { get { return Pick("Einstellungen öffnen", "Open settings", "Abrir ajustes"); } }
    public static string ToggleOverlay { get { return Pick("Overlay anzeigen/ausblenden", "Show/hide overlay", "Mostrar/ocultar overlay"); } }
    public static string Exit { get { return Pick("Beenden", "Exit", "Salir"); } }
    public static string CheckForUpdates { get { return Pick("Nach Updates suchen…", "Check for updates…", "Buscar actualizaciones…"); } }
    public static string Checking { get { return Pick("Suche nach Updates…", "Checking for updates…", "Buscando actualizaciones…"); } }
    public static string InstallVersion(string version) { return Pick("Update " + version + " installieren…", "Install update " + version + "…", "Instalar actualización " + version + "…"); }
    public static string UpdateAvailableTitle { get { return Pick("FreakShow-Update verfügbar", "FreakShow update available", "Actualización de FreakShow disponible"); } }
    public static string UpdateAvailableBody(string version) { return Pick("Version " + version + " ist verfügbar. Im Tray-Menü installieren.", "Version " + version + " is available. Install it from the tray menu.", "La versión " + version + " está disponible. Instálala desde el menú de la bandeja."); }
    public static string CurrentTitle { get { return Pick("FreakShow ist aktuell", "FreakShow is up to date", "FreakShow está actualizado"); } }
    public static string CurrentBody { get { return Pick("Du verwendest bereits Version " + FreakShowVersion.Current + ".", "You are already using version " + FreakShowVersion.Current + ".", "Ya estás usando la versión " + FreakShowVersion.Current + "."); } }
    public static string CheckFailed { get { return Pick("Die Update-Prüfung ist fehlgeschlagen.", "The update check failed.", "La comprobación de actualizaciones falló."); } }
    public static string InstallQuestion(string version) { return Pick("FreakShow " + version + " herunterladen und installieren?\n\nFreakShow wird danach automatisch neu gestartet. Content und data bleiben unverändert.", "Download and install FreakShow " + version + "?\n\nFreakShow will restart automatically. Content and data remain unchanged.", "¿Descargar e instalar FreakShow " + version + "?\n\nFreakShow se reiniciará automáticamente. Content y data no se modificarán."); }
    public static string Downloading(string version) { return Pick("Update " + version + " wird geladen…", "Downloading update " + version + "…", "Descargando actualización " + version + "…"); }
    public static string InstallFailed { get { return Pick("Das Update konnte nicht installiert werden.", "The update could not be installed.", "No se pudo instalar la actualización."); } }
    public static string UpdatedTitle { get { return Pick("FreakShow wurde aktualisiert", "FreakShow was updated", "FreakShow se ha actualizado"); } }
    public static string UpdatedBody(string version) { return Pick("Version " + version + " wurde erfolgreich installiert.", "Version " + version + " was installed successfully.", "La versión " + version + " se instaló correctamente."); }
}
