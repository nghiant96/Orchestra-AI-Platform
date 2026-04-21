.PHONY: ai-up ai-down ai-logs

AI_SYSTEM_SERVER_TOKEN ?= change-me

ai-up:
	AI_SYSTEM_SERVER_MODE=true AI_SYSTEM_SERVER_TOKEN=$(AI_SYSTEM_SERVER_TOKEN) docker compose up -d ai-coding-system

ai-down:
	docker compose down

ai-logs:
	docker compose logs -f ai-coding-system
