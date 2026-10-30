#!/usr/bin/env bash
# One-time setup for a fresh Amazon Linux 2023 EC2 instance. Run once as ec2-user:
#   bash ec2-setup.sh
set -euo pipefail

APP_NAME="teleconsultation"

if ! grep -q 'Amazon Linux' /etc/os-release || ! grep -q 'VERSION_ID="2023"' /etc/os-release; then
  echo "This script targets Amazon Linux 2023 (Node 22 does not support Amazon Linux 2)." >&2
  exit 1
fi

echo "==> Installing base tools"
sudo dnf install -y tar gzip

echo "==> Installing Node.js 22"
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs

echo "==> Installing PM2"
sudo npm install -g pm2

echo "==> Enabling PM2 on boot"
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

echo "==> Creating app directories"
mkdir -p "$HOME/$APP_NAME/releases" "$HOME/$APP_NAME/shared"

echo "Done. Node $(node -v), PM2 $(pm2 -v). The GitHub Actions pipeline can now deploy here."
