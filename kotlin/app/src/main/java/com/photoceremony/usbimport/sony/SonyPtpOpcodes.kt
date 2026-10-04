package com.photoceremony.usbimport.sony

/**
 * Sony PTP Remote-Control Extension opcodes, device property codes (DPC),
 * and event codes used during PC Remote mode operation.
 *
 * Source: libgphoto2 (camlibs/ptp2/ptp.h) & Sony Camera Remote API reverse-engineering.
 */
object SonyPtpOpcodes {

    // ── Connection & Handshake Opcodes (0x92xx) ───────────────────────────────

    /**
     * 3-stage SDIO handshake opcode.
     * Params: (Phase 1/2/3, 0, 0)
     */
    const val SDIO_CONNECT = 0x9201

    /**
     * Queries extended device info and vendor property/operation/event codes.
     * Param1: 0xC8 (version query parameter)
     */
    const val SDIO_GET_EXT_DEVICE_INFO = 0x9202

    /** Read descriptor for a single Sony device property. */
    const val SDIO_GET_DEVICE_PROP_DESC = 0x9203

    /** Read current value of a Sony device property. */
    const val SDIO_GET_DEVICE_PROP_VALUE = 0x9204

    /**
     * Write persistent setting property (Type A).
     * Param1: property code
     */
    const val SDIO_SET_EXT_DEVICE_PROP_VALUE = 0x9205

    /** Read control descriptor (Type B transient properties). */
    const val SDIO_GET_CONTROL_DEVICE_DESC = 0x9206

    /**
     * Write transient control property (Type B).
     * Used for shutter release (0xD2C2) and AutoFocus (0xD2C1).
     * Param1: property code
     */
    const val SDIO_CONTROL_DEVICE = 0x9207

    /** Bulk property snapshot query (~4 KiB payload). */
    const val SDIO_GET_ALL_EXT_DEVICE_PROP_INFO = 0x9209

    // ── Sony Device Property Codes (DPC) (0xD2xx) ─────────────────────────────

    /**
     * AutoFocus simulation (S1 half-press).
     * Written via [SDIO_CONTROL_DEVICE] (0x9207) with INT8 payload:
     *   0x01 = Press AF (half-press)
     *   0x00 = Release AF
     */
    const val DPC_AUTOFOCUS = 0xD2C1

    /**
     * Capture / Shutter Release (S2 full-press).
     * Written via [SDIO_CONTROL_DEVICE] (0x9207) with INT8 payload:
     *   0x01 = Press shutter (fire)
     *   0x00 = Release shutter
     */
    const val DPC_CAPTURE = 0xD2C2

    /** AE Lock control. */
    const val DPC_AEL_BUTTON = 0xD2C3

    /** Priority Mode — set to 1 (application priority) after SDIO_Connect Phase 3. */
    const val DPC_PRIORITY_MODE = 0xD2D1

    // ── Sony Event Codes (0xC2xx) ─────────────────────────────────────────────

    /**
     * Shot captured and processed — file ready for download.
     * Param1: PTP objectHandle of the captured image.
     */
    const val EVENT_OBJECT_ADDED = 0xC201

    /** File deleted on camera. */
    const val EVENT_OBJECT_DELETED = 0xC202

    /** Camera property changed (e.g. ISO/Aperture updated). */
    const val EVENT_PROPERTY_CHANGED = 0xC203

    /** Camera status/device info changed. */
    const val EVENT_DEVICE_INFO_CHANGED = 0xC204

    // ── Standard PTP Opcodes (used for Object download) ──────────────────────

    const val PTP_OC_GET_STORAGE_IDS = 0x1004
    const val PTP_OC_GET_OBJECT_HANDLES = 0x1007
    const val PTP_OC_GET_OBJECT_INFO = 0x1008
    const val PTP_OC_GET_OBJECT = 0x1009
}
