package com.cardoso.ai;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://abaarso-ai.onrender.com/app";
    private static final String APP_HOST = "abaarso-ai.onrender.com";
    private static final int FILE_CHOOSER_REQ_CODE = 1001;
    private static final int MEDIA_PERM_REQ_CODE = 1002;
    private static final long LOAD_TIMEOUT_MS = 22000L;

    private WebView webView;
    private ProgressBar topProgressBar;
    private LinearLayout splashOverlay;
    private TextView splashStatusText;
    private LinearLayout errorOverlay;
    private TextView errorSubText;

    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingWebPermissionRequest;
    private boolean pageLoadedOnce = false;
    private long lastBackPressedAt = 0L;

    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private final Runnable loadTimeoutRunnable = new Runnable() {
        @Override
        public void run() {
            if (!pageLoadedOnce) {
                showErrorOverlay("Server-ku wuu daahay ama khadka internet-kaaga ayaa gaaban. Fadlan isku day mar kale.");
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#090C12"));
        window.setNavigationBarColor(Color.parseColor("#090C12"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#090C12"));
        root.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        // 1. Main WebView
        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090C12"));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        configureWebView(webView);
        root.addView(webView);

        // 2. Slim top progress bar
        topProgressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        topProgressBar.setMax(100);
        topProgressBar.setProgress(10);
        topProgressBar.setIndeterminate(false);
        FrameLayout.LayoutParams progLp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        progLp.gravity = Gravity.TOP;
        topProgressBar.setLayoutParams(progLp);
        root.addView(topProgressBar);

        // 3. Native Branded Splash Overlay
        splashOverlay = buildSplashOverlay();
        root.addView(splashOverlay);

        // 4. Native Somali Offline / Retry Overlay
        errorOverlay = buildErrorOverlay();
        errorOverlay.setVisibility(View.GONE);
        root.addView(errorOverlay);

        setContentView(root);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            loadAppUrl();
        }
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    private LinearLayout buildSplashOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#090C12"));
        box.setPadding(dp(32), dp(32), dp(32), dp(32));
        box.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(84), dp(84));
        logoLp.bottomMargin = dp(18);
        logo.setLayoutParams(logoLp);
        box.addView(logo);

        TextView title = new TextView(this);
        title.setText("CARDOSO AI");
        title.setTextColor(Color.parseColor("#F3F6FB"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        splashStatusText = new TextView(this);
        splashStatusText.setText("Waa la furayaa App-ka...");
        splashStatusText.setTextColor(Color.parseColor("#94A3B8"));
        splashStatusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        splashStatusText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams stLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        stLp.topMargin = dp(8);
        stLp.bottomMargin = dp(24);
        splashStatusText.setLayoutParams(stLp);
        box.addView(splashStatusText);

        ProgressBar spinner = new ProgressBar(this);
        spinner.setIndeterminate(true);
        LinearLayout.LayoutParams spLp = new LinearLayout.LayoutParams(dp(34), dp(34));
        spinner.setLayoutParams(spLp);
        box.addView(spinner);

        return box;
    }

    private LinearLayout buildErrorOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#090C12"));
        box.setPadding(dp(28), dp(28), dp(28), dp(28));
        box.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        LinearLayout.LayoutParams logoLp = new LinearLayout.LayoutParams(dp(68), dp(68));
        logoLp.bottomMargin = dp(16);
        logo.setLayoutParams(logoLp);
        box.addView(logo);

        TextView heading = new TextView(this);
        heading.setText("Khadka Internet-ku Waa Gaaban Yahay");
        heading.setTextColor(Color.parseColor("#F8FAFC"));
        heading.setTextSize(TypedValue.COMPLEX_UNIT_SP, 19);
        heading.setTypeface(Typeface.DEFAULT_BOLD);
        heading.setGravity(Gravity.CENTER);
        box.addView(heading);

        errorSubText = new TextView(this);
        errorSubText.setText("Fadlan hubi data-daada ama Wi-Fi-gaaga, kadibna guji badhanka hoose.");
        errorSubText.setTextColor(Color.parseColor("#94A3B8"));
        errorSubText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        errorSubText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        subLp.topMargin = dp(10);
        subLp.bottomMargin = dp(24);
        errorSubText.setLayoutParams(subLp);
        box.addView(errorSubText);

        Button retryBtn = new Button(this);
        retryBtn.setText("Isku Day Mar Kale");
        retryBtn.setAllCaps(false);
        retryBtn.setTextColor(Color.WHITE);
        retryBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        retryBtn.setTypeface(Typeface.DEFAULT_BOLD);
        GradientDrawable primaryBg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                new int[]{Color.parseColor("#06B6D4"), Color.parseColor("#2563EB")});
        primaryBg.setCornerRadius(dp(12));
        retryBtn.setBackground(primaryBg);
        retryBtn.setPadding(dp(24), dp(12), dp(24), dp(12));
        LinearLayout.LayoutParams rLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        rLp.bottomMargin = dp(12);
        retryBtn.setLayoutParams(rLp);
        retryBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadAppUrl();
            }
        });
        box.addView(retryBtn);

        Button browserBtn = new Button(this);
        browserBtn.setText("Ku Fur Browser-ka (Chrome)");
        browserBtn.setAllCaps(false);
        browserBtn.setTextColor(Color.parseColor("#CBD5E1"));
        browserBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        GradientDrawable ghostBg = new GradientDrawable();
        ghostBg.setColor(Color.parseColor("#131926"));
        ghostBg.setStroke(dp(1), Color.parseColor("#334155"));
        ghostBg.setCornerRadius(dp(12));
        browserBtn.setBackground(ghostBg);
        browserBtn.setPadding(dp(24), dp(12), dp(24), dp(12));
        browserBtn.setLayoutParams(new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        browserBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(APP_URL));
                    startActivity(i);
                } catch (Exception ignored) {
                }
            }
        });
        box.addView(browserBtn);

        return box;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView wv) {
        WebSettings settings = wv.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        String ua = settings.getUserAgentString();
        if (ua != null) {
            ua = ua.replace("; wv)", ")");
        } else {
            ua = "Mozilla/5.0";
        }
        settings.setUserAgentString(ua + " CardosoAIApp/1.0");

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cm.setAcceptThirdPartyCookies(wv, true);
        }

        wv.addJavascriptInterface(new CardosoAndroidBridge(), "CardosoAndroid");

        wv.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                topProgressBar.setVisibility(View.VISIBLE);
                errorOverlay.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoadedOnce = true;
                uiHandler.removeCallbacks(loadTimeoutRunnable);
                topProgressBar.setVisibility(View.GONE);
                splashOverlay.setVisibility(View.GONE);
                errorOverlay.setVisibility(View.GONE);
                injectBlobDownloadHook(view);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return handleCustomUri(uri);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleCustomUri(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    showErrorOverlay("Internet-ka ama server-ka lama gaari karin. Fadlan hubi khadkaaga oo isku day mar kale.");
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                if (failingUrl != null && failingUrl.contains(APP_HOST)) {
                    showErrorOverlay("Internet-ka ama server-ka lama gaari karin. Fadlan isku day mar kale.");
                }
            }
        });

        wv.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                topProgressBar.setProgress(newProgress);
                if (newProgress >= 55 && splashOverlay.getVisibility() == View.VISIBLE) {
                    pageLoadedOnce = true;
                    uiHandler.removeCallbacks(loadTimeoutRunnable);
                    splashOverlay.setVisibility(View.GONE);
                }
                if (newProgress >= 100) {
                    topProgressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        handleWebRtcPermissionRequest(request);
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(
                    WebView webView,
                    ValueCallback<Uri[]> filePathCallbackArg,
                    FileChooserParams fileChooserParams) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = filePathCallbackArg;
                try {
                    Intent intent = fileChooserParams.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQ_CODE);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Fayl lama furi karin", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        wv.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(
                    String url,
                    String userAgent,
                    String contentDisposition,
                    String mimeType,
                    long contentLength) {
                if (url == null) return;
                if (url.startsWith("blob:") || url.startsWith("data:")) {
                    String fname = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    convertBlobAndSave(url, fname, mimeType != null ? mimeType : "application/octet-stream");
                    return;
                }
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(mimeType);
                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) req.addRequestHeader("cookie", cookies);
                    req.addRequestHeader("User-Agent", userAgent);
                    String filename = URLUtil.guessFileName(url, contentDisposition, mimeType);
                    req.setTitle(filename);
                    req.setDescription("CARDOSO AI Download");
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(req);
                        Toast.makeText(MainActivity.this, "Waa la soo dejinayaa: " + filename, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    } catch (Exception ignored) {
                    }
                }
            }
        });
    }

    private boolean handleCustomUri(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() != null ? uri.getScheme().toLowerCase() : "";
        String host = uri.getHost() != null ? uri.getHost().toLowerCase() : "";

        // Keep CARDOSO AI pages inside the app
        if (("https".equals(scheme) || "http".equals(scheme)) && host.equals(APP_HOST)) {
            if (uri.getPath() != null && uri.getPath().endsWith(".apk")) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (Exception ignored) {
                }
            }
            return false;
        }

        // Open WhatsApp (wa.me), phone calls, mailto, or external websites in native apps
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void handleWebRtcPermissionRequest(PermissionRequest request) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            request.grant(request.getResources());
            return;
        }

        List<String> needed = new ArrayList<>();
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.CAMERA);
            }
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.RECORD_AUDIO);
            }
        }

        if (needed.isEmpty()) {
            request.grant(request.getResources());
        } else {
            pendingWebPermissionRequest = request;
            requestPermissions(needed.toArray(new String[0]), MEDIA_PERM_REQ_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == MEDIA_PERM_REQ_CODE && pendingWebPermissionRequest != null) {
            PermissionRequest req = pendingWebPermissionRequest;
            pendingWebPermissionRequest = null;

            List<String> granted = new ArrayList<>();
            for (String res : req.getResources()) {
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                            || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        granted.add(res);
                    }
                } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                            || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        granted.add(res);
                    }
                } else {
                    granted.add(res);
                }
            }

            if (!granted.isEmpty()) {
                req.grant(granted.toArray(new String[0]));
            } else {
                req.deny();
                Toast.makeText(this, "Ogolaanshaha Camera/Mic ayaa loo baahan yahay Live Call-ka", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ_CODE && filePathCallback != null) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                String dataStr = data.getDataString();
                if (dataStr != null) {
                    results = new Uri[]{Uri.parse(dataStr)};
                }
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    private void injectBlobDownloadHook(WebView view) {
        String js = "(function(){"
                + "if(window.__cardosoBlobHooked)return;window.__cardosoBlobHooked=true;"
                + "document.addEventListener('click',function(e){"
                + "var a=e.target&&e.target.closest?e.target.closest('a[download]'):null;"
                + "if(!a)return;var href=a.getAttribute('href')||'';"
                + "if(href.indexOf('blob:')===0||href.indexOf('data:')===0){"
                + "e.preventDefault();"
                + "var fn=a.getAttribute('download')||'cardoso-file';"
                + "fetch(href).then(function(r){return r.blob();}).then(function(b){"
                + "var rd=new FileReader();rd.onloadend=function(){"
                + "if(window.CardosoAndroid&&rd.result){window.CardosoAndroid.saveBase64File(String(rd.result),fn,b.type||'application/octet-stream');}"
                + "};rd.readAsDataURL(b);}).catch(function(){});"
                + "}},true);})();";
        view.evaluateJavascript(js, null);
    }

    private void convertBlobAndSave(String url, String filename, String mime) {
        String safeUrl = url.replace("'", "\\'");
        String safeName = filename.replace("'", "\\'");
        String safeMime = mime.replace("'", "\\'");
        String js = "fetch('" + safeUrl + "').then(function(r){return r.blob();}).then(function(b){"
                + "var rd=new FileReader();rd.onloadend=function(){"
                + "if(window.CardosoAndroid&&rd.result){window.CardosoAndroid.saveBase64File(String(rd.result),'" + safeName + "',b.type||'" + safeMime + "');}"
                + "};rd.readAsDataURL(b);}).catch(function(){});";
        webView.evaluateJavascript(js, null);
    }

    private class CardosoAndroidBridge {
        @JavascriptInterface
        public void saveBase64File(final String dataUrl, final String filename, final String mimeType) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        int comma = dataUrl.indexOf(',');
                        String b64 = comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl;
                        byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                        String cleanName = (filename == null || filename.trim().isEmpty())
                                ? "CARDOSO_Download.bin"
                                : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                        String mime = (mimeType == null || mimeType.trim().isEmpty())
                                ? "application/octet-stream" : mimeType;

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            ContentValues values = new ContentValues();
                            values.put(MediaStore.Downloads.DISPLAY_NAME, cleanName);
                            values.put(MediaStore.Downloads.MIME_TYPE, mime);
                            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                            Uri itemUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (itemUri != null) {
                                try (OutputStream out = getContentResolver().openOutputStream(itemUri)) {
                                    if (out != null) out.write(bytes);
                                }
                                Toast.makeText(MainActivity.this, "Waa la keydiyay (Downloads): " + cleanName, Toast.LENGTH_LONG).show();
                                if (cleanName.toLowerCase().endsWith(".vcf")) {
                                    try {
                                        Intent openIntent = new Intent(Intent.ACTION_VIEW);
                                        openIntent.setDataAndType(itemUri, "text/x-vcard");
                                        openIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                        startActivity(openIntent);
                                    } catch (Exception ignored) {
                                    }
                                }
                            }
                        } else {
                            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                            if (!dir.exists()) dir.mkdirs();
                            File outFile = new File(dir, cleanName);
                            try (FileOutputStream fos = new FileOutputStream(outFile)) {
                                fos.write(bytes);
                            }
                            Toast.makeText(MainActivity.this, "Waa la keydiyay (Downloads): " + cleanName, Toast.LENGTH_LONG).show();
                        }
                    } catch (Exception e) {
                        Toast.makeText(MainActivity.this, "Faylka lama keydin karin", Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (Exception e) {
            return true;
        }
    }

    private void loadAppUrl() {
        pageLoadedOnce = false;
        errorOverlay.setVisibility(View.GONE);
        splashOverlay.setVisibility(View.VISIBLE);
        splashStatusText.setText("Waa la furayaa CARDOSO AI...");

        if (!isNetworkAvailable()) {
            showErrorOverlay("Internet ma shidna. Fadlan daar Data-da ama Wi-Fi-ga kadibna isku day mar kale.");
            return;
        }

        uiHandler.removeCallbacks(loadTimeoutRunnable);
        uiHandler.postDelayed(loadTimeoutRunnable, LOAD_TIMEOUT_MS);
        webView.loadUrl(APP_URL);
    }

    private void showErrorOverlay(final String message) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                uiHandler.removeCallbacks(loadTimeoutRunnable);
                topProgressBar.setVisibility(View.GONE);
                splashOverlay.setVisibility(View.GONE);
                if (message != null && errorSubText != null) {
                    errorSubText.setText(message);
                }
                errorOverlay.setVisibility(View.VISIBLE);
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPressedAt < 2000L) {
            super.onBackPressed();
        } else {
            lastBackPressedAt = now;
            Toast.makeText(this, "Mar kale guji Back si aad uga baxdo", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(loadTimeoutRunnable);
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
