# Day 3 — Pushgateway, Loki

[← Day 2](../day-2-service-discovery/README.md) · [All notes](../README.md)

- **Pushgateway:** captures metrics of **short-living** scripts / jobs / pods (≤ 15 s) — they **push**, Prometheus **pulls** (port 9091).
- **Loki:** stores and searches **logs** (not metrics) — shown in Grafana (port 3100).

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

**Loki** = a **log** storage and search system from Grafana Labs — "like Prometheus, but for logs".

**Why?** Metrics tell **what** is wrong (CPU 100%). **Logs** tell **why** (the error message). Loki
collects logs from all servers into **one place**, and we search them in **Grafana** — no SSH into
each server to read log files.

```
Server logs (/var/log/*) ──► Promtail (agent) ──push──► Loki :3100 ◄──query── Grafana :3000
```

| Tool         | Stores      | Agent on servers | Query language |
| ------------ | ----------- | ---------------- | -------------- |
| Prometheus   | **Metrics** | Node Exporter    | PromQL         |
| Loki         | **Logs**    | Promtail         | LogQL          |

| Field        | Value                                                    |
| ------------ | -------------------------------------------------------- |
| **Port**     | **3100**                                                 |
| **Use for**  | Central logs from many servers, search errors in Grafana |
| **Cheap**    | Indexes only **labels** (job, host), not the full log text |

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
    honor_labels: true # keep the job/instance labels the pushed metrics came with
    static_configs:
      - targets: ["localhost:9091"] # Pushgateway on this same server
```

```bash
systemctl restart prometheus
```

**Check:** `:9090` → **Status → Targets** → `pushgateway` = **UP**.

### Step 3 — Create a Short Backup Script (runs 10 s)

We **intentionally** make a script that lives only **10 seconds** (less than the 15 s scrape) and
**pushes** its metrics to Pushgateway before it exits.

```bash
vim backup.sh # paste the script below, save (Esc → :wq)
```

```bash
#!/bin/bash
START=$(date +%s) # start time (seconds)
echo "Backup started"

# backup: compress the Prometheus config folder
tar -czf /tmp/backup-$(date +%F-%H%M%S).tar.gz /etc/prometheus
sleep 10 # keep the job alive for 10 s (short-living on purpose)

END=$(date +%s)
DURATION=$((END - START)) # how long the backup took

# push metrics to Pushgateway (job name = backup_job)
cat <<EOF | curl --data-binary @- http://localhost:9091/metrics/job/backup_job
backup_duration_seconds $DURATION
backup_last_run_timestamp $END
backup_success 1
EOF

echo "Backup done in ${DURATION}s — metrics pushed"
```

```bash
bash backup.sh
```

| Line                                         | What it does                                       |
| -------------------------------------------- | -------------------------------------------------- |
| `date +%s`                                   | Current time in seconds                            |
| `tar -czf …`                                 | The "backup" — compress `/etc/prometheus`          |
| `sleep 10`                                   | Job lives **10 s** → shorter than the 15 s scrape  |
| `curl --data-binary @- …/metrics/job/backup_job` | **Push** the metrics to Pushgateway             |
| `backup_success 1`                           | 1 = backup OK (0 = failed)                         |

### Step 4 — Check the Metrics

| Where                                   | You see                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `http://<monitoring-public-ip>:9091`    | Pushgateway UI → group **job="backup_job"** with 3 metrics |
| Prometheus `:9090` → Graph              | Query `backup_duration_seconds` → **~10**                |
| Prometheus `:9090` → Graph              | Query `backup_success` → **1**                           |

> The script is **already finished**, but Prometheus still shows its metrics — because Pushgateway
> kept them. That's the whole point.

## Interview One-Liner

> Pushgateway lets short-lived batch or cron jobs **push** metrics on port 9091, so Prometheus can
> still pull them after the job has finished.

> Loki is a log aggregation system — Promtail ships logs from every server to Loki, and we search
> them in Grafana with LogQL, next to the Prometheus metrics.
