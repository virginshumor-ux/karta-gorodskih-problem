package ru.sfu.kgp.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.math.max

/**
 * On-device photo processing: max 1280 px on the long side, JPEG quality 80. The bitmap is re-encoded,
 * so no EXIF survives (no location, no camera model); the orientation is applied to the pixels first.
 */
class Photos(private val context: Context) {
    val dir: File get() = File(context.filesDir, "photos").apply { mkdirs() }

    /** Target file for ActivityResultContracts.TakePicture (shared through the FileProvider). */
    fun newCaptureFile(): File = File(File(context.cacheDir, "camera").apply { mkdirs() }, "${UUID.randomUUID()}.jpg")

    suspend fun compress(uri: Uri): File = withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        val rotation = resolver.openInputStream(uri)?.use { exifRotation(ExifInterface(it)) } ?: 0
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0) { "not an image" }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: error("decode")
        writeJpeg(scaleAndRotate(decoded, rotation))
    }

    fun writeJpeg(bmp: Bitmap, quality: Int = 80): File {
        val out = File(dir, "${UUID.randomUUID()}.jpg")
        var q = quality
        do {
            FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, q, it) }
            q -= 15
        } while (out.length() > MAX_BYTES && q >= 40)
        return out
    }

    /** Placeholder picture for demonstrations without a camera (the prototype's demo illustration). */
    fun demoPhoto(): File {
        val b = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 800f, 600f, Color.parseColor("#9fb3b5"), Color.parseColor("#4d6466"), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, 800f, 600f, p)
        p.shader = null
        p.color = Color.parseColor("#3a4a4b")
        c.drawRect(0f, 380f, 800f, 600f, p)
        p.color = Color.parseColor("#26302f")
        c.drawOval(RectF(230f, 415f, 570f, 525f), p)
        p.color = Color.argb(230, 255, 255, 255)
        p.textAlign = Paint.Align.CENTER
        p.typeface = Typeface.DEFAULT_BOLD
        p.textSize = 34f
        c.drawText("Демо-иллюстрация", 400f, 120f, p)
        p.typeface = Typeface.DEFAULT
        p.textSize = 24f
        c.drawText("вместо фото проблемы", 400f, 160f, p)
        return writeJpeg(b)
    }

    companion object {
        const val MAX_SIDE = 1280
        const val MAX_BYTES = 2L * 1024 * 1024

        fun exifRotation(e: ExifInterface): Int = when (e.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }

        fun scaleAndRotate(src: Bitmap, rotation: Int, maxSide: Int = MAX_SIDE): Bitmap {
            val k = minOf(1f, maxSide.toFloat() / max(src.width, src.height))
            val m = Matrix().apply {
                postScale(k, k)
                if (rotation != 0) postRotate(rotation.toFloat())
            }
            if (k == 1f && rotation == 0) return src
            return Bitmap.createBitmap(src, 0, 0, src.width, src.height, m, true).also {
                if (it != src) src.recycle()
            }
        }
    }
}
