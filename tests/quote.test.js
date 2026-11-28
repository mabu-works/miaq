"use strict";
// 🧪 js/quote.js の純粋ロジックの単体テスト（node:test、依存なし）。
// 計測は「1コードポイント = size px」という決定的なスタブで行い、
// 折り返し・禁則・自動縮小の規則だけを検証する（実フォント計測は対象外）。
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../js/quote.js");

// 📏 決定的な計測スタブ: 幅 = コードポイント数 × size
function measureAt(size) {
  return (s) => Array.from(s).length * size;
}
const OPTS = {
  maxWidth: Q.TEXT_WIDTH,
  maxHeight: Q.QUOTE_MAX_HEIGHT,
  sizes: Q.QUOTE_FONT_SIZES,
  lineHeightRatio: Q.LINE_HEIGHT_RATIO,
  measureAt,
};

// ==========================================
// ↩️ wrapText
// ==========================================
test("wrapText: 短い文は1行のまま", () => {
  assert.deepEqual(Q.wrapText("短い文", 596, measureAt(10)), ["短い文"]);
});

test("wrapText: 幅を超えたら折り返す", () => {
  // 1文字10px・幅25px なら2文字/行
  assert.deepEqual(Q.wrapText("あいうえお", 25, measureAt(10)), ["あい", "うえ", "お"]);
});

test("wrapText: 行頭禁則の文字は前の行に追い込む", () => {
  // 「、」は行頭に置けないので、幅を超えても前の行に付く
  assert.deepEqual(Q.wrapText("あい、う", 25, measureAt(10)), ["あい、", "う"]);
  assert.deepEqual(Q.wrapText("あい。う", 25, measureAt(10)), ["あい。", "う"]);
});

test("wrapText: 行末禁則の開き括弧は次の行へ送る", () => {
  assert.deepEqual(Q.wrapText("あ「いう", 25, measureAt(10)), ["あ", "「い", "う"]);
});

test("wrapText: 行頭の空白（半角・全角）は捨てる", () => {
  assert.deepEqual(Q.wrapText("  あい", 100, measureAt(10)), ["あい"]);
  assert.deepEqual(Q.wrapText("　あい", 100, measureAt(10)), ["あい"]);
  // 折り返し直後の空白も捨てる
  assert.deepEqual(Q.wrapText("あい う", 25, measureAt(10)), ["あい", "う"]);
});

test("wrapText: 改行は段落として扱い、空段落は空行になる", () => {
  assert.deepEqual(Q.wrapText("あ\nい", 100, measureAt(10)), ["あ", "い"]);
  assert.deepEqual(Q.wrapText("あ\n\nい", 100, measureAt(10)), ["あ", "", "い"]);
  assert.deepEqual(Q.wrapText("あ\r\nい", 100, measureAt(10)), ["あ", "い"]);
});

test("wrapText: サロゲートペアを1文字として扱う", () => {
  assert.deepEqual(Q.wrapText("𐮷野家", 25, measureAt(10)), ["𐮷野", "家"]);
});

test("wrapText: 空文字列は空行1つ", () => {
  assert.deepEqual(Q.wrapText("", 100, measureAt(10)), [""]);
});

// ==========================================
// 🔤 fitQuoteText
// ==========================================
test("fitQuoteText: 収まる最大のサイズを選ぶ", () => {
  const fit = Q.fitQuoteText("短い", OPTS);
  assert.equal(fit.fontSize, 62);
  assert.equal(fit.lineHeight, Math.round(62 * 1.42));
  assert.deepEqual(fit.lines, ["短い"]);
});

test("fitQuoteText: 長い文は小さいサイズに落ちる", () => {
  // スタブ計測（幅 = 文字数 × size）: 100文字は 32px（18文字/行×6行×45px=270）で収まる
  const mid = Q.fitQuoteText("あ".repeat(100), OPTS);
  assert.equal(mid.fontSize, 32);
  assert.ok(mid.lines.length * mid.lineHeight <= Q.QUOTE_MAX_HEIGHT);
  // 150文字は 32px では 9行×45px=405 で溢れ、27px（22文字/行×7行×38px=266）まで落ちる
  const fit = Q.fitQuoteText("あ".repeat(150), OPTS);
  assert.equal(fit.fontSize, 27);
  assert.ok(fit.lines.length * fit.lineHeight <= Q.QUOTE_MAX_HEIGHT);
});

test("fitQuoteText: どうしても収まらない場合は切り詰めて … を付ける", () => {
  const fit = Q.fitQuoteText("あ".repeat(300), OPTS);
  const maxLines = Math.floor(Q.QUOTE_MAX_HEIGHT / Math.round(27 * 1.42));
  assert.equal(fit.fontSize, 27);
  assert.equal(fit.lines.length, maxLines);
  assert.ok(fit.lines[fit.lines.length - 1].endsWith("…"));
  // 最終行は … 込みで幅に収まる
  const measure = measureAt(27);
  assert.ok(measure(fit.lines[fit.lines.length - 1]) <= Q.TEXT_WIDTH);
});

// ==========================================
// ⬛ grayscaleValue / coverRect
// ==========================================
test("grayscaleValue: 白黒と原色", () => {
  assert.equal(Q.grayscaleValue(0, 0, 0), 0); // (0-128)*1.06+128 < 0 → 0
  assert.equal(Q.grayscaleValue(255, 255, 255), 255); // 上限で丸める
  // 純赤: g = 0.299*255 = 76.245 → (76.245-128)*1.06+128 = 73.1397
  assert.ok(Math.abs(Q.grayscaleValue(255, 0, 0) - 73.1397) < 1e-9);
  // 中間グレー 128 はほぼ不動点（係数和の浮動小数点誤差の範囲）
  assert.ok(Math.abs(Q.grayscaleValue(128, 128, 128) - 128) < 1e-9);
});

test("coverRect: 横長・縦長・同寸", () => {
  // 横長ソースを 640×630 に cover: 高さ基準で拡大し左右がはみ出す
  const wide = Q.coverRect(1000, 500, 640, 630);
  assert.equal(wide.dh, 630);
  assert.equal(wide.dw, 1260);
  assert.equal(wide.dx, -310);
  assert.equal(wide.dy, 0);
  // 縦長ソース: 幅基準
  const tall = Q.coverRect(500, 1000, 640, 630);
  assert.equal(tall.dw, 640);
  assert.equal(tall.dh, 1280);
  assert.equal(tall.dx, 0);
  assert.equal(tall.dy, -325);
  // 同寸はそのまま
  assert.deepEqual(Q.coverRect(640, 630, 640, 630), { dx: 0, dy: 0, dw: 640, dh: 630 });
});

// ==========================================
// 🖼️ 代替アバターの純粋部品
// ==========================================
test("nameHue: 決定的で 0..359 の範囲", () => {
  assert.equal(Q.nameHue(""), 0);
  assert.equal(Q.nameHue("まぶ"), Q.nameHue("まぶ"));
  for (const name of ["まぶ", "Mabu", "𐮷", "長い名前のユーザー"]) {
    const hue = Q.nameHue(name);
    assert.ok(hue >= 0 && hue < 360, name);
  }
  // "a" はコードポイント 97 → 97 % 360 = 97
  assert.equal(Q.nameHue("a"), 97);
});

test("initialOf: 先頭コードポイント、空は ?", () => {
  assert.equal(Q.initialOf("まぶ"), "ま");
  assert.equal(Q.initialOf("𐮷野家"), "𐮷");
  assert.equal(Q.initialOf(""), "?");
});

// ==========================================
// 🔧 入力まわり
// ==========================================
test("quoteTextLength: コードポイント数（絵文字は1）", () => {
  assert.equal(Q.quoteTextLength("あいう"), 3);
  assert.equal(Q.quoteTextLength("a𐮷b"), 3);
  assert.equal(Q.quoteTextLength(""), 0);
});

test("normalizeUsername: 空白と先頭 @ を除く", () => {
  assert.equal(Q.normalizeUsername("  xx_mabu_xx "), "xx_mabu_xx");
  assert.equal(Q.normalizeUsername("@xx_mabu_xx"), "xx_mabu_xx");
  assert.equal(Q.normalizeUsername("@@xx_mabu_xx"), "xx_mabu_xx");
  assert.equal(Q.normalizeUsername(""), "");
});

test("downloadFileName: 安全な名前に置換する", () => {
  assert.equal(Q.downloadFileName("xx_mabu_xx"), "quote-xx_mabu_xx.png");
  assert.equal(Q.downloadFileName("a b/c"), "quote-a_b_c.png");
  assert.equal(Q.downloadFileName(""), "quote-quote.png");
});

// ==========================================
// 🤫 Discord アイコン
// ==========================================
test("discordAvatarUrl: カスタムアイコンがある場合", () => {
  const user = { id: "123456789012345678", avatar: "abcdef", discriminator: "0" };
  assert.equal(
    Q.discordAvatarUrl(user, 1024),
    "https://cdn.discordapp.com/avatars/123456789012345678/abcdef.png?size=1024"
  );
});

test("discordAvatarUrl: デフォルトアイコン（新方式 discriminator=0）", () => {
  const id = "123456789012345678";
  const expected = Number((BigInt(id) >> 22n) % 6n);
  const url = Q.discordAvatarUrl({ id, avatar: null, discriminator: "0" }, 1024);
  assert.equal(url, "https://cdn.discordapp.com/embed/avatars/" + expected + ".png");
});

test("discordAvatarUrl: デフォルトアイコン（旧方式 discriminator）", () => {
  // 1234 % 5 = 4
  const url = Q.discordAvatarUrl({ id: "123456789012345678", avatar: null, discriminator: "1234" }, 1024);
  assert.equal(url, "https://cdn.discordapp.com/embed/avatars/4.png");
});

test("defaultAvatarIndex: 0..5 / 0..4 の範囲に収まる", () => {
  for (const id of ["100000000000000000", "999999999999999999", "12345678901234567"]) {
    const idx = Q.defaultAvatarIndex({ id, discriminator: "0" });
    assert.ok(idx >= 0 && idx <= 5);
  }
});

// ==========================================
// 📌 定数の健全性
// ==========================================
test("layout constants: Bot版と同一の出力寸法と上限", () => {
  assert.equal(Q.IMAGE_WIDTH, 1200);
  assert.equal(Q.IMAGE_HEIGHT, 630);
  assert.equal(Q.MAX_QUOTE_TEXT_LENGTH, 300);
  assert.deepEqual(Q.QUOTE_FONT_SIZES, [62, 56, 50, 44, 38, 32, 27]);
});
