package com.photoceremony.usbimport.model

/**
 * State representing the overall Page 2 UI banner condition.
 *
 * Designed to present a calm, informative interface to photographers:
 *  - [Watching]: Camera is connected and idle, polling for new photos.
 *  - [Importing]: Currently actively transferring a file.
 *  - [CameraBusy]: Camera's internal buffer/card is busy (e.g. burst shooting).
 *                 Triggered only when 2+ consecutive poll cycles encounter camera busy,
 *                 making sure transient brief delays don't cause UI flicker.
 *  - [RemoteShooting]: Camera is in PC Remote mode; instant capture is armed.
 *  - [Disconnected]: USB cable detached or MTP session closed.
 */
sealed class ImportUiState {
    object Watching : ImportUiState()

    data class Importing(
        val filename: String,
        val formattedSize: String
    ) : ImportUiState()

    object CameraBusy : ImportUiState()

    /**
     * Camera is in PC Remote mode and the Sony SDIO handshake succeeded.
     *
     * Distinct from [Watching] (MTP passive polling) because in this state
     * the app controls the shutter rather than waiting for the user to shoot.
     *
     * @param model Camera model string (e.g. "ILCE-7M4") for display.
     */
    data class RemoteShooting(val model: String) : ImportUiState()

    object Disconnected : ImportUiState()
}
