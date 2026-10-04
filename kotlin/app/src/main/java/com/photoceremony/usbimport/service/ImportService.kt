package com.photoceremony.usbimport.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.photoceremony.usbimport.R
import com.photoceremony.usbimport.db.ImportDatabase
import com.photoceremony.usbimport.model.ImportEvent
import com.photoceremony.usbimport.legacy_mtp.ImportSession
import com.photoceremony.usbimport.ptp.ConnectionState
import com.photoceremony.usbimport.ptp.UsbConnectionManager
import com.photoceremony.usbimport.receiver.UsbDetachReceiver
import com.photoceremony.usbimport.receiver.UsbPermissionReceiver
import com.photoceremony.usbimport.sony.SonyPtpOpcodes
import com.photoceremony.usbimport.sony.SonyRemoteSession
import com.photoceremony.usbimport.ui.ImportLogActivity
import com.photoceremony.usbimport.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import timber.log.Timber

/**
 * ImportService — foreground service that owns the USB receivers and drives
 * [UsbConnectionManager].
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  ARCHITECTURAL GUARANTEE — PC REMOTE MODE (RemoteShooting)          │
 * │  In RemoteShooting mode, [SonyRemoteSession] controls the camera     │
 * │  via Sony vendor extension opcodes (SDIO_Connect 0x9201,             │
 * │  SDIO_ControlDevice 0x9207). Event polling uses GetEvent (0x1003)   │
 * │  and the USB interrupt endpoint. No initiateCapture is issued;      │
 * │  the physical shutter is triggered by the photographer directly.     │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Lifecycle:
 *   onCreate   → register [UsbPermissionReceiver] + [UsbDetachReceiver]
 *                start foreground notification
 *                begin collecting [UsbConnectionManager.state] flow
 *   onStartCommand → extract [UsbDevice] from intent, hand to [UsbConnectionManager]
 *   onDestroy  → unregister receivers
 *                [UsbConnectionManager.reset] closes any open session
 *                [stopRemoteShootingLoop] closes any open SonyRemoteSession
 */
class ImportService : LifecycleService() {

    // ── Constants ────────────────────────────────────────────────────────────

    companion object {
        private const val CHANNEL_ID = "usb_import_channel"
        private const val NOTIF_ID   = 1001

        /**
         * How often to poll for ObjectAdded events while in RemoteShooting mode.
         *
         * 300 ms is conservative and safe — gives the camera enough bus headroom
         * while still delivering downloads within one-third of a second of the
         * shutter press.  Can be tuned down to ~100 ms once hardware tests pass.
         */
        private const val EVENT_POLL_INTERVAL_MS = 300L
    }

    // ── Receivers ────────────────────────────────────────────────────────────

    private val permissionReceiver = UsbPermissionReceiver()
    private val detachReceiver     = UsbDetachReceiver()

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()

        // Start foreground immediately — Android requires this within ~5 s of
        // startForegroundService() to avoid an ANR/crash.
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Waiting for Sony camera…"))

        // Register the USB permission receiver dynamically.
        // IntentFilter uses our app-specific action string so no other app's
        // permission result can accidentally trigger it.
        ContextCompat.registerReceiver(
            this,
            permissionReceiver,
            IntentFilter(UsbConnectionManager.ACTION_USB_PERMISSION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        // Register the USB detach receiver dynamically.
        // ACTION_USB_DEVICE_DETACHED is a protected broadcast, so it can only
        // be sent by the OS — safe to use with RECEIVER_NOT_EXPORTED.
        ContextCompat.registerReceiver(
            this,
            detachReceiver,
            IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )

        Timber.d("ImportService created; receivers registered")

        // Collect the connection state flow and update the notification accordingly.
        lifecycleScope.launch {
            UsbConnectionManager.state
                .collect { state -> onConnectionStateChanged(state) }
        }

        // Collect ImportSession events to keep notification text current.
        lifecycleScope.launch {
            ImportSession.events.collect { event ->
                if (event is ImportEvent.ImportCompleted) {
                    updateNotification(
                        "Captured ${event.record.filename} · " +
                        "${ImportSession.importedCount} total"
                    )
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)

        val device: UsbDevice? = intent?.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        if (device == null) {
            Timber.w("onStartCommand: no UsbDevice in intent")
            return START_NOT_STICKY
        }

        // Hand the device to the manager — it will run the 3-gate handshake.
        UsbConnectionManager.handleDeviceAttached(applicationContext, device)

        return START_REDELIVER_INTENT
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(permissionReceiver) } catch (_: Exception) {}
        try { unregisterReceiver(detachReceiver) }     catch (_: Exception) {}
        if (ImportSession.isRunning) ImportSession.stop()
        UsbConnectionManager.reset()
        Timber.d("ImportService destroyed; receivers unregistered")
    }

    // ── State → notification ─────────────────────────────────────────────────

    private fun onConnectionStateChanged(state: ConnectionState) {
        Timber.d("Connection state changed → %s", state::class.simpleName)
        com.photoceremony.usbimport.sony.UsbEventLogger.log("SERVICE", "onConnectionStateChanged: ${state::class.simpleName}")

        @Suppress("DEPRECATION")
        val text = when (state) {
            is ConnectionState.Idle                  -> "Waiting for Sony camera…"
            is ConnectionState.PermissionRequested   -> "Tap Allow in the permission dialog"
            is ConnectionState.PermissionDenied      -> "USB permission denied — please re-plug"
            is ConnectionState.Connecting            -> "Connecting to camera…"
            is ConnectionState.Connected             -> "MTP Mode unsupported — set camera to PC Remote"
            is ConnectionState.RemoteShooting        -> "Remote Shooting Active · ${state.model}"
            is ConnectionState.ErrorPcRemote         -> "⚠ Set USB Connection to PC Remote"
            is ConnectionState.ErrorNotSony          -> "Non-Sony device attached — ignoring"
            is ConnectionState.ErrorConnectionFailed -> "Connection failed — try re-plugging"
        }
        updateNotification(text)

        when (state) {
            is ConnectionState.RemoteShooting -> {
                com.photoceremony.usbimport.sony.UsbEventLogger.log("SERVICE", "RemoteShooting active for ${state.model}")
            }
            is ConnectionState.Idle,
            is ConnectionState.ErrorPcRemote,
            is ConnectionState.ErrorConnectionFailed -> {
                if (ImportSession.isRunning) ImportSession.stop()
            }
            else -> {}
        }
    }

    // ── Notification helpers ─────────────────────────────────────────────────

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "USB Import",
            NotificationManager.IMPORTANCE_LOW         // silent — no sound/vibration
        ).apply {
            description = "Runs while importing photos from Sony camera over USB"
            setShowBadge(false)
        }
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        // Tap the notification → go to ImportLogActivity if importing, else MainActivity.
        val tapTarget: Class<*> = if (ImportSession.isRunning) ImportLogActivity::class.java
                                  else MainActivity::class.java
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, tapTarget),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_usb_import)
            .setOngoing(true)
            .setContentIntent(tapIntent)
            .build()
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIF_ID, buildNotification(text))
    }
}
