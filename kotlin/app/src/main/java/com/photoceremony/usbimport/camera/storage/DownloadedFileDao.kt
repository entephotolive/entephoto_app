package com.photoceremony.usbimport.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Room DAO for [DownloadedFile].
 *
 * All suspend functions run on a background thread managed by Room.
 * Do not call them from the main thread.
 */
@Dao
interface DownloadedFileDao {

    /**
     * Insert a newly imported file record.
     *
     * [OnConflictStrategy.IGNORE] means if the exact same file (filename + size + timestamp)
     * is inserted twice, the second insert is silently dropped.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(file: DownloadedFile)

    /**
     * Checks if a file with the given [filename] and [sizeBytes] has already been imported.
     */
    @Query("SELECT EXISTS(SELECT 1 FROM downloaded_files WHERE filename = :filename AND sizeBytes = :sizeBytes)")
    suspend fun isAlreadyDownloaded(filename: String, sizeBytes: Long): Boolean

    /**
     * Returns ALL PTP handles that were successfully imported.
     *
     * Called on [com.photoceremony.usbimport.ptp.ImportLoop] startup to
     * pre-populate `knownHandles`, preventing re-imports within the current session.
     */
    @Query("SELECT handle FROM downloaded_files")
    suspend fun getAllHandles(): List<Int>

    /**
     * Live count of imported files — used by Page 2 stats bar.
     * Emits a new value whenever a row is inserted.
     */
    @Query("SELECT COUNT(*) FROM downloaded_files")
    fun countFlow(): Flow<Int>

    /**
     * Most-recent imports in reverse chronological order — used to
     * seed the Page 2 RecyclerView after a configuration change.
     * Limit 200 to avoid loading a huge result set into memory.
     */
    @Query("SELECT * FROM downloaded_files ORDER BY importedAt DESC LIMIT 200")
    suspend fun getRecentImports(): List<DownloadedFile>
}

