package com.photoceremony.entephotocamera.sony

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import android.os.Build
import timber.log.Timber
import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.Executors
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Raw USB PTP transport layer for Sony cameras operating in PC Remote mode.
 */
class PtpUsbTransport(
    private val device: UsbDevice,
    private val usbManager: UsbManager,
) : Closeable {

    private var connection: UsbDeviceConnection? = null
    private var usbInterface: UsbInterface? = null

    private var epBulkOut: UsbEndpoint? = null
    private var epBulkIn: UsbEndpoint? = null
    private var epInterruptIn: UsbEndpoint? = null

    private val nextTransactionId = AtomicInteger(1)

    /** Bounded buffer preserving surplus bytes received across container boundaries. */
    @Volatile
    private var pendingBulkInBytes: ByteArray? = null

    companion object {
        private val usbSessionMutex = Mutex()

        suspend fun <T> withExclusiveSession(block: suspend () -> T): T =
            usbSessionMutex.withLock { block() }

        val transportMutex: Mutex get() = usbSessionMutex

        private val singleThreadExecutor = Executors.newSingleThreadExecutor { r ->
            Thread(r, "PtpUsbTransportThread").apply { isDaemon = true }
        }
        val usbDispatcher: CoroutineDispatcher = singleThreadExecutor.asCoroutineDispatcher()

        const val PTP_TYPE_COMMAND  = 0x0001
        const val PTP_TYPE_DATA     = 0x0002
        const val PTP_TYPE_RESPONSE = 0x0003
        const val PTP_TYPE_EVENT    = 0x0004

        const val PTP_RC_OK           = 0x2001
        const val PTP_RC_GeneralError = 0x2002
        const val PTP_RC_DeviceBusy   = 0x2019

        const val PTP_OC_GetDeviceInfo = 0x1001
        const val PTP_OC_OpenSession   = 0x1002
        const val PTP_OC_CloseSession  = 0x1003
        const val PTP_OC_GetEvent      = 0x9803

        const val TIMEOUT_CMD_MS       = 5_000
        const val TIMEOUT_DATA_MS      = 30_000
        const val TIMEOUT_INTERRUPT_MS = 100
        const val TIMEOUT_SDIO_MS      = 5_000

        const val HEADER_SIZE = 12
        const val MAX_PARAMS = 5
        const val MAX_RESPONSE_BUFFER = 16_384
        const val MAX_EVENT_BUFFER = 64
    }

    var isSessionOpen: Boolean = false
        private set

    var isInterfaceClaimed: Boolean = false
        private set

    val isConnectionOpen: Boolean get() = connection != null
    val bulkInEndpointAddress: Int? get() = epBulkIn?.address
    val bulkInMaxPacketSize: Int? get() = epBulkIn?.maxPacketSize
    val pendingCarryOverByteCount: Int get() = pendingBulkInBytes?.size ?: 0

    fun open() {
        if (connection != null) {
            Timber.w("PtpUsbTransport.open() called while connection exists — performing clean reset")
            close()
            try { Thread.sleep(100) } catch (_: Exception) {}
        }

        val openMsg = "PtpUsbTransport.open() — VID=0x%04X PID=0x%04X name=%s".format(
            device.vendorId, device.productId, device.deviceName,
        )
        Timber.i(openMsg)
        UsbEventLogger.log("USB_OPEN", openMsg)

        val conn = usbManager.openDevice(device)
        UsbEventLogger.log(
            "USB_OPEN",
            "usbManager.openDevice() -> " + if (conn != null) "SUCCESS (fd=${conn.fileDescriptor})" else "FAILED (null)"
        )
        if (conn == null) {
            throw PtpTransportException(
                "UsbManager.openDevice() returned null — device busy or " +
                "USB permission not granted"
            )
        }
        connection = conn

        val iface = findPtpInterface(device)
            ?: run {
                conn.close()
                connection = null
                UsbEventLogger.log("USB_OPEN", "No suitable PTP interface found on VID=0x%04X PID=0x%04X".format(device.vendorId, device.productId))
                throw PtpTransportException(
                    "No suitable PTP interface found on " +
                    "VID=0x%04X PID=0x%04X".format(device.vendorId, device.productId)
                )
            }
        usbInterface = iface

        var claimed = false
        var claimAttempt = 0
        val maxClaimAttempts = 3
        val claimRetryDelayMs = 300L

        while (!claimed && claimAttempt < maxClaimAttempts) {
            claimAttempt++
            claimed = conn.claimInterface(iface, /* forceClaim = */ true)
            val claimMsg = "claimInterface(ifaceId=${iface.id}, forceClaim=true) attempt $claimAttempt/$maxClaimAttempts → claimed=$claimed"
            Timber.i("PtpUsbTransport.%s", claimMsg)
            UsbEventLogger.log("USB_CLAIM", claimMsg)
            if (!claimed && claimAttempt < maxClaimAttempts) {
                Timber.w(
                    "PtpUsbTransport: claimInterface attempt %d failed — waiting %dms before retry",
                    claimAttempt, claimRetryDelayMs
                )
                try { Thread.sleep(claimRetryDelayMs) } catch (_: InterruptedException) {}
            }
        }

        if (!claimed) {
            conn.close()
            connection = null
            usbInterface = null
            UsbEventLogger.log("USB_CLAIM", "claimInterface failed on all $maxClaimAttempts attempts!")
            throw PtpTransportException(
                "PtpUsbTransport: claimInterface(ifaceId=${iface.id}, forceClaim=true) " +
                "returned FALSE on all $maxClaimAttempts attempts"
            )
        }

        isInterfaceClaimed = true

        val settleDelayMs = 400L
        UsbEventLogger.log("USB_SETTLE", "claimInterface OK. Settle delay ${settleDelayMs}ms before bulkTransfer...")
        try { Thread.sleep(settleDelayMs) } catch (_: InterruptedException) {}
        UsbEventLogger.log("USB_SETTLE", "Settle delay finished.")

        try {
            discoverEndpoints(iface)
            clearEndpointHalt(isInput = true)
            clearEndpointHalt(isInput = false)
            drainPendingBulkIn(timeoutMs = 50)
        } catch (e: Exception) {
            isInterfaceClaimed = false
            conn.releaseInterface(iface)
            conn.close()
            connection = null
            usbInterface = null
            UsbEventLogger.log("USB_ENDPOINTS", "discoverEndpoints threw exception: ${e.message}")
            throw e
        }

        val epSummary = "open OK — epOut=EP%d (0x%02X) epIn=EP%d (0x%02X) epInterrupt=%s".format(
            epBulkOut?.endpointNumber ?: -1,
            epBulkOut?.address ?: 0,
            epBulkIn?.endpointNumber  ?: -1,
            epBulkIn?.address ?: 0,
            epInterruptIn?.let { "EP${it.endpointNumber}" } ?: "(none)",
        )
        Timber.i("PtpUsbTransport: %s", epSummary)
        UsbEventLogger.log("USB_ENDPOINTS", epSummary)
    }

    override fun close() {
        UsbEventLogger.log("USB_CLOSE", "PtpUsbTransport.close() ENTRY — releasing session & interface")
        if (isSessionOpen) {
            try {
                executeCloseSession(timeoutMs = 500)
            } catch (e: Exception) {
                Timber.w(e, "PtpUsbTransport.close(): exception sending CloseSession (ignored)")
            }
        }
        try {
            usbInterface?.let { iface ->
                connection?.releaseInterface(iface)
                Timber.d("PtpUsbTransport: released interface %d", iface.id)
                UsbEventLogger.log("USB_CLOSE", "Released interface ${iface.id}")
            }
        } catch (e: Exception) {
            Timber.w(e, "PtpUsbTransport.close(): exception releasing interface (ignored)")
        } finally {
            isInterfaceClaimed = false
        }
        try {
            connection?.close()
            Timber.d("PtpUsbTransport: USB connection closed")
            UsbEventLogger.log("USB_CLOSE", "UsbDeviceConnection closed")
        } catch (e: Exception) {
            Timber.w(e, "PtpUsbTransport.close(): exception closing connection (ignored)")
        }
        connection    = null
        usbInterface  = null
        isInterfaceClaimed = false
        epBulkOut     = null
        epBulkIn      = null
        epInterruptIn = null
        pendingBulkInBytes = null
        isSessionOpen = false
        UsbEventLogger.log("USB_CLOSE", "PtpUsbTransport.close() COMPLETE")
    }

    fun executeOpenSession(sessionId: Int = 1) {
        requireOpen()
        require(sessionId > 0) { "Session ID must be non-zero" }

        Timber.i("PtpUsbTransport: issuing OpenSession (0x1002) with sessionId=%d", sessionId)
        UsbEventLogger.log("USB_SESSION", "Issuing OpenSession (0x1002) sessionId=$sessionId")
        val txId = allocateTransactionId()
        sendCommandContainer(
            opcode        = PTP_OC_OpenSession,
            transactionId = txId,
            params        = intArrayOf(sessionId),
        )

        val response = receiveResponseContainer(
            expectedTransactionId = txId,
            timeoutMs             = TIMEOUT_CMD_MS,
        )

        if (response.code == PTP_RC_OK || response.code == 0x201E) {
            isSessionOpen = true
            UsbEventLogger.log("USB_SESSION", "OpenSession response=0x%04X -> isSessionOpen=true (sessionId=%d)".format(response.code, sessionId))
        }

        if (response.code != 0x201E) {
            checkResponseOk(response, "OpenSession")
        }
    }

    fun executeCloseSession(timeoutMs: Int = 1000) {
        if (connection == null) {
            isSessionOpen = false
            return
        }
        try {
            Timber.i("PtpUsbTransport: issuing CloseSession (0x1003) — timeout=%dms", timeoutMs)
            val txId = allocateTransactionId()
            sendCommandContainer(
                opcode        = PTP_OC_CloseSession,
                transactionId = txId,
                params        = intArrayOf(),
                timeoutMs     = timeoutMs,
            )
            receiveResponseContainer(
                expectedTransactionId = txId,
                timeoutMs             = timeoutMs,
            )
        } catch (e: Exception) {
            Timber.d("PtpUsbTransport: CloseSession error/timeout: %s", e.message)
        } finally {
            isSessionOpen = false
        }
    }

    fun executeGetDeviceInfo(): DeviceInfoResult {
        requireOpen()
        val txId = allocateTransactionId()
        sendCommandContainer(
            opcode        = PTP_OC_GetDeviceInfo,
            transactionId = txId,
            params        = intArrayOf(),
        )
        val dataPayload = receiveDataContainer(
            expectedTransactionId = txId,
            timeoutMs             = TIMEOUT_DATA_MS,
        )
        val response = receiveResponseContainer(
            expectedTransactionId = txId,
            timeoutMs             = TIMEOUT_CMD_MS,
        )
        checkResponseOk(response, "GetDeviceInfo")
        return parseDeviceInfo(dataPayload)
    }

    fun allocateTransactionId(): Int = nextTransactionId.getAndIncrement()

    fun sendCommandContainer(
        opcode: Int,
        transactionId: Int,
        params: IntArray = intArrayOf(),
        timeoutMs: Int = TIMEOUT_CMD_MS,
    ) {
        require(params.size <= MAX_PARAMS) { "PTP Command: at most $MAX_PARAMS params allowed" }
        val length = HEADER_SIZE + params.size * 4
        val buf    = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN)

        buf.putInt  (length)
        buf.putShort(PTP_TYPE_COMMAND.toShort())
        buf.putShort(opcode.toShort())
        buf.putInt  (transactionId)
        for (p in params) buf.putInt(p)

        val sent = rawBulkOut(buf.array(), length, timeoutMs)
        if (sent != length) {
            throw PtpTransportException("sendCommandContainer: sent $sent of $length bytes")
        }
    }

    fun sendDataContainer(
        opcode: Int,
        transactionId: Int,
        payload: ByteArray,
    ) {
        val length = HEADER_SIZE + payload.size
        val buf    = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN)

        buf.putInt  (length)
        buf.putShort(PTP_TYPE_DATA.toShort())
        buf.putShort(opcode.toShort())
        buf.putInt  (transactionId)
        buf.put     (payload)

        val sent = rawBulkOut(buf.array(), length)
        if (sent != length) {
            throw PtpTransportException("sendDataContainer: sent $sent of $length bytes")
        }
    }

    private fun savePendingBulkIn(newBytes: ByteArray) {
        if (newBytes.isEmpty()) return
        val current = pendingBulkInBytes
        if (current == null || current.isEmpty()) {
            pendingBulkInBytes = newBytes
        } else {
            val combined = ByteArray(current.size + newBytes.size)
            System.arraycopy(current, 0, combined, 0, current.size)
            System.arraycopy(newBytes, 0, combined, current.size, newBytes.size)
            pendingBulkInBytes = combined
        }
        CameraDiagnosticLogger.debug(
            "PtpUsbTransport",
            "Preserved ${newBytes.size} surplus bytes in carry-over buffer (total pending: ${pendingBulkInBytes?.size ?: 0})",
            pipelineStage = "BULK_IN_CARRYOVER"
        )
    }

    private fun readBulkInWithCarryOver(target: ByteArray, timeoutMs: Int): Int {
        val pending = pendingBulkInBytes
        if (pending != null && pending.isNotEmpty()) {
            val toCopy = minOf(pending.size, target.size)
            System.arraycopy(pending, 0, target, 0, toCopy)
            if (toCopy < pending.size) {
                pendingBulkInBytes = pending.copyOfRange(toCopy, pending.size)
            } else {
                pendingBulkInBytes = null
            }
            CameraDiagnosticLogger.debug(
                "PtpUsbTransport",
                "Consumed $toCopy pending carry-over bytes from previous transfer (remaining pending: ${pendingBulkInBytes?.size ?: 0})",
                pipelineStage = "BULK_IN_CARRYOVER"
            )
            return toCopy
        }
        return rawBulkIn(target, timeoutMs)
    }

    fun receiveResponseContainer(
        expectedTransactionId: Int,
        timeoutMs: Int = TIMEOUT_CMD_MS,
    ): PtpResponse {
        val raw = ByteArray(MAX_RESPONSE_BUFFER)
        var received = readBulkInWithCarryOver(raw, timeoutMs)

        // If carry-over provided fewer than 12 bytes (partial header), accumulate until at least HEADER_SIZE
        while (received in 1 until HEADER_SIZE) {
            val temp = ByteArray(MAX_RESPONSE_BUFFER)
            val more = rawBulkIn(temp, timeoutMs)
            if (more <= 0) break
            val toCopy = minOf(more, raw.size - received)
            System.arraycopy(temp, 0, raw, received, toCopy)
            received += toCopy
            if (more > toCopy) {
                savePendingBulkIn(temp.copyOfRange(toCopy, more))
            }
        }

        if (received < HEADER_SIZE) {
            val err = "receiveResponseContainer: received $received bytes; need ≥ $HEADER_SIZE"
            CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "RESP_CONTAINER")
            throw PtpTransportException(err)
        }

        val bb = ByteBuffer.wrap(raw, 0, received).order(ByteOrder.LITTLE_ENDIAN)
        val containerLength = bb.int
        val containerType   = bb.short.toInt() and 0xFFFF
        val responseCode    = bb.short.toInt() and 0xFFFF
        val transactionId   = bb.int

        // If we read more than containerLength, save the surplus for any subsequent operation
        if (received > containerLength && containerLength >= HEADER_SIZE) {
            val surplus = raw.copyOfRange(containerLength, received)
            savePendingBulkIn(surplus)
        }

        CameraDiagnosticLogger.info(
            "PtpUsbTransport",
            "receiveResponseContainer: received %d bytes -> len=%d type=0x%04X code=0x%04X (0x2001=OK) txID=%d (expected=%d)"
                .format(received, containerLength, containerType, responseCode, transactionId, expectedTransactionId),
            pipelineStage = "RESP_CONTAINER"
        )
        UsbEventLogger.log(
            "USB_RESP",
            "Response received: type=0x%04X code=0x%04X txID=%d len=%d".format(
                containerType, responseCode, transactionId, containerLength
            )
        )

        if (containerType != PTP_TYPE_RESPONSE) {
            val err = "receiveResponseContainer: unexpected ContainerType=0x%04X code=0x%04X txID=%d"
                .format(containerType, responseCode, transactionId)
            CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "RESP_CONTAINER")
            throw PtpTransportException(err)
        }

        val numParams = ((containerLength - HEADER_SIZE) / 4).coerceIn(0, MAX_PARAMS)
        val params    = IntArray(numParams) { bb.int }

        return PtpResponse(
            code          = responseCode,
            transactionId = transactionId,
            params        = params,
        )
    }

    fun receiveDataContainer(
        expectedTransactionId: Int,
        timeoutMs: Int = TIMEOUT_DATA_MS,
        expectedOpcode: Int = 0,
    ): ByteArray {
        // Change 2: Add narrowly scoped diagnostics immediately before first bulk-IN read for GetObject (0x1009)
        if (expectedOpcode == SonyPtpOpcodes.PTP_OC_GET_OBJECT) {
            val epInAddr = epBulkIn?.address ?: -1
            val epInMaxPkt = epBulkIn?.maxPacketSize ?: -1
            val pendingBytes = pendingBulkInBytes?.size ?: 0
            val transportOpen = isSessionOpen
            val connOpen = connection != null
            val ifaceClaimed = isInterfaceClaimed
            val diagMsg = "Pre-read GetObject (opcode=0x%04X, txID=%d): transportOpen=%b connOpen=%b epIn=0x%02X maxPacketSize=%d pendingCarryOver=%dB ifaceClaimed=%b"
                .format(expectedOpcode, expectedTransactionId, transportOpen, connOpen, epInAddr, epInMaxPkt, pendingBytes, ifaceClaimed)
            Timber.i("PtpUsbTransport: %s", diagMsg)
            CameraDiagnosticLogger.info("PtpUsbTransport", diagMsg, pipelineStage = "GET_OBJECT_PRE_READ")
            UsbEventLogger.log("GET_OBJECT_PRE_READ", diagMsg)
        }

        val firstBuf   = ByteArray(MAX_RESPONSE_BUFFER)
        var firstRead  = readBulkInWithCarryOver(firstBuf, timeoutMs)

        // If carry-over had partial header, read more to complete header
        while (firstRead in 1 until HEADER_SIZE) {
            val temp = ByteArray(MAX_RESPONSE_BUFFER)
            val more = rawBulkIn(temp, timeoutMs)
            if (more <= 0) break
            val toCopy = minOf(more, firstBuf.size - firstRead)
            System.arraycopy(temp, 0, firstBuf, firstRead, toCopy)
            firstRead += toCopy
            if (more > toCopy) {
                savePendingBulkIn(temp.copyOfRange(toCopy, more))
            }
        }

        if (firstRead < HEADER_SIZE) {
            val err = "receiveDataContainer: received $firstRead bytes; need ≥ $HEADER_SIZE"
            CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "DATA_CONTAINER")
            clearEndpointHalt(isInput = true)
            throw PtpTransportException(err)
        }

        val bb = ByteBuffer.wrap(firstBuf, 0, firstRead).order(ByteOrder.LITTLE_ENDIAN)
        val declaredLength = bb.int.toLong() and 0xFFFFFFFFL
        val containerType  = bb.short.toInt() and 0xFFFF
        val opcode         = bb.short.toInt() and 0xFFFF
        val transactionId  = bb.int

        CameraDiagnosticLogger.info(
            "PtpUsbTransport",
            "receiveDataContainer header: declaredLength=%d type=0x%04X opcode=0x%04X txID=%d firstRead=%d"
                .format(declaredLength, containerType, opcode, transactionId, firstRead),
            pipelineStage = "DATA_CONTAINER"
        )
        UsbEventLogger.log(
            "DATA_PHASE",
            "Data header: declaredLength=$declaredLength type=0x%04X opcode=0x%04X txID=$transactionId firstRead=$firstRead"
                .format(containerType, opcode)
        )

        if (containerType != PTP_TYPE_DATA) {
            val err = if (containerType == PTP_TYPE_RESPONSE) {
                "receiveDataContainer: camera returned Response container (code=0x%04X txID=%d) instead of Data container"
                    .format(opcode, transactionId)
            } else {
                "receiveDataContainer: unexpected ContainerType=0x%04X opcode=0x%04X txID=%d"
                    .format(containerType, opcode, transactionId)
            }
            CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "DATA_CONTAINER")
            throw PtpTransportException(err)
        }

        val safetyCeilingBytes = 100L * 1024L * 1024L
        if (declaredLength > safetyCeilingBytes + HEADER_SIZE || declaredLength < HEADER_SIZE) {
            val err = "Invalid data container length: $declaredLength (safety ceiling: ${safetyCeilingBytes}B)"
            CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "DATA_CONTAINER")
            throw PtpTransportException(err)
        }

        val payloadSize = (declaredLength - HEADER_SIZE).toInt()
        if (payloadSize == 0) {
            if (firstRead > HEADER_SIZE) {
                savePendingBulkIn(firstBuf.copyOfRange(HEADER_SIZE, firstRead))
            }
            return ByteArray(0)
        }

        val payloadBuf  = ByteArray(payloadSize)
        val alreadyHave = (firstRead - HEADER_SIZE).coerceIn(0, payloadSize)
        if (alreadyHave > 0) {
            System.arraycopy(firstBuf, HEADER_SIZE, payloadBuf, 0, alreadyHave)
        }

        if (firstRead > declaredLength.toInt()) {
            val surplus = firstBuf.copyOfRange(declaredLength.toInt(), firstRead)
            savePendingBulkIn(surplus)
        }

        var cumulativeBytesReceived = alreadyHave
        var readCount = if (alreadyHave > 0) 1 else 0

        val chunkBuf = ByteArray(MAX_RESPONSE_BUFFER)

        while (cumulativeBytesReceived < payloadSize) {
            val remaining = payloadSize - cumulativeBytesReceived
            val chunkRead = readBulkInWithCarryOver(chunkBuf, timeoutMs)
            if (chunkRead <= 0) {
                val err = "receiveDataContainer: bulk-IN returned $chunkRead at offset $cumulativeBytesReceived / $payloadSize (remaining: $remaining bytes)"
                CameraDiagnosticLogger.error("PtpUsbTransport", err, pipelineStage = "DATA_CONTAINER")
                UsbEventLogger.log("DATA_PHASE", err)
                clearEndpointHalt(isInput = true)
                throw PtpTransportException(err)
            }

            val toCopy = minOf(chunkRead, remaining)
            System.arraycopy(chunkBuf, 0, payloadBuf, cumulativeBytesReceived, toCopy)
            cumulativeBytesReceived += toCopy
            readCount++

            if (chunkRead > toCopy) {
                val surplus = chunkBuf.copyOfRange(toCopy, chunkRead)
                savePendingBulkIn(surplus)
            }

            if (readCount % 50 == 0 || cumulativeBytesReceived >= payloadSize) {
                val pct = (cumulativeBytesReceived.toDouble() / payloadSize.toDouble()) * 100.0
                CameraDiagnosticLogger.debug(
                    "PtpUsbTransport",
                    "Progress: $cumulativeBytesReceived / $payloadSize bytes (%.1f%%) in %d reads".format(pct, readCount),
                    pipelineStage = "DATA_CONTAINER"
                )
            }
        }

        CameraDiagnosticLogger.info(
            "PtpUsbTransport",
            "Data phase complete: received $cumulativeBytesReceived payload bytes (total container: ${cumulativeBytesReceived + HEADER_SIZE}) in $readCount reads",
            pipelineStage = "DATA_CONTAINER"
        )
        return payloadBuf
    }

    fun readInterruptEvent(timeoutMs: Int = TIMEOUT_INTERRUPT_MS): PtpEvent? {
        val epInt = epInterruptIn ?: return null
        // Buffer must be at least maxPacketSize to prevent USB overflow (-1) on USB 3.0 / SuperSpeed
        val bufferSize = maxOf(epInt.maxPacketSize, 1024)
        val buf = ByteArray(bufferSize)
        val read = connection?.bulkTransfer(epInt, buf, buf.size, timeoutMs) ?: -1
        if (read < HEADER_SIZE) return null

        val bb = ByteBuffer.wrap(buf, 0, read).order(ByteOrder.LITTLE_ENDIAN)
        val containerLength = bb.int
        val containerType   = bb.short.toInt() and 0xFFFF
        val eventCode       = bb.short.toInt() and 0xFFFF
        val transactionId   = bb.int

        if (containerType != PTP_TYPE_EVENT) return null

        val numParams = ((containerLength - HEADER_SIZE) / 4).coerceIn(0, MAX_PARAMS)
        val params    = IntArray(numParams) { bb.int }

        return PtpEvent(
            code          = eventCode,
            transactionId = transactionId,
            param1        = if (params.isNotEmpty()) params[0] else 0,
            params        = params,
        )
    }

    fun pollGetEvent(): PtpEvent? {
        if (!isSessionOpen) return null
        val txId = allocateTransactionId()
        return try {
            sendCommandContainer(PTP_OC_GetEvent, txId)
            val data = receiveDataContainer(txId, timeoutMs = 1000)
            val resp = receiveResponseContainer(txId, timeoutMs = 1000)
            if (resp.isOk && data.size >= 8) {
                val bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
                val code = bb.short.toInt() and 0xFFFF
                val param1 = if (data.size >= 12) bb.int else 0
                PtpEvent(code = code, transactionId = txId, param1 = param1, params = intArrayOf(param1))
            } else null
        } catch (_: Exception) {
            null
        }
    }

    fun checkResponseOk(response: PtpResponse, context: String) {
        if (!response.isOk) {
            throw PtpTransportException(
                "PTP $context failed — response code 0x%04X (params=%s)".format(
                    response.code, response.params.toList()
                )
            )
        }
    }

    fun clearEndpointHalt(isInput: Boolean): Boolean {
        val ep = if (isInput) epBulkIn else epBulkOut
        val conn = connection ?: return false
        if (ep == null) return false
        return try {
            // Standard USB ClearFeature(ENDPOINT_HALT):
            // requestType = USB_DIR_OUT (0x00) | USB_TYPE_STANDARD (0x00) | USB_RECIP_ENDPOINT (0x02) = 0x02
            // request = CLEAR_FEATURE (0x01)
            // value = ENDPOINT_HALT (0x0000)
            // index = endpoint address (e.g. 0x81 or 0x02)
            val status = conn.controlTransfer(0x02, 0x01, 0x0000, ep.address, null, 0, 1000)
            val res = status >= 0
            CameraDiagnosticLogger.info(
                "PtpUsbTransport",
                "clearEndpointHalt: EP 0x%02X (%s) -> result=%b (status=%d)".format(ep.address, if (isInput) "IN" else "OUT", res, status),
                pipelineStage = "CLEAR_HALT"
            )
            UsbEventLogger.log("USB_HALT", "clearEndpointHalt(0x%02X) -> %b (status=%d)".format(ep.address, res, status))
            res
        } catch (e: Exception) {
            CameraDiagnosticLogger.warn(
                "PtpUsbTransport",
                "clearEndpointHalt error on EP 0x%02X: ${e.message}".format(ep.address),
                ex = e,
                pipelineStage = "CLEAR_HALT"
            )
            false
        }
    }

    fun drainPendingBulkIn(timeoutMs: Int = 100): Int {
        pendingBulkInBytes = null
        val ep = epBulkIn ?: return 0
        val conn = connection ?: return 0
        val dummy = ByteArray(MAX_RESPONSE_BUFFER)
        var totalDrained = 0
        try {
            while (true) {
                val read = conn.bulkTransfer(ep, dummy, dummy.size, timeoutMs)
                if (read <= 0) break
                totalDrained += read
            }
        } catch (_: Exception) {}
        if (totalDrained > 0) {
            CameraDiagnosticLogger.info(
                "PtpUsbTransport",
                "drainPendingBulkIn: drained $totalDrained bytes from bulk-IN endpoint",
                pipelineStage = "DRAIN"
            )
            UsbEventLogger.log("USB_DRAIN", "Drained $totalDrained bytes from bulk-IN endpoint")
        }
        return totalDrained
    }

    private fun rawBulkOut(data: ByteArray, length: Int, timeoutMs: Int = TIMEOUT_CMD_MS): Int {
        val ep = epBulkOut ?: throw PtpTransportException("epBulkOut is null")
        val conn = connection ?: throw PtpTransportException("connection is null")
        val dirStr = if (ep.direction == UsbConstants.USB_DIR_OUT) "OUT" else "IN(WRONG)"
        val startTime = System.currentTimeMillis()
        var result = conn.bulkTransfer(ep, data, length, timeoutMs)
        val elapsed = System.currentTimeMillis() - startTime
        if (result != length) {
            CameraDiagnosticLogger.warn(
                "PtpUsbTransport",
                "rawBulkOut: EP 0x%02X (%s) send len=%d failed (result=%d, elapsed=%dms). Clearing OUT halt and retrying..."
                    .format(ep.address, dirStr, length, result, elapsed),
                pipelineStage = "BULK_OUT"
            )
            clearEndpointHalt(isInput = false)
            result = conn.bulkTransfer(ep, data, length, timeoutMs)
        }
        CameraDiagnosticLogger.debug(
            "PtpUsbTransport",
            "rawBulkOut: EP 0x%02X (%s) send len=%d timeout=%dms -> result=%d".format(ep.address, dirStr, length, timeoutMs, result),
            pipelineStage = "BULK_OUT"
        )
        UsbEventLogger.log("USB_BULK_OUT", "EP 0x%02X (%s) send len=%d timeout=%dms result=%d".format(ep.address, dirStr, length, timeoutMs, result))
        return result
    }

    private fun rawBulkIn(buffer: ByteArray, timeoutMs: Int = TIMEOUT_DATA_MS): Int {
        val ep = epBulkIn ?: throw PtpTransportException("epBulkIn is null")
        val conn = connection ?: throw PtpTransportException("connection is null")
        val dirStr = if (ep.direction == UsbConstants.USB_DIR_IN) "IN" else "OUT(WRONG)"
        val startTime = System.currentTimeMillis()
        var result = conn.bulkTransfer(ep, buffer, buffer.size, timeoutMs)
        val elapsed = System.currentTimeMillis() - startTime

        if (result <= 0) {
            val epAddr = ep.address
            val maxPkt = ep.maxPacketSize
            val fd = conn.fileDescriptor
            val claimed = isInterfaceClaimed
            CameraDiagnosticLogger.warn(
                "PtpUsbTransport",
                "rawBulkIn PRIMARY failed: EP 0x%02X (%s, maxPkt=%d, fd=%d, claimed=%b) bufSize=%d timeout=%dms elapsed=%dms -> result=%d"
                    .format(epAddr, dirStr, maxPkt, fd, claimed, buffer.size, timeoutMs, elapsed, result),
                pipelineStage = "BULK_IN"
            )

            // Step 1: Clear halt condition on bulk-IN endpoint
            clearEndpointHalt(isInput = true)

            // Step 2: Test controlled smaller-read-size experiment
            // On USB 2.0 (High Speed, maxPacketSize 512) or vendor kernels with contiguous buffer limits,
            // smaller transfer chunks avoid kmalloc failure and timeout discrepancies.
            val smallerSize = if (maxPkt <= 512) minOf(buffer.size, 4096) else minOf(buffer.size, 8192)
            if (smallerSize < buffer.size) {
                CameraDiagnosticLogger.info(
                    "PtpUsbTransport",
                    "rawBulkIn: testing controlled smaller-read size ($smallerSize bytes) on EP 0x%02X".format(epAddr),
                    pipelineStage = "BULK_IN"
                )
                try { Thread.sleep(15) } catch (_: Exception) {}
                result = conn.bulkTransfer(ep, buffer, smallerSize, timeoutMs)
                if (result > 0) {
                    CameraDiagnosticLogger.info(
                        "PtpUsbTransport",
                        "rawBulkIn: controlled smaller-read size SUCCESSFUL ($result bytes received)",
                        pipelineStage = "BULK_IN"
                    )
                    UsbEventLogger.log("USB_BULK_IN", "EP 0x%02X smaller-read success: $result bytes".format(epAddr))
                    return result
                }
            }

            // Step 3: Evaluate UsbRequest-based read path
            // UsbRequest uses asynchronous kernel URB submission (USBDEVFS_SUBMITURB/USBDEVFS_REAPURB),
            // which bypasses synchronous USBDEVFS_BULK vendor kernel limitations and handles timeouts accurately.
            CameraDiagnosticLogger.info(
                "PtpUsbTransport",
                "rawBulkIn: evaluating UsbRequest-based read path for EP 0x%02X".format(epAddr),
                pipelineStage = "USB_REQUEST"
            )
            clearEndpointHalt(isInput = true)
            val usbReqBytes = readViaUsbRequest(ep, buffer, timeoutMs)
            if (usbReqBytes > 0) {
                CameraDiagnosticLogger.info(
                    "PtpUsbTransport",
                    "rawBulkIn: UsbRequest read SUCCEEDED ($usbReqBytes bytes received)",
                    pipelineStage = "USB_REQUEST"
                )
                UsbEventLogger.log("USB_BULK_IN", "EP 0x%02X UsbRequest success: $usbReqBytes bytes".format(epAddr))
                return usbReqBytes
            }
        }

        UsbEventLogger.log("USB_BULK_IN", "EP 0x%02X (%s) read bufSize=%d timeout=%dms result=%d".format(ep.address, dirStr, buffer.size, timeoutMs, result))
        return result
    }

    private fun readViaUsbRequest(ep: UsbEndpoint, buffer: ByteArray, timeoutMs: Int): Int {
        val conn = connection ?: return -1
        val request = UsbRequest()
        return try {
            if (!request.initialize(conn, ep)) {
                CameraDiagnosticLogger.warn("PtpUsbTransport", "UsbRequest.initialize() returned false", pipelineStage = "USB_REQUEST")
                return -1
            }
            val readSize = minOf(buffer.size, 16384)
            val directBuf = ByteBuffer.allocateDirect(readSize).order(ByteOrder.LITTLE_ENDIAN)
            val queued = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                request.queue(directBuf)
            } else {
                @Suppress("DEPRECATION")
                request.queue(directBuf, readSize)
            }
            if (!queued) {
                CameraDiagnosticLogger.warn("PtpUsbTransport", "UsbRequest.queue() returned false", pipelineStage = "USB_REQUEST")
                return -1
            }
            val response = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                conn.requestWait(timeoutMs.toLong())
            } else {
                conn.requestWait()
            }
            if (response === request) {
                directBuf.flip()
                val bytesRead = directBuf.remaining()
                if (bytesRead > 0) {
                    directBuf.get(buffer, 0, bytesRead)
                    bytesRead
                } else {
                    -1
                }
            } else {
                CameraDiagnosticLogger.warn("PtpUsbTransport", "UsbRequest requestWait did not return expected request", pipelineStage = "USB_REQUEST")
                -1
            }
        } catch (e: Exception) {
            CameraDiagnosticLogger.warn("PtpUsbTransport", "UsbRequest read exception: ${e.message}", ex = e, pipelineStage = "USB_REQUEST")
            -1
        } finally {
            try {
                request.close()
            } catch (_: Exception) {}
        }
    }

    private fun findPtpInterface(device: UsbDevice): UsbInterface? {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            if (iface.interfaceClass == 6) return iface
            if (iface.interfaceClass == 255 && countBulkEndpoints(iface) >= 2) return iface
        }
        return null
    }

    private fun countBulkEndpoints(iface: UsbInterface): Int {
        var count = 0
        for (i in 0 until iface.endpointCount) {
            if (iface.getEndpoint(i).type == UsbConstants.USB_ENDPOINT_XFER_BULK) count++
        }
        return count
    }

    private fun discoverEndpoints(iface: UsbInterface) {
        var out: UsbEndpoint? = null
        var inEp: UsbEndpoint? = null
        var intEp: UsbEndpoint? = null

        for (i in 0 until iface.endpointCount) {
            val ep = iface.getEndpoint(i)
            when (ep.type) {
                UsbConstants.USB_ENDPOINT_XFER_BULK -> {
                    if (ep.direction == UsbConstants.USB_DIR_OUT && out == null) out = ep
                    else if (ep.direction == UsbConstants.USB_DIR_IN && inEp == null) inEp = ep
                }
                UsbConstants.USB_ENDPOINT_XFER_INT -> {
                    if (ep.direction == UsbConstants.USB_DIR_IN && intEp == null) intEp = ep
                }
            }
        }

        if (out == null || inEp == null) {
            throw PtpTransportException("PTP interface missing bulk endpoints (out=$out, in=$inEp)")
        }

        epBulkOut     = out
        epBulkIn      = inEp
        epInterruptIn = intEp
    }

    private fun requireOpen() {
        if (connection == null || usbInterface == null) {
            throw PtpTransportException("PtpUsbTransport is not open — call open() first")
        }
    }

    private fun parseDeviceInfo(payload: ByteArray): DeviceInfoResult {
        if (payload.size < 12) return DeviceInfoResult("", "", "", "", 0, emptyList(), emptyList(), emptyList())
        val bb = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN)
        bb.short // StandardVersion
        val vendorExtId = bb.int
        bb.short // VendorExtensionVersion
        readPtpString(bb) // VendorExtensionDesc

        bb.short // FunctionalMode
        val ops = readUInt16Array(bb)
        val evts = readUInt16Array(bb)
        val props = readUInt16Array(bb)
        readUInt16Array(bb) // CaptureFormats
        readUInt16Array(bb) // ImageFormats

        val mfr   = readPtpString(bb)
        val model = readPtpString(bb)
        val ver   = readPtpString(bb)
        val serial = readPtpString(bb)

        return DeviceInfoResult(
            manufacturer = mfr,
            model        = model,
            deviceVersion = ver,
            serialNumber = serial,
            vendorExtensionId = vendorExtId,
            operationsSupported = ops,
            eventsSupported = evts,
            devicePropertiesSupported = props,
        )
    }

    private fun readPtpString(buf: ByteBuffer): String {
        if (!buf.hasRemaining()) return ""
        val numChars = buf.get().toInt() and 0xFF
        if (numChars == 0 || buf.remaining() < numChars * 2) return ""
        val chars = CharArray(numChars) { buf.short.toInt().toChar() }
        return String(chars).trimEnd('\u0000')
    }

    private fun readUInt16Array(buf: ByteBuffer): List<Int> {
        if (buf.remaining() < 4) return emptyList()
        val count = buf.int
        if (buf.remaining() < count * 2) return emptyList()
        return List(count) { buf.short.toInt() and 0xFFFF }
    }

    data class PtpResponse(val code: Int, val transactionId: Int, val params: IntArray) {
        val isOk: Boolean get() = code == PTP_RC_OK
    }

    data class PtpEvent(val code: Int, val transactionId: Int, val param1: Int, val params: IntArray)

    data class DeviceInfoResult(
        val manufacturer: String,
        val model: String,
        val deviceVersion: String,
        val serialNumber: String,
        val vendorExtensionId: Int,
        val operationsSupported: List<Int>,
        val eventsSupported: List<Int>,
        val devicePropertiesSupported: List<Int>,
    )

    class PtpTransportException(message: String, cause: Throwable? = null) : Exception(message, cause)
}
