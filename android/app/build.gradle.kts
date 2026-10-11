import java.time.LocalDate
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

// Public client settings come from the environment (CI secrets) or android/local.properties (local runs).
// Nothing secret is compiled in: only the Supabase anon key and OAuth client ids, which are public by design.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun cfg(env: String, prop: String, default: String = ""): String =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: localProps.getProperty(prop) ?: default

val keystorePath = System.getenv("KGP_KEYSTORE").orEmpty()
val hasReleaseKey = keystorePath.isNotBlank() && file(keystorePath).exists()

android {
    namespace = "ru.sfu.kgp"
    compileSdk = 37

    defaultConfig {
        applicationId = "ru.sfu.kgp"
        minSdk = 26
        targetSdk = 37
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField("String", "SUPABASE_URL", "\"${cfg("KGP_SUPABASE_URL", "supabase.url")}\"")
        buildConfigField("String", "SUPABASE_ANON_KEY", "\"${cfg("KGP_SUPABASE_ANON_KEY", "supabase.anonKey")}\"")
        buildConfigField("String", "YANDEX_CLIENT_ID", "\"${cfg("KGP_YANDEX_CLIENT_ID", "yandex.clientId")}\"")
        buildConfigField("String", "VK_CLIENT_ID", "\"${cfg("KGP_VK_CLIENT_ID", "vk.clientId")}\"")
        buildConfigField("boolean", "DEMO_LOGIN_ENABLED", cfg("KGP_DEMO_LOGIN_ENABLED", "demo.loginEnabled", "true"))
        buildConfigField("String", "SITE_URL", "\"${cfg("KGP_SITE_URL", "site.url")}\"")
        buildConfigField("String", "BUILD_DATE", "\"${LocalDate.now()}\"")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KGP_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KGP_KEY_ALIAS")
                keyPassword = System.getenv("KGP_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Local release builds without the CI key are signed with the debug key so they can be installed for testing.
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.isReturnDefaultValues = true
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        // Dependency versions are pinned deliberately (see gradle/libs.versions.toml).
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/INDEX.LIST", "/META-INF/io.netty.versions.properties")
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.exifinterface)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    implementation(platform(libs.supabase.bom))
    implementation(libs.supabase.auth)
    implementation(libs.supabase.postgrest)
    implementation(libs.supabase.storage)
    implementation(libs.supabase.realtime)
    implementation(libs.supabase.functions)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.okhttp)

    implementation(libs.osmdroid)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.androidx.work.testing)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
}
