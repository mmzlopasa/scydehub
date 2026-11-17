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
            // not reload(): after a failed first load the WebView is on its error page, so load the Hub again
            if (failed) web.loadUrl(prefs.kioskUrl())
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
        // showing the dashboard over the lock screen is opt-in (it would expose it on a locked phone or tablet)
        if (Build.VERSION.SDK_INT >= 27 && prefs.showWhenLocked) { setShowWhenLocked(true); setTurnScreenOn(true) }

        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#0A0A10"))
            isFocusable = true
            isFocusableInTouchMode = true
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            // lock the WebView down: no local files, no content providers, no mixed content, no geolocation
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setGeolocationEnabled(false)
            settings.setSupportMultipleWindows(false)
            settings.javaScriptCanOpenWindowsAutomatically = false
            if (Build.VERSION.SDK_INT >= 26) settings.safeBrowsingEnabled = true
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
        overlay.text = "SCYDE Hub is unreachable\n\n$msg\n\nRetrying in 10 s…\n(Hold BACK or press MENU for settings)"
        overlay.visibility = View.VISIBLE
        handler.removeCallbacks(retry)
        handler.postDelayed(retry, 10_000)
    }

    private fun port(u: android.net.Uri): Int = if (u.port != -1) u.port else if (u.scheme == "https") 443 else 80

    /** SHA-256 fingerprint of the certificate the server presented. */
    private fun fingerprint(cert: android.net.http.SslCertificate?): String? = try {
        val der: ByteArray? = if (Build.VERSION.SDK_INT >= 29) cert?.x509Certificate?.encoded
        else android.net.http.SslCertificate.saveState(cert)?.getByteArray("x509-certificate")
        der?.let { java.security.MessageDigest.getInstance("SHA-256").digest(it).joinToString("") { b -> "%02x".format(b) } }
    } catch (_: Exception) { null }

    private inner class Client : WebViewClient() {
        override fun onPageFinished(view: WebView, url: String) {
            if (!failed) overlay.visibility = View.GONE
        }
        override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
            failed = false
        }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showError(error.description?.toString() ?: "Network error")
        }
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 500) showError("HTTP ${response.statusCode}")
        }
        @SuppressLint("WebViewClientOnReceivedSslError")
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Self-signed certificates are accepted only for the configured Hub, only if enabled in setup,
            // and only the exact certificate seen the first time (trust on first use). A different
            // certificate later — e.g. someone intercepting the connection — is refused.
            val hub = android.net.Uri.parse(prefs.url)
            val u = android.net.Uri.parse(error.url)
            val fp = fingerprint(error.certificate)
            val sameHub = hub.host != null && hub.host == u.host && port(hub) == port(u) && u.scheme == "https"
            if (!prefs.acceptSelfSigned || !sameHub || fp == null) {
                handler.cancel(); showError("TLS certificate is not valid (${error.primaryError})"); return
            }
            if (prefs.pinnedCert.isEmpty()) prefs.pinnedCert = fp
            if (prefs.pinnedCert == fp) handler.proceed()
            else { handler.cancel(); showError("The Hub's certificate changed. If you replaced it, open setup and save again.") }
        }
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // stay inside the Hub (same scheme, host and port); everything else is ignored on a kiosk
            val hub = android.net.Uri.parse(prefs.url)
            val u = request.url
            if (u.host != hub.host) return true
            if (u.scheme == hub.scheme && port(u) == port(hub)) return false
            // the Hub (or the proxy in front of it) upgrading http → https on the same host is fine
            return !(hub.scheme == "http" && u.scheme == "https")
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
                else Toast.makeText(this, "Press BACK again for settings", Toast.LENGTH_SHORT).show()
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
        if (!::web.isInitialized) return
        // Settings were saved. Loading the same page with only a different #token would not reload it, so the page
        // would keep the old token: start from a blank page and drop the history first.
        failed = false
        handler.removeCallbacks(retry)
        web.loadUrl("about:blank")
        web.post { web.clearHistory(); web.loadUrl(prefs.kioskUrl()) }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (::web.isInitialized) web.destroy()
        super.onDestroy()
    }
}
