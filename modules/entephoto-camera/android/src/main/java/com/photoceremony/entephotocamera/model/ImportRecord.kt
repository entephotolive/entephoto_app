package com.photoceremony.entephotocamera.model

import android.net.Uri

/**
 * An immutable record of a single successfully imported photo/file.
 */
data class ImportRecord(
    val handle: Int,
    val filename: String,
    val sizeBytes: Long,
    val mediaUri: Uri?,
    val mimeType: String,
    val importedAtMs: Long = System.currentTimeMillis(),
) {
    val formattedSize: String
        get() = when {
            sizeBytes >= 1_048_576L -> "%.1f MB".format(sizeBytes / 1_048_576.0)
            sizeBytes >= 1_024L     -> "%.0f KB".format(sizeBytes / 1_024.0)
            else                     -> "$sizeBytes B"
        }
}
