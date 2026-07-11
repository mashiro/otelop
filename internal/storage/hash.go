package storage

import (
	"encoding/binary"
	"fmt"
	"hash"
	"hash/fnv"
	"math"
	"sort"
)

// Value type tags. Prefixing every hashed value with a tag (rather than
// relying on the raw bytes alone) keeps e.g. the string "3" and the int64 3
// from hashing identically, and keeps a length prefix on variable-length
// values from being confusable with adjacent fields.
const (
	tagNil byte = iota
	tagString
	tagInt64
	tagFloat64
	tagBool
	tagBytes
	tagSlice
	tagMap
	tagUint64
)

// hashResource returns a stable 64-bit key for a resource's attribute set.
//
// This is FNV-1a over a canonical (sorted-key) encoding rather than
// hash/maphash, which is what the old store package seriesKey used. maphash
// reseeds every process start, which is fine for a purely in-memory cache but
// wrong here: resource_hash and series_key are DuckDB primary keys that must
// resolve to the same dimension row across restarts of the same database
// file, so the hash function itself must be deterministic across processes.
func hashResource(attrs map[string]any) uint64 {
	h := fnv.New64a()
	writeAttrs(h, attrs)
	return h.Sum64()
}

type metricScopeIdentity struct {
	SchemaURL  string
	Name       string
	Version    string
	Attributes map[string]any
}

type metricSeriesIdentity struct {
	ResourceHash uint64
	Scope        metricScopeIdentity
	MetricName   string
	Attributes   map[string]any
}

// hashSeries returns a stable 64-bit key for one metric series. Resource and
// instrumentation-scope identity are included because equal metric names and
// point attributes from different producers are independent OTLP series.
func hashSeries(identity metricSeriesIdentity) uint64 {
	h := fnv.New64a()
	writeUint64(h, identity.ResourceHash)
	writeString(h, identity.Scope.SchemaURL)
	writeString(h, identity.Scope.Name)
	writeString(h, identity.Scope.Version)
	writeValue(h, identity.Scope.Attributes)
	writeString(h, identity.MetricName)
	writeValue(h, identity.Attributes)
	return h.Sum64()
}

func writeUint64(h hash.Hash, v uint64) {
	_, _ = h.Write([]byte{tagUint64})
	var buf [8]byte
	binary.LittleEndian.PutUint64(buf[:], v)
	_, _ = h.Write(buf[:])
}

// writeAttrs hashes attrs in sorted-key order so callers never have to think
// about map iteration order (Go's map order is randomized, and OTLP doesn't
// guarantee attribute insertion order either) or about insertion order into
// the pcommon.Map that produced attrs.
func writeAttrs(h hash.Hash, attrs map[string]any) {
	if len(attrs) == 0 {
		return
	}
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		writeString(h, k)
		writeValue(h, attrs[k])
	}
}

func writeLen(h hash.Hash, n int) {
	var buf [8]byte
	binary.LittleEndian.PutUint64(buf[:], uint64(n))
	_, _ = h.Write(buf[:])
}

func writeString(h hash.Hash, s string) {
	_, _ = h.Write([]byte{tagString})
	writeLen(h, len(s))
	_, _ = h.Write([]byte(s))
}

// writeValue hashes one attribute value. The type set mirrors what
// valueToAny can produce: string, int64, float64, bool, []byte, []any (from
// ValueTypeSlice), and map[string]any (from ValueTypeMap), plus nil.
func writeValue(h hash.Hash, v any) {
	switch x := v.(type) {
	case nil:
		_, _ = h.Write([]byte{tagNil})
	case string:
		writeString(h, x)
	case int64:
		_, _ = h.Write([]byte{tagInt64})
		var buf [8]byte
		binary.LittleEndian.PutUint64(buf[:], uint64(x))
		_, _ = h.Write(buf[:])
	case float64:
		_, _ = h.Write([]byte{tagFloat64})
		var buf [8]byte
		binary.LittleEndian.PutUint64(buf[:], math.Float64bits(x))
		_, _ = h.Write(buf[:])
	case bool:
		_, _ = h.Write([]byte{tagBool})
		if x {
			_, _ = h.Write([]byte{1})
		} else {
			_, _ = h.Write([]byte{0})
		}
	case []byte:
		_, _ = h.Write([]byte{tagBytes})
		writeLen(h, len(x))
		_, _ = h.Write(x)
	case []any:
		_, _ = h.Write([]byte{tagSlice})
		writeLen(h, len(x))
		for _, e := range x {
			writeValue(h, e)
		}
	case map[string]any:
		_, _ = h.Write([]byte{tagMap})
		writeLen(h, len(x))
		writeAttrs(h, x)
	default:
		// Not produced by valueToAny today, but fall back to a stable string
		// form rather than panicking if the attribute conversion ever grows a
		// new pcommon value type.
		writeString(h, fmt.Sprintf("%v", x))
	}
}
