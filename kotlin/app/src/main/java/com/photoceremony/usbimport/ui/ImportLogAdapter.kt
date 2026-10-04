package com.photoceremony.usbimport.ui

import android.text.format.DateFormat
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.photoceremony.usbimport.databinding.ItemImportLogBinding
import com.photoceremony.usbimport.model.ImportRecord
import java.util.Date

/**
 * RecyclerView adapter for the Page 2 import log.
 *
 * Uses [ListAdapter] with [DiffUtil] so only changed items are re-bound,
 * keeping the list smooth even at high import rates.
 */
class ImportLogAdapter(
    private val onPhotoClick: (ImportRecord) -> Unit = {}
) : ListAdapter<ImportRecord, ImportLogAdapter.ViewHolder>(DIFF) {

    // ── ViewHolder ────────────────────────────────────────────────────────────

    inner class ViewHolder(
        private val binding: ItemImportLogBinding
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(record: ImportRecord) {
            binding.tvFilename.text = record.filename
            binding.tvSize.text     = record.formattedSize
            binding.tvMimeType.text = mimeLabel(record.mimeType)
            binding.tvTime.text     = DateFormat.format("HH:mm:ss", Date(record.importedAtMs))

            binding.root.setOnClickListener { onPhotoClick(record) }
            binding.btnOpenItem.setOnClickListener { onPhotoClick(record) }

            // Colour-code the MIME badge
            val badgeColor = when {
                record.mimeType == "image/jpeg"        -> 0xFF4D8EFF.toInt()   // blue  — JPEG
                record.mimeType.contains("arw")        -> 0xFFFF9C27.toInt()   // amber — RAW
                record.mimeType.startsWith("video/")   -> 0xFF9C27B0.toInt()   // purple — video
                else                                   -> 0xFF9899A6.toInt()   // grey
            }
            binding.tvMimeType.setBackgroundColor(badgeColor)
        }

        private fun mimeLabel(mime: String) = when (mime) {
            "image/jpeg"        -> "JPG"
            "image/tiff"        -> "TIFF"
            "image/x-sony-arw"  -> "ARW"
            "video/mp4"         -> "MP4"
            "video/quicktime"   -> "MOV"
            else                -> "FILE"
        }
    }

    // ── Adapter overrides ─────────────────────────────────────────────────────

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemImportLogBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }

    // ── DiffUtil ──────────────────────────────────────────────────────────────

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<ImportRecord>() {
            override fun areItemsTheSame(old: ImportRecord, new: ImportRecord) =
                old.handle == new.handle

            override fun areContentsTheSame(old: ImportRecord, new: ImportRecord) =
                old == new
        }
    }
}
