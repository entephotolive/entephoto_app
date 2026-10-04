package com.photoceremony.usbimport.legacy_mtp

import android.content.ContentValues
import android.content.Context
import android.mtp.MtpDevice
import android.mtp.MtpObjectInfo
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import com.photoceremony.usbimport.model.ImportRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import timber.log.Timber
import java.io.File

/**
 * [LEGACY MTP CODE - PRESERVED FOR REFERENCE]
 *
 * Converts a single PTP object handle into a persisted file using
 * [MtpDevice.importFile] (direct USB-to-disk streaming — no byte[] in RAM).
 */
class PtpImporter(private val context: Context) {

    private val relativeDir = "DCIM/entephoto/"

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Import one PTP object handle.
     *
     * Must be called from a background thread (already handled by [ImportLoop]).
     */
    suspend fun importHandle(mtpDevice: MtpDevice, handle: Int): ImportResult =
        withContext(Dispatchers.IO) {

            // ── 1. GetObjectInfo ──────────────────────────────────────────────
            val info: MtpObjectInfo = mtpDevice.getObjectInfo(handle)
                ?: run {
                    Timber.w("importHandle(%d): getObjectInfo returned null — camera busy", handle)
                    return@withContext ImportResult.CameraBusy(handle, "getObjectInfo returned null")
                }

            val filename = info.name?.takeIf { it.isNotBlank() } ?: "IMG_$handle.jpg"
            val mimeType = formatToMimeType(info.format, filename)

            // ── 2. SIZE GUARD ─────────────────────────────────────────────────
            if (info.compressedSize <= 0) {
                Timber.d(
                    "importHandle(%d): compressedSize=%d ≤ 0 — object mid-write, " +
                    "skipping; will retry next poll cycle",
                    handle, info.compressedSize
                )
                return@withContext ImportResult.MidWrite(handle)
            }

            Timber.d(
                "importHandle(%d): filename=%s compressedSize=%d mimeType=%s",
                handle, filename, info.compressedSize, mimeType
            )

            // ── 3. importFile — stream directly to storage ────────────────────
            val dateTakenMs = info.dateCreated * 1_000L

            val result: ImportResult = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                importViaMediaStore(mtpDevice, handle, filename, mimeType, dateTakenMs)
            } else {
                importViaFileApi(mtpDevice, handle, filename, info.compressedSize.toLong())
            }

            if (result is ImportResult.Success) {
                Timber.i(
                    "importHandle(%d): saved '%s' (%s)",
                    handle, filename, result.record.formattedSize
                )
            }
            result
        }

    // ── API 29+: importFile → ParcelFileDescriptor → MediaStore ──────────────

    private fun importViaMediaStore(
        mtpDevice: MtpDevice,
        handle: Int,
        filename: String,
        mimeType: String,
        dateTakenMs: Long,
    ): ImportResult {
        val resolver = context.contentResolver

        val collection = if (mimeType.startsWith("image/"))
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        else
            MediaStore.Downloads.EXTERNAL_CONTENT_URI

        val cv = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
            put(MediaStore.MediaColumns.RELATIVE_PATH, relativeDir)
            put(MediaStore.MediaColumns.DATE_TAKEN, dateTakenMs)
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }

        val uri: Uri = resolver.insert(collection, cv)
            ?: run {
                Timber.e("importViaMediaStore(%d): resolver.insert returned null", handle)
                return ImportResult.CameraBusy(handle, "MediaStore insert failed")
            }

        val pfd: ParcelFileDescriptor = try {
            resolver.openFileDescriptor(uri, "w")
                ?: throw IllegalStateException("openFileDescriptor returned null")
        } catch (e: Exception) {
            Timber.e(e, "importViaMediaStore(%d): openFileDescriptor failed", handle)
            resolver.delete(uri, null, null)
            return ImportResult.CameraBusy(handle, "openFileDescriptor failed: ${e.message}")
        }

        val ok: Boolean = try {
            mtpDevice.importFile(handle, pfd)
        } catch (e: Exception) {
            Timber.w(e, "importViaMediaStore(%d): importFile threw", handle)
            false
        } finally {
            try { pfd.close() } catch (_: Exception) {}
        }

        return if (ok) {
            val publish = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            resolver.update(uri, publish, null, null)

            ImportResult.Success(
                ImportRecord(
                    handle       = handle,
                    filename     = filename,
                    sizeBytes    = querySizeFromMediaStore(uri),
                    mediaUri     = uri,
                    mimeType     = mimeType,
                )
            )
        } else {
            resolver.delete(uri, null, null)
            Timber.w("importViaMediaStore(%d): importFile returned false — camera busy", handle)
            ImportResult.CameraBusy(handle, "importFile returned false")
        }
    }

    private fun querySizeFromMediaStore(uri: Uri): Long {
        return try {
            context.contentResolver.query(
                uri,
                arrayOf(MediaStore.MediaColumns.SIZE),
                null, null, null
            )?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getLong(0) else 0L
            } ?: 0L
        } catch (_: Exception) {
            0L
        }
    }

    // ── API 26–28: importFile → absolute path ─────────────────────────────────

    @Suppress("DEPRECATION")
    private fun importViaFileApi(
        mtpDevice: MtpDevice,
        handle: Int,
        filename: String,
        compressedSize: Long,
    ): ImportResult {
        val dir = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DCIM),
            "entephoto"
        )
        dir.mkdirs()
        val dest = File(dir, filename)

        val ok: Boolean = try {
            mtpDevice.importFile(handle, dest.absolutePath)
        } catch (e: Exception) {
            Timber.w(e, "importViaFileApi(%d): importFile threw", handle)
            false
        }

        return if (ok) {
            Timber.i("importViaFileApi(%d): wrote to %s", handle, dest.absolutePath)
            ImportResult.Success(
                ImportRecord(
                    handle    = handle,
                    filename  = filename,
                    sizeBytes = dest.length(),
                    mediaUri  = null,
                    mimeType  = formatToMimeType(0, filename),
                )
            )
        } else {
            dest.delete()
            Timber.w("importViaFileApi(%d): importFile returned false — camera busy", handle)
            ImportResult.CameraBusy(handle, "importFile returned false")
        }
    }

    // ── PTP format → MIME type ────────────────────────────────────────────────

    private fun formatToMimeType(format: Int, filename: String): String = when (format) {
        0x3801 -> "image/jpeg"
        0x3808 -> "image/tiff"
        0xB002 -> "image/x-sony-arw"
        else   -> when {
            filename.endsWith(".arw",  ignoreCase = true) -> "image/x-sony-arw"
            filename.endsWith(".jpg",  ignoreCase = true) -> "image/jpeg"
            filename.endsWith(".jpeg", ignoreCase = true) -> "image/jpeg"
            filename.endsWith(".tif",  ignoreCase = true) -> "image/tiff"
            filename.endsWith(".tiff", ignoreCase = true) -> "image/tiff"
            filename.endsWith(".mp4",  ignoreCase = true) -> "video/mp4"
            filename.endsWith(".mov",  ignoreCase = true) -> "video/quicktime"
            else                                          -> "application/octet-stream"
        }
    }

    sealed class ImportResult {
        data class Success(val record: ImportRecord) : ImportResult()
        data class MidWrite(val handle: Int) : ImportResult()
        data class CameraBusy(val handle: Int, val reason: String) : ImportResult()
    }
}
