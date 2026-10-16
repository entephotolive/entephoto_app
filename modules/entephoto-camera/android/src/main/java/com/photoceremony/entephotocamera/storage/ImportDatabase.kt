package com.photoceremony.entephotocamera.storage

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

/**
 * Room database for entephoto USB Importer.
 */
@Database(
    entities  = [DownloadedFile::class],
    version   = 2,
    exportSchema = false,
)
abstract class ImportDatabase : RoomDatabase() {

    abstract fun downloadedFileDao(): DownloadedFileDao

    companion object {
        @Volatile
        private var INSTANCE: ImportDatabase? = null

        fun getInstance(context: Context): ImportDatabase {
            return INSTANCE ?: synchronized(this) {
                INSTANCE ?: Room.databaseBuilder(
                    context.applicationContext,
                    ImportDatabase::class.java,
                    "import_db"
                )
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { INSTANCE = it }
            }
        }
    }
}
