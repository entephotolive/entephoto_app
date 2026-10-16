package com.photoceremony.entephotocamera.discovery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import com.photoceremony.entephotocamera.core.UsbConnectionManager
import timber.log.Timber

/**
 * Dynamically-registered [BroadcastReceiver] that listens for
 * [UsbManager.ACTION_USB_DEVICE_DETACHED].
 */
class UsbDetachReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != UsbManager.ACTION_USB_DEVICE_DETACHED) return

        val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        if (device == null) {
            Timber.w("UsbDetachReceiver: detach event had null UsbDevice")
            return
        }

        Timber.i("UsbDetachReceiver: device detached — %s", device.deviceName)
        UsbConnectionManager.handleDeviceDetached(device)
    }
}
