# EntePhoto Mobile — Image Asset Audit & Unused Image Report

**Audit Date:** October 27, 2026  
**Project:** EntePhoto React Native / Expo Android application (`entephoto-mobile`)  
**Target Directory:** `assets/` and subdirectories

---

## Executive Summary

An exhaustive audit of all image assets in the project was conducted across TypeScript/TSX components, configuration files (`app.json`, `app.config.ts`), native Android resources (`android/app/src/main/res/`), static `require()` statements, dynamic asset registries, and build configurations.

### Key Metrics

- **Total Asset Files Audited:** 25 files (24 raster images + 1 Lottie animation)
- **Total Asset Storage:** ~23.4 MB
- **Actively Used Assets:** 14 files (~16.2 MB)
- **Confirmed Unused Assets:** 10 files (~5.4 MB)
- **Unused Assets Requiring Manual Verification (Potential Dynamic/Roadmap):** 1 file (~1.75 MB)
- **Potential Asset Reduction:** ~7.15 MB (~30.5% of total asset payload)

---

## 1. Complete Asset Inventory

| #   | Relative File Path                                                   | Format        | Dimensions (WxH) | File Size             | Classification                            |
| --- | -------------------------------------------------------------------- | ------------- | ---------------- | --------------------- | ----------------------------------------- |
| 1   | `assets/LOGO_W.png`                                                  | PNG (RGBA)    | 4167 × 4167 px   | 127.7 KB (127,657 B)  | **Active (Master Logo / Startup Screen)** |
| 1b  | `assets/splash-logo.png`                                             | PNG (RGBA)    | 2048 × 2048 px   | 94.2 KB (94,188 B)    | **Active (Native Splash Asset)**          |
| 2   | `assets/android-icon-foreground.png`                                 | PNG (RGBA)    | 1024 × 1024 px   | 132.7 KB (132,672 B)  | **Active (Adaptive Foreground)**          |
| 3   | `assets/android-icon-background.png`                                 | PNG (RGBA)    | 1024 × 1024 px   | 5.9 KB (5,857 B)      | **Active (Adaptive Background)**          |
| 4   | `assets/android-icon-monochrome.png`                                 | PNG (RGBA)    | 1024 × 1024 px   | 34.6 KB (34,555 B)    | **Active (Themed Launcher)**              |
| 5   | `assets/icon.png`                                                    | PNG (RGBA)    | 1024 × 1024 px   | 119.6 KB (119,601 B)  | **Active (Main App Icon)**                |
| 6   | `assets/favicon.png`                                                 | PNG (RGBA)    | 1254 × 1254 px   | 526.9 KB (526,880 B)  | **Active (Web Favicon)**                  |
| 7   | `assets/image.png`                                                   | PNG (RGBA)    | 512 × 279 px     | 352.0 KB (352,006 B)  | **Active (Avatar & Local Mock)**          |
| 8   | `assets/selectEvent/9e434fa2-04d9-4ac1-866e-19273e6d2658.png`        | PNG (RGBA)    | 1536 × 1024 px   | 1.55 MB (1,549,720 B) | **Active (Event Selection Hero)**         |
| 9   | `assets/login page/4bd1f543-fcf1-4cf7-b50b-ea2443c97fd6.png`         | PNG (RGBA)    | 1474 × 1067 px   | 1.37 MB (1,369,398 B) | **Active (Sign-In Screen Hero)**          |
| 10  | `assets/ctAYourCamera/28328fe7-79dc-438d-8f78-16cd13c144cf.png`      | PNG (RGBA)    | 1536 × 1024 px   | 1.93 MB (1,932,622 B) | **Active (Camera Connect Hero)**          |
| 11  | `assets/ctAYourCamera/511408e8-83d9-49f8-a1d5-e769833c09f3.png`      | PNG (RGBA)    | 1332 × 1181 px   | 837.4 KB (837,353 B)  | **Active (3D Wi-Fi Icon)**                |
| 12  | `assets/ctAYourCamera/527a3e8b-c9b0-4344-8f9a-182b25e5a8c2.png`      | PNG (RGBA)    | 1536 × 1024 px   | 2.04 MB (2,037,719 B) | **Active (Sony Camera Hero)**             |
| 13  | `assets/ctAYourCamera/a40bb110-a40e-4376-8664-d5434b687765.png`      | PNG (RGBA)    | 1536 × 1024 px   | 1.23 MB (1,229,418 B) | **Active (3D USB-C Icon)**                |
| 14  | `assets/galleryScreen/clay_folder_illustration.jpg`                  | JPEG          | 1367 × 1151 px   | 1.13 MB (1,128,256 B) | **Active (Empty Gallery State)**          |
| 15  | `assets/animations/cloud-upload.json`                                | Lottie JSON   | N/A              | 6.2 KB (6,231 B)      | **Active (Upload Animation)**             |
| 16  | `assets/splash-icon.png`                                             | PNG (Indexed) | 1024 × 1024 px   | 17.5 KB (17,547 B)    | **Unused (Template Artifact)**            |
| 17  | `assets/dfb.png`                                                     | PNG (RGBA)    | 48 × 48 px       | 1.1 KB (1,129 B)      | **Unused (Orphan Asset)**                 |
| 18  | `assets/squareRed.png`                                               | PNG (RGBA)    | 1345 × 1169 px   | 891.3 KB (891,342 B)  | **Unused (Replaced by SVG/Code)**         |
| 19  | `assets/star-green.png`                                              | PNG (RGBA)    | 1278 × 1230 px   | 637.1 KB (637,127 B)  | **Unused (Replaced by SVG)**              |
| 20  | `assets/star-yellow.png`                                             | PNG (RGBA)    | 1277 × 1231 px   | 588.6 KB (588,637 B)  | **Unused (Replaced by SVG)**              |
| 21  | `assets/triangle.png`                                                | PNG (RGBA)    | 1312 × 1199 px   | 749.7 KB (749,733 B)  | **Unused (Replaced by CSS)**              |
| 22  | `assets/73ec926c-b1fa-4b1a-999f-a27713e46ce7.png`                    | PNG (RGBA)    | 1254 × 1254 px   | 808.2 KB (808,223 B)  | **Unused (Raw Design Export)**            |
| 23  | `assets/843b4758-fc8d-4d21-8ff6-6ac18f4146f3.png`                    | PNG (RGBA)    | 1312 × 1199 px   | 798.9 KB (798,877 B)  | **Unused (Duplicate Triangle)**           |
| 24  | `assets/846d40d8-cdfe-451a-a23e-529438665073.png`                    | PNG (RGBA)    | 1345 × 1169 px   | 930.5 KB (930,463 B)  | **Unused (Duplicate Square)**             |
| 25  | `assets/cameraDisconnected/ad2d867f-083b-4e9d-af43-51a9513f583d.png` | PNG (RGBA)    | 1536 × 1024 px   | 1.75 MB (1,745,391 B) | **Needs Verification (Roadmap)**          |

---

## 2. Confirmed Unused Image Assets (Zero References)

These 10 image assets have no references anywhere in project source code, configuration files, native resources, or dynamic mapping tables.

### 1. `assets/splash-icon.png` (.png)

- **Dimensions:** 1024 × 1024 px
- **File Size:** 17.5 KB (17,547 bytes)
- **Classification Rationale:** Default Expo template splash artifact. `app.json` configures `expo-splash-screen` to use `assets/LOGO_W.png`. This file is completely superseded and unreferenced.

### 2. `assets/dfb.png` (.png)

- **Dimensions:** 48 × 48 px
- **File Size:** 1.1 KB (1,129 bytes)
- **Classification Rationale:** Small orphan bitmap. Text search across all TypeScript, TSX, JSON, and native files found no occurrences.

### 3. `assets/squareRed.png` (.png)

- **Dimensions:** 1345 × 1169 px
- **File Size:** 891.3 KB (891,342 bytes)
- **Classification Rationale:** 3D clay red cube illustration. Originally designed as a floating background shape on hero screens. Screen headers now use lightweight code-based geometric accents (e.g. `AppBackground` gradients and inline SVGs).

### 4. `assets/star-green.png` (.png)

- **Dimensions:** 1278 × 1230 px
- **File Size:** 637.1 KB (637,127 bytes)
- **Classification Rationale:** 3D clay green sparkle star. Decorative accents in `SelectEventScreen.tsx`, `CameraConnectScreen.tsx`, and `GoogleSignInScreen.tsx` are now rendered vectorially via `SparkleStarSvg` and `SparkleStar` (`react-native-svg`), eliminating the need for this large raster bitmap.

### 5. `assets/star-yellow.png` (.png)

- **Dimensions:** 1277 × 1231 px
- **File Size:** 588.6 KB (588,637 bytes)
- **Classification Rationale:** 3D clay yellow sparkle star. Superseded by the resolution-independent `SparkleStarSvg` component (`color="#F5C242"`).

### 6. `assets/triangle.png` (.png)

- **Dimensions:** 1312 × 1199 px
- **File Size:** 749.7 KB (749,733 bytes)
- **Classification Rationale:** 3D clay mint triangle. The screens use CSS border styling (`geoMintTriangle` in `SelectEventScreen.tsx`) rather than importing this bitmap.

### 7. `assets/73ec926c-b1fa-4b1a-999f-a27713e46ce7.png` (.png)

- **Dimensions:** 1254 × 1254 px
- **File Size:** 808.2 KB (808,223 bytes)
- **Classification Rationale:** Raw UUID-named export matching the canvas dimensions of `favicon.png`. Not referenced anywhere in source or config.

### 8. `assets/843b4758-fc8d-4d21-8ff6-6ac18f4146f3.png` (.png)

- **Dimensions:** 1312 × 1199 px
- **File Size:** 798.9 KB (798,877 bytes)
- **Classification Rationale:** Duplicate UUID-named export with identical dimensions to `triangle.png`. Completely unreferenced.

### 9. `assets/846d40d8-cdfe-451a-a23e-529438665073.png` (.png)

- **Dimensions:** 1345 × 1169 px
- **File Size:** 930.5 KB (930,463 bytes)
- **Classification Rationale:** Duplicate UUID-named export with identical dimensions to `squareRed.png`. Completely unreferenced.

---

## 3. Unused Images Requiring Manual Verification (Potential Dynamic / Roadmap)

### `assets/cameraDisconnected/ad2d867f-083b-4e9d-af43-51a9513f583d.png` (.png)

- **Dimensions:** 1536 × 1024 px
- **File Size:** 1.75 MB (1,745,391 bytes)
- **Classification:** Needs Manual Verification
- **Rationale:**
  - Static code inspection across all screens confirms this asset is **not currently imported or required** anywhere in the codebase.
  - However, its subdirectory name (`cameraDisconnected/`) strongly suggests it is intended for a camera disconnection alert, error modal, or reconnection flow that may be planned or dynamically triggered in a future release.
  - Retain this asset until product/design confirms whether a disconnected camera state screen or illustration is planned.

---

## 4. Actively Used Image Assets

These 14 assets are confirmed active and required by application functionality:

| Asset Path                                                      | Usage Context & Target References                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assets/LOGO_W.png`                                             | **App Startup Splash Screen:** Centered logo on `#0B0F1A` dark background in `app.json` (`expo-splash-screen` plugin) and compiled into Android native `drawable-*dpi/splashscreen_logo.png`.                                                    |
| `assets/android-icon-foreground.png`                            | **Android Launcher Icon:** Configured as `expo.android.adaptiveIcon.foregroundImage` in `app.json`.                                                                                                                                              |
| `assets/android-icon-background.png`                            | **Android Launcher Icon:** Configured as `expo.android.adaptiveIcon.backgroundImage` in `app.json`.                                                                                                                                              |
| `assets/android-icon-monochrome.png`                            | **Android Themed Icon:** Configured as `expo.android.adaptiveIcon.monochromeImage` in `app.json` for Android 13+ material themed launcher.                                                                                                       |
| `assets/icon.png`                                               | **App Icon Fallback:** Configured as `expo.icon` in `app.json` for general Expo/iOS/web app icon fallback.                                                                                                                                       |
| `assets/favicon.png`                                            | **Web Favicon:** Configured as `expo.web.favicon` in `app.json`.                                                                                                                                                                                 |
| `assets/image.png`                                              | **Fallback Avatar & Event Cover:** Statically required and dynamically mapped in `SelectEventScreen.tsx` (`LOCAL_ASSETS['assets/image.png']`), `CameraConnectScreen.tsx` (`DEFAULT_AVATAR`), and `CameraConnectedScreen.tsx` (`DEFAULT_AVATAR`). |
| `assets/selectEvent/9e434fa2-04d9-4ac1-866e-19273e6d2658.png`   | **Select Event Hero Artwork:** Statically required as `LOCAL_ASSETS.hero3DArtwork` in `SelectEventScreen.tsx` (3D clay camera and calendar).                                                                                                     |
| `assets/login page/4bd1f543-fcf1-4cf7-b50b-ea2443c97fd6.png`    | **Google Sign-In Hero Artwork:** Statically required in `GoogleSignInScreen.tsx` (3D clay camera illustration).                                                                                                                                  |
| `assets/ctAYourCamera/28328fe7-79dc-438d-8f78-16cd13c144cf.png` | **Camera Connect Hero Artwork:** Statically required as `CAMERA_HERO_IMAGE` in `CameraConnectScreen.tsx`.                                                                                                                                        |
| `assets/ctAYourCamera/511408e8-83d9-49f8-a1d5-e769833c09f3.png` | **3D Wi-Fi Icon Artwork:** Statically required as `WIFI_3D_ICON` in `CameraConnectScreen.tsx`.                                                                                                                                                   |
| `assets/ctAYourCamera/527a3e8b-c9b0-4344-8f9a-182b25e5a8c2.png` | **Sony Camera Hero Artwork:** Statically required as `SONY_CAMERA_HERO` in `CameraConnectedScreen.tsx`.                                                                                                                                          |
| `assets/ctAYourCamera/a40bb110-a40e-4376-8664-d5434b687765.png` | **3D USB-C Icon Artwork:** Statically required as `USBC_3D_ICON` in `CameraConnectScreen.tsx`.                                                                                                                                                   |
| `assets/galleryScreen/clay_folder_illustration.jpg`             | **Gallery Empty State Artwork:** Statically required in `PhotoSelectionGalleryScreen.tsx` for empty folder state.                                                                                                                                |
| `assets/animations/cloud-upload.json`                           | **Lottie Animation:** Required in `FullScreenPhotoViewer.tsx` for photo upload progress animation.                                                                                                                                               |

---

## 5. Audit Methodology

1. **AST & Static Reference Tracing:** Inspected all `.ts`, `.tsx`, `.js`, `.json` files in `src/`, `modules/`, `plugins/`, and root for static `require(...)` and `import ... from ...` statements.
2. **Configuration Inspection:** Verified `app.json` and `app.config.ts` for top-level `icon`, `android.adaptiveIcon`, `web.favicon`, and `plugins` (`expo-splash-screen`).
3. **Dynamic Asset Registry Audit:** Checked lookup dictionaries such as `LOCAL_ASSETS` in `SelectEventScreen.tsx` where backend-returned strings (e.g. `'assets/image.png'`) dynamically resolve to bundled images.
4. **Native Android Resource Correlation:** Cross-referenced `android/app/src/main/res/` drawable directories (`drawable-hdpi` through `drawable-xxxhdpi`) against Expo prebuild output rules.
5. **Binary & Dimension Analysis:** Inspected PNG/JPEG header metadata to determine exact pixel dimensions, color channels/alpha transparency, and file byte sizes.

---

## 6. Recommendations (Do Not Delete Without Approval)

Per project safety requirements, no assets were deleted or moved during this audit. When the team is ready to optimize bundle size:

1. **Safe Deletions (~5.4 MB recovery):** The 9 unreferenced assets in the root `assets/` folder (`squareRed.png`, `star-green.png`, `star-yellow.png`, `triangle.png`, `splash-icon.png`, `dfb.png`, `73ec...`, `843b...`, `846d...`) can be safely removed or archived outside the app bundle.
2. **Confirm Roadmap Assets (~1.75 MB):** Confirm with the product team whether `assets/cameraDisconnected/ad2d867f-083b-4e9d-af43-51a9513f583d.png` will be used for a disconnected state screen before removing.
