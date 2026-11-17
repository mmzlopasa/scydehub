import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing: your own keystore from the environment (GitHub Actions secrets) when present. Otherwise the
// keystore committed in this repository is used: its password is public, so it proves nothing about who built the
// APK, but it is the SAME key on every build, which is what lets a newer APK install over an older one.
val ownKs: String? = System.getenv("ANDROID_KEYSTORE_PATH")
val ksPath: String = ownKs ?: rootProject.file("ci-release.keystore").path

android {
    namespace = "com.scyde.hub"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.scyde.hub.tv"
        minSdk = 23
        targetSdk = 35
        versionCode = (System.getenv("VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("VERSION_NAME") ?: "0.1.0"
    }

    signingConfigs {
        create("release") {
            storeFile = file(ksPath)
            storePassword = if (ownKs != null) System.getenv("ANDROID_KEYSTORE_PASSWORD") else "scydehub"
            keyAlias = if (ownKs != null) System.getenv("ANDROID_KEY_ALIAS") else "scydehub"
            keyPassword = if (ownKs != null) System.getenv("ANDROID_KEY_PASSWORD") else "scydehub"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
}

// No AndroidX dependencies: the shell only uses the platform WebView, which keeps the APK tiny.
