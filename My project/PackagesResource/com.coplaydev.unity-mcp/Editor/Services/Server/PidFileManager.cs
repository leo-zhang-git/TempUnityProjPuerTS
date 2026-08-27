using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using MCPForUnity.Editor.Constants;
using MCPForUnity.Editor.Helpers;
using UnityEditor;
using UnityEngine;

namespace MCPForUnity.Editor.Services.Server
{
    /// <summary>
    /// Manages PID files and handshake state for the local HTTP server.
    /// Handles persistence of server process information across Unity domain reloads.
    /// </summary>
    public class PidFileManager : IPidFileManager
    {
        /// <inheritdoc/>
        public string GetPidDirectory()
        {
            return Path.Combine(GetProjectRootPath(), "Library", "MCPForUnity", "RunState");
        }

        /// <inheritdoc/>
        public string GetPidFilePath(int port)
        {
            string dir = GetPidDirectory();
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, $"mcp_http_{port}.pid");
        }

        /// <inheritdoc/>
        public bool TryReadPid(string pidFilePath, out int pid)
        {
            pid = 0;
            try
            {
                if (string.IsNullOrEmpty(pidFilePath) || !File.Exists(pidFilePath))
                {
                    return false;
                }

                string text = File.ReadAllText(pidFilePath).Trim();
                if (int.TryParse(text, out pid))
                {
                    return pid > 0;
                }

                // Best-effort: tolerate accidental extra whitespace/newlines.
                var firstLine = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                if (int.TryParse(firstLine, out pid))
                {
                    return pid > 0;
                }

                pid = 0;
                return false;
            }
            catch
            {
                pid = 0;
                return false;
            }
        }

        /// <inheritdoc/>
        public bool TryGetPortFromPidFilePath(string pidFilePath, out int port)
        {
            port = 0;
            if (string.IsNullOrEmpty(pidFilePath))
            {
                return false;
            }

            try
            {
                string fileName = Path.GetFileNameWithoutExtension(pidFilePath);
                if (string.IsNullOrEmpty(fileName))
                {
                    return false;
                }

                const string prefix = "mcp_http_";
                if (!fileName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                string portText = fileName.Substring(prefix.Length);
                return int.TryParse(portText, out port) && port > 0;
            }
            catch
            {
                port = 0;
                return false;
            }
        }

        /// <inheritdoc/>
        public void DeletePidFile(string pidFilePath)
        {
            try
            {
                if (!string.IsNullOrEmpty(pidFilePath) && File.Exists(pidFilePath))
                {
                    File.Delete(pidFilePath);
                }
            }
            catch { }
        }

        /// <inheritdoc/>
        public void StoreHandshake(string pidFilePath, string instanceToken)
        {
            try
            {
                if (!string.IsNullOrEmpty(pidFilePath))
                {
                    EditorPrefs.SetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidFilePath), pidFilePath);
                }
            }
            catch { }

            try
            {
                if (!string.IsNullOrEmpty(instanceToken))
                {
                    EditorPrefs.SetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerInstanceToken), instanceToken);
                }
            }
            catch { }
        }

        /// <inheritdoc/>
        public bool TryGetHandshake(out string pidFilePath, out string instanceToken)
        {
            pidFilePath = null;
            instanceToken = null;
            try
            {
                string scopedPidFilePath = EditorPrefs.GetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidFilePath), string.Empty);
                string scopedInstanceToken = EditorPrefs.GetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerInstanceToken), string.Empty);
                if (TryAcceptHandshake(scopedPidFilePath, scopedInstanceToken, out pidFilePath, out instanceToken))
                {
                    return true;
                }

                string legacyPidFilePath = EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidFilePath, string.Empty);
                string legacyInstanceToken = EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerInstanceToken, string.Empty);
                if (TryAcceptHandshake(legacyPidFilePath, legacyInstanceToken, out pidFilePath, out instanceToken)
                    && IsCurrentProjectPidFilePath(pidFilePath))
                {
                    StoreHandshake(pidFilePath, instanceToken);
                    return true;
                }

                pidFilePath = null;
                instanceToken = null;
                return false;
            }
            catch
            {
                pidFilePath = null;
                instanceToken = null;
                return false;
            }
        }

        private static bool TryAcceptHandshake(
            string candidatePidFilePath,
            string candidateInstanceToken,
            out string pidFilePath,
            out string instanceToken)
        {
            pidFilePath = null;
            instanceToken = null;
            if (string.IsNullOrEmpty(candidatePidFilePath) || string.IsNullOrEmpty(candidateInstanceToken))
            {
                return false;
            }

            pidFilePath = candidatePidFilePath;
            instanceToken = candidateInstanceToken;
            return true;
        }

        private static bool IsCurrentProjectPidFilePath(string pidFilePath)
        {
            try
            {
                if (string.IsNullOrEmpty(pidFilePath))
                {
                    return false;
                }

                string pidDirectory = Path.GetFullPath(Path.Combine(GetProjectRootPath(), "Library", "MCPForUnity", "RunState"));
                string fullPidPath = Path.GetFullPath(pidFilePath);

                char separator = Path.DirectorySeparatorChar;
                string normalizedDirectory = pidDirectory
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    .Replace(Path.AltDirectorySeparatorChar, separator);
                string normalizedPidPath = fullPidPath
                    .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                    .Replace(Path.AltDirectorySeparatorChar, separator);

                return normalizedPidPath.Equals(normalizedDirectory, GetPathComparison())
                    || normalizedPidPath.StartsWith(normalizedDirectory + separator, GetPathComparison());
            }
            catch
            {
                return false;
            }
        }

        /// <inheritdoc/>
        public void StoreTracking(int pid, int port, string argsHash = null)
        {
            try { EditorPrefs.SetInt(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPid), pid); } catch { }
            try { EditorPrefs.SetInt(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPort), port); } catch { }
            try { EditorPrefs.SetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerStartedUtc), DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture)); } catch { }
            try
            {
                if (!string.IsNullOrEmpty(argsHash))
                {
                    EditorPrefs.SetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidArgsHash), argsHash);
                }
                else
                {
                    EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidArgsHash));
                }
            }
            catch { }
        }

        /// <inheritdoc/>
        public bool TryGetStoredPid(int expectedPort, out int pid)
        {
            pid = 0;
            try
            {
                if (TryGetStoredPidFromKeys(
                    ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPid),
                    ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPort),
                    ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerStartedUtc),
                    expectedPort,
                    out pid))
                {
                    return true;
                }

                string legacyPidFilePath = EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidFilePath, string.Empty);
                if (IsCurrentProjectPidFilePath(legacyPidFilePath)
                    && TryGetStoredPidFromKeys(
                        EditorPrefKeys.LastLocalHttpServerPid,
                        EditorPrefKeys.LastLocalHttpServerPort,
                        EditorPrefKeys.LastLocalHttpServerStartedUtc,
                        expectedPort,
                        out pid))
                {
                    StoreTracking(pid, expectedPort, EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidArgsHash, string.Empty));
                    return true;
                }

                return false;
            }
            catch
            {
                return false;
            }
        }

        private static bool TryGetStoredPidFromKeys(string pidKey, string portKey, string startedUtcKey, int expectedPort, out int pid)
        {
            pid = 0;
            int storedPid = EditorPrefs.GetInt(pidKey, 0);
            int storedPort = EditorPrefs.GetInt(portKey, 0);
            string storedUtc = EditorPrefs.GetString(startedUtcKey, string.Empty);

            if (storedPid <= 0 || storedPort != expectedPort)
            {
                return false;
            }

            // Only trust the stored PID for a short window to avoid PID reuse issues.
            // (We still verify the PID is listening on the expected port before killing.)
            if (!string.IsNullOrEmpty(storedUtc)
                && DateTime.TryParse(storedUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var startedAt))
            {
                if ((DateTime.UtcNow - startedAt) > TimeSpan.FromHours(6))
                {
                    return false;
                }
            }

            pid = storedPid;
            return true;
        }

        /// <inheritdoc/>
        public string GetStoredArgsHash()
        {
            try
            {
                string scopedArgsHash = EditorPrefs.GetString(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidArgsHash), string.Empty);
                if (!string.IsNullOrEmpty(scopedArgsHash))
                {
                    return scopedArgsHash;
                }

                string legacyPidFilePath = EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidFilePath, string.Empty);
                if (IsCurrentProjectPidFilePath(legacyPidFilePath))
                {
                    return EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidArgsHash, string.Empty);
                }

                return string.Empty;
            }
            catch
            {
                return string.Empty;
            }
        }

        /// <inheritdoc/>
        public void ClearTracking()
        {
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPid)); } catch { }
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPort)); } catch { }
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerStartedUtc)); } catch { }
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidArgsHash)); } catch { }
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerPidFilePath)); } catch { }
            try { EditorPrefs.DeleteKey(ProjectScopedKey(EditorPrefKeys.LastLocalHttpServerInstanceToken)); } catch { }

            try
            {
                string legacyPidFilePath = EditorPrefs.GetString(EditorPrefKeys.LastLocalHttpServerPidFilePath, string.Empty);
                if (!IsCurrentProjectPidFilePath(legacyPidFilePath))
                {
                    return;
                }

                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerPid);
                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerPort);
                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerStartedUtc);
                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerPidArgsHash);
                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerPidFilePath);
                EditorPrefs.DeleteKey(EditorPrefKeys.LastLocalHttpServerInstanceToken);
            }
            catch { }
        }

        /// <inheritdoc/>
        public string ComputeShortHash(string input)
        {
            if (string.IsNullOrEmpty(input)) return string.Empty;
            try
            {
                using var sha = SHA256.Create();
                byte[] bytes = Encoding.UTF8.GetBytes(input);
                byte[] hash = sha.ComputeHash(bytes);
                // 8 bytes => 16 hex chars is plenty as a stable fingerprint for our purposes.
                var sb = new StringBuilder(16);
                for (int i = 0; i < 8 && i < hash.Length; i++)
                {
                    sb.Append(hash[i].ToString("x2"));
                }
                return sb.ToString();
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string GetProjectRootPath()
        {
            try
            {
                // Application.dataPath is ".../<Project>/Assets"
                return Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            }
            catch
            {
                return Application.dataPath;
            }
        }

        private static string ProjectScopedKey(string key)
        {
            return $"{key}_{ProjectIdentityUtility.GetProjectHash()}";
        }

        private static StringComparison GetPathComparison()
        {
            return Application.platform == RuntimePlatform.WindowsEditor
                ? StringComparison.OrdinalIgnoreCase
                : StringComparison.Ordinal;
        }
    }
}
