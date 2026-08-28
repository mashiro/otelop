package runtime

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"

	otelop "github.com/mashiro/otelop"
	"github.com/mashiro/otelop/internal/broadcast"
	"github.com/mashiro/otelop/internal/collector"
	otelopexporter "github.com/mashiro/otelop/internal/exporter"
	otelopgraphql "github.com/mashiro/otelop/internal/graphql"
	"github.com/mashiro/otelop/internal/logger"
	"github.com/mashiro/otelop/internal/netutil"
	"github.com/mashiro/otelop/internal/selftelemetry"
	"github.com/mashiro/otelop/internal/server"
	"github.com/mashiro/otelop/internal/storage"
	ws "github.com/mashiro/otelop/internal/websocket"
)

// Runtime owns a running otelop server and its collector, storage, and telemetry.
type Runtime struct {
	cancel            context.CancelFunc
	startedAt         time.Time
	done              <-chan struct{}
	storage           *storage.Storage
	hub               *ws.Hub
	srv               *server.Server
	col               *otelcol.Collector
	shutdownTelemetry func(context.Context) error
	shutdownOnce      sync.Once
}

// Start validates opts and starts all otelop runtime components.
func Start(ctx context.Context, opts Options) (*Runtime, error) {
	if err := Validate(opts); err != nil {
		return nil, err
	}
	level, err := logger.ParseLevel(opts.LogLevel)
	if err != nil {
		return nil, err
	}
	logger.Setup(level)

	ctx, cancel := context.WithCancel(ctx)
	rt := &Runtime{
		cancel:    cancel,
		done:      ctx.Done(),
		startedAt: time.Now().Round(0),
	}

	rt.hub = ws.NewHub()
	go rt.hub.Run(ctx)

	storagePath, retention, maxSize, err := resolveStorageOptions(opts)
	if err != nil {
		rt.Shutdown()
		return nil, err
	}

	var st *storage.Storage
	onAdd := func(ctx context.Context, sig broadcast.SignalType, data any) {
		rt.hub.BroadcastContext(ctx, ws.Message{Type: sig, Data: data})
	}
	st, err = storage.Open(ctx, storage.Options{
		Path:      storagePath,
		Retention: retention,
		MaxSize:   maxSize,
		OnCommitBatch: func(deliveries []storage.CommitDelivery) {
			broadcast.NewBatch(st, onAdd, func() bool { return rt.hub.ClientCount() > 0 })(deliveries)
		},
	})
	if err != nil {
		rt.Shutdown()
		return nil, fmt.Errorf("open storage %s: %w", storagePath, err)
	}
	rt.storage = st

	runtimeInfo := otelopgraphql.RuntimeInfo{
		Version:          opts.Version,
		StartedAt:        rt.startedAt,
		HTTPAddr:         opts.HTTPAddr,
		OTLPGRPCAddr:     opts.OTLPGRPCAddr,
		OTLPHTTPAddr:     opts.OTLPHTTPAddr,
		ProxyURL:         RedactURL(opts.ProxyURL),
		ProxyProtocol:    opts.ProxyProtocol,
		Debug:            opts.Debug,
		LogLevel:         opts.LogLevel,
		Retention:        retention,
		StoragePath:      storagePath,
		RetentionDisplay: opts.Retention,
		MaxSizeDisplay:   opts.MaxSize,
		RenderWindowMax:  opts.RenderWindowMax,
	}
	rt.srv = server.New(rt.storage, rt.hub, otelop.FrontendFS(), runtimeInfo)

	if err := rt.srv.Listen(ctx); err != nil {
		rt.Shutdown()
		return nil, fmt.Errorf("bind %s: %w", opts.HTTPAddr, err)
	}
	go func() {
		if err := rt.srv.Start(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server error", "error", err)
			rt.cancel()
		}
	}()

	selfTelemetryEndpoint := ""
	if opts.Debug {
		selfTelemetryEndpoint, err = netutil.Loopback(opts.OTLPGRPCAddr)
		if err != nil {
			rt.Shutdown()
			return nil, fmt.Errorf("invalid otlp-grpc address: %w", err)
		}
	}

	slog.Debug("starting collector", "grpc", opts.OTLPGRPCAddr, "http", opts.OTLPHTTPAddr)
	col, err := collector.New(otelopexporter.NewFactory(rt.storage), collector.Config{
		GRPCEndpoint:          opts.OTLPGRPCAddr,
		HTTPEndpoint:          opts.OTLPHTTPAddr,
		ProxyURL:              opts.ProxyURL,
		ProxyProtocol:         opts.ProxyProtocol,
		ProxyHeaders:          buildProxyHeaders(opts.ProxyAuth),
		LogLevel:              opts.LogLevel,
		SelfTelemetryEndpoint: selfTelemetryEndpoint,
	})
	if err != nil {
		rt.Shutdown()
		return nil, fmt.Errorf("failed to create collector: %w", err)
	}
	rt.col = col

	colErrCh := make(chan error, 1)
	go func() {
		if err := col.Run(ctx); err != nil {
			colErrCh <- err
		}
		close(colErrCh)
	}()

	if err := waitCollectorReady(ctx, col, colErrCh); err != nil {
		rt.Shutdown()
		return nil, err
	}
	go watchCollectorErrors(colErrCh, rt.cancel, slog.Default())

	if opts.Debug {
		slog.Debug("starting self-telemetry", "endpoint", selfTelemetryEndpoint)
		result, err := selftelemetry.Setup(ctx, selfTelemetryEndpoint)
		if err != nil {
			rt.Shutdown()
			return nil, fmt.Errorf("failed to setup self-telemetry: %w", err)
		}
		rt.shutdownTelemetry = result.Shutdown

		otelHandler := otelslog.NewHandler("otelop", otelslog.WithLoggerProvider(result.LoggerProvider))
		logger.Setup(level, otelHandler)

		if err := registerMetrics(rt.storage, rt.hub); err != nil {
			rt.Shutdown()
			return nil, fmt.Errorf("failed to register metrics: %w", err)
		}
	}

	return rt, nil
}

func (r *Runtime) StartedAt() time.Time { return r.startedAt }

func (r *Runtime) Done() <-chan struct{} { return r.done }

// Shutdown stops every component owned by the runtime.
func (r *Runtime) Shutdown() {
	if r == nil {
		return
	}
	r.shutdownOnce.Do(func() {
		shutdownCtx := context.Background()
		if r.shutdownTelemetry != nil {
			if err := r.shutdownTelemetry(shutdownCtx); err != nil {
				slog.Error("self-telemetry shutdown error", "error", err)
			}
		}
		if r.col != nil {
			r.col.Shutdown()
		}
		if r.srv != nil {
			if err := r.srv.Shutdown(shutdownCtx); err != nil {
				slog.Error("HTTP server shutdown error", "error", err)
			}
		}
		if r.storage != nil {
			if err := r.storage.Close(); err != nil {
				slog.Error("storage shutdown error", "error", err)
			}
		}
		if r.cancel != nil {
			r.cancel()
		}
	})
}

func waitCollectorReady(ctx context.Context, col *otelcol.Collector, errCh <-chan error) error {
	const budget = 2 * time.Second
	const tick = 10 * time.Millisecond
	deadline := time.NewTimer(budget)
	defer deadline.Stop()
	ticker := time.NewTicker(tick)
	defer ticker.Stop()
	for {
		select {
		case err, ok := <-errCh:
			if !ok {
				return errors.New("collector exited before becoming ready")
			}
			if err != nil {
				return fmt.Errorf("collector failed to start: %w", err)
			}
		case <-ticker.C:
		case <-deadline.C:
			return fmt.Errorf("collector did not become ready within %s", budget)
		case <-ctx.Done():
			return ctx.Err()
		}
		if col.GetState() == otelcol.StateRunning {
			return nil
		}
	}
}

func watchCollectorErrors(errCh <-chan error, cancel context.CancelFunc, logger *slog.Logger) {
	err, ok := <-errCh
	if !ok || err == nil {
		return
	}
	logger.Error("collector stopped unexpectedly, shutting down", "error", err)
	cancel()
}

func registerMetrics(s *storage.Storage, hub *ws.Hub) error {
	meter := otel.Meter("otelop")
	if err := s.RegisterTelemetry(meter); err != nil {
		return err
	}

	traceGauge, err := meter.Int64ObservableGauge("otelop.store.traces",
		metric.WithDescription("Number of traces in the store"),
	)
	if err != nil {
		return err
	}
	metricGauge, err := meter.Int64ObservableGauge("otelop.store.metrics",
		metric.WithDescription("Number of metric series in the store"),
	)
	if err != nil {
		return err
	}
	logGauge, err := meter.Int64ObservableGauge("otelop.store.logs",
		metric.WithDescription("Number of log entries in the store"),
	)
	if err != nil {
		return err
	}
	if _, err := meter.RegisterCallback(func(ctx context.Context, o metric.Observer) error {
		traces, metrics, logs, err := s.Counts(ctx)
		if err != nil {
			return err
		}
		o.ObserveInt64(traceGauge, int64(traces))
		o.ObserveInt64(metricGauge, int64(metrics))
		o.ObserveInt64(logGauge, int64(logs))
		return nil
	}, traceGauge, metricGauge, logGauge); err != nil {
		return err
	}
	_, err = meter.Int64ObservableGauge("otelop.websocket.clients",
		metric.WithDescription("Number of connected WebSocket clients"),
		metric.WithInt64Callback(func(_ context.Context, o metric.Int64Observer) error {
			o.Observe(int64(hub.ClientCount()))
			return nil
		}),
	)
	return err
}
