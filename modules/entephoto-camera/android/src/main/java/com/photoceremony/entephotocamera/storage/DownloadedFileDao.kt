package com.photoceremony.entephotocamera.storage

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

/**
 * Room DAO for [DownloadedFile].
 */
@Dao
interface DownloadedFileDao {

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(file: DownloadedFile): Long

    @Query("SELECT EXISTS(SELECT 1 FROM downloaded_files WHERE filename = :filename AND sizeBytes = :sizeBytes)")
    suspend fun isAlreadyDownloaded(filename: String, sizeBytes: Long): Boolean

    @Query("SELECT handle FROM downloaded_files")
    suspend fun getAllHandles(): List<Int>

    @Query("SELECT COUNT(*) FROM downloaded_files")
    fun countFlow(): Flow<Int>

    @Query("SELECT * FROM downloaded_files ORDER BY importedAt DESC LIMIT 200")
    suspend fun getRecentImports(): List<DownloadedFile>

    @Query("DELETE FROM downloaded_files WHERE filename = :filename")
    suspend fun deleteByFilename(filename: String): Int
}
