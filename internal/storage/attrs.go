package storage

import (
	"bytes"
	"encoding/binary"
	"math"
	"sort"
	"strconv"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

var otlpAttributesEncodingPrefix = []byte{'O', 'A', 'T', 'T', 'R', 1}

// encodeOTLPAttributes preserves pcommon's exact value types in a stable,
// versioned binary representation. The parallel JSON columns remain the
// convenient query projection; this encoding is the lossless source for
// future decoders and distinguishes int/double, bytes/string, nested values,
// and every IEEE-754 bit pattern including NaN and infinities.
func encodeOTLPAttributes(attrs pcommon.Map) []byte {
	var buf bytes.Buffer
	buf.Write(otlpAttributesEncodingPrefix)
	writePcommonMap(&buf, attrs)
	return buf.Bytes()
}

func encodedAttributesOrFallback(encoded []byte, attrs map[string]any) ([]byte, error) {
	if len(encoded) != 0 {
		return encoded, nil
	}
	converted := pcommon.NewMap()
	if err := converted.FromRaw(attrs); err != nil {
		return nil, err
	}
	return encodeOTLPAttributes(converted), nil
}

func writePcommonMap(buf *bytes.Buffer, attrs pcommon.Map) {
	keys := make([]string, 0, attrs.Len())
	attrs.Range(func(key string, _ pcommon.Value) bool {
		keys = append(keys, key)
		return true
	})
	sort.Strings(keys)
	writeBinaryLen(buf, len(keys))
	for _, key := range keys {
		writeBinaryString(buf, key)
		value, _ := attrs.Get(key)
		writePcommonValue(buf, value)
	}
}

func writePcommonValue(buf *bytes.Buffer, value pcommon.Value) {
	switch value.Type() {
	case pcommon.ValueTypeStr:
		buf.WriteByte(tagString)
		writeBinaryString(buf, value.Str())
	case pcommon.ValueTypeInt:
		buf.WriteByte(tagInt64)
		writeBinaryUint64(buf, uint64(value.Int()))
	case pcommon.ValueTypeDouble:
		buf.WriteByte(tagFloat64)
		writeBinaryUint64(buf, math.Float64bits(value.Double()))
	case pcommon.ValueTypeBool:
		buf.WriteByte(tagBool)
		if value.Bool() {
			buf.WriteByte(1)
		} else {
			buf.WriteByte(0)
		}
	case pcommon.ValueTypeBytes:
		buf.WriteByte(tagBytes)
		raw := value.Bytes().AsRaw()
		writeBinaryLen(buf, len(raw))
		buf.Write(raw)
	case pcommon.ValueTypeSlice:
		buf.WriteByte(tagSlice)
		slice := value.Slice()
		writeBinaryLen(buf, slice.Len())
		for i := 0; i < slice.Len(); i++ {
			writePcommonValue(buf, slice.At(i))
		}
	case pcommon.ValueTypeMap:
		buf.WriteByte(tagMap)
		writePcommonMap(buf, value.Map())
	default:
		buf.WriteByte(tagNil)
	}
}

func writeBinaryString(buf *bytes.Buffer, value string) {
	writeBinaryLen(buf, len(value))
	buf.WriteString(value)
}

func writeBinaryLen(buf *bytes.Buffer, length int) {
	writeBinaryUint64(buf, uint64(length))
}

func writeBinaryUint64(buf *bytes.Buffer, value uint64) {
	var raw [8]byte
	binary.LittleEndian.PutUint64(raw[:], value)
	buf.Write(raw[:])
}

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
		// JSON is the query projection and rejects NaN/±Inf, so represent them
		// textually there. encodeOTLPAttributes retains the exact float bits in
		// the parallel raw column.
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
