package ru.sfu.kgp.ui

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import ru.sfu.kgp.AppContainer
import ru.sfu.kgp.data.SubmitResult
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.Duplicate
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.NewComplaint
import ru.sfu.kgp.domain.distM
import ru.sfu.kgp.domain.toAppException
import java.io.File
import java.util.UUID

/** Wizard data that must survive rotation (SavedStateHandle) and process death (Room on onStop). */
@Serializable
data class WizardDraft(
    val id: String = UUID.randomUUID().toString(),
    val step: Int = 0,
    val photos: List<String> = emptyList(),
    val lat: Double? = null,
    val lng: Double? = null,
    val address: String = "",
    val district: String = "",
    val category: String? = null,
    val title: String = "",
    val description: String = "",
    val createdId: String? = null,
    val savedOffline: Boolean = false,
)

data class WizardUi(
    val draft: WizardDraft = WizardDraft(),
    val dups: List<Duplicate>? = null,
    val busy: Boolean = false,
    val geocoding: Boolean = false,
    val geoHint: String = "",
) {
    val ready: Boolean get() = when (draft.step) {
        0 -> draft.photos.isNotEmpty()
        1 -> draft.lat != null && Krsk.inCity(draft.lat, draft.lng) && draft.address.isNotEmpty() && !geocoding
        2 -> draft.category != null
        3 -> draft.title.trim().length >= 5
        else -> !busy
    }
}

class CreateViewModel(
    private val c: AppContainer,
    private val handle: SavedStateHandle,
    private val knownComplaints: () -> List<Complaint>,
) : ViewModel() {
    private val json = Json { ignoreUnknownKeys = true }
    private val _ui = MutableStateFlow(WizardUi(draft = handle.get<String>(KEY)?.let(::decode) ?: WizardDraft()))
    val ui: StateFlow<WizardUi> = _ui.asStateFlow()
    private var geoJob: Job? = null

    init {
        // After process death the SavedStateHandle may be empty: fall back to the copy saved in Room on onStop.
        if (handle.get<String>(KEY) == null) viewModelScope.launch {
            c.repository.loadWizard()?.let(::decode)?.takeIf { it.createdId == null }?.let { set(it) }
        }
        if (_ui.value.draft.step == 4) findDuplicates()
    }

    private fun decode(s: String) = runCatching { json.decodeFromString(WizardDraft.serializer(), s) }.getOrNull()

    private fun set(d: WizardDraft) {
        _ui.update { it.copy(draft = d) }
        handle[KEY] = json.encodeToString(WizardDraft.serializer(), d)
    }

    private fun edit(block: (WizardDraft) -> WizardDraft) = set(block(_ui.value.draft))

    /** Called from the screen's ON_STOP: the draft goes to Room so nothing is lost if the process is killed. */
    fun persist() = viewModelScope.launch {
        val d = _ui.value.draft
        if (d.createdId == null) c.repository.saveWizard(json.encodeToString(WizardDraft.serializer(), d))
    }

    fun reset() {
        set(WizardDraft())
        _ui.update { it.copy(dups = null, busy = false, geoHint = "") }
        viewModelScope.launch { c.repository.clearWizard() }
    }

    // ---------- step 1: photos ----------

    fun addPhoto(uri: Uri, onError: (String) -> Unit) = viewModelScope.launch {
        if (_ui.value.draft.photos.size >= 3) return@launch
        runCatching { c.photos.compress(uri) }
            .onSuccess { f -> edit { it.copy(photos = (it.photos + f.absolutePath).take(3)) } }
            .onFailure { onError("Не удалось прочитать файл. Выберите фото в формате JPEG, PNG или HEIC.") }
    }

    fun addDemoPhoto() {
        if (_ui.value.draft.photos.size >= 3) return
        val f = c.photos.demoPhoto()
        edit { it.copy(photos = it.photos + f.absolutePath) }
    }

    fun removePhoto(i: Int) = edit { d ->
        d.photos.getOrNull(i)?.let { runCatching { File(it).delete() } }
        d.copy(photos = d.photos.filterIndexed { j, _ -> j != i })
    }

    // ---------- step 2: place ----------

    fun setLocation(lat: Double, lng: Double) {
        edit { it.copy(lat = lat, lng = lng, address = "", district = "") }
        _ui.update { it.copy(geocoding = true, geoHint = if (!Krsk.inCity(lat, lng)) "Точка за пределами Красноярска — приложение принимает обращения только по городу." else "") }
        geoJob?.cancel()
        geoJob = viewModelScope.launch {
            delay(700)
            val g = c.geocoder.reverse(lat, lng, knownComplaints())
            val d = _ui.value.draft
            if (d.lat == lat && d.lng == lng) edit { it.copy(address = g.address, district = g.district) }
            _ui.update { it.copy(geocoding = false) }
        }
    }

    fun setGeoHint(h: String) = _ui.update { it.copy(geoHint = h) }

    // ---------- steps 3–4 ----------

    fun setCategory(id: String) = edit { it.copy(category = id) }
    fun setTitle(t: String) = edit { it.copy(title = t.take(80)) }
    fun setDescription(t: String) = edit { it.copy(description = t.take(500)) }

    fun next(onDone: () -> Unit) {
        val u = _ui.value
        if (!u.ready) return
        if (u.draft.step == 4) {
            submit(onDone)
            return
        }
        edit { it.copy(step = it.step + 1) }
        if (_ui.value.draft.step == 4) findDuplicates()
    }

    /** Back inside the wizard; returns false on the first step (leave the wizard). */
    fun back(): Boolean {
        val s = _ui.value.draft.step
        if (s in 1..4) {
            edit { it.copy(step = s - 1) }
            return true
        }
        return false
    }

    private fun findDuplicates() = viewModelScope.launch {
        val d = _ui.value.draft
        val lat = d.lat ?: return@launch
        val lng = d.lng ?: return@launch
        val cat = d.category ?: return@launch
        _ui.update { it.copy(dups = null) }
        val dups = runCatching { c.repository.backend.nearbyDuplicates(lat, lng, cat) }.getOrElse {
            // Offline: same 30 m rule over the cached feed.
            knownComplaints().filter { it.category == cat && (it.status.isOpen || it.status == ru.sfu.kgp.domain.Status.MODERATION) }
                .map { Duplicate(it.id, it.title, it.status, it.supports, it.address, distM(it.lat, it.lng, lat, lng)) }
                .filter { it.distance <= Krsk.DUP_RADIUS_M }
        }
        _ui.update { it.copy(dups = dups) }
    }

    private fun submit(onDone: () -> Unit) = viewModelScope.launch {
        val d = _ui.value.draft
        val nc = NewComplaint(d.id, d.category ?: return@launch, d.title.trim(), d.description.trim(), d.lat ?: return@launch, d.lng ?: return@launch, d.address, d.district, d.photos)
        _ui.update { it.copy(busy = true) }
        try {
            when (val r = c.repository.submit(nc)) {
                is SubmitResult.Sent -> edit { it.copy(step = 5, createdId = r.id) }
                SubmitResult.SavedOffline -> edit { it.copy(step = 5, savedOffline = true) }
            }
            c.repository.clearWizard()
            onDone()
        } catch (e: Throwable) {
            _ui.update { it.copy(geoHint = "") }
            errors.tryEmit(e.toAppException().message.orEmpty())
        } finally {
            _ui.update { it.copy(busy = false) }
        }
    }

    val errors = kotlinx.coroutines.flow.MutableSharedFlow<String>(extraBufferCapacity = 4)

    companion object {
        const val KEY = "wizard"

        fun factory(c: AppContainer, known: () -> List<Complaint>) = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T =
                CreateViewModel(c, extras.createSavedStateHandle(), known) as T
        }
    }
}
