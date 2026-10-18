package com.photoceremony.entephotocamera.sony

import android.content.ContentValues
import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.photoceremony.entephotocamera.model.ImportEvent
import com.photoceremony.entephotocamera.model.ImportRecord
import com.photoceremony.entephotocamera.model.ImportSession
import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import timber.log.Timber
import java.io.Closeable
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Manages a direct raw USB PTP session with a Sony camera in **PC Remote mode**.
 *
 * Implements:
 * 1. 3-stage Sony SDIO_Connect handshake (opcodes 0x9201 / 0x9202)
 * 2. Remote shutter trigger sequence (AutoFocus 0xD2C1 -> Capture 0xD2C2 via 0x9207)
 * 3. Event polling for ObjectAdded (0xC201)
 * 4. PTP Object download (GetObjectInfo 0x1007 / GetObject 0x1009) and MediaStore streaming
 *
 * @param device The [UsbDevice] operating in PC Remote mode.
 * @param usbManager System [UsbManager] to acquire the raw connection.
 */
class SonyRemoteSession(
    val device: UsbDevice,
    private val usbManager: UsbManager,
) : Closeable {

    private val transport = PtpUsbTransport(device, usbManager)
    private val relativeDir = "DCIM/Entephoto/"

    /** True if session has successfully completed the 3-stage SDIO handshake. */
    var isConnected: Boolean = false
        private set

    /** True if both SDIO handshake is completed and transport session is open. */
    val isSessionOpen: Boolean get() = isConnected && transport.isSessionOpen

    /** Parsed extended capabilities from SDIO_GetExtDeviceInfo. */
    var extDeviceInfo: SonyExtDeviceInfo? = null
        private set

    /** Standard PTP DeviceInfo parsed during pre-handshake self-test. */
    var baseDeviceInfo: PtpUsbTransport.DeviceInfoResult? = null
        private set

    /**
     * Connects to the Sony camera and runs the full initialization sequence:
     *
     * 1. Opens raw USB transport & claims interface
     * 2. Executes GetDeviceInfo (0x1001) standard PTP self-test
     * 3. Runs 3-stage SDIO_Connect handshake:
     *    - Phase 1: Announce intent (0x9201, Param1=1)
     *    - Phase 2: Negotiate protocol (0x9201, Param1=2)
     *    - Capabilities query: SDIO_GetExtDeviceInfo (0x9202, Param1=0xC8) with retry loop
     *    - Phase 3: Confirm session (0x9201, Param1=3)
     * 4. Claims Application Priority (PriorityMode = 1)
     */
    fun connect() {
        check(!isConnected) { "SonyRemoteSession is already connected" }

        Timber.i(
            "SonyRemoteSession.connect() starting for device VID=0x%04X PID=0x%04X name=%s",
            device.vendorId, device.productId, device.deviceName
        )

        transport.open()

        try {
            val baseInfo = transport.executeGetDeviceInfo()
            baseDeviceInfo = baseInfo
            Timber.i(
                "Standard PTP GetDeviceInfo OK: Manufacturer='%s', Model='%s', Version='%s'",
                baseInfo.manufacturer, baseInfo.model, baseInfo.deviceVersion
            )

            if (!transport.isSessionOpen) {
                transport.executeOpenSession(sessionId = 1)
            }

            runSdioHandshake()

            isConnected = true
            Timber.i("SonyRemoteSession connected successfully to %s", baseInfo.model)

        } catch (e: Exception) {
            Timber.e(e, "SonyRemoteSession.connect() failed")
            close()
            throw e
        }
    }

    /**
     * Clears halt/stall condition on bulk-IN and bulk-OUT endpoints.
     */
    fun clearHalts() {
        transport.clearEndpointHalt(isInput = true)
        transport.clearEndpointHalt(isInput = false)
    }

    /**
     * Attempts transport recovery after a failed PTP transfer or aborted data phase.
     * Clears endpoint halts and drains any pending bytes from the USB FIFO.
     */
    fun recoverSession(): Boolean {
        CameraDiagnosticLogger.warn(
            "SonyRemoteSession",
            "Attempting session recovery after transport failure (sessionOpen=$isSessionOpen)",
            pipelineStage = "SESSION_RECOVERY"
        )
        return try {
            clearHalts()
            val drained = transport.drainPendingBulkIn(timeoutMs = 150)
            clearHalts()
            CameraDiagnosticLogger.info(
                "SonyRemoteSession",
                "Session recovery complete: bulk endpoints cleared, drained $drained bytes",
                pipelineStage = "SESSION_RECOVERY"
            )
            true
        } catch (e: Exception) {
            CameraDiagnosticLogger.error(
                "SonyRemoteSession",
                "Session recovery failed: ${e.message}",
                ex = e,
                pipelineStage = "SESSION_RECOVERY"
            )
            false
        }
    }

    /**
     * Executes a controlled reconnection and full Sony SDIO re-handshake
     * after a severe transport/PTP transaction desynchronization failure.
     */
    fun reconnect() {
        Timber.i("SonyRemoteSession.reconnect() starting for device %s...", device.deviceName)
        CameraDiagnosticLogger.warn(
            "SonyRemoteSession",
            "Executing controlled transport reconnect and SDIO re-handshake",
            pipelineStage = "RECONNECT"
        )

        try {
            clearHalts()
            transport.drainPendingBulkIn(timeoutMs = 50)
            transport.close()
        } catch (e: Exception) {
            Timber.w(e, "Error closing transport during reconnect: %s", e.message)
        }
        isConnected = false

        try { Thread.sleep(250) } catch (_: Exception) {}

        transport.open()
        clearHalts()
        transport.drainPendingBulkIn(timeoutMs = 50)

        val baseInfo = transport.executeGetDeviceInfo()
        baseDeviceInfo = baseInfo

        if (!transport.isSessionOpen) {
            transport.executeOpenSession(sessionId = 1)
        }

        runSdioHandshake()
        isConnected = true
        Timber.i("SonyRemoteSession.reconnect() completed successfully for %s", baseInfo.model)
        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "Controlled reconnect and SDIO re-handshake SUCCESSFUL for ${baseInfo.model}",
            pipelineStage = "RECONNECT"
        )
    }

    /**
     * Non-blocking single poll for a PTP event from the camera.
     *
     * Uses the same dual strategy as internal event polling:
     * 1. USB Interrupt-IN endpoint (non-blocking, 100 ms timeout).
     * 2. Fallback: standard PTP GetEvent (0x1003) opcode.
     *
     * **Never throws** — all exceptions are swallowed and logged at DEBUG.
     * Returns `null` when no event is available yet (caller should delay and retry).
     *
     * Intended for use by the background [com.photoceremony.entephotocamera.service.ImportService]
     * event-listening loop while in [com.photoceremony.entephotocamera.core.ConnectionState.RemoteShooting]
     * mode.
     */
    /**
     * Reads pending PTP events from the USB Interrupt-IN endpoint (EP3).
     *
     * @param timeoutMs Timeout for interrupt endpoint read (default 1500 ms).
     * @return [PtpUsbTransport.PtpEvent] if an event was received, or null if no event arrived.
     */
    fun pollEventNonBlocking(timeoutMs: Int = 1500): PtpUsbTransport.PtpEvent? {
        if (!isConnected || !transport.isSessionOpen) return null

        return try {
            val evt = transport.readInterruptEvent(timeoutMs)
            if (evt != null) {
                Timber.i("pollEventNonBlocking: interrupt event 0x%04X param1=0x%08X", evt.code, evt.param1)
            }
            evt
        } catch (e: Exception) {
            Timber.d("pollEventNonBlocking: interrupt endpoint read error: %s", e.message)
            null
        }
    }

    /**
     * Fallback event poll using the polled PTP **GetEvent** (opcode 0x9803 MTP_OC_GetEventObject) command.
     *
     * The interrupt endpoint (EP3) may return 0 bytes on some α7 IV firmware versions
     * even when an event is queued.  This method provides the second strategy from the
     * reference project's dual-strategy event polling:
     *
     *   Strategy 2: [PtpUsbTransport.pollGetEvent] — issues a bulk command/data/response
     *   exchange via the PTP_OC_GetEvent (0x9803) opcode.
     *
     * **Never throws** — all exceptions are caught and return null.
     * Returns null when no event is pending or the session is not open.
     */
    fun pollGetEventFallback(): PtpUsbTransport.PtpEvent? {
        if (!isConnected || !transport.isSessionOpen) return null
        return try {
            transport.pollGetEvent()
        } catch (e: Exception) {
            Timber.d("pollGetEventFallback: GetEvent error: %s", e.message)
            null
        }
    }

    /**
     * Downloads a PTP object by handle and saves it to MediaStore / disk.
     *
     * Public entry point for the background event loop in
     * [com.photoceremony.entephotocamera.service.ImportService]. Delegates to the
     * internal [downloadObject] implementation.
     *
     * @param context Application context for MediaStore insertion.
     * @param handle  PTP object handle received from an [SonyPtpOpcodes.EVENT_OBJECT_ADDED] event.
     * @return [ImportRecord] describing the saved file.
     */
    fun fetchAndSaveObject(context: Context, handle: Int): ImportRecord? {
        check(isConnected) { "Cannot download object — SonyRemoteSession is not connected" }
        return downloadObject(context, handle)
    }

    /**
     * Downloads PTP object metadata and payload, saving to MediaStore or disk.
     */
    private fun downloadObject(context: Context, handle: Int): ImportRecord? {
        val handleHex = "0x%08X".format(handle.toLong() and 0xFFFFFFFFL)
        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "downloadObject START for handle=$handleHex (raw=$handle)",
            objectHandle = handle,
            pipelineStage = "DOWNLOAD_START"
        )

        // 1. GetObjectInfo (0x1008)
        var objectInfo = ParsedObjectInfo("SONY_%08X.jpg".format(handle.toLong() and 0xFFFFFFFFL), "image/jpeg")
        try {
            val txIdInfo = transport.allocateTransactionId()
            CameraDiagnosticLogger.info(
                "SonyRemoteSession",
                "Sending GetObjectInfo (0x1008) for handle=$handleHex (txID=$txIdInfo)",
                objectHandle = handle,
                pipelineStage = "GET_OBJECT_INFO"
            )
            transport.sendCommandContainer(
                opcode = SonyPtpOpcodes.PTP_OC_GET_OBJECT_INFO,
                transactionId = txIdInfo,
                params = intArrayOf(handle)
            )
            val infoPayload = transport.receiveDataContainer(txIdInfo)
            val respInfo = transport.receiveResponseContainer(txIdInfo)
            CameraDiagnosticLogger.info(
                "SonyRemoteSession",
                "GetObjectInfo response: code=0x%04X txID=%d (payload=${infoPayload.size}B)"
                    .format(respInfo.code, respInfo.transactionId),
                objectHandle = handle,
                pipelineStage = "GET_OBJECT_INFO"
            )
            if (respInfo.isOk) {
                objectInfo = parseObjectInfo(infoPayload, handle)
                CameraDiagnosticLogger.info(
                    "SonyRemoteSession",
                    "Parsed ObjectInfo: filename='${objectInfo.filename}' mime='${objectInfo.mimeType}'",
                    objectHandle = handle,
                    pipelineStage = "GET_OBJECT_INFO"
                )
            }
        } catch (e: Exception) {
            Timber.w(e, "GetObjectInfo optional step failed for handle=$handleHex: %s", e.message)
            CameraDiagnosticLogger.warn(
                "SonyRemoteSession",
                "GetObjectInfo failed for handle=$handleHex (${e.message}) — using fallback filename '${objectInfo.filename}'",
                ex = e,
                objectHandle = handle,
                pipelineStage = "GET_OBJECT_INFO"
            )
            try {
                clearHalts()
                transport.drainPendingBulkIn(timeoutMs = 50)
            } catch (_: Exception) {}
        }

        // JPEG-only import filter: Reject unsupported formats before GetObject download
        val filename = objectInfo.filename.trim()
        val extension = if (filename.contains('.')) {
            filename.substringAfterLast('.').lowercase()
        } else {
            ""
        }
        val isJpeg = extension == "jpg" || extension == "jpeg"

        if (!isJpeg) {
            CameraDiagnosticLogger.info(
                "SonyRemoteSession",
                "Skipping unsupported camera object (JPEG only): filename='$filename' ext='.$extension' handle=$handleHex",
                objectHandle = handle,
                pipelineStage = "IMPORT_SKIPPED"
            )
            Timber.i("downloadObject: Unsupported format skipped — file='%s' (ext='%s') handle=%s", filename, extension, handleHex)

            ImportSession.emitEvent(
                ImportEvent.ImportSkippedUnsupportedFormat(
                    handle = handle,
                    filename = filename,
                    extension = extension
                )
            )
            return null
        }

        // 2. GetObject (0x1009)
        val txIdObj = transport.allocateTransactionId()
        Timber.i("downloadObject: Sending GetObject (0x1009) for handle=$handleHex (txID=%d)", txIdObj)
        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "Sending GetObject (0x1009) for handle=$handleHex (txID=$txIdObj, epIn=0x%02X, maxPkt=%d)".format(
                transport.bulkInEndpointAddress ?: 0, transport.bulkInMaxPacketSize ?: 0
            ),
            objectHandle = handle,
            pipelineStage = "GET_OBJECT"
        )

        transport.sendCommandContainer(
            opcode = SonyPtpOpcodes.PTP_OC_GET_OBJECT,
            transactionId = txIdObj,
            params = intArrayOf(handle)
        )
        val objectBytes = transport.receiveDataContainer(
            expectedTransactionId = txIdObj,
            expectedOpcode = SonyPtpOpcodes.PTP_OC_GET_OBJECT,
        )

        // STEP 3: Read final Response container after data completes
        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "GetObject data phase complete (${objectBytes.size} bytes). Reading final Response container (txID=$txIdObj)...",
            objectHandle = handle,
            pipelineStage = "GET_OBJECT"
        )

        val respObj = transport.receiveResponseContainer(txIdObj)
        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "GetObject Response: code=0x%04X txID=%d params=%s"
                .format(respObj.code, respObj.transactionId, respObj.params.toList()),
            objectHandle = handle,
            pipelineStage = "GET_OBJECT"
        )
        transport.checkResponseOk(respObj, "GetObject")

        // STEP 4: Wire completion into the existing save/UI path
        val effectiveFilename = filename.ifBlank { "SONY_${handleHex.removePrefix("0x")}.jpg" }
        val mimeType = objectInfo.mimeType

        val record = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToMediaStore(context, handle, effectiveFilename, mimeType, objectBytes)
        } else {
            saveToFile(handle, effectiveFilename, mimeType, objectBytes)
        }

        CameraDiagnosticLogger.info(
            "SonyRemoteSession",
            "Successfully saved '$effectiveFilename' (${objectBytes.size} bytes, $mimeType) uri=${record.mediaUri}",
            objectHandle = handle,
            pipelineStage = "MEDIASTORE_SAVED"
        )
        Timber.i("downloadObject: Successfully saved '%s' (%d bytes, %s)", effectiveFilename, objectBytes.size, mimeType)

        return record
    }

    private fun saveToMediaStore(
        context: Context,
        handle: Int,
        filename: String,
        mimeType: String,
        bytes: ByteArray
    ): ImportRecord {
        val resolver = context.contentResolver
        val collection = if (mimeType.startsWith("image/"))
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        else
            MediaStore.Downloads.EXTERNAL_CONTENT_URI

        val nowSec = System.currentTimeMillis() / 1000L
        val cv = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir) // "DCIM/Entephoto/"
            put(MediaStore.MediaColumns.DATE_ADDED, nowSec)
            put(MediaStore.MediaColumns.DATE_MODIFIED, nowSec)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val uri: Uri = resolver.insert(collection, cv)
            ?: throw IllegalStateException("MediaStore insert returned null")

        try {
            resolver.openOutputStream(uri, "w")?.use { os ->
                os.write(bytes)
            } ?: throw IllegalStateException("openOutputStream returned null")

            val publish = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, publish, null, null)

            // Query physical on-device path and trigger MediaScanner so all photo/gallery apps detect it immediately
            try {
                val cursor = resolver.query(uri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)
                cursor?.use {
                    if (it.moveToFirst()) {
                        val path = it.getString(0)
                        if (!path.isNullOrBlank()) {
                            MediaScannerConnection.scanFile(context, arrayOf(path), arrayOf(mimeType), null)
                            Timber.i("saveToMediaStore: confirmed local file on mobile: %s", path)
                            UsbEventLogger.log("LOCAL_STORAGE", "Photo saved locally on phone: $path")
                        }
                    }
                }
            } catch (e: Exception) {
                Timber.d("MediaScanner scan notice: %s", e.message)
            }

            return ImportRecord(
                handle = handle,
                filename = filename,
                sizeBytes = bytes.size.toLong(),
                mediaUri = uri,
                mimeType = mimeType
            )
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    @Suppress("DEPRECATION")
    private fun saveToFile(
        handle: Int,
        filename: String,
        mimeType: String,
        bytes: ByteArray
    ): ImportRecord {
        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM),
            "Entephoto"
        )
        dir.mkdirs()
        val dest = File(dir, filename)

        FileOutputStream(dest).use { os ->
            os.write(bytes)
        }

        val uri = Uri.fromFile(dest)
        Timber.i("saveToFile: saved locally to %s", dest.absolutePath)
        UsbEventLogger.log("LOCAL_STORAGE", "Photo saved locally on phone: ${dest.absolutePath}")

        return ImportRecord(
            handle = handle,
            filename = filename,
            sizeBytes = dest.length(),
            mediaUri = uri,
            mimeType = mimeType
        )
    }

    private fun parseObjectInfo(payload: ByteArray, handle: Int): ParsedObjectInfo {
        val fallbackName = "SONY_%08X.jpg".format(handle.toLong() and 0xFFFFFFFFL)
        if (payload.size < 12) {
            return ParsedObjectInfo(fallbackName, "image/jpeg")
        }
        val buf = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN)
        buf.int // StorageID
        val format = buf.short.toInt() and 0xFFFF

        if (buf.remaining() >= 46) {
            buf.position(buf.position() + 46)
        }

        val filename = if (buf.hasRemaining()) readPtpString(buf) else fallbackName
        val effectiveName = filename.ifBlank { fallbackName }
        val mime = when (format) {
            0x3801 -> "image/jpeg"
            0x3808 -> "image/tiff"
            0xB002 -> "image/x-sony-arw"
            else -> if (effectiveName.endsWith(".arw", ignoreCase = true)) "image/x-sony-arw" else "image/jpeg"
        }

        return ParsedObjectInfo(effectiveName, mime)
    }

    private fun readPtpString(buf: ByteBuffer): String {
        if (!buf.hasRemaining()) return ""
        val numChars = buf.get().toInt() and 0xFF
        if (numChars == 0 || buf.remaining() < numChars * 2) return ""
        val chars = CharArray(numChars) { buf.short.toInt().toChar() }
        return String(chars).trimEnd('\u0000')
    }



    /** Executes 3-stage SDIO handshake with explicit per-stage logging. */
    private fun runSdioHandshake() {
        Timber.d("Starting Sony 3-Stage SDIO_Connect handshake...")

        if (!transport.isSessionOpen) {
            transport.executeOpenSession(sessionId = 1)
        }

        // Phase 1 — explicit SDIO timeout, separate from standard PTP
        val txId1 = transport.allocateTransactionId()
        transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId1, intArrayOf(1, 0, 0))
        val data1 = transport.receiveDataContainer(txId1, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        val resp1 = transport.receiveResponseContainer(txId1, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        Timber.i("SDIO_Connect Phase 1 response: code=0x%04X, payloadSize=%d bytes, params=%s", resp1.code, data1.size, resp1.params.toList())
        transport.checkResponseOk(resp1, "SDIO_Connect Phase 1")

        // Phase 2
        val txId2 = transport.allocateTransactionId()
        transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId2, intArrayOf(2, 0, 0))
        val data2 = transport.receiveDataContainer(txId2, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        val resp2 = transport.receiveResponseContainer(txId2, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        Timber.i("SDIO_Connect Phase 2 response: code=0x%04X, payloadSize=%d bytes, params=%s", resp2.code, data2.size, resp2.params.toList())
        transport.checkResponseOk(resp2, "SDIO_Connect Phase 2")

        // Intermediate capabilities query
        var parsedExtInfo: SonyExtDeviceInfo? = null
        var tries = 20

        while (parsedExtInfo == null && tries > 0) {
            tries--
            try {
                val txIdExt = transport.allocateTransactionId()
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_GET_EXT_DEVICE_INFO, txIdExt, intArrayOf(0xC8))
                val payload = transport.receiveDataContainer(txIdExt)
                val respExt = transport.receiveResponseContainer(txIdExt)

                val rawHex = payload.joinToString(" ") { "%02X".format(it) }
                Timber.d("SDIO_GetExtDeviceInfo response: code=0x%04X, payloadSize=%d bytes, raw=[%s]", respExt.code, payload.size, rawHex)
                UsbEventLogger.log("SDIO_EXT_INFO", "raw payload (${payload.size}B): $rawHex")

                if (respExt.isOk && payload.isNotEmpty()) {
                    val info = parseExtDeviceInfo(payload)
                    if (info.operations.isNotEmpty() || info.properties.isNotEmpty()) {
                        parsedExtInfo = info
                    }
                }
            } catch (e: Exception) {
                Timber.w("SDIO_GetExtDeviceInfo attempt failed (%d tries left): %s", tries, e.message)
            }

            if (parsedExtInfo == null && tries > 0) {
                Thread.sleep(50)
            }
        }

        val finalExtInfo = parsedExtInfo
            ?: throw PtpUsbTransport.PtpTransportException("SDIO_GetExtDeviceInfo failed after 20 retries")

        this.extDeviceInfo = finalExtInfo
        verifyCapabilities(finalExtInfo)

        // Phase 3 — same two-phase read pattern as Phase 1/2
        val txId3 = transport.allocateTransactionId()
        transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId3, intArrayOf(3, 0, 0))
        val data3 = transport.receiveDataContainer(txId3, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        val resp3 = transport.receiveResponseContainer(txId3, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
        Timber.i("SDIO_Connect Phase 3 response: code=0x%04X, payloadSize=%d bytes, params=%s", resp3.code, data3.size, resp3.params.toList())
        UsbEventLogger.log("SDIO_PHASE3", "respCode=0x%04X payloadSize=%dB params=%s".format(resp3.code, data3.size, resp3.params.toList()))
        transport.checkResponseOk(resp3, "SDIO_Connect Phase 3")

        // Priority Mode
        claimPriorityMode()
    }

    private fun claimPriorityMode() {
        try {
            val txId = transport.allocateTransactionId()
            transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, intArrayOf(SonyPtpOpcodes.DPC_PRIORITY_MODE))
            transport.sendDataContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, byteArrayOf(0x01))
            val resp = transport.receiveResponseContainer(txId)
            if (resp.isOk) {
                Timber.i("Application PriorityMode claimed successfully")
            }
        } catch (e: Exception) {
            Timber.w(e, "Failed to set PriorityMode (non-fatal, continuing)")
        }
    }

    private fun verifyCapabilities(extInfo: SonyExtDeviceInfo) {
        val baseOps = baseDeviceInfo?.operationsSupported ?: emptyList()
        val baseEvts = baseDeviceInfo?.eventsSupported ?: emptyList()
        val baseProps = baseDeviceInfo?.devicePropertiesSupported ?: emptyList()

        val hasControlDevice = extInfo.operations.contains(SonyPtpOpcodes.SDIO_CONTROL_DEVICE) ||
                baseOps.contains(SonyPtpOpcodes.SDIO_CONTROL_DEVICE)
        val hasAutoFocus = extInfo.properties.contains(SonyPtpOpcodes.DPC_AUTOFOCUS) ||
                baseProps.contains(SonyPtpOpcodes.DPC_AUTOFOCUS) ||
                baseOps.contains(SonyPtpOpcodes.DPC_AUTOFOCUS)
        val hasCapture = extInfo.properties.contains(SonyPtpOpcodes.DPC_CAPTURE) ||
                baseProps.contains(SonyPtpOpcodes.DPC_CAPTURE) ||
                baseOps.contains(SonyPtpOpcodes.DPC_CAPTURE)
        val hasObjectAdded = extInfo.events.contains(SonyPtpOpcodes.EVENT_OBJECT_ADDED) ||
                baseEvts.contains(SonyPtpOpcodes.EVENT_OBJECT_ADDED)

        Timber.i(
            "Capabilities: ControlDevice=%b, AutoFocus=%b, Capture=%b, ObjectAdded=%b (checked extDeviceInfo & baseDeviceInfo)",
            hasControlDevice, hasAutoFocus, hasCapture, hasObjectAdded
        )
        UsbEventLogger.log(
            "CAPABILITIES",
            "ControlDevice(0x9207)=$hasControlDevice, AutoFocus(0xD2C1)=$hasAutoFocus, Capture(0xD2C2)=$hasCapture, ObjectAdded(0xC201)=$hasObjectAdded"
        )

        // Don't hard-fail if SDIO_ControlDevice is confirmed via baseDeviceInfo or extDeviceInfo,
        // or if extInfo properties are present (which indicates valid Sony remote properties)
        check(hasControlDevice || extInfo.properties.isNotEmpty()) {
            "Camera does not support SDIO_ControlDevice (0x9207) — remote shutter control unavailable"
        }
    }

    private fun parseExtDeviceInfo(payload: ByteArray): SonyExtDeviceInfo {
        val buf = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN)
        val version = if (buf.remaining() >= 2) buf.short.toInt() and 0xFFFF else 0
        val count = if (buf.remaining() >= 4) buf.int else 0

        val operations = mutableListOf<Int>()
        val events = mutableListOf<Int>()
        val properties = mutableListOf<Int>()

        var i = 0
        while (i < count && buf.remaining() >= 4) {
            val code = buf.int
            when (code and 0x7000) {
                0x1000 -> operations.add(code)
                0x4000 -> events.add(code)
                0x5000 -> properties.add(code)
                else -> {
                    if (code in 0x9200..0x92FF) operations.add(code)
                    else if (code in 0xC200..0xC2FF) events.add(code)
                    else if (code in 0xD200..0xD2FF) properties.add(code)
                }
            }
            i++
        }

        Timber.d(
            "parseExtDeviceInfo: version=0x%04X, count=%d, parsed: ops=%d, evts=%d, props=%d, remainingBytes=%d",
            version, count, operations.size, events.size, properties.size, buf.remaining()
        )
        return SonyExtDeviceInfo(version, operations, events, properties)
    }

    override fun close() {
        isConnected = false
        extDeviceInfo = null
        baseDeviceInfo = null
        transport.close()
        Timber.i("SonyRemoteSession closed")
    }

    data class SonyExtDeviceInfo(
        val version: Int,
        val operations: List<Int>,
        val events: List<Int>,
        val properties: List<Int>,
    )

    private data class ParsedObjectInfo(
        val filename: String,
        val mimeType: String,
    )
}

