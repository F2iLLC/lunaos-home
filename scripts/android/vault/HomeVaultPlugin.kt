package io.github.f2illc.lunaos.home.preview

import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import io.github.f2illc.lunaos.directtlsprobe.HomeDirectEntry

@TauriPlugin
class HomeVaultPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun openLunaProbe(invoke: Invoke) {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 26) {
            invoke.reject("Luna voice demo requires an Android API26+ debug build.")
            return
        }
        activity.runOnUiThread {
            try {
                val intent = Intent().setClassName(
                    "io.github.f2illc.lunaos.home.voiceprobe",
                    "io.github.f2illc.lunaos.home.voiceprobe.VoiceProbe"
                )
                activity.startActivity(intent)
                invoke.resolve()
            } catch (_: android.content.ActivityNotFoundException) {
                invoke.reject("Install the separate Luna voice demo first.")
            } catch (_: SecurityException) {
                invoke.reject("Luna voice demo cannot be opened on this device.")
            }
        }
    }
    @Command
    fun openVehicle(invoke: Invoke) {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 31) {
            invoke.reject("Vehicle preview requires an Android API31+ debug build.")
            return
        }
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, io.github.f2illc.lunaos.home.vehicle.VehicleSetupActivity::class.java))
            invoke.resolve()
        }
    }
    @Command
    fun open(invoke: Invoke) {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 30) {
            invoke.reject("Fictional vault requires an Android API30+ debug build.")
            return
        }
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, VaultActivity::class.java))
            invoke.resolve()
        }
    }

    @Command
    fun prepareDirect(invoke: Invoke) {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 30) {
            invoke.reject("Fictional connection requires an Android API30+ debug build.")
            return
        }
        Thread({
            try {
                HomeDirectEntry.prepareIdentity(activity)
                invoke.resolve()
            } catch (_: Exception) {
                invoke.reject("Fictional connection identity unavailable.")
            }
        }, "fictional-home-identity").start()
    }

    @Command
    fun openDirect(invoke: Invoke) {
        if (!BuildConfig.DEBUG || Build.VERSION.SDK_INT < 30) {
            invoke.reject("Fictional connection requires an Android API30+ debug build.")
            return
        }
        activity.runOnUiThread {
            try {
                HomeDirectEntry.open(activity)
                invoke.resolve()
            } catch (_: Exception) {
                invoke.reject("Fictional private connection unavailable.")
            }
        }
    }
}
