package com.photoceremony.entephotocamera.notifications

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import timber.log.Timber

/**
 * Helper class for creating and managing Android system notifications
 * for camera connectivity status and photo upload operations.
 */
object NotificationHelper {

    // ── Channel IDs ───────────────────────────────────────────────────────────
    const val CHANNEL_ID_CAMERA = "entephoto_camera_status"
    const val CHANNEL_ID_UPLOAD = "entephoto_photo_upload"
    const val CHANNEL_ID_RESULTS = "entephoto_upload_results"

    // ── Notification IDs (stable IDs prevent duplicates) ──────────────────────
    const val NOTIFICATION_ID_CAMERA = 1001
    const val NOTIFICATION_ID_UPLOAD_PROGRESS = 2001
    const val NOTIFICATION_ID_UPLOAD_RESULT = 3001

    /**
     * Creates required notification channels on Android 8.0 (API 26) and higher.
     * Safe to call repeatedly; existing channels are not recreated.
     */
    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        // 1. Camera Status Channel (low importance: silent, no vibration)
        val cameraChannel = NotificationChannel(
            CHANNEL_ID_CAMERA,
            "Camera Connection",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Status of camera discovery and USB connection"
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
        }

        // 2. Photo Upload Progress Channel (low importance: silent for ongoing updates)
        val uploadChannel = NotificationChannel(
            CHANNEL_ID_UPLOAD,
            "Photo Upload Progress",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Progress of ongoing photo uploads"
            setShowBadge(false)
            enableVibration(false)
            enableLights(false)
        }

        // 3. Upload Results Channel (default importance: alerts user on completion/failure)
        val resultsChannel = NotificationChannel(
            CHANNEL_ID_RESULTS,
            "Photo Upload Results",
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = "Notifications when photo uploads complete or fail"
            setShowBadge(true)
        }

        notificationManager.createNotificationChannels(
            listOf(cameraChannel, uploadChannel, resultsChannel)
        )
    }

    /**
     * Checks if the app has permission to post notifications.
     * On Android 13+ (API 33), checks POST_NOTIFICATIONS runtime permission.
     * On older Android versions, checks if notifications are enabled for the app.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }
    }

    // ── Camera Notifications ──────────────────────────────────────────────────

    fun showCameraSearching(context: Context) {
        if (!hasNotificationPermission(context)) {
            Timber.d("NotificationHelper: skipping showCameraSearching (permission not granted)")
            return
        }
        createNotificationChannels(context)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_CAMERA)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Searching for Camera")
            .setContentText("Looking for connected Sony camera...")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(getContentIntent(context))
            .build()

        notifySafe(context, NOTIFICATION_ID_CAMERA, notification)
    }

    fun showCameraConnected(context: Context, cameraModel: String?) {
        if (!hasNotificationPermission(context)) {
            Timber.d("NotificationHelper: skipping showCameraConnected (permission not granted)")
            return
        }
        createNotificationChannels(context)

        val text = if (!cameraModel.isNullOrBlank()) {
            "Connected to $cameraModel"
        } else {
            "Connected to Sony camera"
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_CAMERA)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Camera Connected")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(getContentIntent(context))
            .build()

        notifySafe(context, NOTIFICATION_ID_CAMERA, notification)
    }

    fun dismissCamera(context: Context) {
        try {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID_CAMERA)
        } catch (e: Exception) {
            Timber.w(e, "NotificationHelper: Failed to dismiss camera notification")
        }
    }

    // ── Upload Notifications ──────────────────────────────────────────────────

    /**
     * Builds the notification used by [UploadForegroundService].
     * Always returns a valid notification even if POST_NOTIFICATIONS is not yet granted,
     * so startForeground() meets Android requirements.
     */
    fun buildUploadProgressNotification(
        context: Context,
        current: Int,
        total: Int,
        bytePercentage: Double?
    ): Notification {
        createNotificationChannels(context)

        val percentInt = bytePercentage?.toInt()?.coerceIn(0, 100) ?: 0
        val contentText = if (total > 0) {
            "Photo $current of $total ($percentInt%)"
        } else {
            "Uploading photo $current ($percentInt%)"
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_UPLOAD)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Uploading Photos")
            .setContentText(contentText)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(getContentIntent(context))

        if (total > 0) {
            builder.setProgress(100, percentInt, false)
        } else {
            builder.setProgress(0, 0, true)
        }

        return builder.build()
    }

    fun showUploadComplete(context: Context, count: Int) {
        if (!hasNotificationPermission(context)) return
        createNotificationChannels(context)

        val text = if (count == 1) {
            "1 photo uploaded successfully"
        } else {
            "$count photos uploaded successfully"
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_RESULTS)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Upload Complete")
            .setContentText(text)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getContentIntent(context))
            .build()

        notifySafe(context, NOTIFICATION_ID_UPLOAD_RESULT, notification)
    }

    fun showUploadCancelled(context: Context, uploadedCount: Int, total: Int) {
        if (!hasNotificationPermission(context)) return
        createNotificationChannels(context)

        val text = "Uploaded $uploadedCount of $total photos"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_RESULTS)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Upload Cancelled")
            .setContentText(text)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getContentIntent(context))
            .build()

        notifySafe(context, NOTIFICATION_ID_UPLOAD_RESULT, notification)
    }

    fun showUploadFailed(context: Context, message: String, successCount: Int, total: Int) {
        if (!hasNotificationPermission(context)) return
        createNotificationChannels(context)

        val detail = if (total > 0) {
            "$message ($successCount of $total uploaded)"
        } else {
            message
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID_RESULTS)
            .setSmallIcon(getSmallIcon(context))
            .setContentTitle("Upload Failed")
            .setContentText(detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(getContentIntent(context))
            .build()

        notifySafe(context, NOTIFICATION_ID_UPLOAD_RESULT, notification)
    }

    fun dismissUpload(context: Context) {
        try {
            val manager = NotificationManagerCompat.from(context)
            manager.cancel(NOTIFICATION_ID_UPLOAD_PROGRESS)
            manager.cancel(NOTIFICATION_ID_UPLOAD_RESULT)
        } catch (e: Exception) {
            Timber.w(e, "NotificationHelper: Failed to dismiss upload notification")
        }
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    private fun notifySafe(context: Context, id: Int, notification: Notification) {
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (e: SecurityException) {
            Timber.w(e, "NotificationHelper: SecurityException posting notification (permission revoked?)")
        } catch (e: Exception) {
            Timber.w(e, "NotificationHelper: Failed to post notification id=$id")
        }
    }

    private fun getSmallIcon(context: Context): Int {
        val appIcon = context.applicationInfo.icon
        return if (appIcon != 0) appIcon else android.R.drawable.stat_sys_upload
    }

    private fun getContentIntent(context: Context): PendingIntent? {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        } ?: return null

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        return PendingIntent.getActivity(context, 0, intent, flags)
    }
}
