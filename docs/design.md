# 詳細設計書

対応する要件は [requirements.md](requirements.md) の ID（FR-xx / NFR-xx）で示す。画面の見た目は [mockup/project/](mockup/project/)（各画面の `.dc.html`） を正とする。

## 1. 全体構成

```
┌──────────── Tauri アプリ（1 プロセス） ────────────┐
│  WebView（React + TypeScript）                      │
│   ・画面表示、パラメータ編集、プレビュー            │
│   ・ファイルパスを扱わない（ハンドル ID のみ）      │
│            │ invoke / event（IPC）                  │
│  Rust（src-tauri）                                  │
│   ・ダイアログ表示、D&D 受付、パス管理              │
│   ・設定の保存、一括変換のスレッド管理              │
│            │ 関数呼び出し                           │
│  Rust（crates/tracer）Tauri に依存しない純粋な処理  │
│   ・画像デコード、前処理、VTracer 呼び出し、        │
│     SVG 整形、出力名の決定                          │
└────────────────────────────────────────────────────┘
```

- 変換ロジックを Tauri から独立したクレート `tracer` に置く。WebKitGTK などの GUI 依存なしに `cargo test` でき、CI を速く保てる。
- フロントエンドはファイルパスを Rust に渡さない。ダイアログと D&D は Rust 側で受け、パスは Rust 内の表に登録して ID だけを返す（§6）。これで NFR-01 の「フロントエンドから任意のパスを読み書きできる経路を作らない」を構造的に満たす。

## 2. 技術選定

| 領域 | 採用 | 理由 |
| --- | --- | --- |
| アプリ基盤 | Tauri 2 | 要件で決定済み |
| トレース | `vtracer` = 0.6.5（完全一致で固定） | §4.3 の前処理が VTracer 内部の判定に依存するため、意図しない更新を防ぐ |
| 画像デコード | `image`（png, jpeg, webp, bmp, gif 機能のみ有効） | 不要な形式のデコーダを同梱しない |
| 並列処理 | `rayon` | 一括変換のスレッドプール |
| 一時ファイル | `tempfile` | 書き込み途中のファイルを残さない原子的な保存（§5.4） |
| IPC 型共有 | `ts-rs` | Rust の型から TypeScript の型を生成し、手書きの二重定義によるずれを防ぐ |
| テスト時の SVG 描画 | `resvg`（dev-dependency のみ） | 品質テスト（§9.2）で SVG をラスター化する。配布物には含めない |
| フロントエンド | React + TypeScript + Vite | 実装者（AI を含む）にとって情報量が最も多く、テスト手段も揃っている |
| スタイル | 素の CSS + CSS カスタムプロパティ | 依存を増やさない。配色はトークンで管理しダークモードを切り替える |
| 多言語 | 自前の辞書（§8） | 2 言語・数十キーの規模にライブラリは不要 |
| フロントエンドのテスト | Vitest + Testing Library + jsdom、`@tauri-apps/api/mocks` | IPC をモックして画面ロジックを検証する |
| ライセンス | `cargo-about`（一覧生成）、`cargo-deny`（検査）、npm は `license-checker-rseidelsohn` | NFR-05 |

- ライブラリのバージョンは実装開始時点の最新安定版とし、`Cargo.lock` と `package-lock.json` をコミットして固定する。`vtracer` だけは上表のとおり完全一致で指定する。
- Tauri のプラグインは `tauri-plugin-dialog` のみ使う。Rust 側からだけ呼び、フロントエンドには権限を与えない（§7）。

## 3. ディレクトリ構成

```
/
├── crates/tracer/            変換ロジック（Tauri 非依存）
│   ├── src/
│   │   ├── lib.rs
│   │   ├── params.rs         TraceParams、プリセット定義
│   │   ├── decode.rs         形式判定、デコード、サイズ上限
│   │   ├── preprocess.rs     透過・白黒の前処理（§4.3）
│   │   ├── trace.rs          VTracer 呼び出し、SVG 整形（§4.4）
│   │   ├── naming.rs         出力名の決定（§5.3）
│   │   └── error.rs
│   └── tests/
│       ├── fixtures/         テスト画像（§9.1）
│       └── quality.rs        品質テスト（§9.2）
├── src-tauri/
│   ├── src/
│   │   ├── main.rs / lib.rs
│   │   ├── commands.rs       IPC コマンド（§6）
│   │   ├── handles.rs        パスとハンドル ID の表
│   │   ├── batch.rs          一括変換の実行・キャンセル
│   │   └── settings.rs       設定の読み書き（§5.6）
│   ├── capabilities/main.json
│   └── tauri.conf.json
├── src/                      フロントエンド
│   ├── main.tsx / App.tsx
│   ├── features/single/      単体変換タブ
│   ├── features/batch/       一括変換タブ
│   ├── features/settings/    パラメータパネル（両タブで共有）
│   ├── components/           汎用部品（PreviewPane、Slider など）
│   ├── ipc/                  invoke / listen の型付きラッパー
│   ├── ipc/generated/        ts-rs が生成した型（コミットする）
│   ├── i18n/                 ja.ts / en.ts / index.ts
│   ├── licenses/             第三者ライセンス一覧（生成してコミットする）と読み込み
│   └── styles/               tokens.css ほか
├── scripts/                  ビルド補助（generate-licenses.ts）
├── docs/                     要件定義、設計、作業計画、モックアップ
├── about.toml / deny.toml    ライセンス一覧生成と検査の設定
├── GEMINI.md                 実装者向けのコーディング規約
└── .github/workflows/        ci.yml / release.yml
```

## 4. 変換処理（crates/tracer）

### 4.1 処理の流れ

```
ファイル読み込み → 形式判定・デコード → サイズ検査 → 前処理 → VTracer → SVG 整形
```

公開 API（シグネチャは実装時に調整してよいが、責務は変えない）:

```rust
pub fn load_image(path: &Path) -> Result<RgbaImage, TraceError>;
pub fn trace(image: &RgbaImage, params: &TraceParams) -> Result<TraceOutput, TraceError>;
pub fn resolve_output_names(inputs: &[String], existing: &HashSet<String>) -> Vec<String>;

pub struct TraceOutput { pub svg: String, pub path_count: usize }
```

### 4.2 入力とデコード（FR-01）

- 対象拡張子は `png` `jpg` `jpeg` `webp` `bmp` `gif`（大文字小文字を区別しない）。定数 `SUPPORTED_EXTENSIONS` にまとめる。
- 形式は拡張子ではなくファイルの中身（先頭バイト）で判定してデコードする。判定できない、または上記以外の形式なら `UnsupportedFormat`、デコードに失敗したら `DecodeFailed`。
- アニメーション GIF は 1 フレーム目だけを使う（`image` の通常のデコードは 1 フレーム目を返す。テストで保証する）。
- サイズ上限: `MAX_PIXELS = 16_777_216`（4096×4096 相当）。デコード前にヘッダーの寸法で検査し、超えたら `TooLarge`。一括変換では複数枚を並列に処理するため、1 枚あたりのメモリを抑える値にしている。
- 圧縮爆弾対策として、`image` の `Limits`（最大幅・高さ・確保メモリ）も設定する。

### 4.3 前処理

VTracer 0.6.5 には次の癖があり、そのまま渡すと FR-01（透過を保つ）を満たせない。

1. カラーモードで透過を背景として除外する処理（キーイング）は、画像の 5 本の行（上端、1/4、1/2、3/4、下端）をサンプリングし、5 行に含まれる完全透過のピクセルの合計が 0.4×幅 以上のときだけ働く（`should_key_image`）。透過部分が画像の中央にしかないロゴなどでは働かず、透過部分が色付きのパスとして出力される。
2. 白黒モードは赤チャンネルだけを見て `r < 128` を黒とし、アルファを見ない。透過部分（多くは RGB が 0）が黒になる。

これに対し、次の前処理を行う。

| 手順 | 対象 | 内容 |
| --- | --- | --- |
| P1 アルファの二値化 | 全モード | アルファ < `ALPHA_THRESHOLD`（128）のピクセルを完全透過に、それ以外を完全不透明にする。ロゴの縁の半透明を扱うと、背景色と混ざった色の細いパスが大量に出るため |
| P2 透過の余白 | カラーモードで完全透過ピクセルが 1 つ以上ある場合 | 画像の四辺に 1px の完全透過の余白を付ける。上端と下端のサンプル行が全て透過になり、キーイングが必ず働く。余白は §4.4 の `viewBox` で切り落とす |
| P3 グレースケール化 | 白黒モード | 透過ピクセルを白に合成し、R=G=B=輝度（BT.709）にする。赤チャンネルだけの判定を輝度の判定に置き換える |

P2 は VTracer の内部判定に依存するため、`vtracer` のバージョンを固定し、「キーイングの条件を満たさない透過ロゴ」フィクスチャで回帰テストする（§9.1）。VTracer を更新するときはこのテストで挙動を確認する。

### 4.4 SVG 整形

VTracer の出力するルート要素は `<svg version="1.1" xmlns="…" width="W" height="H">` で `viewBox` がない。VTracer の SVG 文字列からルート要素を置き換え、次の形にする。

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="X Y W H">
```

- `W`・`H` は元画像のピクセルサイズ。P2 で余白を付けた場合は `X = Y = 1`、それ以外は `0`。
- XML 宣言は残し、VTracer の生成元コメントは削除しない（出所の表示として残す）。
- `path_count` は出力中の `<path` 要素の数。
- 整形後の SVG は XML として妥当で、`<image>` を含まないことをテストする（NFR-03）。

### 4.5 パラメータとプリセット（FR-02）

`TraceParams` は VTracer の `Config` と 1 対 1 に対応する。UI での扱いは次のとおり。

| パラメータ | VTracer | 範囲 | UI での表示名（ja / en） | 区分 |
| --- | --- | --- | --- | --- |
| colorMode | color_mode | color / binary | 色 / Color | 主要 |
| colorPrecision | color_precision | 1–8 | 色の精度 / Color precision | 主要（カラー時のみ） |
| filterSpeckle | filter_speckle | 0–16 | ノイズ除去 / Remove specks | 主要 |
| cornerThreshold | corner_threshold | 0–180 | 角の判定 / Corner threshold | 主要 |
| curveMode | mode | spline / polygon | 曲線 / 多角形 / Curves / Polygons | 主要 |
| layerDifference | layer_difference | 0–128 | 色の階調差 / Color separation | 詳細（カラー時のみ） |
| hierarchical | hierarchical | stacked / cutout | 重ね方 / Layering | 詳細（カラー時のみ） |
| lengthThreshold | length_threshold | 3.5–10.0 | 線分の最小長 / Min. segment length | 詳細 |
| spliceThreshold | splice_threshold | 0–180 | 曲線の分割 / Curve splitting | 詳細 |
| pathPrecision | path_precision | 0–8 | 座標の精度 / Path precision | 詳細 |

`max_iterations` は 10 に固定し、UI には出さない。範囲の最小値・最大値は定数として `params.rs` に置き、フロントエンドには ts-rs で生成した定数ではなく IPC コマンド `get_param_spec` で渡す（範囲の定義を 1 か所にするため）。UI のスライダーの刻みは、整数のパラメータは 1、`lengthThreshold` は 0.5 とする（刻みは表示の都合なのでフロントエンドの定数に置き、Rust 側では検査しない）。

範囲の検査は Rust 側で行う。IPC はフロントエンドからの入力なので、UI が範囲内の値しか送らない作りでも、受け取る側で確かめる。VTracer 自身は範囲を検査せず、たとえば `color_precision` が 8 を超えると内部の `8 - color_precision` が負になる。

- `TraceParams::validate` が全項目を上の範囲と照合する。白黒モードで使わない項目も対象にする。小数（`lengthThreshold`）は範囲の比較で `NaN` も弾く。
- `trace` は VTracer を呼ぶ前に `validate` を呼び、範囲外なら `InvalidParams` を返す。単体変換と一括変換の両方がこれを通る。
- `save_settings` も保存前に `validate` を呼び、範囲外なら `InvalidParams` を返して保存しない。

プリセットの値（§10 のスパイクで全フィクスチャが §9.2 の合格条件を満たすことを確認済み）:

| パラメータ | ロゴ（カラー） | イラスト（色数少なめ） | 白黒 |
| --- | --- | --- | --- |
| colorMode | color | color | binary |
| colorPrecision | 6 | 4 | – |
| filterSpeckle | 4 | 8 | 4 |
| cornerThreshold | 60 | 60 | 60 |
| curveMode | spline | spline | spline |
| layerDifference | 16 | 32 | – |
| hierarchical | stacked | stacked | – |
| lengthThreshold | 4.0 | 4.0 | 4.0 |
| spliceThreshold | 45 | 45 | 45 |
| pathPrecision | 2 | 2 | 2 |

- 既定のプリセットは「ロゴ（カラー）」。
- パラメータを 1 つでも手で変えると、プリセット欄の表示は「カスタム」になる。プリセットを選び直すと値はそのプリセットに戻る。

## 5. 各機能の設計

### 5.1 単体変換（FR-02）

1. ユーザーが「画像を開く」または D&D で画像を指定する → Rust がハンドル ID を発行（§6）。
2. フロントエンドが `load_preview` を呼び、デコード済みの画像を PNG で受け取って元画像ペインに表示する。元のファイルではなくデコード後の画素を表示するので、アニメーション GIF でも変換対象の 1 フレーム目が表示される。
3. フロントエンドが `convert` を呼び、SVG を受け取って SVG ペインに表示する。
4. パラメータ変更のたびに 3 を繰り返す。
   - 変更から `CONVERT_DEBOUNCE_MS`（300ms）の間に次の変更がなければ変換する。
   - 各リクエストに連番を付け、Rust は最新の番号でない要求を変換開始前に `Superseded` で返す。フロントエンドは最新の番号以外の結果を捨てる。実行中の VTracer は中断できないので、「溜まらない」ことはこの 2 段で保証する。
5. 「SVG を保存」で Rust が保存ダイアログを開き、直近の変換結果を書き込む。SVG の文字列をフロントエンドから送り返さない。

`load_preview` が失敗した画像（壊れたファイル、上限超過など）には `convert` を呼ばない。同じ画像のデコードは同じ理由で必ず失敗し、2 度目のエラーで表示が描き直されるだけになるため。別の画像を選ぶまで、その画像の変換は行わない。

SVG ペインでは SVG を `blob:` URL にして `<img>` で表示する。`innerHTML` に挿入しないので、SVG 内のスクリプトが実行される余地がない。

### 5.2 一括変換（FR-03）

1. 「入力フォルダ」を選ぶ → Rust が直下のファイルを列挙し、対象ファイル名の一覧と対象外の件数を返す。サブフォルダ、シンボリックリンク、隠しファイル（`.` で始まる名前）は対象外として数える。
2. 「出力フォルダ」を選ぶ。選び直したときは、一覧の各行を「待機」に戻し、出力名と失敗の理由も消す。前回の結果は新しい出力先には当てはまらないため。
3. 「開始」で、その時点のパラメータを渡して開始する。一括変換の実行中は開始ボタン、フォルダ選択、パラメータパネルを無効にし（開始時の設定で最後まで変換するため）、`start_batch` の二重呼び出しは `BatchRunning` で拒否する。入力・出力フォルダのどちらかが未選択なら `UnknownHandle`、パラメータが範囲外なら（全件失敗させずに）開始前に `InvalidParams` で拒否する。
4. 出力名を §5.3 の規則で**開始時に全件分まとめて決め**、その後に並列変換する。名前の決定を変換の完了順に左右させないため。
5. スレッド数は `max(1, 論理 CPU 数 - 1)`。UI スレッドの分を 1 つ空ける。
6. 各ファイルの完了時に `batch-item` イベント、進捗は `batch-progress` イベントで通知する（§6.2）。
7. 1 ファイルの失敗は、そのファイルを失敗として記録して次へ進む。
8. 終了時に `batch-finished` イベントで成功・失敗・未処理の件数と、キャンセルされたかを通知する。

### 5.3 出力名の決定（FR-03）

- 基本名は入力ファイル名の最後の拡張子を `.svg` に置き換えたもの（`logo.png` → `logo.svg`、`a.b.png` → `a.b.svg`）。
- 入力ファイルをファイル名の Unicode コードポイント順に並べ、順に名前を割り当てる。戻り値は引数 `inputs` と同じ順に並べ、i 番目が `inputs[i]` の出力名になる（割り当ての順と戻り値の順は別）。
- 候補名が「出力フォルダに既にある名前」または「この一括変換で割り当て済みの名前」と重なったら、`name (1).svg`、`name (2).svg` … と重ならなくなるまで番号を増やす。
- 重なりの判定は大文字小文字を区別しない（Windows のファイルシステムに合わせ、両 OS で結果を揃える）。比較は両方を `str::to_lowercase` で小文字にして行う。出力名そのものは元の大文字小文字のまま返す。
- 保存の瞬間に他のプロセスが同名のファイルを作っていた場合は、上書きせずに次の番号で保存し直す（§5.4）。このとき選ぶ番号は、出力フォルダの既存ファイルとも、この一括変換で他の入力に割り当て済みの名前とも重ならないものにする。
- この関数は純粋関数として `naming.rs` に置き、単体テストで網羅する。

### 5.4 保存とキャンセル

- 保存は、出力フォルダ内に一時ファイルを作って全内容を書き込み、`persist_noclobber`（既存ファイルを上書きしない改名）で最終名にする。書き込み途中で失敗・中断しても最終名の不完全なファイルは残らない。一時ファイルは失敗時に削除する。
- キャンセルは共有フラグで行う。各ワーカーは次のファイルを始める前にフラグを確認し、立っていれば開始しない。変換中のファイルは完了させて保存する（VTracer は途中で止められないため）。
- UI はキャンセルボタンを押した直後に「キャンセル中…」を表示し、ボタンを無効にする（NFR-02 の「1 秒以内に受け付ける」はこの表示で満たす）。
- 単体変換の保存も同じ書き込み方式を使う。ただし保存ダイアログで既存ファイルを選んだ場合は、OS のダイアログで上書き確認が済んでいるので上書きする。

### 5.5 エラー（FR-06）

Rust は次のコードを持つエラーを返し、フロントエンドがコードから表示文言を引く。`detail` は OS のエラーメッセージなど補足情報で、表示の末尾に添える。

IPC では `{ code, detail }` の形で返す。`code` は下表の名前の文字列で、ts-rs では文字列リテラルの union 型として生成する。`detail` は補足がなければ `null`。`crates/tracer` の `TraceError` は Tauri に依存しないので、`src-tauri` 側でこの形に変換する。

引数の型が合わない場合（整数の項目に小数が来たなど）は、コマンドが呼ばれる前に Tauri が文字列のエラーを返し、この形にならない。フロントエンドの IPC ラッパー（`src/ipc/`）は、`{ code, detail }` の形でない失敗を `{ code: "InvalidParams", detail: <受け取った内容の文字列> }` に変換し、呼び出し側が常に同じ形で扱えるようにする。

| コード | 状況 | 表示文言（ja / en） |
| --- | --- | --- |
| UnsupportedFormat | 非対応の形式 | 非対応の画像形式です / Unsupported image format |
| DecodeFailed | デコード失敗（壊れたファイル） | 画像を読み込めませんでした。ファイルが壊れている可能性があります。 / Couldn't read the image. The file may be damaged. |
| TooLarge | ピクセル数が上限超過 | 画像が大きすぎます（上限 {detail} ピクセル） / Image is too large (limit: {detail} pixels) |
| ReadFailed | 読み込み失敗 | ファイルの読み込みに失敗しました / Failed to read file |
| WriteFailed | 書き込み失敗（権限、容量など） | ファイルの書き込みに失敗しました / Failed to write file |
| TraceFailed | VTracer がエラーを返した | SVG への変換に失敗しました / Vector tracing failed |
| Superseded | 新しい変換要求に置き換えられた | （画面には表示しない） |
| BatchRunning | 一括変換の実行中に再度開始しようとした | 一括変換が既に実行中です / Batch conversion is already running |
| UnknownHandle | 存在しないハンドル ID | 画像をもう一度開いてください / Please open the image again |
| InvalidParams | パラメータが §4.5 の範囲外（UI からは通常送られない） | 無効なパラメータです / Invalid parameters |

表示文言には、デコードやハンドルのような内部の用語を使わず、利用者が次に何をすればよいかが分かる言い方にする。文言に `{detail}` があるときは `detail` をそこに埋め込み、ないときは末尾に `: <detail>` を添える。`TooLarge` の `detail` は、Rust が `MAX_PIXELS` を 3 桁区切りの文字列（`16,777,216`）にして入れる。上限の数値をフロントエンドに書き写さず、§4.2 の定数だけを元にするため。

単体変換画面のエラーの帯は、ほかの要素の間に差し込まず、ツールバーのすぐ下にプレビューの上端へ重ねて表示する（`position: absolute`）。帯が出たり消えたりしても、ツールバーやプレビューの位置は変わらない。ツールバーのボタンは隠さない。帯は、別の画像を選んだときと変換が成功したときに消える。一括変換画面のエラーは開始時の失敗などに限られ、表示が繰り返し出入りしないので、結果のまとめと同じく内容の並びの中に表示する。

### 5.6 設定の保存（FR-04、FR-07）

- 保存先は Tauri の `app_config_dir()` 配下の `settings.json`。Rust が読み書きする。
- 内容: `schemaVersion`、`language`（`ja` / `en` / 未設定）、`preset`、`params`、`batchInputDir`、`batchOutputDir`。
- `preset` はプリセットの名前か `null`。`null` は「カスタム」（パラメータを手で変えた状態）を表す。
- Rust は設定をメモリに 1 つだけ持ち、`save_settings` とフォルダの選択はどちらもそれを更新してからファイル全体を書き直す。書き込みは §5.4 と同じく一時ファイルからの改名で行い、書き込み途中の壊れたファイルを残さない（既存の設定ファイルは上書きする）。
- フォルダは Rust がダイアログで選ばれたときに記録する。起動時に存在すれば、選択済みとしてハンドル表に登録し直す。存在しなければ未選択に戻す。
- `get_settings` はパスを返さない。返すのは `{ language, preset, params, batchInput, batchOutput }` で、`batchInput` は `pick_batch_input` と同じ `{ dirLabel, targets, ignoredCount }`（起動時に列挙し直したもの）、`batchOutput` は `{ dirLabel }`。未選択ならどちらも `null`。
- 読み込みに失敗した、または `schemaVersion` が未知の場合は既定値で起動する（設定ファイルが原因で起動できなくならないようにする）。
- `preset` が未知の値、または `params` が §4.5 の範囲外の場合は、この 2 つだけを既定（ロゴ（カラー））に戻し、言語とフォルダは残す。
- 保存はパラメータ変更から 1 秒後にまとめて行う。

## 6. IPC

### 6.1 コマンド

| コマンド | 引数 | 戻り値 | 説明 |
| --- | --- | --- | --- |
| `get_param_spec` | – | 各パラメータの範囲、プリセット定義 | §4.5 |
| `get_settings` | – | Settings | §5.6 |
| `save_settings` | language, preset, params | – | フォルダは含めない |
| `pick_image` | – | `{ id, name } \| null` | Rust がファイルダイアログを開く |
| `load_preview` | id | PNG のバイナリ（`tauri::ipc::Response`） | base64 を使わずバイナリで返す。`Response` はバイト列しか運べないので幅・高さは返さず、フロントエンドが表示した画像の `naturalWidth` / `naturalHeight` から得る |
| `convert` | id, params, seq | `{ svg, pathCount, bytes, elapsedMs }` | §5.1 |
| `save_svg` | id | `{ savedName } \| null` | Rust が保存ダイアログを開き直近の結果を保存 |
| `pick_batch_input` | – | `{ dirLabel, targets: string[], ignoredCount } \| null` | |
| `pick_batch_output` | – | `{ dirLabel } \| null` | |
| `start_batch` | params | – | §5.2 |
| `cancel_batch` | – | – | |
| `get_about` | – | `{ version }` | |

- どのコマンドもパスを引数に取らない。`dirLabel` は表示用の文字列で、フロントエンドから送り返されることはない。
- 引数・戻り値の型は Rust で定義し、ts-rs で `src/ipc/generated/` に生成する。フロントエンドは `src/ipc/` の型付きラッパー経由でのみ呼ぶ。

### 6.2 イベント（Rust → フロントエンド）

| イベント | ペイロード |
| --- | --- |
| `image-dropped` | `{ id, name }` または `{ error }` |
| `batch-progress` | `{ done, total, current: string \| null }` |
| `batch-item` | `{ name, status: "ok" \| "failed", outputName?, error? }` |
| `batch-finished` | `{ succeeded, failed, skipped, cancelled }` |

D&D は Rust の `WindowEvent::DragDrop` で受ける。複数ファイルが落とされた場合は先頭の対応ファイルだけを使う。単体変換タブ以外が表示中でも受け付け、単体変換タブに切り替えて表示する。

## 7. セキュリティ（NFR-01）

- **capabilities**: フロントエンドに与える権限は、イベントの購読とウィンドウ操作に必要な `core:*` の最小集合に限る。dialog / fs / shell / opener / http などのプラグイン権限は一切与えない。アプリ自身のコマンドは §6.1 のものだけを登録する。
- **CSP**（`tauri.conf.json`）:

  ```
  default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src ipc: http://ipc.localhost
  ```

- **通信しない**: HTTP クライアント（`reqwest`、`ureq`、`hyper` のクライアント機能など）とアップデータ系プラグインを依存に含めない。`cargo-deny` の `bans` で禁止する。
- **SVG の表示**: §5.1 のとおり `<img>` 経由でのみ表示する。
- **既知の脆弱性**: 同梱する依存（Rust の crate と npm の本番用の依存）を `cargo deny check advisories` と `npm audit --omit=dev` で検査する。PR と main への push、毎週の定期実行（`.github/workflows/audit.yml`）に加え、リリース時にも検査し、見つかれば下書きを作らない。依存の更新は Dependabot が毎月 PR にする（脆弱性を直す更新は、GitHub の Dependabot セキュリティ更新が見つかり次第 PR にする）。保守されていない crate の通知は、直接の依存だけを対象にする（間接の依存は vtracer と Tauri の GTK バインディングから来ていて、置き換えられないため）。
- **WebView2 の起動オプション**（Windows、`tauri.conf.json` の `additionalBrowserArgs`）: `--no-proxy-server --host-resolver-rules="MAP * ~NOTFOUND"` を渡す。指定しないと WebView2 は、システムのプロキシ設定にある自動構成スクリプト（PAC）を取りに行き、起動の約 60 秒後に Microsoft のサーバーへも接続する（T14 で観察）。画面と IPC は Tauri のカスタムプロトコル（Windows では `http://tauri.localhost` と `http://ipc.localhost`）で WebView2 の中で処理され、名前解決を通らないため、このオプションで外部の名前解決をすべて失敗させても動作に影響しない。この値を指定すると wry の既定値が置き換わるので、既定の `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection` も同じ文字列に含める。
- **止められない通信**: このオプションを付けても、WebView2 のブラウザープロセスは起動直後に `substrate.office.com`（Microsoft 365 のサービス）へ接続する。Chromium の通信の仕組みを通らない、ランタイム自身の通信で、アプリからは止められない。NFR-01 の例外として扱い、README に書く。WebKitGTK（Linux）ではこの種の通信は観察されていない。

## 8. フロントエンド

### 8.1 画面構成

見た目と配置は [mockup/project/](mockup/project/)（各画面の `.dc.html`） に従う。要点:

- アプリ名は「SVG Tracer」。
- ウィンドウの既定サイズ 1200×800、最小サイズ 960×640（NFR-08）。
- 上部バー: アプリ名、タブ（単体変換 / 一括変換）、言語切り替え、「このアプリについて」。
- 左側: パラメータパネル（プリセット選択、主要パラメータ、折りたたみ式の詳細設定）。両タブで同じ状態を共有する。
- 単体変換タブ: 元画像と SVG の 2 ペイン、ズーム操作、下部に画像情報と変換結果（パス数、ファイルサイズ、変換時間）、「画像を開く」「SVG を保存」。画像未選択時はドロップ領域を表示する。
- 一括変換タブ: 入力・出力フォルダの選択行、対象ファイル一覧（状態付き）、進捗バー、開始 / キャンセル、終了時の集計。

### 8.2 プレビュー（NFR-08）

- 2 つのペインは倍率と表示位置を共有する。ズームは 10%〜1600%。Ctrl + ホイール、ボタン（−、＋、全体表示、100%）で操作し、ドラッグで移動する。
- 拡大縮小の基準点: Ctrl + ホイールはカーソルの下の点、−／＋ボタンはペインの中心の点が、拡大縮小の前後で同じ位置に留まるようにする（細部を比べるとき、見ている場所が画面の外へずれないようにするため）。表示位置は倍率に合わせて補正する。全体表示と 100% は画像をペインの中央に戻す。
- SVG は CSS の `transform: scale()` ではなく表示サイズ（width / height）を変えて拡大する。拡大しても再描画されてぼやけないようにするため。
- 元画像は 200% 以上で `image-rendering: pixelated` にし、ピクセルの境界を見えるようにする。
- 背景は市松模様（CSS のグラデーションで描く）。

### 8.3 状態管理

- React の `useReducer` と Context で持つ。外部の状態管理ライブラリは使わない。
- 状態は「パラメータ」「単体変換」「一括変換」「言語」の 4 つの reducer に分ける。

### 8.4 多言語（FR-04）

- `src/i18n/ja.ts` を基準の辞書とし、`en.ts` は `ja.ts` と同じキーを持つことを型で強制する（キーの欠けはコンパイルエラーになる）。
- 初期言語: 設定に保存された言語 → なければ `navigator.languages` の先頭が `ja` で始まれば日本語、それ以外は英語。
- 文言に値を差し込む場合は `{count}` 形式のプレースホルダを使う関数を用意する。

### 8.5 テーマ（NFR-08）

- 色は `styles/tokens.css` の CSS カスタムプロパティとして定義し、`@media (prefers-color-scheme: dark)` でダーク用の値に切り替える。コンポーネントの CSS に色の値を直接書かない。
- フォントは同梱せず、OS のものを使う（`tokens.css` の `--font-sans`）。並びは `"Segoe UI", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic UI", system-ui, sans-serif`。Windows では Segoe UI と Yu Gothic UI（入っていれば Noto Sans JP）になる。Linux では、並びの先頭で見つからなかった名前に対しても fontconfig が日本語のゴシック体の既定を返し、WebKitGTK はそれを採用するので、実際のフォントはその環境の既定（Ubuntu の標準では Noto Sans CJK JP、Takao などの設定があればそちら）になる。`Noto Sans CJK JP` を並びに入れても、この既定より先には効かない。見た目を OS をまたいでそろえるにはフォントの同梱が要るが、数 MB 増えるので行わない。

## 9. テスト

### 9.1 フィクスチャ

第三者の画像を使わず、リポジトリ内の生成プログラム（`crates/tracer/examples/gen_fixtures.rs`）で作ってコミットする。

| ファイル | 内容 | 目的 |
| --- | --- | --- |
| `logo_color.png` | 透過背景、4 色、円・角丸四角・三角形 | 基本の品質 |
| `logo_small_transparency.png` | 中央だけが透過で、5 本のサンプル行の透過ピクセルが 0.4×幅 未満のロゴ | §4.3 P2 の回帰テスト |
| `icon_mono.png` | 白背景に黒の単純な図形 | 白黒モード |
| `icon_mono_transparent.png` | 透過背景に黒の図形 | §4.3 P3 の確認 |
| `logo_color.jpg` / `.webp` / `.bmp` / `.gif` | `logo_color.png` を各形式で保存（JPEG・BMP は白背景） | 形式ごとのデコード |
| `anim.gif` | 1 フレーム目と 2 フレーム目で色の違うアニメーション | 1 フレーム目の使用 |
| `corrupt.png` | PNG のシグネチャの後が壊れたデータ | DecodeFailed |
| `not_image.png` | 中身がテキスト | UnsupportedFormat |

上限超過の画像はファイルとして置かず、テスト中にヘッダーだけの PNG を生成して確かめる。

### 9.2 品質テスト（NFR-03）

- 変換後の SVG を `resvg` で元画像と同じサイズにラスター化し、前処理を適用した元画像と比べる。
  - カラーモード: 透明なキャンバスにラスター化し、§4.3 P1 を適用した元画像と比べる。
  - 白黒モード: 白で塗りつぶしたキャンバスにラスター化し、§4.3 P1・P3 を適用した元画像（不透明）と比べる。VTracer の白黒モードは黒のパスだけを出力し、背景は透過のまま残すため、透明なキャンバスでは白の部分がすべて不一致になる。入力に透過があるかどうかで手順は分けない。
- 不一致ピクセル: 透過/不透明が食い違う、または不透明同士で RGB のいずれかの差が `COLOR_TOLERANCE`（32）を超えるピクセル。
- 合格条件: 不一致ピクセルの割合が `MAX_MISMATCH_RATIO`（2%）以下。スパイクでの実測の最大は 0.86%（白黒アイコン）で、2 倍以上の余裕を残しつつ、劣化を見逃しにくい値にしている。
- 加えて、SVG が XML として妥当、`<image>` を含まない、`viewBox` と幅・高さが §4.4 どおりであることを検査する。

### 9.3 テストの一覧

| 対象 | 種類 | 主な内容 |
| --- | --- | --- |
| crates/tracer | 単体 | デコード（形式ごと、壊れたファイル、上限超過）、前処理 P1〜P3、SVG 整形、パラメータの範囲検査、出力名（既存ファイルとの重複、入力同士の重複、大文字小文字、多重拡張子、連番の繰り上がり） |
| crates/tracer | 品質 | §9.2 を全フィクスチャ × 該当プリセットで実行 |
| src-tauri | 単体 | 一括変換（一時フォルダを使い、成功・失敗混在、キャンセル後に一時ファイルが残らないこと）、設定の読み書き（壊れた設定ファイルでも既定値で起動） |
| フロントエンド | 単体 | プリセット → カスタムの切り替え、デバウンスと古い結果の破棄、エラーコードから文言への変換、一括変換の状態遷移、言語の初期決定 |
| 全体 | 手動 | 受け入れ基準 6（インストーラーから両 OS で確認）。チェックリストを `docs/manual-test.md` に置く |

- 性能（NFR-02）: 1024×1024 のフィクスチャの変換時間を `--release` のテストで測る。CI では余裕を見て 6 秒を超えたら失敗とし、3 秒以内は開発者の PC（基準環境）で手動確認する。
- CI（`ci.yml`）は Windows と Ubuntu で、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`、`cargo deny check`、フロントエンドの lint・型検査・テスト、ts-rs の生成物が最新であることの確認を実行する。

## 10. 実装前に検証する事項（スパイク）

作業計画の最初のタスクとして、次を小さなコードで確かめ、結果をこの設計書に反映してから本実装に入る。

1. §4.3 P2（1px の透過余白）で、透過部分の小さいロゴでもキーイングが働くこと。働かない場合は VTracer の `convert` 相当の処理を自前で持つ方式に切り替える。
   - 結果: 働く。`logo_small_transparency.png` で、P2 なしでは透過部分が塗りつぶされ（不一致率 6.89%）、P2 ありでは透過のまま残った（0.06%）。自前の処理は持たない。
2. §4.3 P3 で、透過背景の白黒アイコンが正しく変換されること。
   - 結果: 正しく変換される。P3 なしでは全面が黒になる（87.62%）。P3 ありでは `icon_mono_transparent.png`・`icon_mono.png` のどちらも 0.86%。比較方法は §9.2 の白黒モードの手順による。
3. §4.4 のルート要素の置き換えで、余白付きの画像が元のサイズで正しく表示されること。
   - 結果: 正しく表示される。514×514 の出力を `viewBox="1 1 512 512"`・`width="512" height="512"` に置き換えると、512×512 で描画され、位置も元画像と一致した。
4. 各プリセットでフィクスチャを変換し、§9.2 の不一致率を実測して、プリセットの値と `MAX_MISMATCH_RATIO` を確定する。
   - 結果: カラー 6 フィクスチャ × 2 プリセットと白黒 2 フィクスチャ × 1 プリセットの 14 通りで、不一致率は 0.06〜0.86%。プリセットは §4.5 の値、`MAX_MISMATCH_RATIO` は 2% に確定した。1024×1024 の変換時間は `--release` で 40〜77ms（NFR-02 の 3 秒以内）。
5. Tauri 2 で、Rust 側の `WindowEvent::DragDrop` からファイルパスを受け取れること（Windows と Linux の両方）。

1〜4 の測定値と手順は [spike-report.md](spike-report.md) にまとめている。
