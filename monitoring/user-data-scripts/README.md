# User Data Scripts — Quick Rebuild of the Monitoring Lab

**User data** = a script you paste when launching an EC2. It runs **once, as root, on first boot**.
→ No SSH, no `sudo`, no manual install. **Free** (unlike an AMI, nothing is stored).

```
Launch EC2 → Advanced details → User data → paste script → Launch
                                                │
                                   first boot: script installs everything
```

| Server            | Script below installs                                         |
| ----------------- | ------------------------------------------------------------- |
| **Worker**        | Amazon app (nginx :80) + Node Exporter (:9100)                |
| **Monitoring**    | Node Exporter + Prometheus (EC2 SD + rules + alerting) + Grafana (data source ready) + Alertmanager |

Step-by-step explanations: [Day 10 — Intro](../day-10-intro/README.md) ·
[Day 11 — Service Discovery, Alertmanager](../day-11-service-discovery/README.md)

## Launch Checklist

| #   | Do                                     | Worker                                   | Monitoring                                   |
| --- | -------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| 1   | AMI / type                             | Ubuntu, t3.micro                         | Ubuntu, t3.micro                             |
| 2   | Security group                         | 22 (My IP), 80 (Anywhere), 9100 (`monitoring-sg`) | 22, 9090, 3000, 9093 (My IP)        |
| 3   | IAM role (Advanced details → IAM instance profile) | –                            | **`prometheus-role`** (EC2 read-only)        |
| 4   | User data                              | [Worker script](#worker-script)          | [Monitoring script](#monitoring-script)      |
| 5   | Number of instances                    | 1–3                                      | 1                                            |

> Create the **monitoring server first** (its SG is the source for 9100 on the worker SG).
> No IPs to type — **EC2 service discovery** finds the workers by itself.

## Worker Script

```bash
#!/bin/bash
# ---------- Amazon app (nginx :80) ----------
apt update -y
apt install -y nginx

cat <<'EOF' > /var/www/html/index.html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Amazon Clone - Demo</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #eaeded; }
    header { background: #131921; color: #fff; padding: 12px 20px; display: flex; align-items: center; gap: 20px; }
    .logo { font-size: 26px; font-weight: bold; }
    .logo span { color: #ff9900; }
    .search { flex: 1; display: flex; }
    .search input { flex: 1; padding: 10px; border: none; border-radius: 4px 0 0 4px; }
    .search button { background: #febd69; border: none; padding: 0 16px; border-radius: 0 4px 4px 0; }
    nav { background: #232f3e; color: #fff; padding: 8px 20px; font-size: 14px; }
    .banner { background: linear-gradient(90deg, #ff9900, #febd69); text-align: center; padding: 40px; font-size: 28px; font-weight: bold; }
    .products { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; padding: 20px; }
    .card { background: #fff; padding: 20px; border-radius: 6px; text-align: center; }
    .card .img { font-size: 60px; }
    .price { color: #b12704; font-size: 20px; font-weight: bold; }
    .card button { background: #ffd814; border: none; padding: 8px 16px; border-radius: 20px; cursor: pointer; }
    footer { background: #131921; color: #ccc; text-align: center; padding: 16px; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <div class="logo">amazon<span>.clone</span></div>
    <div class="search"><input placeholder="Search products"><button>🔍</button></div>
    <div>🛒 Cart</div>
  </header>
  <nav>All · Today's Deals · Electronics · Books · Fashion · Home</nav>
  <div class="banner">Great Indian Sale — Up to 70% off</div>
  <div class="products">
    <div class="card"><div class="img">📱</div><h3>Smartphone</h3><p class="price">₹14,999</p><button>Add to Cart</button></div>
    <div class="card"><div class="img">💻</div><h3>Laptop</h3><p class="price">₹54,999</p><button>Add to Cart</button></div>
    <div class="card"><div class="img">🎧</div><h3>Headphones</h3><p class="price">₹1,999</p><button>Add to Cart</button></div>
    <div class="card"><div class="img">⌚</div><h3>Smart Watch</h3><p class="price">₹3,499</p><button>Add to Cart</button></div>
  </div>
  <footer>Demo page for DevOps monitoring practice — served from EC2</footer>
</body>
</html>
EOF

systemctl enable nginx
systemctl restart nginx

# ---------- Node Exporter (:9100) ----------
cd /tmp
wget https://github.com/prometheus/node_exporter/releases/download/v1.5.0/node_exporter-1.5.0.linux-amd64.tar.gz
tar -xf node_exporter-1.5.0.linux-amd64.tar.gz
mv node_exporter-1.5.0.linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-1.5.0.linux-amd64*
useradd -rs /bin/false node_exporter

cat <<'EOF' > /etc/systemd/system/node_exporter.service
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

systemctl daemon-reload
systemctl enable --now node_exporter
```

## Monitoring Script

```bash
#!/bin/bash
cd /tmp

# ---------- Node Exporter (:9100) — monitor this server too ----------
wget https://github.com/prometheus/node_exporter/releases/download/v1.5.0/node_exporter-1.5.0.linux-amd64.tar.gz
tar -xf node_exporter-1.5.0.linux-amd64.tar.gz
mv node_exporter-1.5.0.linux-amd64/node_exporter /usr/local/bin/
rm -rf node_exporter-1.5.0.linux-amd64*
useradd -rs /bin/false node_exporter

cat <<'EOF' > /etc/systemd/system/node_exporter.service
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

# ---------- Prometheus (:9090) ----------
wget https://github.com/prometheus/prometheus/releases/download/v2.43.0/prometheus-2.43.0.linux-amd64.tar.gz
tar -xf prometheus-2.43.0.linux-amd64.tar.gz
mv prometheus-2.43.0.linux-amd64/prometheus prometheus-2.43.0.linux-amd64/promtool /usr/local/bin/
mkdir -p /etc/prometheus/rules /var/lib/prometheus
mv prometheus-2.43.0.linux-amd64/console_libraries /etc/prometheus/
rm -rf prometheus-2.43.0.linux-amd64*

# config: rules + Alertmanager + EC2 service discovery
cat <<'EOF' > /etc/prometheus/prometheus.yml
global:
  scrape_interval: 15s # collect metrics every 15 s
  evaluation_interval: 15s # check the rules every 15 s

rule_files:
  - "rules/cpu_alert.yml" # relative to /etc/prometheus/

alerting:
  alertmanagers:
    - static_configs:
        - targets:
            - "localhost:9093" # Alertmanager on this server

scrape_configs:
  - job_name: "ec2-discovery"
    ec2_sd_configs:
      - region: us-east-1 # region where the VMs run
        port: 9100 # Node Exporter port
    relabel_configs:
      - source_labels: [__meta_ec2_private_ip]
        target_label: instance # show the private IP as the instance name
EOF

# alert rule: CPU > 50% for 1 minute
cat <<'EOF' > /etc/prometheus/rules/cpu_alert.yml
groups:
  - name: cpu-alerts
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100) > 50
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High CPU on {{ $labels.instance }}"
          description: "CPU usage > 50% on {{ $labels.instance }}"
EOF

useradd -rs /bin/false prometheus
chown -R prometheus: /etc/prometheus /var/lib/prometheus

cat <<'EOF' > /etc/systemd/system/prometheus.service
[Unit]
Description=Prometheus
After=network.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
    --config.file /etc/prometheus/prometheus.yml \
    --storage.tsdb.path /var/lib/prometheus/ \
    --web.console.templates=/etc/prometheus/consoles \
    --web.console.libraries=/etc/prometheus/console_libraries

[Install]
WantedBy=multi-user.target
EOF

# ---------- Alertmanager (:9093) ----------
wget https://github.com/prometheus/alertmanager/releases/download/v0.25.0/alertmanager-0.25.0.linux-amd64.tar.gz
tar -xf alertmanager-0.25.0.linux-amd64.tar.gz
mv alertmanager-0.25.0.linux-amd64/alertmanager alertmanager-0.25.0.linux-amd64/amtool /usr/local/bin/
rm -rf alertmanager-0.25.0.linux-amd64*
useradd -rs /bin/false alertmanager
mkdir -p /etc/alertmanager /var/lib/alertmanager

# default config — add Slack / email later (Day 11, Step 9)
cat <<'EOF' > /etc/alertmanager/alertmanager.yml
route:
  receiver: "default"

receivers:
  - name: "default"
EOF

chown -R alertmanager: /etc/alertmanager /var/lib/alertmanager

cat <<'EOF' > /etc/systemd/system/alertmanager.service
[Unit]
Description=Alertmanager
After=network.target

[Service]
User=alertmanager
Group=alertmanager
Type=simple
ExecStart=/usr/local/bin/alertmanager \
  --config.file=/etc/alertmanager/alertmanager.yml \
  --storage.path=/var/lib/alertmanager
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# ---------- Grafana (:3000) ----------
apt-get update -y
apt-get install -y adduser libfontconfig1
wget https://dl.grafana.com/enterprise/release/grafana-enterprise_9.4.7_amd64.deb
dpkg -i grafana-enterprise_9.4.7_amd64.deb
rm -f grafana-enterprise_9.4.7_amd64.deb

# data source ready — no need to add Prometheus by hand
cat <<'EOF' > /etc/grafana/provisioning/datasources/prometheus.yml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    url: http://localhost:9090
    access: proxy
    isDefault: true
EOF

# ---------- start everything ----------
systemctl daemon-reload
systemctl enable --now node_exporter prometheus alertmanager grafana-server
```

| Part                                            | Why                                                     |
| ----------------------------------------------- | ------------------------------------------------------- |
| `#!/bin/bash` on line 1                         | Required — tells EC2 to run it as a bash script         |
| No `sudo`                                       | User data already runs as **root**                      |
| `cat <<'EOF'` (quotes)                          | Writes the text **as is** — keeps `{{ $labels.instance }}` |
| `enable --now`                                  | Start now **and** on every reboot                       |
| `/etc/grafana/provisioning/datasources/`        | Grafana adds the Prometheus data source **automatically** |

## After Launch — Check (2–3 min)

| Check                    | How                                                                  |
| ------------------------ | -------------------------------------------------------------------- |
| Script finished?         | SSH → `cloud-init status` → `status: done`                           |
| Script errors?           | `sudo cat /var/log/cloud-init-output.log`                            |
| Services running?        | `systemctl status prometheus grafana-server alertmanager node_exporter --no-pager` |
| Targets                  | `http://<monitoring-public-ip>:9090` → Status → Targets = **UP**     |
| Rules                    | `:9090` → Status → Rules → `cpu-alerts`                              |
| Alertmanager             | `http://<monitoring-public-ip>:9093`                                 |
| Grafana                  | `http://<monitoring-public-ip>:3000` (`admin` / `admin`) → data source already there |
| App                      | `http://<worker-public-ip>`                                          |

**Still manual (1 min):** Grafana → Dashboards → New → Import → **1860** → Prometheus → Import.

## Interview One-Liner

> "I automated the monitoring lab with EC2 user data — one script per server type installs and
> starts Node Exporter, Prometheus with EC2 service discovery and alert rules, Alertmanager and
> Grafana with a provisioned data source, so a full rebuild takes minutes with no manual steps."
