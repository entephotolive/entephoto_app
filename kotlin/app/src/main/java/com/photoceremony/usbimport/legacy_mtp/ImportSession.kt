package com.photoceremony.usbimport.legacy_mtp

import android.content.Context
import android.mtp.MtpDevice
import com.photoceremony.usbimport.db.DownloadedFile
import com.photoceremony.usbimport.db.DownloadedFileDao
import com.photoceremony.usbimport.model.ImportEvent
import com.photoceremony.usbimport.model.ImportRecord
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * [LEGACY MTP CODE - PRESERVED FOR REFERENCE]
 *
 * Process-scoped singleton that owns the active legacy [ImportLoop].
 */
object ImportSession {

    private val _events = MutableSharedFlow<ImportEvent>(
        replay              = 0,
        extraBufferCapacity = 256,
    )
    val events: SharedFlow<ImportEvent> = _events.asSharedFlow()

    private val _records = MutableStateFlow<List<ImportRecord>>(emptyList())
    val records: StateFlow<List<ImportRecord>> = _records.asStateFlow()

    val importedCount: Int get() = _records.value.size

    @Volatile
    var isRunning: Boolean = false
        private set

    fun resetForNewSession() {
        _records.value = emptyList()
        isRunning = true
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var activeLoop: ImportLoop? = null

    fun start(context: Context, mtpDevice: MtpDevice, storageIds: IntArray, dao: DownloadedFileDao) {
        if (isRunning) {
            Timber.w("ImportSession.start() called but session already running — stopping old session first")
            stop()
        }

        Timber.i("ImportSession starting — %d storage(s)", storageIds.size)
        _records.value = emptyList()

        val importer = PtpImporter(context.applicationContext)
        val loopScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        val loop = ImportLoop(
            mtpDevice   = mtpDevice,
            storageIds  = storageIds,
            importer    = importer,
            dao         = dao,
            scope       = loopScope,
        )

        activeLoop = loop
        isRunning  = true

        scope.launch {
            loop.events.collect { event ->
                _events.emit(event)
                if (event is ImportEvent.ImportCompleted) {
                    _records.update { current ->
                        listOf(event.record) + current
                    }
                }
                if (event is ImportEvent.SessionStopped) {
                    isRunning = false
                }
            }
        }

        loop.start()
    }

    fun emitEvent(event: ImportEvent) {
        scope.launch {
            _events.emit(event)
            if (event is ImportEvent.ImportCompleted) {
                _records.update { current -> listOf(event.record) + current }
            }
        }
    }

    fun recordImportCompleted(record: ImportRecord, dao: DownloadedFileDao? = null) {
        scope.launch {
            _events.emit(ImportEvent.ImportCompleted(record))
            _records.update { current -> listOf(record) + current }
            dao?.insert(
                DownloadedFile(
                    handle = record.handle,
                    filename = record.filename,
                    mimeType = record.mimeType,
                    importedAt = record.importedAtMs,
                    sizeBytes = record.sizeBytes,
                )
            )
        }
    }

    fun stop() {
        Timber.i("ImportSession stopping (imported=%d)", importedCount)
        activeLoop?.stop()
        activeLoop = null
        isRunning  = false
    }
}
