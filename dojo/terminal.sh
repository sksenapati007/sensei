#!/usr/bin/env bash
# (Re)create the browser terminal service on the training machine.
# Usage: terminal.sh <secret-path-segment>
# rendererType=dom: text is real DOM, so screen readers, selection and copy/paste work reliably.
set -eu
SECRET="$1"
sprite-env services delete terminal >/dev/null 2>&1 || true   # "create" does not replace an existing service
sprite-env services create terminal --cmd /usr/local/bin/ttyd \
  --args "-p,8080,-i,0.0.0.0,-b,/t/${SECRET},-W,-w,/srv/shop,-t,fontSize=15,-t,rendererType=dom,-t,titleFixed=Sensei dojo,bash,-l" \
  --http-port 8080 --no-stream
