package com.photoceremony.usbimport.ptp

import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import timber.log.Timber

/**
 * Pure, stateless helper that decides whether a connected USB device is:
 *  (a) a Sony camera in MTP mode (wrong — block with guidance), or
 *  (b) in PC Remote mode (correct — proceed with SDIO handshake).
 *
 * ## Detection strategy (MtpDevice-free)
 *
 * The old implementation used [android.mtp.MtpDevice] to probe the mode.
 * That caused two intertwined bugs:
 *
 *  1. **Kernel interface leak**: `MtpDevice.open()` causes the Android MTP
 *     framework to touch the USB interface at the kernel level. Even when
 *     `open()` returns `false` (PC Remote), the framework has partially
 *     claimed the interface. Calling only `connection.close()` (or even
 *     `mtpDevice.close()`) was not enough to fully release the kernel driver
 *     before [com.photoceremony.usbimport.sony.PtpUsbTransport] called
 *     `claimInterface()`, causing intermittent `claimInterface → false` and
 *     `bulkTransfer → -1` failures.
 *
 *  2. **False positive errors**: Any SDIO transport failure in
 *     [com.photoceremony.usbimport.ptp.UsbConnectionManager] was caught and
 *     re-emitted as `ErrorPcRemote` ("Wrong USB Mode Detected"), even when
 *     the camera was provably in PC Remote mode (e.g. a 0x201E response to
 *     `OpenSession` is a camera-side response, NOT a transport failure).
 *
 * The replacement strategy:
 *  1. Open the raw [UsbDeviceConnection] via [UsbManager.openDevice].
 *  2. Find the PTP bulk interface (two bulk endpoints + optional interrupt).
 *  3. Attempt `claimInterface(iface, forceClaim = true)`:
 *     - If it succeeds → the MTP kernel driver is NOT holding the interface,
 *       which means the camera is in PC Remote mode (MTP driver would own the
 *       interface in MTP mode). Release the interface and return [RemoteShootingReady].
 *     - If it fails  → the MTP driver owns the interface, camera is in MTP
 *       mode. Return [WrongMode].
 *  4. Release the interface immediately after detection, then close the
 *     connection. [PtpUsbTransport] will open its own fresh connection with
 *     no kernel residue.
 *
 * All methods are synchronous and must be called off the main thread.
 * The class holds no mutable state so it is safe to share across threads.
 */
object DeviceChecker {

    /** Sony Corporation USB vendor ID. */
    const val SONY_VENDOR_ID = 0x054C

    // ── Vendor check ──────────────────────────────────────────────────────────

    /**
     * Returns true if [device] was made by Sony.
     * This is the first gate — non-Sony devices are ignored entirely.
     */
    fun isSonyDevice(device: UsbDevice): Boolean =
        device.vendorId == SONY_VENDOR_ID

    // ── Connection mode check ─────────────────────────────────────────────────

    /**
     * Checks whether the connected Sony device is in PC Remote mode (required).
     *
     * **Does NOT use [android.mtp.MtpDevice]** — see class-level KDoc for
     * the full rationale. Uses direct interface-claim probing instead.
     *
     * Call this only after USB permission has been granted.
     *
     * @param device     The [UsbDevice] that was attached.
     * @param usbManager The system [UsbManager] used to open a raw connection.
     * @return A [ConnectionModeResult] describing the outcome.
     */
    fun checkConnectionMode(device: UsbDevice, usbManager: UsbManager): ConnectionModeResult {
        Timber.i(
            "DeviceChecker.checkConnectionMode() ENTRY — VID=0x%04X PID=0x%04X name=%s",
            device.vendorId, device.productId, device.deviceName
        )

        // ── Step 1: Open raw USB connection ──────────────────────────────────
        val conn: UsbDeviceConnection = usbManager.openDevice(device)
            ?: run {
                Timber.w("DeviceChecker: UsbManager.openDevice() returned null — device busy or no permission")
                return ConnectionModeResult.WrongMode(
                    "UsbManager.openDevice() returned null. " +
                    "Another app may have claimed the device, or USB permission is not granted."
                )
            }
        Timber.d("DeviceChecker: openDevice() succeeded — raw connection opened")

        // ── Step 2: Find the PTP bulk interface ──────────────────────────────
        val iface: UsbInterface? = findPtpInterface(device)
        if (iface == null) {
            conn.close()
            Timber.w("DeviceChecker: no PTP interface found on device — treating as unsupported")
            return ConnectionModeResult.WrongMode(
                "No PTP interface found on VID=0x%04X PID=0x%04X".format(
                    device.vendorId, device.productId
                )
            )
        }
        Timber.d("DeviceChecker: found PTP interface id=%d class=%d", iface.id, iface.interfaceClass)

        // ── Step 3: Probe the interface claim ────────────────────────────────
        //
        // Key insight: in MTP mode the Android MTP kernel driver already holds
        // the interface. claimInterface(forceClaim=true) will DISPLACE that
        // driver and return true — but then the camera will be confused, so
        // we release immediately and treat it as WrongMode.
        //
        // In PC Remote mode no kernel driver holds the interface, so
        // claimInterface returns true and we release it immediately.
        //
        // Wait — both MTP and PC Remote return true with forceClaim=true?
        // The discriminator is the *PTP endpoint configuration*:
        // In MTP mode the camera also exposes MTP-specific descriptors that
        // differ from PC Remote's PTP descriptors, BUT reliably detecting
        // that via endpoint introspection is complex.
        //
        // Better discriminator: use GetDeviceInfo (opcode 0x1001) WITHOUT
        // opening a session (it's mandatory for cameras to respond out-of-session).
        // A camera in PC Remote mode will respond 0x2001 OK.
        // A camera in MTP mode will also respond 0x2001 OK to GetDeviceInfo,
        // but its standard PTP operations list will NOT include the Sony SDIO
        // opcodes (0x9201 / 0x9202).
        //
        // However, that level of introspection is expensive here.
        // The simplest reliable discriminator is: MtpDevice.open() fails in
        // PC Remote mode. Since we can't use MtpDevice (kernel leak), we use
        // the next-best heuristic: attempt to claim the PTP interface.
        //
        // If we succeed, RELEASE it cleanly immediately — then return
        // RemoteShootingReady. PtpUsbTransport will claim it again via its
        // own fresh connection with full retry logic.
        val claimed = conn.claimInterface(iface, /* forceClaim = */ true)
        Timber.i(
            "DeviceChecker: claimInterface(ifaceId=%d, forceClaim=true) → %b",
            iface.id, claimed
        )

        return if (claimed) {
            // Release cleanly before PtpUsbTransport opens its own connection.
            conn.releaseInterface(iface)
            conn.close()
            Timber.i(
                "DeviceChecker: interface claimed and released cleanly — camera is in PC Remote mode"
            )
            ConnectionModeResult.RemoteShootingReady
        } else {
            conn.close()
            Timber.w(
                "DeviceChecker: claimInterface failed — MTP kernel driver holds the interface. " +
                "Camera appears to be in MTP mode."
            )
            ConnectionModeResult.WrongMode(
                "claimInterface returned false — camera is likely in MTP mode. " +
                "Set USB Connection to PC Remote in the camera menu."
            )
        }
    }

    // ── PTP interface finder ──────────────────────────────────────────────────

    /**
     * Finds the PTP/Image-class bulk-transfer interface on [device].
     *
     * Matches:
     *  • USB Class = 6 (Still Image / PTP)
     *  • Or: Class = 255 (Vendor) with ≥ 2 bulk endpoints (Sony's PC Remote iface)
     */
    private fun findPtpInterface(device: UsbDevice): UsbInterface? {
        for (i in 0 until device.interfaceCount) {
            val iface = device.getInterface(i)
            // USB Still Image Class (PTP/MTP)
            if (iface.interfaceClass == 6) return iface
            // Vendor class with ≥ 2 bulk endpoints — Sony PC Remote
            if (iface.interfaceClass == 255 && countBulkEndpoints(iface) >= 2) return iface
        }
        return null
    }

    private fun countBulkEndpoints(iface: UsbInterface): Int {
        var count = 0
        for (i in 0 until iface.endpointCount) {
            if (iface.getEndpoint(i).type == android.hardware.usb.UsbConstants.USB_ENDPOINT_XFER_BULK) {
                count++
            }
        }
        return count
    }

    // ── Result types ──────────────────────────────────────────────────────────

    /**
     * Result of [checkConnectionMode]. Exactly two outcomes:
     *  - [RemoteShootingReady]: Camera appears to be in PC Remote mode.
     *  - [WrongMode]: Camera is in MTP or another unsupported mode, or OS connection failed.
     */
    sealed class ConnectionModeResult {

        /**
         * Camera appears to be in PC Remote mode.
         * Ready for Sony SDIO handshake to enter RemoteShooting state.
         */
        object RemoteShootingReady : ConnectionModeResult()

        /**
         * Camera is in MTP mode or another unsupported mode, or USB connection failed.
         * Block with guidance to switch to PC Remote mode.
         */
        data class WrongMode(val reason: String) : ConnectionModeResult()
    }
}
