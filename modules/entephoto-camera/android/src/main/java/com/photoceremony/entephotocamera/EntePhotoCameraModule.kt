package com.photoceremony.entephotocamera

import com.photoceremony.entephotocamera.core.CameraManager
import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import com.photoceremony.entephotocamera.diagnostics.DiagnosticRecord
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class EntePhotoCameraModule : Module() {
    private val cameraManager = CameraManager()

    override fun definition() = ModuleDefinition {
        Name("EntePhotoCamera")

        Events(
            "onDeviceFound",
            "onDeviceDisconnected",
            "onConnectionStateChanged",
            "onPhotoSaved",
            // Phase 1: diagnostic stream — carries individual log records to the JS layer.
            "onDiagnosticLog",
            // Phase 3: transfer failures — carries per-object pipeline failures.
            "onPhotoTransferError",
            "onPhotoSkipped",
        )

        OnCreate {
            // Initialise the diagnostic file sink with the module's application context.
            // This is idempotent; MainApplication.onCreate also calls it so whichever
            // runs first wins, and the second call is a no-op.
            val ctx = appContext.reactContext
            if (ctx != null) {
                CameraDiagnosticLogger.initialize(ctx.applicationContext)
            }

            // Register a listener that forwards every new diagnostic record to React Native.
            // The listener must NEVER itself call CameraDiagnosticLogger.log*() — that
            // would create an infinite recursion loop.
            CameraDiagnosticLogger.setListener { record ->
                sendDiagnosticEvent(record)
            }

            cameraManager.setListener(object : CameraManager.EventListener {
                override fun onDeviceFound(deviceName: String) {
                    sendEvent("onDeviceFound", mapOf("deviceName" to deviceName))
                }

                override fun onDeviceDisconnected(reason: String) {
                    sendEvent("onDeviceDisconnected", mapOf("reason" to reason))
                }

                override fun onConnectionStateChanged(state: String) {
                    sendEvent("onConnectionStateChanged", mapOf("state" to state))
                }

                /**
                 * Fired by [CameraManager] after [com.photoceremony.entephotocamera.model.ImportSession]
                 * confirms the photo is fully saved in MediaStore / disk.
                 * Only called once per successfully imported object.
                 */
                override fun onPhotoSaved(uri: String, filename: String, mimeType: String) {
                    sendEvent(
                        "onPhotoSaved",
                        mapOf(
                            "uri"      to uri,
                            "filename" to filename,
                            "mimeType" to mimeType,
                        ),
                    )
                }

                /**
                 * Fired when an import pipeline stage fails for a specific object handle.
                 * The camera session is NOT disconnected by a single transfer failure.
                 */
                override fun onPhotoTransferError(
                    handle: Int,
                    stage: String,
                    message: String,
                    errorCode: String?,
                    retryable: Boolean,
                ) {
                    sendEvent(
                        "onPhotoTransferError",
                        mapOf(
                            "handle"    to handle,
                            "stage"     to stage,
                            "message"   to message,
                            "errorCode" to (errorCode ?: ""),
                            "retryable" to retryable,
                            "timestamp" to System.currentTimeMillis(),
                        ),
                    )
                }

                override fun onPhotoSkipped(filename: String, extension: String, reason: String) {
                    sendEvent(
                        "onPhotoSkipped",
                        mapOf(
                            "filename"  to filename,
                            "extension" to extension,
                            "reason"    to reason,
                        ),
                    )
                }
            })
        }

        OnDestroy {
            // Unregister the diagnostic listener before teardown to prevent callbacks
            // arriving after the module is destroyed.
            CameraDiagnosticLogger.setListener(null)

            val ctx = appContext.reactContext
            if (ctx != null) {
                // Unconditional full teardown — closes the Sony session, cancels
                // the import-event collector, and unregisters USB receivers.
                cameraManager.disconnect(ctx)
            }
            cameraManager.setListener(null)
        }

        // ── Public functions ──────────────────────────────────────────────────

        Function("getStatus") {
            "ready"
        }

        Function("getConnectionState") {
            cameraManager.getConnectionState()
        }

        Function("startSearch") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.startSearch(ctx)
            }
        }

        /**
         * Stops USB device discovery only.
         *
         * If the camera is already connected in RemoteShooting mode this is a
         * no-op — the session survives navigation between connected-camera screens.
         * Call [disconnect] for an explicit full teardown.
         */
        Function("stopSearch") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.stopSearch(ctx)
            }
        }

        /**
         * Reconciles native camera connection status when returning to foreground.
         */
        Function("reconcileState") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.reconcileState(ctx)
            }
        }

        /**
         * Explicitly ends the Sony remote-shooting session, cancels the import
         * event loop, and releases all USB resources regardless of connection state.
         */
        Function("disconnect") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.disconnect(ctx)
            }
        }

        /**
         * Returns a snapshot of all buffered diagnostic records as a list of maps.
         * The snapshot is safe to call on any thread and never blocks the camera loop.
         * Use this to populate the diagnostic console when it first opens.
         */
        Function("getDiagnosticLogs") {
            CameraDiagnosticLogger.getSnapshot().map { r -> recordToMap(r) }
        }

        /**
         * Clears the in-memory diagnostic buffer.
         * Does NOT disconnect the camera or reset the active PTP session.
         */
        Function("clearDiagnosticLogs") {
            CameraDiagnosticLogger.clearBuffer()
        }

        /**
         * Returns the full diagnostic log as a single newline-delimited text string.
         * Suitable for sharing/exporting as a .txt file from the diagnostic console.
         */
        Function("getDiagnosticText") {
            CameraDiagnosticLogger.dumpText()
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /** Converts a [DiagnosticRecord] to a plain map suitable for a React Native event payload. */
    private fun recordToMap(r: DiagnosticRecord): Map<String, Any?> = mapOf(
        "sequenceId"       to r.sequenceId,
        "timestampMs"      to r.timestampMs,
        "timestampIso"     to r.timestampIso,
        "severity"         to r.severity,
        "component"        to r.component,
        "message"          to r.message,
        "exceptionType"    to r.exceptionType,
        "exceptionMessage" to r.exceptionMessage,
        "stackTrace"       to r.stackTrace,
        "objectHandle"     to r.objectHandle,
        "pipelineStage"    to r.pipelineStage,
    )

    /**
     * Sends a [DiagnosticRecord] as an [onDiagnosticLog] event.
     * Called from the [CameraDiagnosticLogger] listener — MUST NOT itself call
     * CameraDiagnosticLogger.log*() to prevent recursive infinite loops.
     */
    private fun sendDiagnosticEvent(record: DiagnosticRecord) {
        try {
            sendEvent("onDiagnosticLog", recordToMap(record))
        } catch (_: Exception) {
            // swallow silently — never recurse into the logger here
        }
    }
}
