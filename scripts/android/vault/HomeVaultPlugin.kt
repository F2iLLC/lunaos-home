package io.github.f2illc.lunaos.home.preview

import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import io.github.f2illc.lunaos.directtlsprobe.HomeDirectEntry
import io.github.f2illc.lunaos.home.voiceprobe.HomeLunaBridge

@InvokeArg
internal class LunaTimerArgs { var id: Int = 0 }
@InvokeArg
internal class LunaOnlineArgs { var enabled: Boolean = false }
@InvokeArg
internal class NotebookArgs { var body: String = ""; var session: String = "" }

@TauriPlugin
class HomeVaultPlugin(private val activity: Activity) : Plugin(activity) {
    @Command fun notebookRequest(invoke: Invoke) {
        val args = invoke.parseArgs(NotebookArgs::class.java)
        Thread {
            try { invoke.resolve(HomeLunaBridge.notebook(activity, args.body, args.session)) }
            catch (_: Exception) { invoke.reject("Could not confirm the result. Reopen the list before trying again.") }
        }.start()
    }
    @Command fun lunaSnapshot(invoke: Invoke) {
        try { invoke.resolve(HomeLunaBridge.snapshot(activity)) }
        catch (_: Exception) { invoke.reject("Home voice status unavailable.") }
    }

    @Command fun enableLunaWake(invoke: Invoke) {
        try { HomeLunaBridge.enable(activity); invoke.resolve() }
        catch (_: Exception) { invoke.reject("Could not enable listening. Allow microphone access and check that the local model is installed.") }
    }

    @Command fun requestLunaMicrophone(invoke: Invoke) {
        try { HomeLunaBridge.requestMicrophone(activity); invoke.resolve() }
        catch (_: Exception) { invoke.reject("Could not request microphone access.") }
    }

    @Command fun disableLunaWake(invoke: Invoke) {
        try { HomeLunaBridge.disable(activity); invoke.resolve() }
        catch (_: Exception) { invoke.reject("Could not disable listening.") }
    }

    @Command fun setLunaOnlineAnswers(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(LunaOnlineArgs::class.java)
            HomeLunaBridge.setOnlineAnswers(activity, args.enabled)
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Could not change Luna online-answer setting. Check the relay configuration.") }
    }

    @Command fun cancelLunaTimer(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(LunaTimerArgs::class.java)
            HomeLunaBridge.cancel(activity, args.id)
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("Could not cancel that Luna timer.") }
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
