#!/usr/bin/env python3
"""Commit a local directory to GitHub through the Sprites connector gateway.
No git credentials ever live on the Sprite: the gateway injects them.

Usage: ghpush.py <owner/repo> <local_dir> "<commit message>" [branch]
Uploads every file under local_dir (skipping .git, node_modules, __pycache__) as one commit.
"""
import base64, json, os, sys, urllib.request, urllib.error

GATEWAY = "https://api.sprites.dev/v1/gateway"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def connection_id(provider: str) -> str:
    with urllib.request.urlopen(f"{GATEWAY}/list", timeout=20) as r:
        for c in json.load(r).get("connections", []):
            if c["provider"] == provider:
                return c["id"]
    sys.exit(f"no {provider} connector available to this Sprite")


BASE = f"{GATEWAY}/github/{connection_id('github')}"


def api(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"content-type": "application/json", "accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path} -> {e.code}: {e.read().decode()[:300]}")


def main():
    repo, root, message = sys.argv[1], sys.argv[2], sys.argv[3]
    branch = sys.argv[4] if len(sys.argv) > 4 else "main"
    head = api("GET", f"/repos/{repo}/git/ref/heads/{branch}")["object"]["sha"]
    base_tree = api("GET", f"/repos/{repo}/git/commits/{head}")["tree"]["sha"]

    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, root)
            blob = api("POST", f"/repos/{repo}/git/blobs",
                       {"content": base64.b64encode(open(full, "rb").read()).decode(), "encoding": "base64"})
            mode = "100755" if os.access(full, os.X_OK) else "100644"
            entries.append({"path": rel, "mode": mode, "type": "blob", "sha": blob["sha"]})

    tree = api("POST", f"/repos/{repo}/git/trees", {"base_tree": base_tree, "tree": entries})
    commit = api("POST", f"/repos/{repo}/git/commits", {"message": message, "tree": tree["sha"], "parents": [head]})
    api("PATCH", f"/repos/{repo}/git/refs/heads/{branch}", {"sha": commit["sha"]})
    print(f"pushed {len(entries)} files -> {repo}@{branch} {commit['sha'][:7]}")


if __name__ == "__main__":
    main()
