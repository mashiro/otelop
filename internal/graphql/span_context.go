package graphql

import "context"

func contextFlags(flags *uint32) *UInt32 {
	if flags == nil {
		return nil
	}
	value := UInt32(*flags)
	return &value
}

func contextTraceFlags(flags *uint32) *int32 {
	if flags == nil {
		return nil
	}
	value := int32(*flags & 0xff)
	return &value
}

func contextIsRemote(flags *uint32) *bool {
	if flags == nil || *flags&0x100 == 0 {
		return nil
	}
	value := *flags&0x200 != 0
	return &value
}

func (r *SpanResolver) Flags(ctx context.Context) (*UInt32, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return nil, err
	}
	return contextFlags(s.Flags), nil
}

func (r *SpanResolver) TraceFlags(ctx context.Context) (*int32, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return nil, err
	}
	return contextTraceFlags(s.Flags), nil
}

func (r *SpanResolver) TraceState(ctx context.Context) (*string, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil {
		return nil, err
	}
	return s.TraceState, nil
}

func (r *SpanResolver) ParentIsRemote(ctx context.Context) (*bool, error) {
	_, s, err := r.resolve(ctx)
	if err != nil || s == nil || s.ParentSpanID == "" || s.ParentSpanID == "0000000000000000" {
		return nil, err
	}
	return contextIsRemote(s.Flags), nil
}
