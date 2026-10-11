package ru.sfu.kgp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import ru.sfu.kgp.AppContainer
import ru.sfu.kgp.BuildConfig
import ru.sfu.kgp.data.DemoBackend
import ru.sfu.kgp.data.ThemeMode
import ru.sfu.kgp.data.WeatherState
import ru.sfu.kgp.domain.AppNotification
import ru.sfu.kgp.domain.AuthState
import ru.sfu.kgp.domain.Category
import ru.sfu.kgp.domain.Complaint
import ru.sfu.kgp.domain.DEFAULT_CATS
import ru.sfu.kgp.domain.Filter
import ru.sfu.kgp.domain.Krsk
import ru.sfu.kgp.domain.Period
import ru.sfu.kgp.domain.Stats
import ru.sfu.kgp.domain.Status
import ru.sfu.kgp.domain.StatusFilter
import ru.sfu.kgp.domain.User
import ru.sfu.kgp.domain.filterComplaints
import ru.sfu.kgp.domain.toAppException
import ru.sfu.kgp.map.MapMode

/** Action to continue after sign-in (the prototype's S.pending). */
sealed interface Pending {
    data object Create : Pending
    data class Act(val action: String, val id: String) : Pending
}

data class UiState(
    val auth: AuthState = AuthState.Guest,
    val complaints: List<Complaint> = emptyList(),
    val cats: List<Category> = DEFAULT_CATS,
    val loading: Boolean = true,
    val offlineSince: Long? = null,
    val filter: Filter = Filter(),
    val search: String = "",
    val selected: String? = null,
    val detail: Complaint? = null,
    val notifications: List<AppNotification> = emptyList(),
    val weather: WeatherState? = null,
    val stats: Stats? = null,
    val mapMode: MapMode = MapMode.PENDING,
    val pendingDrafts: Int = 0,
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val onboardingStep: Int? = null,
    /** Login sheet: null = hidden, else the reason text. */
    val login: String? = null,
    val profileForm: Boolean = false,
    val isDemo: Boolean = false,
) {
    val user: User? get() = (auth as? AuthState.SignedIn)?.user
    val moderator: Boolean get() = user?.isModerator == true
    val unread: Int get() = notifications.count { !it.read }
    fun cat(id: String): Category = cats.firstOrNull { it.id == id } ?: DEFAULT_CATS.firstOrNull { it.id == id } ?: DEFAULT_CATS.last()
    fun find(id: String?): Complaint? = if (id == null) null else if (detail?.id == id) detail else complaints.firstOrNull { it.id == id }
    val visible: List<Complaint> get() = filterComplaints(complaints, filter, search, moderator, { cat(it).name })
}

sealed interface NavEvent {
    data class Detail(val id: String) : NavEvent
    data object Create : NavEvent
    data object Back : NavEvent
    data object Map : NavEvent
    data class OpenUrl(val url: String) : NavEvent
}

class MainViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(UiState(theme = c.settings.theme, isDemo = c.backend.isDemo))
    val state: StateFlow<UiState> = _state.asStateFlow()
    private val _toasts = MutableSharedFlow<String>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val toasts: SharedFlow<String> = _toasts
    private val _nav = MutableSharedFlow<NavEvent>(extraBufferCapacity = 8)
    val nav: SharedFlow<NavEvent> = _nav
    private var pending: Pending? = null
    private var realtime: Job? = null
    private val backend get() = c.repository.backend

    init {
        _state.update { it.copy(weather = runCatching { c.weather.cached() }.getOrNull(), onboardingStep = if (c.settings.onboarded) null else 0) }
        viewModelScope.launch {
            val auth = runCatching { backend.init() }.getOrElse { e -> toast(e.toAppException().message); AuthState.Guest }
            _state.update { it.copy(auth = auth, profileForm = auth is AuthState.NeedsProfile) }
            runCatching { backend.categories() }.onSuccess { cats -> _state.update { it.copy(cats = cats) } }
            refresh()
            loadNotifications()
            listenRealtime()
            flushDrafts()
        }
        viewModelScope.launch { c.weather.fetch()?.let { w -> _state.update { it.copy(weather = w) } } }
    }

    fun toast(msg: String?) {
        if (!msg.isNullOrBlank()) _toasts.tryEmit(msg)
    }

    private suspend fun <T> act(ok: String? = null, block: suspend () -> T): T? = try {
        block().also { toast(ok) }
    } catch (e: Throwable) {
        val err = e.toAppException()
        toast(if (err.offline) "Нет сети — действие не выполнено. Повторите, когда появится связь." else err.message)
        null
    }

    // ---------- data ----------

    fun refresh() = viewModelScope.launch {
        try {
            val f = c.repository.feed()
            _state.update { it.copy(complaints = f.items, offlineSince = f.offlineSince, loading = false) }
            if (f.offlineSince != null) toast("Нет сети — показаны сохранённые обращения")
        } catch (e: Throwable) {
            val err = e.toAppException()
            _state.update { it.copy(loading = false) }
            toast(if (err.offline) "Нет сети. Карта работает, обращения загрузятся при подключении." else err.message)
        }
        _state.update { it.copy(pendingDrafts = c.repository.pendingDrafts()) }
    }

    private suspend fun loadNotifications() {
        val list = runCatching { backend.notifications() }.getOrNull() ?: return
        _state.update { it.copy(notifications = list) }
        list.maxOfOrNull { it.at }?.let { if (it > c.settings.lastNotifiedAt) c.settings.lastNotifiedAt = it }
    }

    private fun listenRealtime() {
        realtime?.cancel()
        if (_state.value.user == null) return
        realtime = viewModelScope.launch {
            runCatching {
                backend.notificationStream().collect { n ->
                    val cat = _state.value.complaints.firstOrNull { it.id == n.complaintId }?.category ?: n.cat.ifEmpty { "other" }
                    _state.update { s -> if (s.notifications.any { it.id == n.id }) s else s.copy(notifications = listOf(n.copy(cat = cat)) + s.notifications) }
                    toast(n.text)
                    refresh()
                }
            }
        }
    }

    fun loadDetail(id: String) = viewModelScope.launch {
        _state.update { it.copy(detail = it.find(id)) }
        runCatching { backend.complaint(id) }.onSuccess { x -> if (x != null) upsert(x) }
    }

    private fun upsert(x: Complaint) = _state.update { s ->
        val merged = s.complaints.map { if (it.id == x.id) x.copy(history = x.history.ifEmpty { it.history }) else it }
        s.copy(
            complaints = if (merged.any { it.id == x.id }) merged else merged + x,
            detail = if (s.detail?.id == x.id || s.detail == null) x.copy(history = x.history.ifEmpty { s.detail?.history.orEmpty() }) else s.detail,
        )
    }

    private suspend fun reload(id: String) {
        runCatching { backend.complaint(id) }.getOrNull()?.let(::upsert)
    }

    fun loadStats() = viewModelScope.launch {
        _state.update { it.copy(stats = null) }
        act { backend.stats() }?.let { st -> _state.update { it.copy(stats = st) } }
    }

    fun refreshWeather() = viewModelScope.launch {
        toast("Обновляем погоду…")
        c.weather.fetch()?.let { w -> _state.update { it.copy(weather = w) } } ?: toast("Нет сети — показаны сохранённые данные")
    }

    fun flushDrafts() = viewModelScope.launch {
        if (backend.isDemo || _state.value.user == null) return@launch
        val sent = c.repository.flushDrafts { title, err -> toast("Черновик «$title» не принят: $err") }
        sent.forEach { toast("Черновик «$it» отправлен на модерацию") }
        if (sent.isNotEmpty()) refresh()
        _state.update { it.copy(pendingDrafts = c.repository.pendingDrafts()) }
    }

    // ---------- filters, map ----------

    fun setStatusFilter(s: StatusFilter) = _state.update { it.copy(filter = it.filter.copy(status = s)) }
    fun toggleMine() = _state.update { it.copy(filter = it.filter.copy(mine = !it.filter.mine)) }
    fun toggleCat(id: String) = _state.update { it.copy(filter = it.filter.copy(cats = if (id in it.filter.cats) it.filter.cats - id else it.filter.cats + id)) }
    fun setDistrict(d: String) = _state.update { it.copy(filter = it.filter.copy(district = d)) }
    fun setPeriod(p: Period) = _state.update { it.copy(filter = it.filter.copy(period = p)) }
    fun setSearch(q: String) = _state.update { it.copy(search = q) }
    fun resetFilters() = _state.update { it.copy(filter = Filter(status = StatusFilter.ALL), search = "") }
    fun select(id: String?) = _state.update { it.copy(selected = id) }
    fun setMapMode(m: MapMode) = _state.update { it.copy(mapMode = m) }

    // ---------- onboarding, auth ----------

    fun onboardingNext(step: Int) {
        if (step >= 3) {
            c.settings.onboarded = true
            _state.update { it.copy(onboardingStep = null, login = if (it.user == null) "" else null) }
        } else _state.update { it.copy(onboardingStep = step) }
    }

    fun openLogin(reason: String = "", p: Pending? = null) {
        pending = p
        _state.update { it.copy(login = reason) }
    }

    fun closeLogin() {
        pending = null
        _state.update { it.copy(login = null) }
    }

    fun requestCreate() {
        if (_state.value.user == null) openLogin("Чтобы сообщить о проблеме, войдите — так вы получите уведомления о статусе.", Pending.Create)
        else _nav.tryEmit(NavEvent.Create)
    }

    fun providerAvailable(provider: String) = backend.providerAvailable(provider)

    fun demoLogin() = viewModelScope.launch { act { backend.signInDemo() }?.let(::applyAuth) }

    fun providerLogin(provider: String) {
        val url = backend.oauthStartUrl(provider)
        if (url == null) {
            toast(if (backend.isDemo) "Вход через внешние сервисы работает после подключения сервера. Используйте демо-вход." else "Вход через ${if (provider == "vk") "VK ID" else "Яндекс ID"} ещё настраивается. Используйте демо-вход.")
            return
        }
        c.settings.pendingAction = when (val p = pending) {
            Pending.Create -> "create"
            is Pending.Act -> "${p.action}:${p.id}"
            null -> null
        }
        _nav.tryEmit(NavEvent.OpenUrl(url))
    }

    fun finishRedirect(tokenHash: String?, error: String?) = viewModelScope.launch {
        c.settings.onboarded = true
        _state.update { it.copy(onboardingStep = null) }
        pending = when (val p = c.settings.pendingAction) {
            null -> null
            "create" -> Pending.Create
            else -> p.split(":", limit = 2).let { Pending.Act(it[0], it.getOrElse(1) { "" }) }
        }
        c.settings.pendingAction = null
        act { backend.finishRedirect(tokenHash, error) }?.let(::applyAuth)
    }

    fun completeProfile(nick: String, consent: Boolean) = viewModelScope.launch {
        if (nick.trim().length < 3) return@launch toast("Никнейм — от 3 символов")
        if (!consent) return@launch toast("Отметьте согласие на обработку персональных данных")
        act { backend.completeProfile(nick.trim(), true) }?.let(::applyAuth)
    }

    fun cancelProfile() = viewModelScope.launch {
        runCatching { backend.signOut() }
        _state.update { it.copy(auth = AuthState.Guest, profileForm = false) }
    }

    private fun applyAuth(st: AuthState) {
        _state.update { it.copy(auth = st, profileForm = st is AuthState.NeedsProfile, login = if (st is AuthState.SignedIn) null else it.login) }
        val u = (st as? AuthState.SignedIn)?.user ?: return
        toast("Добро пожаловать, ${u.nick}!")
        viewModelScope.launch {
            refresh().join()
            loadNotifications()
            listenRealtime()
            flushDrafts()
            when (val p = pending) {
                Pending.Create -> _nav.tryEmit(NavEvent.Create)
                is Pending.Act -> runAction(p.action, p.id)
                null -> Unit
            }
            pending = null
        }
    }

    fun logout() = viewModelScope.launch {
        runCatching { backend.signOut() }
        realtime?.cancel()
        _state.update { it.copy(auth = AuthState.Guest, notifications = emptyList()) }
        toast("Вы вышли из учётной записи")
        refresh()
    }

    fun deleteAccount() = viewModelScope.launch {
        toast("Удаляем учётную запись…")
        if (act("Учётная запись и ваши данные удалены") { backend.deleteAccount() } != null) {
            realtime?.cancel()
            _state.update { it.copy(auth = AuthState.Guest, notifications = emptyList()) }
            refresh()
            _nav.tryEmit(NavEvent.Map)
        }
    }

    // ---------- citizen actions ----------

    private val needsLogin = mapOf(
        "support" to "Войдите, чтобы поддержать обращение.",
        "confirm" to "Войдите, чтобы подтвердить решение.",
        "notfixed" to "Войдите, чтобы отметить, что проблема не решена.",
        "report" to "Войдите, чтобы пожаловаться на обращение.",
    )

    /** Returns false when the user must sign in first (the action continues automatically afterwards). */
    fun requireUser(action: String, id: String): Boolean {
        if (_state.value.user != null) return true
        openLogin(needsLogin[action] ?: "", Pending.Act(action, id))
        return false
    }

    fun runAction(action: String, id: String, arg: String? = null) {
        if (!requireUser(action, id)) return
        viewModelScope.launch {
            val x = _state.value.find(id) ?: return@launch
            when (action) {
                "support" -> {
                    val on = !x.supportedByMe
                    act(if (on) "Вы поддержали обращение. Сообщим об изменениях статуса." else "Поддержка отменена") { backend.setSupport(id, on) }
                        ?.let { n -> upsert(x.copy(supports = n, supportedByMe = on)) }
                }
                "confirm" -> act { backend.confirm(id, true) }?.let { (st, n) ->
                    toast(if (st == Status.RESOLVED) "Проблема отмечена как решённая" else "Спасибо! Подтверждений: $n из ${Krsk.CONFIRM_NEED}")
                    reload(id)
                }
                "notfixed" -> act("Обращение снова в списке актуальных") { backend.confirm(id, false) }?.let { reload(id) }
                "report" -> if (arg != null) act("Жалоба отправлена модератору. Спасибо!") { backend.report(id, arg) }
                "marksent" -> act("Статус: передано в организацию") { backend.markSent(id) }?.let { reload(id); _nav.tryEmit(NavEvent.Back) }
                "after" -> if (arg != null) act("Фото «после» отправлено модератору. Жители смогут подтвердить решение.") { backend.addAfterPhoto(id, arg) }?.let { reload(id) }
            }
        }
    }

    fun supportDuplicate(id: String) = viewModelScope.launch {
        val x = _state.value.find(id)
        if (x != null && !x.supportedByMe) act { backend.setSupport(id, true) }?.let { upsert(x.copy(supports = it, supportedByMe = true)) } ?: return@launch
        toast("Спасибо! Вы поддержали существующее обращение.")
        _nav.tryEmit(NavEvent.Detail(id))
    }

    fun onCreated() {
        refresh()
        viewModelScope.launch { loadNotifications() }
    }

    // ---------- notifications ----------

    fun openNotifications() = viewModelScope.launch { loadNotifications() }

    fun readAll() = viewModelScope.launch {
        _state.update { s -> s.copy(notifications = s.notifications.map { it.copy(read = true) }) }
        act { backend.markRead(null) }
    }

    fun openNotification(n: AppNotification) {
        _state.update { s -> s.copy(notifications = s.notifications.map { if (it.id == n.id) it.copy(read = true) else it }) }
        viewModelScope.launch { runCatching { backend.markRead(listOf(n.id)) } }
        n.complaintId?.let { _nav.tryEmit(NavEvent.Detail(it)) }
    }

    // ---------- moderation ----------

    fun moderate(id: String, status: Status, comment: String? = null) = viewModelScope.launch {
        act("Статус изменён: ${status.title}") { backend.moderateStatus(id, status, comment) }?.let { reload(id) }
    }

    fun markDuplicate(id: String, original: String) = viewModelScope.launch {
        act("Обращения объединены") { backend.markDuplicate(id, original) }?.let { refresh(); reload(id) }
    }

    fun reviewAfter(complaintId: String, photoId: String, approve: Boolean) = viewModelScope.launch {
        act(if (approve) "Фото одобрено — обращение решено" else "Фото отклонено") { backend.reviewAfterPhoto(photoId, approve) }?.let { reload(complaintId) }
    }

    // ---------- settings ----------

    fun cycleTheme() {
        val next = ThemeMode.entries[(c.settings.theme.ordinal + 1) % ThemeMode.entries.size]
        c.settings.theme = next
        _state.update { it.copy(theme = next) }
    }

    fun toggleNotify() = viewModelScope.launch {
        val u = _state.value.user ?: return@launch
        act(if (!u.notifyEnabled) "Уведомления включены" else "Уведомления выключены") { backend.updateSettings(!u.notifyEnabled) }
            ?.let { nu -> _state.update { it.copy(auth = AuthState.SignedIn(nu)) } }
    }

    fun toggleDemoModerator() = viewModelScope.launch {
        val b = backend as? DemoBackend ?: return@launch
        b.setModerator(!b.moderatorMode)
        _state.update { it.copy(auth = b.init()) }
    }

    fun resetDemo() = viewModelScope.launch {
        (backend as? DemoBackend)?.resetDemo() ?: return@launch
        refresh().join()
        loadNotifications()
        toast("Демо-данные восстановлены")
    }

    val privacyText: String get() = c.privacyText
    val version: String get() = "${BuildConfig.VERSION_NAME} от ${BuildConfig.BUILD_DATE}"
    val siteUrl: String get() = BuildConfig.SITE_URL

    class Factory(private val c: AppContainer) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = MainViewModel(c) as T
    }
}
