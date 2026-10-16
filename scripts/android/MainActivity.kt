package io.github.f2illc.lunaos.home.preview

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Keep the WebView viewport clear of system controls, cutouts and the IME.
    // Apply absolute padding on every dispatch rather than accumulating it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val occupied = windowInsets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(occupied.left, occupied.top, occupied.right, occupied.bottom)
      WindowInsetsCompat.CONSUMED
    }
    content.post { ViewCompat.requestApplyInsets(content) }
  }
}
