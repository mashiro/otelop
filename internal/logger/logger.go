package logger

import (
	"context"
	"errors"
	"log/slog"
	"os"
)

// ParseLevel converts a log level string (debug|info|warn|error) to slog.Level.
func ParseLevel(s string) (slog.Level, error) {
	var level slog.Level
	err := level.UnmarshalText([]byte(s))
	return level, err
}

// Setup configures the default slog logger with a text handler to stderr.
// Additional handlers (e.g. OTel bridge) can be passed to fan out log
// records to multiple destinations.
func Setup(level slog.Level, extra ...slog.Handler) {
	opts := &slog.HandlerOptions{Level: level}
	handlers := []slog.Handler{slog.NewTextHandler(os.Stderr, opts)}
	handlers = append(handlers, extra...)

	if len(handlers) == 1 {
		slog.SetDefault(slog.New(handlers[0]))
		return
	}
	slog.SetDefault(slog.New(&fanoutHandler{handlers: handlers}))
}

// fanoutHandler dispatches each log record to multiple slog handlers.
type fanoutHandler struct {
	handlers []slog.Handler
}

func (h *fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h *fanoutHandler) Handle(ctx context.Context, record slog.Record) error {
	var errs []error
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, record.Level) {
			if err := handler.Handle(ctx, record.Clone()); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func (h *fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	handlers := make([]slog.Handler, len(h.handlers))
	for i, handler := range h.handlers {
		handlers[i] = handler.WithAttrs(attrs)
	}
	return &fanoutHandler{handlers: handlers}
}

func (h *fanoutHandler) WithGroup(name string) slog.Handler {
	handlers := make([]slog.Handler, len(h.handlers))
	for i, handler := range h.handlers {
		handlers[i] = handler.WithGroup(name)
	}
	return &fanoutHandler{handlers: handlers}
}
