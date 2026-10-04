package com.photoceremony.usbimport.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme

/**
 * ConnectionGuideActivity — thin host for the [ConnectionGuideScreen] composable.
 *
 * Launched:
 *  • Automatically on first app launch (from [MainActivity] when hasSeenGuide == false).
 *  • Any time the user taps "Connection help" on the Waiting for Camera screen.
 *
 * Back press / up navigation returns to [MainActivity] (parentActivityName in the manifest).
 */
class ConnectionGuideActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                ConnectionGuideScreen()
            }
        }
    }
}
