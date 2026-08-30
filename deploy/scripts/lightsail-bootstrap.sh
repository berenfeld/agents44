#!/bin/bash
# Lightsail Ubuntu 24 base: Docker Engine (official apt) + AWS CLI v2.
# Fix for NO_PUBKEY / unsigned docker repo: install key via gpg --dearmor.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
  TARGET_USER="${SUDO_USER:-ubuntu}"
else
  SUDO="sudo"
  TARGET_USER="$(id -un)"
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Base packages"
$SUDO apt-get update
$SUDO apt-get install -y ca-certificates curl gnupg unzip jq

echo "==> Reset Docker apt source + key"
$SUDO rm -f /etc/apt/sources.list.d/docker.list
$SUDO rm -f /etc/apt/keyrings/docker.gpg /etc/apt/keyrings/docker.asc
$SUDO install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$SUDO chmod a+r /etc/apt/keyrings/docker.gpg

ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "$VERSION_CODENAME")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

echo "==> Install Docker Engine"
$SUDO apt-get update
$SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
$SUDO systemctl enable --now docker
$SUDO usermod -aG docker "$TARGET_USER"

echo "==> AWS CLI v2 (not apt awscli on Ubuntu 24)"
if ! command -v aws >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  $SUDO "$tmp/aws/install"
  rm -rf "$tmp"
fi

$SUDO mkdir -p /opt/agents44
$SUDO chmod 755 /opt/agents44

echo ""
echo "OK"
docker --version || $SUDO docker --version
aws --version
echo "Log out/in (or: newgrp docker) so group docker applies, then snapshot."
