# Day 37 - Common Kubernetes Troubleshooting

[← Kubernetes notes](../README.md)

> **In short:** most Kubernetes problems show up as a **Pod status** (`CrashLoopBackOff`, `ImagePullBackOff`, `OOMKilled`, `Pending`, `CreateContainerConfigError`) or as an **HTTP error** at the Ingress or load balancer (`502 Bad Gateway`, `503 Service Unavailable`, `504 Gateway Timeout`). The fix always starts the same way: **`get` → `describe` (Events) → `logs` (`--previous`) → `exec` / `curl` from inside**. When the **API server itself is down**, `kubectl` stops working completely, so you log in to the **control plane node** and use **`crictl`** and **`journalctl`** to talk to the container runtime and the kubelet directly.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | The troubleshooting flow, Pod statuses, exit codes, CrashLoopBackOff (all the cases), ImagePullBackOff, OOMKilled, Pending, CreateContainerConfigError, HTTP status codes, 502 vs 503 vs 504 (wrong selector, wrong targetPort, protocol mismatch), high CPU, node NotReady, API server down + `crictl` | What each error means, why it happens and the exact commands to find the cause |
| **Part 2: Lab** | Break things on purpose on EKS and fix them: CrashLoopBackOff, ImagePullBackOff, OOMKilled, CreateContainerConfigError, Pending, wrong Service selector, wrong targetPort, `crictl` on a worker node | Recognise each error from its symptoms and fix it fast |

> **Before this:** [Day 24 - Probes](../day-24-probes/README.md) · [Day 25 - Services](../day-25-services-types-and-traffic-flow/README.md) · [Day 26 - Scheduling](../day-26-taints-node-affinity-ingress-rules/README.md) · [Day 34 - Static Pods](../day-34-certificates-pod-priority/README.md) (the API server is a static Pod)

## Table of Contents

**Part 1: Concepts**
1. [The troubleshooting flow](#1-the-troubleshooting-flow)
2. [Pod statuses at a glance](#2-pod-statuses-at-a-glance)
3. [Container exit codes](#3-container-exit-codes)
4. [CrashLoopBackOff: in how many cases?](#4-crashloopbackoff-in-how-many-cases)
5. [ImagePullBackOff / ErrImagePull](#5-imagepullbackoff--errimagepull)
6. [OOMKilled (exit code 137)](#6-oomkilled-exit-code-137)
7. [Pending](#7-pending)
8. [CreateContainerConfigError](#8-createcontainerconfigerror)
9. [HTTP status codes you must know](#9-http-status-codes-you-must-know)
10. [502 vs 503 vs 504 at the Ingress](#10-502-vs-503-vs-504-at-the-ingress)
11. [Wrong selector: two different problems](#11-wrong-selector-two-different-problems)
12. [High CPU on a node or Pod](#12-high-cpu-on-a-node-or-pod)
13. [Node NotReady](#13-node-notready)
14. [API server down: kubectl doesn't work](#14-api-server-down-kubectl-doesnt-work)
15. [crictl: work with containers without the API server](#15-crictl-work-with-containers-without-the-api-server)

**Part 2: Lab**

16. [Lab setup](#16-lab-setup)
17. [Lab A: CrashLoopBackOff (missing env var)](#17-lab-a-crashloopbackoff-missing-env-var)
18. [Lab B: ImagePullBackOff (typo in the image)](#18-lab-b-imagepullbackoff-typo-in-the-image)
19. [Lab C: OOMKilled](#19-lab-c-oomkilled)
20. [Lab D: CreateContainerConfigError](#20-lab-d-createcontainerconfigerror)
21. [Lab E: Pending](#21-lab-e-pending)
22. [Lab F: Wrong Service selector (no endpoints)](#22-lab-f-wrong-service-selector-no-endpoints)
23. [Lab G: Wrong targetPort](#23-lab-g-wrong-targetport)
24. [Lab H: crictl on a worker node](#24-lab-h-crictl-on-a-worker-node)
25. [Clean up](#25-clean-up)

**Wrap-up**

26. [Quick fix table](#26-quick-fix-table)
27. [What I learned](#27-what-i-learned)
28. [Commands](#28-commands)
29. [Interview Questions](#29-interview-questions)

---

# Part 1: Concepts

## 1. The troubleshooting flow

**Definition:** **troubleshooting** = finding **where** a request or a Pod fails and **why**, by checking each layer in order instead of guessing.

```
 1. kubectl get pods -o wide            → What is the STATUS? Which node? How many RESTARTS?
 2. kubectl describe pod <pod>          → Read the EVENTS at the bottom (the reason is usually here)
 3. kubectl logs <pod> --previous       → What did the app print before it died?
 4. kubectl get events --sort-by=.lastTimestamp   → What happened in the namespace, in order
 5. kubectl exec -it <pod> -- sh        → Look from inside (env, files, curl other services)
 6. kubectl get svc,endpoints           → Is traffic reaching the Pods?
 7. Node level: kubectl describe node / crictl / journalctl -u kubelet
```

| Command | What it answers |
|---|---|
| `kubectl get pods -o wide` | Status, restarts, node, Pod IP |
| `kubectl describe pod X` | **Events**: scheduling, image pull, probe failures, OOM, missing ConfigMap |
| `kubectl logs X` | Current container output |
| `kubectl logs X --previous` | Output of the **crashed** container (most useful for CrashLoopBackOff) |
| `kubectl logs X -c <container>` | Logs of one container in a multi-container Pod |
| `kubectl get events --sort-by=.lastTimestamp` | Timeline of everything in the namespace |
| `kubectl get pod X -o yaml` | The full spec + `status.containerStatuses` (last state, exit code, reason) |

> **Small trap:** `kubectl get pod2` fails with `the server doesn't have a resource type "pod2"`. The syntax is `kubectl get <type> <name>` → `kubectl get pod pod2`.

> **Interview one-liner:** I go get → describe (events) → logs --previous → events → exec, then Service/endpoints, then the node. The reason is almost always in the events or the previous logs.

---

## 2. Pod statuses at a glance

| Status | Meaning | First thing to check |
|---|---|---|
| `Pending` | Not scheduled to a node yet (or waiting for a volume) | `describe` → `FailedScheduling` |
| `ContainerCreating` | Scheduled; pulling the image / mounting volumes | `describe` events; wait or check image/volume |
| `Running` | At least one container is running | Is it `READY 1/1`? If `0/1`, readiness probe |
| `Completed` | The container finished with exit code 0 | Normal for Jobs |
| `CrashLoopBackOff` | Container keeps **starting and crashing**; kubelet waits longer each time | `logs --previous`, exit code |
| `ErrImagePull` → `ImagePullBackOff` | Image can't be pulled; kubelet retries with a growing wait | `describe` → `Failed to pull image` |
| `OOMKilled` | Container used more memory than its **limit** | `describe` → `Reason: OOMKilled`, exit 137 |
| `CreateContainerConfigError` | Referenced ConfigMap/Secret (or key) doesn't exist | `describe` → `configmap "x" not found` |
| `Init:CrashLoopBackOff` / `Init:Error` | An **init container** is failing | `logs <pod> -c <init-container>` |
| `Terminating` (stuck) | Finalizer or node unreachable | `get pod -o yaml` → finalizers; node status |
| `Evicted` | Node ran out of memory/disk | `describe node` → pressure conditions |

---

## 3. Container exit codes

**Definition:** the **exit code** is the number a process returns when it stops. `0` = success, anything else = failure. Codes **above 128** mean the process was killed by a **signal** (128 + signal number).

| Exit code | Meaning | Typical cause |
|---|---|---|
| `0` | Completed successfully | Command finished (bad for a Deployment: it restarts → CrashLoopBackOff) |
| `1` | General application error | Exception, missing config, can't connect to DB |
| `126` | Command found but **not executable** | Wrong permissions on the script |
| `127` | **Command not found** | Typo in `command:`, binary missing in the image |
| `137` | **SIGKILL** (128 + 9) | **OOMKilled**, or killed after a failed liveness probe / grace period |
| `139` | **SIGSEGV** (128 + 11) | Segmentation fault in the app |
| `143` | **SIGTERM** (128 + 15) | Graceful stop (deploy, scale down, eviction) |

```bash
kubectl get pod <pod> -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
```

> **Interview one-liner:** exit 1 = app error, 127 = command not found, 137 = SIGKILL (usually OOMKilled), 143 = SIGTERM (normal stop).

---

## 4. CrashLoopBackOff: in how many cases?

**Definition:** **CrashLoopBackOff** means the container **starts, crashes, and is restarted again and again**. "BackOff" = the kubelet **waits longer** before each restart: **10s → 20s → 40s → … up to 5 minutes**. The timer resets after the container runs fine for **10 minutes**.

**Important:** CrashLoopBackOff is **not the error itself**, it's a **symptom**. The real reason is in `logs --previous`, the exit code and the events.

```
 start ──► crash ──► wait 10s ──► start ──► crash ──► wait 20s ──► start ──► crash ──► wait 40s … max 5m
                                          RESTARTS keeps going up
```

### The cases (same status, different causes)

| # | Case | How it looks | Fix |
|---|---|---|---|
| 1 | **Application error / bug** | Exit 1, stack trace in `logs --previous` | Fix the code, roll back the image |
| 2 | **Missing or wrong env var / config** | Exit 1, e.g. MariaDB: `Database is uninitialized and password option is not specified. You need to specify one of MARIADB_ROOT_PASSWORD…` | Add the env var (from a Secret) |
| 3 | **Dependency not reachable** (DB, API, DNS) | Logs: `connection refused` / `timeout` / `unknown host`, app exits | Fix the dependency, Service name or NetworkPolicy; add retries / init container |
| 4 | **Wrong command or args** | Exit 127 (`not found`) or 126 (`permission denied`) | Fix `command:` / `args:` |
| 5 | **Process exits immediately** (nothing long-running) | Exit 0, e.g. `busybox` with no command | Give it a long-running process; use a Job for one-off tasks |
| 6 | **OOMKilled** (memory limit too low or a leak) | Exit 137, `Last State: Reason: OOMKilled` | Raise the limit or fix the leak (section 6) |
| 7 | **Liveness probe failing** | Events: `Liveness probe failed`, container killed and restarted | Fix the probe path/port, raise `initialDelaySeconds`, add a startup probe |
| 8 | **Permissions / security context** | `permission denied`, `read-only file system` after setting non-root / readOnlyRootFilesystem | Fix file ownership, mount an `emptyDir` for writable paths |
| 9 | **Missing file / volume content** | `No such file or directory` for a config file | Check the ConfigMap/volume mount path and keys |
| 10 | **Port already in use** (multi-container Pod) | `address already in use` | Containers in a Pod share the network; use different ports |
| 11 | **Wrong CPU architecture** | `exec format error` | Use an image built for the node's arch (amd64 / arm64) |
| 12 | **Init container failing** | `Init:CrashLoopBackOff` | `kubectl logs <pod> -c <init-name>` |

### How to troubleshoot

```bash
kubectl get pods
```

```bash
kubectl describe pod <pod>
```
Look at: `Last State: Terminated`, `Reason`, `Exit Code`, and the **Events**.

```bash
kubectl logs <pod> --previous
```

```bash
kubectl get events --sort-by=.lastTimestamp
```

If the container dies too fast to `exec` into it, override the command to keep it alive and look inside:

```bash
kubectl debug <pod> -it --copy-to=<pod>-debug --container=<container> -- sh
```

> **Interview one-liner:** CrashLoopBackOff is a symptom: the container keeps crashing and the kubelet backs off up to 5 minutes. Common causes are app errors, missing env/config, unreachable dependencies, wrong command, OOMKilled and failing liveness probes. I read `logs --previous`, the exit code and the events.

---

## 5. ImagePullBackOff / ErrImagePull

**Definition:** **ErrImagePull** = the kubelet **failed to pull** the container image. After repeated failures the status becomes **ImagePullBackOff**: the kubelet keeps retrying with a growing wait (up to 5 minutes). The Pod first shows `ContainerCreating`, then `ErrImagePull`, then `ImagePullBackOff`.

### Why we get it

| # | Cause | Event message |
|---|---|---|
| 1 | **Typo in the image name** (`mariad` instead of `mariadb`) | `pull access denied … repository does not exist` |
| 2 | **Tag doesn't exist** (`nginx:1.999`) | `manifest unknown` / `not found` |
| 3 | **Private registry, no credentials** | `pull access denied` / `401 Unauthorized` / `no basic auth credentials` |
| 4 | **ECR: node role can't pull** | `403 Forbidden` / `not authorized to perform ecr:BatchGetImage` |
| 5 | **Docker Hub rate limit** | `429 Too Many Requests` / `toomanyrequests` |
| 6 | **No network to the registry** (private subnet without NAT / VPC endpoint, DNS) | `i/o timeout` / `no such host` |
| 7 | **Wrong architecture** | `no match for platform in manifest` |
| 8 | **`imagePullPolicy: Never`** and the image isn't on the node | `ErrImageNeverPull` |

### How to troubleshoot

```bash
kubectl describe pod <pod>
```
Read the `Failed to pull image "…"` event: it tells you which case it is.

```bash
kubectl get pod <pod> -o jsonpath='{.spec.containers[*].image}'
```

Check the image really exists (from your machine):

```bash
docker pull <image>
```

For a private registry, create a pull secret and use it:

```bash
kubectl create secret docker-registry regcred --docker-server=<registry> --docker-username=<user> --docker-password=<password>
```

```yaml
spec:
  imagePullSecrets:
  - name: regcred
```

For ECR on EKS: the **node IAM role** needs `AmazonEC2ContainerRegistryReadOnly`, and private subnets need a NAT gateway or ECR VPC endpoints.

> **Interview one-liner:** ImagePullBackOff means the kubelet can't pull the image: wrong name or tag, missing registry credentials (imagePullSecrets / node role for ECR), rate limits or no network to the registry. `kubectl describe pod` shows the exact pull error.

---

## 6. OOMKilled (exit code 137)

**Definition:** **OOMKilled** (Out Of Memory Killed) means the container used **more memory than its `limits.memory`**, so the Linux kernel killed it. Kubernetes reports `Reason: OOMKilled`, `Exit Code: 137`, and the Pod usually ends up in **CrashLoopBackOff**.

**Production scenario:** Pods restart again and again, and `describe` shows:

```
Last State:  Terminated
  Reason:    OOMKilled
  Exit Code: 137
```

### Investigation

```bash
kubectl get pods
```

```bash
kubectl describe pod <pod>
```

```bash
kubectl get events --sort-by=.lastTimestamp
```

```bash
kubectl top pod <pod>
```

Check the configured resources:

```bash
kubectl get deployment <app> -o yaml | grep -A6 resources
```

| Cause | Fix |
|---|---|
| Limit too low for normal load | Raise `limits.memory` based on real usage (`kubectl top`, Prometheus) |
| **Memory leak** (usage keeps growing until killed) | Fix the code; restart is only a band-aid |
| JVM / runtime ignores the container limit | Set heap from the limit, e.g. Java `-XX:MaxRAMPercentage=75` |
| Traffic spike | HPA to add Pods, sensible limits |
| Node itself out of memory | Pods get **evicted** (`Evicted`), check `describe node` → `MemoryPressure` |

> **Interview one-liner:** OOMKilled with exit 137 means the container went over its memory limit and the kernel killed it; I check `describe`, `kubectl top` and the limit, then either raise the limit or fix the leak.

---

## 7. Pending

**Definition:** **Pending** = the Pod is accepted but **not running on a node yet**. Usually the **scheduler can't find a node** that fits.

```bash
kubectl describe pod <pod>
```
Look for `FailedScheduling`:

| Event message | Cause | Fix |
|---|---|---|
| `Insufficient cpu` / `Insufficient memory` | Requests bigger than free capacity | Lower requests, add nodes (Cluster Autoscaler / Karpenter) |
| `node(s) had untolerated taint` | Taint without matching toleration | Add the toleration or use another node |
| `didn't match Pod's node affinity/selector` | `nodeSelector` / affinity label not on any node | Fix the label or the selector |
| `pod has unbound immediate PersistentVolumeClaims` | PVC not bound (no StorageClass / EBS CSI driver) | Fix the StorageClass / install the CSI driver |
| `Too many pods` | Node hit its max Pods (on EKS, limited by ENI IPs) | Bigger nodes or prefix delegation |

> **Interview one-liner:** Pending means the scheduler can't place the Pod; `describe` shows FailedScheduling with the reason: not enough CPU/memory, taints, node selectors/affinity, or an unbound PVC.

---

## 8. CreateContainerConfigError

**Definition:** the container **can't be created** because something it references **doesn't exist**: a **ConfigMap**, a **Secret**, or a **key** inside them.

```
Error: configmap "app-config" not found
Error: couldn't find key DB_PASSWORD in Secret default/db-secret
```

| Fix | How |
|---|---|
| Create the missing ConfigMap/Secret | `kubectl create configmap …` / `kubectl create secret …` |
| Fix the name or key | Compare `kubectl get cm,secret` with the Pod spec |
| Make it optional (only if the app can run without it) | `optional: true` in `configMapKeyRef` / `secretKeyRef` |

> **Interview one-liner:** CreateContainerConfigError means a referenced ConfigMap, Secret or key is missing; `describe` names it, and I create it or fix the reference.

---

## 9. HTTP status codes you must know

**Definition:** an **HTTP status code** is the 3-digit number a server returns for every request. **2xx** = success, **3xx** = redirect, **4xx** = **client** problem, **5xx** = **server** problem.

| Code | Name | Meaning | In Kubernetes, usually… |
|---|---|---|---|
| `200` | OK | Request succeeded | Healthy |
| `201` | Created | Resource created (often after a POST) | |
| `204` | No Content | Success, no body returned | |
| `301` | Moved Permanently | Resource has a new URL | HTTP → HTTPS redirect at the Ingress |
| `400` | Bad Request | Invalid request syntax or data | Plain HTTP sent to an HTTPS port |
| `401` | Unauthorized | Missing or invalid **authentication** | No / wrong token or login |
| `403` | Forbidden | Authenticated but **not allowed** | RBAC / IAM / WAF / AuthorizationPolicy |
| `404` | Not Found | Resource doesn't exist | Wrong Ingress `path` / `host`, or app has no such route |
| `429` | Too Many Requests | Rate limit exceeded | Ingress rate limit, Docker Hub pulls |
| `500` | Internal Server Error | Unexpected error **in the app** | Bug, check app logs |
| `502` | **Bad Gateway** | The proxy got an **invalid response** from the backend | Wrong port, **protocol mismatch**, Pod crashing |
| `503` | **Service Unavailable** | **No healthy backend** to send to / overloaded | **Wrong selector → no endpoints**, readiness failing, 0 replicas |
| `504` | **Gateway Timeout** | Backend didn't answer in time | Slow app, security group / NetworkPolicy dropping traffic |

> **Interview one-liner:** 4xx = the client's request is wrong (401 auth, 403 permission, 404 path); 5xx = the server side failed (500 app bug, 502 bad response from backend, 503 no healthy backend, 504 backend too slow).

---

## 10. 502 vs 503 vs 504 at the Ingress

The **Ingress controller** (NGINX, ALB) is a **gateway/proxy**: it receives the user's request and forwards it to a Service → Pod. The 5xx code tells you **where** the forwarding broke.

```
 User ──► Ingress / ALB (gateway) ──► Service ──► Endpoints ──► Pod :targetPort
            │                            │                        │
            │ 503: nobody to send to     │ selector matches       │ 502: connected, but bad / no valid
            │ (no endpoints / not ready) │ no Pods = 0 endpoints  │      response (wrong port, wrong protocol)
            │                            │                        │ 504: no answer in time
```

| Code | Meaning | Common Kubernetes causes |
|---|---|---|
| **502 Bad Gateway** | Proxy reached the backend but got an **invalid response** (or the connection was refused/reset) | **Protocol mismatch** (proxy speaks HTTP, app speaks HTTPS or gRPC), wrong `targetPort`, app crashing mid-request |
| **503 Service Unavailable** | Proxy has **no healthy backend** | **Wrong Service selector** (0 endpoints), **readiness probe failing**, Deployment scaled to 0, all Pods crashing |
| **504 Gateway Timeout** | Backend **didn't reply in time** | Slow app/DB, security group or NetworkPolicy silently dropping packets, proxy timeout too short |

### 502 because of a protocol issue

**Definition:** a **protocol mismatch** is when the gateway and the backend **don't speak the same protocol**. Example: the Ingress sends **plain HTTP** but the Pod only accepts **HTTPS** on 8443 (or expects **gRPC/HTTP2**). The TLS handshake fails, the response is garbage to the proxy → **502 Bad Gateway**.

| Situation | Fix |
|---|---|
| App serves **HTTPS**, NGINX Ingress sends HTTP | Annotation `nginx.ingress.kubernetes.io/backend-protocol: "HTTPS"` |
| App serves **gRPC** | `nginx.ingress.kubernetes.io/backend-protocol: "GRPC"` |
| AWS ALB, target serves HTTPS | `alb.ingress.kubernetes.io/backend-protocol: HTTPS` (and a matching health check) |
| Or: let the app serve plain HTTP inside the cluster and terminate TLS at the Ingress | Usual and simplest setup |

### How to troubleshoot 5xx

```bash
kubectl describe ingress <ingress>
```

```bash
kubectl get svc <svc> -o wide
```

```bash
kubectl get endpoints <svc>
```
**Empty (`<none>`) → 503 cause:** selector doesn't match or Pods aren't Ready.

```bash
kubectl get pods --show-labels
```

Test the Service from inside the cluster (skips the Ingress):

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -sv http://<svc>.<ns>.svc.cluster.local:<port>
```

Test the Pod directly:

```bash
kubectl port-forward pod/<pod> 8080:<containerPort>
```

```bash
kubectl logs -n ingress-nginx deploy/ingress-nginx-controller
```

> **Interview one-liner:** 503 = the Ingress has no healthy endpoints (wrong selector, readiness failing); 502 = it reached the backend but got a bad response (wrong port or protocol mismatch like HTTP to an HTTPS backend); 504 = the backend didn't answer in time.

---

## 11. Wrong selector: two different problems

**Definition:** a **selector** is a label query (`app: web`) that one object uses to **find** other objects. A wrong selector breaks the link silently or loudly, depending on where it is.

### Case 1: Deployment selector doesn't match the Pod template labels

```yaml
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: website      # ❌ doesn't match
```

**Result:** the API server **rejects** it:
```
The Deployment "web" is invalid: spec.template.metadata.labels: Invalid value: ... `selector` does not match template `labels`
```
Also: a Deployment's `selector` is **immutable**; to change it you delete and recreate the Deployment.

### Case 2: Service selector doesn't match the Pod labels (the silent one)

```yaml
kind: Service
spec:
  selector:
    app: wbe          # ❌ typo, Pods have app: web
```

**Result:** the Service is created fine, but it has **0 endpoints**. Calls inside the cluster fail (`connection refused` / timeout), and the **Ingress returns 503**.

```bash
kubectl get endpoints web
```

**Expected (broken):** `ENDPOINTS <none>`

```bash
kubectl get pods --show-labels
```

```bash
kubectl describe svc web | grep Selector
```

**Fix:** make the Service selector equal to the Pod labels → endpoints appear → traffic flows.

| Wrong selector in… | What happens |
|---|---|
| Deployment `selector` vs `template.labels` | **Rejected** at create time (loud) |
| **Service** `selector` vs Pod labels | Service has **no endpoints**, traffic fails, Ingress **503** (silent) |
| NetworkPolicy `podSelector` | Policy applies to the wrong Pods (traffic blocked or allowed unexpectedly) |
| HPA `scaleTargetRef` name wrong | HPA shows `<unknown>`, never scales |

> **Interview one-liner:** a wrong Deployment selector is rejected by the API server, but a wrong Service selector is silent: the Service gets zero endpoints and the Ingress returns 503. I check `kubectl get endpoints` and compare with `--show-labels`.

---

## 12. High CPU on a node or Pod

**Production scenario:** the app becomes slow, alerts fire for high CPU.

On the **node** (SSH / SSM):

```bash
uptime
```

```bash
top
```

```bash
ps aux --sort=-%cpu | head -20
```

```bash
pidstat -u 1 10
```

Check load:

```bash
cat /proc/loadavg
```

**Load average** = how many processes want the CPU. If it's higher than the number of CPU cores (`nproc`), the node is overloaded.

In **Kubernetes:**

```bash
kubectl top nodes
```

```bash
kubectl top pods -A --sort-by=cpu
```

**Investigation:** correlate the CPU spike with a deploy, a traffic spike, a cron job or a stuck loop. Then: set CPU **requests/limits**, add an **HPA**, fix the code, or add nodes. CPU over the limit is **throttled** (slow), not killed; memory over the limit is **killed** (OOMKilled).

> **Interview one-liner:** for high CPU I check `kubectl top` for the Pod and `top` / `ps --sort=-%cpu` / load average on the node, correlate with deploys or traffic, then tune requests/limits, scale with HPA or fix the code. CPU over the limit is throttled, memory over the limit is killed.

---

## 13. Node NotReady

**Definition:** a node is **NotReady** when its **kubelet stops reporting** to the API server (or reports a problem). After a few minutes, its Pods are moved to other nodes.

```bash
kubectl get nodes
```

```bash
kubectl describe node <node>
```
Check **Conditions**: `MemoryPressure`, `DiskPressure`, `PIDPressure`, `Ready`.

On the node:

```bash
sudo systemctl status kubelet
```

```bash
sudo journalctl -u kubelet -n 100 --no-pager
```

```bash
df -h
```

| Cause | Fix |
|---|---|
| kubelet stopped / crashed | `sudo systemctl restart kubelet`, read `journalctl` |
| Disk full (images, logs) | Clean images (`crictl rmi --prune`), increase disk |
| Container runtime down | `sudo systemctl status containerd` |
| Network / CNI problem (`aws-node` on EKS) | `kubectl get pods -n kube-system`, check CNI Pod logs |
| Kubelet client certificate expired (kubeadm) | Renew certificates |

> **Interview one-liner:** for a NotReady node I check its Conditions with `describe node`, then on the node `systemctl status kubelet`, `journalctl -u kubelet`, `df -h` and the container runtime.

---

## 14. API server down: kubectl doesn't work

**Scenario (interview favourite):** you work with a **self-managed, production-grade cluster** (kubeadm). Suddenly the **Kubernetes API server is down** and every `kubectl` command fails:

```
$ kubectl get po
The connection to the server 172.30.1.2:6443 was refused - did you specify the right host or port?
```

**Why kubectl stops working:** `kubectl` **only talks to the API server** (port **6443**). It never talks to nodes or containers directly. No API server = no `kubectl`. But your Pods **keep running**: the kubelet and the container runtime on each node don't need the API server to keep existing containers alive.

```
 kubectl ──X──► kube-apiserver :6443 (down)
                      │
 control plane node:  kubelet ──► containerd ──► static Pods: kube-apiserver, etcd, scheduler, controller-manager
                      (still running, so we debug HERE with crictl + journalctl)
```

### Step by step fix (kubeadm cluster)

**1. Is it really the server, or my kubeconfig?**

```bash
kubectl config view --minify | grep server
```

```bash
curl -k https://<control-plane-ip>:6443/healthz
```
`connection refused` → nothing listens on 6443 → the API server process is down.

**2. Log in to the control plane node**

```bash
ssh <user>@<control-plane-ip>
```

**3. Is the kubelet running?** (the kubelet starts the API server as a **static Pod**)

```bash
sudo systemctl status kubelet
```

```bash
sudo journalctl -u kubelet -n 100 --no-pager
```

**4. Why doesn't `docker ps` show anything?** Since Kubernetes 1.24 the runtime is **containerd**, not Docker. `docker ps` is empty or not installed. Use **`crictl`**:

```bash
sudo crictl ps -a | grep -E "kube-apiserver|etcd"
```

**5. Read the API server container logs**

```bash
sudo crictl logs <container-id>
```

**6. Fix the cause**

| Cause | How you see it | Fix |
|---|---|---|
| **Broken static Pod manifest** (typo, wrong flag, wrong path) | API server container missing or exiting; kubelet logs show a parse error | Fix `/etc/kubernetes/manifests/kube-apiserver.yaml` (keep a backup **outside** that folder); the kubelet restarts it automatically |
| **etcd down / unhealthy** | API server logs: `connection refused` to `127.0.0.1:2379` | Check the etcd container logs, disk, data dir; restore from snapshot if corrupted |
| **Certificates expired** | Logs: `x509: certificate has expired` | `sudo kubeadm certs check-expiration`, then `sudo kubeadm certs renew all` and restart the control plane Pods |
| **kubelet stopped** | `systemctl status kubelet` inactive | `sudo systemctl restart kubelet` |
| **Disk full / out of memory** | `df -h`, `free -m` | Free space (old images, logs) |
| **Port 6443 blocked** | `ss -tlnp \| grep 6443` shows it listening, but remote clients can't connect | Fix firewall / security group |

**7. Check it's back**

```bash
sudo ss -tlnp | grep 6443
```

```bash
kubectl get nodes
```

### On EKS it's different

On **EKS**, AWS **manages** the control plane, so you can't SSH to it. If `kubectl` fails:

| Error | Likely cause | Check |
|---|---|---|
| `connection refused` / `i/o timeout` | Endpoint is **private** and you're outside the VPC, or a security group blocks 443 | `aws eks describe-cluster --name C --query cluster.resourcesVpcConfig` |
| `You must be logged in to the server (Unauthorized)` | **Authentication**, not a down server: wrong IAM identity / no access entry | `aws sts get-caller-identity`, `aws eks update-kubeconfig --name C` |
| Cluster status not `ACTIVE` | Upgrade or AWS issue | `aws eks describe-cluster --name C --query cluster.status` |

> **Interview one-liner:** kubectl only talks to the API server, so if it's down I SSH to the control plane, check `systemctl status kubelet` and `journalctl -u kubelet`, then use `crictl ps -a` and `crictl logs` on the kube-apiserver and etcd containers. Usual causes: a broken static Pod manifest, etcd down, expired certificates or a full disk.

---

## 15. crictl: work with containers without the API server

**Definition:** **`crictl`** is a command-line tool that talks **directly to the container runtime** (containerd / CRI-O) on a node through the **CRI** (Container Runtime Interface). It works **without the API server**, so it's the tool for debugging a node or a broken control plane.

**In the absence of the Kubernetes API server, if you still want to work with your Pods, use `crictl`** on the node.

| `kubectl` | `crictl` (on the node) | What it does |
|---|---|---|
| `kubectl get pods` | `sudo crictl pods` | List Pod sandboxes on this node |
| `kubectl get pods` (containers) | `sudo crictl ps` / `sudo crictl ps -a` | Running / all containers (including exited) |
| `kubectl logs` | `sudo crictl logs <container-id>` | Container logs |
| `kubectl exec -it` | `sudo crictl exec -it <container-id> sh` | Shell into a container |
| `kubectl describe` | `sudo crictl inspect <container-id>` | Full container details (state, exit code, mounts) |
| — | `sudo crictl images` | Images on this node |
| — | `sudo crictl rmi --prune` | Remove unused images (free disk) |
| — | `sudo crictl stats` | CPU / memory per container |

### docker or crictl? It depends on the container runtime

The tool you use on the node depends on **which container runtime created the Pods' containers**:

| Runtime installed in the backend | Who creates the Pod containers | Use |
|---|---|---|
| **Docker** (older clusters with dockershim before 1.24, or Docker Engine via `cri-dockerd`) | **Docker** | **`docker` commands** (`docker ps`, `docker logs`, `docker exec`), because the Pods are created with Docker |
| **containerd** (default today: EKS, kubeadm, most clusters) | **containerd** | **`crictl`** (`crictl ps`, `crictl logs`, `crictl exec`) |
| **CRI-O** (OpenShift and others) | **CRI-O** | **`crictl`** |

```
 Docker runtime:      kubelet ──► Docker ──► containers   → docker ps shows the Pods ✅
 containerd runtime:  kubelet ──► containerd ──► containers → docker ps shows nothing ❌, crictl ps ✅
```

**Check which runtime your nodes use:**

```bash
kubectl get nodes -o wide
```

Look at the **CONTAINER-RUNTIME** column, for example `containerd://1.7.x` → use `crictl`; `docker://…` → use `docker`.

If the API server is already down, check on the node instead:

```bash
sudo systemctl status containerd
```

```bash
sudo systemctl status docker
```

> `crictl` talks to **any** CRI runtime (containerd, CRI-O, and Docker through `cri-dockerd`), so it's the safe default. `docker` commands only work when Docker is the runtime.

**Good to know:**
- Run it **with `sudo`** on the node; it reads the runtime socket from `/etc/crictl.yaml` (e.g. `runtime-endpoint: unix:///run/containerd/containerd.sock`).
- It sees only containers on **that** node.
- It's for **debugging**, not managing: if you stop a container, the kubelet just recreates it to match the Pod spec.
- `docker` vs `crictl`: Docker isn't the Kubernetes runtime anymore (dockershim removed in 1.24), so `docker ps` doesn't show Kubernetes containers.

> **Interview one-liner:** crictl talks to the container runtime directly over CRI, so on a node I can list Pods and containers, read logs, exec and inspect even when the API server is down; `docker ps` shows nothing because the runtime is containerd.

---

# Part 2: Lab

We break things on purpose in one namespace, read the symptoms and fix them.

```
 namespace debug-lab
 A crash-db        mariadb without password             → CrashLoopBackOff
 B bad-image       image "mariad" (typo)                → ErrImagePull / ImagePullBackOff
 C memory-hog      uses 250Mi, limit 100Mi              → OOMKilled
 D needs-config    ConfigMap that doesn't exist         → CreateContainerConfigError
 E too-big         requests 64 CPUs                     → Pending
 F web + svc       Service selector typo                → 0 endpoints (Ingress would say 503)
 G web + svc       wrong targetPort                     → connection refused (Ingress would say 502)
 H crictl          on a worker node                     → containers without kubectl
```

## 16. Lab setup

**Prereqs:** EKS + `kubectl` on the bastion ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)), Metrics Server for `kubectl top`.

**Step 1: Create the namespace**

```bash
kubectl create namespace debug-lab
```

**Step 2: Make it the default for this lab**

```bash
kubectl config set-context --current --namespace=debug-lab
```

---

## 17. Lab A: CrashLoopBackOff (missing env var)

**Step 1: Run MariaDB without a password**

```bash
kubectl run crash-db --image=mariadb:11.4
```

**Step 2: Watch it**

```bash
kubectl get pod crash-db -w
```

**Expected:** `Running` → `Error` → `CrashLoopBackOff`, `RESTARTS` going up ✅ (Ctrl+C to stop watching)

**Step 3: Read the logs of the crashed container**

```bash
kubectl logs crash-db --previous
```

**Expected:** ✅
```
[ERROR] [Entrypoint]: Database is uninitialized and password option is not specified
        You need to specify one of MARIADB_ROOT_PASSWORD, MARIADB_ROOT_PASSWORD_HASH, MARIADB_ALLOW_EMPTY_ROOT_PASSWORD and MARIADB_RANDOM_ROOT_PASSWORD
```

**Step 4: See the exit code**

```bash
kubectl describe pod crash-db | grep -A4 "Last State"
```

**Expected:** `Reason: Error`, `Exit Code: 1` ✅ (app error, case 2)

**Step 5: Fix: delete and run again with the env var** (lab value only)

```bash
kubectl delete pod crash-db
```

```bash
kubectl run crash-db --image=mariadb:11.4 --env=MARIADB_RANDOM_ROOT_PASSWORD=1
```

**Step 6: Check**

```bash
kubectl get pod crash-db
```

**Expected:** `Running`, `RESTARTS 0` ✅

---

## 18. Lab B: ImagePullBackOff (typo in the image)

**Step 1: Run an image with a typo**

```bash
kubectl run bad-image --image=mariad
```

**Step 2: Watch it**

```bash
kubectl get pod bad-image -w
```

**Expected:** `ContainerCreating` → `ErrImagePull` → `ImagePullBackOff` ✅

**Step 3: Read the event**

```bash
kubectl describe pod bad-image | tail -8
```

**Expected:** `Failed to pull image "mariad": … pull access denied, repository does not exist or may require authorization` ✅

**Step 4: Try a tag that doesn't exist**

```bash
kubectl run bad-tag --image=nginx:1.999
```

```bash
kubectl describe pod bad-tag | grep -i "failed"
```

**Expected:** `… nginx:1.999: not found` ✅

**Step 5: Fix: point to the correct image**

```bash
kubectl set image pod/bad-image bad-image=mariadb:11.4
```

**Expected:** the Pod pulls `mariadb:11.4` (it will then CrashLoop for the missing password, like Lab A: a new problem, a new cause) ✅

---

## 19. Lab C: OOMKilled

**Step 1: Write a Pod that uses more memory than its limit**

```bash
cat > memory-hog.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: memory-hog
spec:
  containers:
  - name: stress
    image: polinux/stress
    command: ["stress"]
    args: ["--vm", "1", "--vm-bytes", "250M", "--vm-hang", "1"]
    resources:
      requests:
        memory: "50Mi"
      limits:
        memory: "100Mi"
EOF
```

**Step 2: Apply it**

```bash
kubectl apply -f memory-hog.yaml
```

**Step 3: Watch it**

```bash
kubectl get pod memory-hog -w
```

**Expected:** `OOMKilled` → `CrashLoopBackOff` ✅

**Step 4: Confirm the reason and exit code**

```bash
kubectl describe pod memory-hog | grep -A4 "Last State"
```

**Expected:** `Reason: OOMKilled`, `Exit Code: 137` ✅

**Step 5: Fix: raise the limit above what it uses** (delete, edit, apply)

```bash
kubectl delete pod memory-hog
```

```bash
sed -i 's/memory: "100Mi"/memory: "300Mi"/' memory-hog.yaml && kubectl apply -f memory-hog.yaml
```

**Step 6: Check**

```bash
kubectl get pod memory-hog
```

```bash
kubectl top pod memory-hog
```

**Expected:** `Running`, about `250Mi` memory ✅

---

## 20. Lab D: CreateContainerConfigError

**Step 1: A Pod that reads a ConfigMap that doesn't exist**

```bash
cat > needs-config.yaml <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: needs-config
spec:
  containers:
  - name: app
    image: nginx:1.27
    env:
    - name: LOG_LEVEL
      valueFrom:
        configMapKeyRef:
          name: app-config
          key: LOG_LEVEL
EOF
```

```bash
kubectl apply -f needs-config.yaml
```

**Step 2: Check**

```bash
kubectl get pod needs-config
```

**Expected:** `CreateContainerConfigError` ✅

```bash
kubectl describe pod needs-config | grep -i error
```

**Expected:** `Error: configmap "app-config" not found` ✅

**Step 3: Fix: create it**

```bash
kubectl create configmap app-config --from-literal=LOG_LEVEL=info
```

**Step 4: Check** (the kubelet retries by itself)

```bash
kubectl get pod needs-config
```

**Expected:** `Running` ✅

---

## 21. Lab E: Pending

**Step 1: Ask for more CPU than any node has**

```bash
kubectl run too-big --image=nginx:1.27 --overrides='{"spec":{"containers":[{"name":"too-big","image":"nginx:1.27","resources":{"requests":{"cpu":"64"}}}]}}'
```

**Step 2: Check**

```bash
kubectl get pod too-big
```

**Expected:** `Pending` ✅

```bash
kubectl describe pod too-big | grep -A3 Events
```

**Expected:** `FailedScheduling … 0/2 nodes are available: 2 Insufficient cpu` ✅

**Step 3: Fix: delete it** (in real life: lower the request or add nodes)

```bash
kubectl delete pod too-big
```

---

## 22. Lab F: Wrong Service selector (no endpoints)

**Step 1: Create a Deployment**

```bash
kubectl create deployment web --image=nginx:1.27 --replicas=2
```

**Step 2: Write a Service with a selector typo**

```bash
cat > web-svc.yaml <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: wbe
  ports:
  - port: 80
    targetPort: 80
EOF
```

```bash
kubectl apply -f web-svc.yaml
```

**Step 3: Look at the endpoints**

```bash
kubectl get endpoints web
```

**Expected:** `ENDPOINTS <none>` ✅ the Service matches no Pods

**Step 4: Call it from inside the cluster**

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -s -m 5 http://web
```

**Expected:** fails (`Connection refused` or timeout) ✅. Behind an Ingress this is a **503 Service Unavailable**.

**Step 5: Compare labels and selector**

```bash
kubectl get pods --show-labels
```

```bash
kubectl describe svc web | grep Selector
```

**Expected:** Pods have `app=web`, the Service wants `app=wbe` ✅

**Step 6: Fix the selector**

```bash
sed -i 's/app: wbe/app: web/' web-svc.yaml && kubectl apply -f web-svc.yaml
```

**Step 7: Check again**

```bash
kubectl get endpoints web
```

**Expected:** two Pod IPs `:80` ✅

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -s -m 5 http://web
```

**Expected:** the nginx welcome page HTML ✅

---

## 23. Lab G: Wrong targetPort

**Step 1: Point the Service at a port nginx doesn't listen on**

```bash
sed -i 's/targetPort: 80/targetPort: 8080/' web-svc.yaml && kubectl apply -f web-svc.yaml
```

**Step 2: Endpoints exist, but on the wrong port**

```bash
kubectl get endpoints web
```

**Expected:** `10.x.x.x:8080,10.x.x.x:8080` ✅ (endpoints are there, so it's not a selector problem)

**Step 3: Call it**

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -s -m 5 http://web
```

**Expected:** `Connection refused` ✅. Behind an Ingress this is a **502 Bad Gateway**.

**Step 4: Fix**

```bash
sed -i 's/targetPort: 8080/targetPort: 80/' web-svc.yaml && kubectl apply -f web-svc.yaml
```

```bash
kubectl run tmp --rm -it --image=curlimages/curl --restart=Never -- curl -s -m 5 http://web
```

**Expected:** nginx welcome page ✅

---

## 24. Lab H: crictl on a worker node

On EKS the control plane is managed, so we practice `crictl` on a **worker node**: the same commands you'd use on a kubeadm control plane when the API server is down.

**Step 1: Find the node of a web Pod**

```bash
kubectl get pods -l app=web -o wide
```

**Step 2: Get its instance ID**

```bash
kubectl get node <node-name> -o jsonpath='{.spec.providerID}{"\n"}'
```

**Expected:** `aws:///us-east-1a/i-0abc…` → the instance ID is the `i-…` part ✅

**Step 3: Log in to the node** (SSM Session Manager, or SSH from the bastion if your node group has a key pair)

```bash
aws ssm start-session --target <instance-id>
```

**Step 4: `docker ps` shows nothing useful**

```bash
sudo docker ps
```

**Expected:** `command not found` (or empty) ✅ the runtime is containerd

**Step 5: List Pods and containers with crictl**

```bash
sudo crictl pods --namespace debug-lab
```

```bash
sudo crictl ps --name web
```

**Step 6: Read the logs without kubectl**

```bash
sudo crictl logs <container-id>
```

**Step 7: Inspect it**

```bash
sudo crictl inspect <container-id> | grep -E '"state"|"image"|"exitCode"'
```

**Step 8: Look at the kubelet**

```bash
sudo systemctl status kubelet
```

```bash
sudo journalctl -u kubelet -n 20 --no-pager
```

**Step 9: Leave the node**

```bash
exit
```

---

## 25. Clean up

```bash
kubectl delete namespace debug-lab
```

```bash
kubectl config set-context --current --namespace=default
```

---

# Wrap-up

## 26. Quick fix table

| Symptom | First command | Usual cause |
|---|---|---|
| `CrashLoopBackOff` | `kubectl logs X --previous` | App error, missing env/config, dependency down, OOM, liveness probe |
| `ImagePullBackOff` / `ErrImagePull` | `kubectl describe pod X` | Typo in image/tag, private registry auth, ECR permissions, rate limit, no network |
| `OOMKilled`, exit 137 | `kubectl describe pod X` + `kubectl top pod X` | Memory limit too low or a leak |
| `Pending` | `kubectl describe pod X` | Insufficient CPU/memory, taints, node selector, unbound PVC |
| `CreateContainerConfigError` | `kubectl describe pod X` | Missing ConfigMap / Secret / key |
| `Running` but `0/1` READY | `kubectl describe pod X` | Readiness probe failing |
| Ingress **503** | `kubectl get endpoints <svc>` | Wrong Service selector, Pods not Ready, 0 replicas |
| Ingress **502** | `kubectl get svc -o yaml` + `curl` from a Pod | Wrong targetPort, protocol mismatch (HTTP vs HTTPS/gRPC) |
| Ingress **504** | Ingress/ALB logs | Slow backend, SG / NetworkPolicy dropping traffic |
| Node `NotReady` | `kubectl describe node X` | kubelet down, disk full, runtime down, CNI |
| `connection to the server …:6443 was refused` | SSH to control plane, `crictl ps -a` | API server static Pod broken, etcd down, certificates expired |
| `Unauthorized` from kubectl | `aws sts get-caller-identity` | Wrong identity / kubeconfig, no access entry |

---

## 27. What I learned

**Concepts**
- Always: **get → describe (events) → logs --previous → events → exec**, then Service/endpoints, then the node.
- **CrashLoopBackOff** is a symptom with many causes: app error, missing env (MariaDB password), dependency down, wrong command, exit 0, OOM, liveness probe, permissions, arch. Backoff 10s → 5 min.
- **ImagePullBackOff:** wrong name/tag, private registry auth, ECR permissions, rate limits, no network.
- **OOMKilled = exit 137**, over the memory limit; CPU over the limit is only throttled.
- **Pending** = scheduler can't place it; **CreateContainerConfigError** = missing ConfigMap/Secret.
- **502** = bad response (wrong port, **protocol mismatch**), **503** = no healthy endpoints (**wrong selector**, readiness), **504** = timeout.
- A wrong **Deployment** selector is rejected; a wrong **Service** selector silently gives **0 endpoints**.
- API server down → `kubectl` dead, Pods still run → SSH to control plane → `systemctl status kubelet`, `journalctl`, **`crictl ps -a`**, `crictl logs`, fix manifest / etcd / certificates.
- **Runtime decides the tool:** Docker runtime → `docker` commands work (Pods are created with Docker); **containerd** runtime → `docker ps` is empty, use **crictl**. Check with `kubectl get nodes -o wide` (CONTAINER-RUNTIME).

**Lab**
- Caused and fixed CrashLoopBackOff, ImagePullBackOff, OOMKilled, CreateContainerConfigError, Pending, a selector typo (0 endpoints) and a wrong targetPort; used `crictl` on a worker node.

## 28. Commands

| Command | What it does |
|---|---|
| `kubectl get pods -o wide` | Status, restarts, node, IP |
| `kubectl describe pod X` | Events: the reason for most failures |
| `kubectl logs X --previous` | Logs of the crashed container |
| `kubectl logs X -c <container>` | Logs of one container / init container |
| `kubectl get events --sort-by=.lastTimestamp` | Namespace timeline |
| `kubectl get pod X -o jsonpath='{.status.containerStatuses[0].lastState}'` | Last exit code and reason |
| `kubectl debug X -it --copy-to=X-debug -- sh` | Debug copy of a crashing Pod |
| `kubectl top nodes` / `kubectl top pods -A --sort-by=cpu` | CPU / memory usage |
| `kubectl get endpoints <svc>` | Does the Service have Pods behind it? |
| `kubectl get pods --show-labels` | Compare labels with selectors |
| `kubectl port-forward pod/X 8080:80` | Test a Pod directly |
| `kubectl describe node X` | Node conditions (pressure, Ready) |
| `sudo systemctl status kubelet` / `sudo journalctl -u kubelet` | kubelet health and logs on a node |
| `sudo crictl ps -a` / `crictl pods` / `crictl logs` / `crictl inspect` | Containers on a node without the API server |
| `sudo kubeadm certs check-expiration` | Control plane certificate expiry (kubeadm) |
| `ps aux --sort=-%cpu \| head -20` / `cat /proc/loadavg` | Top CPU processes / load on a node |

## 29. Interview Questions

### ⭐ Very Important

**Q1. What is CrashLoopBackOff, and in how many cases do we get it?**
The container keeps starting and crashing, and the kubelet waits longer before each restart (10s, 20s, 40s… up to 5 minutes). It's a symptom, not the cause. Common cases: application error (exit 1), missing or wrong env var/config (e.g. MariaDB without a root password), dependency like a DB not reachable, wrong command (exit 127/126), the process exits immediately (exit 0), OOMKilled (exit 137), a failing liveness probe, permission/read-only filesystem errors, a missing config file, port conflicts in a multi-container Pod, wrong CPU architecture, and failing init containers.

**Q2. How do you troubleshoot CrashLoopBackOff?**
`kubectl describe pod` for Last State, reason, exit code and events; `kubectl logs <pod> --previous` for the crashed container's output; `kubectl get events --sort-by=.lastTimestamp`. If it crashes too fast, `kubectl debug --copy-to` with a shell. Then fix the cause: env/config, command, memory limit, probe or the code.

**Q3. What is ImagePullBackOff, why do we get it, and how do you troubleshoot it?**
The kubelet can't pull the image and keeps retrying with backoff. Causes: typo in image name or tag, private registry without imagePullSecrets, the node role can't pull from ECR, Docker Hub rate limit (429), no network/NAT to the registry, wrong architecture. `kubectl describe pod` shows the exact `Failed to pull image` error; then fix the name/tag, add credentials or permissions, or fix networking.

**Q4. You get 502 / 503 at the Ingress. What's the difference and how do you find the cause?**
503 Service Unavailable means the Ingress has no healthy backend: usually a wrong Service selector (0 endpoints), readiness probes failing or 0 replicas. 502 Bad Gateway means it reached the backend but got an invalid response: wrong targetPort or a protocol mismatch, e.g. the Ingress sends HTTP but the app serves HTTPS or gRPC (fix with the backend-protocol annotation). I check `kubectl get endpoints`, `--show-labels`, the Service ports, and curl the Service from a Pod inside the cluster.

**Q5. What happens if you pass a wrong selector?**
In a Deployment, a selector that doesn't match the template labels is rejected by the API server. In a Service, it's accepted but silently matches no Pods, so the Service has zero endpoints, in-cluster calls fail and the Ingress returns 503. Fix: make the selector equal to the Pod labels, verify with `kubectl get endpoints`.

**Q6. In a production-grade self-managed cluster the API server is down and kubectl doesn't work. How do you fix it?**
kubectl only talks to the API server, but Pods keep running. I SSH to the control plane node, check `systemctl status kubelet` and `journalctl -u kubelet`, then `crictl ps -a` to find the kube-apiserver and etcd containers and `crictl logs` to read why they fail. Common causes: a broken static Pod manifest in `/etc/kubernetes/manifests`, etcd down, expired certificates (`kubeadm certs check-expiration` / `renew`), or a full disk. After fixing, the kubelet restarts the API server and I confirm port 6443 and `kubectl get nodes`.

**Q7. What is crictl and when do you use it?**
A CLI that talks directly to the container runtime (containerd/CRI-O) through CRI. In the absence of the API server, if you still want to work with your Pods, you use crictl on the node: `crictl pods`, `crictl ps -a`, `crictl logs`, `crictl exec`, `crictl inspect`. Which tool works depends on the runtime: if Docker is the runtime, the Pods are created with Docker, so `docker` commands work; if containerd (the default today) is the runtime, `docker ps` shows nothing and you use crictl. `kubectl get nodes -o wide` shows the runtime in the CONTAINER-RUNTIME column.

### Other Questions

**Q8. What is OOMKilled and exit code 137?**
The container went over its memory limit and the kernel killed it with SIGKILL (128 + 9 = 137). Check `describe`, `kubectl top`, the limits; raise the limit or fix the memory leak.

**Q9. A Pod is Pending. What do you check?**
`kubectl describe pod` for FailedScheduling: insufficient CPU/memory, untolerated taints, nodeSelector/affinity not matching, unbound PVC, or the node's max Pods. Fix requests, tolerations, labels, storage, or add nodes.

**Q10. What is CreateContainerConfigError?**
A ConfigMap, Secret or key referenced by the Pod doesn't exist. `describe` names it; create it or fix the reference.

**Q11. The Pod is Running but READY 0/1. Why?**
The readiness probe is failing, so the Pod isn't added to the Service endpoints. Check the probe path/port in `describe`, and the app logs.

**Q12. Exit code 0 but CrashLoopBackOff, how?**
The main process finished successfully, but a Deployment's restartPolicy is Always, so it's restarted again and again. Use a long-running process, or a Job for one-time tasks.

**Q13. CPU over the limit vs memory over the limit?**
CPU over the limit is throttled (the app gets slower); memory over the limit is killed (OOMKilled). That's why memory limits need more care.

**Q14. How do you troubleshoot high CPU?**
`kubectl top pods -A --sort-by=cpu` and `kubectl top nodes`; on the node `uptime`, `top`, `ps aux --sort=-%cpu`, `pidstat`, `/proc/loadavg`. Correlate with deploys or traffic, then tune requests/limits, scale with HPA or fix the code.

**Q15. A node is NotReady. What do you check?**
`kubectl describe node` conditions (memory/disk/PID pressure), then on the node `systemctl status kubelet`, `journalctl -u kubelet`, `df -h`, the container runtime and the CNI Pods.

**Q16. kubectl says `Unauthorized` on EKS. Is the API server down?**
No, that's authentication. The server answered. Check `aws sts get-caller-identity`, refresh the kubeconfig with `aws eks update-kubeconfig`, and make sure the IAM identity has an access entry.

**Q17. 401 vs 403?**
401 Unauthorized = not authenticated (no or invalid credentials). 403 Forbidden = authenticated but not allowed (RBAC, IAM, WAF).
