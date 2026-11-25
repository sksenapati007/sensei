#!/usr/bin/env python3
"""sx: run a shell command inside another Sprite via the Sprites REST API and print its output.

Usage: sx.py <sprite> '<bash command>' [timeout_seconds]
       sx.py <sprite> --put <local_file> <remote_path>
       sx.py <sprite> --checkpoint '<comment>'
       sx.py <sprite> --restore <checkpoint_id>
       sx.py --create <name> [public]
       sx.py --delete <name>

How a command runs: the script is written with fs/write, started as a one-shot Sprite service,
and its output is collected from a file. The service is deleted afterwards, so it never re-runs.
Token: ~/.config/hg/sprites-token (control Sprite only).
"""
import json, os, sys, time, uuid, urllib.request, urllib.parse, urllib.error

API = "https://api.sprites.dev/v1/sprites"
TOKEN = open(os.path.expanduser(os.environ.get("HG_SPRITES_TOKEN_FILE", "~/.config/hg/sprites-token"))).read().strip()


def req(method, path, body=None, raw=None, query=None, timeout=120):
    url = API + path + ("?" + urllib.parse.urlencode(query) if query else "")
    headers = {"authorization": f"Bearer {TOKEN}"}
    data = None
    if body is not None:
        data = json.dumps(body).encode(); headers["content-type"] = "application/json"
    elif raw is not None:
        data = raw; headers["content-type"] = "application/octet-stream"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def write(sprite, path, text, mode="0755"):
    s, b = req("PUT", f"/{sprite}/fs/write", raw=text.encode(), query={"path": path, "workingDir": "/", "mkdirParents": "true", "mode": mode})
    if s >= 300: sys.exit(f"write failed {s}: {b[:200]}")


def read(sprite, path):
    s, b = req("GET", f"/{sprite}/fs/read", query={"path": path, "workingDir": "/"})
    return b if s == 200 else None


def run(sprite, cmd, timeout=300):
    rid = uuid.uuid4().hex[:8]
    out, done = f"/var/tmp/sx-{rid}.out", f"/var/tmp/sx-{rid}.done"
    script = f"#!/usr/bin/env bash\n[ -f {done} ] && exec sleep infinity\n( {cmd} ) > {out} 2>&1; echo $? > {done}\nexec sleep infinity\n"
    write(sprite, f"/var/tmp/sx-{rid}.sh", script)
    s, b = req("PUT", f"/{sprite}/services/sx-{rid}", body={"cmd": "bash", "args": [f"/var/tmp/sx-{rid}.sh"]}, query={"duration": "1s"})
    if s >= 300: sys.exit(f"service create failed {s}: {b[:200]}")
    start = time.time(); code = None
    while time.time() - start < timeout:
        d = read(sprite, done)
        if d is not None and d.strip():
            code = int(d.strip()); break
        time.sleep(1.5)
    print(read(sprite, out) or "", end="")
    # SX_KEEP=1 leaves the (idle) service in place: deleting a service kills every process it started,
    # which would also kill saboteurs a breakage planted. A snapshot restore removes it later anyway.
    if os.environ.get("SX_KEEP") != "1":
        req("DELETE", f"/{sprite}/services/sx-{rid}")
    if code is None: sys.exit(f"[sx] timed out after {timeout}s")
    sys.exit(code)


def main():
    a = sys.argv[1:]
    if a[0] == "--create":
        s, b = req("POST", "", body={"name": a[1], "url_settings": {"auth": "public" if len(a) > 2 and a[2] == "public" else "sprite"}})
        print(s, b[:400]); return
    if a[0] == "--delete":
        s, b = req("DELETE", f"/{a[1]}"); print(s, b[:200]); return
    sprite = a[0]
    if a[1] == "--put":  # sx.py <sprite> --put <local_file> <remote_path>
        mode = "0755" if os.access(a[2], os.X_OK) else "0644"
        write(sprite, a[3], open(a[2]).read(), mode); print(f"put {a[2]} -> {sprite}:{a[3]}"); return
    if a[1] == "--checkpoint":
        s, b = req("POST", f"/{sprite}/checkpoint", body={"comment": a[2]}); print(s, b.strip().splitlines()[-1] if b.strip() else ""); return
    if a[1] == "--restore":
        t = time.time(); s, b = req("POST", f"/{sprite}/checkpoints/{a[2]}/restore")
        print(s, (b.strip().splitlines() or [""])[-1], f"({time.time() - t:.1f}s)"); return
    run(sprite, a[1], int(a[2]) if len(a) > 2 else 300)


if __name__ == "__main__":
    main()
