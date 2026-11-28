"use strict";
/*
 * Make It a Quote — Webメーカー: 画面まわり（入力・生成・ダウンロード）と
 * 隠し機能・テーマの配線。描画そのものは js/quote.js（MiaqQuote）が担う。
 * すべてクライアントサイドで処理し、画像をサーバーへ送信しない
 * （隠し機能の照会に送られるのは入力したユーザーIDだけ）。
 */
var Q = window.MiaqQuote;

// ==========================================
// 📥 フォント読み込み
// ==========================================
var fontsReadyPromise = null;
function ensureFonts() {
  if (fontsReadyPromise) return fontsReadyPromise;
  fontsReadyPromise = (async function () {
    if (!("FontFace" in window)) return;
    var serif = new FontFace(Q.SERIF, "url(fonts/ZenOldMincho-Regular.ttf)");
    var sans = new FontFace(Q.SANS, "url(fonts/NotoSansJP-Regular.ttf)");
    var loaded = await Promise.all([serif.load(), sans.load()]);
    loaded.forEach(function (face) { document.fonts.add(face); });
    // 🔤 Canvas の計測前にフォントが使える状態まで待つ
    await document.fonts.load('62px "' + Q.SERIF + '"');
    await document.fonts.load('17px "' + Q.SANS + '"');
  })();
  return fontsReadyPromise;
}

// ==========================================
// 📌 UI の状態と要素
// ==========================================
var els = {};
var state = {
  avatarImage: null, // HTMLImageElement | HTMLCanvasElement | null
  avatarObjectUrl: null,
  generated: false,
  downloadUrl: null
};

function $(id) { return document.getElementById(id); }

function createCanvas() { return document.createElement("canvas"); }

// 💬 ステータスメッセージを表示する
function setStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.classList.toggle("error", !!isError);
}

// 🔢 引用文の文字数表示を更新する（戻り値: 上限内なら true）
function updateCharCount() {
  var len = Q.quoteTextLength(els.quoteText.value);
  els.charCount.textContent = String(len);
  var over = len > Q.MAX_QUOTE_TEXT_LENGTH;
  els.charWarn.hidden = !over;
  els.charCount.parentElement.classList.toggle("over", over);
  return !over;
}

// 👤 アバター未設定時の頭文字プレビューを更新する
function updateAvatarPreviewInitial() {
  if (state.avatarImage) return;
  var name = els.displayName.value.trim();
  els.avatarPreviewInitial.textContent = name ? Q.initialOf(name) : "？";
  els.avatarPreview.style.display = "";
  var img = els.avatarPreview.querySelector("img");
  if (img) img.remove();
}

// 🖼️ アバター画像を設定する
function setAvatarImage(img, fileName) {
  state.avatarImage = img;
  els.clearAvatarBtn.disabled = false;
  els.avatarFileName.textContent = fileName || "選択済み";
  var prevImg = els.avatarPreview.querySelector("img");
  if (prevImg) prevImg.remove();
  if (img && img.tagName === "IMG") {
    var clone = document.createElement("img");
    clone.src = img.src;
    clone.alt = "";
    els.avatarPreview.appendChild(clone);
    els.avatarPreviewInitial.style.display = "none";
  }
}

// 🗑️ アバター画像を消す
function clearAvatar() {
  state.avatarImage = null;
  if (state.avatarObjectUrl) {
    URL.revokeObjectURL(state.avatarObjectUrl);
    state.avatarObjectUrl = null;
  }
  els.avatarInput.value = "";
  els.clearAvatarBtn.disabled = true;
  els.avatarFileName.textContent = "未選択（プレースホルダ使用）";
  var img = els.avatarPreview.querySelector("img");
  if (img) img.remove();
  els.avatarPreviewInitial.style.display = "";
  updateAvatarPreviewInitial();
}

// 📥 アバター画像ファイルを読み込む
function loadAvatarFile(file) {
  if (!file) return;
  if (!file.type || file.type.indexOf("image/") !== 0) {
    setStatus("画像ファイルを選択してください。", true);
    return;
  }
  if (state.avatarObjectUrl) URL.revokeObjectURL(state.avatarObjectUrl);
  var url = URL.createObjectURL(file);
  state.avatarObjectUrl = url;
  var img = new Image();
  img.onload = function () {
    setAvatarImage(img, file.name);
    setStatus("アバター画像を読み込みました。「画像を生成」を押してください。", false);
  };
  img.onerror = function () {
    setStatus("画像の読み込みに失敗しました。別のファイルで試してください。", true);
  };
  img.src = url;
}

// ✨ 引用画像を生成する
async function generate(useSampleDummy) {
  var ok = updateCharCount();
  var text = els.quoteText.value;
  if (!text.trim()) {
    setStatus("引用文を入力してください。", true);
    els.quoteText.focus();
    return;
  }
  if (!ok) {
    setStatus("引用文は300文字以内にしてください。", true);
    return;
  }
  var displayName = els.displayName.value.trim() || "名無し";
  var username = Q.normalizeUsername(els.username.value) || "unknown";

  els.generateBtn.disabled = true;
  setStatus("生成中…", false);
  try {
    await ensureFonts();
    // 🎨 フォント適用を確実にするため、描画前に document.fonts.ready も待つ
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    var avatar;
    if (state.avatarImage) {
      avatar = state.avatarImage;
    } else if (useSampleDummy) {
      avatar = Q.dummyAvatar(createCanvas);
    } else {
      avatar = Q.fallbackAvatar(displayName, createCanvas);
    }

    Q.renderQuoteImage(els.canvas, {
      text: text,
      displayName: displayName,
      username: username,
      avatar: avatar
    }, createCanvas);

    state.generated = true;
    els.emptyHint.classList.add("hidden");
    els.regenerateBtn.disabled = false;

    // 🔁 先にダウンロードを無効化し、PNG 化できてから差し替える
    if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
    state.downloadUrl = null;
    els.downloadBtn.classList.add("disabled");
    els.downloadBtn.setAttribute("aria-disabled", "true");

    els.canvas.toBlob(function (blob) {
      if (!blob) {
        setStatus("画像は表示されましたが、PNGの作成に失敗しました。", true);
        return;
      }
      state.downloadUrl = URL.createObjectURL(blob);
      els.downloadBtn.href = state.downloadUrl;
      els.downloadBtn.download = Q.downloadFileName(username);
      els.downloadBtn.classList.remove("disabled");
      els.downloadBtn.setAttribute("aria-disabled", "false");
      setStatus("生成しました。プレビューを確認して「PNGをダウンロード」を押してください。", false);
    }, "image/png");
  } catch (err) {
    console.error(err);
    setStatus("生成に失敗しました: " + (err && err.message ? err.message : err), true);
  } finally {
    els.generateBtn.disabled = false;
  }
}

// 🧪 サンプル文言を入力欄に入れて生成する
function fillSample() {
  els.displayName.value = "まぶ";
  els.username.value = "xx_mabu_xx";
  els.quoteText.value = "明日から本気出すって、昨日も言ってた気がするんだよな";
  updateCharCount();
  updateAvatarPreviewInitial();
  // 🖼️ アバター未指定ならサンプルと同じダミーシルエットで生成する
  generate(!state.avatarImage);
}

// 🚀 初期化
function init() {
  els.dropZone = $("dropZone");
  els.avatarInput = $("avatarInput");
  els.avatarPreview = $("avatarPreview");
  els.avatarPreviewInitial = $("avatarPreviewInitial");
  els.clearAvatarBtn = $("clearAvatarBtn");
  els.avatarFileName = $("avatarFileName");
  els.displayName = $("displayName");
  els.username = $("username");
  els.quoteText = $("quoteText");
  els.charCount = $("charCount");
  els.charWarn = $("charWarn");
  els.sampleBtn = $("sampleBtn");
  els.generateBtn = $("generateBtn");
  els.regenerateBtn = $("regenerateBtn");
  els.downloadBtn = $("downloadBtn");
  els.canvas = $("quoteCanvas");
  els.emptyHint = $("emptyHint");
  els.status = $("statusMsg");

  // 📝 初期キャンバスは黒背景にしておく（生成画像の背景色と同じ）
  var ctx = els.canvas.getContext("2d");
  ctx.fillStyle = Q.BG;
  ctx.fillRect(0, 0, Q.IMAGE_WIDTH, Q.IMAGE_HEIGHT);

  els.dropZone.addEventListener("click", function () { els.avatarInput.click(); });
  els.dropZone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      els.avatarInput.click();
    }
  });
  els.avatarInput.addEventListener("change", function () {
    loadAvatarFile(els.avatarInput.files && els.avatarInput.files[0]);
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropZone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    els.dropZone.addEventListener(ev, function (e) {
      e.preventDefault();
      els.dropZone.classList.remove("dragover");
    });
  });
  els.dropZone.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    loadAvatarFile(file);
  });

  els.clearAvatarBtn.addEventListener("click", clearAvatar);
  els.displayName.addEventListener("input", updateAvatarPreviewInitial);
  els.quoteText.addEventListener("input", updateCharCount);
  els.generateBtn.addEventListener("click", function () { generate(false); });
  els.regenerateBtn.addEventListener("click", function () { generate(false); });
  els.sampleBtn.addEventListener("click", fillSample);
  els.downloadBtn.addEventListener("click", function (e) {
    if (els.downloadBtn.classList.contains("disabled")) e.preventDefault();
  });

  updateCharCount();
  updateAvatarPreviewInitial();
  initSecret();

  ensureFonts()
    .then(function () { setStatus("準備できました。入力して「画像を生成」を押してください。", false); })
    .catch(function (err) {
      console.error(err);
      setStatus("フォントの読み込みに失敗しました。再読み込みしてください。", true);
    });
}

// ==========================================
// 🤫 隠し機能: Discord アイコン取得
// ==========================================
// 📝 通常の画面には出ないパネル。出し方は3通り:
// (1) キーボードで「discord」と打つ (2) フッターのクレジットを2秒以内に5回タップ
// (3) URL パラメータ ?uid=<ユーザーID>（開いて自動取得まで行う）
// ユーザー情報の照会には外部API（japi.rest）を使い、画像は Discord CDN から
// 直接読み込む（CDN は CORS 許可済みのため Canvas が汚染されない）。
// 照会に送られるのは入力したユーザーIDだけ。

// 💬 隠しパネルのステータスを表示する
function setSecretStatus(msg, isError) {
  els.secretStatus.textContent = msg;
  els.secretStatus.classList.toggle("error", !!isError);
}

// 🤫 隠しパネルの表示・非表示を切り替える
function toggleSecretPanel(show) {
  var willShow = typeof show === "boolean" ? show : els.secretPanel.hidden;
  els.secretPanel.hidden = !willShow;
  if (willShow) els.secretUserId.focus();
}

// 🌐 Discord のアバター画像を取得する
async function fetchDiscordAvatar() {
  var id = els.secretUserId.value.trim();
  if (!/^\d{17,20}$/.test(id)) {
    setSecretStatus("ユーザーIDは17〜20桁の数字で入力してください。", true);
    return;
  }
  els.secretFetchBtn.disabled = true;
  setSecretStatus("Discord のユーザー情報を照会中…", false);
  var data;
  try {
    var res = await fetch("https://japi.rest/discord/v1/user/" + id);
    var json = await res.json();
    data = json && json.data;
  } catch (e) {
    setSecretStatus("照会に失敗しました。通信環境を確認してもう一度お試しください。", true);
    els.secretFetchBtn.disabled = false;
    return;
  }
  if (!data || !data.id || data.message) {
    setSecretStatus("そのユーザーIDは見つかりませんでした。", true);
    els.secretFetchBtn.disabled = false;
    return;
  }
  var fullUrl = Q.discordAvatarUrl(data, 4096);
  var img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    setAvatarImage(img, "Discord: " + data.username);
    els.displayName.value = data.global_name || data.username || "";
    els.username.value = data.username || "";
    els.secretAvatarLink.href = fullUrl;
    els.secretLinks.hidden = false;
    setSecretStatus("「" + (data.global_name || data.username) + "」のアイコンを設定しました。表示名とユーザー名も反映しています。", false);
    setStatus("Discord のアイコンを読み込みました。「画像を生成」を押してください。", false);
    els.secretFetchBtn.disabled = false;
  };
  img.onerror = function () {
    setSecretStatus("アイコン画像の読み込みに失敗しました。", true);
    els.secretFetchBtn.disabled = false;
  };
  img.src = Q.discordAvatarUrl(data, 1024);
}

// 🤫 隠し機能（Discord アイコン取得）の初期化
function initSecret() {
  els.secretPanel = $("secretPanel");
  els.secretUserId = $("secretUserId");
  els.secretFetchBtn = $("secretFetchBtn");
  els.secretStatus = $("secretStatus");
  els.secretLinks = $("secretLinks");
  els.secretAvatarLink = $("secretAvatarLink");

  els.secretFetchBtn.addEventListener("click", fetchDiscordAvatar);
  els.secretUserId.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      fetchDiscordAvatar();
    }
  });

  // ⌨️ トリガー1: キーボードで「discord」と打つ（入力欄にフォーカスがある時を除く）
  var seq = "";
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key && e.key.length === 1) {
      seq = (seq + e.key.toLowerCase()).slice(-7);
      if (seq === "discord") {
        toggleSecretPanel();
        seq = "";
      }
    }
  });

  // 👆 トリガー2: フッターのクレジットを2秒以内に5回タップ/クリック
  var taps = [];
  var trigger = $("secretTrigger");
  if (trigger) {
    trigger.addEventListener("click", function () {
      var now = Date.now();
      taps = taps.filter(function (t) { return now - t < 2000; });
      taps.push(now);
      if (taps.length >= 5) {
        toggleSecretPanel();
        taps = [];
      }
    });
  }

  // 📥 トリガー3: ?uid=<ユーザーID> で開いて自動取得
  var uid = new URLSearchParams(location.search).get("uid");
  if (uid && /^\d{17,20}$/.test(uid)) {
    els.secretUserId.value = uid;
    toggleSecretPanel(true);
    fetchDiscordAvatar();
  }
}

// ==========================================
// 🌙 テーマ（ダーク/ライト）
// ==========================================
(function initTheme() {
  var root = document.documentElement;
  if (!root || !root.getAttribute || !root.setAttribute) return;
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
  }
  // head 内の先行スクリプトで data-theme が付いていればそれを優先する
  var current = root.getAttribute("data-theme");
  if (current !== "light" && current !== "dark") {
    try { current = localStorage.getItem("miaq-theme"); } catch (e) { current = null; }
  }
  apply(current === "light" ? "light" : "dark");
  var btn = document.getElementById("themeToggle");
  if (btn && btn.addEventListener) {
    btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next);
      try { localStorage.setItem("miaq-theme", next); } catch (e) { /* 保存できなくても切り替え自体は有効 */ }
    });
  }
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
