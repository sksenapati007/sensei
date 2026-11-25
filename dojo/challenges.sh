#!/usr/bin/env bash
# Sensei challenge engine.
#   challenges.sh setup            install the healthy shop (run once, before the golden checkpoint)
#   challenges.sh break <id>       sabotage the machine
#   challenges.sh check <id>       exit 0 when the learner has fixed it
#   challenges.sh list
# Breakages are scripted (deterministic). The AI only picks, hints and grades.
# Background saboteurs use setsid; the caller also keeps their parent service alive, because
# deleting a Sprite service kills every process it started.
# Runtime files go in /var/tmp: /tmp is a separate volume that snapshots don't cover.
set -u
SHOP=/srv/shop
health() { [ "$(curl -s -m 4 localhost:3000/health 2>/dev/null)" = ok ]; }
order()  { [ "$(curl -s -m 3 -X POST localhost:3000/order 2>/dev/null)" = saved ]; }
key()    { grep '^STRIPE_KEY=' $SHOP/.env | cut -d= -f2-; }

case "${1:-}" in
  setup)
    sudo apt-get install -y -qq cron lsof >/dev/null 2>&1
    sudo mkdir -p $SHOP/data $SHOP/public
    sudo cp "$(dirname "$0")/shop/server.js" "$(dirname "$0")/shop/inventory.js" $SHOP/
    printf 'PORT=3000\nINVENTORY_URL=http://inventory.local:4000/stock\nSTRIPE_KEY=sk_test_%s\nDEBUG=0\n' "$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')" | sudo tee $SHOP/.env >/dev/null
    sudo touch $SHOP/data/orders.log $SHOP/public/app.log
    sudo chown -R sprite:sprite $SHOP
    grep -q 'inventory.local' /etc/hosts || echo '127.0.0.1 inventory.local' | sudo tee -a /etc/hosts >/dev/null
    for s in shop inventory cron; do sprite-env services delete $s >/dev/null 2>&1 || true; done
    sprite-env services create inventory --cmd node --args $SHOP/inventory.js --dir $SHOP --no-stream >/dev/null 2>&1
    sprite-env services create shop --cmd node --args $SHOP/server.js --dir $SHOP --needs inventory --no-stream >/dev/null 2>&1
    sprite-env services create cron --cmd sudo --args cron,-f --no-stream >/dev/null 2>&1
    sleep 3; health && order && echo "shop healthy" ;;

  list)
    cat <<'EOF'
port-squatter | The site is down. Customers see nothing.              | easy
bad-config    | Deploy went out, shop won't start.                    | easy
dead-symlink  | Site is up but every order fails with an error.       | medium
cpu-hog       | Shop is crawling. Something is eating the machine.    | medium
dns-hijack    | The shop can't reach its inventory service.           | medium
disk-full     | Orders fail: the disk is full, and stays full.        | medium
cron-killer   | The shop keeps dying, about once a minute.            | hard
leaky-logs    | The API key is in a public log. Stop it and recover.  | hard
EOF
    ;;

  break)
    case "${2:-}" in
      port-squatter)  # a rogue process grabs port 3000 before the shop can
        sprite-env services stop shop >/dev/null 2>&1
        setsid nohup python3 -m http.server 3000 --directory /usr/share/doc >/dev/null 2>&1 < /dev/null &
        sleep 1; sprite-env services start shop >/dev/null 2>&1 ;;
      bad-config)     # typo: letter O instead of zero
        sed -i 's/PORT=3000/PORT=30O0/' $SHOP/.env
        sprite-env services restart shop >/dev/null 2>&1 ;;
      dead-symlink)   # "log rotation" left orders.log pointing at a volume that no longer exists
        mv $SHOP/data/orders.log $SHOP/data/orders.log.1 2>/dev/null; ln -s /mnt/old-volume/orders.log $SHOP/data/orders.log ;;
      cpu-hog)        # a process with an innocent name burns every core
        cat > /var/tmp/kworker-sync <<'EOF'
#!/usr/bin/env bash
for i in $(seq $(nproc)); do (while :; do :; done) & done; wait
EOF
        chmod +x /var/tmp/kworker-sync; setsid nohup /var/tmp/kworker-sync >/dev/null 2>&1 < /dev/null & ;;
      dns-hijack)     # the name the shop uses for its inventory service now points at a dead address
        sudo sed -i 's/^127\.0\.0\.1 inventory\.local$/10.255.255.1 inventory.local/' /etc/hosts ;;
      disk-full)      # a tiny volume for orders, and a "trace collector" that fills it and keeps the file open
        cp $SHOP/data/orders.log /var/tmp/.orders.bak 2>/dev/null
        sudo mount -t tmpfs -o size=8m,uid=$(id -u),gid=$(id -g) tmpfs $SHOP/data
        cp /var/tmp/.orders.bak $SHOP/data/orders.log 2>/dev/null; rm -f /var/tmp/.orders.bak
        sudo tee /usr/local/bin/trace-collector >/dev/null <<'EOF'
#!/usr/bin/env bash
# "collects debug traces" — in practice: writes until the disk is full, and never closes the file
exec 3>>/srv/shop/data/.trace-buffer
while :; do head -c 262144 /dev/zero >&3 2>/dev/null || sleep 2; done
EOF
        sudo chmod +x /usr/local/bin/trace-collector
        setsid nohup /usr/local/bin/trace-collector >/dev/null 2>&1 < /dev/null &
        sleep 3 ;;
      cron-killer)    # a scheduled job that quietly kills the shop every minute
        ( crontab -l 2>/dev/null; echo '* * * * * pkill -f "node /srv/shop/server.js" >/dev/null 2>&1  # nightly cleanup' ) | crontab - ;;
      leaky-logs)     # debug mode dumps the API key into a publicly served log
        key > /var/tmp/.sensei-leaked-key
        sed -i 's/^DEBUG=0$/DEBUG=1/' $SHOP/.env
        sprite-env services restart shop >/dev/null 2>&1; sleep 2 ;;
      *) echo "unknown challenge"; exit 2 ;;
    esac
    echo "broken: $2" ;;

  check)
    case "${2:-}" in
      port-squatter|bad-config|dns-hijack) health ;;
      dead-symlink) health && order ;;
      cpu-hog) ! pgrep -f '^bash /var/tmp/kworker-sync' >/dev/null && health ;;
      disk-full) ! pgrep -f 'trace-collector' >/dev/null && [ "$(df -Pk $SHOP/data | awk 'NR==2{print $4}')" -gt 2048 ] && order && health ;;
      cron-killer) ! crontab -l 2>/dev/null | grep -q 'pkill' && health ;;
      leaky-logs)
        leaked=$(cat /var/tmp/.sensei-leaked-key 2>/dev/null); now=$(key)
        published=$(curl -s -m 3 localhost:3000/public/app.log)
        [ -n "$leaked" ] && [ -n "$now" ] && [ "$now" != "$leaked" ] \
          && ! grep -qF "$leaked" <<<"$published" && ! grep -qF "$now" <<<"$published" && health ;;
      *) exit 2 ;;
    esac ;;

  *) echo "usage: $0 setup|list|break <id>|check <id>"; exit 2 ;;
esac
