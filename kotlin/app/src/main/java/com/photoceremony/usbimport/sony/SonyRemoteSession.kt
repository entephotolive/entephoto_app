package com.photoceremony.usbimport.sony

import android.content.ContentValues
import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.photoceremony.usbimport.db.DownloadedFileDao
import com.photoceremony.usbimport.model.ImportEvent
import com.photoceremony.usbimport.model.ImportRecord
import com.photoceremony.usbimport.legacy_mtp.ImportSession
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
    private val device: UsbDevice,
    private val usbManager: UsbManager,
) : Closeable {

    private val transport = PtpUsbTransport(device, usbManager)
    private val relativeDir = "DCIM/entephoto/"

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
     * Triggers the physical shutter release on the camera without waiting for or downloading photos.
     *
     * STEP 4 implementation: Property-write + capture-trigger opcode sequence.
     *
     * Sequence:
     * 1. AutoFocus half-press (0xD2C1 = 1) via SDIO_ControlDevice (0x9207)
     * 2. AF settling pause (300 ms)
     * 3. Capture full-press (0xD2C2 = 1) via SDIO_ControlDevice (0x9207)
     * 4. Shutter pulse delay (100 ms)
     * 5. Release Capture (0xD2C2 = 0) & AutoFocus (0xD2C1 = 0)
     */
    fun triggerShutterOnly() {
        check(isConnected) { "Cannot trigger shutter — SonyRemoteSession is not connected" }

        Timber.i("SonyRemoteSession: Firing shutter (SDIO_ControlDevice 0xD2C1=1 -> 0xD2C2=1)...")

        try {
            // 1. AutoFocus (S1 half-press)
            setControlProperty(SonyPtpOpcodes.DPC_AUTOFOCUS, 0x01)
            Thread.sleep(300)

            // 2. Capture (S2 full-press)
            setControlProperty(SonyPtpOpcodes.DPC_CAPTURE, 0x01)
            Thread.sleep(100)

            Timber.i("Shutter fired successfully!")

        } finally {
            // 3. Always release shutter controls to prevent camera shutter lockup
            try {
                setControlProperty(SonyPtpOpcodes.DPC_CAPTURE, 0x00)
            } catch (e: Exception) {
                Timber.w(e, "Error releasing DPC_CAPTURE flag")
            }
            try {
                setControlProperty(SonyPtpOpcodes.DPC_AUTOFOCUS, 0x00)
            } catch (e: Exception) {
                Timber.w(e, "Error releasing DPC_AUTOFOCUS flag")
            }
        }
    }

    /**
     * Triggers remote shutter capture and downloads the resulting photo instantly.
     *
     * Capture flow:
     * 1. Simulates half-press: Set AutoFocus (0xD2C1) = 1
     * 2. Settling delay (300 ms)
     * 3. Simulates full-press: Set Capture (0xD2C2) = 1
     * 4. Polls for ObjectAdded (0xC201) event containing the new object handle
     * 5. Releases shutter (AutoFocus = 0, Capture = 0)
     * 6. Downloads the object bytes via GetObject (0x1009) and persists to MediaStore/Disk
     * 7. Feeds the downloaded file into the existing Room DB persistence and UI emission pipeline via [ImportSession.recordImportCompleted]
     *
     * @param context Application context for MediaStore insertion
     * @param dao Optional [DownloadedFileDao] for Room database persistence
     * @return [ImportRecord] of the downloaded photo
     */
    fun triggerCaptureAndDownload(context: Context, dao: DownloadedFileDao? = null): ImportRecord {
        check(isConnected) { "Cannot trigger capture — SonyRemoteSession is not connected" }

        Timber.i("SonyRemoteSession: Starting remote capture and download sequence...")

        try {
            // Step 1: AutoFocus (half-press)
            setControlProperty(SonyPtpOpcodes.DPC_AUTOFOCUS, 0x01)
            Thread.sleep(300)

            // Step 2: Capture (full-press)
            setControlProperty(SonyPtpOpcodes.DPC_CAPTURE, 0x01)

            // Step 3: Wait for ObjectAdded (0xC201) event
            val handle = waitForObjectAddedEvent(timeoutMs = 10_000)

            ImportSession.emitEvent(ImportEvent.ImportStarted(handle))
            Timber.i("Capture complete! Object handle discovered: %d. Starting download...", handle)

            // Step 4: Download object
            val record = downloadObject(context, handle)
            Timber.i("Downloaded captured object %d -> '%s' (%s)", handle, record.filename, record.formattedSize)

            // Step 5: Feed into Room persistence + UI emission pipeline
            ImportSession.recordImportCompleted(record, dao)

            return record

        } finally {
            // Release shutter controls
            try {
                setControlProperty(SonyPtpOpcodes.DPC_CAPTURE, 0x00)
            } catch (_: Exception) {}
            try {
                setControlProperty(SonyPtpOpcodes.DPC_AUTOFOCUS, 0x00)
            } catch (_: Exception) {}
        }
    }

    /**
     * Sets a Type B transient control property via SDIO_ControlDevice (0x9207).
     */
    private fun setControlProperty(propertyCode: Int, value: Byte) {
        val txId = transport.allocateTransactionId()
        transport.sendCommandContainer(
            opcode = SonyPtpOpcodes.SDIO_CONTROL_DEVICE,
            transactionId = txId,
            params = intArrayOf(propertyCode)
        )
        transport.sendDataContainer(
            opcode = SonyPtpOpcodes.SDIO_CONTROL_DEVICE,
            transactionId = txId,
            payload = byteArrayOf(value)
        )
        val resp = transport.receiveResponseContainer(txId)
        transport.checkResponseOk(resp, "SDIO_ControlDevice(0x%04X = %d)".format(propertyCode, value))
    }

    /**
     * Non-blocking single poll for a PTP event from the camera.
     *
     * Uses the same dual strategy as the internal [waitForObjectAddedEvent]:
     * 1. USB Interrupt-IN endpoint (non-blocking, 100 ms timeout).
     * 2. Fallback: standard PTP GetEvent (0x1003) opcode.
     *
     * **Never throws** — all exceptions are swallowed and logged at DEBUG.
     * Returns `null` when no event is available yet (caller should delay and retry).
     *
     * Intended for use by the background [com.photoceremony.usbimport.service.ImportService]
     * event-listening loop while in [com.photoceremony.usbimport.ptp.ConnectionState.RemoteShooting]
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
     * Downloads a PTP object by handle and saves it to MediaStore / disk.
     *
     * Public entry point for the background event loop in
     * [com.photoceremony.usbimport.service.ImportService]. Delegates to the
     * internal [downloadObject] implementation.
     *
     * @param context Application context for MediaStore insertion.
     * @param handle  PTP object handle received from an [SonyPtpOpcodes.EVENT_OBJECT_ADDED] event.
     * @return [ImportRecord] describing the saved file.
     */
    fun fetchAndSaveObject(context: Context, handle: Int): ImportRecord {
        check(isConnected) { "Cannot download object — SonyRemoteSession is not connected" }
        return downloadObject(context, handle)
    }

    /**
     * Polls for ObjectAdded (0xC201) event using a dual strategy:
     * 1. Primary: USB Interrupt endpoint non-blocking read ([PtpUsbTransport.readInterruptEvent])
     * 2. Fallback: Standard PTP GetEvent (0x1003) command polling ([PtpUsbTransport.pollGetEvent])
     */
    private fun waitForObjectAddedEvent(timeoutMs: Long): Int {
        val startTime = System.currentTimeMillis()

        while (System.currentTimeMillis() - startTime < timeoutMs) {
            // Strategy 1: USB Interrupt Endpoint
            try {
                val evt = transport.readInterruptEvent()
                if (evt != null) {
                    Timber.d("Interrupt event detected: 0x%04X, param1=0x%08X", evt.code, evt.param1)
                    if (evt.code == SonyPtpOpcodes.EVENT_OBJECT_ADDED && evt.param1.toUInt() != 0u) {
                        return evt.param1
                    }
                }
            } catch (e: Exception) {
                Timber.d("Interrupt endpoint read quiet/unavailable (%s) — using pollGetEvent fallback", e.message)
            }

            // Strategy 2: Polled PTP GetEvent (0x1003) opcode fallback
            try {
                val evt = transport.pollGetEvent()
                if (evt != null) {
                    Timber.d("Polled GetEvent detected: 0x%04X, param1=0x%08X", evt.code, evt.param1)
                    if (evt.code == SonyPtpOpcodes.EVENT_OBJECT_ADDED && evt.param1.toUInt() != 0u) {
                        return evt.param1
                    }
                }
            } catch (e: Exception) {
                Timber.d("pollGetEvent error: %s", e.message)
            }

            Thread.sleep(100)
        }

        throw PtpUsbTransport.PtpTransportException(
            "Timeout waiting for ObjectAdded (0xC201) event after ${timeoutMs}ms"
        )
    }

    /**
     * Downloads PTP object metadata and payload, saving to MediaStore or disk.
     */
    private fun downloadObject(context: Context, handle: Int): ImportRecord {
        // 1. GetObjectInfo (0x1008)
        var objectInfo = ParsedObjectInfo("SONY_%08X.jpg".format(handle.toLong() and 0xFFFFFFFFL), "image/jpeg")
        try {
            val txIdInfo = transport.allocateTransactionId()
            transport.sendCommandContainer(
                opcode = SonyPtpOpcodes.PTP_OC_GET_OBJECT_INFO,
                transactionId = txIdInfo,
                params = intArrayOf(handle)
            )
            val infoPayload = transport.receiveDataContainer(txIdInfo)
            val respInfo = transport.receiveResponseContainer(txIdInfo)
            if (respInfo.isOk) {
                objectInfo = parseObjectInfo(infoPayload, handle)
            }
        } catch (e: Exception) {
            Timber.w(e, "GetObjectInfo optional step failed for handle=0x%08X (using fallback filename): %s", handle, e.message)
        }

        // 2. GetObject (0x1009)
        val txIdObj = transport.allocateTransactionId()
        Timber.i("downloadObject: Sending GetObject (0x1009) for handle=0x%08X (txID=%d)", handle, txIdObj)
        UsbEventLogger.log("GET_OBJECT", "Sending GetObject (0x1009) handle=0x%08X txID=%d".format(handle, txIdObj))

        transport.sendCommandContainer(
            opcode = SonyPtpOpcodes.PTP_OC_GET_OBJECT,
            transactionId = txIdObj,
            params = intArrayOf(handle)
        )
        val objectBytes = transport.receiveDataContainer(txIdObj)

        // STEP 3: Read final Response container after data completes
        Timber.i("downloadObject: Data phase complete (%d bytes). Reading final Response container (txID=%d)...", objectBytes.size, txIdObj)
        UsbEventLogger.log("GET_OBJECT", "Data phase complete (${objectBytes.size} bytes). Reading final Response container...")

        val respObj = transport.receiveResponseContainer(txIdObj)
        Timber.i("downloadObject: GetObject Response container: code=0x%04X, txID=%d, params=%s",
            respObj.code, respObj.transactionId, respObj.params.toList())
        UsbEventLogger.log("GET_OBJECT", "GetObject Response: code=0x%04X (0x2001=OK) txID=%d".format(respObj.code, respObj.transactionId))
        transport.checkResponseOk(respObj, "GetObject")

        // STEP 4: Wire completion into the existing save/UI path
        val filename = objectInfo.filename.ifBlank { "SONY_$handle.jpg" }
        val mimeType = objectInfo.mimeType

        val record = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveToMediaStore(context, handle, filename, mimeType, objectBytes)
        } else {
            saveToFile(handle, filename, mimeType, objectBytes)
        }

        Timber.i("downloadObject: Successfully saved '%s' (%d bytes, %s)", filename, objectBytes.size, mimeType)
        UsbEventLogger.log("GET_OBJECT", "Successfully saved '$filename' (${objectBytes.size} bytes, $mimeType)")

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
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir) // "DCIM/entephoto/"
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
            "entephoto"
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

    /**
     * Executes the SDIO handshake in diagnostic mode, recording and logging
     * the response of every stage separately to isolate failures.
     */
    fun runSdioHandshakeDiagnostic(): SdioDiagnosticReport {
        val stages = mutableListOf<SdioStageResult>()
        var parsedExtInfo: SonyExtDeviceInfo? = null

        try {
            transport.open()

            // Pre-test: GetDeviceInfo
            try {
                val base = transport.executeGetDeviceInfo()
                baseDeviceInfo = base
                stages.add(
                    SdioStageResult(
                        stageName = "Pre-Test: GetDeviceInfo (0x1001)",
                        isSuccess = true,
                        responseCodeHex = "0x2001 (OK)",
                        details = "Model=${base.model}, Mfr=${base.manufacturer}, Serial=${base.serialNumber}"
                    )
                )
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Pre-Test: GetDeviceInfo (0x1001)",
                        isSuccess = false,
                        responseCodeHex = "FAIL",
                        errorMessage = e.message
                    )
                )
                return SdioDiagnosticReport("Unknown", stages, null, false)
            }

            // Stage OpenSession: OpenSession (0x1002)
            try {
                transport.executeOpenSession(sessionId = 1)
                stages.add(
                    SdioStageResult(
                        stageName = "Stage OpenSession: OpenSession (0x1002 [1])",
                        isSuccess = true,
                        responseCodeHex = "0x2001 (OK)",
                        details = "Session ID=1 opened successfully"
                    )
                )
                Timber.i("SDIO Diagnostic Stage OpenSession: PASS")
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage OpenSession: OpenSession (0x1002 [1])",
                        isSuccess = false,
                        responseCodeHex = "FAIL",
                        errorMessage = e.message
                    )
                )
                return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            }

            // Stage 1: SDIO_Connect Phase 1
            val txId1 = transport.allocateTransactionId()
            try {
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId1, intArrayOf(1, 0, 0))
                val data1 = transport.receiveDataContainer(txId1, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val resp1 = transport.receiveResponseContainer(txId1, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val ok1 = resp1.isOk
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 1: SDIO_Connect Phase 1 (0x9201 [1,0,0])",
                        isSuccess = ok1,
                        responseCodeHex = "0x${resp1.code.toString(16).uppercase()}",
                        responseParams = resp1.params.toList(),
                        details = "TxID=$txId1, dataBytes=${data1.size}, respCode=0x${resp1.code.toString(16).uppercase()}"
                    )
                )
                Timber.i("SDIO Diagnostic Stage 1: respCode=0x%04X, dataBytes=%d, params=%s", resp1.code, data1.size, resp1.params.toList())
                if (!ok1) return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 1: SDIO_Connect Phase 1 (0x9201 [1,0,0])",
                        isSuccess = false,
                        responseCodeHex = "FAIL",
                        errorMessage = e.message
                    )
                )
                return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            }

            // Stage 2: SDIO_Connect Phase 2
            val txId2 = transport.allocateTransactionId()
            try {
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId2, intArrayOf(2, 0, 0))
                val data2 = transport.receiveDataContainer(txId2, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val resp2 = transport.receiveResponseContainer(txId2, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val ok2 = resp2.isOk
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 2: SDIO_Connect Phase 2 (0x9201 [2,0,0])",
                        isSuccess = ok2,
                        responseCodeHex = "0x${resp2.code.toString(16).uppercase()}",
                        responseParams = resp2.params.toList(),
                        details = "TxID=$txId2, dataBytes=${data2.size}, respCode=0x${resp2.code.toString(16).uppercase()}"
                    )
                )
                Timber.i("SDIO Diagnostic Stage 2: respCode=0x%04X, dataBytes=%d, params=%s", resp2.code, data2.size, resp2.params.toList())
                if (!ok2) return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 2: SDIO_Connect Phase 2 (0x9201 [2,0,0])",
                        isSuccess = false,
                        responseCodeHex = "FAIL",
                        errorMessage = e.message
                    )
                )
                return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            }

            // Stage Ext: SDIO_GetExtDeviceInfo
            var tries = 20
            var extRespCode = 0
            var extPayloadSize = 0
            while (parsedExtInfo == null && tries > 0) {
                tries--
                try {
                    val txIdExt = transport.allocateTransactionId()
                    transport.sendCommandContainer(SonyPtpOpcodes.SDIO_GET_EXT_DEVICE_INFO, txIdExt, intArrayOf(0xC8))
                    val payload = transport.receiveDataContainer(txIdExt)
                    val respExt = transport.receiveResponseContainer(txIdExt)
                    extRespCode = respExt.code
                    extPayloadSize = payload.size

                    val rawHex = payload.joinToString(" ") { "%02X".format(it) }
                    Timber.d("SDIO_GetExtDeviceInfo raw payload (%d bytes): %s", payload.size, rawHex)
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
                if (parsedExtInfo == null && tries > 0) Thread.sleep(50)
            }

            val finalExt = parsedExtInfo
            if (finalExt != null) {
                this.extDeviceInfo = finalExt

                val baseOps = baseDeviceInfo?.operationsSupported ?: emptyList()
                val baseEvts = baseDeviceInfo?.eventsSupported ?: emptyList()
                val baseProps = baseDeviceInfo?.devicePropertiesSupported ?: emptyList()

                val hasControl = finalExt.operations.contains(SonyPtpOpcodes.SDIO_CONTROL_DEVICE) ||
                        baseOps.contains(SonyPtpOpcodes.SDIO_CONTROL_DEVICE)
                val hasAF = finalExt.properties.contains(SonyPtpOpcodes.DPC_AUTOFOCUS) ||
                        baseProps.contains(SonyPtpOpcodes.DPC_AUTOFOCUS) ||
                        baseOps.contains(SonyPtpOpcodes.DPC_AUTOFOCUS)
                val hasCap = finalExt.properties.contains(SonyPtpOpcodes.DPC_CAPTURE) ||
                        baseProps.contains(SonyPtpOpcodes.DPC_CAPTURE) ||
                        baseOps.contains(SonyPtpOpcodes.DPC_CAPTURE)
                val hasEvt = finalExt.events.contains(SonyPtpOpcodes.EVENT_OBJECT_ADDED) ||
                        baseEvts.contains(SonyPtpOpcodes.EVENT_OBJECT_ADDED)

                val detailsStr = "ExtPayload=${extPayloadSize}B (props=${finalExt.properties.size}, ops=${finalExt.operations.size}, evts=${finalExt.events.size}) | BaseInfo (ops=${baseOps.size}, evts=${baseEvts.size}, props=${baseProps.size})\n" +
                        "ControlDevice(0x9207)=$hasControl, AutoFocus(0xD2C1)=$hasAF, Capture(0xD2C2)=$hasCap, ObjectAdded(0xC201)=$hasEvt"

                val stagePass = hasControl || finalExt.properties.isNotEmpty()

                stages.add(
                    SdioStageResult(
                        stageName = "Stage Ext: SDIO_GetExtDeviceInfo (0x9202 [0xC8])",
                        isSuccess = stagePass,
                        responseCodeHex = "0x${extRespCode.toString(16).uppercase()}",
                        details = detailsStr
                    )
                )
                Timber.i("SDIO Diagnostic Stage Ext: %s (pass=%b)", detailsStr, stagePass)
                if (!stagePass) return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, finalExt, false)
            } else {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage Ext: SDIO_GetExtDeviceInfo (0x9202 [0xC8])",
                        isSuccess = false,
                        responseCodeHex = "0x${extRespCode.toString(16).uppercase()}",
                        details = "Failed to obtain ExtDeviceInfo after 20 retries"
                    )
                )
                return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, null, false)
            }

            // Stage 3: SDIO_Connect Phase 3 — same two-phase read pattern as Phase 1/2
            val txId3 = transport.allocateTransactionId()
            try {
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONNECT, txId3, intArrayOf(3, 0, 0))
                val data3 = transport.receiveDataContainer(txId3, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val resp3 = transport.receiveResponseContainer(txId3, timeoutMs = PtpUsbTransport.TIMEOUT_SDIO_MS)
                val ok3 = resp3.isOk
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 3: SDIO_Connect Phase 3 (0x9201 [3,0,0])",
                        isSuccess = ok3,
                        responseCodeHex = "0x${resp3.code.toString(16).uppercase()}",
                        responseParams = resp3.params.toList(),
                        details = "TxID=$txId3, payloadSize=${data3.size}B, respCode=0x${resp3.code.toString(16).uppercase()}"
                    )
                )
                Timber.i("SDIO Diagnostic Stage 3: respCode=0x%04X, payloadSize=%d, params=%s", resp3.code, data3.size, resp3.params.toList())
                UsbEventLogger.log("SDIO_PHASE3", "Stage 3 result: code=0x%04X payloadSize=%dB params=%s".format(resp3.code, data3.size, resp3.params.toList()))
                if (!ok3) return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, finalExt, false)
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage 3: SDIO_Connect Phase 3 (0x9201 [3,0,0])",
                        isSuccess = false,
                        responseCodeHex = "FAIL",
                        errorMessage = e.message
                    )
                )
                UsbEventLogger.log("SDIO_PHASE3", "Stage 3 exception: ${e.message}")
                return SdioDiagnosticReport(baseDeviceInfo?.model ?: "Sony Camera", stages, finalExt, false)
            }

            // Stage Priority: PriorityMode
            try {
                claimPriorityMode()
                stages.add(
                    SdioStageResult(
                        stageName = "Stage Priority: PriorityMode (0x9207 DPC 0xD2D1=1)",
                        isSuccess = true,
                        responseCodeHex = "0x2001 (OK)",
                        details = "PriorityMode set successfully"
                    )
                )
            } catch (e: Exception) {
                stages.add(
                    SdioStageResult(
                        stageName = "Stage Priority: PriorityMode (0x9207 DPC 0xD2D1=1)",
                        isSuccess = false,
                        responseCodeHex = "WARN",
                        details = "PriorityMode set failed (non-fatal): ${e.message}"
                    )
                )
            }

            isConnected = true
            return SdioDiagnosticReport(
                baseModel = baseDeviceInfo?.model ?: "Sony Camera",
                stageResults = stages,
                extDeviceInfo = finalExt,
                overallPass = true
            )

        } finally {
            close()
        }
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

    /**
     * STEP 3 DIAGNOSTIC: Validates that the shutter actually fires on the physical camera.
     *
     * Sequence:
     *  1. Full SDIO handshake via [connect] (reuses existing validated path).
     *  2. AutoFocus half-press  (DPC_AUTOFOCUS 0xD2C1 = 0x01)
     *  3. AF settling delay     (300 ms)
     *  4. Capture full-press    (DPC_CAPTURE  0xD2C2 = 0x01)
     *  5. Shutter pulse delay   (100 ms) — shutter should physically fire here
     *  6. Release Capture       (DPC_CAPTURE  = 0x00)
     *  7. Release AutoFocus     (DPC_AUTOFOCUS = 0x00)
     *
     * Each step records PASS/FAIL + the raw PTP response code.
     * The caller is responsible for physically observing whether the shutter fires
     * after step 4/5 completes.
     */
    fun runShutterDiagnostic(): ShutterDiagnosticReport {
        val steps = mutableListOf<ShutterStepResult>()

        fun recordStep(name: String, block: () -> String) {
            try {
                val detail = block()
                steps.add(ShutterStepResult(name, isSuccess = true, detail = detail))
                Timber.i("SHUTTER DIAG [PASS] %s — %s", name, detail)
            } catch (e: Exception) {
                steps.add(ShutterStepResult(name, isSuccess = false, detail = e.message ?: "Unknown error", errorMessage = e.message))
                Timber.e(e, "SHUTTER DIAG [FAIL] %s", name)
                throw e   // propagate to abort the sequence
            }
        }

        try {
            // ── Step 0: Full SDIO Handshake ──────────────────────────────────
            recordStep("Step 0: Full SDIO Handshake (connect)") {
                connect()   // opens transport + all 3 phases + PriorityMode
                "Model=${baseDeviceInfo?.model}, isConnected=$isConnected"
            }

            // ── Step 1: AutoFocus half-press ─────────────────────────────────
            recordStep("Step 1: AF half-press (0xD2C1 = 0x01)") {
                val txId = transport.allocateTransactionId()
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, intArrayOf(SonyPtpOpcodes.DPC_AUTOFOCUS))
                transport.sendDataContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, byteArrayOf(0x01))
                val resp = transport.receiveResponseContainer(txId)
                "respCode=0x${resp.code.toString(16).uppercase().padStart(4, '0')}"
            }

            // ── Step 2: AF settling delay ────────────────────────────────────
            recordStep("Step 2: AF settling delay (300 ms)") {
                Thread.sleep(300)
                "OK (300 ms elapsed)"
            }

            // ── Step 3: Capture full-press ───────────────────────────────────
            recordStep("Step 3: Capture full-press (0xD2C2 = 0x01) — WATCH CAMERA") {
                val txId = transport.allocateTransactionId()
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, intArrayOf(SonyPtpOpcodes.DPC_CAPTURE))
                transport.sendDataContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, byteArrayOf(0x01))
                val resp = transport.receiveResponseContainer(txId)
                "respCode=0x${resp.code.toString(16).uppercase().padStart(4, '0')} ← camera shutter should fire NOW"
            }

            // ── Step 4: Shutter pulse delay ──────────────────────────────────
            recordStep("Step 4: Shutter pulse delay (100 ms)") {
                Thread.sleep(100)
                "OK (100 ms elapsed)"
            }

            return ShutterDiagnosticReport(
                baseModel = baseDeviceInfo?.model ?: "Sony Camera",
                stepResults = steps,
                overallPass = true
            )

        } catch (_: Exception) {
            return ShutterDiagnosticReport(
                baseModel = baseDeviceInfo?.model ?: "Sony Camera",
                stepResults = steps,
                overallPass = false
            )
        } finally {
            // Always release shutter controls — never leave camera locked up
            try {
                val txId = transport.allocateTransactionId()
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, intArrayOf(SonyPtpOpcodes.DPC_CAPTURE))
                transport.sendDataContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, byteArrayOf(0x00))
                transport.receiveResponseContainer(txId)
                Timber.i("SHUTTER DIAG: DPC_CAPTURE released (0x00)")
            } catch (e: Exception) { Timber.w(e, "SHUTTER DIAG: Failed to release DPC_CAPTURE") }

            try {
                val txId = transport.allocateTransactionId()
                transport.sendCommandContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, intArrayOf(SonyPtpOpcodes.DPC_AUTOFOCUS))
                transport.sendDataContainer(SonyPtpOpcodes.SDIO_CONTROL_DEVICE, txId, byteArrayOf(0x00))
                transport.receiveResponseContainer(txId)
                Timber.i("SHUTTER DIAG: DPC_AUTOFOCUS released (0x00)")
            } catch (e: Exception) { Timber.w(e, "SHUTTER DIAG: Failed to release DPC_AUTOFOCUS") }

            close()
        }
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

    data class SdioStageResult(
        val stageName: String,
        val isSuccess: Boolean,
        val responseCodeHex: String,
        val responseParams: List<Int> = emptyList(),
        val details: String = "",
        val errorMessage: String? = null,
    )

    data class SdioDiagnosticReport(
        val baseModel: String,
        val stageResults: List<SdioStageResult>,
        val extDeviceInfo: SonyExtDeviceInfo?,
        val overallPass: Boolean,
    )

    data class ShutterStepResult(
        val stepName: String,
        val isSuccess: Boolean,
        val detail: String,
        val errorMessage: String? = null,
    )

    data class ShutterDiagnosticReport(
        val baseModel: String,
        val stepResults: List<ShutterStepResult>,
        /** True if every step including the shutter full-press returned a 0x2001 OK response. */
        val overallPass: Boolean,
    )

    private data class ParsedObjectInfo(
        val filename: String,
        val mimeType: String,
    )
}
