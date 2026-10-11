// AGP 9 compiles Kotlin itself (built-in Kotlin) with KGP 2.2.10 by default. supabase-kt 3.8 is built with
// Kotlin 2.4, so a newer KGP (and the matching Compose / serialization compiler plugins) is put on the classpath here.
buildscript {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    dependencies {
        classpath(libs.android.gradle)
        classpath(libs.kotlin.gradle)
        classpath(libs.kotlin.compose.gradle)
        classpath(libs.kotlin.serialization.gradle)
        classpath(libs.ksp.gradle)
    }
}
