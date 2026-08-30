package com.trackmarg.ledgerplus;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Downloads a release APK and hands it to Android's own package installer.
 *
 * Nothing here happens silently. installApk always goes through the real system installer
 * confirmation screen - there is no bypass, and the user has to have granted "install unknown
 * apps" to this app first. An app that could replace itself unseen would be indistinguishable
 * from malware, and this one holds a business's books.
 *
 * Ported from mystio1/excavator-manager, whose release flow this app already matches on the
 * server side - see backend/src/services/appVersion.ts.
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    private static final String UPDATES_SUBDIR = "updates";
    private static final String APK_FILENAME = "update.apk";
    // Refuse a download that would leave less than this free afterward. The margin is on top
    // of the APK's own size, because Android needs transient space of its own to install.
    private static final long MIN_FREE_SPACE_MARGIN_BYTES = 20L * 1024 * 1024;
    private static final int PROGRESS_NOTIFY_INTERVAL_MS = 250;

    @PluginMethod
    public void downloadApk(PluginCall call) {
        String urlString = call.getString("url");
        if (urlString == null || urlString.isEmpty()) {
            call.reject("Missing required 'url' parameter", "invalid_argument");
            return;
        }
        String expectedSha256 = call.getString("expectedSha256");

        File updatesDir = new File(getContext().getExternalFilesDir(null), UPDATES_SUBDIR);
        if (!updatesDir.exists() && !updatesDir.mkdirs()) {
            call.reject("Could not create download directory", "storage_error");
            return;
        }
        File apkFile = new File(updatesDir, APK_FILENAME);
        if (apkFile.exists()) {
            apkFile.delete();
        }

        HttpURLConnection connection = null;
        InputStream input = null;
        OutputStream output = null;
        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            // GitHub serves a release asset as a redirect to its CDN.
            connection.setInstanceFollowRedirects(true);
            connection.connect();

            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                call.reject("Server returned HTTP " + responseCode, "http_error");
                return;
            }

            long totalBytes = connection.getContentLengthLong();
            if (totalBytes > 0) {
                StatFs stat = new StatFs(updatesDir.getPath());
                long availableBytes = stat.getAvailableBytes();
                if (availableBytes < totalBytes + MIN_FREE_SPACE_MARGIN_BYTES) {
                    call.reject("Not enough free storage to download this update", "low_storage");
                    return;
                }
            }

            input = connection.getInputStream();
            output = new FileOutputStream(apkFile);

            byte[] buffer = new byte[8192];
            long bytesWritten = 0;
            long lastNotifyAt = System.currentTimeMillis();
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
                bytesWritten += read;

                long now = System.currentTimeMillis();
                if (now - lastNotifyAt >= PROGRESS_NOTIFY_INTERVAL_MS) {
                    lastNotifyAt = now;
                    notifyProgress(bytesWritten, totalBytes);
                }
            }
            notifyProgress(bytesWritten, totalBytes);
            output.flush();
        } catch (IOException e) {
            deleteQuietly(apkFile);
            call.reject("Download failed: " + e.getMessage(), "network_error", e);
            return;
        } finally {
            closeQuietly(input);
            closeQuietly(output);
            if (connection != null) {
                connection.disconnect();
            }
        }

        if (!apkFile.exists() || apkFile.length() == 0) {
            call.reject("Download completed but the file is empty", "download_interrupted");
            return;
        }

        // A truncated or tampered APK must never reach the installer. Android would reject a
        // broken signature anyway, but failing here gives an honest message rather than the
        // system's bare "App not installed".
        if (expectedSha256 != null && !expectedSha256.isEmpty()) {
            String actualSha256;
            try {
                actualSha256 = sha256(apkFile);
            } catch (IOException | NoSuchAlgorithmException e) {
                deleteQuietly(apkFile);
                call.reject("Could not verify the downloaded file", "verification_failed", e);
                return;
            }
            if (!actualSha256.equalsIgnoreCase(expectedSha256)) {
                deleteQuietly(apkFile);
                call.reject("Downloaded file failed integrity check", "verification_failed");
                return;
            }
        }

        JSObject result = new JSObject();
        result.put("path", apkFile.getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Missing required 'path' parameter", "invalid_argument");
            return;
        }

        File apkFile = new File(path);
        if (!apkFile.exists()) {
            call.reject("APK file not found at the given path", "file_not_found");
            return;
        }

        try {
            Uri contentUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            // Only confirms the installer screen was launched. Whether the user went through
            // with it is not observable here; the authoritative signal is comparing
            // App.getInfo().build again on the next launch or resume.
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Could not launch the installer: " + e.getMessage(), "install_failed", e);
        }
    }

    @PluginMethod
    public void canRequestPackageInstalls(PluginCall call) {
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            PackageManager pm = getContext().getPackageManager();
            allowed = pm.canRequestPackageInstalls();
        }
        JSObject result = new JSObject();
        result.put("allowed", allowed);
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            // Nothing to grant before Android 8 - the permission is manifest-only there.
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            Activity activity = getActivity();
            if (activity != null) {
                activity.startActivity(intent);
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open install-permission settings: " + e.getMessage(), "settings_unavailable", e);
        }
    }

    private void notifyProgress(long bytesWritten, long totalBytes) {
        JSObject data = new JSObject();
        data.put("bytesWritten", bytesWritten);
        data.put("totalBytes", totalBytes);
        if (totalBytes > 0) {
            data.put("percent", Math.min(100.0, (bytesWritten * 100.0) / totalBytes));
        } else {
            // No Content-Length: the bar has to be indeterminate rather than wrong.
            data.put("percent", -1);
        }
        notifyListeners("downloadProgress", data);
    }

    private static String sha256(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        byte[] hash = digest.digest();
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    private static void closeQuietly(java.io.Closeable c) {
        if (c != null) {
            try {
                c.close();
            } catch (IOException ignored) {
                // best-effort cleanup
            }
        }
    }

    private static void deleteQuietly(File f) {
        if (f != null && f.exists()) {
            f.delete();
        }
    }
}
