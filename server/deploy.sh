#!/bin/bash
# OPNet Hub Server — VPS Deploy Script
# Run on VPS: bash deploy.sh
set -e

echo "═══ OPNet Hub Server Setup ═══"

# 1. Install Node.js 20 if not present
if ! command -v node &> /dev/null; then
    echo "[1/6] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/6] Node.js $(node -v) already installed"
fi

# 2. Create app directory
echo "[2/6] Setting up app directory..."
mkdir -p /opt/opnet-hub
cp -r ./* /opt/opnet-hub/
cd /opt/opnet-hub

# 3. Install dependencies
echo "[3/6] Installing dependencies..."
npm install --production

# 4. Create .env from example if not exists
if [ ! -f .env ]; then
    echo "[4/6] Creating .env from example..."
    cp .env.example .env
    echo "  ⚠️  Edit /opt/opnet-hub/.env with your settings!"
else
    echo "[4/6] .env already exists, skipping"
fi

# 5. Setup nginx
echo "[5/6] Configuring nginx..."
cp nginx.conf /etc/nginx/sites-available/opnet-hub
ln -sf /etc/nginx/sites-available/opnet-hub /etc/nginx/sites-enabled/opnet-hub
# Remove default if exists
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "  ✓ Nginx configured"

# 6. Setup systemd service
echo "[6/6] Creating systemd service..."
cat > /etc/systemd/system/opnet-hub.service << 'EOF'
[Unit]
Description=OPNet Hub Backend Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/opnet-hub
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable opnet-hub
systemctl restart opnet-hub

echo ""
echo "═══ Deploy Complete ═══"
echo "  API:    http://188.137.250.160/api/"
echo "  Health: http://188.137.250.160/health"
echo "  Bob:    http://188.137.250.160/api/bob"
echo ""
echo "  Check status: systemctl status opnet-hub"
echo "  View logs:    journalctl -u opnet-hub -f"
echo ""
echo "  Next steps:"
echo "  1. Edit /opt/opnet-hub/.env"
echo "  2. systemctl restart opnet-hub"
echo "  3. (Optional) Setup SSL with: certbot --nginx -d yourdomain.com"
