package com.photoceremony.usbimport.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

// ── Helper: notification permission check ────────────────────────────────────

/**
 * Returns true when POST_NOTIFICATIONS is granted (or API < 33 where it's
 * not needed).
 */
fun isNotificationPermissionGranted(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
    return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS,
    ) == PackageManager.PERMISSION_GRANTED
}

// ── Helper: battery optimisation check / request ─────────────────────────────

/**
 * Returns true when the app is currently exempted from battery optimisations.
 */
fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    val pm = context.getSystemService(PowerManager::class.java)
    return pm?.isIgnoringBatteryOptimizations(context.packageName) == true
}

/**
 * Launches the system dialog (or falls back to the settings page) that lets
 * the user grant a battery-optimisation exemption for this package.
 */
fun requestBatteryOptimizationExemption(context: Context) {
    val pkg = context.packageName
    val primary = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:$pkg")
    }
    try {
        context.startActivity(primary)
    } catch (_: Exception) {
        try {
            context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (_: Exception) {
            // Nothing we can do if both intents are unavailable
        }
    }
}

/**
 * Returns true when the device's hardware supports USB host mode.
 *
 * Derived at runtime via [PackageManager.hasSystemFeature] so the
 * "USB Host support" checklist item in [ConnectionGuideScreen] correctly
 * reflects the actual device capability — including on phones/tablets that
 * lack host hardware, which would fail silently if we defaulted to `true`.
 */
fun isUsbHostSupported(context: Context): Boolean =
    context.packageManager.hasSystemFeature("android.hardware.usb.host")

// ── Data classes for UI rows ──────────────────────────────────────────────────

/**
 * Data representation for step list items under Camera Settings.
 */
data class CameraStepData(
    val stepNumber: Int,
    val title: String,
    val description: String,
    val isTroubleshooting: Boolean = false,
)

/**
 * Data representation for checklist items under Phone Requirements.
 *
 * [isChecked]        — drives the indicator colour (green ✓ vs amber !)
 * [actionButtonText] — when non-null and [isChecked] is false, renders a
 *                      tappable button below the description.
 * [onActionClick]    — callback for the action button.
 * [denialNote]       — small italic note shown when a permission was denied
 *                      and there is nothing more to launch (no hard gate).
 */
data class PhoneRequirementData(
    val title: String,
    val description: String? = null,
    val isChecked: Boolean = true,
    val actionButtonText: String? = null,
    val onActionClick: (() -> Unit)? = null,
    val denialNote: String? = null,
)

// ── Screen ────────────────────────────────────────────────────────────────────

/**
 * ConnectionGuideScreen — Guides the user through camera menu settings and
 * phone readiness requirements for reliable USB MTP photo importing.
 *
 * Task 2: battery-optimisation exemption is checked dynamically and a button
 * is shown to request it; status is refreshed on every ON_RESUME.
 *
 * Task 3: POST_NOTIFICATIONS is requested once on first composition (API 33+);
 * if the user denies it the flow is NOT blocked — a small note explains the
 * consequence.
 */
@Composable
fun ConnectionGuideScreen(
    modifier: Modifier = Modifier,
) {
    val context        = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current

    // ── USB host hardware check (Task 5 — runtime, not a static param) ───────
    // Evaluated once; hardware capability cannot change while the app is open.
    val isUsbHostSupported = remember { isUsbHostSupported(context) }

    // ── Task 2: battery optimisation state ───────────────────────────────────
    var isBatteryExempt by remember { mutableStateOf(isIgnoringBatteryOptimizations(context)) }

    // ── Task 3: notification permission state ────────────────────────────────
    var isNotifGranted by remember { mutableStateOf(isNotificationPermissionGranted(context)) }
    // Track whether the user has explicitly dismissed/denied the dialog at
    // least once so we can show the denial note instead of re-launching it.
    var notifDenied by remember { mutableStateOf(false) }

    // Launcher wired for POST_NOTIFICATIONS (no-op on API < 33).
    val notifLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        isNotifGranted = granted
        if (!granted) notifDenied = true
    }

    // Fire the notification permission request once on first composition if
    // the permission is not already granted and we're on API 33+.
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !isNotifGranted) {
            notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // Re-check both dynamic states every time the screen is resumed (e.g.
    // after returning from System Settings for battery exemption).
    // isUsbHostSupported is omitted — hardware capability is fixed at boot.
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isBatteryExempt = isIgnoringBatteryOptimizations(context)
                isNotifGranted  = isNotificationPermissionGranted(context)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    // ── Camera settings step list ────────────────────────────────────────────
    val cameraSteps = listOf(
        CameraStepData(
            stepNumber    = 1,
            title         = "USB Connection → PC Remote",
            description   = "Set to PC Remote (not MTP, not Mass Storage)",
        ),
        CameraStepData(
            stepNumber    = 2,
            title         = "USB Power Supply → OFF",
            description   = "Camera runs on its own battery, not the phone",
        ),
        CameraStepData(
            stepNumber    = 3,
            title         = "Battery",
            description   = "Fully charged, or use AC adapter for long sessions",
        ),
    )

    // ── Phone requirements checklist ─────────────────────────────────────────
    val phoneRequirements = listOf(
        PhoneRequirementData(
            title       = "USB Host support confirmed",
            description = if (isUsbHostSupported)
                "Hardware USB host mode detected on this device"
            else
                "This device does not advertise USB host mode — cable connection may not work",
            isChecked   = isUsbHostSupported,
            // On unsupported devices surface a non-blocking advisory note.
            denialNote  = if (!isUsbHostSupported)
                "USB host hardware is required — this device may not support the import workflow"
            else null,
        ),
        PhoneRequirementData(
            title       = "Data-capable USB-C cable",
            description = "Must support data transfer — not a charge-only cable",
            isChecked   = true,
        ),
        PhoneRequirementData(
            title            = "Battery optimization exemption",
            description      = if (isBatteryExempt)
                "Exemption granted — background import service won't be killed"
            else
                "Strongly recommended so the background import service isn't killed",
            isChecked        = isBatteryExempt,
            actionButtonText = if (!isBatteryExempt) "Allow background access" else null,
            onActionClick    = if (!isBatteryExempt) {
                { requestBatteryOptimizationExemption(context) }
            } else null,
        ),
        PhoneRequirementData(
            title            = "Notification permission",
            description      = when {
                isNotifGranted                              -> "Granted — live import status will appear in the notification shade"
                Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> "Not required on this Android version"
                else                                        -> "Foreground service notification will not be shown"
            },
            isChecked        = isNotifGranted || Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU,
            // Show the denial note (non-blocking) only after the user dismissed
            // the dialog; no second button — they can grant via system settings.
            denialNote       = if (notifDenied && !isNotifGranted)
                "Grant notifications to see live status"
            else null,
        ),
        PhoneRequirementData(
            title       = "Sufficient free storage",
            description = "Check available disk space before a long shoot",
            isChecked   = true,
        ),
    )

    // ── Render ───────────────────────────────────────────────────────────────
    Surface(
        modifier = modifier.fillMaxSize(),
        color    = Color(0xFFFFD600),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Text(
                text       = "Connection Guide",
                fontSize   = 24.sp,
                fontWeight = FontWeight.Bold,
                color      = Color.Black,
            )

            // Camera Settings ─────────────────────────────────────────────────
            Text(
                text       = "Camera Settings",
                fontSize   = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color      = Color(0xFF1E293B),
            )
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape    = RoundedCornerShape(16.dp),
                colors   = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
            ) {
                Column(
                    modifier            = Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    cameraSteps.forEach { step -> StepItem(step = step) }
                }
            }

            // Phone Requirements ──────────────────────────────────────────────
            Text(
                text       = "Phone Requirements",
                fontSize   = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color      = Color(0xFF1E293B),
            )
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape    = RoundedCornerShape(16.dp),
                colors   = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
            ) {
                Column(
                    modifier            = Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    phoneRequirements.forEach { req -> ChecklistItem(requirement = req) }
                }
            }
        }
    }
}

// ── StepItem ─────────────────────────────────────────────────────────────────

/**
 * Renders a numbered camera-setup step.
 */
@Composable
fun StepItem(
    step: CameraStepData,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier          = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .background(
                    color  = if (step.isTroubleshooting) Color(0xFF334155) else Color(0xFF2563EB),
                    shape  = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text       = "${step.stepNumber}",
                color      = Color.White,
                fontSize   = 14.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text       = step.title,
                fontSize   = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color      = if (step.isTroubleshooting) Color(0xFFF59E0B) else Color.White,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text       = step.description,
                fontSize   = 13.sp,
                color      = Color(0xFF94A3B8),
                lineHeight = 18.sp,
            )
        }
    }
}

// ── ChecklistItem ─────────────────────────────────────────────────────────────

/**
 * Renders a phone requirement item with status indicator, optional action
 * button, and optional non-blocking denial note.
 */
@Composable
fun ChecklistItem(
    requirement: PhoneRequirementData,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier          = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .background(
                    color  = if (requirement.isChecked) Color(0xFF16A34A) else Color(0xFFEAB308),
                    shape  = CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text       = if (requirement.isChecked) "✓" else "!",
                color      = Color.White,
                fontSize   = 13.sp,
                fontWeight = FontWeight.Bold,
            )
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text       = requirement.title,
                fontSize   = 15.sp,
                fontWeight = FontWeight.Medium,
                color      = Color.White,
            )

            requirement.description?.let { desc ->
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text     = desc,
                    fontSize = 12.sp,
                    color    = Color(0xFF94A3B8),
                )
            }

            // Action button (e.g. battery exemption) — only shown when not checked.
            if (!requirement.isChecked &&
                requirement.actionButtonText != null &&
                requirement.onActionClick   != null
            ) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = requirement.onActionClick,
                    shape   = RoundedCornerShape(8.dp),
                    colors  = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF2563EB),
                        contentColor   = Color.White,
                    ),
                ) {
                    Text(
                        text       = requirement.actionButtonText,
                        fontSize   = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }

            // Denial note — non-blocking; shown after the user dismisses the
            // permission dialog without granting.
            requirement.denialNote?.let { note ->
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text     = note,
                    fontSize = 11.sp,
                    color    = Color(0xFFF59E0B), // amber — advisory, not error
                )
            }
        }
    }
}
