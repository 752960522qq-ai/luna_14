package com.luna.skyduel;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

public class MainActivity extends Activity {
    private WebView game;
    private boolean foreground;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        game = new WebView(this);
        game.setBackgroundColor(0xff07111d);
        WebSettings settings = game.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        game.setWebChromeClient(new WebChromeClient());
        game.setWebViewClient(new WebViewClientCompat() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }
        });
        setContentView(game);
        game.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }
    @Override public void onBackPressed() {
        game.evaluateJavascript("window.showPause && window.showPause()", null);
    }

    @Override protected void onPause() {
        foreground = false;
        if (game != null) {
            game.evaluateJavascript("window.onNativePause && window.onNativePause()", ignored -> {
                if (!foreground && game != null) {
                    game.onPause();
                    game.pauseTimers();
                }
            });
        }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        foreground = true;
        if (game != null) {
            game.onResume();
            game.resumeTimers();
            game.evaluateJavascript("window.onNativeResume && window.onNativeResume()", null);
        }
    }

    @Override protected void onDestroy() {
        if (game != null) {
            game.evaluateJavascript("window.onNativePause && window.onNativePause()", null);
            game.stopLoading();
            game.loadUrl("about:blank");
            game.destroy();
            game = null;
        }
        super.onDestroy();
    }
}
