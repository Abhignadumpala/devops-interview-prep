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

## EC2-Based Service Discovery

When an **Auto Scaling Group** creates many VMs, adding each one to monitoring **by hand is
practically impossible**.

**Purpose of service discovery:** **discover the servers** and make sure they are **added to
monitoring automatically** — based on their **tags**.

```
Auto Scaling Group ──creates──► VM 1, VM 2, VM 3 … (tag: Name=amazon-prod, Node Exporter :9100)
                                        ▲
                                        │ "which EC2s are running?" (EC2 read permission)
                                        │
                     prometheus-monitoring-server (IAM role: prometheus-role)
```

### Steps

| #   | Step                                                                       | Where             |
| --- | -------------------------------------------------------------------------- | ----------------- |
| 1   | Create IAM role **prometheus-role** (EC2 read-only)                        | IAM               |
| 2   | Attach the role to the **monitoring server**                               | EC2               |
| 3   | Install **Node Exporter on all nodes** (ASG + launch template / user data) | Worker VMs        |
| 4   | Add `ec2_sd_configs` to `prometheus.yml`                                   | Monitoring server |
| 5   | Restart Prometheus                                                         | Monitoring server |

### Step 1 — Create the IAM Role

Prometheus needs **permission to read EC2** to know which servers exist.

```
IAM → Roles → Create role
   ▼
Trusted entity: AWS service → EC2
   ▼
Permission: AmazonEC2ReadOnlyAccess
   ▼
Role name: prometheus-role → Create
```

### Step 2 — Attach the Role to the Monitoring Server

```
EC2 → select prometheus-monitoring-server → Actions → Security → Modify IAM role
   ▼
Select prometheus-role → Update IAM role
```

### Step 3 — Node Exporter on All Nodes

Put the Node Exporter script in the **launch template user data** → every VM the ASG creates gets
Node Exporter **automatically**.

### Step 4 — Configure Prometheus

```bash
vim /etc/prometheus/prometheus.yml
```

Add this job under `scrape_configs:`

```yaml
scrape_configs:
  - job_name: "ec2-discovery"

    ec2_sd_configs:
      - region: us-east-1 # region where the VMs run
        port: 9100 # Node Exporter port

    relabel_configs:
      - source_labels: [__meta_ec2_private_ip]
        target_label: instance # show the VM's private IP as the instance name
```

| Line              | Meaning                                             |
| ----------------- | --------------------------------------------------- |
| `ec2_sd_configs`  | Find targets from **AWS EC2** (not a fixed IP list) |
| `region`          | Which AWS region to look in                         |
| `port: 9100`      | Scrape Node Exporter on each VM                     |
| `relabel_configs` | Rename labels — here, show the **private IP**       |

**In simple:** we use service discovery for region **us-east-1** on port **9100**. Every EC2 in
us-east-1 has a **private IP**, so **all EC2s in that region are found and added** as targets.
`relabel_configs` takes each VM's **private IP** (`__meta_ec2_private_ip`) and shows it as the
**instance** name, so we can tell the VMs apart.

```
us-east-1: VM-1 (10.0.1.11), VM-2 (10.0.1.12), VM-3 (10.0.1.13)
                │ ec2_sd_configs finds all of them
                ▼
targets: 10.0.1.11:9100, 10.0.1.12:9100, 10.0.1.13:9100   (instance = private IP)
```

**Only monitor VMs with a tag** (e.g. `Name=amazon-prod`):

```yaml
ec2_sd_configs:
  - region: us-east-1
    port: 9100
    filters:
      - name: tag:Name
        values: [amazon-prod]
```

### Step 5 — Restart Prometheus and Check

> After **any config change**, restart the service.

```bash
systemctl restart prometheus
systemctl daemon-reload
systemctl status prometheus # must show: active (running)
```

**Check:** Prometheus → **Status → Targets** → `ec2-discovery` now shows **multiple targets instead
of 1** — all VMs added **automatically**. A new VM from the ASG appears **without editing the file
again**.

> Prometheus uses the **private IP**, so the workers' security group must allow **9100** from the
> monitoring server.

## Interview Question — Issues I Faced in Prometheus

**Q: What issues did you face in Prometheus?**

**Problem:** after setting up EC2 service discovery, **no VMs were listed** in **Status → Targets**.

**Cause:** in `ec2_sd_configs` I gave a **different region** — not the region where my VMs were
running. Prometheus looked in the wrong region and found nothing.

**Fix:** changed `region` to the **correct region** (`us-east-1`) → restarted Prometheus → all
target VMs were **listed correctly**.

> **Lesson:** service discovery only finds VMs in the region you give — always match `region` to
> where the VMs run.

## Interview One-Liner

Service discovery lets Prometheus automatically find and update its monitoring targets from
platforms like AWS or Kubernetes, so we don't have to add server IPs by hand.

For EC2 service discovery, give the Prometheus server an IAM role with EC2 read-only access and
add `ec2_sd_configs` to `prometheus.yml` — it then finds every EC2 (filtered by tags) on port 9100
automatically.
