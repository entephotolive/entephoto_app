package com.photoceremony.entephotocamera.model

/**
 * Events emitted during camera operation.
 */
sealed class ImportEvent {

    data class PollStarted(val cycleNumber: Int) : ImportEvent()
    data class PollBusy(val reason: String) : ImportEvent()
    data class HandleQueued(val handle: Int, val queueDepth: Int) : ImportEvent()
    data class ImportStarted(val handle: Int) : ImportEvent()
    data class ImportCompleted(val record: ImportRecord) : ImportEvent()
    data class ImportFailed(val handle: Int, val reason: String) : ImportEvent()
    data class ImportSkippedUnsupportedFormat(
        val handle: Int,
        val filename: String,
        val extension: String,
    ) : ImportEvent()
    data class MidWriteSkipped(val handle: Int) : ImportEvent()
    object SessionStopped : ImportEvent()

}
