"use strict";
/*
 * Make It a Quote — Webメーカー: 引用画像の描画コア。
 * Discord Bot「Make It a Quote」と同一のレイアウト仕様（1200×630、
 * グレースケール式、禁則折り返し、フォントサイズ候補）を Canvas で再現する。
 * 純粋ロジック（折り返し・自動縮小・グレースケール式など）は DOM に依存せず、
 * Node からも読み込めるようにしてある（tests/ から検証する）。
 * すべてクライアントサイドで処理し、画像をサーバーへ送信しない。
 */
(function (global) {

// ==========================================
// 📌 レイアウト定数（Bot版と同一）
// ==========================================
var IMAGE_WIDTH = 1200;
var IMAGE_HEIGHT = 630;

var BG = "#000000";
var TEXT = "#f7f5f0";
var NAME_TEXT = "#efefef";
var SUB_TEXT = "#a3a3ab";
var CREDIT_TEXT = "#6f6f76";
var CREDIT_LABEL = "Make It A Quote";

var AVATAR_WIDTH = 640;   // アバター領域（左端から640px。右端はフェードで隠れる）
var TEXT_CENTER_X = 862;  // 本文ブロックの中心 x
var TEXT_WIDTH = 596;     // 本文の最大幅（x 564..1160）
var QUOTE_MAX_HEIGHT = 372; // 引用文ブロックの最大の高さ

var SERIF = "QuoteSerif"; // Zen Old Mincho（引用文・発言者名）
var SANS = "NotoJP";      // Noto Sans JP（クレジット・代替アバターの頭文字）

var QUOTE_FONT_SIZES = [62, 56, 50, 44, 38, 32, 27];
var LINE_HEIGHT_RATIO = 1.42;
var NAME_SIZE = 29;
var USER_SIZE = 22;
var CREDIT_SIZE = 17;

var MAX_QUOTE_TEXT_LENGTH = 300;

// ==========================================
// ✏️ テキスト折り返し（禁則処理つき）
// ==========================================
// 📝 行頭に置けない文字（句読点・閉じ括弧・長音・小書き仮名など）
var NO_LINE_START = "、。，．！？：；）」』】〉》ー〜…‥・ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ";
// 📝 行末に残せない文字（開き括弧）
var NO_LINE_END = "（「『【〈《";

// 🔤 文字列をコードポイントの配列に分ける（サロゲートペアを1文字として扱う）
function codePoints(str) {
  return Array.from(str);
}

// ↩️ テキストを禁則処理つきで折り返す。
// measure は文字列の描画幅を返す関数（フォント計測を呼び出し側から注入する）。
function wrapText(text, maxWidth, measure) {
  var lines = [];
  var paragraphs = String(text).split(/\r?\n/);
  for (var p = 0; p < paragraphs.length; p++) {
    var paragraph = paragraphs[p];
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    var line = "";
    var chars = codePoints(paragraph);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (line === "") {
        // 📝 行頭の空白（半角・全角）は捨てる
        if (ch === " " || ch === "　") continue;
        line = ch;
        continue;
      }
      if (measure(line + ch) <= maxWidth) {
        line += ch;
        continue;
      }
      // ↩️ ここで折り返しが発生する
      if (NO_LINE_START.indexOf(ch) !== -1) {
        // 📝 行頭禁則: その文字は前の行に追い込む（多少はみ出しても崩さない）
        line += ch;
        continue;
      }
      var lastCps = codePoints(line);
      var last = lastCps[lastCps.length - 1];
      if (NO_LINE_END.indexOf(last) !== -1 && lastCps.length >= 2) {
        // 📝 行末禁則: 開き括弧は次の行へ送る
        lines.push(lastCps.slice(0, -1).join(""));
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

// 🔤 引用文のフォントサイズを自動調整する。
// opts: { maxWidth, maxHeight, sizes, lineHeightRatio, measureAt(size) -> measure }
// どのサイズでも収まらない場合は最小サイズで切り詰め、最終行に … を付ける。
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
  // 📝 最終行に … を付ける（幅に収まるまで末尾を削る）
  var lastLine = sliced[sliced.length - 1];
  while (lastLine.length > 0 && measure(lastLine + "…") > opts.maxWidth) {
    lastLine = codePoints(lastLine).slice(0, -1).join("");
  }
  sliced[sliced.length - 1] = lastLine + "…";
  return { fontSize: minSize, lines: sliced, lineHeight: minLineHeight };
}

// ==========================================
// ⬛ グレースケール化（Bot版と同一式）
// ==========================================
// ⬛ g = 0.299R + 0.587G + 0.114B、コントラスト (g-128)*1.06+128、0..255 に丸める
function grayscaleValue(r, g, b) {
  var gray = 0.299 * r + 0.587 * g + 0.114 * b;
  gray = (gray - 128) * 1.06 + 128;
  return Math.max(0, Math.min(255, gray));
}

// 📐 cover 配置: 描画先 (w, h) を埋める拡大率と描画矩形を返す
function coverRect(srcW, srcH, w, h) {
  var scale = Math.max(w / srcW, h / srcH);
  var dw = srcW * scale;
  var dh = srcH * scale;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw: dw, dh: dh };
}

// ⬛ アバターを 640×630 のオフスクリーンへ cover で描き、画素をグレースケール化する
function grayscaleAvatarCanvas(avatar, createCanvas) {
  var w = AVATAR_WIDTH;
  var h = IMAGE_HEIGHT;
  var off = createCanvas();
  off.width = w;
  off.height = h;
  var ctx = off.getContext("2d");
  var srcW = avatar.width || avatar.naturalWidth;
  var srcH = avatar.height || avatar.naturalHeight;
  var rect = coverRect(srcW, srcH, w, h);
  ctx.drawImage(avatar, rect.dx, rect.dy, rect.dw, rect.dh);
  var data = ctx.getImageData(0, 0, w, h);
  var px = data.data;
  for (var i = 0; i < px.length; i += 4) {
    var g = grayscaleValue(px[i], px[i + 1], px[i + 2]);
    px[i] = g;
    px[i + 1] = g;
    px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
  return off;
}

// ==========================================
// 🖼️ アバター未指定時の代替画像
// ==========================================
// 🎨 表示名のハッシュ（コードポイント単位）で決まる色相 0..359
function nameHue(displayName) {
  var hash = 0;
  var chars = codePoints(displayName);
  for (var i = 0; i < chars.length; i++) {
    hash = (hash * 31 + chars[i].codePointAt(0)) % 360;
  }
  return hash;
}

// 🔤 表示名の頭文字（コードポイント先頭）。空なら "?"
function initialOf(displayName) {
  var chars = codePoints(displayName);
  return chars.length > 0 ? chars[0] : "?";
}

// 🖼️ 名前のハッシュ色グラデーション + 頭文字の代替アバター（630×630）。
// この後グレースケール化されるため、最終画像ではモノクロになる（Bot版と同じ）。
function fallbackAvatar(displayName, createCanvas) {
  var size = 630;
  var c = createCanvas();
  c.width = size;
  c.height = size;
  var ctx = c.getContext("2d");
  var hue = nameHue(displayName);
  var grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "hsl(" + hue + ", 32%, 30%)");
  grad.addColorStop(1, "hsl(" + ((hue + 40) % 360) + ", 36%, 16%)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  var initial = initialOf(displayName);
  ctx.fillStyle = "rgba(245,243,236,0.92)";
  ctx.font = '300px "' + SANS + '"';
  var w = ctx.measureText(initial).width;
  ctx.fillText(initial, (size - w) / 2, size / 2 + 108);
  return c;
}

// 🖼️ サンプル用ダミーアバター（人物シルエット、630×630）
function dummyAvatar(createCanvas) {
  var s = 630;
  var c = createCanvas();
  c.width = s;
  c.height = s;
  var ctx = c.getContext("2d");
  var grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, "#8a93a5");
  grad.addColorStop(1, "#4a5064");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#2c2f38";
  // 👤 頭（円）
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.42, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  // 👤 肩（楕円の上半分）
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.98, s * 0.34, s * 0.30, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  return c;
}

// ==========================================
// 🎨 描画本体
// ==========================================
// input: { text, displayName, username, avatar }
// avatar は画像または Canvas。createCanvas はオフスクリーン生成用。
function renderQuoteImage(canvas, input, createCanvas) {
  var ctx = canvas.getContext("2d");
  canvas.width = IMAGE_WIDTH;
  canvas.height = IMAGE_HEIGHT;

  // ⬛ 背景
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  // ⬛ アバター（グレースケール）と、右へ向けて黒に消えるグラデーション。
  // グラデーションの終端色は背景色なので、右端まで塗っても同じ見た目になる。
  ctx.drawImage(grayscaleAvatarCanvas(input.avatar, createCanvas), 0, 0);
  var fade = ctx.createLinearGradient(280, 0, 620, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, BG);
  ctx.fillStyle = fade;
  ctx.fillRect(280, 0, IMAGE_WIDTH - 280, IMAGE_HEIGHT);

  // 💬 引用文（明朝・中央寄せ・サイズ自動調整）
  function measureAt(size) {
    return function (s) {
      ctx.font = size + 'px "' + SERIF + '"';
      return ctx.measureText(s).width;
    };
  }
  var fit = fitQuoteText(input.text, {
    maxWidth: TEXT_WIDTH,
    maxHeight: QUOTE_MAX_HEIGHT,
    sizes: QUOTE_FONT_SIZES,
    lineHeightRatio: LINE_HEIGHT_RATIO,
    measureAt: measureAt
  });

  // 💬 引用文 + 発言者ブロック全体を縦中央に配置する
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

  // 👤 発言者: 「- 表示名」（擬似イタリックでわずかに斜体）と「@ユーザー名」
  var nameY = top + quoteBlock + 44 + NAME_SIZE * 0.82;
  ctx.font = NAME_SIZE + 'px "' + SERIF + '"';
  ctx.fillStyle = NAME_TEXT;
  ctx.save();
  ctx.transform(1, 0, -0.07, 1, 0.07 * nameY, 0);
  ctx.fillText("- " + input.displayName, TEXT_CENTER_X, nameY);
  ctx.restore();

  var userY = nameY + 12 + USER_SIZE;
  ctx.font = USER_SIZE + 'px "' + SERIF + '"';
  ctx.fillStyle = SUB_TEXT;
  ctx.fillText("@" + input.username, TEXT_CENTER_X, userY);
  ctx.textAlign = "left";

  // 📝 クレジット（右下）
  ctx.fillStyle = CREDIT_TEXT;
  ctx.font = CREDIT_SIZE + 'px "' + SANS + '"';
  ctx.fillText(
    CREDIT_LABEL,
    IMAGE_WIDTH - 30 - ctx.measureText(CREDIT_LABEL).width,
    IMAGE_HEIGHT - 22
  );
  return canvas;
}

// ==========================================
// 🔧 入力まわりの小さな純粋関数
// ==========================================
// 🔢 引用文の文字数を数える（コードポイント単位）
function quoteTextLength(text) {
  return Array.from(text).length;
}

// 👤 ユーザー名を正規化する（前後の空白と先頭の @ を除く）
function normalizeUsername(raw) {
  return String(raw).trim().replace(/^@+/, "");
}

// 💾 ダウンロードファイル名を作る（安全でない文字は _ に置換）
function downloadFileName(username) {
  var safe = (username || "quote").replace(/[^\w\-]+/g, "_");
  return "quote-" + safe + ".png";
}

// ==========================================
// 🤫 Discord アイコンの URL（隠し機能用）
// ==========================================
// ⚙️ カスタムアイコン未設定時のデフォルトアイコンの番号を決める。
// 新方式（discriminator が "0" または無し）は ID のシフトから 0..5、
// 旧方式は discriminator を 5 で割った余り。
function defaultAvatarIndex(user) {
  if (!user.discriminator || user.discriminator === "0") {
    return Number((BigInt(user.id) >> 22n) % 6n);
  }
  return parseInt(user.discriminator, 10) % 5;
}

// 🌐 ユーザー情報からアバター画像の URL を組み立てる
function discordAvatarUrl(user, size) {
  if (user.avatar) {
    return (
      "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar +
      ".png?size=" + size
    );
  }
  return "https://cdn.discordapp.com/embed/avatars/" + defaultAvatarIndex(user) + ".png";
}

// ==========================================
// 📦 公開
// ==========================================
var api = {
  IMAGE_WIDTH: IMAGE_WIDTH,
  IMAGE_HEIGHT: IMAGE_HEIGHT,
  BG: BG,
  TEXT: TEXT,
  NAME_TEXT: NAME_TEXT,
  SUB_TEXT: SUB_TEXT,
  CREDIT_TEXT: CREDIT_TEXT,
  CREDIT_LABEL: CREDIT_LABEL,
  AVATAR_WIDTH: AVATAR_WIDTH,
  TEXT_CENTER_X: TEXT_CENTER_X,
  TEXT_WIDTH: TEXT_WIDTH,
  QUOTE_MAX_HEIGHT: QUOTE_MAX_HEIGHT,
  SERIF: SERIF,
  SANS: SANS,
  QUOTE_FONT_SIZES: QUOTE_FONT_SIZES,
  LINE_HEIGHT_RATIO: LINE_HEIGHT_RATIO,
  NAME_SIZE: NAME_SIZE,
  USER_SIZE: USER_SIZE,
  MAX_QUOTE_TEXT_LENGTH: MAX_QUOTE_TEXT_LENGTH,
  NO_LINE_START: NO_LINE_START,
  NO_LINE_END: NO_LINE_END,
  wrapText: wrapText,
  fitQuoteText: fitQuoteText,
  grayscaleValue: grayscaleValue,
  coverRect: coverRect,
  grayscaleAvatarCanvas: grayscaleAvatarCanvas,
  nameHue: nameHue,
  initialOf: initialOf,
  fallbackAvatar: fallbackAvatar,
  dummyAvatar: dummyAvatar,
  renderQuoteImage: renderQuoteImage,
  quoteTextLength: quoteTextLength,
  normalizeUsername: normalizeUsername,
  downloadFileName: downloadFileName,
  defaultAvatarIndex: defaultAvatarIndex,
  discordAvatarUrl: discordAvatarUrl
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
global.MiaqQuote = api;

})(typeof window !== "undefined" ? window : globalThis);
