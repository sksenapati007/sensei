#!/usr/bin/env bash
# Run every Sensei challenge's self-test on a fresh restore of the golden snapshot.
# Usage (on the control Sprite): tools/selftest-all.sh <dojo-sprite> <golden-id> [challenge ...]
set -u
cd "$(dirname "$0")/.."
DOJO="$1"; GOLDEN="$2"; shift 2
IDS="${*:-port-squatter bad-config dead-symlink cpu-hog dns-hijack disk-full cron-killer leaky-logs}"
pass=0; fail=0
for id in $IDS; do
  python3 tools/sx.py "$DOJO" --restore "$GOLDEN" >/dev/null && sleep 4
  python3 tools/sx.py "$DOJO" --put dojo/selftest.sh /var/tmp/selftest.sh >/dev/null
  out=$(SX_KEEP=1 python3 tools/sx.py "$DOJO" "bash /var/tmp/selftest.sh $id" 150); code=$?
  echo "$out"
  [ $code -eq 0 ] && pass=$((pass+1)) || fail=$((fail+1))
done
python3 tools/sx.py "$DOJO" --restore "$GOLDEN" >/dev/null
echo "== $pass passed, $fail failed =="
