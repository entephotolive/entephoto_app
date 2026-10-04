package com.photoceremony.usbimport.ui

import android.Manifest
import android.animation.ObjectAnimator
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.photoceremony.usbimport.R
import com.photoceremony.usbimport.databinding.ActivityMainBinding
import com.photoceremony.usbimport.ptp.ConnectionState
import com.photoceremony.usbimport.ptp.DeviceChecker
import com.photoceremony.usbimport.ptp.UsbConnectionManager
import com.photoceremony.usbimport.service.ImportService
import com.photoceremony.usbimport.sony.PtpUsbTransport
import com.photoceremony.usbimport.sony.SonyRemoteSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import timber.log.Timber

/**
 * MainActivity — Page 1 (Connection Screen).
 *
 * Responsibilities:
 *  1. Request POST_NOTIFICATIONS permission on API 33+ (needed for the
 *     persistent foreground-service notification).
 *  2. Receive [UsbManager.ACTION_USB_DEVICE_ATTACHED] from the manifest
 *     filter and forward the device to [ImportService] via explicit intent.
 *  3. Collect [UsbConnectionManager.state] and render the appropriate UI
 *     panel for each [ConnectionState]:
 *       • Idle / PermissionRequested → status card only
 *       • Connecting                 → status card + spinner
 *       • Connected                  → status card + camera-info card
 *                                     → navigate to Page 2 (Step 3)
 *       • ErrorPcRemote              → status card + BLOCKING PC Remote error card
 *       • ErrorNotSony               → status card (non-intrusive)
 *       • PermissionDenied           → permission-denied card
 *       • ErrorConnectionFailed      → status card (generic error)
 *
 * The PC Remote error card is the single most important guardrail in Step 2.
 * When visible it covers the full body, has red theming, and shows
 * step-by-step instructions to fix the camera menu setting.  The user
 * CANNOT proceed until they unplug, fix the setting, and re-plug.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private var activeDiagnosticJob: Job? = null

    private fun setDiagnosticsEnabled(enabled: Boolean) {
        binding.btnDiagnosticTest.isEnabled = enabled
        binding.btnDiagnosticSdio.isEnabled = enabled
        binding.btnDiagnosticShutter.isEnabled = enabled
    }

    // ── Notification permission (API 33+) ────────────────────────────────────

    private val notifPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Timber.d("POST_NOTIFICATIONS permission: %b", granted)
        // We don't block on this — notification will silently not appear if denied.
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)

        requestNotificationPermissionIfNeeded()

        // ── Task 4: Auto-open guide on first ever launch ──────────────────
        // The guide still shows immediately before the USB wait state is
        // rendered, so the user is oriented before plugging anything in.
        if (!GuidePreferences.hasSeenGuide(this)) {
            GuidePreferences.markSeen(this)
            startActivity(Intent(this, ConnectionGuideActivity::class.java))
        }

        // ── Task 4: "Connection help" button — always reachable ───────────
        binding.btnConnectionHelp.setOnClickListener {
            startActivity(Intent(this, ConnectionGuideActivity::class.java))
        }

        // ── STEP 1: Diagnostic transport test entry point ────────────────
        binding.btnDiagnosticTest.setOnClickListener {
            runPtpTransportDiagnostic()
        }

        // ── STEP 2: Diagnostic SDIO handshake entry point ────────────────
        binding.btnDiagnosticSdio.setOnClickListener {
            runSdioHandshakeDiagnosticUI()
        }

        // ── STEP 3: Shutter fire test entry point ─────────────────────────
        binding.btnDiagnosticShutter.setOnClickListener {
            runShutterDiagnosticUI()
        }

        // Start collecting the connection state flow safely tied to this
        // activity's resumed state so we don't update views while paused.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                UsbConnectionManager.state.collect { state ->
                    renderState(state)
                }
            }
        }

        // Handle the USB_DEVICE_ATTACHED intent that woke this activity.
        handleIntent(intent)
    }

    /** Called when launchMode=singleTop and the activity is already running. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    // ── Intent handling ──────────────────────────────────────────────────────

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
            val device: UsbDevice? = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            Timber.i(
                "USB_DEVICE_ATTACHED received in MainActivity — " +
                "VID=0x%04X PID=0x%04X device=%s",
                device?.vendorId, device?.productId, device?.deviceName
            )
            com.photoceremony.usbimport.sony.UsbEventLogger.log(
                "USB_ATTACH",
                "MainActivity received USB_DEVICE_ATTACHED for VID=0x%04X PID=0x%04X device=%s".format(
                    device?.vendorId, device?.productId, device?.deviceName
                )
            )
            device?.let { startImportService(it) }
        }
    }

    /**
     * Forwards the attached [UsbDevice] to [ImportService].
     * We pass only the device — zero capture-control extras are ever added.
     */
    private fun startImportService(device: UsbDevice) {
        val serviceIntent = Intent(this, ImportService::class.java).apply {
            putExtra(UsbManager.EXTRA_DEVICE, device)
        }
        startForegroundService(serviceIntent)
        Timber.d("ImportService started with device %s", device.deviceName)
    }

    // ── State → UI ────────────────────────────────────────────────────────────

    private fun renderState(state: ConnectionState) {
        Timber.d("Rendering UI for state: %s", state::class.simpleName)

        // Reset all secondary panels to GONE first, then show what's needed.
        binding.cardPcRemoteError.visibility    = View.GONE
        binding.cardCameraInfo.visibility       = View.GONE
        binding.cardPermissionDenied.visibility = View.GONE
        binding.progressConnecting.visibility   = View.GONE
        stopUsbPulse()

        @Suppress("DEPRECATION")
        when (state) {

            is ConnectionState.Idle -> {
                binding.tvStatusTitle.text  = getString(R.string.status_waiting)
                binding.tvStatusDetail.text = getString(R.string.status_detail_waiting)
                startUsbPulse()
            }

            is ConnectionState.PermissionRequested -> {
                binding.tvStatusTitle.text  = getString(R.string.status_permission_requested)
                binding.tvStatusDetail.text = state.device.deviceName ?: ""
                startUsbPulse()
            }

            is ConnectionState.Connecting -> {
                binding.tvStatusTitle.text  = getString(R.string.status_connecting)
                binding.tvStatusDetail.text = getString(R.string.status_connecting_detail)
                binding.progressConnecting.visibility = View.VISIBLE
            }

            is ConnectionState.Connected -> {
                Timber.w("MainActivity: Deprecated Connected state reached (MTP unsupported)")
                binding.tvStatusTitle.text  = getString(R.string.error_pc_remote_title)
                binding.tvStatusDetail.text = ""
                binding.cardPcRemoteError.visibility = View.VISIBLE
            }

            is ConnectionState.RemoteShooting -> {
                binding.tvStatusTitle.text  = "Remote Shooting Active"
                binding.tvStatusDetail.text = state.model
                binding.tvCameraModel.text  = state.model
                binding.tvCameraStorages.text = "PC Remote Mode · Instant Capture"
                binding.cardCameraInfo.visibility = View.VISIBLE

                Timber.i("Remote shooting active — launching Page 2 (ImportLogActivity)")
                startActivity(Intent(this, ImportLogActivity::class.java))
            }

            // ── THE BLOCKING PC REMOTE ERROR ──────────────────────────────────
            //
            // This is the single most important guardrail: the user is shown
            // a full-card error with step-by-step instructions and CANNOT
            // proceed until they fix the camera setting and re-plug.
            is ConnectionState.ErrorPcRemote -> {
                binding.tvStatusTitle.text  = getString(R.string.error_pc_remote_title)
                binding.tvStatusDetail.text = ""
                binding.cardPcRemoteError.visibility = View.VISIBLE
                // Animate in for emphasis
                binding.cardPcRemoteError.alpha = 0f
                binding.cardPcRemoteError.animate()
                    .alpha(1f)
                    .setDuration(300)
                    .start()
            }

            is ConnectionState.ErrorNotSony -> {
                binding.tvStatusTitle.text  = getString(R.string.status_waiting)
                binding.tvStatusDetail.text =
                    "Non-Sony device (VID 0x${state.vendorId.toString(16).uppercase()}) — not supported"
                startUsbPulse()
            }

            is ConnectionState.PermissionDenied -> {
                binding.tvStatusTitle.text  = getString(R.string.error_permission_denied_title)
                binding.tvStatusDetail.text = ""
                binding.cardPermissionDenied.visibility = View.VISIBLE
            }

            is ConnectionState.ErrorConnectionFailed -> {
                // Transient transport error — camera is in the right mode but
                // the SDIO handshake failed (timing race, stale session, etc.).
                // Show a recoverable message; do NOT show the "Wrong USB Mode"
                // red card which implies a camera-menu change is required.
                binding.tvStatusTitle.text  = "Connection Failed — Replug Camera"
                binding.tvStatusDetail.text = state.reason
                startUsbPulse()
            }
        }
    }

    // ── USB icon pulse animation (idle / waiting states) ─────────────────────

    private var pulseAnimator: ObjectAnimator? = null

    private fun startUsbPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = ObjectAnimator.ofFloat(binding.ivUsbIcon, "alpha", 1f, 0.35f).apply {
            duration      = 1000
            repeatCount   = ObjectAnimator.INFINITE
            repeatMode    = ObjectAnimator.REVERSE
            start()
        }
    }

    private fun stopUsbPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        binding.ivUsbIcon.alpha = 1f
    }

    // ── Permissions ───────────────────────────────────────────────────────────

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val perm = Manifest.permission.POST_NOTIFICATIONS
            if (ContextCompat.checkSelfPermission(this, perm)
                != PackageManager.PERMISSION_GRANTED) {
                notifPermissionLauncher.launch(perm)
            }
        }
    }

    // ── Diagnostic dialog helpers ─────────────────────────────────────────────

    /**
     * Shows a diagnostic result dialog with a "Copy Log" button that copies
     * the full [message] text (untruncated) to the clipboard.
     *
     * Applied to all Step 1 / Step 2 / Step 3 diagnostic result dialogs so
     * there is always a one-tap path to extract the full error log.
     *
     * Must be called on the main thread.
     */
    private fun showDiagnosticDialog(title: String, message: String) {
        val fullLog = "$message\n\n════════ FULL USB TIMELINE LOG ════════\n" +
            com.photoceremony.usbimport.sony.UsbEventLogger.dump()
        MaterialAlertDialogBuilder(this)
            .setTitle(title)
            .setMessage(fullLog)
            .setPositiveButton("OK", null)
            .setNeutralButton("Copy Log") { _, _ -> copyToClipboard(fullLog) }
            .show()
    }

    /**
     * Copies [text] to the system clipboard and shows a brief "Copied ✓" toast.
     *
     * The text is NOT truncated — the full diagnostic log is always preserved.
     */
    private fun copyToClipboard(text: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Photo Ceremony Diagnostic Log", text))
        Toast.makeText(this, "Copied ✓", Toast.LENGTH_SHORT).show()
    }

    // ── STEP 1 DIAGNOSTIC ENTRY POINT ─────────────────────────────────────────

    private fun runPtpTransportDiagnostic() {
        val usbManager = getSystemService(Context.USB_SERVICE) as UsbManager
        val device: UsbDevice? = (UsbConnectionManager.state.value as? ConnectionState.RemoteShooting)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.ErrorPcRemote)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.Connecting)?.device
            ?: usbManager.deviceList.values.firstOrNull { DeviceChecker.isSonyDevice(it) }
            ?: usbManager.deviceList.values.firstOrNull()

        if (device == null) {
            MaterialAlertDialogBuilder(this)
                .setTitle("Diagnostic Test: NO DEVICE")
                .setMessage("No USB device detected. Please connect your Sony camera via USB-C.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        if (!usbManager.hasPermission(device)) {
            UsbConnectionManager.handleDeviceAttached(this, device)
            Toast.makeText(this, "USB permission requested. Please tap Allow in system dialog and retry.", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "Running PTP Transport Test (GetDeviceInfo)…", Toast.LENGTH_SHORT).show()

        activeDiagnosticJob?.cancel()
        setDiagnosticsEnabled(false)

        activeDiagnosticJob = lifecycleScope.launch(PtpUsbTransport.usbDispatcher) {
            try {
                PtpUsbTransport.withExclusiveSession {
                    UsbConnectionManager.resetActiveSession()
                    val transport = PtpUsbTransport(device, usbManager)
                    val startTime = System.currentTimeMillis()
                    try {
                        Timber.i("STEP 1 DIAGNOSTIC: Opening raw PtpUsbTransport for %s", device.deviceName)
                        transport.open()

                        val info = transport.executeGetDeviceInfo()
                        val elapsedMs = System.currentTimeMillis() - startTime

                        val has0x9207 = info.operationsSupported.contains(0x9207)
                        val has0xD2C1 = info.devicePropertiesSupported.contains(0xD2C1) || info.operationsSupported.contains(0xD2C1)
                        val has0xD2C2 = info.devicePropertiesSupported.contains(0xD2C2) || info.operationsSupported.contains(0xD2C2)
                        val has0xC201 = info.eventsSupported.contains(0xC201)

                        val report = """
                            STATUS: PASS ✅ (${elapsedMs} ms)

                            PARSED FIELDS:
                            • Manufacturer: ${info.manufacturer}
                            • Model: ${info.model}
                            • Firmware Version: ${info.deviceVersion}
                            • Serial Number: ${info.serialNumber}
                            • PTP Version: ${info.standardVersion / 100.0}
                            • Vendor Extension ID: 0x${info.vendorExtensionId.toString(16).uppercase()}
                            • Vendor Extension Ver: ${info.vendorExtensionVersion / 100.0}

                            CAPABILITIES DECLARED:
                            • Operations (${info.operationsSupported.size}): 0x9207 (ControlDevice)=$has0x9207
                            • Events (${info.eventsSupported.size}): 0xC201 (ObjectAdded)=$has0xC201
                            • Properties (${info.devicePropertiesSupported.size}): 0xD2C1 (AF)=$has0xD2C1, 0xD2C2 (Cap)=$has0xD2C2
                            • Raw Ops: ${info.operationsSupported.map { "0x%04X".format(it) }}
                        """.trimIndent()

                        Timber.i("STEP 1 DIAGNOSTIC SUCCESS:\n%s", report)

                        withContext(Dispatchers.Main) {
                            showDiagnosticDialog("Step 1 Diagnostic: PASS ✅", report)
                        }
                    } catch (e: Exception) {
                        val elapsedMs = System.currentTimeMillis() - startTime
                        Timber.e(e, "STEP 1 DIAGNOSTIC FAILED after %d ms", elapsedMs)

                        val errorReport = """
                            STATUS: FAIL ❌ (${elapsedMs} ms)

                            ERROR DETAILS:
                            • Exception: ${e::class.java.name}
                            • Message: ${e.message ?: "No error message"}

                            SNIPPET:
                            ${e.stackTraceToString().lines().take(6).joinToString("\n")}
                        """.trimIndent()

                        withContext(Dispatchers.Main) {
                            showDiagnosticDialog("Step 1 Diagnostic: FAIL ❌", errorReport)
                        }
                    } finally {
                        try { transport.close() } catch (_: Exception) {}
                    }
                }
            } finally {
                withContext(Dispatchers.Main) {
                    setDiagnosticsEnabled(true)
                }
            }
        }
    }

    // ── STEP 2 DIAGNOSTIC ENTRY POINT ─────────────────────────────────────────

    private fun runSdioHandshakeDiagnosticUI() {
        val usbManager = getSystemService(Context.USB_SERVICE) as UsbManager
        val device: UsbDevice? = (UsbConnectionManager.state.value as? ConnectionState.RemoteShooting)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.ErrorPcRemote)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.Connecting)?.device
            ?: usbManager.deviceList.values.firstOrNull { DeviceChecker.isSonyDevice(it) }
            ?: usbManager.deviceList.values.firstOrNull()

        if (device == null) {
            MaterialAlertDialogBuilder(this)
                .setTitle("Step 2 Test: NO DEVICE")
                .setMessage("No USB device detected. Please connect your Sony camera via USB-C in PC Remote mode.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        if (!usbManager.hasPermission(device)) {
            UsbConnectionManager.handleDeviceAttached(this, device)
            Toast.makeText(this, "USB permission requested. Please tap Allow in system dialog and retry.", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "Running Step 2 SDIO Handshake Test…", Toast.LENGTH_SHORT).show()

        activeDiagnosticJob?.cancel()
        setDiagnosticsEnabled(false)

        activeDiagnosticJob = lifecycleScope.launch(PtpUsbTransport.usbDispatcher) {
            try {
                PtpUsbTransport.withExclusiveSession {
                    UsbConnectionManager.resetActiveSession()
                    val session = SonyRemoteSession(device, usbManager)
                    val startTime = System.currentTimeMillis()
                    try {
                        Timber.i("STEP 2 DIAGNOSTIC: Starting SDIO_Connect handshake for %s", device.deviceName)
                        val report = session.runSdioHandshakeDiagnostic()
                        val elapsedMs = System.currentTimeMillis() - startTime

                        val sb = StringBuilder()
                        sb.append("OVERALL: ").append(if (report.overallPass) "PASS ✅" else "FAIL ❌")
                            .append(" (").append(elapsedMs).append(" ms)\n\n")

                        sb.append("STAGE BREAKDOWN:\n")
                        report.stageResults.forEach { stage ->
                            val icon = if (stage.isSuccess) "✅" else "❌"
                            sb.append(icon).append(" ").append(stage.stageName).append(" -> ").append(stage.responseCodeHex).append("\n")
                            if (stage.details.isNotBlank()) {
                                sb.append("   ").append(stage.details.replace("\n", "\n   ")).append("\n")
                            }
                            if (stage.errorMessage != null) {
                                sb.append("   ERROR: ").append(stage.errorMessage).append("\n")
                            }
                        }

                        val finalReportStr = sb.toString()
                        Timber.i("STEP 2 DIAGNOSTIC REPORT:\n%s", finalReportStr)

                        withContext(Dispatchers.Main) {
                            showDiagnosticDialog(
                                if (report.overallPass) "Step 2 SDIO: PASS ✅" else "Step 2 SDIO: FAIL ❌",
                                finalReportStr
                            )
                        }
                    } catch (e: Exception) {
                        val elapsedMs = System.currentTimeMillis() - startTime
                        Timber.e(e, "STEP 2 DIAGNOSTIC UNHANDLED EXCEPTION after %d ms", elapsedMs)

                        val errStr = "STATUS: UNHANDLED EXCEPTION ❌ (${elapsedMs} ms)\n\n" +
                                "Exception: ${e::class.java.name}\n" +
                                "Message: ${e.message ?: "No error message"}\n\n" +
                                e.stackTraceToString().lines().take(6).joinToString("\n")

                        withContext(Dispatchers.Main) {
                            showDiagnosticDialog("Step 2 SDIO: CRASH/FAIL ❌", errStr)
                        }
                    }
                }
            } finally {
                withContext(Dispatchers.Main) {
                    setDiagnosticsEnabled(true)
                }
            }
        }
    }

    // ── STEP 3 DIAGNOSTIC ENTRY POINT ─────────────────────────────────────────

    private fun runShutterDiagnosticUI() {
        val usbManager = getSystemService(Context.USB_SERVICE) as UsbManager
        val device: UsbDevice? = (UsbConnectionManager.state.value as? ConnectionState.RemoteShooting)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.ErrorPcRemote)?.device
            ?: (UsbConnectionManager.state.value as? ConnectionState.Connecting)?.device
            ?: usbManager.deviceList.values.firstOrNull { DeviceChecker.isSonyDevice(it) }
            ?: usbManager.deviceList.values.firstOrNull()

        if (device == null) {
            MaterialAlertDialogBuilder(this)
                .setTitle("Step 3 Test: NO DEVICE")
                .setMessage("No USB device detected. Connect your Sony camera via USB-C in PC Remote mode.")
                .setPositiveButton("OK", null)
                .show()
            return
        }

        if (!usbManager.hasPermission(device)) {
            UsbConnectionManager.handleDeviceAttached(this, device)
            Toast.makeText(this, "USB permission requested — tap Allow, then retry.", Toast.LENGTH_LONG).show()
            return
        }

        // Warn user to watch the camera physically before firing
        MaterialAlertDialogBuilder(this)
            .setTitle("Step 3: Watch Your Camera 📷")
            .setMessage(
                "The test will:\n" +
                "  1. Run the full SDIO handshake\n" +
                "  2. Half-press AutoFocus (0xD2C1=1)\n" +
                "  3. Wait 300 ms\n" +
                "  4. Fire Capture / full-press (0xD2C2=1)\n" +
                "  5. Release all controls\n\n" +
                "👁  Watch the camera shutter physically — does it fire?\n\n" +
                "Tap FIRE when ready."
            )
            .setPositiveButton("FIRE ▶") { _, _ ->
                Toast.makeText(this, "Firing shutter test…", Toast.LENGTH_SHORT).show()
                activeDiagnosticJob?.cancel()
                setDiagnosticsEnabled(false)

                activeDiagnosticJob = lifecycleScope.launch(PtpUsbTransport.usbDispatcher) {
                    try {
                        PtpUsbTransport.withExclusiveSession {
                            UsbConnectionManager.resetActiveSession()
                            val session = SonyRemoteSession(device, usbManager)
                            val startTime = System.currentTimeMillis()
                            val report = try {
                                session.runShutterDiagnostic()
                            } catch (e: Exception) {
                                // runShutterDiagnostic catches internally; this is a safety net
                                Timber.e(e, "STEP 3 DIAGNOSTIC outer exception")
                                SonyRemoteSession.ShutterDiagnosticReport(
                                    baseModel = "Unknown",
                                    stepResults = listOf(
                                        SonyRemoteSession.ShutterStepResult(
                                            stepName = "Unhandled outer exception",
                                            isSuccess = false,
                                            detail = e.message ?: "No message",
                                            errorMessage = e.message
                                        )
                                    ),
                                    overallPass = false
                                )
                            }
                            val elapsedMs = System.currentTimeMillis() - startTime

                            val sb = StringBuilder()
                            sb.append("Camera: ").append(report.baseModel).append("\n")
                            sb.append("OVERALL: ").append(if (report.overallPass) "PASS ✅" else "FAIL ❌")
                                .append(" (").append(elapsedMs).append(" ms)\n")
                            sb.append("\nSTEP BREAKDOWN:\n")
                            report.stepResults.forEach { step ->
                                val icon = if (step.isSuccess) "✅" else "❌"
                                sb.append(icon).append(" ").append(step.stepName).append("\n")
                                sb.append("   ").append(step.detail).append("\n")
                                if (step.errorMessage != null) sb.append("   ERROR: ").append(step.errorMessage).append("\n")
                            }
                            val reportStr = sb.toString()
                            val fullLog = "$reportStr\n\n════════ FULL USB TIMELINE LOG ════════\n" +
                                com.photoceremony.usbimport.sony.UsbEventLogger.dump()

                            withContext(Dispatchers.Main) {
                                MaterialAlertDialogBuilder(this@MainActivity)
                                    .setTitle(if (report.overallPass) "Step 3 Shutter: PROTOCOL PASS ✅" else "Step 3 Shutter: FAIL ❌")
                                    .setMessage(fullLog)
                                    .setNeutralButton("Copy Log") { _, _ -> copyToClipboard(fullLog) }
                                    .setPositiveButton("Shutter FIRED ✅", null)
                                    .setNegativeButton("Shutter DID NOT fire ❌", null)
                                    .show()
                            }
                        }
                    } finally {
                        withContext(Dispatchers.Main) {
                            setDiagnosticsEnabled(true)
                        }
                    }
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
