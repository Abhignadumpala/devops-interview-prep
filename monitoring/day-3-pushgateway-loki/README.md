# Day 3 — Pushgateway, Loki

[← Day 2](../day-2-service-discovery/README.md) · [All notes](../README.md)

- **Pushgateway:** short jobs **push** their metrics here; Prometheus **pulls** them from it (port 9091).
- **Loki:** stores and searches **logs** (not metrics) — shown in Grafana (port 3100).

## What is Pushgateway?

**Pushgateway** = a middle box where **short-lived jobs push metrics**, and Prometheus scrapes them
from there later.

**Why?** Prometheus **pulls** every 15 s. A job that runs for **5 seconds** (backup, cron, batch)
finishes **before** Prometheus comes → its metrics are lost. The job pushes to Pushgateway, which
**keeps** them until Prometheus pulls.

```
Normal:       Prometheus ──pull──► Node Exporter :9100   (server is always running)

Short job:    Cron / backup job ──push──► Pushgateway :9091 ◄──pull── Prometheus :9090
              (runs 5 s, then exits)       (keeps the metrics)
```

| Field        | Value                                                     |
| ------------ | --------------------------------------------------------- |
| **Port**     | **9091**                                                  |
| **Use for**  | Batch jobs, cron jobs, backups, CI jobs — short-lived     |
| **Not for**  | Servers / apps that run all the time (use exporters)      |
| **Model**    | Job **pushes** → Prometheus still **pulls** from Pushgateway |

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

Open port **9091** (My IP) in `monitoring-sg` → `http://<monitoring-public-ip>:9091` → Pushgateway UI.

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

## Interview One-Liner

> Pushgateway lets short-lived batch or cron jobs **push** metrics on port 9091, so Prometheus can
> still pull them after the job has finished.

> Loki is a log aggregation system — Promtail ships logs from every server to Loki, and we search
> them in Grafana with LogQL, next to the Prometheus metrics.
