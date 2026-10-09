# Day 1 — Intro to Monitoring, Prometheus, Grafana, Node Exporter

[← All notes](../README.md)

- **Monitoring:** watching how servers and applications perform — CPU, memory, disk, requests.
- **Prometheus:** collects and stores metrics; we query them with **PromQL**.
- **Grafana:** shows those metrics as **dashboards**.
- **Node Exporter:** sends a server's metrics to Prometheus.
- **Lab:** set up Prometheus + Grafana to monitor a worker server, then load-test it with `stress`.

<!-- toc -->

## Table of Contents

- [1. What is Monitoring?](#1-what-is-monitoring)
- [2. Architecture](#2-architecture)
- [3. Prometheus](#3-prometheus)
- [4. Grafana](#4-grafana)
- [5. Node Exporter](#5-node-exporter)
- [6. Ports to Remember](#6-ports-to-remember)
- [7. Lab — Setup](#7-lab--setup)
  - [Step 1 — Worker server: install Node Exporter](#step-1--worker-server-install-node-exporter)
  - [Step 2 — Monitoring server: install Prometheus & Grafana](#step-2--monitoring-server-install-prometheus--grafana)
  - [Step 3 — Connect worker to Prometheus](#step-3--connect-worker-to-prometheus)
- [8. PromQL Queries](#8-promql-queries)
- [9. Grafana Dashboard](#9-grafana-dashboard)
  - [Test with Load — `stress`](#test-with-load--stress)
- [Interview One-Liners](#interview-one-liners)

<!-- tocstop -->

## 1. What is Monitoring?

**Monitoring** = continuously **analysing the performance** of servers and applications using
**metrics** like CPU, memory, disk and number of requests.

**Why?**

- Find problems **before users do** (high CPU, full disk, server down).
- **Alert** the team by email / Slack / mobile when something goes wrong.
- See **trends** — when to add more servers.

**Tools in the market:** Prometheus, Grafana, Datadog, New Relic, Nagios, Zabbix, ELK, CloudWatch.
**Most used (free):** **Prometheus + Grafana**.

> **Prometheus collects the data. Grafana shows the data.**

## 2. Architecture

```
 Worker server(s)                 Monitoring server
┌──────────────────┐   metrics   ┌──────────────────────┐   query   ┌──────────────────┐
│ Node Exporter    │ ──────────► │ Prometheus (TSDB)    │ ────────► │ Grafana          │
│ :9100            │   (pull)    │ :9090                │  PromQL   │ :3000 dashboards │
└──────────────────┘             └──────────┬───────────┘           └──────────────────┘
                                            │ alerts
                                            ▼
                                  Alertmanager → Email / Slack / Mobile
```

Prometheus **pulls** (scrapes) metrics from Node Exporter every few seconds.

## 3. Prometheus

| Field          | Value                                              |
| -------------- | -------------------------------------------------- |
| **Type**       | Free & open source                                 |
| **Mainly for** | Cloud-native applications (Kubernetes, containers) |
| **Purpose**    | Monitor servers                                    |
| **Collects**   | **Metrics** — CPU, RAM, disk, requests             |
| **Stores in**  | **TSDB** — Time Series Database                    |
| **Alerts via** | **Alertmanager** → email, mobile, Slack            |
| **Query**      | **PromQL** — Prometheus Query Language             |
| **Port**       | **9090**                                           |

**Time series** = a value recorded **with a timestamp**, again and again (e.g. CPU % every 15 s).

## 4. Grafana

| Field          | Value                                             |
| -------------- | ------------------------------------------------- |
| **Type**       | Free & open source                                |
| **Purpose**    | Create **monitoring dashboards** for servers      |
| **Data from**  | Prometheus (and many other data sources)          |
| **Alerts via** | Email, mobile, Slack                              |
| **Port**       | **3000**                                          |
| **Login**      | `admin` / `admin` (asks to change on first login) |

## 5. Node Exporter

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| **Type**    | A **data source** (exporter)                                |
| **Runs on** | Every **worker server** we want to monitor                  |
| **Purpose** | Exposes the server's metrics so Prometheus can collect them |
| **Port**    | **9100**                                                    |

## 6. Ports to Remember

| Tool          | Port     | Open it in the security group of |
| ------------- | -------- | -------------------------------- |
| Prometheus    | **9090** | Monitoring server                |
| Grafana       | **3000** | Monitoring server                |
| Node Exporter | **9100** | Worker server                    |

## 7. Lab — Setup

Install scripts: [RAHAMSHAIK007/all-setups](https://github.com/RAHAMSHAIK007/all-setups) → use the
**ubuntu-pigeon** script.

```
Server 1 (worker)       → Node Exporter
Server 2 (monitoring)   → Prometheus + Grafana
```

### Step 1 — Worker server: install Node Exporter

Create a server → run the Node Exporter script → check `http://<worker-ip>:9100/metrics`.

### Step 2 — Monitoring server: install Prometheus & Grafana

Create a server → run the Prometheus + Grafana script → check `http://<monitoring-ip>:9090` and
`http://<monitoring-ip>:3000`.

### Step 3 — Connect worker to Prometheus

On the **monitoring server**, add the worker IP under `targets`:

```bash
vim /etc/prometheus/prometheus.yml
```

```yaml
scrape_configs:
  - job_name: "node"
    static_configs:
      - targets: ["<worker-ip>:9100"] # add every worker node here
```

> **After changing any service's config, restart it.**

```bash
systemctl restart prometheus.service
```

Check: Prometheus UI → **Status → Targets** → worker shows **UP**.

## 8. PromQL Queries

Run these in the Prometheus UI (`:9090`).

| What to show                       | Query                                              |
| ---------------------------------- | -------------------------------------------------- |
| Which servers are running (1 = up) | `up`                                               |
| Total requests to the server       | `promhttp_metric_handler_requests_total`           |
| Requests in the last 1 minute      | `promhttp_metric_handler_requests_total[1m]`       |
| Requests **per second** (rate)     | `rate(promhttp_metric_handler_requests_total[1m])` |
| Memory                             | `node_memory_Active_bytes`                         |
| CPU                                | `node_cpu_seconds_total`                           |
| Disk                               | `node_disk_info`                                   |

## 9. Grafana Dashboard

```
Login (admin/admin)
   │
   ▼
Add data source → Prometheus → URL: http://<monitoring-ip>:9090 → Save & test
   │
   ▼
Import dashboard → ID 1860 → Load → select Prometheus → Import
```

- **Data source** = where the data is coming from (Prometheus).
- **Dashboard ID** = ready-made dashboard from grafana.com — no need to build graphs by hand.

| Dashboard ID | Note                               |
| ------------ | ---------------------------------- |
| **1860**     | Node Exporter Full (most used)     |
| 10180        | Other ready-made dashboards to try |
| 14731        |                                    |
| 11074        |                                    |
| 8919         |                                    |

### Test with Load — `stress`

Put load on the **worker server** and watch the CPU graph go up in Grafana:

```bash
apt update && apt install stress -y && stress -c 10 # 10 CPU workers
```

Stop with `Ctrl + C` → CPU graph comes back down.

## Interview One-Liners

- **Monitoring** analyses the performance of servers and apps using metrics like CPU, memory and
  disk.
- **Prometheus** is an open-source tool that **pulls** metrics, stores them in a **TSDB** and
  queries them with **PromQL** (port 9090).
- **Grafana** is an open-source tool that turns those metrics into **dashboards** (port 3000).
- **Node Exporter** runs on each server and exposes its metrics to Prometheus (port 9100).
- **Alertmanager** sends Prometheus alerts to email, Slack or mobile.
- **Prometheus collects, Grafana visualises.**
