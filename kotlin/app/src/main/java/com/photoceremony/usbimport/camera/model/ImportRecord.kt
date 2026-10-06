package com.photoceremony.usbimport.model

import android.net.Uri

/**
 * An immutable record of a single successfully imported photo/file.
 *
 * @param handle       The PTP object handle (opaque camera-side ID).
 * @param filename     The filename as reported by [android.mtp.MtpObjectInfo.name].
 * @param sizeBytes    Compressed file size in bytes.
 * @param mediaUri     The [Uri] under which the file was stored in MediaStore
 *                     (null if the MediaStore insert failed but bytes were still
 *                     saved via the legacy file API on API < 29).
 * @param mimeType     MIME type derived from the PTP format code.
 * @param importedAtMs Wall-clock time the import completed (ms since epoch).
 */
data class ImportRecord(
    val handle: Int,
    val filename: String,
    val sizeBytes: Long,
    val mediaUri: Uri?,
    val mimeType: String,
    val importedAtMs: Long = System.currentTimeMillis(),
) {
    /** Human-readable size string (e.g. "24.3 MB"). */
    val formattedSize: String
        get() = when {
            sizeBytes >= 1_048_576L -> "%.1f MB".format(sizeBytes / 1_048_576.0)
            sizeBytes >= 1_024L     -> "%.0f KB".format(sizeBytes / 1_024.0)
            else                     -> "$sizeBytes B"
        }
}
