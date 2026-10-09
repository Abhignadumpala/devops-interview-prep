# Day 1 — Intro to Monitoring

[← All notes](../README.md)

## What is Monitoring?

**Monitoring** = analysing the **performance** of our servers and applications using **metrics**
like CPU, memory and disk.

**Why?**

- Find problems **before users do** (high CPU, full disk, server down).
- **Alert** the team when something goes wrong.
- See **trends** — when to add more servers.

## Monitoring Tools

There are many monitoring tools in the market. The most used (free & open source) are **Prometheus**
and **Grafana**.

| Tool           | In short                                   |
| -------------- | ------------------------------------------ |
| **Prometheus** | Collects and stores metrics from servers   |
| **Grafana**    | Shows those metrics as dashboards          |

```
Servers ──metrics──► Prometheus ──► Grafana (dashboards)
```

> **Prometheus collects the data. Grafana shows the data.**

## Interview One-Liner

Monitoring is analysing the performance of servers and applications using metrics like CPU, memory
and disk — most commonly with Prometheus and Grafana.
