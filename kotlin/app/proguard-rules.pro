# Add project specific ProGuard rules here.

# Keep Timber
-keep class timber.log.** { *; }

# Keep the PTP layer (Step 2) — adjust package when added
-keep class com.photoceremony.usbimport.ptp.** { *; }

# Keep Parcelable extras (UsbDevice is system-provided, but keep our models)
-keepclassmembers class * implements android.os.Parcelable {
    static ** CREATOR;
}
