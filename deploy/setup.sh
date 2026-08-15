#!/bin/bash
set -e

REPO_URL="https://github.com/bitterbalbugs/trouwfotos.git"
APP_DIR="/opt/trouwfotos"
VENV_DIR="/opt/venvs/trouwfotos"
SERVICE_FILE="/etc/systemd/system/trouwfotos.service"
NGINX_CONF="/etc/nginx/sites-available/marathon"

echo "=== Trouwfotos -- one-time LXC setup ==="

# System packages
apt-get update -q
apt-get install -y -q python3 python3-pip python3-venv git nginx

# Clone repo
if [ -d "$APP_DIR" ]; then
    echo "Directory $APP_DIR already exists -- skipping clone"
else
    git clone "$REPO_URL" "$APP_DIR"
    echo "Cloned repo to $APP_DIR"
fi

# Python venv
mkdir -p /opt/venvs
if [ ! -d "$VENV_DIR" ]; then
    python3 -m venv "$VENV_DIR"
    echo "Created venv at $VENV_DIR"
fi

"$VENV_DIR/bin/pip" install -q -r "$APP_DIR/requirements.txt"
echo "Installed Python dependencies"

# Photo directories (content rsynced separately, not in git)
mkdir -p "$APP_DIR/import" "$APP_DIR/thumbnails"

# nginx: add /trouwfotos location to existing marathon server block
if [ -f "$NGINX_CONF" ]; then
    if grep -q "trouwfotos" "$NGINX_CONF"; then
        echo "nginx: /trouwfotos already configured"
    else
        python3 - "$NGINX_CONF" << 'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
block = """
    location = /trouwfotos {
        return 301 /trouwfotos/;
    }

    location /trouwfotos/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Prefix /trouwfotos;
    }
"""
content = content.rstrip().rstrip('}') + block + '}\n'
with open(path, 'w') as f:
    f.write(content)
print('nginx: added /trouwfotos location blocks')
PYEOF
    fi
else
    # No existing marathon config — create a standalone one
    cat > /etc/nginx/sites-available/trouwfotos << 'EOF'
server {
    listen 80;
    server_name _;

    location = /trouwfotos {
        return 301 /trouwfotos/;
    }

    location /trouwfotos/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Prefix /trouwfotos;
    }
}
EOF
    ln -sf /etc/nginx/sites-available/trouwfotos /etc/nginx/sites-enabled/trouwfotos
    echo "nginx: created standalone config"
fi

nginx -t
systemctl reload nginx
echo "nginx configured"

# systemd service
cp "$APP_DIR/deploy/trouwfotos.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable trouwfotos
systemctl start trouwfotos
echo "systemd service installed and started"

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "=== Setup complete ==="
echo "App running at: http://$IP/trouwfotos/"
echo ""
echo "Next: rsync photos to $APP_DIR/import/ then run:"
echo "  cd $APP_DIR && $VENV_DIR/bin/python ingest.py"
echo ""
echo "Useful commands:"
echo "  systemctl status trouwfotos"
echo "  journalctl -u trouwfotos -f"
