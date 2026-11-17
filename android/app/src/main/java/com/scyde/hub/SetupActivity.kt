package com.scyde.hub

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*

/** First-run screen: asks only for the Hub URL and the kiosk token (plus a few device options). D-pad friendly. */
class SetupActivity : Activity() {
    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun field(hint: String, value: String, type: Int) = EditText(this).apply {
        setText(value)
        this.hint = hint
        inputType = type
        setTextColor(Color.WHITE)
        setHintTextColor(Color.parseColor("#808499"))
        textSize = 18f
        setSingleLine()
        imeOptions = EditorInfo.IME_ACTION_NEXT
        setPadding(dp(16), dp(14), dp(16), dp(14))
        background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(Color.parseColor("#1A1B26")); setStroke(dp(1), Color.parseColor("#2A2B3A")) }
    }

    private fun label(t: String, size: Float = 14f, color: String = "#8B90A6") = TextView(this).apply {
        text = t; textSize = size; setTextColor(Color.parseColor(color)); setPadding(0, dp(14), 0, dp(6))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(this)
        val url = field("http://192.168.1.50:8484 or https://hub.example.com", prefs.url, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        // a saved token is never shown again (anyone with the remote can open this screen): empty = keep it
        val hasToken = prefs.token.isNotBlank()
        val token = field(if (hasToken) "Saved — leave empty to keep it" else "Kiosk token", "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        val profiles = arrayOf("tv" to "TV (larger text, for a remote)", "tablet" to "Tablet", "desktop" to "Monitor")
        val profileGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        profiles.forEachIndexed { i, (id, l) ->
            profileGroup.addView(RadioButton(this).apply { text = l; this.id = 1000 + i; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.profile == id })
        }
        val autostart = CheckBox(this).apply { text = "Start automatically when the device boots"; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.autostart }
        val selfSigned = CheckBox(this).apply { text = "Accept a self-signed certificate (this Hub only, pinned on first use)"; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.acceptSelfSigned }
        val overLock = CheckBox(this).apply { text = "Show over the lock screen (TV / wall tablet only)"; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.showWhenLocked }
        val save = Button(this).apply {
            text = "Save and start"
            textSize = 18f
            setTextColor(Color.WHITE)
            isAllCaps = false
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#7C5CFF")) }
            setPadding(dp(24), dp(16), dp(24), dp(16))
            setOnClickListener {
                val u = url.text.toString().trim().trimEnd('/')
                if (!u.startsWith("http://") && !u.startsWith("https://")) { url.error = "URL must start with http:// or https://"; return@setOnClickListener }
                val newToken = token.text.toString().trim()
                if (newToken.isEmpty() && !hasToken) { token.error = "Enter the kiosk token"; return@setOnClickListener }
                if (newToken.isNotEmpty() && !Regex("^[A-Za-z0-9_.~-]{8,200}$").matches(newToken)) { token.error = "That does not look like a kiosk token"; return@setOnClickListener }
                // a new address or a re-save means a new certificate may be pinned
                prefs.pinnedCert = ""
                prefs.url = u
                if (newToken.isNotEmpty() && !prefs.saveToken(newToken)) {
                    Toast.makeText(this@SetupActivity, "This device could not store the token securely. Restart the device and try again.", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                prefs.profile = profiles[(profileGroup.checkedRadioButtonId - 1000).coerceIn(0, profiles.size - 1)].first
                prefs.autostart = autostart.isChecked
                prefs.acceptSelfSigned = selfSigned.isChecked
                prefs.showWhenLocked = overLock.isChecked
                // Android 10+ only lets an app open itself after boot when it may draw over other apps
                if (autostart.isChecked && android.os.Build.VERSION.SDK_INT >= 29 && !android.provider.Settings.canDrawOverlays(this@SetupActivity)) {
                    try {
                        startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, android.net.Uri.parse("package:$packageName")))
                        Toast.makeText(this@SetupActivity, "Allow \"Display over other apps\" so SCYDE Hub can start after boot, then press Save again.", Toast.LENGTH_LONG).show()
                        return@setOnClickListener
                    } catch (_: Exception) {
                        Toast.makeText(this@SetupActivity, "Autostart needs \"Display over other apps\": enable it for SCYDE Hub in the system settings.", Toast.LENGTH_LONG).show()
                    }
                }
                startActivity(Intent(this@SetupActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(36), dp(48), dp(36))
            addView(label("SCYDE Hub", 30f, "#FFFFFF"))
            addView(label("Enter the Hub address and a kiosk token (Settings → Kiosk & devices)."))
            addView(label("Hub URL")); addView(url)
            addView(label("Kiosk token")); addView(token)
            addView(label("Layout")); addView(profileGroup)
            addView(autostart); addView(selfSigned); addView(overLock)
            addView(Space(this@SetupActivity), LinearLayout.LayoutParams(1, dp(20)))
            addView(save, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(label("On a TV: the ←/→ arrows switch boards, OK pauses rotation. Hold BACK or press MENU to open this screen.", 13f))
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#0A0A10"))
            isFillViewport = true
            addView(FrameLayout(this@SetupActivity).apply {
                addView(col, FrameLayout.LayoutParams(dp(720).coerceAtMost(resources.displayMetrics.widthPixels), -2, Gravity.CENTER_HORIZONTAL))
            })
        }
        setContentView(scroll)
        (if (prefs.url.isBlank()) url else save).requestFocus()
        scroll.descendantFocusability = android.view.ViewGroup.FOCUS_AFTER_DESCENDANTS
    }
}
