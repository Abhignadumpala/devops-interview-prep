# Day 24 — Kubernetes Probes: Liveness and Readiness

[← Kubernetes notes](../README.md)

> **In short:** A container can be "running" but still broken (stuck, frozen, not ready). **Probes** let Kubernetes check the app by itself. **Liveness** = is it alive? If not, **restart** it. **Readiness** = is it ready for users? If not, **stop sending traffic** to it.

## Table of Contents

1. [What is a probe?](#1-what-is-a-probe)
2. [Liveness probe](#2-liveness-probe)
3. [Readiness probe](#3-readiness-probe)
4. [Liveness vs Readiness](#4-liveness-vs-readiness)
5. [How a probe checks the app (3 ways)](#5-how-a-probe-checks-the-app-3-ways)
6. [Probe timing settings](#6-probe-timing-settings)
7. [Example YAML](#7-example-yaml)
8. [Lab: liveness probe with httpGet (nginx)](#8-lab-liveness-probe-with-httpget-nginx)
9. [Commands](#9-commands)
10. [Interview Questions](#10-interview-questions)

---

## 1. What is a probe?

**Definition:** A **probe** is a **health check** that the **kubelet** (on the worker node) runs on a container **again and again, every few seconds** (interval you set).

**Why?** Kubernetes already restarts a container when its process **crashes**. But if the app is **stuck** (process running, app not responding), Kubernetes can't see the problem without a probe.

| Without probes | With probes |
|---|---|
| App frozen but process alive → K8s thinks it's fine | Liveness sees no response → restarts container |
| App still starting → users get errors | Readiness says "not ready" → no traffic yet |

| Probe | Question it asks | If it fails |
|---|---|---|
| **Liveness** | Is the app **alive**? | **Restart** the container |
| **Readiness** | Is the app **ready** to take traffic? | **Remove pod from Service** (no traffic), no restart |

---

## 2. Liveness probe

**Definition:** A **liveness probe** checks **if the application is alive (healthy)** every interval of time we set. **If it gets no response, Kubernetes restarts the container.**

**How it works, step by step:**

1. App is running in the container.
2. Every `periodSeconds` (e.g. 10s), the kubelet sends the liveness check (e.g. `GET /health`).
3. **Response OK** → "yes, healthy" → **keep running**.
4. **No response / error** (for `failureThreshold` times in a row, e.g. 3) → "not healthy" → **restart the container**.

```
 Application running
        │
        ▼
 Liveness probe check  (every N seconds)
        │
        ▼
     Healthy?
     │      │
    YES     NO
     │      │
     ▼      ▼
 Keep     Restart
 running  container
```

![Liveness probe (class slide)](images/liveness-probe-class.png)

**Key points:**

| ✅ | |
|---|---|
| Checks application health | Every interval we set |
| Detects stuck applications | Process alive but app frozen (deadlock, hang) |
| Automatically restarts container | No human needed |
| Self-healing feature of Kubernetes | App fixes itself |

> ⭐ **Liveness probe = self-healing for your application.**

> **Interview one-liner:** A liveness probe checks if the application is alive; if not, Kubernetes restarts the container.

---

## 3. Readiness probe

**Definition:** A **readiness probe** checks **if the application is ready to receive traffic**. If not ready, Kubernetes **stops sending traffic** to that pod (removes it from the Service endpoints). It does **not** restart the container.

**When is an app "not ready"?**
- Still starting up (loading config, cache, connecting to DB).
- Temporarily busy or its DB is down.

**How it works, step by step:**

1. Pod starts → **not ready** → Service sends it **no traffic**.
2. Kubelet runs the readiness check every `periodSeconds`.
3. **Response OK** → pod marked **Ready** → Service sends traffic.
4. **Fails later** → pod marked **Not Ready** → traffic stops. When it passes again → traffic comes back.

```
 User ──► Service ──┬──► Pod 1 (Ready ✅)      gets traffic
                    ├──► Pod 2 (Ready ✅)      gets traffic
                    └──✖ Pod 3 (Not Ready ❌)  no traffic, NOT restarted
```

> **Interview one-liner:** A readiness probe checks if the app is ready to serve traffic; if not, Kubernetes removes the pod from the Service so users don't hit it, without restarting it.

---

## 4. Liveness vs Readiness

| | Liveness | Readiness |
|---|---|---|
| Question | Is the app **alive**? | Is the app **ready** for traffic? |
| On failure | **Restarts** container | **Stops traffic** to pod |
| Restart? | ✅ Yes | ❌ No |
| Fixes | Stuck / frozen app | Slow startup, temporary busy |
| Simple word | **Self-healing** | **Traffic control** |

> Use **both** together: readiness keeps users away from a pod that isn't ready; liveness restarts it if it's truly stuck.

> **Bonus — startup probe:** For **slow-starting apps**. Liveness and readiness wait until the startup probe passes, so a slow app isn't restarted while still booting.

---

## 5. How a probe checks the app (3 ways)

> ⭐ **One-liner:** There are **three ways to check if your app is alive: HTTP, TCP, EXEC.**
> **HTTP = endpoint | TCP = port | EXEC = command**

![Liveness probe types (class slide)](images/liveness-probe-types-class.png)

| # | Type | Checks | Healthy if | Use for |
|---|---|---|---|---|
| 1 | **HTTP** (`httpGet`) | A **web endpoint** like `/health` | Response code **200–399** | Web apps, APIs |
| 2 | **TCP** (`tcpSocket`) | Whether a **port** is accepting connections | Port **opens** | Databases (MySQL 3306), Redis 6379 |
| 3 | **EXEC** (`exec`) | Runs a **command inside the container** | Command **exit code 0** | Apps without HTTP/port, custom checks |

### 1. HTTP probe = endpoint

The kubelet calls a URL of the app, like a browser: `GET http://<pod-ip>:8080/health`.
- Answer `200 OK` → alive ✅
- Error (500), no answer, timeout → failed ❌ → restart

```yaml
livenessProbe:
  httpGet:
    path: /health      # the endpoint
    port: 8080
  periodSeconds: 10
```

### 2. TCP probe = port

The kubelet only tries to **connect to the port**. It doesn't send a request or read a reply.
- Port accepts the connection → alive ✅
- Connection refused → failed ❌ → restart

```yaml
livenessProbe:
  tcpSocket:
    port: 3306         # the port (MySQL)
  periodSeconds: 10
```

### 3. EXEC probe = command

The kubelet **runs a command inside the container** and checks its result (exit code).
- Exit code `0` → alive ✅
- Any other exit code → failed ❌ → restart

```yaml
livenessProbe:
  exec:
    command: ["cat", "/tmp/healthy"]   # the command
  periodSeconds: 10
```

**Which one to choose?**

| My app is... | Use |
|---|---|
| A website / API with a `/health` URL | **HTTP** |
| A DB or service that only listens on a port | **TCP** |
| Something that needs a custom check (script, file) | **EXEC** |

> The same 3 types work for **readiness** and **startup** probes too; only the action on failure is different.

---

## 6. Probe timing settings

| Setting | Meaning | Default |
|---|---|---|
| `initialDelaySeconds` | Wait this long after container starts before 1st check | 0 |
| `periodSeconds` | **Interval**: check every N seconds | 10 |
| `timeoutSeconds` | Wait this long for a response | 1 |
| `failureThreshold` | Fail this many times in a row → action (restart / not ready) | 3 |
| `successThreshold` | Pass this many times → healthy again | 1 |

Example: `periodSeconds: 10` + `failureThreshold: 3` → app must fail for **~30 seconds** before restart.

---

## 7. Example YAML

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-probes
spec:
  replicas: 2
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80

          livenessProbe:              # alive? if not → RESTART
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 10   # wait 10s after start
            periodSeconds: 10         # check every 10s
            failureThreshold: 3       # 3 fails → restart

          readinessProbe:             # ready? if not → NO TRAFFIC
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
```

**Liveness with `exec` (classic demo):**

```yaml
          livenessProbe:
            exec:
              command: ["cat", "/tmp/healthy"]   # file exists → healthy
            initialDelaySeconds: 5
            periodSeconds: 5
```

Delete the file inside the container (`kubectl exec <pod> -- rm /tmp/healthy`) → probe fails → container restarts → `RESTARTS` count goes up.

---

## 8. Lab: liveness probe with httpGet (nginx)

**Goal:** check if the nginx app is alive using a **liveness probe** with the **HTTP (`httpGet`)** method.

![liveness-http YAML (class)](images/liveness-http-yaml-class.png)

### The code: `liveness-http.yaml`

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: liveness-http
spec:
  containers:
  - name: nginx
    image: nginx

    livenessProbe:
      httpGet:
        path: /
        port: 80

      initialDelaySeconds: 15
      periodSeconds: 10
      timeoutSeconds: 2
      failureThreshold: 3
```

### Line by line

| Line | Meaning |
|---|---|
| `kind: Pod`, `name: liveness-http` | Create one pod named `liveness-http` |
| `name: nginx`, `image: nginx` | One container running the nginx web server |
| `livenessProbe:` | Check if the container is **alive**; if not → restart it |
| `httpGet:` | Use the **HTTP** method (call a web endpoint) |
| `path: /` | The **endpoint** to call. `/` = nginx home page |
| `port: 80` | **nginx listens on port 80**, so we check port 80 |
| `initialDelaySeconds: 15` | Wait **15 s** after the container starts before the 1st check (give nginx time to start) |
| `periodSeconds: 10` | Then check **every 10 s** |
| `timeoutSeconds: 2` | Wait max **2 s** for an answer; slower = failed |
| `failureThreshold: 3` | **3 failures in a row** → restart the container |

### What the probe actually does

Every 10 s, the **kubelet** (on the worker node) sends this request to the container:

```
GET http://<pod-ip>:80/
```

| nginx answers | Result |
|---|---|
| **200 OK** (path `/` exists, home page returned) | ✅ Healthy → keep running |
| **404 Not Found** (path doesn't exist), **500** error, or no answer in 2 s | ❌ Failed. 3 times in a row → **restart container** |

> **Path can be anything the app really serves:** `/`, `/dev`, `/health`, `/login`... The rule: the path must return **200–399**. Default nginx serves only `/`, so `path: /health` would get **404** → nginx would be restarted again and again even though it works fine.

> **Port must match the app:** nginx works on **80**. If you put `port: 8080`, nothing listens there → probe fails → restart loop.

### Timeline

```
0s    container starts
15s   1st check  GET /  → 200 ✅
25s   2nd check  GET /  → 200 ✅
35s   ...every 10s, keeps running

If nginx breaks:
 fail 1 ❌ → fail 2 ❌ → fail 3 ❌  (~30 s)  → kubelet RESTARTS the container
```

### Steps (run where kubectl works: Killercoda control plane / EKS bastion)

**Step 1 — create the file and the pod**

```bash
vi liveness-http.yaml          # paste the YAML above
kubectl apply -f liveness-http.yaml
```

**Step 2 — check it's healthy**

```bash
kubectl get pods               # STATUS Running, RESTARTS 0
kubectl describe pod liveness-http
#   Liveness: http-get http://:80/ delay=15s timeout=2s period=10s #success=1 #failure=3
```

**Step 3 — break it (test self-healing)**

Delete nginx's home page, so `/` stops returning 200 (nginx returns **403**):

```bash
kubectl exec liveness-http -- rm /usr/share/nginx/html/index.html
```

**Step 4 — watch Kubernetes restart it**

```bash
kubectl get pods -w            # after ~30 s RESTARTS goes 0 → 1
kubectl describe pod liveness-http
#   Warning  Unhealthy  Liveness probe failed: HTTP probe failed with statuscode: 403
#   Normal   Killing    Container nginx failed liveness probe, will be restarted
```

The restarted container starts fresh from the image, so `index.html` is back → `/` returns 200 → healthy again. **That's self-healing.**

**Step 5 — clean up**

```bash
kubectl delete -f liveness-http.yaml
```

> **Interview one-liner:** I used an `httpGet` liveness probe on nginx: path `/` on port 80, first check after 15 s, then every 10 s with a 2 s timeout. After 3 failures in a row the kubelet restarts the container.

---

## 9. Commands

| Command | Use |
|---|---|
| `kubectl apply -f deploy.yaml` | Create the deployment with probes |
| `kubectl get pods` | `READY 1/1` = readiness passing; `RESTARTS` = liveness restarts |
| `kubectl get pods -w` | Watch status change live |
| `kubectl describe pod <pod>` | Events: `Liveness probe failed`, `Readiness probe failed` |
| `kubectl get endpoints <svc>` | Only **ready** pods are listed |

---

## 10. Interview Questions

### ⭐ Very Important

**Q1. What is a liveness probe?**
It checks if the application is alive at an interval we set. If it gets no response, Kubernetes restarts the container; if it gets a response, the container keeps running. Liveness probe = self-healing for your application.

**Q2. What happens when a liveness probe fails?**
After `failureThreshold` failures in a row, the kubelet restarts the container. The pod's `RESTARTS` count goes up.

**Q3. What are the 3 ways to check if your app is alive (probe types)?**
HTTP checks a web endpoint like `/health` (200–399 = healthy). TCP checks whether a port is accepting connections. EXEC runs a command inside the container and checks the result (exit 0 = healthy). HTTP = endpoint, TCP = port, EXEC = command.

**Q4. Explain the `liveness-http` probe: path `/`, port 80, initialDelaySeconds 15.**
Every 10 s the kubelet sends `GET http://<pod-ip>:80/` to nginx (nginx listens on 80). A 200–399 answer means healthy. The first check waits 15 s so nginx can start. If it fails 3 times in a row (no answer within 2 s, or an error like 404), the container is restarted. The path can be any endpoint the app serves (`/`, `/dev`, `/health`).

### Other Questions

**Q5. What is a readiness probe?**
It checks if the app is ready to receive traffic. If not, the pod is removed from the Service endpoints (no traffic), but it is not restarted.

**Q6. Difference between liveness and readiness probes?**
Liveness failure → container restart (self-healing). Readiness failure → traffic stops to that pod, no restart (traffic control).

**Q7. Why do we need a liveness probe if Kubernetes already restarts crashed containers?**
A crash stops the process, which K8s sees. A stuck app (deadlock, hang) keeps the process alive, so only a liveness probe can detect it.

**Q8. What is a startup probe?**
A probe for slow-starting apps. Liveness and readiness checks wait until it passes, so the app isn't restarted while still booting.

**Q9. What can go wrong with a badly set liveness probe?**
If `initialDelaySeconds` is too short or the timeout too small, a healthy but slow app gets restarted again and again (restart loop / CrashLoopBackOff).

---

**Source:** [Kubernetes docs: Liveness, Readiness and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/) · [Configure probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
