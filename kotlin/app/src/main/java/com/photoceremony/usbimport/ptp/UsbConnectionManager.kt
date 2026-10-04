package com.photoceremony.usbimport.ptp

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager

import com.photoceremony.usbimport.db.ImportDatabase
import com.photoceremony.usbimport.legacy_mtp.ImportSession
import com.photoceremony.usbimport.model.ImportEvent
import com.photoceremony.usbimport.sony.SonyPtpOpcodes
import com.photoceremony.usbimport.sony.SonyRemoteSession
import com.photoceremony.usbimport.sony.UsbEventLogger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import timber.log.Timber

/**
 * Singleton that orchestrates the full USB connection handshake:
 *
 *   1. Vendor gate      — reject non-Sony devices silently
 *   2. Permission gate  — call [UsbManager.requestPermission]; wait for result
 *   3. Mode check       — verify PC Remote mode via [DeviceChecker]
 *   4. Emit state       — publish a [ConnectionState] that UI/service observe
 *
 * This object is intentionally process-scoped (Kotlin `object`) so that both
 * [com.photoceremony.usbimport.service.ImportService] and
 * [com.photoceremony.usbimport.ui.MainActivity] read the same [StateFlow]
 * without needing AIDL or a bound-service interface.
 *
 * Connection mode checking ([DeviceChecker.checkConnectionMode]) runs on [Dispatchers.IO]
 * so the main thread is never blocked.
 */
object UsbConnectionManager {

    // ── Public USB permission action (must match receiver's intent-filter) ────
    const val ACTION_USB_PERMISSION = "com.photoceremony.usbimport.USB_PERMISSION"

    // ── State ─────────────────────────────────────────────────────────────────

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Idle)

    /**
     * UI and service components should collect this flow to drive their
     * display and import logic respectively.
     */
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    /**
     * The active [SonyRemoteSession] when the camera is in PC Remote mode and
     * the SDIO handshake succeeded.  Null in all other states.
     *
     * Owned by [UsbConnectionManager] (not [ConnectionState]) so that a
     * raw [android.hardware.usb.UsbDeviceConnection] is not exposed to the
     * UI layer.  [com.photoceremony.usbimport.service.ImportService] uses
     * this to call [SonyRemoteSession.triggerCaptureAndDownload].
     */
    @Volatile
    var activeRemoteSession: SonyRemoteSession? = null
        private set

    private var remoteShootingJob: Job? = null

    // ── Internal coroutine scope ──────────────────────────────────────────────

    /**
     * Supervisor scope survives individual child-job failures so a broken
     * handshake does not silence the whole manager.
     */
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    // ── Handle USB device attached ────────────────────────────────────────────

    /**
     * Called by [com.photoceremony.usbimport.service.ImportService] when
     * [UsbManager.ACTION_USB_DEVICE_ATTACHED] fires.
     *
     * • If the device is not Sony → emit [ConnectionState.ErrorNotSony] briefly,
     *   then revert to [ConnectionState.Idle].
     * • If the device is Sony and permission is already granted → proceed directly
     *   to [runMtpHandshake].
     * • If permission is not yet granted → emit [ConnectionState.PermissionRequested]
     *   and call [UsbManager.requestPermission]; result comes via
     *   [handlePermissionResult].
     */
    fun handleDeviceAttached(context: Context, device: UsbDevice) {
        // ── Attach-sequence anchor log ────────────────────────────────────────
        Timber.i(
            "USB_DEVICE_ATTACHED → UsbConnectionManager.handleDeviceAttached() ENTRY " +
            "— VID=0x%04X PID=0x%04X name=%s",
            device.vendorId, device.productId, device.deviceName
        )
        com.photoceremony.usbimport.sony.UsbEventLogger.log(
            "USB_ATTACH",
            "handleDeviceAttached() VID=0x%04X PID=0x%04X name=%s".format(
                device.vendorId, device.productId, device.deviceName
            )
        )

        // Gate 1: Vendor check
        if (!DeviceChecker.isSonyDevice(device)) {
            Timber.w("Ignoring non-Sony device (VID=0x%04X)", device.vendorId)
            _state.value = ConnectionState.ErrorNotSony(device.vendorId, device.productId)
            return
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        // Gate 2: Permission check
        if (usbManager.hasPermission(device)) {
            Timber.d("USB permission already granted — starting connection handshake")
            com.photoceremony.usbimport.sony.UsbEventLogger.log(
                "USB_ATTACH",
                "Permission already granted for ${device.deviceName}. Starting auto connection handshake."
            )
            runConnectionHandshake(context, device, usbManager)
        } else {
            Timber.d("Requesting USB permission for %s", device.deviceName)
            com.photoceremony.usbimport.sony.UsbEventLogger.log(
                "USB_PERM",
                "Permission needed for ${device.deviceName}. Requesting..."
            )
            _state.value = ConnectionState.PermissionRequested(device)
            requestPermission(context, device, usbManager)
        }
    }

    // ── Handle permission result ──────────────────────────────────────────────

    /**
     * Called by [com.photoceremony.usbimport.receiver.UsbPermissionReceiver]
     * when the user responds to the system permission dialog.
     *
     * @param granted true if the user tapped "Allow", false if "Deny".
     */
    fun handlePermissionResult(context: Context, device: UsbDevice, granted: Boolean) {
        com.photoceremony.usbimport.sony.UsbEventLogger.log(
            "USB_PERM",
            "Permission dialog result for ${device.deviceName}: granted=$granted"
        )
        if (!granted) {
            Timber.w("USB permission denied for %s", device.deviceName)
            _state.value = ConnectionState.PermissionDenied(device)
            return
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        Timber.i("USB permission granted for %s — starting connection handshake", device.deviceName)
        com.photoceremony.usbimport.sony.UsbEventLogger.log(
            "USB_PERM",
            "Permission granted for ${device.deviceName}. Starting auto connection handshake."
        )
        runConnectionHandshake(context, device, usbManager)
    }

    // ── Handle device detached ────────────────────────────────────────────────

    /**
     * Called when [UsbManager.ACTION_USB_DEVICE_DETACHED] fires.
     * Closes any open session and resets state to [ConnectionState.Idle].
     */
    fun handleDeviceDetached(device: UsbDevice) {
        Timber.i("USB device detached: %s", device.deviceName)
        com.photoceremony.usbimport.sony.UsbEventLogger.log(
            "USB_DETACH",
            "USB device detached: ${device.deviceName}"
        )

        val current = _state.value
        if (current is ConnectionState.RemoteShooting && current.device == device) {
            Timber.d("Closing SonyRemoteSession for detached device")
            safeRemoteSessionClose()
        }
        _state.value = ConnectionState.Idle
    }

    // ── Reset ─────────────────────────────────────────────────────────────────

    fun reset() {
        if (_state.value is ConnectionState.RemoteShooting) {
            safeRemoteSessionClose()
        }
        _state.value = ConnectionState.Idle
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun requestPermission(context: Context, device: UsbDevice, usbManager: UsbManager) {
        com.photoceremony.usbimport.sony.UsbEventLogger.log(
            "USB_PERM",
            "requestPermission() called via PendingIntent for ${device.deviceName} (deviceId=${device.deviceId})"
        )
        val permissionIntent = PendingIntent.getBroadcast(
            context,
            /* requestCode = */ device.deviceId,
            Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        usbManager.requestPermission(device, permissionIntent)
    }

    /**
     * Runs the connection mode check on [Dispatchers.IO] so [DeviceChecker]'s
     * blocking USB calls never touch the main thread.
     *
     * ## Banner semantics
     *
     * - [ConnectionState.ErrorPcRemote] ("Wrong USB Mode Detected") is emitted
     *   **only** when [DeviceChecker] confirms MTP mode via interface-claim probe.
     *   It is NOT emitted for transport errors.
     *
     * - [ConnectionState.ErrorConnectionFailed] is emitted for any USB transport
     *   or SDIO error that happens AFTER the camera has already been confirmed to
     *   be in PC Remote mode. A 0x201E (SessionAlreadyOpen) response, a timing
     *   race on claimInterface, etc. all land here — NOT in ErrorPcRemote.
     *   This distinction is important: transport errors are transient and
     *   recoverable (replug / retry); MTP-mode errors require a camera-menu change.
     */
    private fun runConnectionHandshake(
        context: Context,
        device: UsbDevice,
        usbManager: UsbManager,
    ) {
        _state.value = ConnectionState.Connecting(device)

        scope.launch(com.photoceremony.usbimport.sony.PtpUsbTransport.usbDispatcher) {
            com.photoceremony.usbimport.sony.PtpUsbTransport.withExclusiveSession {
                val result = DeviceChecker.checkConnectionMode(device, usbManager)

                val newState: ConnectionState = when (result) {
                    is DeviceChecker.ConnectionModeResult.RemoteShootingReady -> {
                        Timber.i("DeviceChecker confirmed PC Remote mode — attempting Sony SDIO handshake")
                        val remoteSession = SonyRemoteSession(device, usbManager)
                        try {
                            remoteSession.connect()
                            val model = remoteSession.baseDeviceInfo?.model ?: device.productName ?: "Sony Camera"
                            Timber.i("SDIO handshake OK — entering RemoteShooting mode for %s", model)
                            UsbEventLogger.log("USB_SESSION", "SDIO handshake OK — entering RemoteShooting mode for $model")
                            activeRemoteSession = remoteSession
                            startRemoteShootingLoop(context.applicationContext, remoteSession, model)
                            ConnectionState.RemoteShooting(device = device, model = model)
                        } catch (e: Exception) {
                            // Camera is in PC Remote mode but the SDIO handshake failed.
                            // This is a TRANSPORT error (claimInterface race, session stale,
                            // 0x201E, etc.) — NOT a mode error. Emit ErrorConnectionFailed so
                            // the UI shows a recoverable error instead of the hard "Wrong USB
                            // Mode Detected" banner (which implies the user must change a
                            // camera menu setting — that is wrong here).
                            Timber.w(
                                e,
                                "SDIO handshake failed — transport error on confirmed PC Remote device. " +
                                "Emitting ErrorConnectionFailed (not ErrorPcRemote)."
                            )
                            remoteSession.close()
                            ConnectionState.ErrorConnectionFailed(
                                device = device,
                                reason = "SDIO handshake failed: ${e.message ?: e::class.simpleName}"
                            )
                        }
                    }

                    is DeviceChecker.ConnectionModeResult.WrongMode -> {
                        // Camera is confirmed in MTP mode (claimInterface failed while MTP
                        // driver holds the interface). Show the hard block.
                        Timber.w(
                            "Camera confirmed in MTP / wrong mode — %s. Emitting ErrorPcRemote.",
                            result.reason
                        )
                        ConnectionState.ErrorPcRemote(device)
                    }
                }

                _state.value = newState
            }
        }
    }

    private fun startRemoteShootingLoop(
        context: Context,
        session: SonyRemoteSession,
        model: String
    ) {
        stopRemoteShootingLoop()
        ImportSession.resetForNewSession()

        remoteShootingJob = scope.launch(Dispatchers.IO) {
            UsbEventLogger.log("REMOTE_LOOP", "Started event-listening loop on EP3 interrupt endpoint (sessionOpen=${session.isSessionOpen})")
            val dao = try {
                ImportDatabase.getInstance(context).downloadedFileDao()
            } catch (e: Exception) {
                Timber.w(e, "Error initializing DownloadedFileDao")
                UsbEventLogger.log("REMOTE_LOOP", "Error initializing DownloadedFileDao: ${e.message}")
                null
            }

            var pollCount = 0
            while (isActive && session.isSessionOpen) {
                pollCount++
                if (pollCount % 10 == 0) {
                    UsbEventLogger.log("REMOTE_LOOP", "Heartbeat: listening on EP3 (active=$isActive, sessionOpen=${session.isSessionOpen})")
                }

                try {
                    val event = session.pollEventNonBlocking(timeoutMs = 1500)
                    if (event != null) {
                        Timber.i("remoteShootingLoop: event received code=0x%04X param1=0x%08X params=%s", event.code, event.param1, event.params.toList())
                        UsbEventLogger.log("REMOTE_LOOP", "Event received on EP3: code=0x%04X param1=0x%08X params=%s".format(event.code, event.param1, event.params.toList()))

                        val isObjectAdded = event.code == SonyPtpOpcodes.EVENT_OBJECT_ADDED ||
                                event.code == 0xC206 ||
                                event.code == 0x4002

                        if (isObjectAdded) {
                            val handleRaw: UInt = event.param1.toUInt()
                            if (handleRaw == 0u) {
                                Timber.w("remoteShootingLoop: ObjectAdded with handle == 0 (0x%04X), skipping", event.code)
                                UsbEventLogger.log("CAPTURE_EVENT", "ObjectAdded (0x%04X) with handle == 0, skipping genuine 0".format(event.code))
                            } else {
                                val handle = event.param1
                                Timber.i("remoteShootingLoop: ObjectAdded (0x%04X) matched! handle=0x%08X (%d)", event.code, handleRaw.toInt(), handle)
                                UsbEventLogger.log("CAPTURE_EVENT", "ObjectAdded (0x%04X) matched! handle=0x%08X -> downloading...".format(event.code, handleRaw.toInt()))

                                ImportSession.emitEvent(ImportEvent.ImportStarted(handle))

                                try {
                                    val record = session.fetchAndSaveObject(context, handle)
                                    Timber.i("remoteShootingLoop: successfully downloaded '%s' (%s)", record.filename, record.formattedSize)
                                    UsbEventLogger.log("CAPTURE_EVENT", "Successfully downloaded ${record.filename} (${record.formattedSize})")
                                    ImportSession.recordImportCompleted(record, dao)
                                } catch (downloadEx: Exception) {
                                    Timber.e(downloadEx, "remoteShootingLoop: download failed for handle=0x%08X: %s", handleRaw.toInt(), downloadEx.message)
                                    UsbEventLogger.log("CAPTURE_EVENT", "Download failed for handle=0x%08X: ${downloadEx.message}".format(handleRaw.toInt()))
                                    ImportSession.emitEvent(ImportEvent.ImportFailed(handle, downloadEx.message ?: "download error"))
                                }
                            }
                        } else if (event.code == SonyPtpOpcodes.EVENT_PROPERTY_CHANGED) {
                            UsbEventLogger.log("REMOTE_LOOP", "Camera property changed: DPC=0x%04X".format(event.param1))
                        }
                    }
                } catch (pollEx: Exception) {
                    Timber.w(pollEx, "remoteShootingLoop: unexpected poll exception")
                    UsbEventLogger.log("REMOTE_LOOP", "Unexpected poll exception: ${pollEx.message}")
                }

                yield()
            }

            Timber.d("remoteShootingLoop: exited cleanly (isActive=%b, sessionOpen=%b)", isActive, session.isSessionOpen)
            UsbEventLogger.log("REMOTE_LOOP", "remoteShootingLoop exited cleanly (isActive=$isActive, sessionOpen=${session.isSessionOpen})")
        }
    }

    private fun stopRemoteShootingLoop() {
        remoteShootingJob?.cancel()
        remoteShootingJob = null
    }

    fun resetActiveSession() {
        safeRemoteSessionClose()
    }

    private fun safeRemoteSessionClose() {
        stopRemoteShootingLoop()
        try {
            activeRemoteSession?.close()
        } catch (e: Exception) {
            Timber.w(e, "Exception closing SonyRemoteSession (ignored)")
        } finally {
            activeRemoteSession = null
        }
    }
}
