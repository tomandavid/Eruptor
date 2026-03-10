.PHONY: install run build clean docker-build docker-up docker-down docker-logs docker-deploy

install:
	npm install

run:
	npm start

build:
	npm run build

clean:
	rm -rf node_modules build

# --- Docker (Coolify-compatible) ---

docker-build:
	docker compose build

docker-up:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-deploy: docker-build docker-up
