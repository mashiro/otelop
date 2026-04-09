# otelop

ブラウザベースの OpenTelemetry ビューア。
otel-tui（https://github.com/ymtdzzz/otel-tui）のWeb版として新規作成する。

## 名前の由来
- **otel** → OpenTelemetry
- **telop** → テロップ（リアルタイムに流れてくる情報）

## 概要

OTelシグナル（Traces / Metrics / Logs）をブラウザでリアルタイムに可視化するローカル開発向けツール。

## アーキテクチャ

ワンバイナリ構成。フロントエンドのビルド成果物を Go の `embed` パッケージで埋め込み、単一バイナリで配布する。

```
OTLP Exporter / OTel Collector
        │
        ▼
┌───────────────────────────────────────┐
│          Go Single Binary             │
│                                       │
│  - OTLPレシーバー (gRPC :4317, HTTP :4318) │
│  - インメモリストア (ring buffer)          │
│  - WebSocket hub (ブロードキャスト)       │
│  - REST API + 静的ファイル配信 :8080     │
│  - embed.FS (React ビルド成果物)         │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Embedded React Frontend        │  │
│  │  - Traces タブ (waterfall)      │  │
│  │  - Metrics タブ (時系列チャート)  │  │
│  │  - Logs タブ (仮想スクロール)    │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

## 技術スタック

### バックエンド (Go)
- OTLPレシーバー: `go.opentelemetry.io/collector`
- WebSocket: `github.com/coder/websocket`
- ストア層は otel-tui の `tuiexporter` パッケージを参考に実装

### フロントエンド (React + TypeScript)
- ビルド: Vite
- スタイリング: Tailwind CSS
- UIコンポーネント: shadcn/ui
- 状態管理: Jotai
- リアルタイム: ネイティブ WebSocket

| 機能 | ライブラリ |
|------|-----------|
| Trace waterfall | visx |
| Metrics chart | visx |
| Logs list | @tanstack/virtual |

## 実装フェーズ

### Phase 1: バックエンド骨格
- OTLPレシーバー起動（gRPC / HTTP）
- インメモリストア（上限付き ring buffer）
- WebSocket hub（新着シグナルをブロードキャスト）
- REST API（初期データ取得）

### Phase 2: フロントエンド基盤
- WebSocket クライアント
- Jotai で状態管理
- Traces / Metrics / Logs の3タブ構成
- 各タブの一覧表示

### Phase 3: 詳細表示
- Trace waterfall（スパン構造の可視化）
- Topology graph（サービス間依存関係）
- Metrics 時系列チャート

## 参考OSS
- https://github.com/ymtdzzz/otel-tui — ストア層・OTLPレシーバー構成
- https://github.com/CtrlSpice/otel-desktop-viewer — Web UI実装の参考
- https://github.com/jaegertracing/jaeger-ui — Trace waterfall実装の参考
