#!/bin/bash
# Generate a self-signed TLS certificate for LAN HTTPS access.
# Run once on the Pi: bash generate_certs.sh
# Then trust the cert in your browser (open https://<pi-ip>:<port>, accept warning).

set -e
mkdir -p config/ssl

# Detect Pi's LAN IP for the SAN field
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$LAN_IP" ]; then LAN_IP="127.0.0.1"; fi

echo "Generating certificate for IP: $LAN_IP"

openssl req -x509 -newkey rsa:4096 \
  -keyout config/ssl/key.pem \
  -out   config/ssl/cert.pem \
  -days  3650 -nodes \
  -subj  "/CN=magicmirror.local" \
  -addext "subjectAltName=IP:${LAN_IP},IP:127.0.0.1,DNS:localhost"

echo ""
echo "Done. Certificates saved to config/ssl/"
echo ""
echo "To trust on iOS/Android: open https://$LAN_IP:<port> → Advanced → Proceed"
echo "To trust on Mac:         Security → Trust certificate"
echo "To trust on Windows:     Open cert.pem → Install → Trusted Root CAs"
