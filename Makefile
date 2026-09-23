.PHONY: help run-kafka run-warpstream stop logs logs-follow clean console kafka-ui warpstream-console send-good send-bad build-console dev-console

# Default target
help:
	@echo "OpenSnowcat Devkit - Available commands:"
	@echo ""
	@echo "  make run-kafka          - Start environment with Apache Kafka"
	@echo "  make run-warpstream     - Start environment with Warpstream"
	@echo "  make stop               - Stop all containers"
	@echo "  make logs               - Show logs from all containers"
	@echo "  make logs-follow        - Follow logs from all containers"
	@echo "  make clean              - Stop and remove all containers and volumes"
	@echo "  make console            - Open the OpenSnowcat Console in browser"
	@echo "  make kafka-ui           - Start (optional) Kafka UI on :8081 and open it"
	@echo "  make build-console      - Build the console image from ./console"
	@echo "  make dev-console        - Run the console with hot reload on the host (needs Node 22)"
	@echo "  make warpstream-console - Get Warpstream console URL"
	@echo "  make send-good          - Send 10 good events to collector"
	@echo "  make send-bad           - Send 10 bad events to collector"
	@echo ""

# Start with Apache Kafka
run-kafka:
	@echo "Starting OpenSnowcat with Apache Kafka..."
	@echo "Add '127.0.0.1  warp' to your /etc/hosts if not already done"
	docker compose up -d
	@echo ""
	@echo "✅ Environment started!"
	@echo "🖥️  Console:   http://localhost:3000"
	@echo "📡 Collector: http://localhost:8080"
	@echo "📊 Kafka UI:  optional, run 'make kafka-ui'"
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

# Start with Warpstream
run-warpstream:
	@echo "Starting OpenSnowcat with Warpstream..."
	docker compose -f docker-warpstream.yml up -d
	@echo ""
	@echo "⏳ Waiting for Warpstream to start..."
	@sleep 10
	@echo ""
	@echo "✅ Environment started!"
	@echo "🖥️  Console:   http://localhost:3000"
	@echo "📡 Collector: http://localhost:8080"
	@echo "📊 Kafka UI:  optional, run 'make kafka-ui'"
	@echo ""
	@echo "🌐 Opening Warpstream Console and OpenSnowcat Console..."
	@CONSOLE_URL=$$(docker logs warp 2>&1 | grep "console.warpstream.com" | grep -o 'https:/[^[:space:]]*' | sed 's|https:/console|https://console|' | head -1); \
	if [ -n "$$CONSOLE_URL" ]; then \
		echo "Warpstream Console: $$CONSOLE_URL"; \
		open "$$CONSOLE_URL" 2>/dev/null || xdg-open "$$CONSOLE_URL" 2>/dev/null || echo "$$CONSOLE_URL"; \
	else \
		echo "Console URL not found yet, run: make warpstream-console"; \
	fi
	@sleep 2
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

# Stop all containers
stop:
	@echo "Stopping all containers..."
	@docker compose down 2>/dev/null || true
	@docker compose -f docker-warpstream.yml down 2>/dev/null || true
	@echo "✅ All containers stopped"

# Show logs
logs:
	@docker compose logs || docker compose -f docker-warpstream.yml logs

# Follow logs
logs-follow:
	@docker compose logs -f || docker compose -f docker-warpstream.yml logs -f

# Clean everything
clean:
	@echo "Stopping and removing all containers and volumes..."
	@docker compose down -v 2>/dev/null || true
	@docker compose -f docker-warpstream.yml down -v 2>/dev/null || true
	@echo "✅ Environment cleaned"

# Open the OpenSnowcat Console
console:
	@open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || echo "Open http://localhost:3000 in your browser"

# Start the optional Kafka UI (topic-level tooling) and open it
kafka-ui:
	@docker compose --profile kafka-ui up -d kafka-ui 2>/dev/null || docker compose -f docker-warpstream.yml --profile kafka-ui up -d kafka-ui
	@open http://localhost:8081 2>/dev/null || xdg-open http://localhost:8081 2>/dev/null || echo "Open http://localhost:8081 in your browser"

# Build the console image from source (contributors)
build-console:
	docker compose -f docker-compose.yml -f compose.build.yml build console

# Run the console on the host with hot reload, against the running devkit (needs Node 22)
dev-console:
	cd console && npm install && npm run dev

# Get Warpstream console URL
warpstream-console:
	@echo "🌐 Warpstream Console URL:"
	@docker logs warp 2>&1 | grep "console.warpstream.com" | grep -o 'https:/[^[:space:]]*' | sed 's|https:/console|https://console|' | head -1

# Send good events
send-good:
	@echo "Sending 10 good events to collector..."
	./send_good_events.sh 10 http://localhost:8080 2

# Send bad events
send-bad:
	@echo "Sending 10 bad events to collector..."
	./send_bad_events.sh 10 http://localhost:8080 2
