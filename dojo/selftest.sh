#!/usr/bin/env bash
# Sensei self-test: reference fixes for every challenge. NEVER part of the golden snapshot
# (it contains the answers). The control Sprite pushes it, runs one challenge, then restores.
#   selftest.sh <id>   →  break, assert broken, apply reference fix, assert fixed
set -u
ID="$1"; C=/home/sprite/dojo/challenges.sh; SHOP=/srv/shop
say() { echo "[$ID] $*"; }

fix() {
  case "$ID" in
    port-squatter) kill $(ss -ltnp | grep ':3000 ' | grep -o 'pid=[0-9]*' | cut -d= -f2); sleep 1; sprite-env services restart shop >/dev/null 2>&1 ;;
    bad-config)    sed -i 's/PORT=30O0/PORT=3000/' $SHOP/.env; sprite-env services restart shop >/dev/null 2>&1 ;;
    dead-symlink)  rm $SHOP/data/orders.log; mv $SHOP/data/orders.log.1 $SHOP/data/orders.log ;;
    cpu-hog)       pkill -f '^bash /var/tmp/kworker-sync' ;;
    dns-hijack)    sudo sed -i 's/^10\.255\.255\.1 inventory\.local$/127.0.0.1 inventory.local/' /etc/hosts ;;
    disk-full)     pkill -f trace-collector; sleep 1; rm -f $SHOP/data/.trace-buffer ;;
    cron-killer)   crontab -l | grep -v pkill | crontab -; sprite-env services restart shop >/dev/null 2>&1 ;;
    leaky-logs)    sed -i 's/^DEBUG=1$/DEBUG=0/' $SHOP/.env
                   sed -i "s/^STRIPE_KEY=.*/STRIPE_KEY=sk_test_$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')/" $SHOP/.env
                   : > $SHOP/public/app.log; sprite-env services restart shop >/dev/null 2>&1 ;;
  esac
}

$C break "$ID" >/dev/null
sleep 4
if $C check "$ID"; then say "FAIL: still healthy after break"; exit 1; fi
say "broken as intended"
# Partial fixes that must NOT count (the lesson of each challenge):
case "$ID" in
  disk-full)   rm -f $SHOP/data/.trace-buffer; sleep 2
               if $C check "$ID"; then say "FAIL: deleting the file alone counted as a fix"; exit 1; fi
               say "deleting the file alone does not count (writer still holds it open)" ;;
  leaky-logs)  : > $SHOP/public/app.log; sed -i 's/^DEBUG=1$/DEBUG=0/' $SHOP/.env; sprite-env services restart shop >/dev/null 2>&1; sleep 2
               if $C check "$ID"; then say "FAIL: hiding the leak without rotating the key counted as a fix"; exit 1; fi
               say "hiding the leak without rotating the key does not count" ;;
esac
fix
for i in $(seq 1 15); do $C check "$ID" && { say "PASS: fixed and detected"; exit 0; }; sleep 2; done
say "FAIL: reference fix not detected"; exit 1
