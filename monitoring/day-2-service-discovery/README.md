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

## Interview One-Liner

Service discovery lets Prometheus automatically find and update its monitoring targets from
platforms like AWS or Kubernetes, so we don't have to add server IPs by hand.
