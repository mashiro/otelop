.PHONY: build run test lint clean

build:
	go build -o otelop ./cmd/otelop

run: build
	./otelop

test:
	go test ./...

lint:
	golangci-lint run ./...

clean:
	rm -f otelop
