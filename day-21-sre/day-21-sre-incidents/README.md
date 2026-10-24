# Day 21 — SRE Basics and Production Incidents (EC2 + Nginx)

[← All notes](../README.md)

> **In short:** SRE isn't just "keep the server running". You **measure** the service (SLI), set **targets** (SLO/SLA), and when it breaks you **find evidence → fix → verify → prevent**. In this lab we break a simple Nginx site on EC2 in 10 ways and learn to read each failure.

## Table of Contents

1. [What is SRE?](#1-what-is-sre)
2. [Lab Setup](#2-lab-setup)
3. [SLI, SLO, SLA](#3-sli-slo-sla)
4. [MTTF and MTTR](#4-mttf-and-mttr)
5. [RTO and RPO](#5-rto-and-rpo)
6. [HTTP Status Codes](#6-http-status-codes)
7. [The 10 Incidents](#7-the-10-incidents)
8. [Measuring Availability and Latency](#8-measuring-availability-and-latency)
9. [SRE Troubleshooting Flow](#9-sre-troubleshooting-flow)
10. [Incident Report](#10-incident-report)
11. [Commands Cheat Sheet](#11-commands-cheat-sheet)
12. [Final Challenge: "Sometimes Working, Sometimes Failing"](#12-final-challenge-sometimes-working-sometimes-failing)
13. [Interview Questions and One-Liners](#13-interview-questions-and-one-liners)
14. [Next Level](#14-next-level)

---

## 1. What is SRE?

**Definition:** **SRE (Site Reliability Engineering)** = using engineering (measuring, automation, root-cause fixing) to keep a service **reliable**.

An SRE must be able to answer these questions:

| Question | Measured by |
|----------|-------------|
| Is the app available? | Availability SLI |
| Is it fast? | Latency SLI |
| Is it working correctly? | Error rate, status codes |
| How quickly do we recover? | MTTR, RTO |
| How much data can we lose? | RPO |
| How do we stop it happening again? | Incident report, prevention |

## 2. Lab Setup

**Definition:** a **production-like service** = a real server, a web server and an app, with logs. Small, but it fails the same way real systems do.

```
USER ──HTTP :80──► EC2 [ NGINX ──► APP ] ──► LOGS (/var/log/nginx/)
```

| Item | Value |
|------|-------|
| EC2 | Ubuntu, t2.micro / t3.micro, 8 GB+ disk |
| Security Group | 22 from **my IP** only, 80 from `0.0.0.0/0`. No other ports |

```bash
ssh -i devops.pem ubuntu@<EC2-PUBLIC-IP>
sudo apt update && sudo apt install nginx -y
sudo systemctl enable --now nginx
sudo systemctl status nginx          # Active: active (running)
curl http://localhost                # HTML page
```

**App page:** remove the default page, then create `/var/www/html/index.html`:

```bash
sudo rm -f /var/www/html/index.nginx-debian.html
sudo vi /var/www/html/index.html
```

```html
<html><head><title>FoodExpress</title></head>
<body>
  <h1>🍛 Welcome to FoodExpress</h1>
  <h2>Application Status: ONLINE</h2>
  <p>Welcome to our food ordering application.</p>
</body></html>
```

```bash
curl -i http://localhost             # HTTP/1.1 200 OK
```

Also open `http://<EC2-PUBLIC-IP>` from the laptop browser.

## 3. SLI, SLO, SLA

![SRE terms](images/sre-terms.png)

**SLI (Service Level Indicator)** = **what we measure**. A real number. Examples: availability, latency, error rate, request count.

```
Availability SLI = successful requests / total requests × 100
                 = 990 / 1000 × 100 = 99%
```

**SLO (Service Level Objective)** = **what we aim for**, an internal engineering target. Example: availability SLO = 99.9%. SLI 99% < SLO 99.9% → **SLO missed**.

**SLA (Service Level Agreement)** = **what the business promises the customer**, usually with a penalty (refund or credits) if broken. The SLA is set looser than the SLO, so the team gets warned before the promise is broken.

| Term | Means | Who cares | Example |
|------|-------|-----------|---------|
| SLI | Measurement | Engineers | 99% |
| SLO | Engineering target | Engineering team | 99.9% |
| SLA | Business commitment | Customers, legal | 99.5% promised |

**Remember:** SLI = what happened · SLO = what we wanted · SLA = what we promised.

### Should SLI equal SLO?

**No.** The SLI does not have to equal the SLO. It must **meet or beat** it.

- **SLI** = the **actual** result we measured
- **SLO** = the **target** (the pass mark)
- **SLA** = the **promise** to the customer (looser than the SLO, with a penalty if broken)

**Analogy:** an exam. The pass mark is 35 (SLO), you scored 80 (SLI). You don't need exactly 35, just **at least 35**. The SLA is like the college rule "below 30 = fail the year": stricter consequences, lower bar.

**For availability, the SLI should be ≥ the SLO ≥ the SLA:**

| SLI (measured) | SLO (target) | SLA (promise) | Result |
|---|---|---|---|
| 99.95% | 99.9% | 99.5% | ✅ SLO met (better than target), SLA safe |
| 99.9% | 99.9% | 99.5% | ✅ SLO just met (on the edge), SLA safe |
| 99.7% | 99.9% | 99.5% | ⚠️ SLO missed, SLA still safe → team is warned, fix now |
| 99% | 99.9% | 99.5% | ❌ SLO missed **and SLA broken** → customer gets refund/credits |

**For "bad" metrics the direction flips. The SLI should be ≤ the SLO ≤ the SLA:**

| Metric | SLO (target) | SLA (promise) | Good SLI |
|---|---|---|---|
| Latency | p95 < 300 ms | p95 < 500 ms | 250 ms ✅ (lower is better) |
| Error rate | < 0.1% | < 0.5% | 0.05% ✅ |

**Why the SLA is looser than the SLO:** the gap between them is a **safety buffer**. When the SLO is missed, the team gets warned and fixes the problem **before** the SLA (and the penalty) is broken.

**Error budget:** an SLO of 99.9% allows 0.1% failures. That 0.1% is the **error budget**.
- Budget left → safe to ship new features
- Budget almost used → slow down releases, fix reliability first

> **One line:** SLI is reality, SLO is the goal, SLA is the promise. Keep **SLI ≥ SLO ≥ SLA** (for availability).

## 4. MTTF and MTTR

**MTTF (Mean Time To Failure)** = the average time the system **works before it breaks**.

```
Started Mon 9 AM → failed Wed 9 AM  → MTTF = 48 h
Failures after 20 h, 30 h, 40 h     → MTTF = 90 / 3 = 30 h
```

**MTTR (Mean Time To Recovery)** = the average time **to fix** it after it breaks.

```
Down 10:00 → back 10:08             → MTTR = 8 min
Incidents 5 + 10 + 15 min           → MTTR = 30 / 3 = 10 min
MTTR = total recovery time / number of incidents
```

| | Question | Better when |
|--|----------|-------------|
| MTTF | How long before it **breaks**? | **Higher** |
| MTTR | How long to **fix** it? | **Lower** |

## 5. RTO and RPO

**RTO (Recovery Time Objective)** = the **maximum time** the business allows to restore the service. Example: RTO 15 min, actual recovery 8 min → **met**.

**RPO (Recovery Point Objective)** = the **maximum data loss** the business accepts. Example: RPO 5 min → losing about the last 5 minutes of data is acceptable.

| Pair | Difference |
|------|------------|
| MTTR vs RTO | MTTR = what **actually** happened · RTO = what is **required** |
| RTO vs RPO | RTO = how **fast** we recover · RPO = how much **data** we lose |

Deeper DR notes: [Disaster Recovery](../../day-20-disaster-recovery/README.md).

## 6. HTTP Status Codes

**Definition:** a **status code** = a 3-digit number in every HTTP response that says what happened. The **first digit** tells you the type.

| Range | Meaning | Whose problem |
|-------|---------|---------------|
| 2xx | Success | — |
| 3xx | Redirect / cache | — |
| 4xx | Bad request | Client side (wrong URL, no permission) |
| 5xx | Server failed | Server side (Nginx or the app) |

| Code | Name | Think about |
|------|------|-------------|
| 200 | OK | Success (but check latency!) |
| 201 | Created | A resource was created |
| 301 / 302 | Moved / Found | Permanent / temporary redirect |
| 304 | Not Modified | Served from cache |
| 400 | Bad Request | Invalid request |
| 401 | Unauthorized | Not logged in (authentication) |
| 403 | Forbidden | Logged in or not, **access denied** (permission) |
| 404 | Not Found | Page or route missing |
| 408 | Request Timeout | Client was too slow to send |
| 429 | Too Many Requests | Rate limiting |
| 500 | Internal Server Error | App crashed while processing |
| 502 | Bad Gateway | Proxy OK, **upstream app down / wrong port** |
| 503 | Service Unavailable | Overloaded / maintenance / no backend |
| 504 | Gateway Timeout | Upstream app **too slow** |

![Which error means where](images/status-map.png)

**Upstream** = the server Nginx forwards the request to (the app on :8080). **Gateway / reverse proxy** = Nginx itself.

## 7. The 10 Incidents

**Definition:** an **incident** = any unplanned event that hurts the service for users (down, errors, slow).

Every incident is written as **Problem → Root Cause → Issue → Fix**:

| Word | Meaning |
|------|---------|
| **Problem** | What the customer sees |
| **Root cause** | The real reason (not the symptom) |
| **Issue** | Which component is affected, and the impact |
| **Fix** | What restored the service, and how it was verified |

### Summary table

| # | Incident | Root cause | First checks | Fix |
|---|----------|-----------|--------------|-----|
| 1 | Site won't open | Nginx stopped | `systemctl status nginx` | `systemctl start nginx` |
| 2 | 404 on `/menu` | Page/route doesn't exist | `ls -la /var/www/html` | Add the file / fix the route |
| 3 | 403 Forbidden | Permissions or deny rule | `ls -ld /var/www/html`, `nginx -t`, error.log | Fix permissions / config |
| 4 | 502 Bad Gateway | App down / wrong port | `ss -lntp`, error.log, `systemctl status <app>` | Start/fix the app |
| 5 | 503 Unavailable | Overload, app down, maintenance, resources | `top`, `free -m`, `df -h`, `ss -lntp`, logs | Fix the cause, don't blindly restart |
| 6 | 504 Timeout | App or its DB too slow | `top`, `free -m`, error.log | Fix the slow part |
| 7 | 500 Error | Bug / exception / bad config in the app | **App logs first**, then error.log | Fix the app / roll back the deploy |
| 8 | 200 but slow | A process hogging CPU | `top`, `ps aux --sort=-%cpu \| head` | Fix/stop that process |
| 9 | Disk 100% | Big logs, temp files, old artifacts | `df -h`, `du -sh /var/log/*` | Clean up + log rotation + alerts |
| 10 | Nginx won't start | Broken config | `nginx -t` | Fix config → test → restart |

### Incident 1 — Nginx is down

- **Problem:** customers can't open the site. `curl -I http://localhost` fails.
- **Root cause:** `systemctl status nginx` shows **inactive**: Nginx isn't running.
- **Issue:** nothing listens on port 80, so availability drops to 0.
- **Fix:** `sudo systemctl start nginx`, then check `status` and `curl -I` → `200 OK`.
- **Practice it:** `sudo systemctl stop nginx`.

### Incident 2 — 404 Not Found

- **Problem:** `/menu` doesn't work. `curl -i http://localhost/menu` → **404**.
- **Root cause:** the file or route `/menu` doesn't exist.
- **Issue:** the server **is up**; only that one page is missing.
- **Fix:** `ls -la /var/www/html`, add the page or fix the route or `location`.
- **Lesson:** a 404 doesn't mean the server is down.

### Incident 3 — 403 Forbidden

- **Problem:** the server is reachable, but access is refused.
- **Root cause:** wrong file/directory permissions, an Nginx `deny` rule, or no index file plus directory listing off.
- **Issue:** the server understood the request but **refuses** it.
- **Fix:** `ls -ld /var/www/html`, `sudo nginx -t`, `sudo tail -50 /var/log/nginx/error.log` (shows `Permission denied` or `forbidden`). Fix it, then test again.
- **Practice it:** `sudo chmod 000 /var/www/html/index.html`. Undo with `chmod 644`.

### Incident 4 — 502 Bad Gateway (most important)

```
User → Nginx ✅ → App :8080 ❌
```

- **Problem:** the customer gets a 502.
- **Root cause:** the upstream app is **down, unreachable, or on the wrong port**.
- **Issue:** Nginx is healthy; the break is **between Nginx and the app**.
- **Fix:** `sudo ss -lntp` (is 8080 listening?), error.log (`connect() failed (111: Connection refused)`), `systemctl status <app>`. Start or fix the app and test again.
- **Remember:** **502 = the gateway is alive, the upstream has a problem.**
- Full RoboShop version: [devops-notes debugging guide](https://github.com/Abhignadumpala/devops-notes/blob/main/roboshop-debugging-guide/README.md).

### Incident 5 — 503 Service Unavailable

- **Problem:** the service can't take requests right now.
- **Root cause:** the app is unavailable or overloaded, maintenance mode, or resources are exhausted (CPU, memory, disk).
- **Issue:** the app can't handle the request **at the moment**.
- **Fix:** `systemctl status nginx`, `top`, `free -m`, `df -h`, `ss -lntp`, then the logs. **Fix the actual cause** instead of restarting everything.

### Incident 6 — 504 Gateway Timeout

- **Problem:** the page loads for a long time, then shows 504.
- **Root cause:** the app or one of its **dependencies** (DB, external API) is too slow.
- **Issue:** Nginx gave up waiting (`proxy_read_timeout`, 60 s by default).
- **Fix:** `top`, `free -m`, `ss -lntp`, error.log (`upstream timed out (110)`). Check app latency, CPU, memory, network, DB and external services.
- **Remember:** **502 = upstream broken · 504 = upstream too slow.**

### Incident 7 — 500 Internal Server Error

- **Problem:** the request reached the server, but the app failed while processing it.
- **Root cause:** an exception, config error, failed dependency, bug, or **recent deployment**.
- **Fix:** **app logs first** (`journalctl -u <app>`), then error.log. Fix or roll back, then test.
- **Tip:** ask "**what changed?**" A fresh deploy is the #1 suspect.

### Incident 8 — High CPU (200 OK but slow)

- **Problem:** "the site works but is very slow".
- **Measure:** `curl -s -o /dev/null -w "HTTP=%{http_code} TIME=%{time_total}\n" http://localhost` → `HTTP=200`, but TIME is high.
- **Root cause:** a process is using too much CPU (`top`, `ps aux --sort=-%cpu | head`).
- **Issue:** availability looks fine, but **latency** and user experience are bad.
- **Fix:** find the process, understand **why** it is hogging CPU, then fix or restart it.
- **Practice it:** run `yes > /dev/null &`, then `kill %1`.
- **Lesson:** **200 OK doesn't mean healthy. Also measure latency.**

### Incident 9 — Disk full

- **Problem:** `df -h` → `/dev/root 100%`.
- **Root cause:** big logs, temp files, app data, old artifacts or core dumps.
- **Issue:** apps can't write logs, temp files, data or PID files → errors, then an outage.
- **Fix:** find what is big: `sudo du -sh /var/log/*`, `sudo du -sh /var/* 2>/dev/null | sort -h | tail`. Clean up **safely**. Empty a log that is still open with `truncate -s 0`, not `rm`: a deleted file still holds its space while a process has it open.
- **Prevent:** log rotation (`logrotate`), retention policies, disk alerts (e.g. > 80%), capacity planning.

### Incident 10 — Nginx config broken

- **Problem:** after someone edits the config, Nginx won't start.
- **Root cause:** a syntax or config error (missing `;`, wrong directive).
- **Fix:** **never restart blindly.** Run `sudo nginx -t` (it shows the file and line), fix it, then `systemctl restart nginx`, `status` and `curl -I`.
- **Golden rule:** **Change → Test → Apply → Verify.**

## 8. Measuring Availability and Latency

**Availability** = % of requests that succeeded. **Latency** = how long one request takes.

```bash
# generate 100 requests
for i in {1..100}; do curl -s http://localhost > /dev/null; done

# count by status code (column 9 of access.log = status)
sudo awk '$9 == 200 {c++} END {print c}' /var/log/nginx/access.log
sudo awk '$9 == 404 {c++} END {print c}' /var/log/nginx/access.log

# latency of one request
curl -s -o /dev/null -w "HTTP=%{http_code} TIME=%{time_total}\n" http://localhost
# HTTP=200 TIME=0.004   → 4 ms
```

**Why `$9`?** An access.log line looks like `IP - - [date] "GET / HTTP/1.1" 200 615 ...`. Split by spaces, the **9th field is the status code**.

Availability = count of 200s ÷ total lines × 100. These two give you **two SLIs: availability and latency**.

## 9. SRE Troubleshooting Flow

**Definition:** a **fixed order of checks** so you don't run random commands during an incident.

![SRE troubleshooting flow](images/flow.png)

```
INCIDENT → Is the service UP?
              ├─ NO  → check Nginx → check logs → root cause
              └─ YES → check latency → check status codes (2xx / 4xx / 5xx)
```

**The 10 questions to ask:**

1. What happened?
2. **What changed?** (deploy, config, traffic)
3. What is the customer impact?
4. Which component failed?
5. What do the logs say?
6. Can I reproduce it?
7. What is the root cause?
8. What is the **safest** fix?
9. Did the fix actually work? (verify)
10. How do we prevent it next time?

## 10. Incident Report

**Definition:** an **incident report** (postmortem) = a written record of what broke, why, how it was fixed and how to prevent it. It's **blameless**: it focuses on the system, not the person.

Not just "Nginx was down". Fill in all 13 parts:

| # | Section | Answer |
|---|---------|--------|
| 1 | Problem | What did the customer experience? |
| 2 | Root cause | What actually caused it? |
| 3 | Issue | Which component was affected? |
| 4 | Fix | What restored the service? |
| 5 | Impact | How many users/requests were affected? |
| 6 | SLI | What did we measure? (e.g. 92% success) |
| 7 | SLO | Was the target met? |
| 8 | SLA | Was the customer promise at risk? |
| 9 | MTTR | How long did recovery take? |
| 10 | MTTF | How long did it run before failing? |
| 11 | RTO | Recovered within the allowed time? |
| 12 | RPO | Was any data lost? |
| 13 | Prevention | What will change so it doesn't repeat? |

**Example (Incident 1):**

```
Problem:     Site not loading, curl → connection refused
Root cause:  Nginx stopped (systemctl status → inactive)
Issue:       Nginx on EC2, port 80 had no listener
Fix:         systemctl start nginx → curl -I → 200 OK
Impact:      All users, 10:00–10:06
SLI:         Availability for the day 99.58% (6 min of 1440 down)
SLO:         99.9% → missed
SLA:         99.5% → still met, but very close (at risk)
MTTR:        6 min
MTTF:        48 h since the last failure
RTO:         15 min → met
RPO:         Static site, no data lost
Prevention:  systemctl enable nginx, uptime alert on port 80
```

## 11. Commands Cheat Sheet

| Area | Commands |
|------|----------|
| Nginx | `systemctl status/start/stop/restart nginx`, `nginx -t` |
| HTTP | `curl -I` (headers), `curl -v` (full conversation), `curl -w "%{http_code} %{time_total}"` |
| Ports | `ss -lntp` (what is listening, and which process) |
| Processes | `ps aux`, `ps aux --sort=-%cpu \| head` |
| CPU | `top`, `uptime` (load average) |
| Memory | `free -m` |
| Disk | `df -h` (per filesystem), `du -sh /var/log/*` (per folder) |
| Logs | `tail -f /var/log/nginx/access.log`, `tail -f /var/log/nginx/error.log` |

**access.log** = every request (who, what, status, size). **error.log** = why something failed (refused, timeout, permission).

## 12. Final Challenge: "Sometimes Working, Sometimes Failing"

**Definition:** an **intermittent failure** = it fails only some of the time, so a single `curl` may look fine.

**Investigate first, don't restart:**

```bash
curl -I http://localhost ; curl -v http://localhost
sudo systemctl status nginx ; sudo nginx -t
sudo ss -lntp ; top ; free -m ; df -h
sudo tail -50 /var/log/nginx/access.log
sudo tail -50 /var/log/nginx/error.log
```

**Tips for intermittent issues:**
- Run curl in a loop and **count codes**: `for i in {1..50}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost; done | sort | uniq -c`.
- Look for a **pattern**: certain times, certain URLs, under load.
- Common causes: one bad backend among several, CPU/memory spikes, the app restarting (crash loop), the disk filling up, rate limiting (429).

**Assignment:** submit a report with all 13 sections plus the HTTP status code, **based on command output and logs, not guesses**.

## 13. Interview Questions and One-Liners

| Q | Short answer |
|---|--------------|
| SLI vs SLO vs SLA? | Measurement vs engineering target vs customer promise |
| Why is the SLO stricter than the SLA? | So we're alerted and fix things before the customer promise breaks |
| MTTR vs MTTF? | Time to fix (lower is better) vs time until it breaks (higher is better) |
| MTTR vs RTO? | What actually happened vs what the business requires |
| 502 vs 504? | 502 = upstream down/refused · 504 = upstream too slow |
| 401 vs 403? | 401 = not authenticated · 403 = authenticated or not, access denied |
| Is a 404 an outage? | No, the server is up; one resource is missing |
| Site returns 200, is it healthy? | Not necessarily: check latency and error rate too |
| Nginx won't start after a change? | `nginx -t` first, fix, then restart and verify |
| Disk is 100%, what now? | `df -h` → `du -sh` → clean safely → logrotate + alerts |
| First question in any incident? | "What changed?" |

**One-liners:**
- "SLI is what we measure, SLO is what we target, SLA is what we promise."
- "502 means the gateway is alive but the upstream isn't."
- "200 OK doesn't always mean healthy: measure latency."
- "Change, test, apply, verify. Never restart blindly."
- "An incident isn't closed until there's a prevention step."
- "Don't guess. Measure, investigate, find evidence, fix, verify, prevent."

## 14. Next Level

Next, add observability so incidents are **alerted** instead of reported by customers:

```
EC2 → Nginx → App → Prometheus → Grafana → Alertmanager → Alert → Troubleshoot → Root cause → Postmortem
```

See my [monitoring notes](../../day-10-12-monitoring/) (Prometheus, Grafana, Alertmanager).
