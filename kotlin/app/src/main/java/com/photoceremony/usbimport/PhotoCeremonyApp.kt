package com.photoceremony.usbimport

import android.app.Application
import timber.log.Timber

/**
 * Application class — initialises Timber logging.
 *
 * Timber is used throughout the app instead of android.util.Log so that
 * log calls are stripped in release builds automatically (no ProGuard rule
 * required).
 */
class PhotoCeremonyApp : Application() {

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
        }
    }
}
