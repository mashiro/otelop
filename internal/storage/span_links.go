package storage

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"

	duckdb "github.com/duckdb/duckdb-go/v2"
)

// LinkedSpan is deliberately bounded: resolving a link never recursively loads a trace.
type LinkedSpan struct {
	TraceID     string
	SpanID      string
	Name        string
	ServiceName string
}

type SpanLinkDetail struct {
	SpanLinkRow
	SourceTraceID string
	SourceSpanID  string
	Ordinal       int
	Source        *LinkedSpan
	Target        *LinkedSpan
}

type SpanLinkPage struct {
	Items       []SpanLinkDetail
	HasNextPage bool
	EndCursor   string
}

type linkCursor struct {
	TraceID       string
	SpanID        string
	Incoming      bool
	SourceTraceID string
	SourceSpanID  string
	Ordinal       int
}

func ValidSpanContext(traceID, spanID string) bool {
	for _, id := range []struct {
		value  string
		length int
	}{{traceID, 32}, {spanID, 16}} {
		if len(id.value) != id.length || strings.Trim(id.value, "0") == "" {
			return false
		}
		if _, err := hex.DecodeString(id.value); err != nil {
			return false
		}
	}
	return true
}

func (s *Storage) appendSpanLinks(ctx context.Context, spans []SpanRow) error {
	return s.writer.Raw(func(conn any) error {
		app, err := duckdb.NewAppenderFromConn(conn.(driver.Conn), "", "span_links")
		if err != nil {
			return err
		}
		defer func() { _ = app.Close() }()
		for _, span := range spans {
			for ordinal, link := range span.Links {
				if err := app.AppendRow(span.TraceID, span.SpanID, int32(ordinal), link.TraceID, link.SpanID, link.TraceState, link.Flags, link.Attributes, link.DroppedAttributesCount); err != nil {
					return err
				}
			}
		}
		return app.Flush()
	})
}

// SpanLinks uses one bounded query for a page and all of its source/target summaries.
// Cursors are scoped to the span and direction; sorting by identity preserves link order.
func (s *Storage) SpanLinks(ctx context.Context, traceID, spanID string, incoming bool, after string, first int) (page SpanLinkPage, err error) {
	ctx, span := startStorageSpan(ctx, "storage.SpanLinks")
	defer func() { endStorageSpan(span, err) }()
	page.Items = []SpanLinkDetail{}
	if first < 1 || first > 100 {
		return page, fmt.Errorf("first must be between 1 and 100")
	}
	cursor := linkCursor{TraceID: traceID, SpanID: spanID, Incoming: incoming, Ordinal: -1}
	if after != "" {
		raw, decodeErr := base64.RawURLEncoding.DecodeString(after)
		if decodeErr != nil {
			return page, fmt.Errorf("invalid link cursor")
		}
		if json.Unmarshal(raw, &cursor) != nil || cursor.TraceID != traceID || cursor.SpanID != spanID || cursor.Incoming != incoming || cursor.Ordinal < 0 {
			return page, fmt.Errorf("invalid link cursor")
		}
	}
	predicate := "source_trace_id = ? AND source_span_id = ?"
	if incoming {
		if !ValidSpanContext(traceID, spanID) {
			return page, nil
		}
		predicate = "trace_id = ? AND span_id = ?"
	}
	page.Items, err = s.querySpanLinks(ctx, `SELECT * FROM span_links WHERE `+predicate+`
 AND (source_trace_id, source_span_id, ordinal) > (?, ?, ?)
 ORDER BY source_trace_id, source_span_id, ordinal LIMIT ?`,
		traceID, spanID, cursor.SourceTraceID, cursor.SourceSpanID, cursor.Ordinal, first+1)
	if err != nil {
		return page, err
	}
	if len(page.Items) > first {
		page.HasNextPage = true
		page.Items = page.Items[:first]
	}
	if len(page.Items) > 0 {
		last := page.Items[len(page.Items)-1]
		raw, _ := json.Marshal(linkCursor{TraceID: traceID, SpanID: spanID, Incoming: incoming, SourceTraceID: last.SourceTraceID, SourceSpanID: last.SourceSpanID, Ordinal: last.Ordinal})
		page.EndCursor = base64.RawURLEncoding.EncodeToString(raw)
	}
	return page, nil
}

// SpanLinkByID resolves an exact recorded link independently of list pagination.
func (s *Storage) SpanLinkByID(ctx context.Context, traceID, spanID string, ordinal int) (*SpanLinkDetail, error) {
	if ordinal < 0 {
		return nil, fmt.Errorf("ordinal must be non-negative")
	}
	items, err := s.querySpanLinks(ctx, "SELECT * FROM span_links WHERE source_trace_id = ? AND source_span_id = ? AND ordinal = ?", traceID, spanID, ordinal)
	if err != nil || len(items) == 0 {
		return nil, err
	}
	return &items[0], nil
}

func (s *Storage) querySpanLinks(ctx context.Context, selection string, args ...any) ([]SpanLinkDetail, error) {
	items := []SpanLinkDetail{}
	rows, err := s.DB().QueryContext(ctx, "WITH page AS ("+selection+")"+`
 SELECT p.source_trace_id,p.source_span_id,p.ordinal,p.trace_id,p.span_id,
 p.trace_state,p.flags,p.attributes::VARCHAR,p.dropped_attributes_count,
 source.name,source.service_name,target.name,target.service_name
 FROM page p
 LEFT JOIN LATERAL (
  SELECT s.name,r.service_name FROM spans s JOIN resources r USING(resource_hash)
  WHERE s.trace_id=p.source_trace_id AND s.span_id=p.source_span_id
  ORDER BY s.ingested_at LIMIT 1
 ) source ON true
 LEFT JOIN LATERAL (
  SELECT s.name,r.service_name FROM spans s JOIN resources r USING(resource_hash)
  WHERE s.trace_id=p.trace_id AND s.span_id=p.span_id
  ORDER BY s.ingested_at LIMIT 1
 ) target ON true
 ORDER BY p.source_trace_id,p.source_span_id,p.ordinal`, args...)
	if err != nil {
		return nil, fmt.Errorf("storage: query span links: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var link SpanLinkDetail
		var attrs *string
		var sourceName, sourceService, targetName, targetService sql.NullString
		if err := rows.Scan(&link.SourceTraceID, &link.SourceSpanID, &link.Ordinal, &link.TraceID, &link.SpanID, &link.TraceState, &link.Flags, &attrs, &link.DroppedAttributesCount, &sourceName, &sourceService, &targetName, &targetService); err != nil {
			return nil, err
		}
		link.Attributes, err = decodeAttrs(attrs)
		if err != nil {
			return nil, err
		}
		if sourceName.Valid {
			link.Source = &LinkedSpan{TraceID: link.SourceTraceID, SpanID: link.SourceSpanID, Name: sourceName.String, ServiceName: sourceService.String}
		}
		if targetName.Valid && ValidSpanContext(link.TraceID, link.SpanID) {
			link.Target = &LinkedSpan{TraceID: link.TraceID, SpanID: link.SpanID, Name: targetName.String, ServiceName: targetService.String}
		}
		items = append(items, link)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return items, nil
}
