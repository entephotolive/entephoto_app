package com.photoceremony.entephotocamera.discovery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import com.photoceremony.entephotocamera.core.UsbConnectionManager
import timber.log.Timber

/**
 * Dynamically-registered [BroadcastReceiver] that captures the result of
 * the system USB-permission dialog.
 */
class UsbPermissionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UsbConnectionManager.ACTION_USB_PERMISSION) {
            Timber.w("UsbPermissionReceiver: unexpected action %s", intent.action)
            return
        }

        val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        val granted: Boolean   = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)

        Timber.d(
            "USB permission result — device=%s granted=%b",
            device?.deviceName, granted
        )

        if (device == null) {
            Timber.e("UsbPermissionReceiver: received permission result with null UsbDevice")
            return
        }

        UsbConnectionManager.handlePermissionResult(context, device, granted)
    }
}
