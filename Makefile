CONSOLE_URL ?= http://localhost:8082

.PHONY: help run run-kafka run-warpstream stop logs logs-follow clean console open-console wait-console kafka-ui warpstream-console send-good send-bad build-console dev-console

# Default target
help:
	@echo "OpenSnowcat Devkit - Available commands:"
	@echo ""
	@echo "  make run                - Start environment (Apache Kafka) and open the console"
	@echo "  make run-kafka          - Start environment with Apache Kafka"
	@echo "  make run-warpstream     - Start environment with Warpstream"
	@echo "  make stop               - Stop all containers"
	@echo "  make logs               - Show logs from all containers"
	@echo "  make logs-follow        - Follow logs from all containers"
	@echo "  make clean              - Stop and remove all containers and volumes"
	@echo "  make console            - Open the OpenSnowcat Console ($(CONSOLE_URL))"
	@echo "  make kafka-ui           - Start the optional Kafka UI on :8081 and open it"
	@echo "  make build-console      - Rebuild the console image from ./console"
	@echo "  make dev-console        - Run the console with hot reload on the host (needs Node 22)"
	@echo "  make warpstream-console - Get Warpstream console URL"
	@echo "  make send-good          - Send 10 good events to collector"
	@echo "  make send-bad           - Send 10 bad events to collector"
	@echo ""

# Default environment: Apache Kafka
run: run-kafka

# Start with Apache Kafka
run-kafka:
	@echo "Starting OpenSnowcat with Apache Kafka..."
	@echo "Add '127.0.0.1  warp' to your /etc/hosts if not already done"
	docker compose up -d
	@echo ""
	@echo "✅ Environment started!"
	@echo "🖥️  Console:   $(CONSOLE_URL)"
	@echo "📡 Collector: http://localhost:8080"
	@echo "📊 Kafka UI:  optional, run 'make kafka-ui'"
	@$(MAKE) --no-print-directory wait-console
	@$(MAKE) --no-print-directory open-console

# Start with Warpstream
run-warpstream:
	@echo "Starting OpenSnowcat with Warpstream..."
	docker compose -f docker-warpstream.yml up -d
	@echo ""
	@echo "⏳ Waiting for Warpstream to start..."
	@sleep 10
	@echo ""
	@echo "✅ Environment started!"
	@echo "🖥️  Console:   $(CONSOLE_URL)"
	@echo "📡 Collector: http://localhost:8080"
	@echo "📊 Kafka UI:  optional, run 'make kafka-ui'"
	@echo ""
	@CONSOLE_URL_WS=$$(docker logs warp 2>&1 | grep "console.warpstream.com" | grep -o 'https:/[^[:space:]]*' | sed 's|https:/console|https://console|' | head -1); \
	if [ -n "$$CONSOLE_URL_WS" ]; then \
		echo "🌐 Warpstream Console: $$CONSOLE_URL_WS"; \
		open "$$CONSOLE_URL_WS" 2>/dev/null || xdg-open "$$CONSOLE_URL_WS" 2>/dev/null || echo "$$CONSOLE_URL_WS"; \
	else \
		echo "Warpstream console URL not found yet, run: make warpstream-console"; \
	fi
	@$(MAKE) --no-print-directory wait-console
	@$(MAKE) --no-print-directory open-console

# Poll the console health endpoint so the browser does not open on a blank page
wait-console:
	@printf "⏳ Waiting for the console"; \
	for i in $$(seq 1 90); do \
		if curl -fsS -o /dev/null $(CONSOLE_URL)/health 2>/dev/null; then echo " ready"; exit 0; fi; \
		printf "."; sleep 1; \
	done; \
	echo " not ready yet, open $(CONSOLE_URL) in a moment"

# Open the console in the default browser
open-console:
	@open $(CONSOLE_URL) 2>/dev/null || xdg-open $(CONSOLE_URL) 2>/dev/null || echo "Open $(CONSOLE_URL) in your browser"

console: open-console

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

# Start the optional Kafka UI (topic-level tooling) and open it
kafka-ui:
	@docker compose --profile kafka-ui up -d kafka-ui 2>/dev/null || docker compose -f docker-warpstream.yml --profile kafka-ui up -d kafka-ui
	@open http://localhost:8081 2>/dev/null || xdg-open http://localhost:8081 2>/dev/null || echo "Open http://localhost:8081 in your browser"

# Rebuild the console image from source
build-console:
	docker compose build console

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
