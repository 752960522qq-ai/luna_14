package com.luna.skyduel;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.ValueCallback;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

public class MainActivity extends Activity {
    private WebView game;
    private boolean foreground;
    private static final int PROFILE_FILE_REQUEST = 1001;
    private ValueCallback<Uri[]> profileFileCallback;
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
        settings.setAllowContentAccess(true);
        game.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!"https://appassets.androidplatform.net/assets/index.html".equals(view.getUrl()) || params.getMode() != FileChooserParams.MODE_OPEN) {
                    callback.onReceiveValue(null);
                    return true;
                }
                if (profileFileCallback != null) profileFileCallback.onReceiveValue(null);
                profileFileCallback = callback;
                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                picker.addCategory(Intent.CATEGORY_OPENABLE);
                picker.setType("*/*");
                picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(picker, PROFILE_FILE_REQUEST); }
                catch (ActivityNotFoundException error) {
                    profileFileCallback.onReceiveValue(null);
                    profileFileCallback = null;
                    Toast.makeText(MainActivity.this, "未找到文件选择器", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
        });
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
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PROFILE_FILE_REQUEST || profileFileCallback == null) return;
        Uri[] files = null;
        if (resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null && "content".equals(uri.getScheme()) &&
                    checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == PackageManager.PERMISSION_GRANTED) {
                files = new Uri[]{uri};
            }
        }
        ValueCallback<Uri[]> callback = profileFileCallback;
        profileFileCallback = null;
        callback.onReceiveValue(files);
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
        if (profileFileCallback != null) {
            profileFileCallback.onReceiveValue(null);
            profileFileCallback = null;
        }
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
