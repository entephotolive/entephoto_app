package com.photoceremony.usbimport.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import com.photoceremony.usbimport.ptp.UsbConnectionManager
import timber.log.Timber

/**
 * Dynamically-registered [BroadcastReceiver] that captures the result of
 * the system USB-permission dialog.
 *
 * Registration / unregistration is handled by [com.photoceremony.usbimport.service.ImportService]:
 *   • Registered  in [ImportService.onCreate]
 *   • Unregistered in [ImportService.onDestroy]
 *
 * Why dynamic and not static (manifest-registered)?
 * Android's documentation for [UsbManager.requestPermission] states that the
 * [android.app.PendingIntent] must be a broadcast that you handle yourself,
 * and best practice is to register the receiver at runtime (tied to the
 * service's lifecycle) rather than statically so it is automatically removed
 * when the service dies.
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
