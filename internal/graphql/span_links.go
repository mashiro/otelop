package graphql

import (
	"context"
	"fmt"
	"math"

	gql "github.com/graph-gophers/graphql-go"
	"github.com/mashiro/otelop/internal/storage"
)

type UInt32 uint32

func (UInt32) ImplementsGraphQLType(name string) bool { return name == "UInt32" }
func (u *UInt32) UnmarshalGraphQL(input any) error {
	var n float64
	switch v := input.(type) {
	case int32:
		n = float64(v)
	case int64:
		n = float64(v)
	case int:
		n = float64(v)
	case float64:
		n = v
	default:
		return fmt.Errorf("UInt32 requires an integer")
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > math.MaxUint32 || math.Trunc(n) != n {
		return fmt.Errorf("UInt32 out of range")
	}
	*u = UInt32(n)
	return nil
}

type linkArgs struct {
	First int32
	After *string
}

func (r *SpanResolver) LinkCount(ctx context.Context) (int32, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return 0, err
	}
	return int32(s.LinkCount), nil
}
func (r *SpanResolver) DroppedLinksCount(ctx context.Context) (UInt32, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return 0, err
	}
	return UInt32(s.DroppedLinksCount), nil
}
func (r *SpanResolver) Links(ctx context.Context, args linkArgs) (*spanLinkConnectionResolver, error) {
	return r.linkPage(ctx, args, false)
}
func (r *SpanResolver) IncomingLinks(ctx context.Context, args linkArgs) (*spanLinkConnectionResolver, error) {
	return r.linkPage(ctx, args, true)
}
func (r *SpanResolver) linkPage(ctx context.Context, args linkArgs, incoming bool) (*spanLinkConnectionResolver, error) {
	_, s, err := r.resolve(ctx)
	if err != nil {
		return nil, err
	}
	result := &spanLinkConnectionResolver{items: []*spanLinkResolver{}}
	if s == nil {
		return result, nil
	}
	first := int(args.First)
	after := ""
	if args.After != nil {
		after = *args.After
	}
	loadPage := r.storage.SpanLinkSummaries
	// Keep list attribute selection available to API clients without loading it
	// for compact UI queries. Selection paths include fragments and ignore aliases.
	if gql.HasSelectedField(ctx, "items.attributes") {
		loadPage = r.storage.SpanLinks
	}
	page, err := loadPage(ctx, s.TraceID, s.SpanID, incoming, after, first)
	if err != nil {
		return nil, err
	}
	result.page = page
	for _, link := range page.Items {
		result.items = append(result.items, &spanLinkResolver{link: link})
	}
	return result, nil
}

type spanLinkConnectionResolver struct {
	page  storage.SpanLinkPage
	items []*spanLinkResolver
}

func (r *spanLinkConnectionResolver) Items() []*spanLinkResolver { return r.items }
func (r *spanLinkConnectionResolver) HasNextPage() bool          { return r.page.HasNextPage }
func (r *spanLinkConnectionResolver) EndCursor() *string {
	if r.page.EndCursor == "" {
		return nil
	}
	return &r.page.EndCursor
}

type spanLinkResolver struct{ link storage.SpanLinkDetail }

func (r *spanLinkResolver) Ordinal() int32        { return int32(r.link.Ordinal) }
func (r *spanLinkResolver) TraceID() gql.ID       { return gql.ID(r.link.TraceID) }
func (r *spanLinkResolver) SpanID() gql.ID        { return gql.ID(r.link.SpanID) }
func (r *spanLinkResolver) SourceTraceID() gql.ID { return gql.ID(r.link.SourceTraceID) }
func (r *spanLinkResolver) SourceSpanID() gql.ID  { return gql.ID(r.link.SourceSpanID) }
func (r *spanLinkResolver) TraceState() *string   { return &r.link.TraceState }
func (r *spanLinkResolver) Flags() *UInt32        { return contextFlags(&r.link.Flags) }
func (r *spanLinkResolver) TraceFlags() *int32    { return contextTraceFlags(&r.link.Flags) }
func (r *spanLinkResolver) IsRemote() *bool       { return contextIsRemote(&r.link.Flags) }
func (r *spanLinkResolver) Attributes() JSONMap   { return attrsToJSON(r.link.Attributes) }
func (r *spanLinkResolver) DroppedAttributesCount() UInt32 {
	return UInt32(r.link.DroppedAttributesCount)
}
func (r *spanLinkResolver) TargetStatus() string {
	if !storage.ValidSpanContext(r.link.TraceID, r.link.SpanID) {
		return "INVALID_CONTEXT"
	}
	if r.link.Target == nil {
		return "NOT_FOUND"
	}
	return "AVAILABLE"
}
func (r *spanLinkResolver) Target() *linkedSpanResolver {
	if r.link.Target == nil {
		return nil
	}
	return &linkedSpanResolver{s: r.link.Target}
}
func (r *spanLinkResolver) Source() *linkedSpanResolver {
	if r.link.Source == nil {
		return nil
	}
	return &linkedSpanResolver{s: r.link.Source}
}

type linkedSpanResolver struct{ s *storage.LinkedSpan }

func (r *linkedSpanResolver) TraceID() gql.ID     { return gql.ID(r.s.TraceID) }
func (r *linkedSpanResolver) SpanID() gql.ID      { return gql.ID(r.s.SpanID) }
func (r *linkedSpanResolver) Name() string        { return r.s.Name }
func (r *linkedSpanResolver) ServiceName() string { return r.s.ServiceName }

func (r *Resolver) SpanLink(ctx context.Context, args struct {
	SourceTraceID gql.ID
	SourceSpanID  gql.ID
	Ordinal       int32
}) (*spanLinkResolver, error) {
	link, err := r.storage.SpanLinkByID(ctx, string(args.SourceTraceID), string(args.SourceSpanID), int(args.Ordinal))
	if err != nil || link == nil {
		return nil, err
	}
	return &spanLinkResolver{link: *link}, nil
}
