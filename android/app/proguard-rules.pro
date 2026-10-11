# kotlinx.serialization: keep generated serializers of our @Serializable classes.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-keepclassmembers @kotlinx.serialization.Serializable class ru.sfu.kgp.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keepclasseswithmembers class ru.sfu.kgp.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ru.sfu.kgp.**$$serializer { *; }

# Ktor / supabase-kt: optional JVM classes that are not on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn io.ktor.util.debug.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
-keep class io.ktor.client.engine.okhttp.** { *; }

# osmdroid reflects on tile providers and writers.
-keep class org.osmdroid.** { *; }
-dontwarn org.osmdroid.**
