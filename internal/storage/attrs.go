package storage

import (
	"math"
	"strconv"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

// attributesToMap converts pcommon.Map to a plain map[string]any. Adapted
// from the old store package's attrs.go: the row shapes differ (this package
// stores attributes as a JSON column instead of a Go struct field consumed by
// GraphQL), but the pdata -> Go value mapping is identical.
func attributesToMap(attrs pcommon.Map) map[string]any {
	result := make(map[string]any, attrs.Len())
	attrs.Range(func(k string, v pcommon.Value) bool {
		result[k] = valueToAny(v)
		return true
	})
	return result
}

// resourceInfo returns the flattened resource attribute map plus
// service.name, computed in a single Range pass.
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
		// original information survives the JSON attribute column instead of
		// failing the whole row.
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
