.PHONY: deploy

DEPLOY_DIR ?= C:/www/tul-en-foco
PORT ?= 3101

deploy:
	powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Destination "$(DEPLOY_DIR)" -Port $(PORT)
