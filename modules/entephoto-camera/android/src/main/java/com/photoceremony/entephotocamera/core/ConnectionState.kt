package com.photoceremony.entephotocamera.core

import android.hardware.usb.UsbDevice

/**
 * Sealed class representing every possible state of the USB connection
 * handshake — from initial plug-in through to a confirmed PC Remote session
 * or a hard-blocked error.
 */
sealed class ConnectionState {

    /** No camera plugged in (or a non-Sony device was rejected). */
    object Idle : ConnectionState()

    /** Camera is disconnected or absent without an active reconnect loop. */
    data class Disconnected(val reason: String? = null) : ConnectionState()

    /** Looking for a supported Sony camera. */
    object Searching : ConnectionState()

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
     * An unexpected connection loss occurred and automatic recovery is running.
     */
    data class Reconnecting(
        val device: UsbDevice,
        val attempt: Int,
        val maxAttempts: Int,
        val nextDelayMs: Long,
    ) : ConnectionState()

    // MTP Mode (Legacy 'Connected' state) has been removed to enforce PC Remote mode.

    /**
     * Camera is in PC Remote mode **and** the Sony SDIO handshake completed successfully.
     */
    data class RemoteShooting(
        val device: UsbDevice,
        val model: String,
    ) : ConnectionState()

    /**
     * BLOCKING ERROR — Camera is in MTP / Wrong mode, OR PC Remote SDIO handshake failed.
     */
    data class ErrorPcRemote(val device: UsbDevice) : ConnectionState()

    /**
     * A USB device was attached but its vendor ID does not match Sony (0x054C).
     */
    data class ErrorNotSony(val vendorId: Int, val productId: Int) : ConnectionState()

    /**
     * [android.hardware.usb.UsbManager.openDevice] returned null — the OS
     * couldn't open the USB connection.
     */
    data class ErrorConnectionFailed(val device: UsbDevice, val reason: String) : ConnectionState()
}
