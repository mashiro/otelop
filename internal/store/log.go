package store

import (
	"time"

	"go.opentelemetry.io/collector/pdata/plog"
)

// LogData represents a single log record.
type LogData struct {
	Timestamp         time.Time      `json:"timestamp"`
	ObservedTimestamp time.Time      `json:"observedTimestamp"`
	TraceID           string         `json:"traceId"`
	SpanID            string         `json:"spanId"`
	SeverityNumber    int32          `json:"severityNumber"`
	SeverityText      string         `json:"severityText"`
	Body              string         `json:"body"`
	ServiceName       string         `json:"serviceName"`
	Attributes        map[string]any `json:"attributes"`
	Resource          map[string]any `json:"resource"`
}

// ConvertLogs converts plog.Logs into a slice of LogData.
func ConvertLogs(ld plog.Logs) []*LogData {
	var result []*LogData

	for i := 0; i < ld.ResourceLogs().Len(); i++ {
		rl := ld.ResourceLogs().At(i)
		resource := attributesToMap(rl.Resource().Attributes())
		var svcName string
		if serviceName, ok := rl.Resource().Attributes().Get("service.name"); ok {
			svcName = serviceName.AsString()
		}

		for j := 0; j < rl.ScopeLogs().Len(); j++ {
			sl := rl.ScopeLogs().At(j)
			for k := 0; k < sl.LogRecords().Len(); k++ {
				lr := sl.LogRecords().At(k)
				logData := &LogData{
					Timestamp:         lr.Timestamp().AsTime(),
					ObservedTimestamp: lr.ObservedTimestamp().AsTime(),
					TraceID:           lr.TraceID().String(),
					SpanID:            lr.SpanID().String(),
					SeverityNumber:    int32(lr.SeverityNumber()),
					SeverityText:      lr.SeverityText(),
					Body:              lr.Body().AsString(),
					ServiceName:       svcName,
					Attributes:        attributesToMap(lr.Attributes()),
					Resource:          resource,
				}
				result = append(result, logData)
			}
		}
	}

	return result
}
