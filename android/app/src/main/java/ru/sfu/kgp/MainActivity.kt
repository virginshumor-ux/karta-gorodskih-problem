package ru.sfu.kgp

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import kotlinx.coroutines.flow.MutableStateFlow
import ru.sfu.kgp.ui.KgpRoot
import ru.sfu.kgp.ui.MainViewModel
import ru.sfu.kgp.ui.Routes
import ru.sfu.kgp.ui.theme.KgpTheme

/** The single Activity: Compose UI, deep links kgp://auth/callback (OAuth) and kgp://complaint/<id> (notifications). */
class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels { MainViewModel.Factory((application as KgpApp).container) }
    private val pendingRoute = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) handle(intent)
        setContent {
            val s by vm.state.collectAsStateWithLifecycle()
            KgpTheme(s.theme) {
                val nav = rememberNavController()
                val route by pendingRoute.collectAsStateWithLifecycle()
                LaunchedEffect(route) {
                    route?.let { nav.navigate(it); pendingRoute.value = null }
                }
                KgpRoot((application as KgpApp).container, vm, nav)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "kgp") return
        when (uri.host) {
            "auth" -> vm.finishRedirect(uri.getQueryParameter("token_hash"), uri.getQueryParameter("error_description") ?: uri.getQueryParameter("error"))
            "complaint" -> uri.lastPathSegment?.let { pendingRoute.value = Routes.detail(it) }
            "notifications" -> pendingRoute.value = Routes.NOTIF
        }
    }
}
