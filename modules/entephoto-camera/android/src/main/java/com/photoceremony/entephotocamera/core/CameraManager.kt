package com.photoceremony.entephotocamera.core

import android.content.Context
import android.content.IntentFilter
import android.hardware.usb.UsbManager
import androidx.core.content.ContextCompat
import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import com.photoceremony.entephotocamera.discovery.DeviceChecker
import com.photoceremony.entephotocamera.discovery.UsbDetachReceiver
import com.photoceremony.entephotocamera.discovery.UsbPermissionReceiver
import com.photoceremony.entephotocamera.model.ImportEvent
import com.photoceremony.entephotocamera.model.ImportSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Native facade that manages the camera engine lifecycle.
 * Completely independent of Expo APIs.
 *
 * ## Lifetime model
 *
 * [startSearch] registers USB receivers and begins watching [UsbConnectionManager.state].
 * [stopSearch] only tears down the discovery phase. If the camera is already in
 * [ConnectionState.RemoteShooting] it is a **no-op** — the session must remain alive
 * while the user navigates between connected-camera screens.
 * [disconnect] performs the full teardown unconditionally; call it from
 * [EntePhotoCameraModule.OnDestroy] or when the user explicitly ends the session.
 */
class CameraManager {

    interface EventListener {
        fun onDeviceFound(deviceName: String)
        fun onDeviceDisconnected(reason: String)
        fun onConnectionStateChanged(state: String)
        fun onPhotoSaved(uri: String, filename: String, mimeType: String)
        fun onPhotoSkipped(filename: String, extension: String, reason: String)

        /**
         * Called when a photo transfer fails at any pipeline stage.
         * The camera session is NOT disconnected by a single transfer failure;
         * only raise [onDeviceDisconnected] if the USB session itself is lost.
         *
         * @param handle       PTP object handle that failed (0 if unknown).
         * @param stage        Human-readable pipeline stage name.
         * @param message      User-facing description.
         * @param errorCode    Optional native PTP/USB error code string.
         * @param retryable    Whether the user could reasonably retry.
         */
        fun onPhotoTransferError(
            handle: Int,
            stage: String,
            message: String,
            errorCode: String? = null,
            retryable: Boolean = false,
        )
    }

    private var connectionState: String = "idle"
    private var listener: EventListener? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Collects [UsbConnectionManager.state] flow. Null when not started. */
    private var stateObserverJob: Job? = null

    /**
     * Collects [ImportSession.events] to forward photo-save completions AND
     * transfer failures to React Native.
     * Started alongside [stateObserverJob] and kept alive for the full session lifetime.
     */
    private var importEventJob: Job? = null

    private val usbPermissionReceiver = UsbPermissionReceiver()
    private val usbDetachReceiver = UsbDetachReceiver()
    private var receiversRegistered = false

    fun setListener(listener: EventListener?) {
        this.listener = listener
    }

    fun getConnectionState(): String {
        val nativeState = UsbConnectionManager.state.value
        val activeSession = UsbConnectionManager.activeRemoteSession
        if (activeSession?.isSessionOpen == true && nativeState is ConnectionState.RemoteShooting) {
            return "connected"
        }
        return when (nativeState) {
            is ConnectionState.RemoteShooting -> if (activeSession?.isSessionOpen == true) "connected" else "disconnected"
            is ConnectionState.Connecting -> "connecting"
            is ConnectionState.Reconnecting -> "reconnecting"
            is ConnectionState.Searching -> "searching"
            is ConnectionState.PermissionRequested -> "permission_required"
            is ConnectionState.PermissionDenied -> "permission_required"
            is ConnectionState.Disconnected -> "disconnected"
            is ConnectionState.Idle -> "disconnected"
            is ConnectionState.ErrorPcRemote,
            is ConnectionState.ErrorNotSony,
            is ConnectionState.ErrorConnectionFailed -> "disconnected"
        }
    }

    fun startSearch(context: Context) {
        UsbConnectionManager.setExplicitDisconnect(false)

        if (stateObserverJob != null) {
            Timber.i("CameraManager: startSearch() — already active, re-checking state")
            CameraDiagnosticLogger.info("CameraManager", "startSearch() — already active, reconciling")
            if (UsbConnectionManager.activeRemoteSession?.isSessionOpen == true) {
                updateState("connected", forceNotify = true)
                val currentModel = (UsbConnectionManager.state.value as? ConnectionState.RemoteShooting)?.model
                if (currentModel != null) {
                    listener?.onDeviceFound(currentModel)
                }
            } else {
                UsbConnectionManager.setSearching()
            }
            return
        }

        Timber.i("CameraManager: startSearch() — registering receivers and starting observers")
        CameraDiagnosticLogger.info("CameraManager", "startSearch() — registering USB receivers and starting observers")
        val currentActive = UsbConnectionManager.activeRemoteSession?.isSessionOpen == true
        if (!currentActive) {
            updateState("searching")
        }

        // 1. Register broadcast receivers.
        if (!receiversRegistered) {
            val permFilter = IntentFilter(UsbConnectionManager.ACTION_USB_PERMISSION)
            val detachFilter = IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED)
            ContextCompat.registerReceiver(
                context, usbPermissionReceiver, permFilter,
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            ContextCompat.registerReceiver(
                context, usbDetachReceiver, detachFilter,
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
            receiversRegistered = true
            CameraDiagnosticLogger.info("CameraManager", "USB broadcast receivers registered")
        }

        // 2. Observe native connection state.
        stateObserverJob = scope.launch {
            UsbConnectionManager.state.collect { state ->
                handleNativeStateChange(state)
            }
        }

        // 3. Collect import events and forward each one to React Native.
        if (importEventJob == null) {
            importEventJob = scope.launch {
                ImportSession.events.collect { event ->
                    when (event) {
                        is ImportEvent.ImportCompleted -> {
                            val record = event.record
                            val uriStr = record.mediaUri?.toString() ?: ""
                            Timber.i(
                                "CameraManager: onPhotoSaved dispatching — filename=%s uri=%s mime=%s",
                                record.filename, uriStr, record.mimeType,
                            )
                            CameraDiagnosticLogger.info(
                                "CameraManager",
                                "onPhotoSaved → filename=${record.filename} size=${record.formattedSize} uri=$uriStr mime=${record.mimeType}",
                                objectHandle = record.handle,
                                pipelineStage = "IMPORT_COMPLETED",
                            )
                            listener?.onPhotoSaved(
                                uri      = uriStr,
                                filename = record.filename,
                                mimeType = record.mimeType,
                            )
                        }

                        is ImportEvent.ImportSkippedUnsupportedFormat -> {
                            Timber.i(
                                "CameraManager: ImportSkippedUnsupportedFormat — filename=%s extension=%s",
                                event.filename, event.extension,
                            )
                            CameraDiagnosticLogger.info(
                                "CameraManager",
                                "onPhotoSkipped → filename=${event.filename} extension=${event.extension}",
                                objectHandle = event.handle,
                                pipelineStage = "IMPORT_SKIPPED",
                            )
                            listener?.onPhotoSkipped(
                                filename = event.filename,
                                extension = event.extension,
                                reason = "unsupported_format",
                            )
                        }

                        is ImportEvent.ImportFailed -> {
                            Timber.w(
                                "CameraManager: ImportFailed — handle=0x%08X reason=%s",
                                event.handle, event.reason,
                            )
                            CameraDiagnosticLogger.warn(
                                "CameraManager",
                                "ImportFailed: handle=0x%08X reason=${event.reason}".format(event.handle),
                                objectHandle = event.handle,
                                pipelineStage = "IMPORT_FAILED",
                            )
                            listener?.onPhotoTransferError(
                                handle    = event.handle,
                                stage     = "IMPORT_FAILED",
                                message   = event.reason,
                                errorCode = null,
                                retryable = false,
                            )
                        }

                        is ImportEvent.ImportStarted -> {
                            CameraDiagnosticLogger.info(
                                "CameraManager",
                                "ImportStarted: handle=0x%08X".format(event.handle),
                                objectHandle = event.handle,
                                pipelineStage = "IMPORT_STARTED",
                            )
                        }

                        else -> { /* other events */ }
                    }
                }
            }
        }

        // 4. Start continuous discovery loop.
        UsbConnectionManager.startDiscoveryLoop(context)

        // 5. Check for already-attached Sony devices.
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
        val attached = usbManager.deviceList.values.filter { DeviceChecker.isSonyDevice(it) }
        CameraDiagnosticLogger.info(
            "CameraManager",
            "Already-attached Sony devices found: ${attached.size}" +
            attached.joinToString { " [VID=0x%04X PID=0x%04X name=%s]".format(it.vendorId, it.productId, it.deviceName) }
        )
        for (device in attached) {
            Timber.i("CameraManager: found already-attached Sony device: %s", device.deviceName)
            UsbConnectionManager.handleDeviceAttached(context, device)
            return
        }

        UsbConnectionManager.setSearching()
    }

    /**
     * Reconciles native camera connection status when returning to the foreground.
     */
    fun reconcileState(context: Context) {
        Timber.i("CameraManager: reconcileState() called")
        if (UsbConnectionManager.isExplicitDisconnect) {
            updateState("disconnected", forceNotify = true)
            return
        }

        val activeSession = UsbConnectionManager.activeRemoteSession
        if (activeSession?.isSessionOpen == true && UsbConnectionManager.state.value is ConnectionState.RemoteShooting) {
            updateState("connected", forceNotify = true)
            val currentModel = (UsbConnectionManager.state.value as? ConnectionState.RemoteShooting)?.model
            if (currentModel != null) {
                listener?.onDeviceFound(currentModel)
            }
            return
        }

        if (stateObserverJob == null) {
            startSearch(context)
        } else {
            val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
            val attached = usbManager.deviceList.values.firstOrNull { DeviceChecker.isSonyDevice(it) }
            if (attached != null) {
                UsbConnectionManager.handleDeviceAttached(context, attached)
            } else {
                UsbConnectionManager.setSearching()
            }
        }
    }

    /**
     * Stops only the discovery phase (USB receivers + state observer).
     * Preserves active RemoteShooting session.
     */
    fun stopSearch(context: Context) {
        if (stateObserverJob == null) {
            Timber.i("CameraManager: stopSearch() ignored — not started")
            return
        }

        if (connectionState == "connected" || UsbConnectionManager.activeRemoteSession?.isSessionOpen == true) {
            Timber.i(
                "CameraManager: stopSearch() called while camera is connected — " +
                "session preserved, no teardown performed",
            )
            CameraDiagnosticLogger.info("CameraManager", "stopSearch() no-op: camera is connected, preserving session")
            return
        }

        Timber.i("CameraManager: stopSearch() — camera not connected, full discovery teardown")
        CameraDiagnosticLogger.info("CameraManager", "stopSearch() — not connected, tearing down discovery")
        teardownDiscovery(context)
        UsbConnectionManager.stopDiscoveryLoop()
        updateState("disconnected")
    }

    /**
     * Unconditional full teardown — closes the Sony session, cancels all jobs,
     * and unregisters receivers.
     */
    fun disconnect(context: Context) {
        Timber.i("CameraManager: disconnect() — full session teardown")
        CameraDiagnosticLogger.info("CameraManager", "disconnect() — full teardown requested")
        teardownDiscovery(context)
        UsbConnectionManager.reset()
        updateState("disconnected")
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun teardownDiscovery(context: Context) {
        stateObserverJob?.cancel()
        stateObserverJob = null

        importEventJob?.cancel()
        importEventJob = null

        if (receiversRegistered) {
            try { context.unregisterReceiver(usbPermissionReceiver) } catch (_: Exception) {}
            try { context.unregisterReceiver(usbDetachReceiver) }     catch (_: Exception) {}
            receiversRegistered = false
        }
    }

    private fun handleNativeStateChange(state: ConnectionState) {
        when (state) {
            is ConnectionState.Idle -> {
                if (connectionState == "connected") {
                    listener?.onDeviceDisconnected("idle")
                }
                updateState("disconnected")
            }
            is ConnectionState.Disconnected -> {
                if (connectionState == "connected") {
                    listener?.onDeviceDisconnected(state.reason ?: "disconnected")
                }
                updateState("disconnected")
            }
            is ConnectionState.Searching -> {
                updateState("searching")
            }
            is ConnectionState.PermissionRequested -> {
                updateState("permission_required")
            }
            is ConnectionState.PermissionDenied -> {
                updateState("permission_required")
                listener?.onDeviceDisconnected("PermissionDenied")
            }
            is ConnectionState.Connecting -> {
                updateState("connecting")
            }
            is ConnectionState.Reconnecting -> {
                updateState("reconnecting")
            }
            is ConnectionState.RemoteShooting -> {
                val model = state.model
                Timber.i(
                    "CameraManager: RemoteShooting active — onDeviceFound dispatching model=%s",
                    model,
                )
                CameraDiagnosticLogger.info(
                    "CameraManager",
                    "RemoteShooting ACTIVE — model=$model; event loop is running",
                )
                updateState("connected")
                listener?.onDeviceFound(model)
            }
            is ConnectionState.ErrorPcRemote -> {
                CameraDiagnosticLogger.warn("CameraManager", "Camera not in PC Remote mode — wrong USB setting")
                updateState("disconnected")
                listener?.onDeviceDisconnected("ErrorPcRemote")
            }
            is ConnectionState.ErrorNotSony -> {
                CameraDiagnosticLogger.warn("CameraManager", "Non-Sony device VID=0x%04X PID=0x%04X".format(state.vendorId, state.productId))
                updateState("disconnected")
                listener?.onDeviceDisconnected("ErrorNotSony")
            }
            is ConnectionState.ErrorConnectionFailed -> {
                Timber.w("CameraManager: connection failed — %s", state.reason)
                CameraDiagnosticLogger.error("CameraManager", "Connection failed: ${state.reason}")
                updateState("disconnected")
                listener?.onDeviceDisconnected("ErrorConnectionFailed: ${state.reason}")
            }
        }
    }

    private fun updateState(newState: String, forceNotify: Boolean = false) {
        val changed = connectionState != newState
        if (changed || forceNotify) {
            Timber.i(
                "CameraManager: connectionState changed from '%s' to '%s' (changed=%b, forceNotify=%b)",
                connectionState, newState, changed, forceNotify
            )
            connectionState = newState
            listener?.onConnectionStateChanged(newState)
        }
    }
}
