#!/bin/bash
set -e

APP_DIR="/opt/trouwfotos"
VENV_DIR="/opt/venvs/trouwfotos"

cd "$APP_DIR"
git pull origin main
"$VENV_DIR/bin/pip" install -q -r requirements.txt
systemctl restart trouwfotos
echo "Deployed at $(date)"
