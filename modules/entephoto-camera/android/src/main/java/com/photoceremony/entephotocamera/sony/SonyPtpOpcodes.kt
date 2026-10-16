package com.photoceremony.entephotocamera.sony

/**
 * Sony PTP Remote-Control Extension opcodes, device property codes (DPC),
 * and event codes used during PC Remote mode operation.
 */
object SonyPtpOpcodes {

    // ── Connection & Handshake Opcodes (0x92xx) ───────────────────────────────

    const val SDIO_CONNECT = 0x9201
    const val SDIO_GET_EXT_DEVICE_INFO = 0x9202
    const val SDIO_GET_DEVICE_PROP_DESC = 0x9203
    const val SDIO_GET_DEVICE_PROP_VALUE = 0x9204
    const val SDIO_SET_EXT_DEVICE_PROP_VALUE = 0x9205
    const val SDIO_GET_CONTROL_DEVICE_DESC = 0x9206
    const val SDIO_CONTROL_DEVICE = 0x9207
    const val SDIO_GET_ALL_EXT_DEVICE_PROP_INFO = 0x9209

    // ── Sony Device Property Codes (DPC) (0xD2xx) ─────────────────────────────

    const val DPC_AUTOFOCUS = 0xD2C1
    const val DPC_CAPTURE = 0xD2C2
    const val DPC_AEL_BUTTON = 0xD2C3
    const val DPC_PRIORITY_MODE = 0xD2D1

    // ── Sony Event Codes (0xC2xx) ─────────────────────────────────────────────

    const val EVENT_OBJECT_ADDED = 0xC201
    const val EVENT_OBJECT_DELETED = 0xC202
    const val EVENT_PROPERTY_CHANGED = 0xC203
    const val EVENT_DEVICE_INFO_CHANGED = 0xC204
    /**
     * Sony capture event signaled by camera DSP (shutter fired / capture initiated or complete).
     * Does NOT carry an object handle (param1 is 0 or status code).
     * Object download must only be initiated when EVENT_OBJECT_ADDED (0xC201) is received.
     */
    const val EVENT_CAPTURED = 0xC206

    // ── Standard PTP Event Codes ──────────────────────────────────────────────
    const val PTP_EC_OBJECT_ADDED = 0x4002

    // ── Standard PTP Opcodes ──────────────────────────────────────────────────

    const val PTP_OC_GET_STORAGE_IDS = 0x1004
    const val PTP_OC_GET_OBJECT_HANDLES = 0x1007
    const val PTP_OC_GET_OBJECT_INFO = 0x1008
    const val PTP_OC_GET_OBJECT = 0x1009
}
