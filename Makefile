.PHONY: help run-kafka run-warpstream stop logs clean kafka-ui warpstream-console send-good send-bad

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
	@echo "  make kafka-ui           - Open Kafka UI in browser"
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
	@echo "📊 Kafka UI: http://localhost:8081 (wait for KafkaUI to initialize)"
	@echo "📡 Collector: http://localhost:8080"
	@open http://localhost:8081 2>/dev/null || xdg-open http://localhost:8081 2>/dev/null || true

# Start with Warpstream
run-warpstream:
	@echo "Starting OpenSnowcat with Warpstream..."
	docker compose -f docker-warpstream.yml up -d
	@echo ""
	@echo "⏳ Waiting for Warpstream to start..."
	@sleep 10
	@echo ""
	@echo "✅ Environment started!"
	@echo "📊 Kafka UI: http://localhost:8081 (wait for KafkaUI to initialize)"
	@echo "📡 Collector: http://localhost:8080"
	@echo ""
	@echo "🌐 Opening Warpstream Console and Kafka UI..."
	@CONSOLE_URL=$$(docker logs warp 2>&1 | grep "console.warpstream.com" | grep -o 'https:/[^[:space:]]*' | sed 's|https:/console|https://console|' | head -1); \
	if [ -n "$$CONSOLE_URL" ]; then \
		echo "Warpstream Console: $$CONSOLE_URL"; \
		open "$$CONSOLE_URL" 2>/dev/null || xdg-open "$$CONSOLE_URL" 2>/dev/null || echo "$$CONSOLE_URL"; \
	else \
		echo "Console URL not found yet, run: make warpstream-console"; \
	fi
	@sleep 2
	@open http://localhost:8081 2>/dev/null || xdg-open http://localhost:8081 2>/dev/null || true

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

# Open Kafka UI
kafka-ui:
	@open http://localhost:8081 2>/dev/null || xdg-open http://localhost:8081 2>/dev/null || echo "Open http://localhost:8081 in your browser"

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
