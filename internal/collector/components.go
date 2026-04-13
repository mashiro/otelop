package collector

import (
	"go.opentelemetry.io/collector/connector"
	"go.opentelemetry.io/collector/exporter"
	"go.opentelemetry.io/collector/exporter/otlpexporter"
	"go.opentelemetry.io/collector/exporter/otlphttpexporter"
	"go.opentelemetry.io/collector/extension"
	"go.opentelemetry.io/collector/otelcol"
	"go.opentelemetry.io/collector/processor"
	"go.opentelemetry.io/collector/receiver"
	"go.opentelemetry.io/collector/receiver/otlpreceiver"
	"go.opentelemetry.io/collector/service/telemetry/otelconftelemetry"
)

func components(exporterFactory exporter.Factory) (otelcol.Factories, error) {
	receivers, err := otelcol.MakeFactoryMap[receiver.Factory](
		otlpreceiver.NewFactory(),
	)
	if err != nil {
		return otelcol.Factories{}, err
	}

	exporters, err := otelcol.MakeFactoryMap[exporter.Factory](
		exporterFactory,
		otlpexporter.NewFactory(),
		otlphttpexporter.NewFactory(),
	)
	if err != nil {
		return otelcol.Factories{}, err
	}

	processors, err := otelcol.MakeFactoryMap[processor.Factory]()
	if err != nil {
		return otelcol.Factories{}, err
	}

	connectors, err := otelcol.MakeFactoryMap[connector.Factory]()
	if err != nil {
		return otelcol.Factories{}, err
	}

	extensions, err := otelcol.MakeFactoryMap[extension.Factory]()
	if err != nil {
		return otelcol.Factories{}, err
	}

	return otelcol.Factories{
		Receivers:  receivers,
		Exporters:  exporters,
		Processors: processors,
		Connectors: connectors,
		Extensions: extensions,
		Telemetry:  otelconftelemetry.NewFactory(),
	}, nil
}
