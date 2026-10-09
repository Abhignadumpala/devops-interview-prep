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

| Tool           | In short                                 |
| -------------- | ---------------------------------------- |
| **Prometheus** | Collects and stores metrics from servers |
| **Grafana**    | Shows those metrics as dashboards        |

```
Servers ──metrics──► Prometheus ──► Grafana (dashboards)
```

> **Prometheus collects the data. Grafana shows the data.**

## What is Prometheus?

![What is Prometheus](./images/prometheus.svg)

**Prometheus** = a free & open-source tool to **monitor servers**, mainly used for **cloud-native
applications**.

| Field              | In short                                                      |
| ------------------ | ------------------------------------------------------------- |
| **Type**           | Free & open source                                            |
| **Mainly for**     | Cloud-native applications                                     |
| **Purpose**        | Monitor servers                                               |
| **Monitors**       | **Metrics** — CPU, RAM, disk usage… anything that is a number |
| **Stores data in** | **TSDB** — Time Series Database                               |
| **To show data**   | **PromQL** — Prometheus Query Language                        |
| **Alerts**         | **Alertmanager** → email, mobile, Slack when things go wrong  |
| **Port**           | **9090**                                                      |

**Alert example:** CPU goes **above 90%** → Alertmanager sends an email / Slack / mobile alert.

## Interview One-Liner

Monitoring is analysing the performance of servers and applications using metrics like CPU, memory
and disk — most commonly with Prometheus and Grafana.

Prometheus is a free, open-source tool that monitors server metrics, stores them in a time series
database, queries them with PromQL and sends alerts through Alertmanager (port 9090).
