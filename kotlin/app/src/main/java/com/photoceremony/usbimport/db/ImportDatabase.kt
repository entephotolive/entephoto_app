package com.photoceremony.usbimport.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Room database for entephoto USB Importer.
 *
 * Schema:
 *   • [DownloadedFile] — one row per successfully imported PTP handle
 *
 * Version history:
 *   1 — initial schema (Step 4)
 *
 * Singleton access via [getInstance] — safe for use from multiple coroutines.
 * The instance is created lazily on first access and reused for the process
 * lifetime.
 */
@Database(
    entities  = [DownloadedFile::class],
    version   = 2,
    exportSchema = false,   // set to true and provide schemaDirectory for production
)
abstract class ImportDatabase : RoomDatabase() {

    abstract fun downloadedFileDao(): DownloadedFileDao

    companion object {
        @Volatile
        private var INSTANCE: ImportDatabase? = null

        /**
         * Returns the singleton [ImportDatabase], creating it if necessary.
         *
         * Thread-safe: uses double-checked locking under the companion-object
         * monitor — correct because [INSTANCE] is `@Volatile`.
         */
        fun getInstance(context: Context): ImportDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    ImportDatabase::class.java,
                    "import_db"
                )
                    .fallbackToDestructiveMigration()   // acceptable for a local cache
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
