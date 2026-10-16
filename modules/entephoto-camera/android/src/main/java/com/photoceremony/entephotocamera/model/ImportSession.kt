package com.photoceremony.entephotocamera.model

import com.photoceremony.entephotocamera.storage.DownloadedFile
import com.photoceremony.entephotocamera.storage.DownloadedFileDao
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

/**
 * Process-scoped singleton that owns active camera import events and records.
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

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun resetForNewSession() {
        _records.value = emptyList()
        isRunning = true
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
        isRunning = false
    }
}
