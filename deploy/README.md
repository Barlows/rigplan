# Hosting this on a VM, and keeping it current

The app is a zero-dependency static site — no build, no bundler, no server-side
code. `nginx` serves the files and nothing else runs. Projects live in the
browser's `localStorage`, so **the VM holds no project data at all**; there is no
database, no upload endpoint and nothing to back up. If the disk dies you lose
the files, which are in git, and nothing else.

Two paths to "every push is live". Both are below. The first is the one to use.

---

## 1. Pull on a timer — recommended

Nothing has to reach the VM from outside, no SSH key is exposed, and it works on
a VM that is not reachable from the internet. That is the normal shape of a home
Proxmox box, so this is the one.

### On the VM

```bash
# a dedicated unprivileged user
sudo adduser --system --group --home /var/www/electrical-load-schedule deploy

sudo -u deploy git clone https://github.com/Barlows/electrical-load-schedule.git \
     /var/www/electrical-load-schedule/repo
```

Copy the four files from this folder onto the VM:

```bash
sudo cp repo/deploy/update.sh            /var/www/electrical-load-schedule/
sudo cp repo/deploy/elschedule-update.service /etc/systemd/system/
sudo cp repo/deploy/elschedule-update.timer   /etc/systemd/system/
sudo cp repo/deploy/nginx.conf           /etc/nginx/sites-available/elschedule

sudo mkdir -p /var/www/electrical-load-schedule/releases
sudo ln -s /etc/nginx/sites-available/elschedule /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# run it once by hand and read the output before trusting it with a timer
sudo -u deploy /var/www/electrical-load-schedule/update.sh --test

sudo systemctl enable --now elschedule-update.timer
systemctl list-timers elschedule-update.timer
```

`update.sh` on its own does not move anything if the current version is already
deployed, so it is safe to run from cron, from a timer, or by hand.

### Verifying it actually works

Push a trivial commit and watch it land:

```bash
systemctl start elschedule-update.service
journalctl -u elschedule-update.service -n 20 --no-pager
cat /var/www/electrical-load-schedule/current/.deployed-rev
git rev-parse origin/main
```

The two revisions must match. Then **hard-reload the browser** (Ctrl-Shift-R) and
check the `?v=` on a script tag has moved. If the revision matches but the
browser is still running the old code, the cache headers are wrong — see below.

### Rolling back

Every deploy keeps the last three:

```bash
ls -1t /var/www/electrical-load-schedule/releases
sudo ln -sfn /var/www/electrical-load-schedule/releases/<rev> \
           /var/www/electrical-load-schedule/current
```

---

## 2. Push-triggered, from GitHub

Use this only if the VM is reachable from the internet, or you have a tunnel to
it. It needs an SSH key in GitHub secrets, and it means opening SSH to a runner
you do not control.

Add to `.github/workflows/`:

- secret `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
- a `deploy` job on `push: branches: [main]` that ssh's in and runs `update.sh`

The `update.sh` script is identical either way, including its refusal to deploy
code that does not parse — so a push that breaks the build leaves the previous
version serving rather than taking the site down unattended.

---

## The part that silently breaks this

**`index.html` must not be cached.** Every script tag carries `?v=<number>`,
which `tools/bump.py` rewrites on every change. That scheme works by getting the
browser to request a *new URL* when the code changes. If nginx serves a cached
`index.html`, the browser keeps being handed the old `?v=` and quietly keeps
running the old code, while every deploy reports success.

`nginx.conf` sends `no-store` for the HTML and a one-year immutable cache for the
versioned assets — the two halves of the same scheme. If you write your own
config, keep both.

This is also why `update.sh` checks that `index.html` carries a `?v=` before
going live: if the two disagree the browser is sent a `?v=` that resolves to
nothing and the app fails open with a 404 on a script.

---

## Notes worth knowing

**Client data — this is the one thing to get right.** `tools/wxm-line5.json` is
COMMITTED. It is in the repository history, and history is not the present: the
only way to reverse it is a new repository, so treat access to this repo of yours
as access to the client data. This was a deliberate decision — a private
repository satisfies "one client's installation data must not be visible to
another" for as long as it stays private, and stops the day anyone else is given
access.

`launch.html` is the landing page and opens the WXM project by default. If this
container is ever reachable from outside your LAN, **put basic auth or a network
allow-list on it first**. `nginx.conf` serves exactly one file out of `/tools/`
— `wxm-line5.json` and nothing else — so a teammate's export at runtime is not
exposed. That protects the boundary; it does not protect against a public URL.

**HTTPS.** Do not add a certificate without deciding whether the site is
reachable outside your LAN. A load schedule is not a secret, but a public URL is
a public URL. `nginx.conf` listens on 80 only and says so; add TLS deliberately
rather than by reflex.

**The JS syntax gate skips if it cannot run.** `update.sh` parses every app
script with `node` or `osascript`, whichever exists, and if neither does it logs
a warning and carries on rather than guessing. Install `node` on the VM for a
real gate, or run `update.sh --test` from a machine that has a browser.

**Logs.** `journalctl -u elschedule-update.service` for the updater,
`/var/log/nginx/elschedule.access.log` for requests. Neither holds anything
worth protecting: there is no API and no stored state.