package com.scyde.hub

import android.content.Context

/** Hub URL, kiosk token and device options, stored privately on the device. */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("hub", Context.MODE_PRIVATE)
    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var token: String
        get() = p.getString("token", "") ?: ""
        set(v) = p.edit().putString("token", v.trim()).apply()
    var profile: String
        get() = p.getString("profile", "tv") ?: "tv"
        set(v) = p.edit().putString("profile", v).apply()
    var autostart: Boolean
        get() = p.getBoolean("autostart", false)
        set(v) = p.edit().putBoolean("autostart", v).apply()
    var acceptSelfSigned: Boolean
        get() = p.getBoolean("selfSigned", false)
        set(v) = p.edit().putBoolean("selfSigned", v).apply()
    val configured get() = url.isNotBlank() && token.isNotBlank()

    fun kioskUrl(): String {
        val t = java.net.URLEncoder.encode(token, "UTF-8")
        return "$url/kiosk?token=$t&profile=$profile"
    }
}
