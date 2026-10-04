package com.photoceremony.usbimport.ptp

import android.hardware.usb.UsbDevice
import android.mtp.MtpDevice
import android.mtp.MtpDeviceInfo

/**
 * Sealed class representing every possible state of the USB connection
 * handshake — from initial plug-in through to a confirmed PC Remote session
 * or a hard-blocked error.
 *
 * State machine:
 *
 *   Idle
 *     │  (USB_DEVICE_ATTACHED, Sony VID matched)
 *     ▼
 *   PermissionRequested
 *     │  (user tapped Allow)            (user tapped Deny)
 *     ▼                                  ▼
 *   Connecting                          PermissionDenied
 *     │
 *     ├─ PC Remote + SDIO OK ───────────► RemoteShooting  (Sony PC Remote mode)
 *     └─ Wrong mode (MTP) / SDIO fail ──► ErrorPcRemote   (Block with guidance)
 *
 *   RemoteShooting
 *     │  (USB_DEVICE_DETACHED)
 *     ▼
 *   Idle
 *
 *   (Non-Sony device attached) ────────► Ignored (stays Idle or shows ErrorNotSony)
 */
sealed class ConnectionState {

    /** No camera plugged in (or a non-Sony device was rejected). */
    object Idle : ConnectionState()

    /**
     * A Sony device was detected; waiting for the user to tap Allow
     * in the system permission dialog.
     */
    data class PermissionRequested(val device: UsbDevice) : ConnectionState()

    /** User explicitly denied USB permission. */
    data class PermissionDenied(val device: UsbDevice) : ConnectionState()

    /** Permission granted; connection handshake is in progress on a background thread. */
    data class Connecting(val device: UsbDevice) : ConnectionState()

    /**
     * [DEPRECATED - MTP mode is no longer supported]
     *
     * MTP session was open in file-transfer mode.
     */
    @Deprecated("MTP mode is unsupported going forward. PC Remote (RemoteShooting) is required.")
    data class Connected(
        val device: UsbDevice,
        val mtpDevice: MtpDevice,
        val deviceInfo: MtpDeviceInfo,
        val storageCount: Int,
    ) : ConnectionState()

    /**
     * Camera is in PC Remote mode **and** the Sony SDIO handshake completed successfully.
     *
     * In this state the app can:
     *  • Receive live photo additions via event loop
     *  • Trigger the physical shutter via `SonyRemoteSession.triggerShutterOnly()`
     *  • Capture and instantly download via `SonyRemoteSession.triggerCaptureAndDownload()`
     *
     * @param device     The [UsbDevice] that is connected.
     * @param model      Camera model string from GetDeviceInfo (e.g. "ILCE-7M4").
     */
    data class RemoteShooting(
        val device: UsbDevice,
        val model: String,
    ) : ConnectionState()

    /**
     * BLOCKING ERROR — Camera is in MTP / Wrong mode, OR PC Remote SDIO handshake failed.
     *
     * UI shows a hard-block: "Set USB Connection to PC Remote".
     * No import can proceed until the user unplugs, sets camera menu to PC Remote, and re-plugs.
     */
    data class ErrorPcRemote(val device: UsbDevice) : ConnectionState()

    /**
     * A USB device was attached but its vendor ID does not match Sony (0x054C).
     * App stays mostly silent — just logs and stays on Page 1.
     */
    data class ErrorNotSony(val vendorId: Int, val productId: Int) : ConnectionState()

    /**
     * [android.hardware.usb.UsbManager.openDevice] returned null — the OS
     * couldn't open the USB connection (device already claimed by another app,
     * or a driver conflict).
     */
    data class ErrorConnectionFailed(val device: UsbDevice, val reason: String) : ConnectionState()
}
