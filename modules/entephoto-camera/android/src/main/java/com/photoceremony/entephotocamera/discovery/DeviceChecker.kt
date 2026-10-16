package com.photoceremony.entephotocamera.discovery

import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import timber.log.Timber

/**
 * Pure, stateless helper that decides whether a connected USB device is:
 *  (a) a Sony camera in MTP mode (wrong — block with guidance), or
 *  (b) in PC Remote mode (correct — proceed with SDIO handshake).
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
     */
    fun checkConnectionMode(device: UsbDevice, usbManager: UsbManager): ConnectionModeResult {
        Timber.i(
            "DeviceChecker.checkConnectionMode() ENTRY — VID=0x%04X PID=0x%04X name=%s",
            device.vendorId, device.productId, device.deviceName
        )

        val conn: UsbDeviceConnection = usbManager.openDevice(device)
            ?: run {
                Timber.w("DeviceChecker: UsbManager.openDevice() returned null — device busy or no permission")
                return ConnectionModeResult.WrongMode(
                    "UsbManager.openDevice() returned null. " +
                    "Another app may have claimed the device, or USB permission is not granted."
                )
            }
        Timber.d("DeviceChecker: openDevice() succeeded — raw connection opened")

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

        val claimed = conn.claimInterface(iface, /* forceClaim = */ true)
        Timber.i(
            "DeviceChecker: claimInterface(ifaceId=%d, forceClaim=true) → %b",
            iface.id, claimed
        )

        return if (claimed) {
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
            if (iface.getEndpoint(i).type == android.hardware.usb.UsbConstants.USB_ENDPOINT_XFER_BULK) {
                count++
            }
        }
        return count
    }

    // ── Result types ──────────────────────────────────────────────────────────

    sealed class ConnectionModeResult {
        object RemoteShootingReady : ConnectionModeResult()
        data class WrongMode(val reason: String) : ConnectionModeResult()
    }
}
