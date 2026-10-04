package com.photoceremony.usbimport.ui

import android.content.Context
import android.content.SharedPreferences

/**
 * Lightweight SharedPreferences-backed store for single-boolean guide flags.
 *
 * Stores whether the user has already seen the ConnectionGuideScreen on first
 * launch.  Using SharedPreferences keeps the implementation self-contained
 * (no new Gradle dependency) while delivering identical semantics to DataStore
 * for a single boolean key.
 */
object GuidePreferences {

    private const val PREFS_NAME = "guide_prefs"
    private const val KEY_HAS_SEEN_GUIDE = "hasSeenGuide"

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Returns true if the user has already been through the guide at least once. */
    fun hasSeenGuide(context: Context): Boolean =
        prefs(context).getBoolean(KEY_HAS_SEEN_GUIDE, false)

    /** Marks the guide as seen so it won't auto-open on subsequent launches. */
    fun markSeen(context: Context) =
        prefs(context).edit().putBoolean(KEY_HAS_SEEN_GUIDE, true).apply()
}
