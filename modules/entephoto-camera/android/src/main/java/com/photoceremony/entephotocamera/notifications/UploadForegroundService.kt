package com.photoceremony.entephotocamera.notifications

import android.app.Notification
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import timber.log.Timber

/**
 * Foreground Service that elevates the app process during active photo uploads
 * to protect network transfers from aggressive OS background throttling.
 *
 * In Android 14+ (API 34), declares and uses FOREGROUND_SERVICE_TYPE_DATA_SYNC.
 * In Android 15+ (API 35), implements onTimeout() to handle system dataSync limits safely.
 *
 * Note: While this service provides process elevation and ongoing notification display,
 * background JavaScript execution guarantees depend on the React Native runtime lifecycle.
 */
class UploadForegroundService : Service() {

    companion object {
        private const val ACTION_START = "com.photoceremony.entephotocamera.action.START_UPLOAD_SERVICE"
        private const val ACTION_UPDATE = "com.photoceremony.entephotocamera.action.UPDATE_UPLOAD_SERVICE"
        private const val ACTION_STOP = "com.photoceremony.entephotocamera.action.STOP_UPLOAD_SERVICE"

        private const val EXTRA_CURRENT = "extra_current"
        private const val EXTRA_TOTAL = "extra_total"
        private const val EXTRA_PERCENTAGE = "extra_percentage"

        fun start(context: Context, current: Int, total: Int, bytePercentage: Double? = null) {
            val intent = Intent(context, UploadForegroundService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_CURRENT, current)
                putExtra(EXTRA_TOTAL, total)
                if (bytePercentage != null) {
                    putExtra(EXTRA_PERCENTAGE, bytePercentage)
                }
            }
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                Timber.w(e, "UploadForegroundService: Failed to start foreground service")
            }
        }

        fun update(context: Context, current: Int, total: Int, bytePercentage: Double? = null) {
            val intent = Intent(context, UploadForegroundService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_CURRENT, current)
                putExtra(EXTRA_TOTAL, total)
                if (bytePercentage != null) {
                    putExtra(EXTRA_PERCENTAGE, bytePercentage)
                }
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                Timber.w(e, "UploadForegroundService: Failed to update foreground service")
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, UploadForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                Timber.w(e, "UploadForegroundService: Failed to stop foreground service via intent")
            }
        }
    }

    private var isForegroundActive = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            Timber.d("UploadForegroundService: received null intent in onStartCommand")
            return START_NOT_STICKY
        }

        when (intent.action) {
            ACTION_START -> {
                val current = intent.getIntExtra(EXTRA_CURRENT, 1)
                val total = intent.getIntExtra(EXTRA_TOTAL, 0)
                val percentage = if (intent.hasExtra(EXTRA_PERCENTAGE)) {
                    intent.getDoubleExtra(EXTRA_PERCENTAGE, 0.0)
                } else null
                handleStart(current, total, percentage)
            }
            ACTION_UPDATE -> {
                val current = intent.getIntExtra(EXTRA_CURRENT, 1)
                val total = intent.getIntExtra(EXTRA_TOTAL, 0)
                val percentage = if (intent.hasExtra(EXTRA_PERCENTAGE)) {
                    intent.getDoubleExtra(EXTRA_PERCENTAGE, 0.0)
                } else null
                handleUpdate(current, total, percentage)
            }
            ACTION_STOP -> {
                handleStop()
            }
            else -> {
                Timber.w("UploadForegroundService: unknown action ${intent.action}")
            }
        }

        return START_NOT_STICKY
    }

    private fun handleStart(current: Int, total: Int, percentage: Double?) {
        val notification = NotificationHelper.buildUploadProgressNotification(
            this, current, total, percentage
        )

        if (!isForegroundActive) {
            startForegroundCompat(notification)
            isForegroundActive = true
            Timber.i("UploadForegroundService: started foreground service with notification")
        } else {
            updateNotification(notification)
        }
    }

    private fun handleUpdate(current: Int, total: Int, percentage: Double?) {
        val notification = NotificationHelper.buildUploadProgressNotification(
            this, current, total, percentage
        )

        if (!isForegroundActive) {
            startForegroundCompat(notification)
            isForegroundActive = true
        } else {
            updateNotification(notification)
        }
    }

    private fun handleStop() {
        Timber.i("UploadForegroundService: stopping foreground service")
        stopForegroundCompat()
        isForegroundActive = false
        stopSelf()
    }

    private fun startForegroundCompat(notification: Notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NotificationHelper.NOTIFICATION_ID_UPLOAD_PROGRESS,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                )
            } else {
                startForeground(
                    NotificationHelper.NOTIFICATION_ID_UPLOAD_PROGRESS,
                    notification
                )
            }
        } catch (e: Exception) {
            Timber.e(e, "UploadForegroundService: startForeground failed")
        }
    }

    private fun updateNotification(notification: Notification) {
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            manager?.notify(NotificationHelper.NOTIFICATION_ID_UPLOAD_PROGRESS, notification)
        } catch (e: Exception) {
            Timber.w(e, "UploadForegroundService: Failed to update notification")
        }
    }

    private fun stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (e: Exception) {
            Timber.w(e, "UploadForegroundService: stopForegroundCompat error")
        }
    }

    /**
     * Android 15 (API 35, VanillaIceCream) dataSync foreground service timeout callback.
     * System invokes this when dataSync service reaches the system execution time limit.
     */
    override fun onTimeout(startId: Int, fgsType: Int) {
        Timber.w("UploadForegroundService: onTimeout reached (startId=$startId, fgsType=$fgsType)")
        handleStop()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        Timber.d("UploadForegroundService: app task removed from recents, stopping service")
        handleStop()
    }

    override fun onDestroy() {
        Timber.d("UploadForegroundService: onDestroy")
        isForegroundActive = false
        stopForegroundCompat()
        super.onDestroy()
    }
}
