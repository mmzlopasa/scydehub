package com.scyde.hub

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hub URL, kiosk token and device options, stored privately on the device.
 * The kiosk token is encrypted with a key that never leaves the Android Keystore,
 * so a copy of the app's data (backup, rooted file access) does not reveal it.
 */
class Prefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("hub", Context.MODE_PRIVATE)

    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v.trim().trimEnd('/')).apply()
    var token: String
        get() {
            val enc = p.getString("token_enc", null)
            if (enc != null) return decrypt(enc) ?: ""
            // one-time migration of a token saved by an older version in plain text
            val plain = p.getString("token", "") ?: ""
            if (plain.isNotEmpty()) token = plain
            return plain
        }
        set(v) { saveToken(v) }
    /** false when the Keystore is unavailable (seen on some TV boxes): nothing is stored, and never in plain text */
    fun saveToken(v: String): Boolean = try {
        val enc = encrypt(v.trim())
        p.edit().remove("token").putString("token_enc", enc).apply()
        true
    } catch (_: Exception) { false }
    var profile: String
        get() = p.getString("profile", "tv") ?: "tv"
        set(v) = p.edit().putString("profile", v).apply()
    var autostart: Boolean
        get() = p.getBoolean("autostart", false)
        set(v) = p.edit().putBoolean("autostart", v).apply()
    var acceptSelfSigned: Boolean
        get() = p.getBoolean("selfSigned", false)
        set(v) = p.edit().putBoolean("selfSigned", v).apply()
    /** SHA-256 of the Hub's certificate, remembered the first time a self-signed certificate is accepted. */
    var pinnedCert: String
        get() = p.getString("pinnedCert", "") ?: ""
        set(v) = p.edit().putString("pinnedCert", v).apply()
    var showWhenLocked: Boolean
        get() = p.getBoolean("showWhenLocked", false)
        set(v) = p.edit().putBoolean("showWhenLocked", v).apply()
    val configured get() = url.isNotBlank() && token.isNotBlank()

    /** The token travels in the URL fragment: fragments are never sent to the server or written to logs. */
    fun kioskUrl(): String {
        val t = java.net.URLEncoder.encode(token, "UTF-8")
        return "$url/kiosk?profile=$profile#token=$t"
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    private fun encrypt(plain: String): String {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(out, Base64.NO_WRAP)
    }

    private fun decrypt(enc: String): String? = try {
        val raw = Base64.decode(enc, Base64.NO_WRAP)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, 12))
        String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8)
    } catch (_: Exception) {
        null // key lost (app data restored on another device) → ask for the token again
    }

    private companion object { const val ALIAS = "scydehub_kiosk_token" }
}
