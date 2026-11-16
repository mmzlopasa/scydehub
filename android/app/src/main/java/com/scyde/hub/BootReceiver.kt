package com.scyde.hub

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Optional: start the dashboard after the TV boots (enable in the setup screen). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!Prefs(context).autostart) return
        val i = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(i)
        } catch (_: Exception) {
            // Android 10+ may block background starts unless the app is the default launcher
            // or has "display over other apps"; the user can grant that in system settings.
        }
    }
}
