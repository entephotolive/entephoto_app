package com.photoceremony.entephotocamera

import com.photoceremony.entephotocamera.core.CameraManager
import com.photoceremony.entephotocamera.diagnostics.CameraDiagnosticLogger
import com.photoceremony.entephotocamera.diagnostics.DiagnosticRecord
import com.photoceremony.entephotocamera.notifications.NotificationHelper
import com.photoceremony.entephotocamera.notifications.UploadForegroundService
import android.content.ContentUris
import androidx.documentfile.provider.DocumentFile
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.photoceremony.entephotocamera.storage.ImportDatabase
import kotlinx.coroutines.runBlocking
import timber.log.Timber
import java.io.File
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class EntePhotoCameraModule : Module() {
    private val cameraManager = CameraManager()

    override fun definition() = ModuleDefinition {
        Name("EntePhotoCamera")

        Events(
            "onDeviceFound",
            "onDeviceDisconnected",
            "onConnectionStateChanged",
            "onPhotoSaved",
            // Phase 1: diagnostic stream — carries individual log records to the JS layer.
            "onDiagnosticLog",
            // Phase 3: transfer failures — carries per-object pipeline failures.
            "onPhotoTransferError",
            "onPhotoSkipped",
        )

        OnCreate {
            // Initialise the diagnostic file sink with the module's application context.
            // This is idempotent; MainApplication.onCreate also calls it so whichever
            // runs first wins, and the second call is a no-op.
            val ctx = appContext.reactContext
            if (ctx != null) {
                CameraDiagnosticLogger.initialize(ctx.applicationContext)
            }

            // Register a listener that forwards every new diagnostic record to React Native.
            // The listener must NEVER itself call CameraDiagnosticLogger.log*() — that
            // would create an infinite recursion loop.
            CameraDiagnosticLogger.setListener { record ->
                sendDiagnosticEvent(record)
            }

            cameraManager.setListener(object : CameraManager.EventListener {
                override fun onDeviceFound(deviceName: String) {
                    sendEvent("onDeviceFound", mapOf("deviceName" to deviceName))
                }

                override fun onDeviceDisconnected(reason: String) {
                    sendEvent("onDeviceDisconnected", mapOf("reason" to reason))
                }

                override fun onConnectionStateChanged(state: String) {
                    sendEvent("onConnectionStateChanged", mapOf("state" to state))
                }

                /**
                 * Fired by [CameraManager] after [com.photoceremony.entephotocamera.model.ImportSession]
                 * confirms the photo is fully saved in MediaStore / disk.
                 * Only called once per successfully imported object.
                 */
                override fun onPhotoSaved(uri: String, filename: String, mimeType: String) {
                    sendEvent(
                        "onPhotoSaved",
                        mapOf(
                            "uri"      to uri,
                            "filename" to filename,
                            "mimeType" to mimeType,
                        ),
                    )
                }

                /**
                 * Fired when an import pipeline stage fails for a specific object handle.
                 * The camera session is NOT disconnected by a single transfer failure.
                 */
                override fun onPhotoTransferError(
                    handle: Int,
                    stage: String,
                    message: String,
                    errorCode: String?,
                    retryable: Boolean,
                ) {
                    sendEvent(
                        "onPhotoTransferError",
                        mapOf(
                            "handle"    to handle,
                            "stage"     to stage,
                            "message"   to message,
                            "errorCode" to (errorCode ?: ""),
                            "retryable" to retryable,
                            "timestamp" to System.currentTimeMillis(),
                        ),
                    )
                }

                override fun onPhotoSkipped(filename: String, extension: String, reason: String) {
                    sendEvent(
                        "onPhotoSkipped",
                        mapOf(
                            "filename"  to filename,
                            "extension" to extension,
                            "reason"    to reason,
                        ),
                    )
                }
            })
        }

        OnDestroy {
            // Unregister the diagnostic listener before teardown to prevent callbacks
            // arriving after the module is destroyed.
            CameraDiagnosticLogger.setListener(null)

            val ctx = appContext.reactContext
            if (ctx != null) {
                // Unconditional full teardown — closes the Sony session, cancels
                // the import-event collector, and unregisters USB receivers.
                cameraManager.disconnect(ctx)
            }
            cameraManager.setListener(null)
        }

        // ── Public functions ──────────────────────────────────────────────────

        Function("getStatus") {
            "ready"
        }

        Function("getConnectionState") {
            cameraManager.getConnectionState()
        }

        Function("startSearch") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.startSearch(ctx)
            }
        }

        /**
         * Stops USB device discovery only.
         *
         * If the camera is already connected in RemoteShooting mode this is a
         * no-op — the session survives navigation between connected-camera screens.
         * Call [disconnect] for an explicit full teardown.
         */
        Function("stopSearch") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.stopSearch(ctx)
            }
        }

        /**
         * Reconciles native camera connection status when returning to foreground.
         */
        Function("reconcileState") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.reconcileState(ctx)
            }
        }

        /**
         * Explicitly ends the Sony remote-shooting session, cancels the import
         * event loop, and releases all USB resources regardless of connection state.
         */
        Function("disconnect") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                cameraManager.disconnect(ctx)
            }
        }

        /**
         * Returns a snapshot of all buffered diagnostic records as a list of maps.
         * The snapshot is safe to call on any thread and never blocks the camera loop.
         * Use this to populate the diagnostic console when it first opens.
         */
        Function("getDiagnosticLogs") {
            CameraDiagnosticLogger.getSnapshot().map { r -> recordToMap(r) }
        }

        /**
         * Clears the in-memory diagnostic buffer.
         * Does NOT disconnect the camera or reset the active PTP session.
         */
        Function("clearDiagnosticLogs") {
            CameraDiagnosticLogger.clearBuffer()
        }

        /**
         * Returns the full diagnostic log as a single newline-delimited text string.
         * Suitable for sharing/exporting as a .txt file from the diagnostic console.
         */
        Function("getDiagnosticText") {
            CameraDiagnosticLogger.dumpText()
        }

        // ── MediaStore & Storage bridge ──────────────────────────────────────

        Function("checkFolderPhysicallyExists") {
            try {
                val dcimDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DCIM
                )
                val entephotoDir = File(dcimDir, "Entephoto")
                entephotoDir.exists() && entephotoDir.isDirectory
            } catch (e: Exception) {
                Timber.w(e, "EntePhotoCameraModule: checkFolderPhysicallyExists error")
                false
            }
        }

        Function("tryDirectMkdirs") {
            try {
                val dcimDir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_DCIM
                )
                val entephotoDir = File(dcimDir, "Entephoto")
                if (entephotoDir.exists() && entephotoDir.isDirectory) {
                    "already_exists"
                } else if (entephotoDir.mkdirs()) {
                    "created"
                } else {
                    "failed"
                }
            } catch (e: Exception) {
                Timber.w(e, "EntePhotoCameraModule: tryDirectMkdirs error")
                "failed"
            }
        }

        Function("createSubdirectoryWithTreeUri") { treeUriString: String, subDirName: String ->
            val result = mutableMapOf<String, Any>(
                "success" to false,
                "alreadyExists" to false
            )
            val ctx = appContext.reactContext ?: return@Function result
            try {
                val treeUri = Uri.parse(treeUriString)
                val docFile = DocumentFile.fromTreeUri(ctx, treeUri)
                if (docFile != null && docFile.isDirectory) {
                    val existing = docFile.findFile(subDirName)
                    if (existing != null && existing.isDirectory) {
                        result["success"] = true
                        result["alreadyExists"] = true
                        result["uri"] = existing.uri.toString()
                    } else {
                        val created = docFile.createDirectory(subDirName)
                        if (created != null) {
                            result["success"] = true
                            result["alreadyExists"] = false
                            result["uri"] = created.uri.toString()
                        } else {
                            result["error"] = "Failed to create directory via DocumentFile"
                        }
                    }
                } else {
                    result["error"] = "Tree URI is not accessible or not a directory"
                }
            } catch (e: Exception) {
                Timber.e(e, "EntePhotoCameraModule: createSubdirectoryWithTreeUri failed")
                result["error"] = e.message ?: "Unknown exception"
            }
            result
        }

        Function("getPersistedUriPermissions") {
            val ctx = appContext.reactContext ?: return@Function emptyList<String>()
            try {
                ctx.contentResolver.persistedUriPermissions
                    .filter { it.isReadPermission && it.isWritePermission }
                    .map { it.uri.toString() }
            } catch (e: Exception) {
                emptyList<String>()
            }
        }

        Function("releasePersistedUriPermission") { uriString: String ->
            val ctx = appContext.reactContext ?: return@Function false
            try {
                val uri = Uri.parse(uriString)
                ctx.contentResolver.releasePersistableUriPermission(
                    uri,
                    android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                )
                true
            } catch (e: Exception) {
                Timber.w(e, "EntePhotoCameraModule: releasePersistedUriPermission failed")
                false
            }
        }

        AsyncFunction("ensureStorageReady") {
            val ctx = appContext.reactContext
            val apiLevel = Build.VERSION.SDK_INT
            val isScopedStorage = apiLevel >= Build.VERSION_CODES.Q
            val dcimDir = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_DCIM
            )
            val entephotoDir = File(dcimDir, "Entephoto")
            val physicalExists = try {
                entephotoDir.exists() && entephotoDir.isDirectory
            } catch (e: Exception) {
                false
            }

            val result = mutableMapOf<String, Any>(
                "ready" to physicalExists,
                "physicalExists" to physicalExists,
                "apiLevel" to apiLevel,
                "isScopedStorage" to isScopedStorage,
                "targetPath" to "DCIM/Entephoto/"
            )

            if (!physicalExists) {
                if (!isScopedStorage && ctx != null) {
                    try {
                        val created = entephotoDir.mkdirs()
                        result["directoryCreated"] = created
                        result["ready"] = created
                        result["physicalExists"] = created
                    } catch (e: Exception) {
                        Timber.w(e, "EntePhotoCameraModule: legacy mkdir failed")
                        result["ready"] = false
                        result["error"] = e.message ?: "Failed to create legacy directory"
                    }
                }
            }
            result
        }

        AsyncFunction("queryStoredPhotos") { relativeDir: String? ->
            val photos = mutableListOf<Map<String, Any?>>()
            val resolver = appContext.reactContext?.contentResolver ?: return@AsyncFunction photos

            val projection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.SIZE,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.MIME_TYPE,
                    MediaStore.Images.Media.RELATIVE_PATH
                )
            } else {
                arrayOf(
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.SIZE,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED,
                    MediaStore.Images.Media.MIME_TYPE,
                    MediaStore.Images.Media.DATA
                )
            }

            val targetDir = relativeDir?.trimEnd('/') ?: "DCIM/Entephoto"
            val (selection, selectionArgs) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                Pair(
                    "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ? OR ${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?",
                    arrayOf("$targetDir%", "Entephoto")
                )
            } else {
                Pair(
                    "${MediaStore.Images.Media.DATA} LIKE ? OR ${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?",
                    arrayOf("%/$targetDir/%", "Entephoto")
                )
            }

            val sortOrder = "${MediaStore.Images.Media.DATE_TAKEN} DESC, ${MediaStore.Images.Media.DATE_ADDED} DESC"

            try {
                resolver.query(
                    MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    projection,
                    selection,
                    selectionArgs,
                    sortOrder
                )?.use { cursor ->
                    val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                    val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                    val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
                    val dateTakenColumn = cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN)
                    val dateAddedColumn = cursor.getColumnIndex(MediaStore.Images.Media.DATE_ADDED)
                    val mimeColumn = cursor.getColumnIndex(MediaStore.Images.Media.MIME_TYPE)

                    while (cursor.moveToNext()) {
                        val id = cursor.getLong(idColumn)
                        val name = cursor.getString(nameColumn) ?: ("photo_" + id + ".jpg")
                        val size = cursor.getLong(sizeColumn)
                        val dateTaken = if (dateTakenColumn != -1 && !cursor.isNull(dateTakenColumn)) {
                            cursor.getLong(dateTakenColumn)
                        } else if (dateAddedColumn != -1 && !cursor.isNull(dateAddedColumn)) {
                            cursor.getLong(dateAddedColumn) * 1000L
                        } else {
                            System.currentTimeMillis()
                        }
                        val mimeType = if (mimeColumn != -1 && !cursor.isNull(mimeColumn)) {
                            cursor.getString(mimeColumn)
                        } else {
                            "image/jpeg"
                        }
                        val contentUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)

                        photos.add(
                            mapOf(
                                "id" to id.toString(),
                                "mediaId" to id,
                                "uri" to contentUri.toString(),
                                "filename" to name,
                                "sizeBytes" to size,
                                "capturedAt" to dateTaken,
                                "mimeType" to mimeType
                            )
                        )
                    }
                }
            } catch (e: Exception) {
                Timber.e(e, "EntePhotoCameraModule: queryStoredPhotos failed")
            }

            photos
        }

        AsyncFunction("deleteStoredPhoto") { uriString: String ->
            val ctx = appContext.reactContext ?: return@AsyncFunction false
            var deleted = false
            var filename: String? = null

            try {
                val uri = Uri.parse(uriString)
                if (uri.scheme == "content") {
                    ctx.contentResolver.query(
                        uri,
                        arrayOf(MediaStore.Images.Media.DISPLAY_NAME),
                        null,
                        null,
                        null
                    )?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val nameIdx = cursor.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME)
                            if (nameIdx != -1) {
                                filename = cursor.getString(nameIdx)
                            }
                        }
                    }
                    val rows = ctx.contentResolver.delete(uri, null, null)
                    deleted = rows > 0
                } else if (uri.scheme == "file" || uriString.startsWith("/")) {
                    val filePath = if (uri.scheme == "file") uri.path ?: uriString else uriString
                    val file = File(filePath)
                    filename = file.name
                    if (file.exists()) {
                        deleted = file.delete()
                    }
                    try {
                        ctx.contentResolver.delete(
                            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                            "${MediaStore.Images.Media.DATA} = ?",
                            arrayOf(file.absolutePath)
                        )
                    } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                Timber.e(e, "EntePhotoCameraModule: failed to delete stored photo " + uriString)
            }

            if (deleted && filename != null) {
                try {
                    val db = ImportDatabase.getInstance(ctx)
                    runBlocking {
                        db.downloadedFileDao().deleteByFilename(filename!!)
                    }
                } catch (e: Exception) {
                    Timber.w(e, "EntePhotoCameraModule: failed to purge Room database for " + filename)
                }
            }

            deleted
        }

        Function("purgeDownloadedRecord") { filename: String ->
            val ctx = appContext.reactContext ?: return@Function false
            try {
                val db = ImportDatabase.getInstance(ctx)
                runBlocking {
                    db.downloadedFileDao().deleteByFilename(filename)
                }
                true
            } catch (e: Exception) {
                Timber.w(e, "EntePhotoCameraModule: failed to purge Room record for " + filename)
                false
            }
        }


        // ── Notification bridge ───────────────────────────────────────────────

        Function("hasNotificationPermission") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.hasNotificationPermission(ctx)
            } else {
                false
            }
        }

        Function("showCameraSearching") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.showCameraSearching(ctx)
            }
        }

        Function("showCameraConnected") { cameraName: String? ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.showCameraConnected(ctx, cameraName)
            }
        }

        Function("dismissCamera") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.dismissCamera(ctx)
            }
        }

        Function("dismissCameraNotification") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.dismissCamera(ctx)
            }
        }

        Function("startUploadService") { current: Int, total: Int, percentage: Double? ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                UploadForegroundService.start(ctx, current, total, percentage)
            }
        }

        Function("updateUploadProgress") { current: Int, total: Int, percentage: Double? ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                UploadForegroundService.update(ctx, current, total, percentage)
            }
        }

        Function("stopUploadService") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                UploadForegroundService.stop(ctx)
            }
        }

        Function("showUploadComplete") { count: Int ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.showUploadComplete(ctx, count)
            }
        }

        Function("showUploadCancelled") { uploadedCount: Int, total: Int ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.showUploadCancelled(ctx, uploadedCount, total)
            }
        }

        Function("showUploadFailed") { message: String, successCount: Int, total: Int ->
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.showUploadFailed(ctx, message, successCount, total)
            }
        }

        Function("dismissUpload") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.dismissUpload(ctx)
            }
        }

        Function("dismissUploadNotification") {
            val ctx = appContext.reactContext
            if (ctx != null) {
                NotificationHelper.dismissUpload(ctx)
            }
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /** Converts a [DiagnosticRecord] to a plain map suitable for a React Native event payload. */
    private fun recordToMap(r: DiagnosticRecord): Map<String, Any?> = mapOf(
        "sequenceId"       to r.sequenceId,
        "timestampMs"      to r.timestampMs,
        "timestampIso"     to r.timestampIso,
        "severity"         to r.severity,
        "component"        to r.component,
        "message"          to r.message,
        "exceptionType"    to r.exceptionType,
        "exceptionMessage" to r.exceptionMessage,
        "stackTrace"       to r.stackTrace,
        "objectHandle"     to r.objectHandle,
        "pipelineStage"    to r.pipelineStage,
    )

    /**
     * Sends a [DiagnosticRecord] as an [onDiagnosticLog] event.
     * Called from the [CameraDiagnosticLogger] listener — MUST NOT itself call
     * CameraDiagnosticLogger.log*() to prevent recursive infinite loops.
     */
    private fun sendDiagnosticEvent(record: DiagnosticRecord) {
        try {
            sendEvent("onDiagnosticLog", recordToMap(record))
        } catch (_: Exception) {
            // swallow silently — never recurse into the logger here
        }
    }
}
