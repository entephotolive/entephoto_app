package com.photoceremony.usbimport.legacy_mtp

import android.mtp.MtpDevice
import com.photoceremony.usbimport.db.DownloadedFile
import com.photoceremony.usbimport.db.DownloadedFileDao
import com.photoceremony.usbimport.model.ImportEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.ClosedSendChannelException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * [LEGACY MTP CODE - PRESERVED FOR REFERENCE]
 *
 * The read-only polling loop that drives near-real-time photo import.
 */
class ImportLoop(
    private val mtpDevice: MtpDevice,
    private val storageIds: IntArray,
    private val importer: PtpImporter,
    private val dao: DownloadedFileDao,
    private val scope: CoroutineScope,
) {

    private val _events = MutableSharedFlow<ImportEvent>(
        replay              = 0,
        extraBufferCapacity = 128,
    )
    val events: SharedFlow<ImportEvent> = _events.asSharedFlow()

    private val knownHandles = mutableSetOf<Int>()
    private val pendingHandles = mutableSetOf<Int>()

    private val importChannel = Channel<Int>(Channel.UNLIMITED)
    private var cycleCount = 0
    private var pollJob: Job? = null
    private var workerJob: Job? = null

    companion object {
        const val POLL_INTERVAL_BASE_MS = 700L
        const val POLL_INTERVAL_BACKOFF_MS = 1_500L
        const val POLL_INTERVAL_MIN_MS = 500L
    }

    fun start() {
        Timber.i("ImportLoop.start() — storageIds=%s", storageIds.toList())
        pollJob   = scope.launch(Dispatchers.IO) { runPollLoop() }
        workerJob = scope.launch(Dispatchers.IO) { runImportWorker() }
    }

    fun stop() {
        Timber.i("ImportLoop.stop()")
        pollJob?.cancel()
        workerJob?.cancel()
        importChannel.close()
        scope.launch { _events.emit(ImportEvent.SessionStopped) }
    }

    private suspend fun runPollLoop() {
        Timber.d("Poll loop started on %s", Thread.currentThread().name)

        try {
            val restored = dao.getAllHandles()
            knownHandles.addAll(restored)
            Timber.i("Restored %d known handle(s) from Room", restored.size)
        } catch (e: Exception) {
            Timber.w(e, "Could not restore known handles from Room — starting fresh")
        }

        var intervalMs = POLL_INTERVAL_BASE_MS

        while (scope.isActive) {
            val wasBusy: Boolean = pollCycle()

            intervalMs = if (wasBusy) POLL_INTERVAL_BACKOFF_MS
                         else         POLL_INTERVAL_BASE_MS
            val clampedMs = intervalMs.coerceAtLeast(POLL_INTERVAL_MIN_MS)

            Timber.v(
                "pollCycle #%d done — wasBusy=%b next interval=%d ms",
                cycleCount, wasBusy, clampedMs
            )
            delay(clampedMs)
        }
        Timber.d("Poll loop exited")
    }

    private suspend fun pollCycle(): Boolean {
        cycleCount++
        _events.emit(ImportEvent.PollStarted(cycleCount))

        return try {
            val allHandles = mutableListOf<Int>()
            for (storageId in storageIds) {
                val handles = mtpDevice.getObjectHandles(
                    storageId,
                    /* format= */ 0,
                    /* parent= */ -1
                ) ?: throw IllegalStateException(
                    "getObjectHandles returned null for storageId=0x${storageId.toString(16)}"
                )
                allHandles.addAll(handles.toList())
            }

            val newHandles = allHandles.filterNot { it in knownHandles || it in pendingHandles }

            if (newHandles.isNotEmpty()) {
                Timber.d("pollCycle #%d: %d new handle(s)", cycleCount, newHandles.size)
            } else {
                Timber.v("pollCycle #%d: no new handles", cycleCount)
            }

            for (handle in newHandles) {
                try {
                    pendingHandles.add(handle)
                    importChannel.send(handle)
                    _events.emit(ImportEvent.HandleQueued(handle, pendingHandles.size))
                } catch (_: ClosedSendChannelException) {
                    pendingHandles.remove(handle)
                    return false
                }
            }

            false

        } catch (e: Exception) {
            val reason = e.message ?: e::class.simpleName ?: "unknown"
            Timber.d(
                "pollCycle #%d: camera busy — %s (backing off to %d ms for next cycle)",
                cycleCount, reason, POLL_INTERVAL_BACKOFF_MS
            )
            _events.emit(ImportEvent.PollBusy(reason))
            true
        }
    }

    private suspend fun runImportWorker() {
        Timber.d("Import worker started on %s", Thread.currentThread().name)
        for (handle in importChannel) {
            queueImport(handle)
        }
        Timber.d("Import worker exited")
    }

    private suspend fun queueImport(handle: Int) {
        _events.emit(ImportEvent.ImportStarted(handle))

        val result: PtpImporter.ImportResult = try {
            importer.importHandle(mtpDevice, handle)
        } catch (e: Exception) {
            Timber.e(e, "queueImport(%d): unexpected exception from importer", handle)
            PtpImporter.ImportResult.CameraBusy(handle, e.message ?: "unexpected error")
        }

        when (result) {
            is PtpImporter.ImportResult.Success -> {
                knownHandles.add(handle)
                try {
                    dao.insert(
                        DownloadedFile(
                            handle     = handle,
                            filename   = result.record.filename,
                            mimeType   = result.record.mimeType,
                            importedAt = result.record.importedAtMs,
                            sizeBytes  = result.record.sizeBytes,
                        )
                    )
                } catch (e: Exception) {
                    Timber.w(e, "queueImport(%d): Room insert failed (non-fatal)", handle)
                }
                Timber.i("queueImport(%d): ✓ %s (%s)",
                    handle, result.record.filename, result.record.formattedSize)
                _events.emit(ImportEvent.ImportCompleted(result.record))
            }

            is PtpImporter.ImportResult.MidWrite -> {
                Timber.d(
                    "queueImport(%d): mid-write (compressedSize ≤ 0) — will retry next poll cycle", handle
                )
                _events.emit(ImportEvent.MidWriteSkipped(handle))
            }

            is PtpImporter.ImportResult.CameraBusy -> {
                Timber.w("queueImport(%d): camera busy — %s", handle, result.reason)
                _events.emit(ImportEvent.ImportFailed(handle, result.reason))
            }
        }

        pendingHandles.remove(handle)
    }
}
