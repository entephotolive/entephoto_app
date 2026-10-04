package com.photoceremony.usbimport.db

import androidx.room.Entity

/**
 * Room entity representing a single photo file that has been
 * successfully imported to this device.
 *
 * Uniqueness is keyed on [filename], [sizeBytes], and [importedAt]
 * rather than raw PTP object handle alone, because handles are session-scoped
 * and can be reassigned by the camera across reboots or reconnects.
 */
@Entity(
    tableName = "downloaded_files",
    primaryKeys = ["filename", "sizeBytes", "importedAt"]
)
data class DownloadedFile(
    /** Filename as reported by GetObjectInfo (e.g. "DSC01234.ARW"). */
    val filename: String,

    /** File size in bytes (from MtpObjectInfo.compressedSize after import). */
    val sizeBytes: Long,

    /** Wall-clock time the import completed (ms since epoch). */
    val importedAt: Long,

    /** PTP object handle at the time of import (session-scoped). */
    val handle: Int,

    /** MIME type derived from the PTP format code. */
    val mimeType: String,
)

