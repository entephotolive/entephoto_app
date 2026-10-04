package com.photoceremony.usbimport.sony

import timber.log.Timber
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Thread-safe logger that records every single USB-level event in memory with
 * millisecond timestamp and thread name.
 *
 * This provides total visibility into:
 *  - USB_DEVICE_ATTACHED / permission events
 *  - openDevice() calls and outcomes
 *  - claimInterface() attempts and results
 *  - Settle delays
 *  - Every bulkTransfer (IN/OUT, endpoint, buffer size, timeout, bytes returned)
 *  - Interface release and connection close
 *
 * The accumulated log is appended to all diagnostic result dialogs so a single
 * "Copy Log" action provides the full sequence without guessing.
 */
object UsbEventLogger {

    private const val MAX_ENTRIES = 1000

    private val dateFormat = SimpleDateFormat("HH:mm:ss.SSS", Locale.US)
    private val entries = ConcurrentLinkedQueue<String>()

    /**
     * Logs a USB-level event with timestamp and thread name.
     */
    @Synchronized
    fun log(tag: String, message: String) {
        val timeStr = dateFormat.format(Date())
        val threadName = Thread.currentThread().name
        val formatted = "[$timeStr] [$threadName] [$tag] $message"

        entries.add(formatted)
        while (entries.size > MAX_ENTRIES) {
            entries.poll()
        }

        Timber.tag("UsbEventLogger").i("[%s] %s", tag, message)
    }

    /**
     * Clears recorded events (e.g. before starting a fresh diagnostic run).
     */
    fun clear() {
        entries.clear()
    }

    /**
     * Dumps all recorded events as a newline-delimited string.
     */
    fun dump(): String {
        return entries.joinToString("\n")
    }
}
