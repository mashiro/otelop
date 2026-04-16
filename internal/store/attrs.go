package store

import (
	"math"
	"strconv"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

// attributesToMap converts pcommon.Map to a plain map[string]any.
func attributesToMap(attrs pcommon.Map) map[string]any {
	result := make(map[string]any, attrs.Len())
	attrs.Range(func(k string, v pcommon.Value) bool {
		result[k] = valueToAny(v)
		return true
	})
	return result
}

// resourceInfo returns the flattened resource map plus service.name. Both
// are computed in a single Range pass so the service.name lookup doesn't
// need a second O(n) scan over the same attributes.
func resourceInfo(attrs pcommon.Map) (map[string]any, string) {
	result := make(map[string]any, attrs.Len())
	var svcName string
	attrs.Range(func(k string, v pcommon.Value) bool {
		if k == "service.name" {
			svcName = v.AsString()
		}
		result[k] = valueToAny(v)
		return true
	})
	return result, svcName
}

func valueToAny(v pcommon.Value) any {
	switch v.Type() {
	case pcommon.ValueTypeStr:
		return v.Str()
	case pcommon.ValueTypeInt:
		return v.Int()
	case pcommon.ValueTypeDouble:
		// encoding/json rejects NaN/±Inf, so fall back to a string so the
		// original information survives without breaking the broadcast.
		d := v.Double()
		if math.IsNaN(d) || math.IsInf(d, 0) {
			return strconv.FormatFloat(d, 'g', -1, 64)
		}
		return d
	case pcommon.ValueTypeBool:
		return v.Bool()
	case pcommon.ValueTypeBytes:
		return v.Bytes().AsRaw()
	case pcommon.ValueTypeSlice:
		slice := v.Slice()
		result := make([]any, slice.Len())
		for i := 0; i < slice.Len(); i++ {
			result[i] = valueToAny(slice.At(i))
		}
		return result
	case pcommon.ValueTypeMap:
		return attributesToMap(v.Map())
	default:
		return v.AsString()
	}
}
