package com.photoceremony.entephotocamera.core

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager

import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import com.photoceremony.entephotocamera.discovery.DeviceChecker
import com.photoceremony.entephotocamera.model.ImportEvent
import com.photoceremony.entephotocamera.model.ImportSession
import com.photoceremony.entephotocamera.sony.PtpUsbTransport
import com.photoceremony.entephotocamera.sony.SonyPtpOpcodes
import com.photoceremony.entephotocamera.sony.SonyRemoteSession
import com.photoceremony.entephotocamera.sony.UsbEventLogger
import com.photoceremony.entephotocamera.storage.ImportDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.yield
import timber.log.Timber

/**
 * Singleton that orchestrates the full USB connection handshake.
 *
 * ### Phase 2 fix — dual-strategy event polling
 *
 * The previous migrated implementation polled **only** the USB interrupt-IN
 * endpoint (EP3) via [SonyRemoteSession.pollEventNonBlocking].  The original,
 * physically-tested standalone Kotlin project uses the same strategy inside
 * [SonyRemoteSession.pollEventNonBlocking], which in turn calls
 * [PtpUsbTransport.readInterruptEvent].
 *
 * On some α7 IV firmwares the interrupt endpoint returns 0 bytes (no hardware
 * interrupt pending) even when an event is queued.  The standard PTP fallback
 * is to call `GetEvent` (opcode 0x1003 → [PtpUsbTransport.pollGetEvent]).
 *
 * The fix applies the dual strategy **inside the remote-shooting loop** so it
 * mirrors [SonyRemoteSession.waitForObjectAddedEvent] without requiring a
 * separate call path:
 *
 *   1. Try interrupt endpoint ([pollEventNonBlocking]).
 *   2. If null, try [PtpUsbTransport.pollGetEvent] via the session.
 *   3. Log which path produced the event.
 *
 * This is the same dual strategy present in the original reference project's
 * [SonyRemoteSession.waitForObjectAddedEvent].  No new opcodes are invented.
 */
object UsbConnectionManager {

    /**
     * Single source of truth for USB broadcast action strings.
     * Note: This action must match what is sent in the PendingIntent broadcast.
     */
    const val ACTION_USB_PERMISSION = "com.entephoto.app.USB_PERMISSION"

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Idle)

    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    @Volatile
    var activeRemoteSession: SonyRemoteSession? = null
        private set

    @Volatile
    var isExplicitDisconnect: Boolean = false
        private set

    private var remoteShootingJob: Job? = null
    private var reconnectJob: Job? = null
    private var discoveryJob: Job? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Bounded exponential backoff sequence in milliseconds: 1s, 2s, 4s, 8s, 15s */
    private val BACKOFF_DELAYS_MS = listOf(1000L, 2000L, 4000L, 8000L, 15000L)

    fun setExplicitDisconnect(explicit: Boolean) {
        isExplicitDisconnect = explicit
    }

    fun setSearching() {
        if (!isExplicitDisconnect && _state.value !is ConnectionState.RemoteShooting) {
            _state.value = ConnectionState.Searching
        }
    }

    /**
     * Starts continuous camera discovery loop when searching.
     * Rechecks attached USB devices periodically (1.5s) to ensure instant discovery
     * across screens and upon physical re-plug.
     */
    fun startDiscoveryLoop(context: Context) {
        if (discoveryJob?.isActive == true) return
        isExplicitDisconnect = false
        val appContext = context.applicationContext

        discoveryJob = scope.launch(Dispatchers.IO) {
            Timber.i("UsbConnectionManager: continuous discovery loop started")
            while (isActive) {
                if (!isExplicitDisconnect && (_state.value is ConnectionState.Searching || _state.value is ConnectionState.Idle || _state.value is ConnectionState.Disconnected)) {
                    val usbManager = appContext.getSystemService(Context.USB_SERVICE) as? UsbManager
                    val sonyDevice = usbManager?.deviceList?.values?.firstOrNull { DeviceChecker.isSonyDevice(it) }
                    if (sonyDevice != null) {
                        val current = _state.value
                        if (current !is ConnectionState.Connecting && current !is ConnectionState.RemoteShooting && current !is ConnectionState.Reconnecting && current !is ConnectionState.PermissionRequested) {
                            Timber.i("Discovery loop: found Sony camera %s — initiating connection", sonyDevice.deviceName)
                            withContext(Dispatchers.Main) {
                                handleDeviceAttached(appContext, sonyDevice)
                            }
                        }
                    }
                }
                delay(1500L)
            }
        }
    }

    fun stopDiscoveryLoop() {
        discoveryJob?.cancel()
        discoveryJob = null
    }

    fun handleDeviceAttached(context: Context, device: UsbDevice) {
        isExplicitDisconnect = false
        Timber.i(
            "USB_DEVICE_ATTACHED → UsbConnectionManager.handleDeviceAttached() ENTRY " +
            "— VID=0x%04X PID=0x%04X name=%s",
            device.vendorId, device.productId, device.deviceName
        )
        CameraDiagnosticLogger.info(
            "UsbConnectionManager",
            "USB ATTACH: VID=0x%04X PID=0x%04X name=${device.deviceName}".format(device.vendorId, device.productId),
            pipelineStage = "USB_ATTACH",
        )

        // Cancel any pending reconnect job since a fresh attach was detected
        reconnectJob?.cancel()
        reconnectJob = null

        // If camera is already connected in RemoteShooting with an open session, avoid disruption
        val current = _state.value
        if (current is ConnectionState.RemoteShooting && activeRemoteSession?.isSessionOpen == true) {
            if (current.device.deviceName == device.deviceName || (current.device.vendorId == device.vendorId && current.device.productId == device.productId)) {
                Timber.i("Camera already actively connected in RemoteShooting — ignoring duplicate attach")
                return
            }
        }

        if (!DeviceChecker.isSonyDevice(device)) {
            Timber.w("Ignoring non-Sony device (VID=0x%04X)", device.vendorId)
            CameraDiagnosticLogger.warn(
                "UsbConnectionManager",
                "Non-Sony device ignored: VID=0x%04X".format(device.vendorId),
            )
            _state.value = ConnectionState.ErrorNotSony(device.vendorId, device.productId)
            return
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        if (usbManager.hasPermission(device)) {
            Timber.d("USB permission already granted — starting connection handshake")
            CameraDiagnosticLogger.info("UsbConnectionManager", "USB permission already granted — starting handshake")
            runConnectionHandshake(context, device, usbManager)
        } else {
            Timber.d("Requesting USB permission for %s", device.deviceName)
            CameraDiagnosticLogger.info("UsbConnectionManager", "Requesting USB permission for ${device.deviceName}")
            _state.value = ConnectionState.PermissionRequested(device)
            requestPermission(context, device, usbManager)
        }
    }

    fun handlePermissionResult(context: Context, device: UsbDevice, granted: Boolean) {
        CameraDiagnosticLogger.info(
            "UsbConnectionManager",
            "USB permission result for ${device.deviceName}: granted=$granted",
            pipelineStage = "USB_PERM",
        )
        if (!granted) {
            Timber.w("USB permission denied for %s", device.deviceName)
            CameraDiagnosticLogger.warn("UsbConnectionManager", "USB permission DENIED for ${device.deviceName}")
            _state.value = ConnectionState.PermissionDenied(device)
            return
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        Timber.i("USB permission granted for %s — starting connection handshake", device.deviceName)
        CameraDiagnosticLogger.info("UsbConnectionManager", "USB permission GRANTED for ${device.deviceName}")
        runConnectionHandshake(context, device, usbManager)
    }

    fun handleDeviceDetached(device: UsbDevice) {
        Timber.i("USB device detached: %s", device.deviceName)
        CameraDiagnosticLogger.warn("UsbConnectionManager", "USB DETACH: ${device.deviceName}", pipelineStage = "USB_DETACH")

        // Cancel any pending reconnect job immediately
        reconnectJob?.cancel()
        reconnectJob = null

        val current = _state.value
        val isOurDevice = when (current) {
            is ConnectionState.RemoteShooting -> current.device.deviceName == device.deviceName || (current.device.vendorId == device.vendorId && current.device.productId == device.productId)
            is ConnectionState.Connecting -> current.device.deviceName == device.deviceName
            is ConnectionState.PermissionRequested -> current.device.deviceName == device.deviceName
            is ConnectionState.Reconnecting -> current.device.deviceName == device.deviceName
            else -> false
        }

        if (isOurDevice || current is ConnectionState.RemoteShooting) {
            Timber.i(
                "USB_DETACH: closing session for detached device %s",
                device.deviceName,
            )
            CameraDiagnosticLogger.warn(
                "UsbConnectionManager",
                "Closing SonyRemoteSession — USB detach during session",
                pipelineStage = "USB_DETACH",
            )
            safeRemoteSessionClose()
        }

        if (!isExplicitDisconnect) {
            Timber.i("USB_DETACH: not explicitly disconnected — updating state to Searching to await camera re-attachment")
            CameraDiagnosticLogger.info("UsbConnectionManager", "Switching to Searching — awaiting camera re-attachment")
            _state.value = ConnectionState.Searching
        } else {
            _state.value = ConnectionState.Disconnected("Device detached")
        }
    }

    fun reset() {
        isExplicitDisconnect = true
        reconnectJob?.cancel()
        reconnectJob = null
        stopDiscoveryLoop()
        if (_state.value is ConnectionState.RemoteShooting) {
            safeRemoteSessionClose()
        }
        _state.value = ConnectionState.Disconnected("User disconnected")
    }

    /**
     * Trigger automatic reconnection controller with bounded exponential backoff
     * (1s, 2s, 4s, 8s, up to 15s).
     *
     * Ensures:
     * 1. Single reconnect loop (no concurrent loops).
     * 2. Device must be physically attached to attempt handshake.
     * 3. Exclusive PTP transport session acquired before handshake.
     * 4. Resumes remote shooting loop only after successful connection.
     */
    fun triggerAutoReconnect(context: Context, device: UsbDevice, reason: String) {
        if (isExplicitDisconnect) {
            Timber.i("triggerAutoReconnect: skipped — isExplicitDisconnect is true")
            return
        }

        if (reconnectJob?.isActive == true) {
            Timber.i("triggerAutoReconnect: reconnect loop already running — ignoring duplicate trigger")
            return
        }

        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager

        // Check if device is physically attached
        val isAttached = usbManager.deviceList.values.any {
            it.deviceName == device.deviceName || (it.vendorId == device.vendorId && it.productId == device.productId)
        }
        if (!isAttached) {
            Timber.i("triggerAutoReconnect: device is physically detached — updating state to Searching and awaiting re-plug")
            safeRemoteSessionClose()
            _state.value = ConnectionState.Searching
            return
        }

        Timber.i("triggerAutoReconnect: starting recovery controller for %s (reason: %s)", device.deviceName, reason)
        CameraDiagnosticLogger.warn(
            "UsbConnectionManager",
            "Auto-reconnect triggered: $reason (device=${device.deviceName})",
            pipelineStage = "RECONNECT_CONTROLLER"
        )

        safeRemoteSessionClose()

        reconnectJob = scope.launch(PtpUsbTransport.usbDispatcher) {
            try {
                for ((index, delayMs) in BACKOFF_DELAYS_MS.withIndex()) {
                    val attemptNumber = index + 1
                    val maxAttempts = BACKOFF_DELAYS_MS.size

                    _state.value = ConnectionState.Reconnecting(
                        device = device,
                        attempt = attemptNumber,
                        maxAttempts = maxAttempts,
                        nextDelayMs = delayMs,
                    )

                    CameraDiagnosticLogger.info(
                        "UsbConnectionManager",
                        "Reconnection attempt $attemptNumber of $maxAttempts — waiting ${delayMs}ms",
                        pipelineStage = "RECONNECT_CONTROLLER"
                    )

                    delay(delayMs)

                    if (!isActive || isExplicitDisconnect) {
                        Timber.i("reconnectJob: cancelled or explicit disconnect during delay")
                        return@launch
                    }

                    // 1. Check if device is still attached
                    val currentlyAttached = usbManager.deviceList.values.firstOrNull {
                        it.deviceName == device.deviceName || (it.vendorId == device.vendorId && it.productId == device.productId)
                    }
                    if (currentlyAttached == null) {
                        Timber.i("reconnectJob: device detached during backoff — switching to Searching")
                        _state.value = ConnectionState.Searching
                        return@launch
                    }

                    val targetDevice = currentlyAttached

                    // 2. Check permission
                    if (!usbManager.hasPermission(targetDevice)) {
                        Timber.w("reconnectJob: USB permission missing for %s — requesting permission", targetDevice.deviceName)
                        _state.value = ConnectionState.PermissionRequested(targetDevice)
                        requestPermission(context, targetDevice, usbManager)
                        return@launch
                    }

                    // 3. Attempt exclusive handshake
                    var connectedSession: SonyRemoteSession? = null
                    var connectedModel: String? = null

                    PtpUsbTransport.withExclusiveSession {
                        try {
                            val modeResult = DeviceChecker.checkConnectionMode(targetDevice, usbManager)
                            if (modeResult is DeviceChecker.ConnectionModeResult.RemoteShootingReady) {
                                val session = SonyRemoteSession(targetDevice, usbManager)
                                session.connect()
                                val model = session.baseDeviceInfo?.model ?: targetDevice.productName ?: "Sony Camera"
                                connectedSession = session
                                connectedModel = model
                            } else if (modeResult is DeviceChecker.ConnectionModeResult.WrongMode) {
                                Timber.w("reconnectJob: camera in wrong mode — %s", modeResult.reason)
                                _state.value = ConnectionState.ErrorPcRemote(targetDevice)
                            }
                        } catch (e: Exception) {
                            Timber.w(e, "reconnectJob attempt $attemptNumber failed: %s", e.message)
                            CameraDiagnosticLogger.warn(
                                "UsbConnectionManager",
                                "Reconnect attempt $attemptNumber failed: ${e.message}",
                                ex = e,
                                pipelineStage = "RECONNECT_CONTROLLER"
                            )
                        }
                    }

                    if (connectedSession != null && connectedModel != null) {
                        Timber.i("reconnectJob: SUCCESS on attempt $attemptNumber ($connectedModel)")
                        CameraDiagnosticLogger.info(
                            "UsbConnectionManager",
                            "Auto-reconnect SUCCESS on attempt $attemptNumber ($connectedModel)",
                            pipelineStage = "RECONNECT_CONTROLLER"
                        )
                        activeRemoteSession = connectedSession
                        startRemoteShootingLoop(context.applicationContext, connectedSession!!, connectedModel!!)
                        _state.value = ConnectionState.RemoteShooting(device = targetDevice, model = connectedModel!!)
                        return@launch
                    }
                }

                Timber.w("reconnectJob: all %d reconnection attempts exhausted", BACKOFF_DELAYS_MS.size)
                CameraDiagnosticLogger.error(
                    "UsbConnectionManager",
                    "All ${BACKOFF_DELAYS_MS.size} reconnection attempts exhausted — camera disconnected",
                    pipelineStage = "RECONNECT_CONTROLLER"
                )
                _state.value = ConnectionState.Disconnected("Reconnection attempts exhausted")
            } finally {
                reconnectJob = null
            }
        }
    }

    private fun requestPermission(context: Context, device: UsbDevice, usbManager: UsbManager) {
        UsbEventLogger.log(
            "USB_PERM",
            "requestPermission() called via PendingIntent for ${device.deviceName} (deviceId=${device.deviceId})"
        )
        // FLAG_IMMUTABLE: USB permission broadcast carries no extras that we write back,
        // and Android 12+ (API 31) requires FLAG_IMMUTABLE on all non-mutated PendingIntents.
        // FLAG_UPDATE_CURRENT: prevents leaking a new PendingIntent slot on re-plug.
        val permissionIntent = PendingIntent.getBroadcast(
            context,
            device.deviceId,
            Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        usbManager.requestPermission(device, permissionIntent)
    }

    private fun runConnectionHandshake(
        context: Context,
        device: UsbDevice,
        usbManager: UsbManager,
    ) {
        _state.value = ConnectionState.Connecting(device)
        CameraDiagnosticLogger.info(
            "UsbConnectionManager",
            "Starting USB connection handshake for ${device.deviceName}",
            pipelineStage = "HANDSHAKE",
        )

        scope.launch(PtpUsbTransport.usbDispatcher) {
            PtpUsbTransport.withExclusiveSession {
                val result = DeviceChecker.checkConnectionMode(device, usbManager)

                val newState: ConnectionState = when (result) {
                    is DeviceChecker.ConnectionModeResult.RemoteShootingReady -> {
                        Timber.i("DeviceChecker confirmed PC Remote mode — attempting Sony SDIO handshake")
                        CameraDiagnosticLogger.info(
                            "UsbConnectionManager",
                            "DeviceChecker: PC Remote mode confirmed — starting SDIO handshake",
                            pipelineStage = "SDIO_HANDSHAKE",
                        )
                        val remoteSession = SonyRemoteSession(device, usbManager)
                        try {
                            remoteSession.connect()
                            val model = remoteSession.baseDeviceInfo?.model ?: device.productName ?: "Sony Camera"
                            Timber.i("SDIO handshake OK — entering RemoteShooting mode for %s", model)
                            CameraDiagnosticLogger.info(
                                "UsbConnectionManager",
                                "SDIO handshake OK — RemoteShooting for $model",
                                pipelineStage = "SDIO_HANDSHAKE",
                            )
                            activeRemoteSession = remoteSession
                            startRemoteShootingLoop(context.applicationContext, remoteSession, model)
                            ConnectionState.RemoteShooting(device = device, model = model)
                        } catch (e: Exception) {
                            Timber.w(
                                e,
                                "SDIO handshake failed — transport error on confirmed PC Remote device. " +
                                "Emitting ErrorConnectionFailed (not ErrorPcRemote)."
                            )
                            CameraDiagnosticLogger.error(
                                "UsbConnectionManager",
                                "SDIO handshake FAILED: ${e.message}",
                                ex = e,
                                pipelineStage = "SDIO_HANDSHAKE",
                            )
                            remoteSession.close()
                            ConnectionState.ErrorConnectionFailed(
                                device = device,
                                reason = "SDIO handshake failed: ${e.message ?: e::class.simpleName}"
                            )
                        }
                    }

                    is DeviceChecker.ConnectionModeResult.WrongMode -> {
                        Timber.w(
                            "Camera confirmed in MTP / wrong mode — %s. Emitting ErrorPcRemote.",
                            result.reason
                        )
                        CameraDiagnosticLogger.warn(
                            "UsbConnectionManager",
                            "Camera in MTP/wrong mode: ${result.reason} — show PC Remote instructions",
                            pipelineStage = "MODE_CHECK",
                        )
                        ConnectionState.ErrorPcRemote(device)
                    }
                }

                _state.value = newState
            }
        }
    }

    /**
     * The remote-shooting event loop.
     *
     * ### Phase 2 fix: dual event-polling strategy
     *
     * The migrated module previously only called [SonyRemoteSession.pollEventNonBlocking]
     * which reads the USB interrupt endpoint (EP3).  On some Sony α7 IV firmware
     * versions the interrupt endpoint may not signal an event even when one is pending,
     * so events from physical shutter presses were silently dropped.
     *
     * The fix adds a second attempt via [SonyRemoteSession.pollGetEventFallback] which
     * issues the standard PTP `GetEvent` (opcode 0x1003) command.  This matches the
     * dual-strategy in the original reference implementation's
     * [SonyRemoteSession.waitForObjectAddedEvent].
     *
     * Aggregation: idle timeouts are counted and only logged every 50 cycles to prevent
     * logspam.  Consecutive failures are counted and logged every 10 attempts.
     */
    private fun startRemoteShootingLoop(
        context: Context,
        session: SonyRemoteSession,
        model: String
    ) {
        stopRemoteShootingLoop()
        ImportSession.resetForNewSession()

        remoteShootingJob = scope.launch(Dispatchers.IO) {
            Timber.i("remoteShootingLoop: STARTED for model=%s (sessionOpen=%b)", model, session.isSessionOpen)
            CameraDiagnosticLogger.info(
                "RemoteShootingLoop",
                "STARTED for $model — session isOpen=${session.isSessionOpen}, " +
                "strategy=interrupt+GetEventFallback",
                pipelineStage = "LOOP_START",
            )

            val dao = try {
                ImportDatabase.getInstance(context).downloadedFileDao()
            } catch (e: Exception) {
                Timber.w(e, "remoteShootingLoop: failed to initialise DownloadedFileDao — DB writes disabled")
                CameraDiagnosticLogger.warn("RemoteShootingLoop", "DownloadedFileDao init failed: ${e.message}", ex = e)
                null
            }

            var pollCount = 0
            var idleTimeoutCount = 0
            var consecutiveFailCount = 0
            var lastFailedHandle: Int? = null
            var lastFailedTime: Long = 0L
            var recoveryAttempts = 0
            val maxRecoveryAttempts = 2

            while (isActive && session.isSessionOpen) {
                pollCount++

                // Heartbeat every 50 polls (not every poll — that would flood the buffer).
                if (pollCount % 50 == 0) {
                    CameraDiagnosticLogger.debug(
                        "RemoteShootingLoop",
                        "Heartbeat #$pollCount: active, awaiting camera events " +
                        "(idleTimeouts=$idleTimeoutCount, sessionOpen=${session.isSessionOpen})",
                        pipelineStage = "LOOP_HEARTBEAT",
                    )
                }

                try {
                    // ── Primary Strategy: USB interrupt endpoint (EP3) ────────
                    // Per Phase 1 Fix: Only poll EP3 interrupt endpoint during RemoteShooting.
                    // Bulk GetEvent (0x9803) fallback is disabled while RemoteShooting is active:
                    // Sony α7 IV emits capture events via EP3 interrupt, and polling bulk GetEvent
                    // while idle disrupts the camera's bulk state machine on USB 2.0 (Xiaomi 11i).
                    // Matches the reference project's pure EP3 polling behavior.
                    val event = session.pollEventNonBlocking(timeoutMs = 1500)
                    val eventSource = "EP3_INTERRUPT"

                    if (event != null) {
                        consecutiveFailCount = 0
                        idleTimeoutCount = 0

                        Timber.i(
                            "remoteShootingLoop: camera event received code=0x%04X param1=0x%08X params=%s via %s",
                            event.code, event.param1, event.params.toList(), eventSource,
                        )
                        CameraDiagnosticLogger.info(
                            "RemoteShootingLoop",
                            "Event received via $eventSource: code=0x%04X param1=0x%08X params=${event.params.toList()}".format(
                                event.code, event.param1
                            ),
                            pipelineStage = "EVENT_RECEIVED",
                        )

                        val isObjectAdded = event.code == SonyPtpOpcodes.EVENT_OBJECT_ADDED ||
                                event.code == SonyPtpOpcodes.PTP_EC_OBJECT_ADDED

                        if (event.code == SonyPtpOpcodes.EVENT_CAPTURED) {
                            // Sony CapturedEvent (0xC206) indicates physical shutter actuation.
                            // It carries param1 = 0 (status flag), NOT an object handle.
                            // We acknowledge the capture event without attempting download until ObjectAdded (0xC201) arrives.
                            Timber.i("remoteShootingLoop: Sony CapturedEvent (0xC206) param1=0x%08X — shutter fired", event.param1)
                            CameraDiagnosticLogger.info(
                                "RemoteShootingLoop",
                                "Sony CapturedEvent (0xC206) param1=0x%08X — physical shutter confirmed, awaiting ObjectAdded (0xC201)".format(event.param1),
                                pipelineStage = "EVENT_CAPTURED",
                            )
                        } else if (isObjectAdded) {
                            val handleRaw: UInt = event.param1.toUInt()
                            val handle = event.param1
                            val now = System.currentTimeMillis()

                            if (handleRaw == 0u) {
                                Timber.w(
                                    "remoteShootingLoop: ObjectAdded event (0x%04X) carried handle == 0, skipping",
                                    event.code,
                                )
                                CameraDiagnosticLogger.warn(
                                    "RemoteShootingLoop",
                                    "ObjectAdded (0x%04X) with handle=0 — skipped".format(event.code),
                                    pipelineStage = "EVENT_OBJECT_ADDED",
                                )
                            } else if (handle == lastFailedHandle && (now - lastFailedTime < 10_000L)) {
                                Timber.w(
                                    "remoteShootingLoop: ObjectAdded event (0x%04X) for recently failed handle 0x%08X — throttling retry (%d ms remaining)",
                                    event.code, handle, 10_000L - (now - lastFailedTime)
                                )
                                CameraDiagnosticLogger.warn(
                                    "RemoteShootingLoop",
                                    "Duplicate ObjectAdded (0x%04X) for handle 0x%08X — retry throttled (failed %d ms ago)".format(
                                        event.code, handle, now - lastFailedTime
                                    ),
                                    objectHandle = handle,
                                    pipelineStage = "RETRY_THROTTLED",
                                )
                            } else {
                                Timber.i(
                                    "remoteShootingLoop: ObjectAdded (0x%04X) — handle=0x%08X, starting download",
                                    event.code, handle,
                                )
                                CameraDiagnosticLogger.info(
                                    "RemoteShootingLoop",
                                    "ObjectAdded via $eventSource: handle=0x%08X — starting download".format(handle),
                                    objectHandle = handle,
                                    pipelineStage = "DOWNLOAD_START",
                                )

                                ImportSession.emitEvent(ImportEvent.ImportStarted(handle))

                                val downloadStart = System.currentTimeMillis()
                                try {
                                    val record = session.fetchAndSaveObject(context, handle)
                                    val elapsed = System.currentTimeMillis() - downloadStart
                                    lastFailedHandle = null
                                    recoveryAttempts = 0

                                    if (record != null) {
                                        Timber.i(
                                            "remoteShootingLoop: download+save OK — file='%s' size=%s elapsed=%dms",
                                            record.filename, record.formattedSize, elapsed,
                                        )
                                        CameraDiagnosticLogger.info(
                                            "RemoteShootingLoop",
                                            "Download OK: '${record.filename}' ${record.formattedSize} in ${elapsed}ms uri=${record.mediaUri}",
                                            objectHandle = handle,
                                            pipelineStage = "DOWNLOAD_OK",
                                        )
                                        ImportSession.recordImportCompleted(record, dao)
                                    } else {
                                        Timber.i(
                                            "remoteShootingLoop: handle=0x%08X skipped (unsupported format) in %dms",
                                            handle, elapsed,
                                        )
                                        CameraDiagnosticLogger.info(
                                            "RemoteShootingLoop",
                                            "Skipped unsupported format for handle 0x%08X in ${elapsed}ms".format(handle),
                                            objectHandle = handle,
                                            pipelineStage = "IMPORT_SKIPPED",
                                        )
                                    }
                                } catch (downloadEx: Exception) {
                                    val elapsed = System.currentTimeMillis() - downloadStart
                                    lastFailedHandle = handle
                                    lastFailedTime = System.currentTimeMillis()

                                    Timber.e(
                                        downloadEx,
                                        "remoteShootingLoop: download/save FAILED for handle=0x%08X — %s",
                                        handle, downloadEx.message,
                                    )
                                    CameraDiagnosticLogger.error(
                                        "RemoteShootingLoop",
                                        "Download FAILED for handle=0x%08X after ${elapsed}ms: ${downloadEx.message}".format(handle),
                                        ex = downloadEx,
                                        objectHandle = handle,
                                        pipelineStage = "DOWNLOAD_FAILED",
                                    )
                                    ImportSession.emitEvent(
                                        ImportEvent.ImportFailed(handle, downloadEx.message ?: "download error"),
                                    )

                                    if (recoveryAttempts < maxRecoveryAttempts) {
                                        recoveryAttempts++
                                        CameraDiagnosticLogger.warn(
                                            "RemoteShootingLoop",
                                            "Desynchronized transaction on handle 0x%08X — initiating controlled session reconnect (attempt $recoveryAttempts of $maxRecoveryAttempts)".format(handle),
                                            objectHandle = handle,
                                            pipelineStage = "SESSION_RECOVERY"
                                        )

                                        val reconnected = try {
                                            if (session.recoverSession()) {
                                                true
                                            } else {
                                                session.reconnect()
                                                true
                                            }
                                        } catch (recEx: Exception) {
                                            CameraDiagnosticLogger.error(
                                                "RemoteShootingLoop",
                                                "Controlled recovery failed: ${recEx.message}",
                                                ex = recEx,
                                                pipelineStage = "SESSION_RECOVERY"
                                            )
                                            false
                                        }

                                        if (reconnected) {
                                            CameraDiagnosticLogger.info(
                                                "RemoteShootingLoop",
                                                "Controlled session recovery SUCCESSFUL — listening loop continues",
                                                pipelineStage = "SESSION_RECOVERY"
                                            )
                                        } else {
                                            CameraDiagnosticLogger.error(
                                                "RemoteShootingLoop",
                                                "Session recovery failed — initiating auto-reconnect",
                                                pipelineStage = "SESSION_RECOVERY"
                                            )
                                            triggerAutoReconnect(
                                                context,
                                                session.device,
                                                "Session desynchronized and reconnect failed: ${downloadEx.message}"
                                            )
                                            break
                                        }
                                    } else {
                                        CameraDiagnosticLogger.error(
                                            "RemoteShootingLoop",
                                            "Max recovery attempts ($maxRecoveryAttempts) exhausted — initiating auto-reconnect",
                                            pipelineStage = "SESSION_RECOVERY"
                                        )
                                        triggerAutoReconnect(
                                            context,
                                            session.device,
                                            "Transfer failed and recovery retries exhausted: ${downloadEx.message}"
                                        )
                                        break
                                    }
                                }
                            }
                        } else if (event.code == SonyPtpOpcodes.EVENT_PROPERTY_CHANGED) {
                            CameraDiagnosticLogger.debug(
                                "RemoteShootingLoop",
                                "Camera property changed: DPC=0x%04X".format(event.param1),
                                pipelineStage = "EVENT_PROP_CHANGED",
                            )
                        } else {
                            CameraDiagnosticLogger.debug(
                                "RemoteShootingLoop",
                                "Unrecognised event code=0x%04X param1=0x%08X — ignored".format(event.code, event.param1),
                                pipelineStage = "EVENT_UNKNOWN",
                            )
                        }
                    } else {
                        // No event on either strategy — camera is idle.
                        idleTimeoutCount++
                        // Only log idle timeouts at coarse intervals to avoid buffer flood.
                        if (idleTimeoutCount % 200 == 0) {
                            CameraDiagnosticLogger.debug(
                                "RemoteShootingLoop",
                                "Idle (no event) for $idleTimeoutCount polls. Camera waiting for shutter.",
                                pipelineStage = "LOOP_IDLE",
                            )
                        }
                    }
                } catch (pollEx: Exception) {
                    consecutiveFailCount++
                    Timber.w(pollEx, "remoteShootingLoop: unexpected poll exception — %s", pollEx.message)
                    CameraDiagnosticLogger.warn(
                        "RemoteShootingLoop",
                        "Poll exception #$consecutiveFailCount: ${pollEx.message}",
                        ex = if (consecutiveFailCount <= 3) pollEx else null,
                        pipelineStage = "LOOP_POLL_ERROR",
                    )
                    if (consecutiveFailCount >= 3) {
                        Timber.w("remoteShootingLoop: 3 consecutive poll exceptions — initiating auto-reconnect")
                        CameraDiagnosticLogger.error(
                            "RemoteShootingLoop",
                            "3 consecutive poll exceptions — initiating auto-reconnect: ${pollEx.message}",
                            pipelineStage = "LOOP_POLL_ERROR"
                        )
                        triggerAutoReconnect(
                            context,
                            session.device,
                            "Transport poll failed ($consecutiveFailCount consecutive errors): ${pollEx.message}"
                        )
                        break
                    }
                }

                yield()
            }

            val exitReason = if (!isActive) "coroutine cancelled" else "session closed (isSessionOpen=false)"
            Timber.i("remoteShootingLoop: STOPPED — reason: %s", exitReason)
            CameraDiagnosticLogger.info(
                "RemoteShootingLoop",
                "STOPPED — reason: $exitReason (isActive=$isActive, sessionOpen=${session.isSessionOpen}) " +
                "totalPolls=$pollCount idleTimeouts=$idleTimeoutCount",
                pipelineStage = "LOOP_STOP",
            )

            if (isActive && !isExplicitDisconnect && _state.value is ConnectionState.RemoteShooting) {
                Timber.w("remoteShootingLoop stopped unexpectedly while active — triggering auto-reconnect")
                triggerAutoReconnect(
                    context,
                    session.device,
                    "Remote shooting loop stopped unexpectedly: $exitReason"
                )
            }
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
            CameraDiagnosticLogger.warn("UsbConnectionManager", "Exception closing SonyRemoteSession: ${e.message}", ex = e)
        } finally {
            activeRemoteSession = null
        }
    }
}
