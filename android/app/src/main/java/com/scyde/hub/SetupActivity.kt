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
        val url = field("http://192.168.1.50:8484 ili https://hub.example.com", prefs.url, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        val token = field("sk_…", prefs.token, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD)
        val profiles = arrayOf("tv" to "TV (veći font, za daljinski)", "tablet" to "Tablet", "desktop" to "Monitor")
        val profileGroup = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        profiles.forEachIndexed { i, (id, l) ->
            profileGroup.addView(RadioButton(this).apply { text = l; this.id = 1000 + i; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.profile == id })
        }
        val autostart = CheckBox(this).apply { text = "Pokreni automatski nakon paljenja uređaja"; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.autostart }
        val selfSigned = CheckBox(this).apply { text = "Prihvati self-signed certifikat (samo za ovaj Hub)"; setTextColor(Color.WHITE); textSize = 16f; isChecked = prefs.acceptSelfSigned }
        val save = Button(this).apply {
            text = "Spremi i pokreni"
            textSize = 18f
            setTextColor(Color.WHITE)
            isAllCaps = false
            background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#7C5CFF")) }
            setPadding(dp(24), dp(16), dp(24), dp(16))
            setOnClickListener {
                val u = url.text.toString().trim().trimEnd('/')
                if (!u.startsWith("http://") && !u.startsWith("https://")) { url.error = "URL mora počinjati s http:// ili https://"; return@setOnClickListener }
                if (token.text.isBlank()) { token.error = "Upiši kiosk token"; return@setOnClickListener }
                prefs.url = u
                prefs.token = token.text.toString()
                prefs.profile = profiles[(profileGroup.checkedRadioButtonId - 1000).coerceIn(0, profiles.size - 1)].first
                prefs.autostart = autostart.isChecked
                prefs.acceptSelfSigned = selfSigned.isChecked
                startActivity(Intent(this@SetupActivity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK))
                finish()
            }
        }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(48), dp(36), dp(48), dp(36))
            addView(label("SCYDE Hub", 30f, "#FFFFFF"))
            addView(label("Upiši adresu Huba i kiosk token (Postavke → Kiosk i uređaji)."))
            addView(label("URL Huba")); addView(url)
            addView(label("Kiosk token")); addView(token)
            addView(label("Layout")); addView(profileGroup)
            addView(autostart); addView(selfSigned)
            addView(Space(this@SetupActivity), LinearLayout.LayoutParams(1, dp(20)))
            addView(save, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            addView(label("Na TV-u: strelice ←/→ mijenjaju stranice, OK pauzira rotaciju. Drži BACK ili pritisni MENU za ovaj ekran.", 13f))
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
