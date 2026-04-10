# otelop 開発ガイドライン

## プロジェクト概要

OpenTelemetry シグナル（Traces / Metrics / Logs）をブラウザでリアルタイム可視化するローカル開発向けツール。

## 開発コマンド

```bash
mise run dev      # 開発サーバー起動
mise run check    # フォーマット・lint・型チェック
mise run test     # Go + フロントエンドテスト実行
mise run build    # ビルド
```

## バックエンド

- Go + OpenTelemetry Collector（内蔵）
- lint: `golangci-lint run ./...`
- フォーマット修正: `golangci-lint fmt ./...`
- テスト: `go test ./...`
- テストは `internal/store/` と `internal/websocket/` に存在

## フロントエンド

- vite-plus（vp）を使用。コマンドは package.json の scripts 経由で実行する
- フォーマット自動修正: `pnpm --filter otelop-frontend fix`
- テスト: `pnpm --filter otelop-frontend test`
- テストヘルパーは `frontend/src/test/factories.ts` に集約

## コーディング規約

### CSS・スタイリング

- shadcn のセマンティックカラー（`bg-muted`, `text-foreground` 等）を使う。`bg-foreground/[0.03]` のような arbitrary opacity は避ける
- ライト/ダークモード両方で確認する。ライトモードは見落としやすい
- `glass-card` はカード背景。ライトモードでは白方向（メインコンテンツが周囲より明るい）
- shadcn コンポーネントのデフォルトスタイルが `dark:` プレフィックスでカスタムを上書きすることがある。必要に応じて `dark:` オーバーライドを追加

### React・状態管理

- `useEffect` 内で `setState` しない。イベントハンドラで直接処理する
- `useRef` のタイマーはアンマウント時に `useEffect` cleanup で `clearTimeout` する
- 重複パターンはファクトリ関数やコンポーネントに抽出する（例: `createSearchAtom`, `CopyJsonButton`）
- 新しい UI コンポーネントを作る前に shadcn に既存のものがないか確認する

### コメント

- WHAT コメント（`{/* Bar */}`, `{/* Operation name */}`）は不要。コードで自明
- WHY コメント（なぜこの実装なのか）だけ残す

## ワークフロー

- コミットはユーザーの許可があるまでしない
- `mise run check` と `mise run test` を変更後に必ず実行
- agent-browser でライト/ダークモード両方の表示を確認する
