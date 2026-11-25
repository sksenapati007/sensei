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
      "Find the processes started from /tmp (not a real kernel thread), and kill the parent script too or it will respawn its workers.",
    ],
    secret: "/tmp/kworker-sync (a fake kernel-thread name) spawns one busy loop per core. Fix: kill /tmp/kworker-sync and its children (e.g. pkill -f /tmp/kworker-sync).",
    lesson: "Attackers and bugs hide behind innocent names. Check the full command path (`ps -ef`, `/proc/PID/exe`), not just the name.",
  },
];

export const byId = (id: string) => CATALOG.find((c) => c.id === id);

// Being built and tested; shown on the landing page as "coming soon". Moved into CATALOG once verified.
export const PLANNED: { id: string; area: Area; title: string; level: 1 | 2 | 3; teaser: string }[] = [
  { id: "dns-hijack", area: "Ports & networking", title: "The shop can't reach its database", level: 2, teaser: "A name resolves to the wrong place." },
  { id: "disk-full", area: "Files & storage", title: "The disk is full", level: 2, teaser: "Something keeps writing and never stops." },
  { id: "cron-killer", area: "Scheduling", title: "It keeps dying", level: 3, teaser: "Your restart works — for about a minute." },
  { id: "leaky-logs", area: "Security", title: "Secrets are leaking", level: 3, teaser: "Something sensitive is being printed in plain sight." },
];
