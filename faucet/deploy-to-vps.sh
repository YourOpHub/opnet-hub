#!/bin/bash
# Deploy faucet to VPS
# Usage: OPNET_MNEMONIC="12 words..." bash faucet/deploy-to-vps.sh

VPS_HOST="188.137.250.160"
VPS_USER="root"
VPS_KEY="../vps_key"
REMOTE_DIR="/opt/opnet-faucet"

if [ -z "$OPNET_MNEMONIC" ]; then
  echo "❌ Set OPNET_MNEMONIC env var"
  exit 1
fi

echo "📦 Deploying faucet to $VPS_HOST..."

# Set key permissions
chmod 600 "$VPS_KEY"

# Create remote directory
ssh -i "$VPS_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" "mkdir -p $REMOTE_DIR"

# Copy files
scp -i "$VPS_KEY" -o StrictHostKeyChecking=no \
  server.mjs package.json \
  "$VPS_USER@$VPS_HOST:$REMOTE_DIR/"

# Install deps and start with systemd
ssh -i "$VPS_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" << ENDSSH
  cd $REMOTE_DIR

  # Install Node.js if not present
  if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi

  # Install dependencies
  npm install --production

  # Create .env
  cat > .env << EOF
OPNET_MNEMONIC=$OPNET_MNEMONIC
PORT=3456
MINE_ADDRESS=${MINE_ADDRESS:-}
VIBE_ADDRESS=${VIBE_ADDRESS:-}
EOF

  # Create systemd service
  cat > /etc/systemd/system/opnet-faucet.service << EOF
[Unit]
Description=OPNet Testnet Token Faucet
After=network.target

[Service]
Type=simple
WorkingDirectory=$REMOTE_DIR
EnvironmentFile=$REMOTE_DIR/.env
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable opnet-faucet
  systemctl restart opnet-faucet
  sleep 2
  systemctl status opnet-faucet --no-pager

  echo ""
  echo "✅ Faucet deployed! Test: curl http://$VPS_HOST:3456/health"
ENDSSH
