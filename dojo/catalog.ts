// Sensei challenge catalogue. Breakages and checks live in challenges.sh (deterministic);
// this file holds what the learner sees, the hint ladder, and the hidden facts the coach may use.
// Hint ladder (from playtesting: the hard part is knowing WHICH TOOL to reach for):
//   1 = the concept, 2 = the tool and what it shows, 3 = the shape of the command.

export type Area = "Ports & networking" | "Configuration" | "Files & storage" | "Processes" | "Scheduling" | "Security";

export const AREAS: { name: Area; blurb: string }[] = [
  { name: "Ports & networking", blurb: "Who is listening where, and why can't the app reach it?" },
  { name: "Configuration", blurb: "Reading crash logs and spotting the one wrong character." },
  { name: "Files & storage", blurb: "Links, permissions in practice, and disks that fill up." },
  { name: "Processes", blurb: "Finding what's eating the machine, even under a fake name." },
  { name: "Scheduling", blurb: "Jobs that run behind your back and undo your fixes." },
  { name: "Security", blurb: "Secrets that end up where they shouldn't." },
];

export interface Challenge {
  id: string;
  area: Area;
  title: string;
  symptom: string;          // what the learner is told
  level: 1 | 2 | 3;         // 1 easy, 2 medium, 3 hard
  skills: string[];         // shown as "toolbox" after solving
  ladder: [string, string, string];
  secret: string;           // what actually happened; given to the coach, never shown before solving
  lesson: string;           // shown after solving
}

export const CATALOG: Challenge[] = [
  {
    id: "port-squatter",
    area: "Ports & networking",
    title: "The site is down",
    symptom: "Customers see nothing. The shop should answer at http://localhost:3000/health.",
    level: 1,
    skills: ["curl -i", "ss -ltnp", "kill", "sprite-env services restart"],
    ladder: [
      "Something IS answering on port 3000 — just not the shop. Who owns that port?",
      "`ss` lists listening sockets; with the right flags it also shows the process behind each one.",
      "Try `ss -ltnp | grep 3000`, stop that process, then restart the shop: `sprite-env services restart shop`.",
    ],
    secret: "A rogue `python3 -m http.server 3000` grabbed port 3000 before the shop started, so the shop crashes with EADDRINUSE. Fix: kill the python process, restart the shop service.",
    lesson: "When a port is taken, find the owner before you restart anything: `ss -ltnp` (or `lsof -i :PORT`) names the process.",
  },
  {
    id: "bad-config",
    area: "Configuration",
    title: "The deploy broke the shop",
    symptom: "A config change just went out and now the shop won't start at all.",
    level: 1,
    skills: ["sprite-env services get", "service logs", "cat", "sed"],
    ladder: [
      "The shop is crashing on start. Its own error message says why.",
      "Service logs live in /.sprite/logs/services/ — read the shop's log, or check `sprite-env services get shop`.",
      "Look at the PORT line in /srv/shop/.env very carefully, character by character. Fix it, then restart the shop.",
    ],
    secret: "PORT in /srv/shop/.env was changed from 3000 to 30O0 (letter O instead of zero). The shop exits with 'invalid PORT'. Fix: correct the value, restart the shop.",
    lesson: "Read the crash log before touching code. Typos in config are the most common 'it worked yesterday' bug.",
  },
  {
    id: "dead-symlink",
    area: "Files & storage",
    title: "Every order fails",
    symptom: "The site is up, but every order returns an error. Test with: curl -X POST localhost:3000/order",
    level: 2,
    skills: ["service logs", "ls -l", "readlink", "rm", "mv"],
    ladder: [
      "The shop is up but can't save orders. Where does it write them, and what is really there?",
      "`ls -l` shows whether a file is a regular file or a link — and where a link points.",
      "Check `ls -l /srv/shop/data/`. A link pointing at a missing disk can't be written. Replace it with a real file (there's an old copy next to it).",
    ],
    secret: "/srv/shop/data/orders.log was replaced by a symlink to /mnt/old-volume/orders.log, which doesn't exist (the real file was moved to orders.log.1). Fix: remove the symlink, move orders.log.1 back (or create a new file).",
    lesson: "'No such file' on a file you can see usually means a dangling symlink. `ls -l` and `readlink -f` show the truth.",
  },
  {
    id: "cpu-hog",
    area: "Processes",
    title: "The machine is crawling",
    symptom: "Something is eating every CPU core on this machine. Find it and stop it — without breaking the shop.",
    level: 2,
    skills: ["top / htop", "ps aux --sort=-%cpu", "pkill", "uptime"],
    ladder: [
      "Look at what the CPUs are busy with. Names can be misleading.",
      "`top` (press P to sort by CPU) or `ps aux --sort=-%cpu | head` show the busiest processes.",
      "Find the processes started from /var/tmp (not a real kernel thread), and kill the parent script too or it will respawn its workers.",
    ],
    secret: "/var/tmp/kworker-sync (a fake kernel-thread name) spawns one busy loop per core. Fix: kill /var/tmp/kworker-sync and its children (e.g. pkill -f /var/tmp/kworker-sync).",
    lesson: "Attackers and bugs hide behind innocent names. Check the full command path (`ps -ef`, `/proc/PID/exe`), not just the name.",
  },
  {
    id: "dns-hijack",
    area: "Ports & networking",
    title: "The shop can't reach its inventory",
    symptom: "Health checks fail with \"inventory unreachable\", but the inventory service itself is running fine.",
    level: 2,
    skills: ["curl -v", "getent hosts", "cat /etc/hosts", "ss -ltn"],
    ladder: [
      "The service is up, but the shop can't find it. How does the shop look up where the inventory lives?",
      "`getent hosts <name>` shows what a name resolves to on this machine, including entries from a local override file.",
      "Compare `getent hosts inventory.local` with where inventory actually listens (`ss -ltn`), then correct the entry in /etc/hosts.",
    ],
    secret: "The /etc/hosts entry for inventory.local was changed from 127.0.0.1 to 10.255.255.1, an address nothing answers on, so every request times out. Fix: point inventory.local back at 127.0.0.1 in /etc/hosts.",
    lesson: "When a service is up but unreachable, check name resolution first. /etc/hosts overrides DNS, and `getent hosts` shows what the system really sees.",
  },
  {
    id: "disk-full",
    area: "Files & storage",
    title: "The disk is full",
    symptom: "Every order fails, and the data disk is 100% full. Deleting files doesn't seem to free any space.",
    level: 2,
    skills: ["df -h", "du -sh", "lsof +L1", "pkill"],
    ladder: [
      "Something keeps writing to the disk. Freeing space only works once nothing is holding the file open.",
      "`df` shows how full the disk is and `du` shows where the space went. `lsof` lists which process has a file open, even a deleted one.",
      "Find the writer with `lsof /srv/shop/data` (or `lsof +L1` for deleted-but-open files), stop it, then remove what it wrote.",
    ],
    secret: "/srv/shop/data is a small 8 MB volume, and /usr/local/bin/trace-collector keeps appending to /srv/shop/data/.trace-buffer while holding it open. Deleting the file alone frees nothing. Fix: kill trace-collector, then delete .trace-buffer.",
    lesson: "Disk space is only freed when the last process closes the file. If `df` says full and `du` disagrees, look for deleted-but-open files with `lsof +L1`.",
  },
  {
    id: "cron-killer",
    area: "Scheduling",
    title: "It keeps dying",
    symptom: "The shop goes down about once a minute. Restarting it works, but only for a minute.",
    level: 3,
    skills: ["sprite-env services get", "crontab -l", "crontab -e", "grep"],
    ladder: [
      "Something is stopping the shop on a schedule. Look for what runs regularly on this machine.",
      "Scheduled jobs live in crontabs: `crontab -l` lists the current user's jobs.",
      "Run `crontab -l` and look for a job that kills the shop. Remove that line with `crontab -e`, then restart the shop.",
    ],
    secret: "A crontab entry disguised as \"nightly cleanup\" runs `pkill -f \"node /srv/shop/server.js\"` every minute. Fix: remove that line from the crontab (crontab -e), then restart the shop.",
    lesson: "If a fix only lasts a few minutes, something is undoing it. Check scheduled jobs (`crontab -l`, /etc/cron.*) before you restart anything again.",
  },
  {
    id: "leaky-logs",
    area: "Security",
    title: "Secrets are leaking",
    symptom: "The shop's payment API key is showing up at http://localhost:3000/public/app.log. Stop the leak and make the leaked key useless.",
    level: 3,
    skills: ["curl", "grep", ".env", "key rotation", "sprite-env services restart"],
    ladder: [
      "Hiding the log is not enough. Anyone who saw it still has the key.",
      "Two jobs: find what makes the shop write its config to the public log, and replace the key itself (rotate it), not just the log.",
      "In /srv/shop/.env, turn debug mode off and set a new STRIPE_KEY value, clear /srv/shop/public/app.log, then restart the shop.",
    ],
    secret: "DEBUG=1 in /srv/shop/.env makes the shop dump its whole config, including STRIPE_KEY, into public/app.log at startup. Fix: set DEBUG=0, replace STRIPE_KEY with a new value, empty the public log, restart the shop.",
    lesson: "Once a secret has leaked, it's compromised. Stop the leak, clean up, and rotate the secret. Deleting the log alone protects nothing.",
  },
];

export const byId = (id: string) => CATALOG.find((c) => c.id === id);

// Being built and tested; shown on the landing page as "coming soon". Moved into CATALOG once verified.
export const PLANNED: { id: string; area: Area; title: string; level: 1 | 2 | 3; teaser: string }[] = [];
