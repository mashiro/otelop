.PHONY: build run test lint clean frontend dev

build: frontend
	go build -tags embed -o otelop ./cmd/otelop

run: build
	./otelop

# Development: starts Go backend and Vite dev server in parallel.
# Browser → http://localhost:5173 (Vite proxies /api, /ws to :4319)
dev:
	@trap 'kill 0' EXIT; \
	go run ./cmd/otelop & \
	cd frontend && pnpm run dev & \
	wait

test:
	go test ./...

lint:
	golangci-lint run ./...

clean:
	rm -f otelop

frontend:
	cd frontend && pnpm install --frozen-lockfile && pnpm run build
