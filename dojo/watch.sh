#!/usr/bin/env bash
# Sensei watcher: runs ON the training machine as a service while a challenge is active.
# Every 3s it runs the challenge's check and writes the result where the control app can read it.
# A snapshot restore wipes this service and its files, so each challenge starts clean.
set -u
ID="$1"
OUT=/tmp/sensei/status.json
mkdir -p /tmp/sensei
while :; do
  if /home/sprite/dojo/challenges.sh check "$ID" >/dev/null 2>&1; then fixed=true; else fixed=false; fi
  printf '{"challenge":"%s","fixed":%s,"t":%s}\n' "$ID" "$fixed" "$(date +%s)" > $OUT.tmp && mv $OUT.tmp $OUT
  sleep 3
done
