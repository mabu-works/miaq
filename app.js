"use strict";
/*
 * Make It a Quote — Webメーカー
 * Bot版 (~/workspace/makeitaquote-bot/src/quote/renderer.ts, wrap.ts) の
 * 描画ロジックをブラウザ Canvas に移植したもの。
 * レイアウト定数・グレースケール式・禁則処理・フォントサイズ候補は Bot版と同一。
 * すべてクライアントサイドで処理し、画像をサーバーへ送信しない。
 */

// ===== 1. レイアウト定数 (Bot版 renderer.ts と同一) =====
var IMAGE_WIDTH = 1200;
var IMAGE_HEIGHT = 630;

var BG = "#000000";
var TEXT = "#f7f5f0";
var NAME_TEXT = "#efefef";
var SUB_TEXT = "#a3a3ab";
var CREDIT = "#6f6f76";

var AVATAR_WIDTH = 640; // アバター領域 (左端から)。右端はフェードで隠れる
var TEXT_CENTER_X = 862; // 本文ブロックの中心
var TEXT_WIDTH = 596; // 本文の最大幅 (564..1160)
var QUOTE_MAX_HEIGHT = 372; // 引用文ブロックの最大の高さ

var SERIF = "QuoteSerif"; // Zen Old Mincho (引用文・発言者名)
var SANS = "NotoJP"; // Noto Sans JP (クレジット)

var MAX_QUOTE_TEXT_LENGTH = 300;

// ===== 2. テキスト折り返し (Bot版 wrap.ts の移植) =====
// 行頭に置けない文字 (句読点・閉じ括弧・長音など)
var NO_LINE_START = "、。，．！？：；）」』】〉》ー〜…‥・ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ";
// 行末に残せない文字 (開き括弧)
var NO_LINE_END = "（「『【〈《";

function wrapText(text, maxWidth, measure) {
  var lines = [];
  var paragraphs = text.split(/\r?\n/);
  for (var p = 0; p < paragraphs.length; p++) {
    var paragraph = paragraphs[p];
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    var line = "";
    // for...of はコードポイント単位で回す (Bot版の for (const ch of ...) と同じ)
    for (var ch of paragraph) {
      if (line === "") {
        // 行頭の空白は捨てる
        if (ch === " " || ch === "　") continue;
        line = ch;
        continue;
      }
      if (measure(line + ch) <= maxWidth) {
        line += ch;
        continue;
      }
      // ここで折り返しが発生する
      if (NO_LINE_START.indexOf(ch) !== -1) {
        // 行頭禁則: その文字は前の行に追い込む (多少はみ出しても崩さない)
        line += ch;
        continue;
      }
      var last = line[line.length - 1];
      if (NO_LINE_END.indexOf(last) !== -1 && line.length >= 2) {
        // 行末禁則: 開き括弧は次の行へ送る
        lines.push(line.slice(0, -1));
        line = last + ch;
        continue;
      }
      lines.push(line);
      line = ch === " " || ch === "　" ? "" : ch;
    }
    if (line !== "" || lines.length === 0) lines.push(line);
  }
  return lines;
}

function fitQuoteText(text, opts) {
  var sizes = opts.sizes.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < sizes.length; i++) {
    var size = sizes[i];
    var lines = wrapText(text, opts.maxWidth, opts.measureAt(size));
    var lineHeight = Math.round(size * opts.lineHeightRatio);
    if (lines.length * lineHeight <= opts.maxHeight) {
      return { fontSize: size, lines: lines, lineHeight: lineHeight };
    }
  }
  var minSize = sizes[sizes.length - 1];
  var minLineHeight = Math.round(minSize * opts.lineHeightRatio);
  var maxLines = Math.max(1, Math.floor(opts.maxHeight / minLineHeight));
  var measure = opts.measureAt(minSize);
  var sliced = wrapText(text, opts.maxWidth, measure).slice(0, maxLines);
  // 最終行に … を付ける (幅に収まるまで末尾を削る)
  var lastLine = sliced[sliced.length - 1];
  while (lastLine.length > 0 && measure(lastLine + "…") > opts.maxWidth) {
    lastLine = lastLine.slice(0, -1);
  }
  sliced[sliced.length - 1] = lastLine + "…";
  return { fontSize: minSize, lines: sliced, lineHeight: minLineHeight };
}

// ===== 3. フォント読み込み =====
var fontsReadyPromise = null;
function ensureFonts() {
  if (fontsReadyPromise) return fontsReadyPromise;
  fontsReadyPromise = (async function () {
    if (!("FontFace" in window)) return;
    var serif = new FontFace(SERIF, "url(fonts/ZenOldMincho-Regular.ttf)");
    var sans = new FontFace(SANS, "url(fonts/NotoSansJP-Regular.ttf)");
    var loaded = await Promise.all([serif.load(), sans.load()]);
    loaded.forEach(function (face) { document.fonts.add(face); });
    // Canvas の計測前にフォントが使える状態まで待つ
    await document.fonts.load('62px "' + SERIF + '"');
    await document.fonts.load('17px "' + SANS + '"');
  })();
  return fontsReadyPromise;
}

// ===== 4. グレースケール化 (Bot版 grayscaleAvatarCanvas の移植) =====
// アバター領域サイズのオフスクリーンに cover で描き、画素をグレースケール化する。
// 計算式: g = 0.299R + 0.587G + 0.114B, コントラスト (g-128)*1.06+128
function grayscaleAvatarCanvas(avatar) {
  var w = AVATAR_WIDTH;
  var h = IMAGE_HEIGHT;
  var off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  var ctx = off.getContext("2d");
  var srcW = avatar.width || avatar.naturalWidth;
  var srcH = avatar.height || avatar.naturalHeight;
  var scale = Math.max(w / srcW, h / srcH);
  var dw = srcW * scale;
  var dh = srcH * scale;
  ctx.drawImage(avatar, (w - dw) / 2, (h - dh) / 2, dw, dh);
  var data = ctx.getImageData(0, 0, w, h);
  var px = data.data;
  for (var i = 0; i < px.length; i += 4) {
    var g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    g = Math.max(0, Math.min(255, (g - 128) * 1.06 + 128)); // わずかにコントラストを上げる
    px[i] = g;
    px[i + 1] = g;
    px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return off;
}

// ===== 5. アバター未指定時の代替画像 (Bot版 fallbackAvatar の移植) =====
// 名前のハッシュで決まる色のグラデーション + 頭文字。
// この後グレースケール化されるため、最終画像ではモノクロになる (Bot版と同じ)。
function fallbackAvatar(displayName) {
  var size = 630;
  var c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  var ctx = c.getContext("2d");
  var hash = 0;
  for (var ch of displayName) hash = (hash * 31 + ch.codePointAt(0)) % 360;
  var grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "hsl(" + hash + ", 32%, 30%)");
  grad.addColorStop(1, "hsl(" + ((hash + 40) % 360) + ", 36%, 16%)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  var initial = Array.from(displayName)[0] || "?";
  ctx.fillStyle = "rgba(245,243,236,0.92)";
  ctx.font = '300px "' + SANS + '"';
  var w = ctx.measureText(initial).width;
  ctx.fillText(initial, (size - w) / 2, size / 2 + 108);
  return c;
}

// サンプル用ダミーアバター (Bot版 sample.ts の dummyAvatar の移植)
function dummyAvatar() {
  var s = 630;
  var c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  var ctx = c.getContext("2d");
  var grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, "#8a93a5");
  grad.addColorStop(1, "#4a5064");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#2c2f38";
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.42, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.98, s * 0.34, s * 0.30, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  return c;
}

// ===== 6. 描画本体 (Bot版 renderQuoteImage の移植) =====
function renderQuoteImage(canvas, input) {
  var ctx = canvas.getContext("2d");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;

  // 背景
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  // アバター (グレースケール) と、右へ向けて黒に消えるグラデーション
  ctx.drawImage(grayscaleAvatarCanvas(input.avatar), 0, 0);
  var fade = ctx.createLinearGradient(280, 0, 620, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, BG);
  ctx.fillStyle = fade;
  ctx.fillRect(280, 0, IMAGE_WIDTH - 280, IMAGE_HEIGHT);

  // 引用文 (明朝・中央寄せ・サイズ自動調整)
  function measureAt(size) {
    return function (s) {
      ctx.font = size + 'px "' + SERIF + '"';
      return ctx.measureText(s).width;
    };
  }
  var fit = fitQuoteText(input.text, {
    maxWidth: TEXT_WIDTH,
    maxHeight: QUOTE_MAX_HEIGHT,
    sizes: [62, 56, 50, 44, 38, 32, 27],
    lineHeightRatio: 1.42,
    measureAt: measureAt
  });

  // 引用文 + 発言者ブロック全体を縦中央に配置する
  var NAME_SIZE = 29;
  var USER_SIZE = 22;
  var quoteBlock = fit.lines.length * fit.lineHeight;
  var totalHeight = quoteBlock + 44 + NAME_SIZE + 12 + USER_SIZE;
  var top = (IMAGE_HEIGHT - totalHeight) / 2;

  ctx.font = fit.fontSize + 'px "' + SERIF + '"';
  ctx.fillStyle = TEXT;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fit.lines.forEach(function (line, i) {
    var y = top + fit.lineHeight * (i + 0.78);
    ctx.fillText(line, TEXT_CENTER_X, y);
  });

  // 発言者: 「- 表示名」(わずかに斜体) と 「@ユーザー名」
  var nameY = top + quoteBlock + 44 + NAME_SIZE * 0.82;
  ctx.font = NAME_SIZE + 'px "' + SERIF + '"';
  ctx.fillStyle = NAME_TEXT;
  ctx.save();
  ctx.transform(1, 0, -0.07, 1, 0.07 * nameY, 0); // 擬似イタリック
  ctx.fillText("- " + input.displayName, TEXT_CENTER_X, nameY);
  ctx.restore();

  var userY = nameY + 12 + USER_SIZE;
  ctx.font = USER_SIZE + 'px "' + SERIF + '"';
  ctx.fillStyle = SUB_TEXT;
  ctx.fillText("@" + input.username, TEXT_CENTER_X, userY);
  ctx.textAlign = "left";

  // クレジット (右下) — Bot版の文言そのまま
  ctx.fillStyle = CREDIT;
  ctx.font = '17px "' + SANS + '"';
  var credit = "Make It A Quote";
  ctx.fillText(credit, IMAGE_WIDTH - 30 - ctx.measureText(credit).width, IMAGE_HEIGHT - 22);
  return canvas;
}

// ===== 7. UI =====
var els = {};
var state = {
  avatarImage: null, // HTMLImageElement | HTMLCanvasElement | null
  avatarObjectUrl: null,
  useDummyForSample: false,
  generated: false,
  downloadUrl: null
};

function $(id) { return document.getElementById(id); }

function quoteTextLength(text) {
  return Array.from(text).length;
}

function setStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.classList.toggle("error", !!isError);
}

function normalizeUsername(raw) {
  return raw.trim().replace(/^@+/, "");
}

function updateCharCount() {
  var len = quoteTextLength(els.quoteText.value);
  els.charCount.textContent = String(len);
  var over = len > MAX_QUOTE_TEXT_LENGTH;
  els.charWarn.hidden = !over;
  els.charCount.parentElement.classList.toggle("over", over);
  return !over;
}

function updateAvatarPreviewInitial() {
  if (state.avatarImage) return;
  var name = els.displayName.value.trim();
  var initial = name ? Array.from(name)[0] : "？";
  els.avatarPreviewInitial.textContent = initial;
  els.avatarPreview.style.display = "";
  var img = els.avatarPreview.querySelector("img");
  if (img) img.remove();
}

function setAvatarImage(img, fileName) {
  state.avatarImage = img;
  state.useDummyForSample = false;
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

function clearAvatar() {
  state.avatarImage = null;
  state.useDummyForSample = false;
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
  var username = normalizeUsername(els.username.value) || "unknown";

  els.generateBtn.disabled = true;
  setStatus("生成中…", false);
  try {
    await ensureFonts();
    // フォント適用を確実にするため、描画前に document.fonts.ready も待つ
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    var avatar;
    if (state.avatarImage) {
      avatar = state.avatarImage;
    } else if (useSampleDummy) {
      avatar = dummyAvatar();
    } else {
      avatar = fallbackAvatar(displayName);
    }

    renderQuoteImage(els.canvas, {
      text: text,
      displayName: displayName,
      username: username,
      avatar: avatar
    });

    state.generated = true;
    els.emptyHint.classList.add("hidden");
    els.regenerateBtn.disabled = false;

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
      var safeName = (username || "quote").replace(/[^\w\-]+/g, "_");
      els.downloadBtn.download = "quote-" + safeName + ".png";
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

function fillSample() {
  els.displayName.value = "まぶ";
  els.username.value = "xx_mabu_xx";
  els.quoteText.value = "明日から本気出すって、昨日も言ってた気がするんだよな";
  updateCharCount();
  updateAvatarPreviewInitial();
  // アバター未指定なら Bot版サンプルと同じダミーシルエットで生成する
  generate(!state.avatarImage);
}

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

  // 初期キャンバスは黒背景にしておく (Bot版の背景色と同じ)
  var ctx = els.canvas.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

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

// ===== 8. 隠し機能: Discord アイコン取得 =====
// 通常の画面には出ないパネル。出し方は3通り:
// (1) キーボードで「discord」と打つ (2) フッターのクレジットを2秒以内に5回タップ
// (3) URL パラメータ ?uid=<ユーザーID> (開いて自動取得まで行う)
// ユーザー情報の照会には外部API (japi.rest) を使い、画像は Discord CDN から
// 直接読み込む (CDN は CORS 許可済みのため Canvas が汚染されない)。
// 照会に送られるのは入力したユーザーIDだけ。

function discordAvatarUrl(user, size) {
  if (user.avatar) {
    return "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png?size=" + size;
  }
  // カスタムアイコン未設定: デフォルトアイコンの番号を ID から決める
  var idx;
  if (!user.discriminator || user.discriminator === "0") {
    idx = Number((BigInt(user.id) >> 22n) % 6n);
  } else {
    idx = parseInt(user.discriminator, 10) % 5;
  }
  return "https://cdn.discordapp.com/embed/avatars/" + idx + ".png";
}

function setSecretStatus(msg, isError) {
  els.secretStatus.textContent = msg;
  els.secretStatus.classList.toggle("error", !!isError);
}

function toggleSecretPanel(show) {
  var willShow = typeof show === "boolean" ? show : els.secretPanel.hidden;
  els.secretPanel.hidden = !willShow;
  if (willShow) els.secretUserId.focus();
}

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
  var fullUrl = discordAvatarUrl(data, 4096);
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
  img.src = discordAvatarUrl(data, 1024);
}

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

  // トリガー1: キーボードで「discord」と打つ (入力欄にフォーカスがある時を除く)
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

  // トリガー2: フッターのクレジットを2秒以内に5回タップ/クリック
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

  // トリガー3: ?uid=<ユーザーID> で開いて自動取得
  var uid = new URLSearchParams(location.search).get("uid");
  if (uid && /^\d{17,20}$/.test(uid)) {
    els.secretUserId.value = uid;
    toggleSecretPanel(true);
    fetchDiscordAvatar();
  }
}

// ===== 9. テーマ (ダーク/ライト) =====
(function initTheme() {
  var root = document.documentElement;
  if (!root || !root.getAttribute || !root.setAttribute) return;
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var btn = document.getElementById("themeToggle");
    if (btn) btn.textContent = theme === "light" ? "☀️" : "🌙";
  }
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
