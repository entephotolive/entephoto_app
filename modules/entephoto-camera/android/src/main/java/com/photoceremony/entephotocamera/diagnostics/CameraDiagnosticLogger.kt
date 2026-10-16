package com.photoceremony.entephotocamera.diagnostics

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Singleton diagnostic logger for the EntePhoto camera pipeline.
 *
 * Works in RELEASE builds with no Metro / ADB connection.
 * - Bounded in-memory ring buffer (~1000 entries).
 * - Rotating 2 MB diagnostic file in app-private cache storage.
 * - Forwards every record to a React Native listener callback.
 * - Never logs image bytes, credentials, or unrelated data.
 * - Logging a record does NOT itself generate another record (no recursion).
 */
object CameraDiagnosticLogger {

    const val SEV_DEBUG = "DEBUG"
    const val SEV_INFO  = "INFO"
    const val SEV_WARN  = "WARN"
    const val SEV_ERROR = "ERROR"

    private const val MAX_BUFFER     = 1_000
    private const val LOG_TAG        = "EntePhoto"
    private const val MAX_FILE_BYTES = 2L * 1024L * 1024L
    private const val LOG_FILENAME   = "entephoto_camera_diag.log"

    private val sequenceCounter = AtomicInteger(0)
    private val droppedCount    = AtomicLong(0)

    private val buffer = CopyOnWriteArrayList<DiagnosticRecord>()

    @Volatile private var logFile: File? = null
    @Volatile private var listener: ((DiagnosticRecord) -> Unit)? = null

    private val sdf = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    /**
     * Initialises the file sink. Safe to call multiple times (idempotent).
     * Call from MainApplication.onCreate or the Expo module OnCreate.
     */
    fun initialize(context: Context) {
        if (logFile != null) return
        try {
            logFile = File(context.cacheDir, LOG_FILENAME)
        } catch (_: Exception) { /* non-fatal */ }
    }

    /**
     * Register a callback invoked synchronously on the writing thread for each
     * new record. Set null to remove. The callback MUST NOT call [log]/[info]/
     * etc. to avoid recursion.
     */
    fun setListener(l: ((DiagnosticRecord) -> Unit)?) {
        listener = l
    }

    fun debug(component: String, message: String, ex: Throwable? = null,
              objectHandle: Int? = null, pipelineStage: String? = null) =
        append(SEV_DEBUG, component, message, ex, objectHandle, pipelineStage)

    fun info(component: String, message: String, ex: Throwable? = null,
             objectHandle: Int? = null, pipelineStage: String? = null) =
        append(SEV_INFO, component, message, ex, objectHandle, pipelineStage)

    fun warn(component: String, message: String, ex: Throwable? = null,
             objectHandle: Int? = null, pipelineStage: String? = null) =
        append(SEV_WARN, component, message, ex, objectHandle, pipelineStage)

    fun error(component: String, message: String, ex: Throwable? = null,
              objectHandle: Int? = null, pipelineStage: String? = null) =
        append(SEV_ERROR, component, message, ex, objectHandle, pipelineStage)

    fun getSnapshot(): List<DiagnosticRecord> = buffer.toList()

    fun clearBuffer() {
        buffer.clear()
        droppedCount.set(0)
    }

    fun dumpText(): String = buildString {
        buffer.forEach { r ->
            append("[${r.timestampIso}] [${r.severity}] [${r.component}] ${r.message}")
            if (r.exceptionType != null)  append(" | ex=${r.exceptionType}: ${r.exceptionMessage}")
            if (r.objectHandle != null)   append(" | handle=0x%08X".format(r.objectHandle))
            if (r.pipelineStage != null)  append(" | stage=${r.pipelineStage}")
            append('\n')
        }
    }

    private fun append(
        severity: String,
        component: String,
        message: String,
        ex: Throwable?,
        objectHandle: Int?,
        pipelineStage: String?,
    ) {
        val seq = sequenceCounter.incrementAndGet()
        val nowMs = System.currentTimeMillis()
        val record = DiagnosticRecord(
            sequenceId       = seq,
            timestampMs      = nowMs,
            timestampIso     = sdf.format(Date(nowMs)),
            severity         = severity,
            component        = component,
            message          = message,
            exceptionType    = ex?.javaClass?.simpleName,
            exceptionMessage = ex?.message,
            stackTrace       = ex?.stackTraceToString()?.take(1200),
            objectHandle     = objectHandle,
            pipelineStage    = pipelineStage,
        )

        // Bounded ring: drop oldest when full.
        if (buffer.size >= MAX_BUFFER) {
            if (buffer.isNotEmpty()) buffer.removeAt(0)
            droppedCount.incrementAndGet()
        }
        buffer.add(record)

        // Mirror to Logcat (visible with ADB).
        val line = "[${record.component}] ${record.message}"
        when (severity) {
            SEV_DEBUG -> Log.d(LOG_TAG, line, ex)
            SEV_WARN  -> Log.w(LOG_TAG, line, ex)
            SEV_ERROR -> Log.e(LOG_TAG, line, ex)
            else      -> Log.i(LOG_TAG, line, ex)
        }

        // Write to rotating file in app-private cache.
        logFile?.let { f ->
            try {
                if (f.exists() && f.length() > MAX_FILE_BYTES) {
                    f.renameTo(File(f.parent, "$LOG_FILENAME.bak"))
                }
                f.appendText(
                    "${record.timestampIso} ${record.severity.padEnd(5)} [${record.component}] ${record.message}" +
                    (if (ex != null) " | ${ex.javaClass.simpleName}: ${ex.message}" else "") +
                    "\n"
                )
            } catch (_: Exception) {}
        }

        // Deliver to React Native (do NOT call log* inside this callback).
        try { listener?.invoke(record) } catch (_: Exception) {}
    }
}

data class DiagnosticRecord(
    val sequenceId:       Int,
    val timestampMs:      Long,
    val timestampIso:     String,
    val severity:         String,
    val component:        String,
    val message:          String,
    val exceptionType:    String?,
    val exceptionMessage: String?,
    val stackTrace:       String?,
    val objectHandle:     Int?,
    val pipelineStage:    String?,
)
