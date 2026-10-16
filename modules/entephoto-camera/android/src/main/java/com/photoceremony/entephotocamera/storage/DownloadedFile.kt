package com.photoceremony.entephotocamera.storage

import androidx.room.Entity

/**
 * Room entity representing a single photo file that has been
 * successfully imported to this device.
 */
@Entity(
    tableName = "downloaded_files",
    primaryKeys = ["filename", "sizeBytes", "importedAt"]
)
data class DownloadedFile(
    val filename: String,
    val sizeBytes: Long,
    val importedAt: Long,
    val handle: Int,
    val mimeType: String,
)
