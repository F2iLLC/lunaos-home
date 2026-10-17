package io.github.f2illc.lunaos.home.preview

import android.app.Activity
import android.content.Intent
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class HomeVaultPlugin(private val activity: Activity) : Plugin(activity) {
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
}
