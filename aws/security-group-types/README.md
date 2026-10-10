# Security Group Types — HTTP vs Custom TCP

## TCP vs HTTP

| Term     | What it is                                                     | Layer             |
| -------- | -------------------------------------------------------------- | ----------------- |
| **TCP**  | Moves data reliably between two machines on a port             | Transport (L4)    |
| **HTTP** | The language browsers and web servers speak; runs **on TCP**   | Application (L7)  |
| **SSH**  | Secure remote login; also runs **on TCP**                      | Application (L7)  |

```
HTTP (web)   SSH (login)   Prometheus / Grafana / Node Exporter (also HTTP)
     \            |            /
      └────────── TCP ─────────┘   ← security group checks only: TCP + port
```

## The "Type" Dropdown = Shortcut for a Port

A security group never reads HTTP or SSH. It only checks **protocol (TCP) + port**.
The names in **Type** just fill in the port for you.

| Type you pick | What AWS saves         |
| ------------- | ---------------------- |
| SSH           | TCP 22                 |
| HTTP          | TCP 80                 |
| HTTPS         | TCP 443                |
| Custom TCP    | TCP + the port you type |

> Preset exists for the port → use it. No preset → **Custom TCP**.

## Example — Monitoring Lab Ports

| Port | App speaks | Type to pick |
| ---- | ---------- | ------------ |
| 22   | SSH        | SSH          |
| 80   | HTTP       | HTTP         |
| 9100 | HTTP       | Custom TCP   |
| 9090 | HTTP       | Custom TCP   |
| 3000 | HTTP       | Custom TCP   |

Used in: [Monitoring Day 1 — Lab](../../monitoring/day-1-intro/README.md#lab--monitor-an-ec2-server)

## Interview One-Liner

> "Security groups filter at L4 on protocol + port only. SSH and HTTP are just presets for TCP 22
> and TCP 80. Apps on other ports, like Grafana on 3000, use Custom TCP."
