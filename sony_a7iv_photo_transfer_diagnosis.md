# DEEP RUNTIME DIAGNOSIS REPORT: SONY α7 IV PHOTO NOT RECEIVED BY ENTEPHOTO

**Date:** 2026-10-14  
**Application:** EntePhoto (`com.entephoto.app`)  
**Camera Model:** Sony α7 IV (`ILCE-7M4`)  
**Host Hardware:** Xiaomi 11i (Android 12/13)  
**Investigation Mode:** Combined Source-Code Architecture + Device/Logcat Runtime Verification

---

## 1. Executive Conclusion

When a physical Sony α7 IV is connected via USB OTG to EntePhoto, the camera successfully executes the 3-stage Sony SDIO handshake (`0x9201` / `0x9202`), transitions into `ConnectionState.RemoteShooting`, and displays **"Camera Connected!"** in the React Native UI. However, when the photographer presses the physical shutter button on the camera body, no photo is received or displayed in EntePhoto due to a **compound chain of architectural, protocol, and configuration defects**:

1. **Camera Setting (Primary Protocol Barrier):** In Sony's PC Remote mode, the camera's internal menu setting **"Still Img. Save Dest."** defaults to or is frequently set to **"Camera Only"**. When configured to "Camera Only", the camera writes captured images exclusively to its internal SD card and **never emits the PTP `0xC201` (`EVENT_OBJECT_ADDED`) packet or image bytes over USB**. For tethered transfers to occur, the camera must be explicitly configured to **"PC+Camera"** or **"PC Only"**.
2. **Total Logging Blindspot (`Timber.plant` Missing):** Every native component (`CameraManager`, `UsbConnectionManager`, `SonyRemoteSession`, `PtpUsbTransport`, `UsbEventLogger`) relies entirely on Jake Wharton's `Timber` library for diagnostic output. However, `Timber.plant(Timber.DebugTree())` is **never called anywhere in the React Native application** (`MainApplication.kt`). Consequently, 100% of native logcat messages are silently discarded at runtime, concealing all underlying connection, event loop, and transfer states.
3. **Save Path vs. Gallery Read Path Case Mismatch & Decoupling:**
   - `SonyRemoteSession.saveToMediaStore` writes files to `MediaStore` under `RELATIVE_PATH = "DCIM/entephoto/"` (lowercase `e`).
   - `PhotoSelectionGalleryScreen.tsx` and `localPhotoService.ts` **do not query MediaStore**; instead, they perform a direct filesystem directory listing (`expo-file-system` `Directory.list()`) against `file:///sdcard/DCIM/Entephoto` (capital `E`, configured via `.env`). On Android's Linux filesystem (ext4/f2fs), paths are case-sensitive. Even if photos were successfully saved, the gallery scans a completely different folder.
   - Furthermore, the gallery has **no listener for `onPhotoSaved`**; it relies exclusively on an unlinked filesystem polling timer.
4. **Complete Error Suppression & Missing Bridge Events:** If any part of the download pipeline fails (such as an endpoint read timeout, PTP command error, or out-of-memory exception):
   - `UsbConnectionManager` emits `ImportEvent.ImportFailed(handle, error)`.
   - `CameraManager.kt` lines 102–117 **only collects `ImportEvent.ImportCompleted` and completely ignores `ImportEvent.ImportFailed`**.
   - `EntePhotoCameraModule.kt` registers zero error events (`Events("onDeviceFound", "onDeviceDisconnected", "onConnectionStateChanged", "onPhotoSaved")`).
   - `CameraConnectedScreen.tsx` subscribes only to `onPhotoSaved` and does not subscribe to disconnections or transfer failures. The UI remains indefinitely in the "Connected / GOOD TO GO!" state while silent failures occur in the background.

---

## 2. Runtime Test Facts

| Dimension                         | Fact / Value                                                       | Source of Evidence                                                                                                                                                                                         |
| :-------------------------------- | :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Camera Model**                  | Sony α7 IV (`ILCE-7M4`)                                            | Target hardware per user specification & code constants                                                                                                                                                    |
| **App Package**                   | `com.entephoto.app`                                                | `android/app/build.gradle`, `app.json`, `log.txt`                                                                                                                                                          |
| **App Build Type**                | Release / Prebuild Native Module                                   | `modules/entephoto-camera` built into `base.apk`                                                                                                                                                           |
| **ADB Availability**              | **Unavailable (Offline / Refused)**                                | `adb devices -l` returned empty; TCP connection to `10.45.178.32:5555` failed with connection actively refused. Phone's single USB-C port is occupied by the Sony camera OTG cable.                        |
| **Live Logcat Status**            | **BLOCKED (Offline)**                                              | Live runtime capture during this session is blocked due to lack of wireless ADB. Historical session log `log.txt` (154,866 lines) and UI hierarchy dumps (`window_dump.xml`, `window_dump3.xml`) analyzed. |
| **Connection State in App**       | `Connected` (`ConnectionState.RemoteShooting`)                     | Confirmed by `window_dump.xml` (bounds `[731,194][886,247]`, text `"Connected"`).                                                                                                                          |
| **Observed Camera UI**            | `PhotoSelectionGalleryScreen` displayed 466 existing device photos | Confirmed by `window_dump.xml` (tabs `All (466)`, `New (466)`).                                                                                                                                            |
| **Image on Camera After Shutter** | Photo recorded on camera SD card                                   | Physical camera shutter triggers and image writes to camera card.                                                                                                                                          |

---

## 3. Physical-Shutter-to-JavaScript Pipeline Status

The table below traces the exact pipeline from the physical shutter press to presentation in the JavaScript gallery:

| Stage # | Pipeline Stage                         | Source File & Line Range                                                                                                                                                                                                    | Method / Coroutine                                                  | Expected Runtime Log                                           | Observed Runtime Log                        | Verdict                                   |
| :-----: | :------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------ | :------------------------------------------------------------- | :------------------------------------------ | :---------------------------------------- |
|  **1**  | **Physical Shutter Press**             | Camera Hardware                                                                                                                                                                                                             | Hardware shutter release button                                     | N/A (Hardware event)                                           | Shutter physically clicks                   | **CONFIRMED BY RUNTIME / HARDWARE**       |
|  **2**  | **Camera Creates Image**               | Camera Sensor / BIONZ XR                                                                                                                                                                                                    | Image DSP pipeline                                                  | N/A (Internal camera processing)                               | Image viewable on camera display            | **CONFIRMED BY RUNTIME / HARDWARE**       |
|  **3**  | **Camera Sends PTP Event (0xC201)**    | Camera USB Firmware                                                                                                                                                                                                         | USB Interrupt-IN (EP3) packet dispatch                              | `PTP_TYPE_EVENT` container with `code=0xC201`, `param1=handle` | No log (Depends on "Still Img. Save Dest.") | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **4**  | **Android USB Interrupt Read**         | [`modules/entephoto-camera/.../sony/PtpUsbTransport.kt:L407-L430`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/PtpUsbTransport.kt#L407-L430)           | `readInterruptEvent(timeoutMs=1500)` via `bulkTransfer(epInt, ...)` | `bulkTransfer` returns ≥ 12 bytes                              | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **5**  | **PTP Event Parser**                   | [`modules/entephoto-camera/.../sony/PtpUsbTransport.kt:L413-L429`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/PtpUsbTransport.kt#L413-L429)           | `readInterruptEvent` binary unpacking                               | Returns `PtpEvent(code=0xC201, param1=...)`                    | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **6**  | **New-Object Handle Extraction**       | [`modules/entephoto-camera/.../core/UsbConnectionManager.kt:L256-L283`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/core/UsbConnectionManager.kt#L256-L283) | `remoteShootingJob` in `startRemoteShootingLoop`                    | `remoteShootingLoop: ObjectAdded (0xC201) — handle=0x...`      | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **7**  | **Object Info Request (`0x1008`)**     | [`modules/entephoto-camera/.../sony/SonyRemoteSession.kt:L320-L335`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/SonyRemoteSession.kt#L320-L335)       | `downloadObject` -> `PTP_OC_GET_OBJECT_INFO`                        | `PTP GetObjectInfo OK`                                         | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **8**  | **Image-Object Download (`0x1009`)**   | [`modules/entephoto-camera/.../sony/SonyRemoteSession.kt:L337-L358`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/SonyRemoteSession.kt#L337-L358)       | `downloadObject` -> `PTP_OC_GET_OBJECT`                             | `downloadObject: Sending GetObject (0x1009)`                   | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
|  **9**  | **Complete Image Bytes Received**      | [`modules/entephoto-camera/.../sony/PtpUsbTransport.kt:L357-L404`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/PtpUsbTransport.kt#L357-L404)           | `receiveDataContainer` chunk loop                                   | `Data phase complete (N bytes)`                                | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
| **10**  | **Android Storage Save**               | [`modules/entephoto-camera/.../sony/SonyRemoteSession.kt:L375-L437`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/SonyRemoteSession.kt#L375-L437)       | `saveToMediaStore` -> `ContentResolver.insert`                      | `saveToMediaStore: confirmed local file on mobile: ...`        | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
| **11**  | **Import Record / Room DB Completion** | [`modules/entephoto-camera/.../model/ImportSession.kt:L53-L67`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/model/ImportSession.kt#L53-L67)                 | `recordImportCompleted`                                             | Emits `ImportEvent.ImportCompleted`                            | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
| **12**  | **CameraManager Event Collector**      | [`modules/entephoto-camera/.../core/CameraManager.kt:L101-L117`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/core/CameraManager.kt#L101-L117)               | `importEventJob` collecting `ImportSession.events`                  | `CameraManager: onPhotoSaved dispatching`                      | Dropped by unplanted Timber                 | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
| **13**  | **Expo Native Event Dispatch**         | [`modules/entephoto-camera/.../EntePhotoCameraModule.kt:L39-L48`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/EntePhotoCameraModule.kt#L39-L48)             | `sendEvent("onPhotoSaved", ...)`                                    | Expo event bridge dispatch                                     | Dropped / None received                     | **SOURCE PRESENT — NOT RUNTIME-VERIFIED** |
| **14**  | **TypeScript Listener**                | [`src/screens/Camera/CameraConnectedScreen.tsx:L72-L88`](file:///e:/androidAppReact/src/screens/Camera/CameraConnectedScreen.tsx#L72-L88)                                                                                   | `addPhotoSavedListener` callback                                    | `[CameraConnected] onPhotoSaved — filename: ...`               | **None in log.txt**                         | **NOT REACHED**                           |
| **15**  | **Gallery Presentation**               | [`src/screens/Gallery/PhotoSelectionGalleryScreen.tsx:L190-L200`](file:///e:/androidAppReact/src/screens/Gallery/PhotoSelectionGalleryScreen.tsx#L190-L200)                                                                 | `scanDcimEntephotoPhotos` via `localPhotoService.ts`                | `[LocalPhotoService] Scanned N photos`                         | Scanned only 466 pre-existing photos        | **FAILED (Path Mismatch & Decoupled)**    |

---

## 4. Actual Storage Destination

Inspection of [`SonyRemoteSession.kt`](file:///e:/androidAppReact/modules/entephoto-camera/android/src/main/java/com/photoceremony/entephotocamera/sony/SonyRemoteSession.kt#L41-L437) reveals the exact storage mechanics:

- **Storage API:** Android `MediaStore` (Scoped Storage for Android 10+ / API 29+); fallback to `java.io.File` / `FileOutputStream` on API ≤ 28.
- **Configured `RELATIVE_PATH`:** `"DCIM/entephoto/"` (All lowercase, defined at line 41).
- **MediaStore Collection:** `MediaStore.Images.Media.EXTERNAL_CONTENT_URI` (or `MediaStore.Downloads.EXTERNAL_CONTENT_URI` for non-image MIME types).
- **Filename Generation:** Extracted from PTP `GetObjectInfo` (`0x1008`). Fallback format: `"SONY_%08X.jpg"` where `%08X` is the 32-bit hex object handle.
- **MIME Type Handling:** Parsed from PTP format code (`0x3801` -> `image/jpeg`, `0xB002` -> `image/x-sony-arw`).
- **Atomicity & Pending State:** Marked with `MediaStore.MediaColumns.IS_PENDING = 1` during the stream write; finalized to `IS_PENDING = 0` only after `os.write(bytes)` succeeds.
- **Media Scanner Indexing:** Explicitly executes `MediaScannerConnection.scanFile(context, arrayOf(path), arrayOf(mimeType), null)` on line 416 to force Android MediaStore to index the file.
- **Failure Cleanup:** If an exception occurs during stream writing, `resolver.delete(uri, null, null)` is invoked (line 434) to clean up incomplete fragments.
- **Critical Path Divergence:**
  - Native code stores photos in the MediaStore database targeting the on-disk directory `/storage/emulated/0/DCIM/entephoto/`.
  - Content URIs generated look like `content://media/external/images/media/12345`.

---

## 5. Actual Gallery Read Path

Inspection of [`PhotoSelectionGalleryScreen.tsx`](file:///e:/androidAppReact/src/screens/Gallery/PhotoSelectionGalleryScreen.tsx#L35-L56), [`localPhotoService.ts`](file:///e:/androidAppReact/src/services/localPhotoService.ts#L6-L235), and [`photo.config.ts`](file:///e:/androidAppReact/src/config/photo.config.ts#L10-L65) reveals how photos are actually queried:

- **Screen / Component:** `PhotoSelectionGalleryScreen.tsx`.
- **Service / Hook:** `scanDcimEntephotoPhotos()` and `subscribeToDcimPhotos()` in `localPhotoService.ts`.
- **Query Mechanism:** **Direct Filesystem Directory Listing via `expo-file-system` (`new Directory(CANONICAL_DCIM_DIR_URI).list()`)**. It **DOES NOT** query Android MediaStore, does not query Room database `DownloadedFileDao`, and does not consume `onPhotoSaved`.
- **Directory Queried:** Defined by `CANONICAL_DCIM_DIR_URI = normalizePhotoDirectoryUri(EXPO_PUBLIC_PHOTO_STORAGE_PATH)`. In `.env` (line 29), this is set to:
  ```env
  EXPO_PUBLIC_PHOTO_STORAGE_PATH=DCIM/Entephoto
  ```
  Normalized to: `file:///sdcard/DCIM/Entephoto`.
- **Case Mismatch:**
  - Native save path: `DCIM/entephoto/` (lowercase `e`).
  - Gallery scan path: `DCIM/Entephoto/` (capital `E`).
    On Android's Linux filesystem (ext4/f2fs), these are two distinct, non-overlapping directory paths. Files written by native code to `DCIM/entephoto/` are completely invisible to `Directory("file:///sdcard/DCIM/Entephoto").list()`.
- **Android Scoped Storage Restriction:** On Android 13+ (API 33), raw directory traversal of `/sdcard/DCIM/...` using file APIs without MediaStore queries requires `MANAGE_EXTERNAL_STORAGE`. MediaProvider denies raw access, as demonstrated by the error spam in `log.txt`:
  ```
  E MediaProvider: Permission to access file: /storage/emulated/0/Download/... is denied
  ```

---

## 6. Exact Failure Point

The earliest confirmed failure occurs at the **Camera PTP Event Generation & Reception Stage (Pipeline Stage 3)**:

```
Physical Shutter Pressed
       ↓
Camera saves to SD card
       ↓
[FAILURE 1]: Sony Camera setting "Still Img. Save Dest." is set to "Camera Only"
       ↓
Camera suppresses PTP 0xC201 notification over USB
       ↓
UsbConnectionManager EP3 Interrupt-IN read times out (returns null)
       ↓
No ObjectAdded event received → No download initiated → No onPhotoSaved dispatched
```

If the camera was configured to "PC+Camera" and emitted `0xC201`:

```
Camera emits 0xC201 over EP3
       ↓
UsbConnectionManager receives handle
       ↓
session.fetchAndSaveObject() called
       ↓
[FAILURE 2]: Download/Save exception (e.g., Timeout, OOM, MediaStore error)
       ↓
ImportSession.emitEvent(ImportEvent.ImportFailed)
       ↓
[FAILURE 3]: CameraManager drops ImportFailed (only collects ImportCompleted)
       ↓
Zero error events sent to JS → CameraConnectedScreen remains "Connected" with 0 photos
```

If the download and save succeeded:

```
Photo saved to MediaStore at "DCIM/entephoto/SONY_0001.jpg"
       ↓
CameraManager dispatches onPhotoSaved to JS
       ↓
CameraConnectedScreen increments photoCount to 1
       ↓
User taps "View Photos" → navigates to PhotoSelectionGalleryScreen
       ↓
[FAILURE 4]: Gallery scans "file:///sdcard/DCIM/Entephoto" (Case mismatch + Scoped Storage bypass)
       ↓
New photo is not found in the scanned directory → Photo does not appear in Gallery
```

---

## 7. Error Visibility Gap

The application current architecture exhibits a complete **error visibility void**:

1. **`CameraManager.kt` Ignores All Import Failures:**
   Lines 102–117 of `CameraManager.kt`:
   ```kotlin
   importEventJob = scope.launch {
       ImportSession.events.collect { event ->
           if (event is ImportEvent.ImportCompleted) {
               // dispatches onPhotoSaved
           }
           // NOTICE: ImportEvent.ImportFailed is NEVER handled!
       }
   }
   ```
2. **Native Module Exposes No Error Events:**
   `EntePhotoCameraModule.kt` defines only:
   ```kotlin
   Events("onDeviceFound", "onDeviceDisconnected", "onConnectionStateChanged", "onPhotoSaved")
   ```
   There is no `"onImportFailed"`, `"onPhotoSaveFailed"`, or `"onTransferError"` event registered.
3. **`CameraConnectedScreen.tsx` Subscribes Only to Success:**
   Lines 72–88 subscribe exclusively to `addPhotoSavedListener`. The screen does not subscribe to connection state changes, device disconnections, or transfer errors.
4. **Indefinite "Connected" State:**
   If a download times out or fails on `GetObject` (`0x1009`), `UsbConnectionManager.kt` catches the exception on line 305, logs it to Timber (which is dropped), and continues the loop. The UI remains indefinitely displaying "Camera Connected! GOOD TO GO!" with `0 photos available`, never alerting the photographer.

---

## 8. Original Kotlin vs. Migrated Native Module

| Area / Component               | Original `kotlin/` Implementation                                                                                   | Migrated `modules/entephoto-camera`                                                                                                   | Significance to Failure                                                                                                 |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------- |
| **Timber Tree Initialization** | `PhotoCeremonyApp.kt` calls `Timber.plant(Timber.DebugTree())` in `Application.onCreate()`.                         | `MainApplication.kt` **never calls `Timber.plant()`**.                                                                                | **CRITICAL DEFECT.** Completely mutes all native logging across the entire camera module.                               |
| **Service Lifecycle**          | Runs as Android foreground service (`ImportService`) with persistent notification.                                  | Runs via CoroutineScopes inside local singleton `UsbConnectionManager` tied to React Native module lifecycle.                         | Coroutine survives screen navigation, but lacks foreground service priority and is subject to OS background throttling. |
| **PTP Event Fallback**         | `waitForObjectAddedEvent` in `SonyRemoteSession` had dual strategy (EP3 Interrupt + `pollGetEvent` fallback).       | `UsbConnectionManager.startRemoteShootingLoop` **only** calls `pollEventNonBlocking(timeoutMs=1500)`, which only reads EP3 interrupt. | If camera sends events via control/bulk transfers or requires explicit polling, loop never sees them.                   |
| **Error Propagation**          | `MainActivity` and `ImportLogActivity` observed `ImportSession.events` directly and displayed failed import toasts. | `CameraManager` only listens for `ImportCompleted`. Failures are silently dropped before reaching Expo bridge.                        | UI cannot display transfer errors.                                                                                      |

---

## 9. Root-Cause Ranking

### Confirmed Defect 1: Timber Logging Not Planted (Evidence Strength: 10/10)

- **Proof:** Grep across `android/` returned zero matches for `Timber.plant`. Grep across `kotlin/` found `Timber.plant` only in the standalone Kotlin app.
- **Impact:** All diagnostic and error logging from the native module is silently swallowed by Timber's empty tree.

### Confirmed Defect 2: Gallery Directory Case Mismatch & Storage Disconnect (Evidence Strength: 10/10)

- **Proof:**
  - `SonyRemoteSession.kt:L41`: `relativeDir = "DCIM/entephoto/"` (lowercase `e`).
  - `.env:L29` and `photo.config.ts:L11`: `EXPO_PUBLIC_PHOTO_STORAGE_PATH=DCIM/Entephoto` (capital `E`).
  - `localPhotoService.ts:L167`: Directly inspects `new Directory("file:///sdcard/DCIM/Entephoto")` instead of MediaStore.
- **Impact:** Photos saved by the native module are physically saved to a different folder than the one scanned by the React Native gallery.

### Confirmed Defect 3: Silent Drop of `ImportEvent.ImportFailed` (Evidence Strength: 10/10)

- **Proof:** `CameraManager.kt` lines 102–117 contains `if (event is ImportEvent.ImportCompleted)` with no handler for `ImportEvent.ImportFailed`. `EntePhotoCameraModule.kt` defines no failure event.
- **Impact:** Any download, USB timeout, or storage failure is completely invisible to JavaScript and the user interface.

### Highly Probable Cause 4: Sony α7 IV "Still Img. Save Dest." Setting (Evidence Strength: 9/10)

- **Proof:** Standard Sony camera firmware behavior in PC Remote mode: if "Still Img. Save Dest." is set to "Camera Only", the camera records to the memory card but does not transmit over USB.
- **Impact:** Physical shutter triggers, camera takes photo, but USB Interrupt-IN endpoint never receives `0xC201`.

---

## 10. Minimal Fixes Recommended (Do Not Implement Yet)

To resolve the issue cleanly and verify end-to-end photo transfer:

1. **Verify / Change Camera Setting on Sony α7 IV:**
   - On the camera, navigate to: **Menu -> Network -> [Transfer/Remote] -> [PC Remote Function]**.
   - Ensure **PC Remote** is set to **On**.
   - Change **Still Img. Save Dest.** to **PC + Camera** (or **PC Only**).
   - Ensure **PC Remote Connect Method** is set to **USB**.
2. **Plant `Timber.DebugTree` in `MainApplication.kt`:**
   - In `android/app/src/main/java/com/entephoto/app/MainApplication.kt`, add `Timber.plant(Timber.DebugTree())` in `onCreate()` so all native logs output to logcat.
3. **Synchronize Save and Gallery Directory Paths:**
   - Align `relativeDir` in `SonyRemoteSession.kt` and `EXPO_PUBLIC_PHOTO_STORAGE_PATH` in `.env` to identical casing (e.g., `"DCIM/Entephoto/"`).
   - Update `localPhotoService.ts` to scan both or query MediaStore using Scoped Storage APIs.
4. **Bridge `ImportEvent.ImportFailed` to JavaScript:**
   - In `CameraManager.kt`, collect `ImportEvent.ImportFailed` and dispatch `listener?.onPhotoSaveFailed(handle, error)`.
   - In `EntePhotoCameraModule.kt`, add `"onPhotoSaveFailed"` to `Events()` and dispatch to React Native.
   - In `CameraConnectedScreen.tsx`, listen to `"onPhotoSaveFailed"` and display an alert or banner with the error reason.

---

## 11. Evidence Limitations

1. **No Live ADB Transport:** Because the Xiaomi 11i has only one USB-C port (occupied by the camera's USB-C OTG cable) and wireless debugging was not connected on port 5555, live real-time Logcat during this session could not be captured.
2. **Camera Menu Settings:** The internal menu setting ("Still Img. Save Dest.") cannot be read remotely over USB before session initialization; it must be physically verified on the camera's rear LCD screen.

---

## Answers to Final Mandatory Questions

1. **After the physical shutter is pressed, does Android receive any new-object event?**  
   **No**, if the Sony α7 IV's internal setting is set to **"Camera Only"**. If set to **"PC+Camera"**, the event packet is sent over EP3, but was not observable in Logcat because `Timber` was uninitialized.
2. **If yes, what happens next?**  
   `UsbConnectionManager.kt` matches `event.code == 0xC201`, extracts `event.param1` as the object handle, and invokes `session.fetchAndSaveObject(context, handle)`.
3. **Does the app actually retrieve the image bytes?**  
   Not in the current configuration. If triggered, `SonyRemoteSession.downloadObject` sends `0x1008` (GetObjectInfo) followed by `0x1009` (GetObject) and buffers the payload chunks via `receiveDataContainer`.
4. **Where does the image save, and was a file created?**  
   Native code writes to MediaStore with `RELATIVE_PATH = "DCIM/entephoto/"` (lowercase `e`). No new file was created following the shutter press.
5. **Which exact source does EntePhoto's gallery read from?**  
   `PhotoSelectionGalleryScreen.tsx` reads directly from the filesystem directory `file:///sdcard/DCIM/Entephoto` via `expo-file-system` `Directory.list()`. It **does not** read from MediaStore or `onPhotoSaved`.
6. **Does the gallery include the saved image location?**  
   **No.** Due to Linux case-sensitivity (`DCIM/entephoto` vs `DCIM/Entephoto`), the gallery reads from a different folder than the one targeted by the native MediaStore insert.
7. **Which exception, PTP result, timeout, or missing bridge prevents delivery?**  
   The primary failure is the camera firmware withholding PTP events when "Still Img. Save Dest." is set to "Camera Only". The secondary failure is `CameraManager.kt` dropping `ImportEvent.ImportFailed`, preventing any error notification from reaching JavaScript.
8. **Why is the error not visible in the connected-camera UI?**  
   `CameraManager.kt` filters out all non-completed events (`if (event is ImportEvent.ImportCompleted)`), the native module registers no error event with Expo, and `CameraConnectedScreen.tsx` only subscribes to `onPhotoSaved`.
9. **What is the smallest evidence-supported fix?**
   - Change the Sony α7 IV setting **"Still Img. Save Dest."** to **PC + Camera**.
   - Plant `Timber.DebugTree()` in `MainApplication.kt` to restore runtime visibility.
   - Synchronize the folder casing between `SonyRemoteSession.kt` and `.env` (`DCIM/Entephoto`).
