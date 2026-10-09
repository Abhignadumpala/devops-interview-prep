# Day 2 — Service Discovery

[← Day 1](../day-1-intro/README.md) · [All notes](../README.md)

## What is Service Discovery?

**Service discovery** = Prometheus **automatically finds** the servers to monitor, instead of us
typing each server IP into `prometheus.yml` by hand.

## The Problem — Static Targets

On Day 1 we added the worker IP **manually**:

```yaml
- targets: ["<amazon-vm-ip>:9100"]
```

- New server added → edit `prometheus.yml` → **restart** Prometheus.
- Server deleted or IP changed → Prometheus still points to the **old IP** → shows **DOWN**.
- With **auto scaling** (servers come and go every few minutes), doing this by hand is impossible.

## The Fix — Service Discovery

Prometheus **asks the platform** (AWS, Kubernetes…) "which servers are running right now?" and
**updates its targets by itself**.

```
Static:            you ──type IPs──► prometheus.yml ──restart──► Prometheus

Service discovery: AWS / Kubernetes ──list of running servers──► Prometheus (auto-updates)
```

|                  | Static targets       | Service discovery       |
| ---------------- | -------------------- | ----------------------- |
| **Add a server** | Edit file + restart  | Found **automatically** |
| **IP changes**   | Breaks (target DOWN) | Picks up the new IP     |
| **Auto scaling** | Not practical        | Works                   |
| **Good for**     | Few fixed servers    | Cloud / Kubernetes      |

## Lab — Scale Out: Add a Second Server (Manual Way)

**Scenario:** load increases → we need **one more VM** running the Amazon app.

> **Real time:** an **Auto Scaling Group** creates new VMs **automatically** when CPU % goes up.
> For now, we copy the VM **by hand** to see the problem.

```
amazon-prod (VM 1) ──"Launch more like this"──► amazon-prod copy (VM 2)
      │                                                  │
      └────────────── both must be monitored ────────────┘
```

### Step 1 — Copy the VM

```
EC2 → select amazon-prod VM → Actions → Images and templates → Launch more like this → Launch
```

Creates a **copy** with the **same configuration** (AMI, type, security group, user data → Amazon
app).

### Step 2 — Install Node Exporter on the New VM

SSH into the **new VM** → run the same `node-exporter` script as Day 1 → port **9100** is already
open (same security group).

### Step 3 — Add the New IP to Prometheus

On the monitoring server:

```bash
vim /etc/prometheus/prometheus.yml
```

```yaml
- targets: ["<vm-1-ip>:9100", "<vm-2-ip>:9100"] # add the new VM's IP
```

```bash
systemctl restart prometheus.service
```

Check: **Status → Targets** → both VMs **UP**.

### Step 4 — Grafana Dashboard for the New VM

Import dashboard **1860** again, but Grafana does **not** allow duplicates:

| Field    | Rule                                         | Example                       |
| -------- | -------------------------------------------- | ----------------------------- |
| **Name** | Must be **different** for each dashboard     | `Node Exporter - amazon-vm-2` |
| **UID**  | Must be **different** — same one is rejected | `amazon-vm-2`                 |

```
Dashboards → Import → 1860 → Load → change Name + UID → select Prometheus → Import
```

### Why This Is a Problem

Every new VM = install Node Exporter + **edit `prometheus.yml`** + **restart** + new dashboard — by
hand. With auto scaling creating VMs automatically, we can't keep up → **service discovery** solves
the Prometheus part.

## Interview One-Liner

Service discovery lets Prometheus automatically find and update its monitoring targets from
platforms like AWS or Kubernetes, so we don't have to add server IPs by hand.
