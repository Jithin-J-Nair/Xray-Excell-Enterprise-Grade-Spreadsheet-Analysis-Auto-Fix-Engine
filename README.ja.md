# X-RAY://EXCEL

**Language / 言語:** [English](README.md) · [日本語](README.ja.md)

---

**経理・業務チーム向けの Excel もつれ検出ツール。**  
乱れたブックの構造上の問題をスキャンし、提案された修正をすべて確認し、残したいものだけ適用して、きれいなコピーをダウンロードします。原本は上書きしません。

> Excelの代替ではありません。財務監査ツールでもありません。メイン作業にExcel完全計算エンジンは載せません。

---

## できること

| 機能 | 内容 |
|---|---|
| **構造スキャン** | 循環参照・外部リンク・揮発性関数・全角・日付／数値の文字列・結合・重複など、18種別の検出 |
| **日本向け清掃パック** | 「修正と確認」でワンクリック。空白・全角・日付文字列・数値文字列（T007 / T009 / T010 / T013）を検出があるときだけオン |
| **ファイル間の数式マップ** | リンク先ブックを一緒にアップロードし、ファイル間／外部の辺だけにフィルタ |
| **確認 → 残す → ダウンロード** | セル単位の変更前後。残すものにチェック。適用はコピーへのみ書き込み |
| **役割別チェックパック** | 概要で経理・予算・請求向けに検出を絞り込み（構造ビューであり財務サインオフではない） |
| **監査と変更パック** | 操作履歴と、サーバー適用ごとの逆変更ログ（パッチJSON）。Undoでアップロード原本を復元 |
| **追加の整え（任意）** | 書式提案。LibreOfficeまたはWindows Excel COMで**コピー上**の再計算と、数式の**値差分**一覧 |

### やらないこと（正直な範囲）

- 財務・業務上の正しさの証明はしません  
- メインの「修正と確認」内でExcel完全計算は実行しません  
- VBA / Power Query / ピボット / グラフ / 独自アップロードルールは修復しません  
- 再計算には LibreOffice（`soffice`）またはWindows版Excelが必要（LibreOffice ≠ Excel互換）  

---

## クイックスタート

```bash
npm install
npx drizzle-kit push    # DATABASE_URL の PostgreSQL
npm run dev             # http://localhost:3000
```

1. アプリを開き、ヘッダーの **EN / JP** を切り替え（ブラウザに保存されます）。  
2. **ブックのスキャンを開始** — または monster / 日本語サンプルを生成。  
3. **概要**（ヘルス＋役割パック）、**数式マップ**、**問題**、**修正と確認**の順に確認。  
4. **日本向け清掃** または **かんたん清掃** → **変更を確認** → 残す／スキップ → **適用してダウンロード**。  
5. サーバースキャンでは任意で **追加の整え → 数式を再計算**。コピー上で変わったキャッシュ値が表で見えます。

プライベートモードは端末内にバイトを留めます。サーバーモードは大きなバッチと恒久的な Undo 向けです。

---

## アーキテクチャ

```
ブラウザ（Next.js · React · Tailwind）
  ダッシュボード · スキャン · 分析タブ · EN/JP
  ローカルモード：同じ TypeScript エンジンをブラウザ内で実行
        │
API（ルートハンドラ）
  upload · analysis · preview · apply · jobs · download · undo · samples
        │
同型エンジン（src/lib/excel）
  parse → analyze（18リスク＋グラフ）→ transform（T001–T013）→ serialize
        │
PostgreSQL（Drizzle）＋ファイルストア（.data/）
```

**一貫性:** 同じモデル・ツール・設定なら常に同じ差分と出力。適用はアップロードを変更しません。サーバーの Undo はバイト一致の原本を復元します（プライベートモードは端末に残った原本を再ダウンロード）。

---

## 修正ツール（T001–T013）

| ID | グループ | 内容 | 安全性 |
|---|---|---|---|
| T001 | 整理 | 繰り返し定数を Parameters シートへ | 要確認 |
| T002 | 整理 | 列の多数派パターンに数式を揃える | 要確認 |
| T003 | 低減 | 外部リンクを保存値に置き換え | 要確認 |
| T004 | 低減 | 揮発性関数をキャッシュ値で固定 | 要確認 |
| T005 | 整理 | 結合セルを解除 | 要確認 |
| T006 | 整理 | 壊れた／重複した名前付き範囲を削除 | 比較的安全 |
| T007 | 清掃 | 空白除去 | 比較的安全 · かんたん清掃 · 日本向け清掃 |
| T008 | 清掃 | 完全重複行を削除 | 要確認 |
| T009 | 清掃 | 全角→半角（NFC） | 比較的安全 · かんたん清掃 · 日本向け清掃 |
| T010 | 清掃 | 日付文字列→日付セル | 比較的安全 · 日本向け清掃 |
| T011 | 低減 | IFERRORでエラーを隠す（論理は直さない） | 要確認 |
| T012 | 低減 | 循環の鎖で1セルを固定して切断 | 要確認 |
| T013 | 清掃 | 数値文字列→数値 | 比較的安全 · 日本向け清掃 |

**かんたん清掃** = T007 + T009 のみ。  
**日本向け清掃** = 検出があるときの T007 + T009 + T010 + T013。

---

## 検出種別（18）

`CIRCULAR_REF` · `VOLATILE_FUNCTION` · `EXTERNAL_LINK` · `HARDCODED_NUMBER` · `MERGED_CELLS` · `HIDDEN_SHEET` · `INCONSISTENT_FORMULA` · `BROKEN_NAMED_RANGE` · `ERROR_CELL` · `DUPLICATE_ROWS` · `MIXED_TYPES` · `WHITESPACE` · `UNICODE_FULLWIDTH` · `DATE_AS_TEXT` · `NUMBER_AS_TEXT` · `ENCODING` · `EMPTY_SHEET` · `LONG_FORMULA`

---

## API 概要

| メソッド | パス | 用途 |
|---|---|---|
| `POST` | `/api/upload` | マルチパートアップロード |
| `POST` | `/api/analysis` | サーバースキャン開始 |
| `POST` | `/api/analysis/import` | ローカル結果の保存 |
| `GET` | `/api/analysis/:id` | 結果・ジョブ・監査 |
| `POST` | `/api/analysis/:id/preview` | ツールの差分プレビュー |
| `POST` | `/api/analysis/:id/apply` | 残した変更の適用→エクスポート |
| `POST` | `/api/analysis/:id/enhancement` | 追加の整え／再計算 |
| `GET` | `/api/jobs/:id` | ジョブ状態と出力 |
| `GET` | `/api/outputs/:id/download` | バイナリダウンロード |
| `POST` | `/api/undo/:applyId` | 原本復元 |
| `POST` | `/api/samples` | `monster` または `jp` デモ |

エラー形式: `{ errorCode, message, retryable, details? }`。

---

## 開発とテスト

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration   # PostgreSQL が必要
npm run build
npm start
npm run worker             # 本番用ジョブポーラー
```

主な単体テスト: 数式解析、変換（残す／スキップ含む）、グラフフィルタ（循環／外部／ファイル間）、日本向け清掃、役割パック、値差分（`tests/japan-top5.test.ts`）。

---

## 本番メモ

- `XRAY_BASIC_AUTH_USER` と `XRAY_BASIC_AUTH_PASSWORD` を設定（欠落時は 503 でフェイルクローズ）。  
- `XRAY_DATA_DIR` を永続化し、保持期間・ハートビートは `XRAY_*` で調整。  
- HTTPS 必須。Basic Auth は共有ゲートであり多ユーザー IAM ではありません。  
- モデルが保てない OOXML 機能は黙って落とさず、エクスポートを拒否します。  

コーパス／リリース根拠: `docs/RELEASE_BENCHMARK.md`。

---

## ライセンス

MIT — リポジトリのライセンスファイルを参照。

**Language / 言語:** [English](README.md) · [日本語](README.ja.md)
