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

## What is Node Exporter?

![What is Node Exporter](./images/node-exporter.svg)

**Node Exporter** = an **agent** we install on a server to **collect its metrics** (CPU, RAM, disk,
network) and **send them to Prometheus**.

| Field       | In short                                   |
| ----------- | ------------------------------------------ |
| **Type**    | Data source (agent)                        |
| **Purpose** | Send metrics from worker node → Prometheus |
| **Port**    | **9100**                                   |

**No Node Exporter → no metrics → we can't monitor that server.**

![Which servers can Prometheus monitor](./images/node-exporter-servers.svg)

Servers 1, 2, 3 and 5 have Node Exporter → **monitored**. Server 4 doesn't → **cannot be monitored**.

> **First step:** install Node Exporter on **every server you want to monitor**.

### Lab — Worker Node with Node Exporter

```
1. Create EC2 worker node + sample Amazon app
2. Install Node Exporter
3. Allow port 9100 → Prometheus can collect metrics
```

**1. Create the EC2 worker node with the sample Amazon application**

Launch an Ubuntu EC2 instance (the **worker node**) and deploy the sample **Amazon application**
code on it. This is the server we want to monitor.

**2. SSH into the server and switch to root**

```bash
ssh -i <key.pem> ubuntu@<server-ip>
sudo -i
```

**3. Create the script file**

```bash
vim node-exporter
```

**4. Paste this code, save (`Esc` → `:wq`)**

```bash
# download and extract
wget https://github.com/prometheus/node_exporter/releases/download/v1.5.0/node_exporter-1.5.0.linux-amd64.tar.gz
tar -xf node_exporter-1.5.0.linux-amd64.tar.gz

# move the binary and clean up
sudo mv node_exporter-1.5.0.linux-amd64/node_exporter /usr/local/bin
rm -rv node_exporter-1.5.0.linux-amd64*

# create a user for the service (no login)
sudo useradd -rs /bin/false node_exporter

# create the systemd service
sudo cat <<EOF | sudo tee /etc/systemd/system/node_exporter.service
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

# start the service
sudo cat /etc/systemd/system/node_exporter.service
sudo systemctl daemon-reload && sudo systemctl enable node_exporter
sudo systemctl start node_exporter.service && sudo systemctl status node_exporter.service --no-pager
```

**5. Run the script**

```bash
sh node-exporter
```

**6. Allow port 9100**

On AWS: **EC2 → Security Group → Inbound rules → Add rule → Custom TCP, port `9100`** → Save.

**7. Check**

Open `http://<server-ip>:9100/metrics` in the browser → you should see the metrics.

| Script step              | What it does                           |
| ------------------------ | -------------------------------------- |
| `wget` + `tar`           | Download and extract Node Exporter     |
| `mv … /usr/local/bin`    | Make `node_exporter` a command         |
| `useradd -rs /bin/false` | Create a system user that can't log in |
| `node_exporter.service`  | Run it as a service (starts on boot)   |
| `systemctl enable/start` | Start it now and on every reboot       |

## Interview One-Liner

Monitoring is analysing the performance of servers and applications using metrics like CPU, memory
and disk — most commonly with Prometheus and Grafana.

Prometheus is a free, open-source tool that monitors server metrics, stores them in a time series
database, queries them with PromQL and sends alerts through Alertmanager (port 9090).

Node Exporter is an agent installed on each server that exposes its CPU, RAM, disk and network
metrics on port 9100 for Prometheus to collect.
