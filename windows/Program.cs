using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace Miaq
{
    internal static class Program
    {
        // 🚀 アプリの入口
        [STAThread]
        private static void Main()
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new MainForm());
        }
    }

    internal sealed class MainForm : Form
    {
        // ==========================================
        // 📌 レイアウト定数（Web版 js/quote.js と同一）
        // ==========================================
        private const int ImageWidth = 1200;
        private const int ImageHeight = 630;
        private const int AvatarWidth = 640;
        private const int TextCenterX = 862;
        private const int TextWidth = 596;
        private const int QuoteMaxHeight = 372;
        private const int MaxQuoteLength = 300;

        // 🎨 生成画像の色
        private static readonly Color ImgBg = Color.Black;
        private static readonly Color ImgText = Color.FromArgb(247, 245, 240);
        private static readonly Color ImgName = Color.FromArgb(239, 239, 239);
        private static readonly Color ImgSub = Color.FromArgb(163, 163, 171);
        private static readonly Color ImgCredit = Color.FromArgb(111, 111, 118);

        // 🎨 画面（ダーク基調）の色
        private static readonly Color Bg = Color.FromArgb(10, 15, 28);
        private static readonly Color Surface = Color.FromArgb(17, 26, 46);
        private static readonly Color UiText = Color.FromArgb(236, 241, 248);
        private static readonly Color Muted = Color.FromArgb(157, 177, 199);
        private static readonly Color Accent = Color.FromArgb(106, 141, 255);
        private static readonly Color Border = Color.FromArgb(38, 54, 80);

        // 📝 Web版は Zen Old Mincho（明朝）+ Noto Sans JP を使うが、
        // Windows版は標準搭載の Yu Gothic UI で代替する（判断記録は DESIGN.md）
        private const string UiFont = "Yu Gothic UI";

        private readonly TextBox nameBox;
        private readonly TextBox userBox;
        private readonly TextBox quoteBox;
        private readonly Label avatarFileLabel;
        private readonly Label countLabel;
        private readonly Label statusLabel;
        private readonly PictureBox preview;
        private readonly Button clearAvatarBtn;
        private readonly Button saveBtn;

        private Bitmap? avatarImage;
        private Bitmap? rendered;

        // 🖥️ メインフォームを構築する（左: 入力パネル、右: プレビュー）
        public MainForm()
        {
            Text = "引用画像メーカー for Windows｜Make It a Quote";
            ClientSize = new Size(1160, 660);
            MinimumSize = new Size(900, 560);
            BackColor = Bg;
            ForeColor = UiText;
            Font = new Font(UiFont, 10F);
            AllowDrop = true;
            DragEnter += OnDragEnter;
            DragDrop += OnDragDrop;

            var title = new Label
            {
                Text = "引用画像メーカー｜Make It a Quote",
                Font = new Font(UiFont, 15F, FontStyle.Bold),
                ForeColor = UiText,
                Location = new Point(16, 12),
                AutoSize = true
            };
            Controls.Add(title);

            // ==========================================
            // ⌨️ 左: 入力パネル
            // ==========================================
            var panel = new Panel
            {
                Location = new Point(16, 56),
                Size = new Size(320, 540),
                Anchor = AnchorStyles.Left | AnchorStyles.Top | AnchorStyles.Bottom
            };
            Controls.Add(panel);

            int y = 0;
            panel.Controls.Add(MakeHeading("1. アバター画像", y)); y += 30;
            var pickBtn = MakeButton("画像を選ぶ", 0, y, 150, false);
            pickBtn.Click += (s, e) => PickAvatar();
            panel.Controls.Add(pickBtn);
            clearAvatarBtn = MakeButton("クリア", 162, y, 110, false);
            clearAvatarBtn.Enabled = false;
            clearAvatarBtn.Click += (s, e) => ClearAvatar();
            panel.Controls.Add(clearAvatarBtn); y += 40;
            avatarFileLabel = MakeMuted("未選択（プレースホルダ使用）", 0, y); y += 34;
            panel.Controls.Add(avatarFileLabel);
            var dropNote = MakeMuted("画像ファイルはこのウィンドウへ\nドラッグ＆ドロップでも読み込めます", 0, y); y += 52;
            panel.Controls.Add(dropNote);

            panel.Controls.Add(MakeHeading("2. 発言者", y)); y += 30;
            panel.Controls.Add(MakeMuted("表示名", 0, y)); y += 22;
            nameBox = MakeTextBox(0, y, 304); panel.Controls.Add(nameBox); y += 38;
            panel.Controls.Add(MakeMuted("ユーザー名（@は自動で付きます）", 0, y)); y += 22;
            userBox = MakeTextBox(0, y, 304); panel.Controls.Add(userBox); y += 46;

            panel.Controls.Add(MakeHeading("3. 引用文", y)); y += 30;
            quoteBox = new TextBox
            {
                Multiline = true,
                ScrollBars = ScrollBars.Vertical,
                Location = new Point(0, y),
                Size = new Size(304, 110),
                BackColor = Surface,
                ForeColor = UiText,
                BorderStyle = BorderStyle.FixedSingle,
                Font = new Font(UiFont, 10F)
            };
            quoteBox.TextChanged += (s, e) => UpdateCount();
            panel.Controls.Add(quoteBox); y += 116;
            countLabel = MakeMuted("0 / 300 文字", 0, y); y += 30;
            panel.Controls.Add(countLabel);

            var sampleBtn = MakeButton("サンプルで試す", 0, y, 140, false);
            sampleBtn.Click += (s, e) => FillSample();
            panel.Controls.Add(sampleBtn);
            var genBtn = MakeButton("画像を生成", 152, y, 152, true);
            genBtn.Click += (s, e) => Generate(false);
            panel.Controls.Add(genBtn); y += 44;

            saveBtn = MakeButton("PNGを保存", 0, y, 304, false);
            saveBtn.Enabled = false;
            saveBtn.Click += (s, e) => SavePng();
            panel.Controls.Add(saveBtn); y += 44;

            statusLabel = MakeMuted("入力して「画像を生成」を押してください。", 0, y);
            statusLabel.MaximumSize = new Size(304, 0);
            panel.Controls.Add(statusLabel);

            // ==========================================
            // 🖼️ 右: プレビュー
            // ==========================================
            var prevLabel = new Label
            {
                Text = "プレビュー（1200 × 630）",
                ForeColor = Muted,
                Location = new Point(352, 60),
                AutoSize = true
            };
            Controls.Add(prevLabel);
            preview = new PictureBox
            {
                Location = new Point(352, 86),
                Size = new Size(792, 416),
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top | AnchorStyles.Bottom,
                BackColor = Color.Black,
                SizeMode = PictureBoxSizeMode.Zoom,
                BorderStyle = BorderStyle.FixedSingle
            };
            Controls.Add(preview);
        }

        // 🏷️ 見出しラベルを作る
        private Label MakeHeading(string text, int y)
        {
            return new Label
            {
                Text = text,
                Font = new Font(UiFont, 11F, FontStyle.Bold),
                ForeColor = UiText,
                Location = new Point(0, y),
                AutoSize = true
            };
        }

        // 📝 補助テキストのラベルを作る
        private Label MakeMuted(string text, int x, int y)
        {
            return new Label
            {
                Text = text,
                ForeColor = Muted,
                Location = new Point(x, y),
                AutoSize = true
            };
        }

        // ⌨️ 入力欄を作る
        private TextBox MakeTextBox(int x, int y, int w)
        {
            return new TextBox
            {
                Location = new Point(x, y),
                Width = w,
                BackColor = Surface,
                ForeColor = UiText,
                BorderStyle = BorderStyle.FixedSingle
            };
        }

        // 🔘 ボタンを作る
        private Button MakeButton(string text, int x, int y, int w, bool primary)
        {
            var b = new Button
            {
                Text = text,
                Location = new Point(x, y),
                Size = new Size(w, 34),
                BackColor = primary ? Accent : Surface,
                ForeColor = primary ? Color.White : UiText,
                FlatStyle = FlatStyle.Flat
            };
            b.FlatAppearance.BorderColor = Border;
            return b;
        }

        // 💬 ステータスメッセージを表示する
        private void SetStatus(string msg) => statusLabel.Text = msg;

        // 🔢 引用文の文字数表示を更新する
        private void UpdateCount()
        {
            int len = CountRunes(quoteBox.Text);
            countLabel.Text = len > MaxQuoteLength
                ? $"{len} / {MaxQuoteLength} 文字 — 上限を超えています"
                : $"{len} / {MaxQuoteLength} 文字";
        }

        // ==========================================
        // 🖼️ アバター読み込み
        // ==========================================
        private void OnDragEnter(object? sender, DragEventArgs e)
        {
            if (e.Data != null && e.Data.GetDataPresent(DataFormats.FileDrop))
            {
                e.Effect = DragDropEffects.Copy;
            }
        }

        // 📥 ドロップされたアバター画像を読み込む
        private void OnDragDrop(object? sender, DragEventArgs e)
        {
            if (e.Data?.GetData(DataFormats.FileDrop) is string[] files && files.Length > 0)
            {
                LoadAvatarFile(files[0]);
            }
        }

        // 📂 アバター画像を選ぶ
        private void PickAvatar()
        {
            using var dlg = new OpenFileDialog
            {
                Filter = "画像ファイル|*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif|すべてのファイル|*.*",
                Title = "アバター画像を選択"
            };
            if (dlg.ShowDialog(this) == DialogResult.OK) LoadAvatarFile(dlg.FileName);
        }

        // 📥 アバター画像ファイルを読み込む（ファイルを開いたままにしないようコピーする）
        private void LoadAvatarFile(string path)
        {
            try
            {
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read);
                using var img = Image.FromStream(fs);
                avatarImage?.Dispose();
                avatarImage = new Bitmap(img);
                avatarFileLabel.Text = Path.GetFileName(path);
                clearAvatarBtn.Enabled = true;
                SetStatus("アバター画像を読み込みました。「画像を生成」を押してください。");
            }
            catch
            {
                SetStatus("画像の読み込みに失敗しました。別のファイルで試してください。");
            }
        }

        // 🗑️ アバター画像を消す
        private void ClearAvatar()
        {
            avatarImage?.Dispose();
            avatarImage = null;
            avatarFileLabel.Text = "未選択（プレースホルダ使用）";
            clearAvatarBtn.Enabled = false;
        }

        // ==========================================
        // ✨ 生成と保存
        // ==========================================
        // 🧪 サンプル文言を入力欄に入れて生成する
        private void FillSample()
        {
            nameBox.Text = "まぶ";
            userBox.Text = "xx_mabu_xx";
            quoteBox.Text = "明日から本気出すって、昨日も言ってた気がするんだよな";
            // 🖼️ アバター未指定なら Web版サンプルと同じダミーシルエットで生成する
            Generate(avatarImage == null);
        }

        // ✨ 引用画像を生成する
        private void Generate(bool useDummy)
        {
            string text = quoteBox.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                SetStatus("引用文を入力してください。");
                quoteBox.Focus();
                return;
            }
            if (CountRunes(text) > MaxQuoteLength)
            {
                SetStatus("引用文は300文字以内にしてください。");
                return;
            }
            string displayName = string.IsNullOrWhiteSpace(nameBox.Text) ? "名無し" : nameBox.Text.Trim();
            string username = NormalizeUsername(userBox.Text);
            if (username.Length == 0) username = "unknown";

            Bitmap avatar = avatarImage ?? (useDummy ? DummyAvatar() : FallbackAvatar(displayName));
            try
            {
                var bmp = RenderQuoteImage(avatar, text, displayName, username);
                rendered?.Dispose();
                rendered = bmp;
                preview.Image = bmp;
                saveBtn.Enabled = true;
                SetStatus("生成しました。プレビューを確認して「PNGを保存」を押してください。");
            }
            finally
            {
                if (!ReferenceEquals(avatar, avatarImage)) avatar.Dispose();
            }
        }

        // 💾 生成した画像を PNG で保存する（ファイル名は Web版と同じ規則）
        private void SavePng()
        {
            if (rendered == null) return;
            string username = NormalizeUsername(userBox.Text);
            var sb = new StringBuilder();
            foreach (var c in string.IsNullOrEmpty(username) ? "quote" : username)
            {
                sb.Append(char.IsLetterOrDigit(c) || c == '_' || c == '-' ? c : '_');
            }
            using var dlg = new SaveFileDialog
            {
                Filter = "PNG画像|*.png",
                FileName = "quote-" + sb + ".png",
                Title = "PNGを保存"
            };
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                rendered.Save(dlg.FileName, ImageFormat.Png);
                SetStatus("保存しました: " + dlg.FileName);
            }
        }

        // 👤 ユーザー名を正規化する（前後の空白と先頭の @ を除く）
        private static string NormalizeUsername(string raw) => raw.Trim().TrimStart('@');

        // 🔢 文字列のコードポイント数を数える
        private static int CountRunes(string s)
        {
            int n = 0;
            foreach (var _ in s.EnumerateRunes()) n++;
            return n;
        }

        // ==========================================
        // 🎨 描画本体（Web版 renderQuoteImage の移植）
        // ==========================================
        private Bitmap RenderQuoteImage(Bitmap avatarSrc, string text, string displayName, string username)
        {
            var bmp = new Bitmap(ImageWidth, ImageHeight, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                g.FillRectangle(Brushes.Black, 0, 0, ImageWidth, ImageHeight);

                // ⬛ アバター（グレースケール）+ 右へ黒へフェード。
                // Web版はグラデーションを右端まで塗るが、終端色は背景色なので
                // フェード区間だけ描いて残りを背景色で塗るのと等価。
                using (var av = CoverBitmap(avatarSrc, AvatarWidth, ImageHeight))
                {
                    GrayscaleInPlace(av);
                    g.DrawImage(av, 0, 0);
                }
                using (var fade = new LinearGradientBrush(
                    new Point(280, 0), new Point(620, 0),
                    Color.FromArgb(0, 0, 0, 0), ImgBg))
                {
                    g.FillRectangle(fade, 280, 0, 620 - 280, ImageHeight);
                }
                using (var black = new SolidBrush(ImgBg))
                {
                    g.FillRectangle(black, 620, 0, ImageWidth - 620, ImageHeight);
                }

                // 💬 引用文（自動縮小＋禁則折り返し）
                var fit = FitQuoteText(g, text);
                const int nameSize = 29;
                const int userSize = 22;
                int quoteBlock = fit.Lines.Count * fit.LineHeight;
                int totalHeight = quoteBlock + 44 + nameSize + 12 + userSize;
                float top = (ImageHeight - totalHeight) / 2f;

                using (var quoteFont = new Font(UiFont, fit.FontSize))
                using (var quoteBrush = new SolidBrush(ImgText))
                {
                    for (int i = 0; i < fit.Lines.Count; i++)
                    {
                        float baseline = top + fit.LineHeight * (i + 0.78f);
                        DrawCenteredBaseline(g, fit.Lines[i], quoteFont, quoteBrush, TextCenterX, baseline);
                    }
                }

                // 👤 発言者「- 表示名」（擬似イタリック）と「@ユーザー名」
                float nameY = top + quoteBlock + 44 + nameSize * 0.82f;
                using (var nameFont = new Font(UiFont, nameSize))
                using (var nameBrush = new SolidBrush(ImgName))
                {
                    var state = g.Save();
                    g.Transform = new Matrix(1, 0, -0.07f, 1, 0.07f * nameY, 0);
                    DrawCenteredBaseline(g, "- " + displayName, nameFont, nameBrush, TextCenterX, nameY);
                    g.Restore(state);
                }
                float userY = nameY + 12 + userSize;
                using (var userFont = new Font(UiFont, userSize))
                using (var userBrush = new SolidBrush(ImgSub))
                {
                    DrawCenteredBaseline(g, "@" + username, userFont, userBrush, TextCenterX, userY);
                }

                // 📝 クレジット（右下）
                using (var creditFont = new Font(UiFont, 17))
                using (var creditBrush = new SolidBrush(ImgCredit))
                {
                    const string credit = "Make It A Quote";
                    float w = Measure(g, credit, creditFont);
                    DrawBaseline(g, credit, creditFont, creditBrush, ImageWidth - 30 - w, ImageHeight - 22);
                }
            }
            return bmp;
        }

        // ==========================================
        // 📏 テキスト計測・描画ヘルパ
        // （GDI の DrawString は左上が原点のため、ベースライン基準に換算する）
        // ==========================================
        private static float Measure(Graphics g, string s, Font font)
        {
            if (s.Length == 0) return 0;
            return g.MeasureString(s, font, int.MaxValue, StringFormat.GenericTypographic).Width;
        }

        // 📏 フォントのアセント比率を求める
        private static float AscentRatio(Font font)
        {
            var fam = font.FontFamily;
            return (float)fam.GetCellAscent(font.Style) / fam.GetEmHeight(font.Style);
        }

        // ✏️ ベースライン指定で文字列を描く
        private static void DrawBaseline(Graphics g, string s, Font font, Brush brush, float x, float baselineY)
        {
            float y = baselineY - AscentRatio(font) * font.Size;
            g.DrawString(s, font, brush, x, y, StringFormat.GenericTypographic);
        }

        // ✏️ 中央寄せでベースライン指定の文字列を描く
        private static void DrawCenteredBaseline(Graphics g, string s, Font font, Brush brush, float centerX, float baselineY)
        {
            float w = Measure(g, s, font);
            DrawBaseline(g, s, font, brush, centerX - w / 2f, baselineY);
        }

        // ==========================================
        // ↩️ 折り返しと自動縮小（Web版 wrapText / fitQuoteText の移植）
        // ==========================================
        private const string NoLineStart = "、。，．！？：；）」』】〉》ー〜…‥・ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ";
        private const string NoLineEnd = "（「『【〈《";

        // 🔤 文字列をコードポイントの列に分ける
        private static List<string> CodePoints(string s)
        {
            var list = new List<string>();
            foreach (var r in s.EnumerateRunes()) list.Add(r.ToString());
            return list;
        }

        // 🔤 文字列の末尾コードポイントを返す
        private static string LastCp(string s)
        {
            string last = "";
            foreach (var r in s.EnumerateRunes()) last = r.ToString();
            return last;
        }

        // 🔤 文字列の末尾コードポイントを削る
        private static string DropLastCp(string s)
        {
            var cps = CodePoints(s);
            if (cps.Count == 0) return s;
            cps.RemoveAt(cps.Count - 1);
            return string.Concat(cps);
        }

        // ↩️ テキストを禁則処理つきで折り返す
        private static List<string> WrapText(string text, float maxWidth, Func<string, float> measure)
        {
            var lines = new List<string>();
            foreach (var paragraph in text.Replace("\r\n", "\n").Split('\n'))
            {
                if (paragraph.Length == 0)
                {
                    lines.Add("");
                    continue;
                }
                string line = "";
                foreach (var ch in CodePoints(paragraph))
                {
                    if (line.Length == 0)
                    {
                        // 📝 行頭の空白は捨てる
                        if (ch == " " || ch == "　") continue;
                        line = ch;
                        continue;
                    }
                    if (measure(line + ch) <= maxWidth)
                    {
                        line += ch;
                        continue;
                    }
                    if (NoLineStart.Contains(ch))
                    {
                        // 📝 行頭禁則: 前の行に追い込む
                        line += ch;
                        continue;
                    }
                    string last = LastCp(line);
                    if (NoLineEnd.Contains(last) && CodePoints(line).Count >= 2)
                    {
                        // 📝 行末禁則: 開き括弧は次の行へ送る
                        lines.Add(DropLastCp(line));
                        line = last + ch;
                        continue;
                    }
                    lines.Add(line);
                    line = (ch == " " || ch == "　") ? "" : ch;
                }
                if (line.Length != 0 || lines.Count == 0) lines.Add(line);
            }
            return lines;
        }

        private sealed class FitResult
        {
            public int FontSize;
            public List<string> Lines = new List<string>();
            public int LineHeight;
        }

        // 🔤 引用文のフォントサイズを自動調整する（候補は Web版と同一）
        private static FitResult FitQuoteText(Graphics g, string text)
        {
            int[] sizes = { 62, 56, 50, 44, 38, 32, 27 };
            const float lineHeightRatio = 1.42f;
            foreach (int size in sizes)
            {
                using var font = new Font(UiFont, size);
                var lines = WrapText(text, TextWidth, s => Measure(g, s, font));
                int lineHeight = (int)Math.Round(size * lineHeightRatio);
                if (lines.Count * lineHeight <= QuoteMaxHeight)
                {
                    return new FitResult { FontSize = size, Lines = lines, LineHeight = lineHeight };
                }
            }
            int minSize = sizes[sizes.Length - 1];
            int minLineHeight = (int)Math.Round(minSize * lineHeightRatio);
            int maxLines = Math.Max(1, QuoteMaxHeight / minLineHeight);
            using var minFont = new Font(UiFont, minSize);
            Func<string, float> measure = s => Measure(g, s, minFont);
            var sliced = WrapText(text, TextWidth, measure);
            if (sliced.Count > maxLines) sliced = sliced.GetRange(0, maxLines);
            string lastLine = sliced[sliced.Count - 1];
            while (lastLine.Length > 0 && measure(lastLine + "…") > TextWidth)
            {
                lastLine = DropLastCp(lastLine);
            }
            sliced[sliced.Count - 1] = lastLine + "…";
            return new FitResult { FontSize = minSize, Lines = sliced, LineHeight = minLineHeight };
        }

        // ==========================================
        // 🖼️ アバター加工
        // ==========================================
        // 📐 cover 配置で (w, h) いっぱいに描いたビットマップを作る
        private static Bitmap CoverBitmap(Bitmap src, int w, int h)
        {
            var dst = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                float scale = Math.Max((float)w / src.Width, (float)h / src.Height);
                float dw = src.Width * scale;
                float dh = src.Height * scale;
                g.DrawImage(src, (w - dw) / 2f, (h - dh) / 2f, dw, dh);
            }
            return dst;
        }

        // ⬛ g = 0.299R + 0.587G + 0.114B、コントラスト (g-128)*1.06+128（Web版と同一式）
        private static void GrayscaleInPlace(Bitmap bmp)
        {
            var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
            var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            try
            {
                int bytes = Math.Abs(data.Stride) * bmp.Height;
                var buf = new byte[bytes];
                System.Runtime.InteropServices.Marshal.Copy(data.Scan0, buf, 0, bytes);
                for (int i = 0; i < buf.Length; i += 4)
                {
                    // 📝 バッファは BGRA 並び
                    double gray = 0.299 * buf[i + 2] + 0.587 * buf[i + 1] + 0.114 * buf[i];
                    gray = Math.Max(0, Math.Min(255, (gray - 128) * 1.06 + 128));
                    byte v = (byte)gray;
                    buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
                }
                System.Runtime.InteropServices.Marshal.Copy(buf, 0, data.Scan0, bytes);
            }
            finally
            {
                bmp.UnlockBits(data);
            }
        }

        // 🎨 HSL 色を RGB に変換する（代替アバターのグラデーション用）
        private static Color HslToRgb(double h, double s, double l)
        {
            h = ((h % 360) + 360) % 360 / 360.0;
            double c = (1 - Math.Abs(2 * l - 1)) * s;
            double x = c * (1 - Math.Abs(h * 6 % 2 - 1));
            double m = l - c / 2;
            double r, g, b;
            if (h < 1.0 / 6) { r = c; g = x; b = 0; }
            else if (h < 2.0 / 6) { r = x; g = c; b = 0; }
            else if (h < 3.0 / 6) { r = 0; g = c; b = x; }
            else if (h < 4.0 / 6) { r = 0; g = x; b = c; }
            else if (h < 5.0 / 6) { r = x; g = 0; b = c; }
            else { r = c; g = 0; b = x; }
            return Color.FromArgb(
                (int)Math.Round((r + m) * 255),
                (int)Math.Round((g + m) * 255),
                (int)Math.Round((b + m) * 255));
        }

        // 🖼️ 名前のハッシュ色グラデーション + 頭文字（Web版 fallbackAvatar の移植）
        private static Bitmap FallbackAvatar(string displayName)
        {
            const int size = 630;
            var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
                int hash = 0;
                foreach (var r in displayName.EnumerateRunes()) hash = (hash * 31 + r.Value) % 360;
                var c1 = HslToRgb(hash, 0.32, 0.30);
                var c2 = HslToRgb((hash + 40) % 360, 0.36, 0.16);
                using (var grad = new LinearGradientBrush(new Point(0, 0), new Point(size, size), c1, c2))
                {
                    g.FillRectangle(grad, 0, 0, size, size);
                }
                string initial = "?";
                foreach (var r in displayName.EnumerateRunes()) { initial = r.ToString(); break; }
                using var font = new Font(UiFont, 300);
                using var brush = new SolidBrush(Color.FromArgb(235, 245, 243, 236));
                float w = Measure(g, initial, font);
                DrawBaseline(g, initial, font, brush, (size - w) / 2f, size / 2f + 108);
            }
            return bmp;
        }

        // 🖼️ サンプル用ダミーアバター（Web版 dummyAvatar の移植）
        private static Bitmap DummyAvatar()
        {
            const int s = 630;
            var bmp = new Bitmap(s, s, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (var grad = new LinearGradientBrush(new Point(0, 0), new Point(s, s),
                    Color.FromArgb(138, 147, 165), Color.FromArgb(74, 80, 100)))
                {
                    g.FillRectangle(grad, 0, 0, s, s);
                }
                using var brush = new SolidBrush(Color.FromArgb(44, 47, 56));
                // 👤 頭（円）と肩（楕円）。Web版の arc/ellipse 描画を GDI の楕円塗りで近似する
                g.FillEllipse(brush, s / 2f - s * 0.17f, s * 0.42f - s * 0.17f, s * 0.34f, s * 0.34f);
                g.FillEllipse(brush, s / 2f - s * 0.34f, s * 0.98f - s * 0.30f, s * 0.68f, s * 0.60f);
            }
            return bmp;
        }
    }
}
