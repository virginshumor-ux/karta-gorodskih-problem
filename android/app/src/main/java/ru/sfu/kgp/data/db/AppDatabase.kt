package ru.sfu.kgp.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Upsert

/** Last successfully loaded feed — shown without network (offline viewing). Stored as JSON per complaint. */
@Entity(tableName = "cached_complaints")
data class CachedComplaint(@PrimaryKey val id: String, val json: String, val createdAt: Long)

/** Ф-07: a complaint that could not be sent; DraftUploadWorker sends it when the network is back. */
@Entity(tableName = "drafts")
data class DraftEntity(
    @PrimaryKey val id: String,
    val json: String,
    val title: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val lastError: String? = null,
)

/** The create wizard in progress (saved on onStop, restored after process death). Single row. */
@Entity(tableName = "wizard_state")
data class WizardStateEntity(@PrimaryKey val key: Int = 0, val json: String, val savedAt: Long)

@Entity(tableName = "kv")
data class KvEntity(@PrimaryKey val key: String, val value: String, val at: Long)

@Dao
interface CacheDao {
    @Query("SELECT * FROM cached_complaints ORDER BY createdAt DESC")
    suspend fun all(): List<CachedComplaint>

    @Query("DELETE FROM cached_complaints")
    suspend fun clear()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(items: List<CachedComplaint>)

    @Transaction
    suspend fun replaceAll(items: List<CachedComplaint>) {
        clear()
        insertAll(items)
    }

    @Upsert
    suspend fun putKv(kv: KvEntity)

    @Query("SELECT * FROM kv WHERE `key` = :key")
    suspend fun kv(key: String): KvEntity?
}

@Dao
interface DraftDao {
    @Query("SELECT * FROM drafts ORDER BY createdAt")
    suspend fun all(): List<DraftEntity>

    @Query("SELECT COUNT(*) FROM drafts")
    suspend fun count(): Int

    @Upsert
    suspend fun put(d: DraftEntity)

    @Query("DELETE FROM drafts WHERE id = :id")
    suspend fun delete(id: String)

    @Upsert
    suspend fun saveWizard(w: WizardStateEntity)

    @Query("SELECT * FROM wizard_state WHERE `key` = 0")
    suspend fun wizard(): WizardStateEntity?

    @Query("DELETE FROM wizard_state")
    suspend fun clearWizard()
}

@Database(
    entities = [CachedComplaint::class, DraftEntity::class, WizardStateEntity::class, KvEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun cache(): CacheDao
    abstract fun drafts(): DraftDao

    companion object {
        fun create(context: Context, inMemory: Boolean = false): AppDatabase =
            if (inMemory) Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
            else Room.databaseBuilder(context, AppDatabase::class.java, "kgp.db").build()
    }
}
