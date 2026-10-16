/**
 * withEntePhotoCamera.js
 *
 * Expo Config Plugin for EntePhoto USB Camera integration.
 *
 * This plugin applies only the minimum native Android configuration required
 * for USB camera discovery:
 *   1. android.hardware.usb.host feature declaration
 *   2. USB_DEVICE_ATTACHED intent filter on the main activity
 *   3. usb_device_filter.xml resource (Sony VID-restricted)
 *
 * What this plugin does NOT do:
 *   - Does not add foreground service permissions
 *   - Does not add storage permissions
 *   - Does not export any service or receiver
 *   - Does not modify application behavior
 *   - Does not add any API credentials or secrets
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ─── Part A: Inject USB manifest entries ────────────────────────────────────

function withUsbManifest(config) {
  return withAndroidManifest(config, config => {
    const manifest = config.modResults;
    const application = manifest.manifest.application?.[0];
    if (!application) throw new Error('[withEntePhotoCamera] No <application> found in manifest');

    // 1. Ensure android.hardware.usb.host feature is declared
    if (!manifest.manifest['uses-feature']) {
      manifest.manifest['uses-feature'] = [];
    }
    const hasUsbFeature = manifest.manifest['uses-feature'].some(
      f => f.$?.['android:name'] === 'android.hardware.usb.host',
    );
    if (!hasUsbFeature) {
      manifest.manifest['uses-feature'].push({
        $: {
          'android:name': 'android.hardware.usb.host',
          // required=false: allows the app to install on devices without USB host.
          // The camera feature simply won't activate on those devices.
          'android:required': 'false',
        },
      });
    }

    // 2. Add USB_DEVICE_ATTACHED intent filter + device filter meta-data
    //    to the main (launcher) activity.
    const activities = application.activity || [];
    const mainActivity = activities.find(a =>
      a['intent-filter']?.some(f =>
        f.action?.some(action => action.$?.['android:name'] === 'android.intent.action.MAIN'),
      ),
    );

    if (!mainActivity) {
      throw new Error('[withEntePhotoCamera] Could not find main activity in AndroidManifest.xml');
    }

    // Check if USB_DEVICE_ATTACHED filter already exists
    const hasUsbFilter = mainActivity['intent-filter']?.some(f =>
      f.action?.some(
        a => a.$?.['android:name'] === 'android.hardware.usb.action.USB_DEVICE_ATTACHED',
      ),
    );

    if (!hasUsbFilter) {
      if (!mainActivity['intent-filter']) mainActivity['intent-filter'] = [];
      mainActivity['intent-filter'].push({
        action: [{ $: { 'android:name': 'android.hardware.usb.action.USB_DEVICE_ATTACHED' } }],
      });
    }

    // Add meta-data pointing to the device filter resource
    const hasUsbMeta = mainActivity['meta-data']?.some(
      m => m.$?.['android:name'] === 'android.hardware.usb.action.USB_DEVICE_ATTACHED',
    );
    if (!hasUsbMeta) {
      if (!mainActivity['meta-data']) mainActivity['meta-data'] = [];
      mainActivity['meta-data'].push({
        $: {
          'android:name': 'android.hardware.usb.action.USB_DEVICE_ATTACHED',
          'android:resource': '@xml/usb_device_filter',
        },
      });
    }

    return config;
  });
}

// ─── Part B: Write device filter XML into the app's res/xml ─────────────────

const USB_DEVICE_FILTER_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
    USB device filter for Sony cameras — EntePhoto App.

    Sony Corporation vendor ID: 0x054C.
    Product IDs are intentionally omitted because all Sony Alpha/ZV/FX/RX
    cameras share the same VID but vary in PID across models and firmware.

    The filter is restricted to:
      class    = 6   (Still Image — PTP/MTP interface class)
      subclass = 1   (Still Image Capture Device)
      protocol = 1   (PTP; MTP uses 0x00 but we only want PTP cameras)

    A fallback entry without class constraints is included to handle Sony
    cameras that report a vendor-specific interface class while still being
    valid PTP targets. DeviceChecker.isSonyDevice() provides a second layer
    of VID validation in native code.
-->
<resources>
    <!--
        Primary entry: Sony VID + PTP Still Image class.
        Matches Alpha, ZV, FX, and RX cameras in PC Remote (PTP) mode.
    -->
    <usb-device
        vendorId="0x054C"
        class="6"
        subclass="1"
        protocol="1" />

    <!--
        Fallback: Sony VID only.
        Matches cameras exposing vendor-specific descriptors while still
        operating over PTP (e.g. some FX-series firmware variants).
    -->
    <usb-device vendorId="0x054C" />
</resources>
`;

function withUsbDeviceFilter(config) {
  return withDangerousMod(config, [
    'android',
    config => {
      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      const destFilter = path.join(destDir, 'usb_device_filter.xml');

      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      fs.writeFileSync(destFilter, USB_DEVICE_FILTER_XML, 'utf8');
      return config;
    },
  ]);
}

// ─── Compose ─────────────────────────────────────────────────────────────────

/**
 * @param {import('@expo/config-plugins').ConfigPlugin} config
 */
const withEntePhotoCamera = config => {
  config = withUsbManifest(config);
  config = withUsbDeviceFilter(config);
  return config;
};

module.exports = withEntePhotoCamera;
