# Day 3 — Pushgateway, Grafana RBAC, Loki

[← Day 2](../day-2-service-discovery/README.md) · [All notes](../README.md)

- **Pushgateway:** captures metrics of **short-living** scripts / jobs / pods (≤ 15 s) — they **push**, Prometheus **pulls** (port 9091).
- **Grafana RBAC:** control **what each user can do** in Grafana (users, teams, folder permissions).
- **Loki:** collects **logs** from every server (via **Promtail**) and shows them in Grafana (port 3100).

## What is Pushgateway?

**Pushgateway** = captures the metrics of **short-living objects** (scripts, cron jobs, pods that
run only a few seconds). That is its **only purpose**.

**The problem:** Prometheus **pulls** metrics every **15 s** (our `scrape_interval`). If a script or
pod runs for **15 s or less**, it finishes **before** Prometheus comes → **metrics are lost**.

**The fix:** the short job **pushes** its metrics to Pushgateway before it exits. Pushgateway
**keeps** them, and Prometheus pulls them from there.

```
Without Pushgateway:
  0s  backup.sh starts ──── 10s ends ✗          15s Prometheus scrapes → nothing there

With Pushgateway:
  0s  backup.sh starts ──── 10s ends ──push──► Pushgateway :9091 (keeps it)
                                                     ▲
                                        15s Prometheus pulls ✓
```

| Field          | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| **Purpose**    | Capture metrics of **short-living** scripts / jobs / pods      |
| **Install**    | With **Docker** (`prom/pushgateway`)                           |
| **Port**       | **9091** → open it in the **Prometheus server's** SG           |
| **Model**      | Job **pushes** → Pushgateway keeps → Prometheus **pulls**       |
| **Not for**    | Servers / apps that run all the time (use exporters)           |

> Prometheus's built-in default is **1 min**; we set **15 s** in `prometheus.yml`. Either way, a
> job shorter than the interval can be missed.

## What is Loki?

**Loki** = collects the **logs** from each server and stores them in one place.

**Why?** When users use the application, the server writes **logs** (requests, errors). We need
those logs from **every** server — Loki collects them, so we don't SSH into each VM to read files.

**Promtail** = the **agent** installed on **all VMs**. It reads the logs and **gives them to Loki**.

```
VM-1 logs ─► Promtail ─┐
VM-2 logs ─► Promtail ─┼─push─► Loki :3100 (stores logs) ◄─query─ Grafana :3000
VM-3 logs ─► Promtail ─┘                                        (logs + metrics, visually)
```

| Component    | Job                                               | Where             |
| ------------ | ------------------------------------------------- | ----------------- |
| **Promtail** | Agent — collects logs, sends to Loki              | **Every VM**      |
| **Loki**     | Stores the logs Promtail sends                    | My lab: worker (Amazon VM) |
| **Grafana**  | Shows logs **and** metrics visually in one place  | Monitoring server |

| Tool         | Stores      | Agent on servers | Query language |
| ------------ | ----------- | ---------------- | -------------- |
| Prometheus   | **Metrics** | Node Exporter    | PromQL         |
| Loki         | **Logs**    | Promtail         | LogQL          |

> **Order matters:** install **Loki first** — Promtail needs a Loki address to send logs to.

## Lab — Pushgateway

### Step 1 — Install Pushgateway (Docker)

On the **monitoring server**, as root:

```bash
apt update
apt install docker.io -y
docker run -d -p 9091:9091 prom/pushgateway # -d = background, -p = host:container port
docker ps -a                                # STATUS must be "Up"
```

Open port **9091** (Custom TCP, My IP) in the **Prometheus server's SG** (`monitoring-sg`) →
`http://<monitoring-public-ip>:9091` → Pushgateway UI.

### Step 2 — Configure Prometheus to Scrape Pushgateway

```bash
vim /etc/prometheus/prometheus.yml
```

Add this job under `scrape_configs:` (keep the `ec2-discovery` job):

```yaml
scrape_configs:
  - job_name: "pushgateway"
    honor_labels: true # keep the job label the pushed metrics came with
    static_configs:
      - targets: ["localhost:9091"] # Pushgateway on this same server
```

```bash
systemctl restart prometheus
```

**Check:** `:9090` → **Status → Targets** → `pushgateway` = **UP**.

### Step 3 — Create the Backup Script (this is the core)

We **intentionally** make a script that runs only **10 s** (less than the 15 s scrape) and pushes
its metric before it exits.

```bash
vim /tmp/backup.sh
```

```bash
#!/bin/bash

START=$(date +%s)

# simulate backup (10 sec)
sleep 10

END=$(date +%s)
DURATION=$((END - START))

echo "backup_duration_seconds $DURATION" | \
curl --data-binary @- http://localhost:9091/metrics/job/backup_job
```

| Line                                      | What it does                                     |
| ----------------------------------------- | ------------------------------------------------ |
| `date +%s`                                | Current time in seconds                          |
| `sleep 10`                                | "Backup" lives **10 s** → shorter than the scrape |
| `DURATION=$((END - START))`               | How long it ran → **10**                         |
| `curl --data-binary @- …/job/backup_job`  | **Push** the metric to Pushgateway               |

### Step 4 — Make It Executable and Run

```bash
chmod +x /tmp/backup.sh
sh /tmp/backup.sh
```

**Check:**

```bash
curl -s localhost:9091/metrics | grep backup
```

```
backup_duration_seconds{instance="",job="backup_job"} 10
```

| Where                                 | You see                                   |
| ------------------------------------- | ----------------------------------------- |
| Browser `http://<monitoring-public-ip>:9091` | Pushgateway UI → group `job="backup_job"` |
| Prometheus `:9090` → Graph            | Query `backup_duration_seconds` → **10**  |

> The script is **already finished**, but Prometheus still has its metric — Pushgateway kept it.

## Lab — Grafana RBAC (Role-Based Access Control)

**RBAC** = control the **permissions** of a user — who can **see**, **edit** or **manage** what.

| Role       | Can do                                 |
| ---------- | -------------------------------------- |
| **Viewer** | Only **see** dashboards (default)      |
| **Editor** | See + **edit / create** dashboards     |
| **Admin**  | Everything — users, data sources, settings |

### Steps

| #   | Do                    | Where in Grafana                                         |
| --- | --------------------- | -------------------------------------------------------- |
| 1   | Create users          | **Shield symbol** (Server admin) → **Users** → **New user** |
| 2   | Create a team         | **Settings** (gear) → **Teams** → **New team** → add users |
| 3   | Give the team access  | **Dashboards** → folder → **Permissions** → **Add a permission** → Team → View / Edit / Admin |

```
Users ──► Team (e.g. dev-team) ──► Folder permission (View) ──► team sees only that folder's dashboards
```

> Give permissions to **teams**, not single users — one change applies to everyone in the team.

## Lab — Loki + Promtail

In this lab **Loki and Promtail both run on the worker (Amazon VM)** — that's where the app logs are.
Grafana (on the monitoring server) reads the logs from Loki.

```
Worker (Amazon VM)                                        Monitoring server
┌──────────────────────────────────────────────┐          ┌────────────────┐
│ nginx → /var/log/nginx/access.log (app logs) │          │                │
│        │                                     │          │                │
│     Promtail ──push──► Loki :3100 ◄──────────┼─ query ──│ Grafana :3000  │
└──────────────────────────────────────────────┘          └────────────────┘
```

Commands from the **official Loki docs** ([Install Loki with Docker](https://grafana.com/docs/loki/v3.4.x/setup/install/docker/)).

### Step 1 — Install Docker (worker)

```bash
ssh -i <key.pem> ubuntu@<worker-public-ip>
sudo su -
apt update
apt install docker.io -y
```

### Step 2 — Download the Loki + Promtail Config Files

```bash
mkdir loki
cd loki
wget https://raw.githubusercontent.com/grafana/loki/v3.5.7/cmd/loki/loki-local-config.yaml -O loki-config.yaml
wget https://raw.githubusercontent.com/grafana/loki/v3.5.7/clients/cmd/promtail/promtail-docker-config.yaml -O promtail-config.yaml
```

### Step 3 — Add Our App Logs Path to the Promtail Config

The default config only reads `/var/log/*log` (system logs). Our **app logs** are in
`/var/log/nginx/access.log` → add them with the label **`job: applogs`**.

```bash
vim promtail-config.yaml
```

```yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml # remembers how far it read each file

clients:
  - url: http://loki:3100/loki/api/v1/push # where Loki is (container name "loki")

scrape_configs:
- job_name: system
  static_configs:
  - targets:
      - localhost
    labels:
      job: varlogs
      __path__: /var/log/*log # system logs (default)

- job_name: applogs # ← added
  static_configs:
  - targets:
      - localhost
    labels:
      job: applogs # label to search in Grafana
      __path__: /var/log/nginx/access.log # our app (Amazon page) logs
```

| Field       | Meaning                                         |
| ----------- | ----------------------------------------------- |
| `clients`   | **Where to send** the logs → Loki               |
| `job`       | **Label** → we pick it in Grafana to find logs  |
| `__path__`  | **Which log file** to read                      |

### Step 4 — Run Loki and Promtail

```bash
docker run --name loki -d -v $(pwd):/mnt/config -p 3100:3100 grafana/loki:3.5.7 -config.file=/mnt/config/loki-config.yaml
docker run --name promtail -d -v $(pwd):/mnt/config -v /var/log:/var/log --link loki grafana/promtail:3.5.7 -config.file=/mnt/config/promtail-config.yaml
docker ps   # loki + promtail → both "Up"
```

| Part                       | Meaning                                                   |
| -------------------------- | --------------------------------------------------------- |
| `-v $(pwd):/mnt/config`    | Give the config files in this folder to the container     |
| `-p 3100:3100`             | Loki listens on **3100**                                  |
| `-v /var/log:/var/log`     | Promtail can read the server's log files                  |
| `--link loki`              | Promtail reaches Loki by the name `loki`                  |

> Changed `promtail-config.yaml` after starting? → `docker restart promtail`.

**Check** (wait **~15 s** — Loki needs time to start):

```bash
curl -s localhost:3100/ready   # ready
```

### Step 5 — Open Port 3100

Worker SG → **Edit inbound rules → Add rule**:

| Type       | Port | Source                                  | Why                       |
| ---------- | ---- | --------------------------------------- | ------------------------- |
| Custom TCP | 3100 | Monitoring server's public IP /32 (lab) | Grafana reads logs from Loki |

### Step 6 — Add Loki as a Data Source in Grafana

**Connections → Data sources → Add data source → Loki**

- **URL:** `http://<worker-public-ip>:3100`
- **Save & test** → "Data source connected"

> **Lab:** the public IP **changes** every stop/start → update the URL in the Loki data source
> (and the SG source) each time.
> **Real time:** we use an **Elastic IP** — it never changes, so no need to update.

### Step 7 — See the Logs

1. Open `http://<worker-public-ip>` a few times → creates new lines in `access.log`.
2. Grafana → **Explore** (compass icon) → data source **Loki**.
3. **Label filters:** select **`job`** → **`applogs`** → **Run query** → the app logs show.

| Query                        | Shows                                 |
| ---------------------------- | ------------------------------------- |
| `{job="applogs"}`            | App (nginx access) logs               |
| `{job="varlogs"}`            | System logs                           |
| `{job="applogs"} \|= "404"`  | Only app log lines containing **404** |

> To keep it on a dashboard: **Dashboards → New → Add visualization → Loki** → `{job="applogs"}` →
> visualization **Logs** → Save.

## Promtail on Kubernetes — DaemonSet

**DaemonSet** = a Kubernetes object that runs **one copy of a pod on every node**. New node joins
→ a Promtail pod is created there **automatically**.

```
Kubernetes cluster
├── node-1 ── promtail pod ─┐
├── node-2 ── promtail pod ─┼──► Loki
└── node-3 ── promtail pod ─┘     (DaemonSet: 1 pod per node, automatic)
```

| Where          | How Promtail gets on every server            |
| -------------- | -------------------------------------------- |
| EC2 VMs (lab)  | Install on each VM (Steps 1–4) or **user data** |
| Kubernetes     | **DaemonSet** — e.g. `helm install promtail grafana/promtail` |

> DaemonSet only exists in **Kubernetes** — on plain EC2 VMs there is no DaemonSet.
> Note: Grafana now recommends **Grafana Alloy** as the newer agent; Promtail still works for labs.

## Interview One-Liner

> Pushgateway captures metrics of short-living jobs — a 10 s backup script **pushes** its metric to
> port 9091 before it exits, and Prometheus pulls it from there later.

> Grafana RBAC controls user permissions — I create users, group them into teams, and give teams
> View / Edit / Admin on folders.

> Loki collects logs from every server: Promtail (an agent on each VM, a DaemonSet in Kubernetes)
> pushes logs to Loki on port 3100, and Grafana shows logs next to Prometheus metrics.
