package com.scyde.hub

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast

/**
 * Thin shell around the Hub's /kiosk page: fullscreen WebView, screen always on,
 * D-pad keys forwarded to the page, automatic reconnect when the Hub is unreachable.
 * Hold BACK (or press MENU) to open the setup screen.
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var overlay: TextView
    private lateinit var prefs: Prefs
    private val handler = Handler(Looper.getMainLooper())
    private var lastBack = 0L
    private var failed = false

    private val retry = object : Runnable {
        override fun run() {
            if (failed) web.reload()
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        if (!prefs.configured) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0A0A10"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.userAgentString = settings.userAgentString + " SCYDEHubTV/" + BuildConfig.VERSION_NAME
            webViewClient = Client()
            webChromeClient = WebChromeClient()
        }
        overlay = TextView(this).apply {
            setTextColor(Color.WHITE)
            textSize = 22f
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#E60A0A10"))
            visibility = View.GONE
        }
        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        root.addView(overlay, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)
        immersive()
        web.loadUrl(prefs.kioskUrl())
        web.requestFocus()
    }

    private fun immersive() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) immersive()
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        super.onPause()
    }

    private fun showError(msg: String) {
        failed = true
        overlay.text = "SCYDE Hub nije dostupan\n\n$msg\n\nPonovni pokušaj za 10 s…\n(Drži BACK ili pritisni MENU za postavke)"
        overlay.visibility = View.VISIBLE
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, 10_000)
    }

    private inner class Client : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            if (!failed) overlay.visibility = View.GONE
        }
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            failed = false
        }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showError(error.description?.toString() ?: "Greška mreže")
        }
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 500) showError("HTTP ${response.statusCode}")
        }
        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Only for the configured Hub host, and only if the user explicitly allowed it in setup.
            val hubHost = android.net.Uri.parse(prefs.url).host
            val host = android.net.Uri.parse(error.url).host
            if (prefs.acceptSelfSigned && hubHost != null && hubHost == host) handler.proceed()
            else { handler.cancel(); showError("TLS certifikat nije valjan (${error.primaryError})") }
        }
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // stay inside the Hub; ignore external links on a TV
            val hubHost = android.net.Uri.parse(prefs.url).host
            return request.url.host != hubHost
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_MENU && event.action == KeyEvent.ACTION_UP) {
            openSetup(); return true
        }
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN && event.isLongPress) { openSetup(); return true }
            if (event.action == KeyEvent.ACTION_UP) {
                val now = System.currentTimeMillis()
                if (now - lastBack < 1500) openSetup()
                else Toast.makeText(this, "Pritisni BACK još jednom za postavke", Toast.LENGTH_SHORT).show()
                lastBack = now
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun openSetup() {
        startActivity(Intent(this, SetupActivity::class.java))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (::web.isInitialized) web.loadUrl(prefs.kioskUrl())
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
