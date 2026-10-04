package com.photoceremony.usbimport.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.widget.ImageView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.photoceremony.usbimport.R
import com.photoceremony.usbimport.databinding.ActivityImportLogBinding
import com.photoceremony.usbimport.model.ImportEvent
import com.photoceremony.usbimport.model.ImportRecord
import com.photoceremony.usbimport.model.ImportUiState
import com.photoceremony.usbimport.ptp.ConnectionState
import com.photoceremony.usbimport.legacy_mtp.ImportSession
import com.photoceremony.usbimport.ptp.UsbConnectionManager
import com.photoceremony.usbimport.sony.UsbEventLogger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Page 2 — Live Import Log.
 *
 * Implements Step 6 Graceful busy/backoff UI state machine:
 *  - "Connected — watching for photos" (default connected state)
 *  - "Importing..." (active file transfer)
 *  - "Camera busy (burst in progress)" (triggered when 2+ consecutive polls fail;
 *                                       calm amber presentation, NOT an error)
 *  - "Camera disconnected" (on ACTION_USB_DEVICE_DETACHED or MTP disconnect)
 *
 * Data sources:
 *  - [ImportSession.records] — accumulated list of completed imports (StateFlow)
 *  - [ImportSession.events]  — live events for status machine & log (SharedFlow)
 *  - [UsbConnectionManager.state] — detect disconnect → transition UI & finish()
 */
class ImportLogActivity : AppCompatActivity() {

    private lateinit var binding: ActivityImportLogBinding
    private val adapter = ImportLogAdapter(
        onPhotoClick = { record -> openPhoto(record) }
    )

    /** Counter for consecutive busy poll cycles. Busy state triggers only when >= 2. */
    private var consecutiveBusyPolls = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityImportLogBinding.inflate(layoutInflater)
        setContentView(binding.root)
        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(false)  // no back — camera is live

        binding.rvImportLog.adapter = adapter

        // Tap banner to view live USB logs at any time
        binding.cardStatusBanner.setOnClickListener {
            showUsbLogDialog()
        }

        // Open latest imported photo
        binding.btnOpenLatest.setOnClickListener {
            val latest = ImportSession.records.value.firstOrNull()
            if (latest != null) {
                openPhoto(latest)
            } else {
                Toast.makeText(this, "No photos imported yet", Toast.LENGTH_SHORT).show()
            }
        }

        // Set initial UI state
        renderUiState(ImportUiState.Watching)

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {

                // ── Collected records → RecyclerView ─────────────────────────
                launch {
                    ImportSession.records.collect { records ->
                        adapter.submitList(records)
                        binding.tvImportCount.text =
                            resources.getQuantityString(
                                R.plurals.import_count,
                                records.size,
                                records.size
                            )
                        binding.btnOpenLatest.visibility = if (records.isNotEmpty()) View.VISIBLE else View.GONE
                        // Scroll to top (newest) whenever a new item is prepended.
                        if (records.isNotEmpty()) {
                            binding.rvImportLog.scrollToPosition(0)
                        }
                    }
                }

                // ── Live events → status banner & row ─────────────────────────
                launch {
                    ImportSession.events.collect { event ->
                        processImportEvent(event)
                    }
                }

                // ── Connection state → auto-finish on disconnect ──────────────
                launch {
                    UsbConnectionManager.state.collect { state ->
                        when (state) {
                            is ConnectionState.RemoteShooting -> {
                                renderUiState(ImportUiState.RemoteShooting(state.model))
                            }
                            is ConnectionState.Idle,
                            is ConnectionState.ErrorPcRemote,
                            is ConnectionState.ErrorConnectionFailed -> {
                                Timber.i("ImportLogActivity: camera disconnected state observed")
                                renderUiState(ImportUiState.Disconnected)
                                delay(1200)
                                finish()
                            }
                            else -> { /* Connected / Connecting / Permission states */ }
                        }
                    }
                }
            }
        }
    }

    // ── Process Events ────────────────────────────────────────────────────────

    private fun processImportEvent(event: ImportEvent) {
        updateLastEventText(event)

        when (event) {
            is ImportEvent.PollStarted -> {
                // If a clean poll started, reset consecutive busy count
                if (consecutiveBusyPolls > 0) {
                    consecutiveBusyPolls = 0
                    renderUiState(ImportUiState.Watching)
                }
            }

            is ImportEvent.PollBusy, is ImportEvent.MidWriteSkipped -> {
                consecutiveBusyPolls++
                Timber.d("Consecutive busy poll count: %d", consecutiveBusyPolls)
                if (consecutiveBusyPolls >= 2) {
                    renderUiState(ImportUiState.CameraBusy)
                }
            }

            is ImportEvent.ImportStarted -> {
                consecutiveBusyPolls = 0
                val hex = "0x%08X".format(event.handle.toLong() and 0xFFFFFFFFL)
                renderUiState(ImportUiState.Importing(hex, "Downloading..."))
            }

            is ImportEvent.ImportCompleted -> {
                consecutiveBusyPolls = 0
                val currentConnState = UsbConnectionManager.state.value
                val model = (currentConnState as? ConnectionState.RemoteShooting)?.model ?: "Camera"

                val accentColor = ContextCompat.getColor(this, R.color.status_watching_accent)
                val surfaceColor = ContextCompat.getColor(this, R.color.status_watching_surface)
                binding.cardStatusBanner.setCardBackgroundColor(surfaceColor)
                binding.cardStatusBanner.strokeColor = accentColor
                binding.tvStatusTitle.text = "Saved ${event.record.filename}"
                binding.tvStatusSubtitle.text = "Ready (${event.record.formattedSize})"
                binding.progressStatus.visibility = View.GONE

                lifecycleScope.launch {
                    delay(2500)
                    if (UsbConnectionManager.state.value is ConnectionState.RemoteShooting) {
                        renderUiState(ImportUiState.RemoteShooting(model))
                    }
                }
            }

            is ImportEvent.ImportFailed -> {
                binding.progressStatus.visibility = View.GONE
                val currentConnState = UsbConnectionManager.state.value
                val model = (currentConnState as? ConnectionState.RemoteShooting)?.model ?: "Camera"
                lifecycleScope.launch {
                    delay(2000)
                    if (UsbConnectionManager.state.value is ConnectionState.RemoteShooting) {
                        renderUiState(ImportUiState.RemoteShooting(model))
                    }
                }
            }

            is ImportEvent.SessionStopped -> {
                renderUiState(ImportUiState.Disconnected)
            }

            else -> { /* HandleQueued */ }
        }
    }

    // ── Render UI Banner State ────────────────────────────────────────────────

    private fun renderUiState(state: ImportUiState) {
        val accentColorRes: Int
        val surfaceColorRes: Int
        val titleText: String
        val subtitleText: String
        val showProgress: Boolean

        when (state) {
            is ImportUiState.Watching -> {
                accentColorRes = R.color.status_watching_accent
                surfaceColorRes = R.color.status_watching_surface
                titleText = "Connected — watching for photos"
                subtitleText = "Ready for incoming shots over USB"
                showProgress = true
            }

            is ImportUiState.Importing -> {
                accentColorRes = R.color.status_importing_accent
                surfaceColorRes = R.color.status_importing_surface
                titleText = "Importing ${state.filename}..."
                subtitleText = "Saving to device storage (${state.formattedSize})"
                showProgress = true
            }

            is ImportUiState.CameraBusy -> {
                accentColorRes = R.color.status_busy_accent
                surfaceColorRes = R.color.status_busy_surface
                titleText = "Camera busy (burst in progress)"
                subtitleText = "Waiting for camera buffer to clear — non-blocking"
                showProgress = true
            }

            is ImportUiState.RemoteShooting -> {
                accentColorRes = R.color.status_remote_accent
                surfaceColorRes = R.color.status_remote_surface
                titleText = "Remote Shooting Active — ${state.model}"
                subtitleText = "Instant capture armed over USB"
                showProgress = false
            }

            is ImportUiState.Disconnected -> {
                accentColorRes = R.color.status_disconnected_accent
                surfaceColorRes = R.color.status_disconnected_surface
                titleText = "Camera disconnected"
                subtitleText = "USB session ended — returning home"
                showProgress = false
            }
        }

        val accentColor = ContextCompat.getColor(this, accentColorRes)
        val surfaceColor = ContextCompat.getColor(this, surfaceColorRes)

        binding.cardStatusBanner.setCardBackgroundColor(surfaceColor)
        binding.cardStatusBanner.strokeColor = accentColor

        binding.tvStatusTitle.text = titleText
        binding.tvStatusSubtitle.text = subtitleText

        binding.progressStatus.indeterminateTintList = ColorStateList.valueOf(accentColor)
        binding.progressStatus.visibility = if (showProgress) View.VISIBLE else View.GONE
    }

    // ── Status row text ───────────────────────────────────────────────────────

    private fun updateLastEventText(event: ImportEvent) {
        val (icon, text) = when (event) {
            is ImportEvent.PollStarted     ->
                "🔄" to "Polling camera (cycle ${event.cycleNumber})…"
            is ImportEvent.PollBusy        ->
                "⏳" to "Camera busy this cycle — will retry"
            is ImportEvent.HandleQueued    -> {
                val hex = "0x%08X".format(event.handle.toLong() and 0xFFFFFFFFL)
                "📥" to "New file queued: handle $hex"
            }
            is ImportEvent.ImportStarted   -> {
                val hex = "0x%08X".format(event.handle.toLong() and 0xFFFFFFFFL)
                "⬇️" to "Downloading handle $hex…"
            }
            is ImportEvent.ImportCompleted ->
                "✅" to "Saved: ${event.record.filename} (${event.record.formattedSize})"
            is ImportEvent.ImportFailed    -> {
                val hex = "0x%08X".format(event.handle.toLong() and 0xFFFFFFFFL)
                "⚠️" to "Skipped handle $hex: ${event.reason}"
            }
            is ImportEvent.MidWriteSkipped -> {
                val hex = "0x%08X".format(event.handle.toLong() and 0xFFFFFFFFL)
                "✍️" to "Camera writing handle $hex — retrying next cycle"
            }
            is ImportEvent.SessionStopped  ->
                "🔌" to "Session ended"
        }
        binding.tvLastEvent.text = "$icon $text"
        binding.tvLastEvent.visibility = View.VISIBLE
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, 1, 0, "View USB Logs").setShowAsAction(MenuItem.SHOW_AS_ACTION_ALWAYS)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == 1) {
            showUsbLogDialog()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun showUsbLogDialog() {
        val log = UsbEventLogger.dump().ifBlank { "No USB events recorded yet." }
        MaterialAlertDialogBuilder(this)
            .setTitle("Live USB Event Log")
            .setMessage(log)
            .setNeutralButton("Copy Log") { _, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                clipboard.setPrimaryClip(ClipData.newPlainText("USB Event Log", log))
                Toast.makeText(this, "Log copied to clipboard", Toast.LENGTH_SHORT).show()
            }
            .setPositiveButton("Close", null)
            .show()
    }

    /**
     * Opens the imported photo in the user's preferred viewer / gallery app,
     * or displays the in-app preview dialog if no viewer is configured.
     */
    private fun openPhoto(record: ImportRecord) {
        val uri = record.mediaUri
        if (uri == null) {
            Toast.makeText(this, "Photo path not found for ${record.filename}", Toast.LENGTH_SHORT).show()
            return
        }

        Timber.i("Opening photo: %s (uri=%s, mime=%s)", record.filename, uri, record.mimeType)
        UsbEventLogger.log("OPEN_PHOTO", "Opening ${record.filename} (uri=$uri)")
        Toast.makeText(this, "Opening ${record.filename}\nSaved in DCIM/entephoto/", Toast.LENGTH_SHORT).show()

        val viewIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, if (record.mimeType.isNotBlank()) record.mimeType else "image/jpeg")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }

        try {
            startActivity(Intent.createChooser(viewIntent, "Open ${record.filename}"))
        } catch (e: Exception) {
            Timber.w(e, "No default handler for ACTION_VIEW — showing preview dialog")
            showPhotoPreviewDialog(record)
        }
    }

    /**
     * Displays a built-in preview dialog with the image, local file path, and sharing options.
     */
    private fun showPhotoPreviewDialog(record: ImportRecord) {
        val uri = record.mediaUri ?: return
        val imageView = ImageView(this).apply {
            adjustViewBounds = true
            maxHeight = (resources.displayMetrics.heightPixels * 0.55).toInt()
            setPadding(16, 16, 16, 16)
        }

        try {
            contentResolver.openInputStream(uri)?.use { stream ->
                val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                val bmp = BitmapFactory.decodeStream(stream, null, opts)
                imageView.setImageBitmap(bmp)
            }
        } catch (e: Exception) {
            Timber.w(e, "Cannot load preview bitmap for %s", record.filename)
            imageView.setImageResource(R.drawable.ic_image)
        }

        MaterialAlertDialogBuilder(this)
            .setTitle(record.filename)
            .setMessage("Local Storage: DCIM/entephoto/${record.filename}\nSize: ${record.formattedSize}")
            .setView(imageView)
            .setPositiveButton("Open with...") { _, _ ->
                val intent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, if (record.mimeType.isNotBlank()) record.mimeType else "image/jpeg")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                try {
                    startActivity(Intent.createChooser(intent, "Open with"))
                } catch (ex: Exception) {
                    Toast.makeText(this, "No app available to open this format", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Share") { _, _ ->
                val shareIntent = Intent(Intent.ACTION_SEND).apply {
                    type = if (record.mimeType.isNotBlank()) record.mimeType else "image/jpeg"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(shareIntent, "Share Photo"))
            }
            .setNegativeButton("Close", null)
            .show()
    }
}
