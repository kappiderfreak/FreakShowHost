using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class FreakShowUpdaterProgram
{
    private static string logPath;
    private static readonly HashSet<string> AllowedRootFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        "FreakShow.exe",
        "FreakShow.exe.config",
        "FreakShowUpdater.exe",
        "FreakShowUpdater.exe.config",
        "Microsoft.Web.WebView2.Core.dll",
        "Microsoft.Web.WebView2.WinForms.dll",
        "WebView2Loader.dll",
        "OverlayIcon.ico",
        "LICENSE",
        "README-FIRST.txt",
        "README.txt",
        "VERSION.txt"
    };

    [STAThread]
    private static int Main(string[] args)
    {
        Dictionary<string, string> values = ParseArguments(args);
        string target = GetRequired(values, "target");
        string package = GetRequired(values, "package");
        string restart = GetRequired(values, "restart");
        string version = GetRequired(values, "version");
        string expectedSha = GetRequired(values, "sha256");
        string language = GetOptional(values, "language", CultureInfo.CurrentUICulture.TwoLetterISOLanguageName).ToLowerInvariant();
        bool noRestart = values.ContainsKey("no-restart");
        int parentPid = 0;
        Int32.TryParse(GetOptional(values, "pid", "0"), NumberStyles.Integer, CultureInfo.InvariantCulture, out parentPid);

        target = Path.GetFullPath(target);
        package = Path.GetFullPath(package);
        restart = Path.GetFullPath(restart);
        string updatesDir = Path.Combine(target, "Updates");
        Directory.CreateDirectory(updatesDir);
        string logsDir = Path.Combine(target, "Logs");
        Directory.CreateDirectory(logsDir);
        logPath = Path.Combine(logsDir, "Updater.log");

        try
        {
            Log("Starting update to " + version + ".");
            ValidateInputs(target, package, restart, expectedSha);
            WaitForParent(parentPid);
            ApplyPackage(target, package, version);
            WriteSuccessMarker(updatesDir, version);
            Log("Update to " + version + " completed.");
            if (!noRestart) StartApplication(restart, target);
            return 0;
        }
        catch (Exception ex)
        {
            Log("UPDATE FAILED: " + ex);
            if (!noRestart)
            {
                TryRestartAfterFailure(restart, target);
                MessageBox.Show(UpdateErrorText(language) + "\n\n" + ex.Message + "\n\nLog: " + logPath, "FreakShow Updater", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            return 1;
        }
    }

    private static void ValidateInputs(string target, string package, string restart, string expectedSha)
    {
        if (!Directory.Exists(target)) throw new DirectoryNotFoundException("Installationsordner fehlt: " + target);
        if (!File.Exists(package)) throw new FileNotFoundException("Update-Paket fehlt.", package);
        if (!restart.StartsWith(target.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Ungültiger Neustartpfad.");
        if (expectedSha.Length != 64) throw new InvalidDataException("Ungültige SHA-256-Prüfsumme.");
        string actual = CalculateSha256(package);
        if (!String.Equals(actual, expectedSha, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("SHA-256-Prüfung fehlgeschlagen.");
    }

    private static void WaitForParent(int parentPid)
    {
        if (parentPid <= 0) return;
        try
        {
            Process parent = Process.GetProcessById(parentPid);
            Log("Waiting for FreakShow process " + parentPid + " to exit.");
            if (!parent.WaitForExit(30000)) throw new TimeoutException("FreakShow wurde nicht innerhalb von 30 Sekunden beendet.");
        }
        catch (ArgumentException) { }
    }

    private static void ApplyPackage(string target, string package, string version)
    {
        string updatesDir = Path.Combine(target, "Updates");
        string staging = Path.Combine(updatesDir, "staging-" + Guid.NewGuid().ToString("N"));
        string backup = Path.Combine(updatesDir, "backup-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", CultureInfo.InvariantCulture) + "-" + version);
        Directory.CreateDirectory(staging);
        Directory.CreateDirectory(backup);
        List<string> stagedFiles = new List<string>();
        HashSet<string> seenFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        long totalBytes = 0;

        try
        {
            using (ZipArchive archive = ZipFile.OpenRead(package))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    if (String.IsNullOrEmpty(entry.Name)) continue;
                    string relative = NormalizeEntry(entry.FullName);
                    if (!IsAllowed(relative))
                    {
                        Log("Protected/skipped package entry: " + relative);
                        continue;
                    }
                    if (!seenFiles.Add(relative)) throw new InvalidDataException("Doppelter Paketpfad: " + relative);
                    if (entry.Length > 100L * 1024L * 1024L) throw new InvalidDataException("Update-Datei ist zu groß: " + relative);
                    totalBytes += entry.Length;
                    if (totalBytes > 300L * 1024L * 1024L) throw new InvalidDataException("Update-Paket überschreitet die zulässige Gesamtgröße.");

                    string destination = SafeCombine(staging, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    entry.ExtractToFile(destination, true);
                    stagedFiles.Add(relative);
                }
            }

            if (!stagedFiles.Contains("FreakShow.exe")) throw new InvalidDataException("Das Update enthält keine FreakShow.exe.");
            if (!stagedFiles.Contains("FreakShowUpdater.exe")) throw new InvalidDataException("Das Update enthält keinen Update-Helfer.");
            if (!stagedFiles.Contains("VERSION.txt")) throw new InvalidDataException("Das Update enthält keine VERSION.txt.");
            bool hasApp = stagedFiles.Exists(delegate(string value) { return value.StartsWith("app/", StringComparison.OrdinalIgnoreCase); });
            if (!hasApp) throw new InvalidDataException("Das Update enthält keine App-Dateien.");
            string packageVersion = File.ReadAllText(SafeCombine(staging, "VERSION.txt")).Trim();
            if (!String.Equals(packageVersion, version, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Paketversion " + packageVersion + " stimmt nicht mit Manifestversion " + version + " überein.");

            List<string> applied = new List<string>();
            try
            {
                foreach (string relative in stagedFiles)
                {
                    string source = SafeCombine(staging, relative);
                    string destination = SafeCombine(target, relative);
                    string backupFile = SafeCombine(backup, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(destination));
                    if (File.Exists(destination))
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(backupFile));
                        File.Copy(destination, backupFile, true);
                    }
                    ReplaceFile(source, destination);
                    applied.Add(relative);
                }
            }
            catch
            {
                Log("Copy failed; rolling back " + applied.Count + " files.");
                for (int i = applied.Count - 1; i >= 0; i--)
                {
                    string relative = applied[i];
                    string destination = SafeCombine(target, relative);
                    string backupFile = SafeCombine(backup, relative);
                    try
                    {
                        if (File.Exists(backupFile)) ReplaceFile(backupFile, destination);
                        else if (File.Exists(destination)) File.Delete(destination);
                    }
                    catch (Exception rollbackError) { Log("Rollback failed for " + relative + ": " + rollbackError.Message); }
                }
                throw;
            }
        }
        finally
        {
            try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
        }
    }

    private static string NormalizeEntry(string value)
    {
        string relative = (value ?? "").Replace('\\', '/').TrimStart('/');
        if (relative.StartsWith("FreakShow/", StringComparison.OrdinalIgnoreCase)) relative = relative.Substring("FreakShow/".Length);
        if (String.IsNullOrWhiteSpace(relative) || relative.Contains("../") || relative.Contains("./") || Path.IsPathRooted(relative))
            throw new InvalidDataException("Unsicherer Paketpfad: " + value);
        return relative;
    }

    private static bool IsAllowed(string relative)
    {
        if (relative.StartsWith("app/", StringComparison.OrdinalIgnoreCase))
        {
            string extension = Path.GetExtension(relative).ToLowerInvariant();
            return extension == ".js" || extension == ".html" || extension == ".css" || extension == ".json" ||
                   extension == ".svg" || extension == ".png" || extension == ".webp" || extension == ".ico" ||
                   extension == ".woff" || extension == ".woff2" || extension == ".ttf";
        }
        return AllowedRootFiles.Contains(relative);
    }

    private static string SafeCombine(string root, string relative)
    {
        string rootFull = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(rootFull, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!full.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Pfad verlässt den Zielordner: " + relative);
        return full;
    }

    private static void ReplaceFile(string source, string destination)
    {
        string temporary = destination + ".freakshow-new-" + Guid.NewGuid().ToString("N");
        try
        {
            File.Copy(source, temporary, true);
            if (File.Exists(destination)) File.Replace(temporary, destination, null, true);
            else File.Move(temporary, destination);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); } catch { }
        }
    }

    private static void WriteSuccessMarker(string updatesDir, string version)
    {
        string json = "{\"version\":\"" + JsonEscape(version) + "\",\"installedAt\":\"" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + "\"}";
        File.WriteAllText(Path.Combine(updatesDir, "last-update.json"), json, new UTF8Encoding(false));
    }

    private static void StartApplication(string restart, string target)
    {
        ProcessStartInfo start = new ProcessStartInfo(restart);
        start.WorkingDirectory = target;
        start.UseShellExecute = true;
        Process.Start(start);
    }

    private static void TryRestartAfterFailure(string restart, string target)
    {
        try { if (File.Exists(restart)) StartApplication(restart, target); } catch (Exception ex) { Log("Restart after failure failed: " + ex.Message); }
    }

    private static string CalculateSha256(string path)
    {
        using (SHA256 sha = SHA256.Create())
        using (FileStream stream = File.OpenRead(path))
        {
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
        }
    }

    private static Dictionary<string, string> ParseArguments(string[] args)
    {
        Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++)
        {
            string key = args[i];
            if (!key.StartsWith("--", StringComparison.Ordinal)) continue;
            key = key.Substring(2);
            if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal)) values[key] = args[++i];
            else values[key] = "true";
        }
        return values;
    }

    private static string GetRequired(Dictionary<string, string> values, string name)
    {
        string value;
        if (!values.TryGetValue(name, out value) || String.IsNullOrWhiteSpace(value)) throw new ArgumentException("Fehlender Parameter --" + name);
        return value;
    }

    private static string GetOptional(Dictionary<string, string> values, string name, string fallback)
    {
        string value;
        return values.TryGetValue(name, out value) ? value : fallback;
    }

    private static string JsonEscape(string value)
    {
        return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }

    private static string UpdateErrorText(string language)
    {
        if (language == "de") return "Das Update ist fehlgeschlagen. Die vorherige Version wurde soweit möglich wiederhergestellt.";
        if (language == "es") return "La actualización falló. Se restauró la versión anterior siempre que fue posible.";
        return "The update failed. The previous version was restored wherever possible.";
    }

    private static void Log(string message)
    {
        try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture) + "  " + message + Environment.NewLine, Encoding.UTF8); } catch { }
    }
}
