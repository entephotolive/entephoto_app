package com.photoceremony.entephotocamera.sony

import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger

/**
 * Lightweight facade that forwards USB-level events to [CameraDiagnosticLogger].
 */
object UsbEventLogger {

    /**
     * Forwards a USB-level event with thread context to [CameraDiagnosticLogger.debug].
     */
    fun log(tag: String, message: String) {
        val threadName = Thread.currentThread().name
        CameraDiagnosticLogger.debug(
            component = tag,
            message = "[$threadName] $message",
            pipelineStage = tag,
        )
    }
}
