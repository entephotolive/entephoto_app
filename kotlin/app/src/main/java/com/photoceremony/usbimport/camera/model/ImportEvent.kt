package com.photoceremony.usbimport.model

/**
 * Events emitted by [com.photoceremony.usbimport.ptp.ImportLoop] and forwarded
 * through [com.photoceremony.usbimport.legacy_mtp.ImportSession].
 *
 * UI (Page 2) collects these from [ImportSession.events] to build a live log.
 * [com.photoceremony.usbimport.service.ImportService] also collects them to
 * update the foreground notification text.
 */
sealed class ImportEvent {

    /**
     * A poll cycle started.
     * @param cycleNumber 1-based count of poll cycles since the session began.
     */
    data class PollStarted(val cycleNumber: Int) : ImportEvent()

    /**
     * The camera was busy during this poll cycle (MTP call threw an exception
     * or returned null — e.g. during a burst or while the card is being written).
     * This is EXPECTED and NON-FATAL.  The loop will retry on the next cycle.
     * @param reason Short human-readable description of the exception.
     */
    data class PollBusy(val reason: String) : ImportEvent()

    /**
     * A new object handle was discovered and queued for import.
     * @param handle The PTP object handle.
     * @param queueDepth How many handles are now waiting to be imported.
     */
    data class HandleQueued(val handle: Int, val queueDepth: Int) : ImportEvent()

    /**
     * Import of a single handle has started (GetObjectInfo + GetObject in progress).
     * @param handle The PTP object handle being imported.
     */
    data class ImportStarted(val handle: Int) : ImportEvent()

    /**
     * Import of a single handle completed successfully.
     * @param record The completed [ImportRecord].
     */
    data class ImportCompleted(val record: ImportRecord) : ImportEvent()

    /**
     * Import of a single handle failed (camera busy during GetObjectInfo / GetObject
     * or MediaStore write error).  The handle is NOT retried — it will be seen again
     * in the next poll cycle if the camera re-enumerates it, or ignored otherwise.
     * @param handle The PTP object handle that failed.
     * @param reason Short description of the failure.
     */
    data class ImportFailed(val handle: Int, val reason: String) : ImportEvent()

    /**
     * The object was skipped because [android.mtp.MtpObjectInfo.compressedSize]
     * was ≤ 0, meaning the camera hadn't finished writing it to the card yet.
     * NOT an error — the next poll cycle will retry automatically.
     * @param handle The PTP object handle that was skipped.
     */
    data class MidWriteSkipped(val handle: Int) : ImportEvent()

    /** The session was stopped (camera unplugged or service stopped). */
    object SessionStopped : ImportEvent()

}
