# Day 35 - Service Mesh with Istio

[← Kubernetes notes](../README.md)

> **In short:** a **service mesh** is a **smart infrastructure layer** that **secures, manages and monitors communication between microservices** in Kubernetes. It puts a **sidecar proxy** (Envoy, for Istio) next to every app container. The proxies handle **mutual TLS** between services, **traffic routing** (canary 90/10, retries, timeouts, circuit breaking), **policies** (who can call whom) and **observability** (metrics, traces), **without changing the app code**. Popular meshes: **Istio**, **Linkerd**, **Consul**. It's powerful but adds complexity, so it's adopted when you have **many** microservices, not by default.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | What a service mesh is and why, the 8 features (route, protect, monitor, proxy, recover, enforce, connect, reliable), data plane vs control plane, sidecar injection, sidecar vs ambient, Istio resources, Gateway API, canary routing, mTLS and certificates, authorization policies, resilience, observability, mesh vs NetworkPolicy vs Ingress, when (not) to use one | What a mesh adds on top of plain Kubernetes, and how Istio does it |
| **Part 2: Lab** | Install Gateway API CRDs + Istio on EKS, sidecar injection, 90/10 canary with VirtualService and with HTTPRoute, strict mTLS, AuthorizationPolicy, fault injection, Kiali | Run Istio yourself and see each feature work |

> **Before this:** [Day 25 - DNS and Network Policy](../day-25-dns-network-policy/README.md) · [Day 28 - Admission controllers and CRDs](../day-28-kustomize-admission-controllers-crds/README.md) (Istio injects sidecars with a mutating webhook and adds CRDs) · [Day 29 - Deployment strategies](../day-29-deployment-strategies/README.md) (canary) · [Day 31 - ServiceAccounts](../day-31-service-accounts/README.md) (mesh identity) · [Day 33 - OpenTelemetry](../day-33-opentelemetry/README.md) · [Day 34 - Certificates](../day-34-certificates-pod-priority/README.md)

## Table of Contents

**Part 1: Concepts**
1. [What is a service mesh?](#1-what-is-a-service-mesh)
2. [Why do we need it? (the problem)](#2-why-do-we-need-it-the-problem)
3. [The 8 things a service mesh does](#3-the-8-things-a-service-mesh-does)
4. [Architecture: data plane and control plane](#4-architecture-data-plane-and-control-plane)
5. [How the sidecar gets into the Pod](#5-how-the-sidecar-gets-into-the-pod)
6. [Istio resources (CRDs) and the Gateway API](#6-istio-resources-crds-and-the-gateway-api)
7. [Traffic management: canary 90/10](#7-traffic-management-canary-9010)
8. [Security: mTLS certificates and policies](#8-security-mtls-certificates-and-policies)
9. [Fault handling: retries, timeouts, circuit breaking](#9-fault-handling-retries-timeouts-circuit-breaking)
10. [Observability](#10-observability)
11. [Popular service meshes](#11-popular-service-meshes)
12. [Service mesh vs NetworkPolicy vs Ingress](#12-service-mesh-vs-networkpolicy-vs-ingress)
13. [A trade-off, not a default](#13-a-trade-off-not-a-default)

**Part 2: Lab**

14. [Lab setup: Gateway API CRDs + Istio](#14-lab-setup-gateway-api-crds--istio)
15. [Lab A: Sidecar injection](#15-lab-a-sidecar-injection)
16. [Lab B: Canary 90/10 with VirtualService](#16-lab-b-canary-9010-with-virtualservice)
17. [Lab C: The same canary with Gateway API HTTPRoute](#17-lab-c-the-same-canary-with-gateway-api-httproute)
18. [Lab D: Strict mTLS](#18-lab-d-strict-mtls)
19. [Lab E: AuthorizationPolicy (who can call whom)](#19-lab-e-authorizationpolicy-who-can-call-whom)
20. [Lab F: Fault injection](#20-lab-f-fault-injection)
21. [Lab G: See the mesh in Kiali](#21-lab-g-see-the-mesh-in-kiali)
22. [Clean up](#22-clean-up)

**Wrap-up**

23. [Troubleshooting](#23-troubleshooting)
24. [What I learned](#24-what-i-learned)
25. [Commands](#25-commands)
26. [Interview Questions](#26-interview-questions)

---

# Part 1: Concepts

## 1. What is a service mesh?

**Definition:** a **service mesh** is a **dedicated infrastructure layer for service-to-service communication**. It **secures, manages and monitors** the traffic between microservices, usually by adding a **sidecar proxy** to every Pod.

**In simple words:**
- It makes sure the connection **between service and service** in microservices is **secure** (encrypted, and both sides are verified).
- It works as a **sidecar container**: a small proxy that sits next to the app container in the same Pod; all traffic goes in and out through it.
- When something goes wrong with the traffic (a Pod fails, a call is slow), it **automatically recovers**: retries, timeouts, sends traffic away from bad Pods.
- It **enforces policies**: which service is allowed to talk to which.
- The most famous service mesh tool is **Istio**.

```
 Without a mesh                              With a mesh (Istio)
 ──────────────                              ───────────────────
 ┌────────┐  plain HTTP  ┌─────────┐         ┌──────────────────┐  mTLS (encrypted,  ┌──────────────────┐
 │frontend│─────────────►│ payment │         │ frontend │ Envoy │══both verified)═══►│ Envoy │ payment  │
 └────────┘              └─────────┘         └──────────────────┘                    └──────────────────┘
 each app must code TLS, retries,              the app talks plain HTTP to its own sidecar;
 metrics, auth itself                          the sidecars do TLS, retries, routing, metrics, policy
```

> **Interview one-liner:** a service mesh is an infrastructure layer, usually sidecar proxies plus a control plane, that handles service-to-service communication: mutual TLS, traffic routing, retries and circuit breaking, access policies and observability, without changing application code. Istio is the most popular one.

---

## 2. Why do we need it? (the problem)

**In simple words:** when **two services want to communicate** securely, they need **TLS certificates**. With 20 microservices, giving each one a certificate, rotating them, adding retries, timeouts, canary routing and metrics **in every app's code** is a lot of work, and every team does it differently.

| Problem in microservices | Without a mesh | With a mesh |
|---|---|---|
| **Encryption between services** | Each app manages its own TLS certificates | **mTLS automatically**; certificates issued and rotated by the mesh |
| **Who can call whom** | NetworkPolicy (IP/port level only) | Policies by **service identity** (ServiceAccount), HTTP method and path |
| **Canary 90/10** | Replica-count tricks (Day 29) | Exact **traffic %**, by header, by user |
| **Retries, timeouts, circuit breaking** | Coded in every app, every language | **Config**, same for all services |
| **Metrics and traces between services** | Each app instrumented separately | Every call measured by the proxy |

> **What it goes beyond:** a mesh does things that **NetworkPolicy** and a plain **Ingress controller** can't: mTLS between services, fine-grained traffic management (canary, retries, circuit breaking) and rich service-to-service observability.

---

## 3. The 8 things a service mesh does

A smart layer that **secures, manages and monitors** communication between microservices:

| Feature | One word | What it means | Istio example |
|---|---|---|---|
| **Traffic management** | **ROUTE** | Decide where each request goes: canary %, by header, mirror traffic | `VirtualService`, `HTTPRoute` |
| **Security** | **PROTECT** | **mTLS** between services: encrypted, and both sides prove identity | `PeerAuthentication` |
| **Observability** | **MONITOR** | Metrics, traces and logs for every service-to-service call | Prometheus, Jaeger, Kiali |
| **Sidecar proxy** | **PROXY** | A proxy (Envoy) next to each app container handles all its traffic | `istio-proxy` container |
| **Fault handling** | **RECOVER** | Retries, timeouts, circuit breaking, remove bad Pods from load balancing | `VirtualService` retries, `DestinationRule` outlier detection |
| **Policy enforcement** | **ENFORCE** | Allow / deny calls between services | `AuthorizationPolicy` |
| **Purpose** | **CONNECT** | Connect services in a standard way, whatever language they're written in | Service discovery + load balancing |
| **Reliability** | **RELIABLE** | The whole system keeps working when one part is slow or failing | All of the above together |

> **Small correction on "it automatically recovers":** the mesh recovers from **failures** (a Pod returns 503, a call is slow, a Pod is dead): it **retries**, **times out**, and **stops sending traffic to bad Pods**. It does **not** fix wrong routing rules: if your VirtualService sends traffic to the wrong place, that's a config bug you fix.

---

## 4. Architecture: data plane and control plane

```
                       CONTROL PLANE (namespace istio-system)
                    ┌─────────────────────────────────────────┐
                    │ istiod                                  │
                    │  • reads Istio CRDs + Services          │
                    │  • pushes config to every Envoy (xDS)   │
                    │  • is the CA: issues + rotates certs    │
                    └──────┬──────────────────────┬───────────┘
                    config │ + certs       config │ + certs
                           ▼                      ▼
 DATA PLANE   ┌────────────────────────┐     ┌────────────────────────┐
 (your Pods)  │ Pod: frontend          │     │ Pod: payment           │
              │ ┌──────────┐ ┌───────┐ │mTLS │ ┌───────┐ ┌──────────┐ │
              │ │ frontend │►│ Envoy │═╪═════╪►│ Envoy │►│ payment  │ │
              │ │  (app)   │ │sidecar│ │     │ │sidecar│ │  (app)   │ │
              │ └──────────┘ └───────┘ │     │ └───────┘ └──────────┘ │
              └────────────────────────┘     └────────────────────────┘
```

| Part | What it is | Job |
|---|---|---|
| **Data plane** | The **Envoy proxies** (sidecars) in every Pod | Carry the real traffic: encrypt, route, retry, measure |
| **Control plane** | **istiod** (one Deployment) | The "brain": turns your YAML rules into Envoy config, and acts as the **certificate authority** |

**How traffic is captured:** an init container (`istio-init`) or the Istio CNI plugin adds **iptables rules** in the Pod, so every packet in and out goes through Envoy. The app doesn't know; it still calls `http://payment`.

**Sidecar vs ambient mode (newer):**

| | **Sidecar mode** (classic) | **Ambient mode** (no sidecars) |
|---|---|---|
| How | Envoy container in every Pod | **ztunnel** DaemonSet per node (mTLS, L4) + optional **waypoint** proxies (L7 routing) |
| Cost | Extra CPU/memory per Pod, Pod restart to add/remove | Less resource use, no app restarts |
| Status | Most used, most docs | Stable since Istio 1.24, growing |

---

## 5. How the sidecar gets into the Pod

**You label the namespace; Istio's mutating admission webhook adds the sidecar** to every new Pod (Day 28):

```bash
kubectl label namespace shop istio-injection=enabled
```

```
 kubectl apply deployment ─► API server ─► MutatingWebhook (istiod) ─► Pod spec + istio-proxy container
                                                                      + istio-init (iptables)
```

| Check | What you see |
|---|---|
| `kubectl get pods` | **`2/2`** READY = app + `istio-proxy` |
| Existing Pods | **Not** changed: restart them (`kubectl rollout restart deployment`) |
| Skip one Pod | Annotation `sidecar.istio.io/inject: "false"` |

---

## 6. Istio resources (CRDs) and the Gateway API

| Resource | Job | Example |
|---|---|---|
| **VirtualService** | **How** to route requests to a host: % split, by header, retries, timeouts, fault injection | 90% stable, 10% canary |
| **DestinationRule** | **What happens at the destination**: define **subsets** (v1, v2), load balancing, circuit breaking, TLS | subset `stable` = label `version: v1` |
| **Gateway** (Istio) | Traffic **entering / leaving** the mesh (edge proxy) | `shop.example.com` on 443 |
| **ServiceEntry** | Add an **external** service to the mesh | `api.stripe.com` |
| **PeerAuthentication** | **mTLS mode** for service-to-service traffic | `STRICT` |
| **AuthorizationPolicy** | **Allow / deny** calls (who, method, path) | only `frontend` may call `payment` |

**The Kubernetes Gateway API** is the **newer, standard** Kubernetes way to define routing (Gateway, **HTTPRoute**, GRPCRoute). Istio supports it for **ingress** and for **mesh traffic** between services, and the Istio project recommends it for new setups.

> ⚠️ **Gateway API CRDs are not installed in Kubernetes (or EKS) by default.** You install them **before or with Istio**:
>
> ```bash
> kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/standard-install.yaml
> ```

| Istio API | Gateway API equivalent |
|---|---|
| `Gateway` (Istio) | `Gateway` (gateway.networking.k8s.io) |
| `VirtualService` | `HTTPRoute` / `GRPCRoute` |
| `DestinationRule` subsets | A separate `Service` per version (`order-api-v1`, `order-api-v2`) |

---

## 7. Traffic management: canary 90/10

**A 90/10 split without touching the Kubernetes Service:**

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: order-api
spec:
  host: order-api                     # the normal Kubernetes Service
  subsets:
  - name: stable
    labels:
      version: v1                     # Pods with label version=v1
  - name: canary
    labels:
      version: v2
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: order-api
spec:
  hosts:
  - order-api
  http:
  - route:
    - destination:
        host: order-api
        subset: stable
      weight: 90                      # 90% to v1
    - destination:
        host: order-api
        subset: canary
      weight: 10                      # 10% to v2
```

| Piece | Meaning |
|---|---|
| `DestinationRule.subsets` | Names groups of Pods by label (`stable` = v1, `canary` = v2) |
| `VirtualService.hosts` | Rules apply to calls to `order-api` |
| `weight: 90 / 10` | **Exact** traffic %, no matter how many replicas each version has |

**Same thing with the Gateway API (HTTPRoute on a Service):**

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-api
spec:
  parentRefs:
  - group: ""
    kind: Service
    name: order-api                   # route calls made to this Service (mesh / GAMMA)
  rules:
  - backendRefs:
    - name: order-api-v1
      port: 80
      weight: 90
    - name: order-api-v2
      port: 80
      weight: 10
```

**Other routing tricks:** route by header (`x-user: tester` → v2), **traffic mirroring** (copy live traffic to v2, ignore its replies), gradual 10 → 25 → 50 → 100 with Argo Rollouts.

> Without a mesh, a 90/10 canary needs 9 v1 Pods + 1 v2 Pod behind one Service. With a mesh, 1 Pod each can get exactly 90/10.

---

## 8. Security: mTLS certificates and policies

**How certificates work in the mesh (no manual certificates):**

```
 ① Pod starts → its Envoy asks istiod for a certificate
 ② istiod (the mesh CA) checks the Pod's ServiceAccount token
 ③ istiod issues a short-lived certificate (24 h) with identity:
       spiffe://cluster.local/ns/shop/sa/frontend
 ④ Envoy rotates it automatically before expiry
 ⑤ frontend Envoy ══ mTLS ══► payment Envoy: both check each other's certificate
```

**In simple words:** when two services want to communicate, they need TLS certificates; the mesh **creates, gives and rotates them automatically**, based on each Pod's **ServiceAccount** (Day 31). Same PKI idea as Day 34, done for your apps.

**mTLS modes (`PeerAuthentication`):**

| Mode | Meaning |
|---|---|
| `PERMISSIVE` (default) | Accept **both** mTLS and plain text (for migration) |
| `STRICT` | **Only mTLS**: Pods without a sidecar can't call in |
| `DISABLE` | No mTLS |

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: shop
spec:
  mtls:
    mode: STRICT
```

**Who can call whom (`AuthorizationPolicy`):** only `frontend` may call `payment`, only `POST /pay`:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: payment-allow-frontend
  namespace: shop
spec:
  selector:
    matchLabels:
      app: payment
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/shop/sa/frontend"]
    to:
    - operation:
        methods: ["POST"]
        paths: ["/pay"]
```

> Once an `ALLOW` policy selects a workload, **anything not allowed is denied** (`403 RBAC: access denied`).

---

## 9. Fault handling: retries, timeouts, circuit breaking

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: payment
spec:
  hosts:
  - payment
  http:
  - route:
    - destination:
        host: payment
    timeout: 5s                       # give up after 5 s
    retries:
      attempts: 3                     # retry up to 3 times
      perTryTimeout: 2s
      retryOn: 5xx,connect-failure,reset
---
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: payment
spec:
  host: payment
  trafficPolicy:
    connectionPool:
      http:
        http1MaxPendingRequests: 50   # circuit breaker: limit waiting requests
    outlierDetection:                 # remove bad Pods from load balancing
      consecutive5xxErrors: 5
      interval: 10s
      baseEjectionTime: 30s
```

| Feature | What it does |
|---|---|
| **Timeout** | Don't wait forever on a slow service |
| **Retries** | A failed call is tried again (on another Pod) |
| **Circuit breaking** | Too many waiting requests → fail fast instead of piling up |
| **Outlier detection** | A Pod with 5 errors in a row is **ejected** for 30 s; traffic goes to healthy Pods |
| **Fault injection** | Add fake delays / errors on purpose to **test** resilience |

> ⚠️ Retries only for **safe** calls (GET, idempotent APIs). Retrying `POST /pay` could **charge a customer twice**.

---

## 10. Observability

Every call passes through Envoy, so the mesh measures **every service-to-service request** without app changes:

| What | Tool |
|---|---|
| Request rate, errors, latency (golden signals) per service pair | **Prometheus** + **Grafana** |
| Distributed traces (Envoy creates spans; apps must forward trace headers) | **Jaeger** / Tempo / OpenTelemetry (Day 33) |
| Live **service graph** with traffic and errors | **Kiali** |
| Access logs | Envoy logs (`kubectl logs <pod> -c istio-proxy`) |

---

## 11. Popular service meshes

| Mesh | Proxy | Notes |
|---|---|---|
| **Istio** | Envoy (sidecar) or ztunnel (ambient) | Most features, most popular, CNCF graduated; most complex |
| **Linkerd** | Own Rust micro-proxy | Simple, light, fast to learn; CNCF graduated |
| **Consul** (HashiCorp) | Envoy | Mesh across Kubernetes **and VMs** |
| **Cilium** | eBPF (+ Envoy) | Mesh features built into the CNI, no sidecars |
| AWS App Mesh | Envoy | **Discontinued (2026)**; on AWS use Istio, or VPC Lattice |

---

## 12. Service mesh vs NetworkPolicy vs Ingress

| | **NetworkPolicy** | **Ingress / Gateway** | **Service mesh** |
|---|---|---|---|
| Traffic | Pod ↔ Pod (L3/L4) | **Outside → inside** (north-south) | **Service ↔ service** (east-west) |
| Rules by | Labels, IPs, ports | Host, path | Service **identity**, method, path, header |
| Encryption | ❌ | TLS at the edge only | ✅ **mTLS everywhere** |
| Canary %, retries, circuit breaking | ❌ | Some (controller-specific) | ✅ |
| Observability | ❌ | Edge only | ✅ Every call |
| Complexity | Low | Low | **High** |

> They work **together**: Ingress/Gateway for traffic coming in, NetworkPolicy as a basic firewall, and the mesh for secure, smart service-to-service traffic.

---

## 13. A trade-off, not a default

**Costs of a mesh:**
- Every request goes through **2 extra proxies** → a little **more latency** (often a few ms).
- **More CPU and memory** (one Envoy per Pod).
- **New things that can fail** (istiod, sidecar config, certificates) and a real **learning curve** for the team.
- Upgrades of the mesh itself need care.

| Use a mesh when | Don't use one (yet) when |
|---|---|
| **Many** microservices; reasoning about service-to-service security and reliability by hand is hard | A **handful** of services |
| Compliance needs **encryption between services** (mTLS) | NetworkPolicy + Ingress already meet the need |
| You need canary %, retries, circuit breaking for many teams in one standard way | The team has no time to run and learn it |

> **Interview one-liner:** a service mesh solves real problems at microservices scale, mTLS, traffic control and observability, but it adds latency, resources and operational complexity, so we adopt it when the number of services makes those problems hard, not as a default for a few services.

---

# Part 2: Lab

We run Istio on EKS and test each feature with a small `order-api` (v1 and v2) and a `client` Pod.

```
 namespace mesh-lab (istio-injection=enabled)

 client (curl + Envoy) ──► Service order-api ──► order-api-v1 (version: v1)  "v1 - stable"
                                              └─► order-api-v2 (version: v2)  "v2 - canary"
 namespace legacy (no sidecar)
 legacy-client (curl only) ──► order-api          (for the mTLS test)
```

## 14. Lab setup: Gateway API CRDs + Istio

**Prereqs:** EKS + `kubectl` on the bastion ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)). Nodes with at least 2 vCPU / 4 GB (t3.medium or bigger).

**Step 1: Install the Gateway API CRDs** (skip if they already exist)

```bash
kubectl get crd gateways.gateway.networking.k8s.io || kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/standard-install.yaml
```

**Step 2: Check them**

```bash
kubectl get crd | grep gateway.networking.k8s.io
```

**Expected:** `gatewayclasses`, `gateways`, `httproutes`, `grpcroutes`, `referencegrants` ✅

**Step 3: Download Istio** (check that this version supports your EKS version on istio.io → Support status; use a newer one if needed)

```bash
cd ~ && curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.27.1 sh -
```

**Step 4: Put `istioctl` on the PATH**

```bash
export PATH=$HOME/istio-1.27.1/bin:$PATH
```

**Step 5: Pre-check the cluster**

```bash
istioctl x precheck
```

**Expected:** `✔ No issues found when checking the cluster. Istio is safe to install or upgrade!` ✅

**Step 6: Install Istio (minimal profile = only istiod, no load balancer, no extra cost)**

```bash
istioctl install --set profile=minimal -y
```

**Expected:** `✔ Istio core installed ✔ Istiod installed ✔ Installation complete` ✅

**Step 7: Check the control plane**

```bash
kubectl get pods -n istio-system
```

**Expected:** `istiod-…  1/1  Running` ✅

**Step 8: See the CRDs Istio added**

```bash
kubectl get crd | grep istio.io
```

**Expected:** `virtualservices`, `destinationrules`, `gateways`, `peerauthentications`, `authorizationpolicies`, `serviceentries`… ✅

---

## 15. Lab A: Sidecar injection

**Step 1: Create the namespaces**

```bash
kubectl create namespace mesh-lab
```

```bash
kubectl create namespace legacy
```

**Step 2: Turn on sidecar injection for mesh-lab only**

```bash
kubectl label namespace mesh-lab istio-injection=enabled
```

**Step 3: Create the file `order-api.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api-v1
  namespace: mesh-lab
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-api
      version: v1
  template:
    metadata:
      labels:
        app: order-api
        version: v1
    spec:
      containers:
      - name: app
        image: hashicorp/http-echo:0.2.3
        args: ["-text=v1 - stable"]
        ports:
        - containerPort: 5678
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-api-v2
  namespace: mesh-lab
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-api
      version: v2
  template:
    metadata:
      labels:
        app: order-api
        version: v2
    spec:
      containers:
      - name: app
        image: hashicorp/http-echo:0.2.3
        args: ["-text=v2 - canary"]
        ports:
        - containerPort: 5678
---
apiVersion: v1
kind: Service
metadata:
  name: order-api
  namespace: mesh-lab
spec:
  selector:
    app: order-api              # both v1 and v2
  ports:
  - name: http                  # Istio uses the port name to know the protocol
    port: 80
    targetPort: 5678
```

**Step 4: Create the file `clients.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: client
  namespace: mesh-lab
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: client
  namespace: mesh-lab
spec:
  replicas: 1
  selector:
    matchLabels:
      app: client
  template:
    metadata:
      labels:
        app: client
    spec:
      serviceAccountName: client          # mesh identity: .../ns/mesh-lab/sa/client
      containers:
      - name: curl
        image: curlimages/curl:8.11.1
        command: ["sleep", "infinity"]
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: legacy-client
  namespace: legacy                       # no injection here → no sidecar
spec:
  replicas: 1
  selector:
    matchLabels:
      app: legacy-client
  template:
    metadata:
      labels:
        app: legacy-client
    spec:
      containers:
      - name: curl
        image: curlimages/curl:8.11.1
        command: ["sleep", "infinity"]
```

**Step 5: Apply both**

```bash
kubectl apply -f order-api.yaml -f clients.yaml
```

**Step 6: Check the READY column**

```bash
kubectl get pods -n mesh-lab
```

**Expected:** every Pod shows **`2/2`** ✅ (app + `istio-proxy` sidecar)

```bash
kubectl get pods -n legacy
```

**Expected:** `legacy-client` shows **`1/1`** ✅ (no injection in this namespace)

**Step 7: See the containers inside one Pod**

```bash
kubectl get pod -n mesh-lab -l app=client -o jsonpath='{.spec.containers[*].name}{"\n"}'
```

**Expected:** `curl istio-proxy` ✅. The webhook added the sidecar; we never wrote it in YAML.

**Step 8: Check every sidecar got its config from istiod**

```bash
istioctl proxy-status
```

**Expected:** each Pod listed with `SYNCED` ✅

**Step 9: Call the service 20 times (no rules yet)**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 20); do curl -s http://order-api; done | sort | uniq -c'
```

**Expected:** about **10 × v1, 10 × v2** ✅ (normal round-robin)

---

## 16. Lab B: Canary 90/10 with VirtualService

**Step 1: Create the file `canary-istio.yaml`**

```yaml
apiVersion: networking.istio.io/v1
kind: DestinationRule
metadata:
  name: order-api
  namespace: mesh-lab
spec:
  host: order-api
  subsets:
  - name: stable
    labels:
      version: v1
  - name: canary
    labels:
      version: v2
---
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: order-api
  namespace: mesh-lab
spec:
  hosts:
  - order-api
  http:
  - route:
    - destination:
        host: order-api
        subset: stable
      weight: 90
    - destination:
        host: order-api
        subset: canary
      weight: 10
```

**Step 2: Apply it**

```bash
kubectl apply -f canary-istio.yaml
```

**Step 3: Send 100 requests**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 100); do curl -s http://order-api; done | sort | uniq -c'
```

**Expected:** about **90 × v1 - stable, 10 × v2 - canary** ✅, with only **1 Pod of each**. The split is done by Envoy, not by replica count.

**Step 4: Promote the canary to 100%** (edit `canary-istio.yaml`: stable `weight: 0`, canary `weight: 100`)

```bash
sed -i 's/weight: 90/weight: 0/; s/weight: 10/weight: 100/' canary-istio.yaml
```

```bash
kubectl apply -f canary-istio.yaml
```

**Step 5: Check**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 20); do curl -s http://order-api; done | sort | uniq -c'
```

**Expected:** **20 × v2 - canary** ✅

**Step 6: Remove the Istio rules** (next lab does the same with the Gateway API)

```bash
kubectl delete -f canary-istio.yaml
```

---

## 17. Lab C: The same canary with Gateway API HTTPRoute

**Step 1: Create the file `canary-gateway-api.yaml`**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: order-api-v1
  namespace: mesh-lab
spec:
  selector:
    app: order-api
    version: v1
  ports:
  - name: http
    port: 80
    targetPort: 5678
---
apiVersion: v1
kind: Service
metadata:
  name: order-api-v2
  namespace: mesh-lab
spec:
  selector:
    app: order-api
    version: v2
  ports:
  - name: http
    port: 80
    targetPort: 5678
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: order-api
  namespace: mesh-lab
spec:
  parentRefs:
  - group: ""
    kind: Service
    name: order-api
    port: 80
  rules:
  - backendRefs:
    - name: order-api-v1
      port: 80
      weight: 90
    - name: order-api-v2
      port: 80
      weight: 10
```

**Step 2: Apply it**

```bash
kubectl apply -f canary-gateway-api.yaml
```

**Step 3: Send 100 requests**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 100); do curl -s http://order-api; done | sort | uniq -c'
```

**Expected:** about **90 / 10** again ✅. Same result with the **standard Kubernetes API** instead of Istio's own CRDs.

**Step 4: Remove it**

```bash
kubectl delete httproute order-api -n mesh-lab
```

---

## 18. Lab D: Strict mTLS

**Step 1: Call order-api from the legacy Pod (no sidecar)**

```bash
kubectl exec -n legacy deploy/legacy-client -- curl -s -m 5 http://order-api.mesh-lab
```

**Expected:** `v1 - stable` or `v2 - canary` ✅. Works because the default mode is **PERMISSIVE** (plain text still allowed).

**Step 2: Create the file `mtls-strict.yaml`**

```yaml
apiVersion: security.istio.io/v1
kind: PeerAuthentication
metadata:
  name: default
  namespace: mesh-lab
spec:
  mtls:
    mode: STRICT
```

**Step 3: Apply it**

```bash
kubectl apply -f mtls-strict.yaml
```

**Step 4: Try again from legacy**

```bash
kubectl exec -n legacy deploy/legacy-client -- curl -s -m 5 http://order-api.mesh-lab
```

**Expected:** fails with **`command terminated with exit code 56`** (connection reset) ✅. Plain text is now refused.

**Step 5: Call from the client in the mesh**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- curl -s http://order-api
```

**Expected:** `v1 - stable` / `v2 - canary` ✅. Its sidecar talks **mTLS** automatically.

**Step 6: See the certificate the mesh gave the client**

```bash
istioctl proxy-config secret deploy/client -n mesh-lab
```

**Expected:** a `default` cert, `VALID CERT: true`, `NOT AFTER` about **24 h** from now, and a `ROOTCA` ✅. Short-lived, issued and rotated by istiod, no manual certificate work.

---

## 19. Lab E: AuthorizationPolicy (who can call whom)

**Step 1: Create a second in-mesh Pod with a different identity**

```bash
kubectl create deployment intruder -n mesh-lab --image=curlimages/curl:8.11.1 -- sleep infinity
```

**Step 2: Create the file `authz.yaml`** (only the `client` ServiceAccount may call order-api, only GET)

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: order-api-allow-client
  namespace: mesh-lab
spec:
  selector:
    matchLabels:
      app: order-api
  action: ALLOW
  rules:
  - from:
    - source:
        principals: ["cluster.local/ns/mesh-lab/sa/client"]
    to:
    - operation:
        methods: ["GET"]
```

**Step 3: Apply it**

```bash
kubectl apply -f authz.yaml
```

**Step 4: Call as client**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- curl -s http://order-api
```

**Expected:** `v1 - stable` / `v2 - canary` ✅

**Step 5: Call as intruder** (wait until it's `2/2`)

```bash
kubectl exec -n mesh-lab deploy/intruder -c curl -- curl -s http://order-api
```

**Expected:** **`RBAC: access denied`** (HTTP 403) ✅. It's in the same namespace, also has mTLS, but its identity (`sa/default`) isn't allowed.

**Step 6: Try a POST as client**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- curl -s -X POST http://order-api
```

**Expected:** `RBAC: access denied` ✅. Only `GET` is allowed.

> A NetworkPolicy can't do this: it only sees IPs and ports, not **who** is calling or the **HTTP method**.

---

## 20. Lab F: Fault injection

Test how the system behaves when a service fails, **on purpose**.

**Step 1: Create the file `fault.yaml`** (50% of calls get a fake 503)

```yaml
apiVersion: networking.istio.io/v1
kind: VirtualService
metadata:
  name: order-api
  namespace: mesh-lab
spec:
  hosts:
  - order-api
  http:
  - fault:
      abort:
        percentage:
          value: 50
        httpStatus: 503
    route:
    - destination:
        host: order-api
```

**Step 2: Apply it**

```bash
kubectl apply -f fault.yaml
```

**Step 3: Send 20 requests and count status codes**

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" http://order-api; done | sort | uniq -c'
```

**Expected:** about **10 × 200, 10 × 503** ✅. The app was never touched; the client's Envoy injected the errors. Real teams use this to check that the **caller** handles failures (retries, fallback, error page).

**Step 4: Remove it**

```bash
kubectl delete -f fault.yaml
```

---

## 21. Lab G: See the mesh in Kiali

**Step 1: Install the Prometheus and Kiali add-ons** (demo versions from the Istio download)

```bash
kubectl apply -f ~/istio-1.27.1/samples/addons/prometheus.yaml -f ~/istio-1.27.1/samples/addons/kiali.yaml
```

**Step 2: Wait until they're ready**

```bash
kubectl rollout status deployment/kiali -n istio-system
```

**Step 3: Make some traffic** (runs for ~2 minutes)

```bash
kubectl exec -n mesh-lab deploy/client -c curl -- sh -c 'for i in $(seq 1 600); do curl -s http://order-api > /dev/null; sleep 0.2; done'
```

**Step 4: On the bastion (new terminal), port-forward Kiali**

```bash
kubectl port-forward svc/kiali 20001:20001 -n istio-system
```

**Step 5: On your laptop, open an SSH tunnel**

```bash
ssh -L 20001:localhost:20001 ec2-user@<bastion-public-ip>
```

**Step 6: Open Kiali in the laptop browser**

```
http://localhost:20001
```

**Step 7: Traffic Graph** → namespace `mesh-lab`

**Expected:** a live graph `client → order-api → v1 / v2`, green edges with request rate, and a 🔒 **lock** on edges = **mTLS** ✅

---

## 22. Clean up

```bash
kubectl delete namespace mesh-lab legacy
```

```bash
kubectl delete -f ~/istio-1.27.1/samples/addons/prometheus.yaml -f ~/istio-1.27.1/samples/addons/kiali.yaml
```

```bash
istioctl uninstall --purge -y
```

```bash
kubectl delete namespace istio-system
```

Keep the Gateway API CRDs (other tools use them), or remove them:

```bash
kubectl delete -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.3.0/standard-install.yaml
```

---

# Wrap-up

## 23. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Pods show `1/1`, no sidecar | Namespace not labelled, or Pods created before the label | `kubectl label ns X istio-injection=enabled` then `kubectl rollout restart deploy -n X` |
| `istioctl install` fails / istiod Pending | Nodes too small, or Kubernetes version not supported by that Istio version | Bigger nodes; pick an Istio version that supports your EKS version |
| Canary split ignored (still 50/50) | VirtualService `hosts` doesn't match, subsets labels wrong, or the **caller** has no sidecar | Check `hosts`, `DestinationRule` labels; routing happens in the **client's** Envoy |
| `no healthy upstream` / 503 | Subset labels match no Pods | `kubectl get pods --show-labels` and fix the DestinationRule |
| Exit code 56 / connection reset after STRICT | Caller has no sidecar | Add it to the mesh, or use `PERMISSIVE` during migration |
| `RBAC: access denied` (403) | An `AuthorizationPolicy` doesn't allow this identity/method | Check `principals` (`cluster.local/ns/<ns>/sa/<sa>`) and `operation` |
| HTTPRoute has no effect | Gateway API CRDs missing, or `parentRefs` wrong | `kubectl get crd httproutes.gateway.networking.k8s.io`; `kubectl describe httproute` status |
| Config looks right but doesn't work | Envoy not synced or config error | `istioctl analyze -n X`, `istioctl proxy-status` |
| App container starts before the sidecar and fails its first calls | Startup order | Mesh config `holdApplicationUntilProxyStarts: true` |

---

## 24. What I learned

**Concepts**
- A **service mesh** secures, manages and monitors **service-to-service** traffic, using a **sidecar proxy** (Envoy) in every Pod.
- 8 features: **route, protect, monitor, proxy, recover, enforce, connect, reliable**.
- **Data plane** = Envoy sidecars; **control plane** = **istiod** (config + certificate authority).
- Sidecars are added by a **mutating webhook** when the namespace has `istio-injection=enabled` → Pods show `2/2`.
- **mTLS:** istiod gives each Pod a short-lived certificate based on its **ServiceAccount**; `STRICT` refuses plain text.
- **AuthorizationPolicy** = who (identity) can call what (method, path).
- **VirtualService + DestinationRule** (Istio) or **HTTPRoute** (Gateway API, CRDs installed separately) for canary %, retries, timeouts.
- Recovers from failures (retries, timeouts, outlier detection); doesn't fix wrong routing config.
- Popular: **Istio**, Linkerd, Consul. A mesh is a **trade-off**: latency, resources, complexity.

**Lab**
- Installed Gateway API CRDs + Istio (minimal), injection, 90/10 canary two ways, STRICT mTLS, AuthorizationPolicy, fault injection, Kiali graph.

## 25. Commands

| Command | What it does |
|---|---|
| `kubectl apply -f .../gateway-api/.../standard-install.yaml` | Install Gateway API CRDs |
| `istioctl x precheck` | Check the cluster before installing |
| `istioctl install --set profile=minimal -y` | Install Istio (istiod only) |
| `kubectl label namespace X istio-injection=enabled` | Turn on sidecar injection |
| `istioctl proxy-status` | Are all sidecars in sync with istiod? |
| `istioctl analyze -n X` | Find config mistakes |
| `istioctl proxy-config secret deploy/X -n NS` | See the Pod's mesh certificate |
| `istioctl proxy-config routes deploy/X -n NS` | See routes the sidecar has |
| `kubectl logs POD -c istio-proxy` | Envoy access logs |
| `istioctl uninstall --purge -y` | Remove Istio |

## 26. Interview Questions

### ⭐ Very Important

**Q1. What is a service mesh?**
A dedicated infrastructure layer that secures, manages and monitors communication between microservices. It usually adds a sidecar proxy to every Pod that handles mutual TLS, traffic routing, retries and circuit breaking, policies and observability, without changing the application code.

**Q2. Why do we use a service mesh? What problems does it solve?**
With many microservices, every service-to-service call needs encryption (TLS certificates), access control, retries, timeouts, canary routing and metrics. Doing that in every app is hard and inconsistent. The mesh does it in one standard way: automatic mTLS, traffic management, fault recovery, policy enforcement and observability.

**Q3. What is a sidecar proxy?**
A proxy container (Envoy in Istio) that runs next to the app container in the same Pod. iptables rules send all the Pod's traffic through it, so it can encrypt, route, retry and measure every call while the app keeps calling plain `http://service`.

**Q4. What is Istio, and what are its main components?**
The most popular service mesh. The data plane is Envoy sidecars (or ztunnel in ambient mode) in the Pods; the control plane is istiod, which converts Istio rules into Envoy config and acts as the certificate authority for mTLS.

**Q5. How does a service mesh secure service-to-service communication?**
istiod issues each Pod a short-lived certificate based on its ServiceAccount identity and rotates it automatically. Sidecars use mutual TLS, so traffic is encrypted and both sides are verified. `PeerAuthentication STRICT` refuses plain text, and `AuthorizationPolicy` controls which identity can call which service.

**Q6. What are the main features of a service mesh?**
Traffic management (route), security with mTLS (protect), observability (monitor), sidecar proxy, fault handling with retries/timeouts/circuit breaking (recover), policy enforcement (enforce), connecting services (connect) and reliability. Popular meshes: Istio, Linkerd, Consul.

**Q7. When should you not use a service mesh?**
For a small number of services where NetworkPolicy and Ingress are enough. A mesh adds latency (two extra proxies per call), CPU and memory per Pod, new failure points and a learning curve, so it's adopted at real microservices scale, not by default.

### Other Questions

**Q8. VirtualService vs DestinationRule?**
VirtualService decides how requests to a host are routed (weights, headers, retries, timeouts, faults). DestinationRule defines what happens at the destination: subsets by label, load balancing, connection pools, outlier detection, TLS.

**Q9. How do you do a 90/10 canary with Istio?**
A DestinationRule with subsets `stable` (version v1) and `canary` (version v2), and a VirtualService routing 90% to stable and 10% to canary. It works with any number of replicas. With the Gateway API, an HTTPRoute on the Service with weighted backendRefs does the same.

**Q10. What is the Gateway API, and why install its CRDs for Istio?**
The newer standard Kubernetes API for traffic routing (Gateway, HTTPRoute, GRPCRoute). Istio supports it for ingress and mesh traffic and recommends it for new setups. Its CRDs aren't included in Kubernetes or EKS by default, so you install them before using it.

**Q11. How does the sidecar get added to Pods?**
Label the namespace `istio-injection=enabled`. Istio's mutating admission webhook adds the `istio-proxy` container (and the init container for iptables) to every new Pod. Existing Pods need a restart.

**Q12. PERMISSIVE vs STRICT mTLS?**
PERMISSIVE accepts both mTLS and plain text, useful while migrating services into the mesh. STRICT accepts only mTLS, so workloads without a sidecar can't connect.

**Q13. What is circuit breaking and outlier detection?**
Circuit breaking limits connections/pending requests so a struggling service fails fast instead of piling up requests. Outlier detection ejects a Pod from load balancing after repeated errors for a period, so traffic goes to healthy Pods.

**Q14. Why be careful with retries?**
Retrying non-idempotent calls like `POST /pay` can repeat the action (double charge). Retries also multiply load on a failing service. Use them for safe calls with limited attempts and timeouts.

**Q15. What is fault injection used for?**
To test resilience on purpose: inject delays or HTTP errors for a percentage of requests and check that callers handle them (timeouts, retries, fallbacks) before a real outage does.

**Q16. Service mesh vs NetworkPolicy vs Ingress?**
Ingress/Gateway handles traffic entering the cluster. NetworkPolicy is an L3/L4 firewall by labels and ports. A service mesh handles service-to-service traffic with identity-based mTLS, L7 policies (method, path), traffic splitting, retries and observability. They're used together.

**Q17. Sidecar mode vs ambient mode?**
Sidecar mode puts Envoy in every Pod. Ambient mode removes sidecars: a per-node ztunnel does mTLS and L4, and optional waypoint proxies do L7 routing, using fewer resources and no Pod restarts.

**Q18. Istio vs Linkerd?**
Istio has the most features (Envoy, ambient mode, rich traffic management) and more complexity. Linkerd uses a light Rust proxy and is simpler and lighter, with fewer advanced features.

**Q19. How do you debug Istio routing problems?**
`istioctl analyze` for config mistakes, `istioctl proxy-status` to check sidecars are synced, `istioctl proxy-config routes/clusters` to see what Envoy actually has, and `kubectl logs <pod> -c istio-proxy` for access logs.

**Source:** [Istio docs](https://istio.io/latest/docs/) · [Istio traffic management](https://istio.io/latest/docs/concepts/traffic-management/) · [Istio security](https://istio.io/latest/docs/concepts/security/) · [Gateway API](https://gateway-api.sigs.k8s.io/) · [Gateway API for mesh (GAMMA)](https://gateway-api.sigs.k8s.io/mesh/) · [Linkerd](https://linkerd.io/)
