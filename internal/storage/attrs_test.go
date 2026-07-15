package storage

import (
	"bytes"
	"math"
	"testing"

	"go.opentelemetry.io/collector/pdata/pcommon"
)

func TestEncodeOTLPAttributes_IsStableAndTypePreserving(t *testing.T) {
	ordered := pcommon.NewMap()
	ordered.PutStr("text", "1")
	ordered.PutInt("number", 1)
	reordered := pcommon.NewMap()
	reordered.PutInt("number", 1)
	reordered.PutStr("text", "1")
	if !bytes.Equal(encodeOTLPAttributes(ordered), encodeOTLPAttributes(reordered)) {
		t.Fatal("encoding depends on attribute insertion order")
	}

	intAttrs := pcommon.NewMap()
	intAttrs.PutInt("value", 1)
	doubleAttrs := pcommon.NewMap()
	doubleAttrs.PutDouble("value", 1)
	if bytes.Equal(encodeOTLPAttributes(intAttrs), encodeOTLPAttributes(doubleAttrs)) {
		t.Fatal("int64 and double attributes encoded identically")
	}

	bytesAttrs := pcommon.NewMap()
	bytesAttrs.PutEmptyBytes("value").FromRaw([]byte("same"))
	stringAttrs := pcommon.NewMap()
	stringAttrs.PutStr("value", "same")
	if bytes.Equal(encodeOTLPAttributes(bytesAttrs), encodeOTLPAttributes(stringAttrs)) {
		t.Fatal("bytes and string attributes encoded identically")
	}

	nanAttrs := pcommon.NewMap()
	nanAttrs.PutDouble("value", math.Float64frombits(0x7ff8000000000042))
	if bytes.Contains(encodeOTLPAttributes(nanAttrs), []byte("NaN")) {
		t.Fatal("non-finite double was stringified instead of preserving its bits")
	}
}
