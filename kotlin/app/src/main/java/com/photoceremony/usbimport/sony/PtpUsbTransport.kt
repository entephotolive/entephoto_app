package com.photoceremony.usbimport.sony

import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import timber.log.Timber
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
 * Raw USB PTP (Picture Transfer Protocol, PIMA 15740-2000) transport layer for
 * Sony cameras operating in **PC Remote mode**.
 *
 * This class speaks directly to the USB bulk and interrupt endpoints — it does
 * **not** use [android.mtp.MtpDevice] at all.  That abstraction is bypassed
 * because it only exposes file-transfer MTP operations and has no hooks for
 * Sony's proprietary vendor extension opcodes (SDIO_Connect, ControlDevice, …).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PTP-over-USB container wire format  (ISO 15740 §5.2 / Annex D)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Every PTP transaction consists of one or more USB **bulk transfers**, each
 * carrying exactly one PTP container.  All multi-byte integers are
 * **little-endian**.
 *
 * ```
 * Offset  Size  Field
 *  0      4     ContainerLength — total size of this packet, including header
 *  4      2     ContainerType   — 0x0001 Command, 0x0002 Data,
 *                                 0x0003 Response, 0x0004 Event
 *  6      2     Code            — PTP opcode (Command/Response) or event code
 *  8      4     TransactionID   — monotonically increasing per session (starts at 1)
 * 12      4     Param1          — (Command/Response only, optional)
 * 16      4     Param2          — (optional)
 * 20      4     Param3          — (optional)
 * 24      4     Param4          — (optional)
 * 28      4     Param5          — (optional)
 * ```
 *
 * A full PTP operation transaction follows this sequence:
 *
 *   1. Host  →  Camera:  **Command** container  (bulk-OUT)
 *   2. Host  ←  Camera:  **Data** container     (bulk-IN)   ← if opcode has IN data phase
 *      Host  →  Camera:  **Data** container     (bulk-OUT)  ← if opcode has OUT data phase
 *   3. Host  ←  Camera:  **Response** container (bulk-IN)
 *
 * Events arrive unsolicited on the **interrupt-IN** endpoint.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USB endpoint map (typical Sony Alpha in PC Remote mode)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * | EP# | Dir | Type      | PTP role                      |
 * |-----|-----|-----------|-------------------------------|
 * | EP1 | OUT | Bulk      | Command + Data (host→camera)  |
 * | EP2 | IN  | Bulk      | Response + Data (camera→host) |
 * | EP3 | IN  | Interrupt | Events (async, camera→host)   |
 *
 * Endpoint indices are discovered dynamically from [UsbInterface], not assumed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Usage
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ```kotlin
 * val transport = PtpUsbTransport(device, usbManager)
 * transport.open()          // claim interface, locate endpoints
 *
 * // Self-test with standard PTP opcode before touching Sony-specific ones:
 * val info = transport.executeGetDeviceInfo()
 * Timber.i("Camera: ${info.manufacturer} ${info.model}")
 *
 * // ...later...
 * transport.close()         // release interface
 * ```
 *
 * **Thread-safety**: This class is **not** thread-safe.  All calls from the
 * same session must originate from a single thread (or be protected by a
 * mutex externally).  The [AtomicInteger] for transaction IDs is safe to
 * read from any thread but the underlying USB bulk transfers must remain
 * sequential.
 *
 * @param device     The [UsbDevice] that is in PC Remote mode.
 * @param usbManager The system [UsbManager] used to open the raw USB connection.
 */
class PtpUsbTransport(
    private val device: UsbDevice,
    private val usbManager: UsbManager,
) : Closeable {

    // ── Connection state ──────────────────────────────────────────────────────

    private var connection: UsbDeviceConnection? = null
    private var usbInterface: UsbInterface? = null

    // Endpoints — discovered in open()
    private var epBulkOut: UsbEndpoint? = null       // bulk-OUT: command + data send
    private var epBulkIn: UsbEndpoint? = null        // bulk-IN:  response + data receive
    private var epInterruptIn: UsbEndpoint? = null   // interrupt-IN: async events

    // ── Transaction ID ────────────────────────────────────────────────────────

    /**
     * PTP transaction IDs must be monotonically increasing and unique for the
     * lifetime of an open session (ISO 15740 §10.6).  Using [AtomicInteger]
     * lets external code safely read the current value for logging purposes,
     * even though actual transfers must be sequential on a single thread.
     *
     * Per spec, the value 0x00000000 is reserved; we start at 1.
     */
    private val nextTransactionId = AtomicInteger(1)

    // ── Constants ─────────────────────────────────────────────────────────────

    companion object {

        /** Process-wide Mutex ensuring strictly sequential PtpUsbTransport open -> use -> close lifecycles. */
        private val usbSessionMutex = Mutex()

        /**
         * Executes [block] exclusively across the entire application.
         * Guarantees that any open -> claim -> bulkTransfer -> close sequence
         * must fully complete before any other session attempt can start.
         */
        suspend fun <T> withExclusiveSession(block: suspend () -> T): T =
            usbSessionMutex.withLock { block() }

        val transportMutex: Mutex get() = usbSessionMutex

        /** Dedicated single-threaded dispatcher so all USB transfers execute strictly on one background thread. */
        private val singleThreadExecutor = Executors.newSingleThreadExecutor { r ->
            Thread(r, "PtpUsbTransportThread").apply { isDaemon = true }
        }
        val usbDispatcher: CoroutineDispatcher = singleThreadExecutor.asCoroutineDispatcher()

        // ── PTP container type codes  (ISO 15740 Table 5) ────────────────────
        const val PTP_TYPE_COMMAND  = 0x0001
        const val PTP_TYPE_DATA     = 0x0002
        const val PTP_TYPE_RESPONSE = 0x0003
        const val PTP_TYPE_EVENT    = 0x0004

        // ── PTP response codes  (ISO 15740 Table 10) ─────────────────────────
        const val PTP_RC_OK           = 0x2001
        const val PTP_RC_GeneralError = 0x2002
        const val PTP_RC_DeviceBusy   = 0x2019

        // ── Standard PTP opcodes  (ISO 15740 Table 7) ────────────────────────
        /** GetDeviceInfo — no params required; works outside an open session. */
        const val PTP_OC_GetDeviceInfo = 0x1001
        const val PTP_OC_OpenSession   = 0x1002
        const val PTP_OC_CloseSession  = 0x1003
        const val PTP_OC_GetEvent      = 0x9803

        // ── Timeouts ─────────────────────────────────────────────────────────
        const val TIMEOUT_CMD_MS       = 5_000   // standard PTP commands (GetDeviceInfo, etc.)
        const val TIMEOUT_DATA_MS      = 30_000  // data phase (large file downloads)
        const val TIMEOUT_INTERRUPT_MS = 100     // interrupt-IN poll
        /**
         * Timeout for Sony SDIO vendor commands (SDIO_Connect, ControlDevice, etc.).
         *
         * Sony's proprietary handshake may stall internally on the camera side
         * for longer than standard PTP would. 5 s is a safe floor; increase if
         * the camera is known to take longer on first boot / session open.
         */
        const val TIMEOUT_SDIO_MS = 5_000

        // ── Buffer sizes ──────────────────────────────────────────────────────
        const val HEADER_SIZE = 12
        const val MAX_PARAMS = 5
        // Linux usbfs buffer limit is 16KB (MAX_USBFS_BUFFER_SIZE). 64KB buffers cause bulkTransfer to return -1 immediately.
        const val MAX_RESPONSE_BUFFER = 16_384
        const val MAX_EVENT_BUFFER = 64
    }

    // ── Session state ─────────────────────────────────────────────────────────

    /** True if a standard PTP session has been opened with [executeOpenSession]. */
    var isSessionOpen: Boolean = false
        private set

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /**
     * Opens a raw USB connection to [device], claims the PTP interface, and
     * locates the bulk-OUT, bulk-IN, and interrupt-IN endpoints.
     *
     * Performs a clean reset if an existing connection object is present.
     *
     * @throws PtpTransportException if the connection cannot be opened, the
     *         PTP interface cannot be claimed, or required endpoints are absent.
     */
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

        // ── Step 1: Open the raw USB device connection fresh ──────────────────
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

        // ── Step 2: Find the PTP interface ───────────────────────────────────
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

        // ── Step 3: Claim the interface — retry loop for timing race ──────────
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
                "returned FALSE on all $maxClaimAttempts attempts — kernel driver still holds " +
                "the interface. Check logcat for DeviceChecker and MTP driver activity."
            )
        }
        Timber.d("PtpUsbTransport: interface %d claimed successfully on attempt %d", iface.id, claimAttempt)

        // ── STEP 2 SETTLE DELAY ───────────────────────────────────────────────
        // Known real-world fix for Android USB host controllers where the interface
        // claim succeeds at the API level slightly before hardware endpoints are ready.
        val settleDelayMs = 400L
        UsbEventLogger.log("USB_SETTLE", "claimInterface OK. Settle delay ${settleDelayMs}ms before bulkTransfer...")
        try { Thread.sleep(settleDelayMs) } catch (_: InterruptedException) {}
        UsbEventLogger.log("USB_SETTLE", "Settle delay finished.")

        // ── Step 4: Discover endpoints ────────────────────────────────────────
        try {
            discoverEndpoints(iface)
        } catch (e: Exception) {
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
            epInterruptIn?.let { "EP${it.endpointNumber}" } ?: "(none — fallback to polled GetEvent)",
        )
        Timber.i("PtpUsbTransport: %s", epSummary)
        UsbEventLogger.log("USB_ENDPOINTS", epSummary)
    }

    /**
     * Releases the USB interface and closes the underlying [UsbDeviceConnection].
     * If a PTP session was opened ([isSessionOpen] = true), sends CloseSession (0x1003) first.
     *
     * Safe to call even if [open] was never called, threw, or if [close] is
     * called a second time (all cases are handled gracefully).
     */
    override fun close() {
        UsbEventLogger.log("USB_CLOSE", "PtpUsbTransport.close() ENTRY — releasing session & interface")
        if (isSessionOpen) {
            try {
                executeCloseSession(timeoutMs = 500)
            } catch (e: Exception) {
                Timber.w(e, "PtpUsbTransport.close(): exception sending CloseSession (ignored)")
            }
        } else {
            UsbEventLogger.log("USB_CLOSE", "PtpUsbTransport.close(): isSessionOpen=false, skipping CloseSession")
        }
        try {
            usbInterface?.let { iface ->
                connection?.releaseInterface(iface)
                Timber.d("PtpUsbTransport: released interface %d", iface.id)
                UsbEventLogger.log("USB_CLOSE", "Released interface ${iface.id}")
            }
        } catch (e: Exception) {
            Timber.w(e, "PtpUsbTransport.close(): exception releasing interface (ignored)")
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
        epBulkOut     = null
        epBulkIn      = null
        epInterruptIn = null
        isSessionOpen = false
        UsbEventLogger.log("USB_CLOSE", "PtpUsbTransport.close() COMPLETE")
    }

    // ── Standard PTP Session Control ──────────────────────────────────────────

    /**
     * Issues standard PTP **OpenSession** command (opcode 0x1002) with a non-zero session ID.
     *
     * **Defensive pre-clear**: Before sending OpenSession, this sends a fast, non-blocking
     * CloseSession first (ignoring any error or response), so that if the camera
     * has a stale session from a prior crashed/unclean run it is cleared out
     * before we attempt to open a new one. A camera returning 0x201E
     * (SessionAlreadyOpen) is the primary symptom of a missing prior CloseSession.
     *
     * @param sessionId Session ID (must be > 0, default 1).
     * @throws PtpTransportException on transport or protocol error.
     */
    fun executeOpenSession(sessionId: Int = 1) {
        requireOpen()
        require(sessionId > 0) { "Session ID must be non-zero (ISO 15740 §9.3.1)" }

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

        // STEP 1: Immediately upon receiving response, update session-tracking flag
        if (response.code == PTP_RC_OK || response.code == 0x201E) {
            isSessionOpen = true
            UsbEventLogger.log("USB_SESSION", "OpenSession response=0x%04X -> isSessionOpen=true (sessionId=%d)".format(response.code, sessionId))
            Timber.i("PtpUsbTransport: OpenSession response=0x%04X -> isSessionOpen=true (sessionId=%d)", response.code, sessionId)
        }

        if (response.code != 0x201E) {
            checkResponseOk(response, "OpenSession")
        }
    }

    /**
     * Issues standard PTP **CloseSession** command (opcode 0x1003).
     *
     * Uses a timeout ([timeoutMs], default 1000 ms) so that cameras that do not
     * acknowledge CloseSession (or when no session was open) do not stall interface cleanup.
     *
     * Safe to call even if [open] was never called or the connection is already closed.
     */
    fun executeCloseSession(timeoutMs: Int = 1000) {
        if (connection == null) {
            isSessionOpen = false
            return
        }
        try {
            Timber.i("PtpUsbTransport: issuing CloseSession (0x1003) — timeout=%dms", timeoutMs)
            UsbEventLogger.log("USB_CLOSE", "Issuing CloseSession (0x1003) — timeout=${timeoutMs}ms")
            val txId = allocateTransactionId()
            sendCommandContainer(
                opcode        = PTP_OC_CloseSession,
                transactionId = txId,
                params        = intArrayOf(),
                timeoutMs     = timeoutMs,
            )
            val response = receiveResponseContainer(
                expectedTransactionId = txId,
                timeoutMs             = timeoutMs,
            )
            Timber.i("PtpUsbTransport: CloseSession response code=0x%04X", response.code)
            UsbEventLogger.log("USB_CLOSE", "CloseSession response code=0x%04X".format(response.code))
        } catch (e: Exception) {
            Timber.d("PtpUsbTransport: CloseSession error/timeout (ignored — connection closing anyway): %s", e.message)
            UsbEventLogger.log("USB_CLOSE", "CloseSession exception/timeout (ignored): ${e.message}")
        } finally {
            isSessionOpen = false
            UsbEventLogger.log("USB_CLOSE", "isSessionOpen reset to false")
        }
    }

    // ── Self-test ─────────────────────────────────────────────────────────────

    /**
     * Issues the standard PTP **GetDeviceInfo** command (opcode 0x1001) and
     * returns a parsed [DeviceInfoResult].
     *
     * **Why this is the first thing to call:**
     * GetDeviceInfo is the only PTP operation cameras must respond to outside
     * an open session (ISO 15740 §10.1).  Sony cameras in PC Remote mode
     * honour it correctly.  By calling it first — before any vendor-specific
     * opcode — we confirm that:
     *
     *   1. Endpoint discovery was correct.
     *   2. PTP container framing (length, type, opcode, txID, byte order) is right.
     *   3. The camera is alive and responding on this connection.
     *
     * If this succeeds, subsequent Sony SDIO opcodes can be issued with
     * confidence that any failure there is protocol-level, not transport-level.
     *
     * The parser extracts only the fields needed for validation / logging.
     * The full DeviceInfo dataset (supported operations, events, properties)
     * is obtained later via SDIO_GetExtDeviceInfo (0x9202) during the
     * Sony SDIO handshake.
     *
     * @return [DeviceInfoResult] containing manufacturer, model, firmware, etc.
     * @throws PtpTransportException on any transport or protocol error.
     */
    fun executeGetDeviceInfo(): DeviceInfoResult {
        requireOpen()
        Timber.d("PtpUsbTransport: issuing GetDeviceInfo (0x%04X) self-test", PTP_OC_GetDeviceInfo)

        val txId = allocateTransactionId()

        // GetDeviceInfo: Command only, no params, followed by Data then Response.
        sendCommandContainer(
            opcode        = PTP_OC_GetDeviceInfo,
            transactionId = txId,
            params        = intArrayOf(),       // no parameters
        )

        // Receive the Data phase — the PTP DeviceInfo dataset.
        val dataPayload = receiveDataContainer(
            expectedTransactionId = txId,
            timeoutMs             = TIMEOUT_DATA_MS,
        )

        Timber.d(
            "PtpUsbTransport: GetDeviceInfo data payload received — %d bytes, hex head=[%s]",
            dataPayload.size,
            dataPayload.take(32).joinToString(" ") { "%02X".format(it) }
        )

        // Receive the Response phase — must be 0x2001 (OK).
        val response = receiveResponseContainer(
            expectedTransactionId = txId,
            timeoutMs             = TIMEOUT_CMD_MS,
        )
        checkResponseOk(response, "GetDeviceInfo")

        val result = parseDeviceInfo(dataPayload)
        Timber.i(
            "PtpUsbTransport: GetDeviceInfo parsed — mfr='%s', model='%s', ver='%s', serial='%s', vendorExt=0x%08X",
            result.manufacturer, result.model, result.deviceVersion, result.serialNumber, result.vendorExtensionId
        )
        return result
    }

    // ── Core transport primitives (public — used by SdioHandshake etc.) ───────

    /**
     * Allocates the next monotonically-increasing transaction ID.
     *
     * Callers should store the returned value and reuse it across the
     * Command → Data → Response containers of a single PTP operation.
     */
    fun allocateTransactionId(): Int = nextTransactionId.getAndIncrement()

    /**
     * Sends a **Command** container (ContainerType = 0x0001) over the
     * bulk-OUT endpoint.
     *
     * Wire layout:
     * ```
     * [length:4LE] [type:2LE=0x0001] [opcode:2LE] [txID:4LE]
     * [param0:4LE] … [paramN:4LE]
     * ```
     *
     * @param opcode        PTP operation code (e.g., 0x1001 for GetDeviceInfo,
     *                      0x9201 for SDIO_Connect).
     * @param transactionId ID from [allocateTransactionId].
     * @param params        Up to 5 UINT32 parameters; pass an empty array when
     *                      the opcode has no parameters.
     * @throws PtpTransportException if the bulk-OUT transfer fails or is short.
     */
    fun sendCommandContainer(
        opcode: Int,
        transactionId: Int,
        params: IntArray = intArrayOf(),
        timeoutMs: Int = TIMEOUT_CMD_MS,
    ) {
        require(params.size <= MAX_PARAMS) {
            "PTP Command: at most $MAX_PARAMS params allowed; got ${params.size}"
        }

        val length = HEADER_SIZE + params.size * 4
        val buf    = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN)

        buf.putInt  (length)                            // ContainerLength
        buf.putShort(PTP_TYPE_COMMAND.toShort())        // ContainerType = 0x0001
        buf.putShort(opcode.toShort())                  // Code (opcode)
        buf.putInt  (transactionId)                     // TransactionID
        for (p in params) buf.putInt(p)                 // Param1 … ParamN

        Timber.d(
            "PtpUsbTransport → CMD  0x%04X  txID=%d  params=%s",
            opcode, transactionId, params.toList(),
        )

        val sent = rawBulkOut(buf.array(), length, timeoutMs)
        if (sent != length) {
            val msg = ("sendCommandContainer: sent $sent of $length bytes " +
                "(opcode=0x%04X txID=%d)").format(opcode, transactionId)
            throw PtpTransportException(msg)
        }
    }

    /**
     * Sends a **Data** container (ContainerType = 0x0002) over the bulk-OUT
     * endpoint.
     *
     * Used for operations that have an **OUT** data phase, i.e., where the
     * host sends data to the camera (e.g., SDIO_ControlDevice when writing a
     * property value such as AutoFocus = 1).
     *
     * Wire layout:
     * ```
     * [length:4LE] [type:2LE=0x0002] [opcode:2LE] [txID:4LE] [payload…]
     * ```
     *
     * @param opcode        Same PTP opcode as the preceding Command container.
     * @param transactionId Same transaction ID used in the Command container.
     * @param payload       The raw data bytes to send.
     * @throws PtpTransportException if the transfer fails or is short.
     */
    fun sendDataContainer(
        opcode: Int,
        transactionId: Int,
        payload: ByteArray,
    ) {
        val length = HEADER_SIZE + payload.size
        val buf    = ByteBuffer.allocate(length).order(ByteOrder.LITTLE_ENDIAN)

        buf.putInt  (length)
        buf.putShort(PTP_TYPE_DATA.toShort())           // ContainerType = 0x0002
        buf.putShort(opcode.toShort())
        buf.putInt  (transactionId)
        buf.put     (payload)

        Timber.d(
            "PtpUsbTransport → DATA 0x%04X  txID=%d  payloadBytes=%d",
            opcode, transactionId, payload.size,
        )

        val sent = rawBulkOut(buf.array(), length)
        if (sent != length) {
            throw PtpTransportException(
                "sendDataContainer: sent $sent of $length bytes"
            )
        }
    }

    /**
     * Reads a **Response** container (ContainerType = 0x0003) from the
     * bulk-IN endpoint and returns a [PtpResponse].
     *
     * Always call this after every Command (and after the data phase if any).
     * Use [checkResponseOk] to assert [PtpResponse.code] == [PTP_RC_OK].
     *
     * @param expectedTransactionId Logged if the camera sends a mismatched ID.
     * @param timeoutMs             Bulk-IN timeout (default [TIMEOUT_CMD_MS]).
     * @throws PtpTransportException if the read fails or the container is malformed.
     */
    fun receiveResponseContainer(
        expectedTransactionId: Int,
        timeoutMs: Int = TIMEOUT_CMD_MS,
    ): PtpResponse {
        val raw      = ByteArray(MAX_RESPONSE_BUFFER)
        val received = rawBulkIn(raw, timeoutMs)

        if (received < HEADER_SIZE) {
            throw PtpTransportException(
                "receiveResponseContainer: received $received bytes; " +
                "need ≥ $HEADER_SIZE bytes for a valid container"
            )
        }

        val bb = ByteBuffer.wrap(raw, 0, received).order(ByteOrder.LITTLE_ENDIAN)

        val containerLength = bb.int
        val containerType   = bb.short.toInt() and 0xFFFF
        val responseCode    = bb.short.toInt() and 0xFFFF
        val transactionId   = bb.int

        Timber.i(
            "receiveResponseContainer: received %d bytes -> containerLength=%d, type=0x%04X, code=0x%04X, txID=%d",
            received, containerLength, containerType, responseCode, transactionId
        )
        UsbEventLogger.log("USB_RESP", "Response container received: type=0x%04X code=0x%04X (0x2001=OK) txID=%d len=%d".format(
            containerType, responseCode, transactionId, containerLength
        ))

        if (containerType != PTP_TYPE_RESPONSE) {
            val msg = ("receiveResponseContainer: unexpected ContainerType=0x%04X " +
                "(expected 0x%04X); code=0x%04X txID=%d")
                    .format(containerType, PTP_TYPE_RESPONSE, responseCode, transactionId)
            throw PtpTransportException(msg)
        }

        if (transactionId != expectedTransactionId) {
            // Log but do not throw — some camera firmwares use wrong IDs on
            // the first exchange after SDIO_Connect.
            Timber.w(
                "receiveResponseContainer: txID mismatch (expected=%d got=%d)",
                expectedTransactionId, transactionId,
            )
        }

        // Parse optional response parameters.
        val numParams = ((containerLength - HEADER_SIZE) / 4).coerceIn(0, MAX_PARAMS)
        val params    = IntArray(numParams) { bb.int }

        Timber.i(
            "PtpUsbTransport ← RESP 0x%04X  txID=%d  params=%s",
            responseCode, transactionId, params.toList(),
        )

        return PtpResponse(
            code          = responseCode,
            transactionId = transactionId,
            params        = params,
        )
    }

    /**
     * Reads a **Data** container (ContainerType = 0x0002) from the bulk-IN
     * endpoint and returns the payload bytes (everything after the 12-byte
     * container header).
     *
     * Tracks the declared container length from the 12-byte header, accumulates
     * payload bytes across multiple bulk-IN transfers, and terminates strictly
     * when cumulative bytes reach (declaredLength - 12).
     *
     * @param expectedTransactionId Logged if the camera sends a mismatched ID.
     * @param timeoutMs             Per-read timeout (default [TIMEOUT_DATA_MS]).
     * @return Payload bytes, possibly empty if the container has no payload.
     * @throws PtpTransportException on framing errors, read failures, or safety ceiling exceeded.
     */
    fun receiveDataContainer(
        expectedTransactionId: Int,
        timeoutMs: Int = TIMEOUT_DATA_MS,
    ): ByteArray {
        // First read — captures the header and as much payload as fits in one transfer.
        val firstBuf   = ByteArray(MAX_RESPONSE_BUFFER)
        val firstRead  = rawBulkIn(firstBuf, timeoutMs)

        if (firstRead < HEADER_SIZE) {
            throw PtpTransportException(
                "receiveDataContainer: received $firstRead bytes; " +
                "need ≥ $HEADER_SIZE bytes for container header"
            )
        }

        val bb = ByteBuffer.wrap(firstBuf, 0, firstRead).order(ByteOrder.LITTLE_ENDIAN)

        // STEP 1 — Parse and log the Data container's declared length
        // bytes 0-3: total container length (UInt32, little-endian) — this includes the 12-byte header itself
        // bytes 4-5: container type (should be 0x0002 = Data)
        // bytes 6-7: opcode
        // bytes 8-11: transaction ID
        val declaredLength = bb.int.toLong() and 0xFFFFFFFFL
        val containerType  = bb.short.toInt() and 0xFFFF
        val opcode         = bb.short.toInt() and 0xFFFF    // echoes command opcode
        val transactionId  = bb.int

        // STEP 1: Log explicitly
        Timber.i("GetObject data phase: declared total length=%d bytes", declaredLength)
        UsbEventLogger.log("GET_OBJECT", "GetObject data phase: declared total length=$declaredLength bytes")

        if (containerType != PTP_TYPE_DATA) {
            val msg = ("receiveDataContainer: unexpected ContainerType=0x%04X " +
                "(expected 0x%04X = Data); opcode=0x%04X txID=%d")
                    .format(containerType, PTP_TYPE_DATA, opcode, transactionId)
            Timber.e(msg)
            UsbEventLogger.log("GET_OBJECT", msg)
            throw PtpTransportException(msg)
        }

        if (transactionId != expectedTransactionId) {
            Timber.w(
                "receiveDataContainer: txID mismatch (expected=%d got=%d)",
                expectedTransactionId, transactionId,
            )
        }

        // STEP 5 — Add a safety ceiling regardless (100MB sanity cap)
        val safetyCeilingBytes = 100L * 1024L * 1024L
        if (declaredLength > safetyCeilingBytes + HEADER_SIZE) {
            val err = "Aborting data phase: declared container length ($declaredLength bytes) exceeds 100MB safety ceiling"
            Timber.e(err)
            UsbEventLogger.log("GET_OBJECT", err)
            throw PtpTransportException(err)
        }

        if (declaredLength < HEADER_SIZE) {
            val err = "Invalid container length: $declaredLength < $HEADER_SIZE"
            Timber.e(err)
            UsbEventLogger.log("GET_OBJECT", err)
            throw PtpTransportException(err)
        }

        // The actual payload size to download is (declaredLength - 12)
        val payloadSize = (declaredLength - HEADER_SIZE).toInt()

        Timber.d(
            "PtpUsbTransport ← DATA 0x%04X  txID=%d  payloadBytes=%d",
            opcode, transactionId, payloadSize,
        )

        if (payloadSize == 0) return ByteArray(0)

        // ── STEP 2 — Track cumulative bytes and stop when complete ────────────────
        // The first bulk read may have already captured part or all of the payload
        // (bytes starting at index 12 in firstBuf).
        val payloadBuf  = ByteArray(payloadSize)
        val alreadyHave = (firstRead - HEADER_SIZE).coerceIn(0, payloadSize)
        if (alreadyHave > 0) {
            System.arraycopy(firstBuf, HEADER_SIZE, payloadBuf, 0, alreadyHave)
        }

        // Maintain a running total of payload bytes received so far
        var cumulativeBytesReceived = alreadyHave
        var readCount = if (alreadyHave > 0) 1 else 0

        // Loop condition: continue reading ONLY while cumulativeBytesReceived < (declaredLength - 12)
        while (cumulativeBytesReceived < payloadSize) {
            val remaining = payloadSize - cumulativeBytesReceived
            val toRead = remaining.coerceAtMost(MAX_RESPONSE_BUFFER)
            val chunkBuf  = ByteArray(toRead)
            val chunkRead = rawBulkIn(chunkBuf, timeoutMs)
            if (chunkRead <= 0) {
                val err = "receiveDataContainer: bulk-IN returned $chunkRead at offset=$cumulativeBytesReceived / $payloadSize"
                Timber.e(err)
                UsbEventLogger.log("GET_OBJECT", err)
                throw PtpTransportException(err)
            }

            System.arraycopy(chunkBuf, 0, payloadBuf, cumulativeBytesReceived, chunkRead)

            // After each bulkTransfer read, add the bytes received to the running total
            cumulativeBytesReceived += chunkRead
            readCount++

            // STEP 5: Hard sanity cap during accumulation
            if (cumulativeBytesReceived > safetyCeilingBytes) {
                val err = "Aborting data phase: cumulative bytes received ($cumulativeBytesReceived) exceeded 100MB safety ceiling"
                Timber.e(err)
                UsbEventLogger.log("GET_OBJECT", err)
                throw PtpTransportException(err)
            }

            if (readCount % 50 == 0 || cumulativeBytesReceived == payloadSize) {
                val percent = (cumulativeBytesReceived.toDouble() / payloadSize) * 100.0
                Timber.d("GetObject download progress: %d / %d bytes (%.1f%%) in %d reads",
                    cumulativeBytesReceived, payloadSize, percent, readCount)
            }
        }

        // Once the total is reached, STOP issuing further bulkTransfer reads on this data phase
        Timber.i("GetObject data phase complete: received %d payload bytes in %d reads", cumulativeBytesReceived, readCount)
        UsbEventLogger.log("GET_OBJECT", "Data phase complete: received $cumulativeBytesReceived payload bytes in $readCount reads")

        return payloadBuf
    }

    /**
     * Attempts to poll a pending PTP event via standard GetEvent (0x1003) command.
     *
     * Used as a fallback when the USB interrupt endpoint is unpopulated, unsupported
     * by the host controller, or silent.
     *
     * @return [PtpEvent] if an event was returned by the camera, `null` if no event is queued.
     */
    fun pollGetEvent(): PtpEvent? {
        val txId = allocateTransactionId()
        return try {
            sendCommandContainer(PTP_OC_GetEvent, txId, intArrayOf())
            val data = receiveDataContainer(txId, timeoutMs = 1000)
            val resp = receiveResponseContainer(txId, timeoutMs = 1000)

            if (!resp.isOk || data.size < 4) return null

            val bb = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
            val eventCode = bb.short.toInt() and 0xFFFF
            val transactionId = if (data.size >= 8) bb.int else 0
            val numParams = ((data.size - 8) / 4).coerceIn(0, 3)
            val params = IntArray(numParams) { if (bb.hasRemaining()) bb.int else 0 }

            PtpEvent(code = eventCode, transactionId = transactionId, params = params)
        } catch (e: Exception) {
            Timber.d("pollGetEvent returned null/exception: %s", e.message)
            null
        }
    }

    /**
     * Performs a **non-blocking read** of the interrupt-IN endpoint and returns
     * a [PtpEvent] if a PTP Event container was received, or `null` on timeout.
     *
     * PTP Event container wire format (identical in structure to a Response):
     * ```
     * [length:4LE] [type:2LE=0x0004] [eventCode:2LE] [txID:4LE]
     * [param1:4LE] [param2:4LE] [param3:4LE]
     * ```
     *
     * The timeout is [TIMEOUT_INTERRUPT_MS] (100 ms).  A return of `null`
     * means "no event arrived within the timeout — poll again later".
     *
     * **When interrupt-IN is absent**: some cameras (or marginal USB hubs) do
     * not properly expose the interrupt endpoint.  In that case this method
     * throws a [PtpTransportException].  Callers that need event detection
     * without an interrupt endpoint should fall back to polling GetEvent
     * (standard PTP opcode 0x1003).
     *
     * @return [PtpEvent] if an event was received; `null` on timeout.
     * @throws PtpTransportException if no interrupt-IN endpoint exists.
     */
    fun readInterruptEvent(timeoutMs: Int = 1500): PtpEvent? {
        val ep = epInterruptIn
        if (ep == null) {
            Timber.w("readInterruptEvent: epInterruptIn is null — no interrupt endpoint available")
            UsbEventLogger.log("INTERRUPT_EVENT", "readInterruptEvent: epInterruptIn is NULL")
            return null
        }
        val conn = connection
        if (conn == null) {
            Timber.w("readInterruptEvent: connection is null")
            UsbEventLogger.log("INTERRUPT_EVENT", "readInterruptEvent: connection is NULL")
            return null
        }

        // Buffer must be at least maxPacketSize to prevent USB overflow (-1) on USB 3.0 / SuperSpeed
        val bufferSize = maxOf(ep.maxPacketSize, 1024)
        val buf        = ByteArray(bufferSize)
        val received   = conn.bulkTransfer(ep, buf, buf.size, timeoutMs)

        // Negative or zero means timeout — not an error.
        if (received <= 0) return null

        if (received < HEADER_SIZE) {
            Timber.w(
                "readInterruptEvent: only %d bytes; skipping malformed event container",
                received,
            )
            UsbEventLogger.log("INTERRUPT_EVENT", "Received $received bytes (< HEADER_SIZE 12), malformed")
            return null
        }

        val bb              = ByteBuffer.wrap(buf, 0, received).order(ByteOrder.LITTLE_ENDIAN)
        val containerLength = bb.int
        val containerType   = bb.short.toInt() and 0xFFFF
        val eventCode       = bb.short.toInt() and 0xFFFF
        val transactionId   = bb.int

        if (containerType != PTP_TYPE_EVENT) {
            Timber.w(
                "readInterruptEvent: ContainerType=0x%04X ≠ 0x%04X (Event); ignoring",
                containerType, PTP_TYPE_EVENT,
            )
            UsbEventLogger.log("INTERRUPT_EVENT", "ContainerType=0x%04X not EVENT, ignoring".format(containerType))
            return null
        }

        val numParams = ((containerLength - HEADER_SIZE) / 4).coerceIn(0, 3)
        val params    = IntArray(numParams) { if (bb.hasRemaining()) bb.int else 0 }

        val event = PtpEvent(
            code          = eventCode,
            transactionId = transactionId,
            params        = params,
        )

        Timber.i(
            "PtpUsbTransport ← EVT  0x%04X  txID=%d  params=%s",
            event.code, event.transactionId, event.params.toList(),
        )
        UsbEventLogger.log("INTERRUPT_EVENT", "EVT 0x%04X param1=0x%08X (len=%d, received=%d, params=%s)".format(
            event.code, if (params.isNotEmpty()) params[0] else 0, containerLength, received, params.toList()
        ))

        return event
    }

    // ── Response-code guard ───────────────────────────────────────────────────

    /**
     * Asserts that [response] carries [PTP_RC_OK] (0x2001).
     *
     * Throws [PtpTransportException] with the operation name and the raw
     * response code on any non-OK result, giving callers (SdioHandshake,
     * ShutterController, etc.) a single canonical failure path.
     *
     * @param response  The [PtpResponse] returned by [receiveResponseContainer].
     * @param operation Human-readable operation name for the error message.
     */
    fun checkResponseOk(response: PtpResponse, operation: String) {
        if (!response.isOk) {
            val detail = when (response.code) {
                PTP_RC_DeviceBusy   -> "Device Busy (0x2019) — retry"
                PTP_RC_GeneralError -> "General Error (0x2002)"
                else                -> "code=0x%04X".format(response.code)
            }
            throw PtpTransportException("$operation failed: $detail")
        }
    }

    // ── Internal: endpoint discovery ──────────────────────────────────────────

    /**
     * Searches all interfaces on [device] for one whose USB class is
     * [UsbConstants.USB_CLASS_STILL_IMAGE] (0x06 — the standard USB class
     * for PTP cameras).  Falls back to interface index 0 if none matches
     * (some cameras in PC Remote mode report class 0xFF = vendor-specific).
     */
    private fun findPtpInterface(device: UsbDevice): UsbInterface? {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            Timber.d(
                "PtpUsbTransport: iface[%d] class=0x%02X sub=0x%02X proto=0x%02X",
                i, iface.interfaceClass,
                iface.interfaceSubclass,
                iface.interfaceProtocol,
            )
            if (iface.interfaceClass == UsbConstants.USB_CLASS_STILL_IMAGE) {
                Timber.d("PtpUsbTransport: PTP interface found at index %d", i)
                return iface
            }
        }
        Timber.w(
            "PtpUsbTransport: no USB_CLASS_STILL_IMAGE interface found; " +
            "falling back to interface 0"
        )
        return if (device.interfaceCount > 0) device.getInterface(0) else null
    }

    /**
     * Iterates all endpoints of [iface] and assigns:
     * - First bulk-OUT endpoint → [epBulkOut]
     * - First bulk-IN endpoint  → [epBulkIn]
     * - First interrupt-IN endpoint → [epInterruptIn] (optional)
     *
     * Throws if either bulk endpoint is missing — both are required for PTP.
     * A missing interrupt-IN is a warning, not a fatal error; callers fall
     * back to polled [executeGetDeviceInfo] events.
     */
    private fun discoverEndpoints(iface: UsbInterface) {
        for (i in 0 until iface.endpointCount) {
            val ep = iface.getEndpoint(i)
            Timber.d(
                "PtpUsbTransport: ep[%d] num=EP%d dir=%s type=%s maxPkt=%d",
                i, ep.endpointNumber,
                if (ep.direction == UsbConstants.USB_DIR_IN) "IN" else "OUT",
                when (ep.type) {
                    UsbConstants.USB_ENDPOINT_XFER_BULK    -> "BULK"
                    UsbConstants.USB_ENDPOINT_XFER_INT     -> "INT"
                    UsbConstants.USB_ENDPOINT_XFER_ISOC    -> "ISO"
                    UsbConstants.USB_ENDPOINT_XFER_CONTROL -> "CTRL"
                    else -> "?(${ep.type})"
                },
                ep.maxPacketSize,
            )
            when {
                ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                ep.direction == UsbConstants.USB_DIR_OUT -> epBulkOut = ep

                ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK &&
                ep.direction == UsbConstants.USB_DIR_IN  -> epBulkIn = ep

                ep.type == UsbConstants.USB_ENDPOINT_XFER_INT &&
                ep.direction == UsbConstants.USB_DIR_IN  -> epInterruptIn = ep
            }
        }

        epBulkOut ?: throw PtpTransportException(
            "No bulk-OUT endpoint found on interface ${iface.id}"
        )
        epBulkIn ?: throw PtpTransportException(
            "No bulk-IN endpoint found on interface ${iface.id}"
        )
        // ── STEP 5: Confirm bulk-IN endpoint direction ────────────────────────
        // Log the final resolved endpoint addresses so it is trivial to
        // cross-check against the values logged by rawBulkIn at runtime.
        epBulkOut?.let { Timber.i(
            "PtpUsbTransport: RESOLVED epBulkOut  addr=0x%02X dir=%s maxPkt=%d",
            it.address,
            if (it.direction == UsbConstants.USB_DIR_OUT) "OUT ✔" else "IN ❌ — WRONG!",
            it.maxPacketSize
        )}
        epBulkIn?.let { Timber.i(
            "PtpUsbTransport: RESOLVED epBulkIn   addr=0x%02X dir=%s maxPkt=%d",
            it.address,
            if (it.direction == UsbConstants.USB_DIR_IN) "IN ✔" else "OUT ❌ — WRONG!",
            it.maxPacketSize
        )}
        if (epInterruptIn == null) {
            Timber.w(
                "PtpUsbTransport: no interrupt-IN endpoint — " +
                "falling back to polled GetEvent for capture detection"
            )
        }
    }

    // ── Internal: raw bulk transfers ──────────────────────────────────────────

    /** Sends [length] bytes from [data] over the bulk-OUT endpoint. */
    private fun rawBulkOut(data: ByteArray, length: Int, timeoutMs: Int = TIMEOUT_CMD_MS): Int {
        val conn = requireOpen()
        val ep   = epBulkOut ?: throw PtpTransportException("bulk-OUT not available")
        val dirStr = if (ep.direction == UsbConstants.USB_DIR_OUT) "OUT" else "IN(WRONG)"
        UsbEventLogger.log("USB_BULK_OUT", "EP 0x%02X (%s) send len=%d timeout=%dms".format(ep.address, dirStr, length, timeoutMs))
        val result = conn.bulkTransfer(ep, data, length, timeoutMs)
        UsbEventLogger.log("USB_BULK_OUT", "EP 0x%02X (%s) send result=%d".format(ep.address, dirStr, result))
        return result
    }

    /**
     * Reads up to [buf].size bytes from the bulk-IN endpoint into [buf].
     *
     * Logs **all three** transfer parameters on every call so that a failing
     * receive can be diagnosed without a second run:
     *  1. Endpoint address (hex) + direction flag — confirms bulk-IN is used
     *  2. Buffer size passed to bulkTransfer() — must be ≥ wMaxPacketSize
     *  3. Timeout value — must be high enough for vendor commands
     *
     * Returns the number of bytes actually received, or -1 on failure/timeout.
     */
    private fun rawBulkIn(buf: ByteArray, timeoutMs: Int): Int {
        val conn = requireOpen()
        val ep   = epBulkIn ?: throw PtpTransportException("bulk-IN not available")
        val dirStr = if (ep.direction == UsbConstants.USB_DIR_IN) "IN" else "OUT(WRONG)"
        Timber.i(
            "PtpUsbTransport.rawBulkIn: ep.address=0x%02X ep.direction=%s bufferSize=%d timeoutMs=%d",
            ep.address,
            if (ep.direction == UsbConstants.USB_DIR_IN) "IN(0x80)" else "OUT(0x00)",
            buf.size,
            timeoutMs
        )
        UsbEventLogger.log("USB_BULK_IN", "EP 0x%02X (%s) read bufSize=%d timeout=%dms".format(ep.address, dirStr, buf.size, timeoutMs))
        val result = conn.bulkTransfer(ep, buf, buf.size, timeoutMs)
        Timber.i(
            "PtpUsbTransport.rawBulkIn: bulkTransfer returned %d (ep.address=0x%02X)",
            result, ep.address
        )
        UsbEventLogger.log("USB_BULK_IN", "EP 0x%02X (%s) read result=%d".format(ep.address, dirStr, result))
        return result
    }

    /** Returns the active [UsbDeviceConnection] or throws if not open. */
    private fun requireOpen(): UsbDeviceConnection =
        connection
            ?: throw PtpTransportException(
                "PtpUsbTransport is not open — call open() before any transfer"
            )

    // ── Internal: PTP dataset parsers ─────────────────────────────────────────

    /**
     * Parses the PTP GetDeviceInfo response dataset (ISO 15740 §13.3.1).
     *
     * Layout (all values little-endian):
     * ```
     *  u16   StandardVersion
     *  u32   VendorExtensionID
     *  u16   VendorExtensionVersion
     *  str   VendorExtensionDesc    (PTP string)
     *  u16   FunctionalMode
     *  arr32 OperationsSupported    (PTP u16 array)
     *  arr32 EventsSupported        (PTP u16 array)
     *  arr32 DevicePropertiesSupported
     *  arr32 CaptureFormats
     *  arr32 ImageFormats
     *  str   Manufacturer
     *  str   Model
     *  str   DeviceVersion
     *  str   SerialNumber
     * ```
     *
     * PTP string format (§4.3.1):
     *   u8 NumChars + NumChars × UTF-16LE code units (includes trailing NUL).
     *
     * PTP array of UINT16 (§4.3.2):
     *   u32 NumElements + NumElements × u16 values.
     */
    private fun parseDeviceInfo(data: ByteArray): DeviceInfoResult {
        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)

        val standardVersion        = buf.short.toInt() and 0xFFFF
        val vendorExtensionId      = buf.int
        val vendorExtensionVersion = buf.short.toInt() and 0xFFFF

        skipPtpString(buf)   // VendorExtensionDesc
        buf.short            // FunctionalMode

        // Parse: OperationsSupported, EventsSupported, DevicePropertiesSupported,
        //        CaptureFormats, ImageFormats
        val operationsSupported        = readPtpU16Array(buf)
        val eventsSupported            = readPtpU16Array(buf)
        val devicePropertiesSupported  = readPtpU16Array(buf)
        val captureFormats             = readPtpU16Array(buf)
        val imageFormats               = readPtpU16Array(buf)

        val manufacturer  = readPtpString(buf)
        val model         = readPtpString(buf)
        val deviceVersion = readPtpString(buf)
        val serialNumber  = readPtpString(buf)

        val has0x9207 = operationsSupported.contains(0x9207)
        val has0xD2C1InOps = operationsSupported.contains(0xD2C1)
        val has0xD2C1InProps = devicePropertiesSupported.contains(0xD2C1)
        val has0xD2C2InOps = operationsSupported.contains(0xD2C2)
        val has0xD2C2InProps = devicePropertiesSupported.contains(0xD2C2)
        val has0xC201 = eventsSupported.contains(0xC201)

        val opsHex = operationsSupported.map { "0x%04X".format(it) }
        val evtsHex = eventsSupported.map { "0x%04X".format(it) }
        val propsHex = devicePropertiesSupported.map { "0x%04X".format(it) }

        Timber.i("PtpUsbTransport: GetDeviceInfo OperationsSupported (%d): %s", operationsSupported.size, opsHex)
        Timber.i("PtpUsbTransport: GetDeviceInfo EventsSupported (%d): %s", eventsSupported.size, evtsHex)
        Timber.i("PtpUsbTransport: GetDeviceInfo DevicePropertiesSupported (%d): %s", devicePropertiesSupported.size, propsHex)
        Timber.i(
            "PtpUsbTransport: GetDeviceInfo Search -> 0x9207(ControlDevice)=%b, 0xD2C1(AF)=ops:%b/props:%b, 0xD2C2(Cap)=ops:%b/props:%b, 0xC201(ObjAdded)=%b",
            has0x9207, has0xD2C1InOps, has0xD2C1InProps, has0xD2C2InOps, has0xD2C2InProps, has0xC201
        )

        UsbEventLogger.log("GET_DEVICE_INFO", "Ops count=${operationsSupported.size}: $opsHex")
        UsbEventLogger.log("GET_DEVICE_INFO", "Events count=${eventsSupported.size}: $evtsHex")
        UsbEventLogger.log("GET_DEVICE_INFO", "Props count=${devicePropertiesSupported.size}: $propsHex")
        UsbEventLogger.log(
            "GET_DEVICE_INFO",
            "Search: 0x9207(ControlDevice)=$has0x9207, 0xD2C1(AF ops=$has0xD2C1InOps,props=$has0xD2C1InProps), 0xD2C2(Cap ops=$has0xD2C2InOps,props=$has0xD2C2InProps), 0xC201(ObjAdded)=$has0xC201"
        )

        return DeviceInfoResult(
            standardVersion        = standardVersion,
            vendorExtensionId      = vendorExtensionId,
            vendorExtensionVersion = vendorExtensionVersion,
            manufacturer           = manufacturer,
            model                  = model,
            deviceVersion          = deviceVersion,
            serialNumber           = serialNumber,
            operationsSupported    = operationsSupported,
            eventsSupported        = eventsSupported,
            devicePropertiesSupported = devicePropertiesSupported,
            captureFormats         = captureFormats,
            imageFormats           = imageFormats,
        )
    }

    // ── PTP string / array helpers ────────────────────────────────────────────

    /** Reads and returns a PTP string from [buf]. Returns "" for zero-length strings. */
    private fun readPtpString(buf: ByteBuffer): String {
        val numChars = buf.get().toInt() and 0xFF
        if (numChars == 0) return ""
        val chars = CharArray(numChars) { buf.short.toInt().toChar() }
        // PTP strings are NUL-terminated; strip the trailing NUL from the result.
        return String(chars).trimEnd('\u0000')
    }

    /** Advances [buf] past a PTP string without storing the content. */
    private fun skipPtpString(buf: ByteBuffer) {
        val numChars = buf.get().toInt() and 0xFF
        if (numChars > 0) repeat(numChars) { buf.short }
    }

    /**
     * Reads a PTP array of UINT16 values from [buf].
     *
     * Format:  u32 count  +  count × u16 elements.
     */
    private fun readPtpU16Array(buf: ByteBuffer): List<Int> {
        if (buf.remaining() < 4) return emptyList()
        val count = buf.int
        if (count <= 0) return emptyList()
        val list = ArrayList<Int>(count)
        var i = 0
        while (i < count && buf.remaining() >= 2) {
            list.add(buf.short.toInt() and 0xFFFF)
            i++
        }
        return list
    }

    /**
     * Advances [buf] past a PTP array of UINT16 values.
     *
     * Format:  u32 count  +  count × u16 elements.
     */
    private fun skipPtpU16Array(buf: ByteBuffer) {
        val count = buf.int
        if (count > 0) repeat(count) { buf.short }
    }

    // ── Public result types ───────────────────────────────────────────────────

    /**
     * Result of [executeGetDeviceInfo].
     *
     * Contains only the fields needed for session validation and logging.
     * The full supported-operations/properties arrays are obtained separately
     * during the Sony SDIO handshake via SDIO_GetExtDeviceInfo (0x9202).
     */
    data class DeviceInfoResult(
        /** ISO 15740 standard version × 100 (e.g., 100 = v1.00). */
        val standardVersion: Int,
        /**
         * Vendor extension identifier.
         * Sony cameras typically report 0x00000006 (PTP_VENDOR_SONY)
         * or 0x00000000/0x00000001 in some firmware versions.
         */
        val vendorExtensionId: Int,
        /** Vendor-specific protocol version (same scale as standardVersion). */
        val vendorExtensionVersion: Int,
        /** Camera manufacturer string (e.g., "Sony Corporation"). */
        val manufacturer: String,
        /** Camera model string (e.g., "ILCE-7M4", "ZV-1"). */
        val model: String,
        /** Firmware version string. */
        val deviceVersion: String,
        /** Camera serial number. */
        val serialNumber: String,
        /** PTP operations supported by this camera (opcodes like 0x1001, 0x9207, etc.). */
        val operationsSupported: List<Int> = emptyList(),
        /** PTP events supported by this camera (event codes like 0xC201, etc.). */
        val eventsSupported: List<Int> = emptyList(),
        /** PTP device properties supported by this camera. */
        val devicePropertiesSupported: List<Int> = emptyList(),
        /** PTP capture formats supported by this camera. */
        val captureFormats: List<Int> = emptyList(),
        /** PTP image formats supported by this camera. */
        val imageFormats: List<Int> = emptyList(),
    )

    /**
     * Parsed PTP Response container.
     *
     * @param code          PTP response code:
     *                        0x2001 = OK, 0x2002 = GeneralError,
     *                        0x2019 = DeviceBusy, etc.
     * @param transactionId Transaction this response belongs to.
     * @param params        Up to 5 response parameters (opcode-dependent;
     *                      most operations return none).
     */
    data class PtpResponse(
        val code: Int,
        val transactionId: Int,
        val params: IntArray,
    ) {
        /** True iff [code] == [PTP_RC_OK] (0x2001). */
        val isOk: Boolean get() = code == PTP_RC_OK

        /** True iff [code] == [PTP_RC_DeviceBusy] (0x2019). */
        val isBusy: Boolean get() = code == PTP_RC_DeviceBusy

        // IntArray equality requires override for data class correctness.
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is PtpResponse) return false
            return code == other.code &&
                transactionId == other.transactionId &&
                params.contentEquals(other.params)
        }
        override fun hashCode(): Int =
            31 * (31 * code + transactionId) + params.contentHashCode()
    }

    /**
     * Parsed PTP Event container received from the interrupt-IN endpoint.
     *
     * @param code          PTP event code.  For Sony cameras, key values are:
     *                        0xC201 = ObjectAdded (capture complete, file ready)
     *                        0xC203 = PropertyChanged (settings changed)
     * @param transactionId Transaction ID (0 for unsolicited / push events).
     * @param params        Up to 3 event parameters.  For ObjectAdded (0xC201),
     *                      Param1 ([param1]) is the PTP object handle to download.
     */
    data class PtpEvent(
        val code: Int,
        val transactionId: Int,
        val params: IntArray,
    ) {
        /** Convenience: first event parameter (object handle for ObjectAdded). */
        val param1: Int get() = if (params.isNotEmpty()) params[0] else 0

        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is PtpEvent) return false
            return code == other.code &&
                transactionId == other.transactionId &&
                params.contentEquals(other.params)
        }
        override fun hashCode(): Int =
            31 * (31 * code + transactionId) + params.contentHashCode()
    }

    /**
     * Thrown for any transport-level error: endpoint discovery failures,
     * USB bulk transfer failures, container framing violations, or unexpected
     * PTP response codes.
     *
     * Higher-level callers (SdioHandshake, ShutterController, SonyRemoteSession)
     * should catch this and translate it into a suitable UI event.
     */
    class PtpTransportException(message: String, cause: Throwable? = null) :
        Exception(message, cause)
}
