#!/usr/bin/env bash
# Break/Fix Dojo challenge engine.
#   challenges.sh setup            install the healthy shop (run once, before the golden checkpoint)
#   challenges.sh break <id>       sabotage the machine
#   challenges.sh check <id>       exit 0 when the learner has fixed it
#   challenges.sh list
# Breakages are scripted (deterministic). The AI only picks, hints and grades.
# Background saboteurs use setsid so they survive the one-shot service that planted them.
set -u
SHOP=/srv/shop
health() { [ "$(curl -s -m 3 localhost:3000/health 2>/dev/null)" = ok ]; }
order()  { [ "$(curl -s -m 3 -X POST localhost:3000/order 2>/dev/null)" = saved ]; }

case "${1:-}" in
  setup)
    sudo mkdir -p $SHOP/data && sudo cp "$(dirname "$0")/shop/server.js" $SHOP/
    echo "PORT=3000" | sudo tee $SHOP/.env >/dev/null
    sudo chown -R sprite:sprite $SHOP
    sprite-env services create shop --cmd node --args $SHOP/server.js --dir $SHOP --no-stream >/dev/null 2>&1 || true
    sleep 2; health && echo "shop healthy" ;;

  list)
    cat <<'EOF'
port-squatter | The site is down. Customers see nothing.            | easy
bad-config    | Deploy went out, shop won't start.                  | easy
dead-symlink  | Site is up but every order fails with an error.     | medium
cpu-hog       | Shop is crawling. Something is eating the machine.  | medium
EOF
    ;;

  break)
    case "${2:-}" in
      port-squatter)  # a rogue process grabs port 3000 before the shop can
        sprite-env services stop shop >/dev/null 2>&1
        setsid nohup python3 -m http.server 3000 --directory /tmp >/dev/null 2>&1 < /dev/null &
        sleep 1; sprite-env services start shop >/dev/null 2>&1 ;;
      bad-config)     # typo: letter O instead of zero
        sed -i 's/PORT=3000/PORT=30O0/' $SHOP/.env
        sprite-env services restart shop >/dev/null 2>&1 ;;
      dead-symlink)   # "log rotation" left orders.log pointing at a volume that no longer exists
        mv $SHOP/data/orders.log $SHOP/data/orders.log.1 2>/dev/null; ln -s /mnt/old-volume/orders.log $SHOP/data/orders.log ;;
      cpu-hog)        # a process with an innocent name burns every core
        cat > /tmp/kworker-sync <<'EOF'
#!/usr/bin/env bash
for i in $(seq $(nproc)); do (while :; do :; done) & done; wait
EOF
        chmod +x /tmp/kworker-sync; setsid nohup /tmp/kworker-sync >/dev/null 2>&1 < /dev/null & ;;
      *) echo "unknown challenge"; exit 2 ;;
    esac
    echo "broken: $2" ;;

  check)
    case "${2:-}" in
      port-squatter|bad-config) health ;;
      dead-symlink) health && order ;;
      cpu-hog) ! pgrep -f '^bash /tmp/kworker-sync' >/dev/null && health ;;
      *) exit 2 ;;
    esac ;;

  *) echo "usage: $0 setup|list|break <id>|check <id>"; exit 2 ;;
esac
