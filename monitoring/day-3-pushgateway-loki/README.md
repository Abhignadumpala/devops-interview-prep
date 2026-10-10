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
| **Loki**     | Stores the logs Promtail sends                    | Monitoring server |
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

```
Monitoring server: Loki :3100 + Promtail      Workers: Promtail ──push──► <monitoring-private-ip>:3100
```

| Port | Type       | Source            | SG                           | Why                         |
| ---- | ---------- | ----------------- | ---------------------------- | --------------------------- |
| 3100 | Custom TCP | `workernode-sg`   | `monitoring-sg`              | Workers' Promtail → Loki    |

### Step 1 — Install Loki (monitoring server, first)

As root on the **monitoring server** (Docker is already there from Pushgateway):

```bash
mkdir -p /opt/loki && cd /opt/loki

# download the Loki config file
wget https://raw.githubusercontent.com/grafana/loki/v2.9.0/cmd/loki/loki-local-config.yaml -O loki-config.yaml

# run Loki with that config
docker run -d --name loki \
  -v /opt/loki:/mnt/config \
  -p 3100:3100 \
  grafana/loki:2.9.0 -config.file=/mnt/config/loki-config.yaml

docker ps                         # loki → Up
curl -s localhost:3100/ready      # "ready" (wait ~15 s after start)
```

| Part                       | Meaning                                         |
| -------------------------- | ----------------------------------------------- |
| `wget … -O loki-config.yaml` | Download Loki's ready-made config             |
| `-v /opt/loki:/mnt/config` | Give the config folder to the container         |
| `-p 3100:3100`             | Loki listens on **3100**                         |
| `-config.file=…`           | Tell Loki which config to use                    |

### Step 2 — Install Promtail on Every Server

Run on **each VM** (workers **and** the monitoring server), as root. Change `LOKI_IP`:

- On the **monitoring server** → `localhost`
- On **workers** → monitoring server's **private IP** (e.g. `172.31.13.45`)

```bash
apt update && apt install docker.io -y   # skip on the monitoring server
mkdir -p /opt/promtail && cd /opt/promtail

LOKI_IP=172.31.13.45 # ← change: monitoring private IP (or localhost on the monitoring server)

# Promtail config: which logs to read + where Loki is
cat <<EOF > promtail-config.yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml # remembers how far it read each file

clients:
  - url: http://${LOKI_IP}:3100/loki/api/v1/push # send logs to Loki

scrape_configs:
  - job_name: system
    static_configs:
      - targets: [localhost]
        labels:
          job: varlogs
          host: $(hostname) # which server the log came from
          __path__: /var/log/*log # system logs
  - job_name: nginx
    static_configs:
      - targets: [localhost]
        labels:
          job: nginx
          host: $(hostname)
          __path__: /var/log/nginx/*log # application (Amazon app) logs
EOF

docker run -d --name promtail \
  -v /opt/promtail:/mnt/config \
  -v /var/log:/var/log \
  --network host \
  grafana/promtail:2.9.0 -config.file=/mnt/config/promtail-config.yaml

docker ps   # promtail → Up
```

| Part                       | Meaning                                                   |
| -------------------------- | --------------------------------------------------------- |
| `clients: url`             | **Where Loki is** → logs are pushed here                  |
| `host: $(hostname)`        | Label so we know **which server** each log came from      |
| `__path__`                 | **Which log files** to read                               |
| `-v /var/log:/var/log`     | Let the container read the server's logs                  |
| `--network host`           | Use the server's network (reach Loki by IP / localhost)   |

> **Real time:** Promtail is installed on **all servers** automatically — on EC2 with **user data**,
> in Kubernetes with a **DaemonSet** (below).

### Step 3 — Add Loki in Grafana

**Connections → Data sources → Add data source → Loki** → URL `http://localhost:3100` → **Save & test**
→ "Data source connected".

### Step 4 — See the Logs

**Explore** (compass icon) → choose **Loki** → query → **Run query**:

| LogQL query                          | Shows                               |
| ------------------------------------ | ----------------------------------- |
| `{job="varlogs"}`                    | System logs from all servers        |
| `{job="nginx", host="worker1"}`      | Amazon app logs from worker1        |
| `{job="nginx"} \|= "404"`            | Only lines containing **404**       |

> Open `http://<worker-public-ip>` a few times → new nginx log lines appear in Grafana.

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
| EC2 VMs (lab)  | Install on each VM (Step 2) or **user data** |
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
