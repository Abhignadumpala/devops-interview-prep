# Day 26 — Kubernetes Scheduling and Ingress Rules: Taints and Tolerations, nodeSelector, Node Affinity, Host and Path Routing

[← Kubernetes notes](../README.md)

> **In short:** Kubernetes decides **which node** each Pod runs on. **nodeSelector** and **node affinity** pull a Pod **towards** nodes with certain labels. **Taints** push all Pods **away** from a node, and a **toleration** lets one chosen Pod in. To give an app its own nodes (for example AI Pods on big GPU nodes), we use **both**. **Ingress rules** then decide which app gets each user request, by **host** (`api.shop.com`) or **path** (`shop.com/api`).

## About this class

Here we learn how to control **where Pods run** and **where user requests go**.

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Scheduling** | Labels, nodeSelector, node affinity, taints and tolerations | What each one is, how they differ, when to use which |
| **Part 2: Ingress rules** | Host rules, path rules, pathType, rewrite, TLS | How an Ingress picks the right app for a request |
| **Part 3: Lab** | 2-node EKS cluster | Place Pods with each tool, then route 2 apps through one ALB |

## Table of Contents

**Part 1: Scheduling (where Pods run)**
1. [How Kubernetes picks a node](#1-how-kubernetes-picks-a-node)
2. [Node labels](#2-node-labels)
3. [nodeSelector](#3-nodeselector)
4. [Node affinity](#4-node-affinity)
5. [Taints and tolerations](#5-taints-and-tolerations)
6. [Dedicated nodes: using them together](#6-dedicated-nodes-using-them-together)
   - [Scenario: AI Pods must run only on the big node](#scenario-ai-pods-must-run-only-on-the-big-node)
7. [Which one to use](#7-which-one-to-use)

**Part 2: Ingress rules (where requests go)**

8. [Ingress rules](#8-ingress-rules)

**Part 3: Lab**

9. [Lab: control Pod placement and route 2 apps on EKS](#9-lab-control-pod-placement-and-route-2-apps-on-eks)

**Wrap-up**

10. [What I learned](#10-what-i-learned)
11. [Commands](#11-commands)
12. [Interview Questions](#12-interview-questions)

---

# Part 1: Scheduling (where Pods run)

## 1. How Kubernetes picks a node

**Definition:** **scheduling** is the step where Kubernetes chooses **which node** a new Pod will run on. The **kube-scheduler** (a control plane component) looks at every node, removes the ones that can't run the Pod (not enough CPU or memory, wrong labels, a taint the Pod doesn't accept), then gives the remaining nodes a score and picks the best one. If no node is left, the Pod stays **Pending**.

```
 New Pod ──► kube-scheduler
               1. Filter: drop nodes that can't run it (CPU / memory, labels, taints)
               2. Score:  rank the nodes that are left
               3. Bind:   the Pod runs on the best node
               (no node left → Pod stays Pending)
```

By default the scheduler can put a Pod on **any** node. That's fine for most apps, but sometimes we need control:

| Need | Example |
|---|---|
| The app needs special hardware | AI / ML Pods need **GPU** or big-memory nodes |
| Expensive nodes should run only one kind of app | Normal web Pods shouldn't fill up the GPU nodes |
| The app must stay in one zone or node type | A Pod that needs a disk in `us-east-1a`, or ARM (Graviton) nodes |

Kubernetes gives us 3 tools for this:

![Where will my Pod run](images/pod-placement.png)

| Tool | Set on | What it does |
|---|---|---|
| **nodeSelector** | Pod | **Pulls** the Pod to nodes with one exact label |
| **Node affinity** | Pod | **Pulls** the Pod to nodes using rules (`In`, `NotIn`, `Exists`…), must or prefer |
| **Taint** (+ toleration on the Pod) | Node | **Pushes away** every Pod that doesn't tolerate it |

> **Interview one-liner:** The kube-scheduler filters out nodes that can't run a Pod and scores the rest; nodeSelector and node affinity pull a Pod towards labelled nodes, while taints push Pods away from a node unless they have a matching toleration.

---

## 2. Node labels

**Definition:** a **label** is a `key=value` tag we put on any Kubernetes object. On a **node**, a label describes what that node is, for example `pods=ai` or `disktype=ssd`. nodeSelector and node affinity both work by matching these node labels, so labelling the nodes is always the first step.

Every node already has some labels from Kubernetes and EKS:

| Label | Example value | Meaning |
|---|---|---|
| `kubernetes.io/hostname` | `ip-10-0-1-23.ec2.internal` | The node's name |
| `kubernetes.io/arch` | `amd64` / `arm64` | CPU type |
| `node.kubernetes.io/instance-type` | `m7i-flex.large` | EC2 instance type |
| `topology.kubernetes.io/zone` | `us-east-1a` | Availability zone |
| `eks.amazonaws.com/nodegroup` | `general` | EKS node group name |

We add our own labels with `kubectl label`:

```bash
kubectl label node <node-name> pods=ai
```

> ⚠️ **Real projects:** a label added with `kubectl` is lost when EKS replaces the node (upgrade, scale-down, crash). So in real projects we set labels (and taints) on the **node group** in Terraform, and every new node gets them automatically ([section 6](#6-dedicated-nodes-using-them-together)).

---

## 3. nodeSelector

**Definition:** **nodeSelector** is a field in the Pod spec that lists node labels. The Pod is scheduled **only** on a node that has **all** of those labels with exactly those values. It is the simplest way to send a Pod to a group of nodes. If no node has the label, the Pod stays **Pending**.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: movies
  labels:
    app: paytm
spec:
  replicas: 5
  selector:
    matchLabels:
      app: paytm
  template:
    metadata:
      labels:
        app: paytm
    spec:
      containers:
      - name: cont1
        image: nginx
      nodeSelector:            # same level as containers
        pods: "ai"             # only nodes labelled pods=ai
```

**Result:** all 5 Pods run on the node(s) labelled `pods=ai`.

| Good | Limits |
|---|---|
| Very simple, one line per label | Only **exact match** (`key = value`). No "this OR that", no "NOT" |
| Easy to read | Only **hard** rules: no label → Pod is Pending. No "prefer" |

> **Interview one-liner:** nodeSelector schedules a Pod only on nodes that have the exact labels listed; it's simple but supports only exact matches and hard rules.

---

## 4. Node affinity

**Definition:** **node affinity** is a more powerful version of nodeSelector. It also matches node labels, but with **rules**: a label can be **one of several values** (`In`), **not** a value (`NotIn`), just **exist** (`Exists`), or be **greater / less than** a number (`Gt`, `Lt`). And each rule can be **required** (the Pod must follow it) or **preferred** (the scheduler tries, but runs the Pod elsewhere if it can't).

### 4.1 The two types

| Type | Meaning | If no node matches |
|---|---|---|
| `requiredDuringSchedulingIgnoredDuringExecution` | **Must** match (a hard rule, like nodeSelector) | Pod stays **Pending** |
| `preferredDuringSchedulingIgnoredDuringExecution` | **Try** to match (a soft rule, with a `weight` 1–100) | Pod runs on **any other node** |

The long names read in two parts:

| Part | Meaning |
|---|---|
| `requiredDuringScheduling` / `preferredDuringScheduling` | The rule is checked **when the Pod is placed** |
| `IgnoredDuringExecution` | If someone **changes the node's labels later**, Pods already running there **stay**. They aren't moved |

### 4.2 Operators

| Operator | Matches nodes where… | Example |
|---|---|---|
| `In` | the label's value is **one of** the list | `pods In [ai, agent]` |
| `NotIn` | the label's value is **none of** the list | `pods NotIn [ai]` (keep off AI nodes) |
| `Exists` | the label is there (any value) | `gpu Exists` |
| `DoesNotExist` | the label isn't there | `spot DoesNotExist` |
| `Gt` / `Lt` | the value is **greater / less than** a number | `cpu-count Gt 8` |

### 4.3 Required example: run on AI or agent nodes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: movies
spec:
  replicas: 4
  selector:
    matchLabels:
      app: paytm
  template:
    metadata:
      labels:
        app: paytm
    spec:
      containers:
      - name: nginx
        image: nginx:latest
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: pods
                operator: In
                values:
                - ai
                - agent
```

**Result:** the 4 Pods run only on nodes labelled `pods=ai` **or** `pods=agent`. nodeSelector can't say "or".

### 4.4 Preferred example: try the big nodes first

```yaml
      affinity:
        nodeAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 80                 # 1–100: higher = stronger wish
            preference:
              matchExpressions:
              - key: pods
                operator: In
                values:
                - ai
```

**Result:** Pods go to a `pods=ai` node if one has room; if not, they still run on another node instead of staying Pending.

> **Interview one-liner:** Node affinity is a flexible nodeSelector: it supports operators like In, NotIn and Exists, and can be required (must match, else Pending) or preferred (try to match, else run anywhere). IgnoredDuringExecution means running Pods aren't moved if node labels change later.

---

## 5. Taints and tolerations

### 5.1 Taint

**Definition:** a **taint** is a mark we put on a **node** that tells the scheduler "**don't put Pods here**". Every Pod is kept off that node, unless the Pod has a matching **toleration**. Labels and affinity attract Pods; a taint does the opposite and **repels** them. A taint has a `key=value` and an **effect**.

```bash
kubectl taint node <node-name> pods=ai:NoSchedule
```

| Part | Value |
|---|---|
| key | `pods` |
| value | `ai` |
| effect | `NoSchedule` |

**The 3 effects:**

| Effect | New Pods without a toleration | Pods already running on the node |
|---|---|---|
| `NoSchedule` | **Not** placed here | Stay |
| `PreferNoSchedule` | Avoided if possible (soft) | Stay |
| `NoExecute` | **Not** placed here | **Evicted** (removed) |

**Remove a taint:** the same command with a **`-` at the end**:

```bash
kubectl taint node <node-name> pods=ai:NoSchedule-
```

### 5.2 Toleration

**Definition:** a **toleration** is a field in the **Pod** spec that says "**I accept this taint**". A Pod with a matching toleration is **allowed** onto the tainted node. It does **not** force the Pod to go there: the Pod can still land on any other node.

```yaml
    spec:
      containers:
      - name: nginx
        image: nginx
      tolerations:
      - key: "pods"
        operator: "Equal"          # key AND value must match the taint
        value: "ai"
        effect: "NoSchedule"
```

| `operator` | Matches when |
|---|---|
| `Equal` (default) | key, value and effect all match the taint |
| `Exists` | the key (and effect) match; any value. No `value:` field |

> 🔑 **Important:** a toleration is a **permission, not a ticket**. Without nodeSelector or affinity, a tolerating Pod may still be placed on a normal node. This is why "pod-1 tolerates node-01's taint" **doesn't guarantee** pod-1 runs on node-01.

### 5.3 Where you see taints already

| Taint | Where | Why |
|---|---|---|
| `node-role.kubernetes.io/control-plane:NoSchedule` | Control plane node of a **self-managed** cluster (kubeadm) | Keeps app Pods off the control plane. Remove it with `-` only on a small test cluster |
| `node.kubernetes.io/not-ready:NoExecute` | Any node that stops responding | Kubernetes adds it itself, so Pods move to healthy nodes (after about 5 minutes) |
| `node.kubernetes.io/disk-pressure:NoSchedule` | A node low on disk | No new Pods until space is freed |

> On **EKS** the control plane is managed by AWS and isn't one of our nodes, so `kubectl get nodes` shows only worker nodes.

> **Interview one-liner:** A taint on a node keeps away every Pod that doesn't have a matching toleration; NoSchedule blocks new Pods, PreferNoSchedule avoids them, NoExecute also evicts running ones. A toleration only allows a Pod onto the node, it doesn't send it there.

---

## 6. Dedicated nodes: using them together

**Definition:** a **dedicated node** (or node group) is a node reserved for **one kind of workload**, for example GPU nodes only for AI Pods. To make that work we need two things at the same time: **other Pods must stay out** (taint + toleration) and **the AI Pods must go in** (nodeSelector or node affinity). One without the other isn't enough.

### Scenario: AI Pods must run only on the big node

We have 2 kinds of nodes and 2 kinds of Pods:

| Node | Size | Should run |
|---|---|---|
| **AI node** | 16 CPU · 128 GB RAM (expensive) | **Only** AI Pods |
| **App node** | 4 CPU · 32 GB RAM | App Pods (web, APIs) |

**Attempt 1: taint the AI node + toleration on the AI Pods**

```bash
kubectl taint node ai-node pods=ai:NoSchedule
```

| Pod | Where it can go | Result |
|---|---|---|
| App Pod (no toleration) | App node only | ✅ App Pods stay off the AI node |
| AI Pod (has toleration) | AI node **or** app node | ❌ Not guaranteed: an AI Pod can land on the small app node |

The taint **keeps others out**, but the toleration only **allows** AI Pods in. It doesn't **send** them there. So an AI Pod may still end up on the 4 CPU node and run slowly.

**Attempt 2: add a label on the node + nodeSelector on the AI Pods**

```bash
kubectl label node ai-node pods=ai
```

```yaml
      nodeSelector:
        pods: "ai"          # must run on a node labelled pods=ai
```

| Pod | Where it can go | Result |
|---|---|---|
| App Pod (no toleration) | App node only | ✅ Taint keeps it out |
| AI Pod (toleration + nodeSelector) | **AI node only** | ✅ nodeSelector sends it there, toleration lets it in |

> 💡 nodeSelector matches the **node's label** (`pods=ai` on the node), not the Pod's own labels. Every Pod whose nodeSelector says `pods: "ai"` goes **only** to nodes labelled `pods=ai`.

**What if we used only nodeSelector (no taint)?** AI Pods would go to the AI node ✅, but nothing stops App Pods from also landing there and using its CPU ❌. That's why we use **both**:

| We use only… | What goes wrong |
|---|---|
| Taint + toleration | Normal Pods stay off ✅, but AI Pods may still land on the small nodes ❌ |
| nodeSelector / affinity | AI Pods go to the AI node ✅, but normal Pods can also fill it up ❌ |
| **Both** | AI node runs **only** AI Pods, AI Pods run **only** there ✅ |

**Step by step:**

1. **Label** the AI node: `pods=ai` (so AI Pods can find it).
2. **Taint** the AI node: `pods=ai:NoSchedule` (so other Pods stay out).
3. In the AI Deployment add a **toleration** (allowed in) and a **nodeSelector** (sent there).

```yaml
    spec:
      containers:
      - name: model
        image: nginx
      nodeSelector:
        pods: "ai"                 # go to the AI node
      tolerations:
      - key: "pods"                # allowed on the AI node
        operator: "Equal"
        value: "ai"
        effect: "NoSchedule"
```

**In real projects on EKS** the label and taint are set on the **node group** in Terraform, so every new node in the group gets them:

```hcl
  eks_managed_node_groups = {
    ai = {
      instance_types = ["g5.xlarge"]        # GPU nodes
      labels = {
        pods = "ai"
      }
      taints = {
        ai = {
          key    = "pods"
          value  = "ai"
          effect = "NO_SCHEDULE"            # EKS spells effects in capitals
        }
      }
    }
  }
```

> **Interview one-liner:** For dedicated nodes we taint and label the node group; the workload gets a toleration so it's allowed in and a nodeSelector or node affinity so it's sent there, while every other Pod is kept out by the taint.

---

## 7. Which one to use

| Need | Use |
|---|---|
| Send Pods to nodes with one exact label | **nodeSelector** |
| "This value **or** that value", "**not** this", or "label exists" | **Node affinity (required)** |
| "Try these nodes, but run anywhere if they're full" | **Node affinity (preferred)** |
| Keep **all other** Pods off a node | **Taint** |
| Let a system Pod run everywhere, even on tainted nodes (logging, monitoring agents) | **Toleration** with `operator: Exists` |
| Reserve nodes for one app (GPU, AI, licensed software) | **Taint + toleration + nodeSelector/affinity** |
| Move Pods off a node now (maintenance) | Taint with **`NoExecute`** (or `kubectl drain`) |

> **Real projects:** most apps use **none** of these and run on the general node group. They're used for special nodes: GPU/AI, Spot vs On-Demand, ARM (Graviton), or isolating noisy apps. A simple rule to remember: **affinity/nodeSelector attract, taints repel**.

---

# Part 2: Ingress rules (where requests go)

## 8. Ingress rules

**Definition:** **Ingress rules** are the part of an Ingress (`spec.rules`) that decide **which Service** gets each HTTP request. Each rule can match the request's **host** (the domain name, like `api.shop.com`) and its **path** (the part after the domain, like `/api`). The Ingress controller turns these rules into load balancer rules, so one load balancer can serve many apps. (What an Ingress and an Ingress controller are, and why we use one ALB instead of many load balancers, is in [Day 25 section 4](../day-25-services-types-and-traffic-flow/README.md#4-ingress-one-door-for-all-websites).)

```
                       ┌── app.shop.com      ──► frontend Service
 Users ──► Ingress ────┼── api.shop.com      ──► api Service        (host rules)
           (one ALB)   └── shop.com/blog     ──► blog Service       (path rule)
```

### 8.1 Parts of a rule

```yaml
spec:
  ingressClassName: alb            # which controller handles it (alb on EKS)
  rules:
  - host: api.shop.com             # 1. host: which domain (optional)
    http:
      paths:
      - path: /orders              # 2. path: which URL path
        pathType: Prefix           # 3. how the path is matched
        backend:                   # 4. where to send it
          service:
            name: orders           #    ClusterIP Service name
            port:
              number: 80           #    Service port
```

| Field | Meaning |
|---|---|
| `ingressClassName` | Which Ingress controller reads this Ingress: `alb` (AWS Load Balancer Controller) or `nginx` |
| `host` | Match the domain name. No `host` = match **any** domain |
| `path` | Match the URL path |
| `pathType` | How to compare the path (below) |
| `backend.service` | The **ClusterIP Service** and port that gets the request |

### 8.2 pathType

| pathType | Rule `/api` matches | Doesn't match |
|---|---|---|
| `Prefix` | `/api`, `/api/`, `/api/users` | `/apiv2` (matches whole path parts only) |
| `Exact` | only `/api` | `/api/`, `/api/users` |
| `ImplementationSpecific` | Up to the controller (used for regex with NGINX) | — |

If several paths match, the **longest** one wins, so `/api` beats `/`. That's why `/` works as the "everything else" rule.

### 8.3 Host-based routing

**Definition:** **host-based routing** sends requests to different apps based on the **domain name** the user typed. Each app gets its own subdomain, all pointing (in Route 53) to the **same** load balancer.

```yaml
  rules:
  - host: app.shop.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 80
  - host: api.shop.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api
            port:
              number: 80
```

| Request | Goes to |
|---|---|
| `app.shop.com/anything` | frontend |
| `api.shop.com/anything` | api |

### 8.4 Path-based routing

**Definition:** **path-based routing** sends requests to different apps based on the **path** of the URL, all under **one** domain.

```yaml
  rules:
  - host: shop.com
    http:
      paths:
      - path: /blog
        pathType: Prefix
        backend:
          service:
            name: blog
            port:
              number: 80
      - path: /
        pathType: Prefix
        backend:
          service:
            name: frontend
            port:
              number: 80
```

| Request | Goes to |
|---|---|
| `shop.com/blog/post-1` | blog (gets the path `/blog/post-1`) |
| `shop.com/cart` | frontend |

> ⚠️ **The app receives the full path.** The blog app gets `/blog/post-1`, not `/post-1`. So the app must serve its pages **under `/blog`** (most apps have a "base path" setting). If it only serves `/`, it returns **404**. That's what **rewrite** solves (next).

### 8.5 Rewrite: removing the prefix (NGINX controller)

**Definition:** a **rewrite** changes the URL path **before** the request reaches the app. With the NGINX Ingress controller, `/nginx/about` can be rewritten to `/about`, so an app that only knows `/` still works behind a path prefix. It's set with **annotations** (extra settings for the controller).

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: k8s-ingress
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "false"      # allow plain http
    nginx.ingress.kubernetes.io/use-regex: "true"          # paths are regex
    nginx.ingress.kubernetes.io/rewrite-target: /$2        # send only group 2
spec:
  ingressClassName: nginx
  rules:
  - http:
      paths:
      - path: /nginx(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: nginx
            port:
              number: 80
      - path: /httpd(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: httpd
            port:
              number: 80
      - path: /(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: nginx
            port:
              number: 80
```

**How `/nginx(/|$)(.*)` + `/$2` works:**

| Part | Means |
|---|---|
| `/nginx` | The path starts with `/nginx` |
| `(/|$)` | **Group 1:** then a `/` or the end of the path |
| `(.*)` | **Group 2:** everything after that |
| `rewrite-target: /$2` | Send the app `/` + group 2 |

| User opens | Rule | App receives |
|---|---|---|
| `/nginx` | nginx | `/` |
| `/nginx/about.html` | nginx | `/about.html` |
| `/httpd/index.html` | httpd | `/index.html` |
| `/anything` | last rule → nginx | `/` (this path has no group 2, so `/$2` is just `/`) |

> **Real projects:**
> - On **EKS with the ALB** controller there's **no rewrite**. Apps are built to serve under their own path (the backend serves `/api/...`), or each app gets its own **host**.
> - The community **NGINX Ingress controller (ingress-nginx)** was retired in March 2026 (no more updates). New setups use the **ALB** on EKS or the newer **Gateway API**. You'll still see it in many existing clusters.
> - Regex paths use `pathType: ImplementationSpecific`. For normal paths always use `Prefix` or `Exact`.

### 8.6 Default backend and HTTPS

| Feature | Definition | Example |
|---|---|---|
| **Default backend** | The Service that gets requests matching **no rule** (otherwise users get a 404 from the controller) | `spec.defaultBackend.service.name: frontend` |
| **HTTPS on the ALB** | The ALB ends HTTPS with a free **ACM** certificate and can redirect HTTP to HTTPS | Annotations `alb.ingress.kubernetes.io/certificate-arn: <acm-arn>` and `alb.ingress.kubernetes.io/listen-ports: '[{"HTTP":80},{"HTTPS":443}]'` |
| **TLS section** | `spec.tls` lists hosts and a Secret holding the certificate (used by NGINX; the ALB uses ACM) | `tls: - hosts: [shop.com] secretName: shop-tls` |

### 8.7 Host or path: which one?

| Use | When |
|---|---|
| **Host-based** (`api.shop.com`) | Separate apps or teams, each on its own subdomain. Cleanest: no path problems |
| **Path-based** (`shop.com/api`) | One website made of parts (frontend `/`, backend `/api`), one domain, no CORS issues |
| **Both** | Big setups: `shop.com/` + `shop.com/api` and `admin.shop.com` on the same ALB |

> **Interview one-liner:** Ingress rules route each HTTP request by host and path to a ClusterIP Service; the longest matching path wins, the app receives the full path, so we either serve apps under their prefix (ALB) or rewrite the path (NGINX annotations).

---

# Part 3: Lab

## 9. Lab: control Pod placement and route 2 apps on EKS

**Goal:** on a 2-node EKS cluster, make node 1 an "AI node", place Pods with nodeSelector, node affinity and taints, then route 2 apps (nginx and httpd) through one ALB by host and path.

**Before you start:**

| Need | Why |
|---|---|
| EKS cluster with **2 nodes** + bastion with `kubectl` ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)) | Where we run all commands |
| **AWS Load Balancer Controller** installed ([Day 25 lab](../day-25-services-types-and-traffic-flow/README.md#7-lab-expose-one-app-4-ways-on-eks)) | Creates the ALB in steps 8–9 |

> ⚠️ Step 9 creates a **real ALB that costs money**. Do the clean-up (step 11) when you finish.

### Step 1: See the nodes, their labels and taints

```bash
kubectl get nodes
```

**Expected:** 2 nodes, `STATUS Ready`, names like `ip-10-0-1-23.ec2.internal`.

```bash
kubectl get nodes --show-labels
```

**What it does:** shows every label on each node (hostname, zone, instance type, node group).

```bash
kubectl describe nodes | grep -i taints
```

**Expected:** `Taints: <none>` for both nodes.

### Step 2: Save the node names

```bash
NODE1=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
```

```bash
NODE2=$(kubectl get nodes -o jsonpath='{.items[1].metadata.name}')
```

```bash
echo $NODE1 $NODE2
```

**What it does:** stores both names so the next commands can use `$NODE1` and `$NODE2`.

### Step 3: Label node 1 as the AI node

```bash
kubectl label node $NODE1 pods=ai
```

```bash
kubectl get nodes -L pods
```

**Expected:** a `PODS` column with `ai` for node 1 and empty for node 2.

### Step 4: nodeSelector

```bash
vim selector.yaml
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: movies
spec:
  replicas: 5
  selector:
    matchLabels:
      app: movies
  template:
    metadata:
      labels:
        app: movies
    spec:
      containers:
      - name: cont1
        image: nginx
      nodeSelector:
        pods: "ai"
```

```bash
kubectl apply -f selector.yaml
```

```bash
kubectl get pods -l app=movies -o wide
```

**Expected:** all 5 Pods are `Running` and the `NODE` column is **node 1** for every one.

**Try it:** change `pods: "ai"` to `pods: "gpu"` (no node has it) and apply again.

```bash
kubectl get pods -l app=movies
```

**Expected:** the new Pods stay **Pending** (the old ones keep running, because a rolling update waits for new Pods). `kubectl describe pod <name>` on a Pending Pod shows `0/2 nodes are available: 2 node(s) didn't match Pod's node affinity/selector`.

```bash
kubectl delete -f selector.yaml
```

### Step 5: Node affinity (required, In)

```bash
vim affinity.yaml
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: movies
spec:
  replicas: 4
  selector:
    matchLabels:
      app: movies
  template:
    metadata:
      labels:
        app: movies
    spec:
      containers:
      - name: nginx
        image: nginx:latest
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: pods
                operator: In
                values:
                - ai
                - agent
```

```bash
kubectl apply -f affinity.yaml
```

```bash
kubectl get pods -l app=movies -o wide
```

**Expected:** all 4 Pods on **node 1** (`pods=ai`, which is in the list).

Now label node 2 with the other value:

```bash
kubectl label node $NODE2 pods=agent
```

```bash
kubectl rollout restart deployment movies
```

```bash
kubectl get pods -l app=movies -o wide
```

**Expected:** the new Pods can now run on **both** nodes (the scheduler usually spreads them): `ai` **or** `agent` both match. nodeSelector can't do this.

```bash
kubectl delete -f affinity.yaml
```

```bash
kubectl label node $NODE2 pods-
```

**What it does:** `pods-` (key with a `-`) removes the label from node 2.

### Step 6: Taint node 1

```bash
kubectl taint node $NODE1 pods=ai:NoSchedule
```

```bash
kubectl describe node $NODE1 | grep -i taints
```

**Expected:** `Taints: pods=ai:NoSchedule`.

```bash
kubectl create deployment web --image=nginx --replicas=4
```

```bash
kubectl get pods -l app=web -o wide
```

**Expected:** all 4 Pods on **node 2**. They have no toleration, so node 1 is off limits.

### Step 7: Dedicated node: toleration + nodeSelector

```bash
vim ai.yaml
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-model
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-model
  template:
    metadata:
      labels:
        app: ai-model
    spec:
      containers:
      - name: model
        image: nginx
      nodeSelector:
        pods: "ai"
      tolerations:
      - key: "pods"
        operator: "Equal"
        value: "ai"
        effect: "NoSchedule"
```

```bash
kubectl apply -f ai.yaml
```

```bash
kubectl get pods -o wide
```

**Expected:**

| Pods | Node | Why |
|---|---|---|
| `ai-model-*` (3) | node 1 | Toleration lets them in, nodeSelector sends them there |
| `web-*` (4) | node 2 | The taint keeps them off node 1 |

**Try it:** remove the `nodeSelector` lines from `ai.yaml`, apply, and run `kubectl get pods -o wide` again. The `ai-model` Pods can now land on **either** node: a toleration alone doesn't send a Pod to the tainted node.

### Step 8: Clean up the scheduling part

```bash
kubectl delete -f ai.yaml
```

```bash
kubectl delete deployment web
```

```bash
kubectl taint node $NODE1 pods=ai:NoSchedule-
```

```bash
kubectl label node $NODE1 pods-
```

**Expected:** `kubectl describe nodes | grep -i taints` shows `<none>` again.

### Step 9: Two apps behind one Ingress

```bash
kubectl create deployment nginx --image=nginx
```

```bash
kubectl expose deployment nginx --port=80
```

```bash
kubectl create deployment httpd --image=httpd
```

```bash
kubectl expose deployment httpd --port=80
```

**What it does:** creates 2 apps, each with a **ClusterIP** Service on port 80.

```bash
vim rules-ingress.yaml
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: rules
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
spec:
  ingressClassName: alb
  rules:
  - host: nginx.example.com          # host rule → nginx
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx
            port:
              number: 80
  - host: httpd.example.com          # host rule → httpd
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: httpd
            port:
              number: 80
  - http:                            # no host: any other request → nginx
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: nginx
            port:
              number: 80
```

```bash
kubectl apply -f rules-ingress.yaml
```

```bash
kubectl get ingress rules -w
```

**Expected:** `ADDRESS` fills in with `k8s-default-rules-xxxx.us-east-1.elb.amazonaws.com` after 1–2 minutes. Press `Ctrl+C`.

```bash
ALB=$(kubectl get ingress rules -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
```

### Step 10: Test the rules

We don't own `example.com`, so we send the domain name in the **Host header** ourselves. A browser does exactly this when Route 53 points a real domain to the ALB.

```bash
curl -H "Host: nginx.example.com" http://$ALB
```

**Expected:** `Welcome to nginx!`

```bash
curl -H "Host: httpd.example.com" http://$ALB
```

**Expected:** `It works!` (the httpd page).

```bash
curl http://$ALB
```

**Expected:** `Welcome to nginx!`: no host matched, so the last rule (no host) answered.

**See the rules on the ALB:** EC2 → Load Balancers → `k8s-default-rules-...` → **Listeners** → HTTP:80 → **Rules**. There's one rule per host, created by the controller from our YAML.

| Problem | Fix |
|---|---|
| `ADDRESS` stays empty | `kubectl describe ingress rules` → Events. Usually the controller isn't installed or the public subnets lack the tag `kubernetes.io/role/elb = 1` |
| `curl` fails for the first minutes | The ALB DNS name takes 1–3 minutes to work. Wait and retry |
| `503 Service Temporarily Unavailable` | The Service has no Ready Pods: `kubectl get pods`, `kubectl get endpointslices` |

### Step 11: Clean up (stops the AWS bill)

```bash
kubectl delete -f rules-ingress.yaml
```

**What it does:** the controller deletes the ALB. Always delete Ingresses with `kubectl` **before** destroying the cluster, or the ALB stays and keeps billing.

```bash
kubectl delete deployment nginx httpd
```

```bash
kubectl delete svc nginx httpd
```

---

# Wrap-up

## 10. What I learned

**Part 1: Scheduling**
- The **kube-scheduler** filters nodes and scores the rest. No node fits → Pod is **Pending**.
- **nodeSelector** = exact label match, hard rule. **Node affinity** = rules (`In`, `NotIn`, `Exists`, `Gt`, `Lt`), **required** or **preferred**.
- **Taint** on a node keeps Pods away. **Toleration** on a Pod lets it in but doesn't send it there.
- **Dedicated nodes** = taint + toleration + nodeSelector/affinity, set on the EKS node group in Terraform.

**Part 2: Ingress rules**
- Rules match **host** and **path**; the longest path wins; the app gets the **full path**.
- NGINX can **rewrite** the path with annotations; on the ALB we route by host or serve apps under their prefix.

**Part 3: Lab**
- nodeSelector put all Pods on the labelled node, affinity spread them over `ai` **or** `agent`, a taint kept normal Pods off, and toleration + nodeSelector made a dedicated node. One ALB served 2 apps by host.

```
 Scheduling:  affinity / nodeSelector ──► pull 🧲   taint ──► push ⛔   toleration ──► allow ✅
 Requests:    User ──► ALB ──► Ingress rule (host / path) ──► ClusterIP Service ──► Pods
```

---

## 11. Commands

| Command | Use |
|---|---|
| `kubectl get nodes --show-labels` | All labels on each node |
| `kubectl get nodes -L pods` | Show the `pods` label as a column |
| `kubectl label node <node> pods=ai` | Add a label |
| `kubectl label node <node> pods-` | Remove the label `pods` |
| `kubectl taint node <node> pods=ai:NoSchedule` | Add a taint |
| `kubectl taint node <node> pods=ai:NoSchedule-` | Remove the taint |
| `kubectl describe node <node> \| grep -i taints` | See a node's taints |
| `kubectl get pods -o wide` | Which node each Pod runs on |
| `kubectl describe pod <pod>` | Events: why a Pod is Pending |
| `kubectl get ingress` / `kubectl describe ingress <name>` | Ingress rules, ALB address, events |
| `curl -H "Host: <domain>" http://<alb-dns>` | Test a host rule without a real domain |

---

## 12. Interview Questions

### Other Questions

**Q1. What's the difference between nodeSelector and node affinity?**
Both send Pods to nodes by label. nodeSelector only supports exact matches and is always a hard rule. Node affinity supports operators (In, NotIn, Exists, DoesNotExist, Gt, Lt) and can be required (must match, else Pending) or preferred (try to match, else run anywhere).

**Q2. What's the difference between taints/tolerations and node affinity?**
Node affinity is set on the Pod and pulls it towards certain nodes. A taint is set on the node and pushes away every Pod that doesn't tolerate it. Affinity attracts, taints repel.

**Q3. If a Pod has a toleration for a node's taint, will it always run on that node?**
No. A toleration only allows the Pod onto the tainted node; the scheduler can still place it on any other node. To make sure it lands there, add a nodeSelector or node affinity too.

**Q4. How do you reserve nodes only for one workload, like GPU or AI Pods?**
Label and taint the node group (in Terraform on EKS), then give the workload a matching toleration so it's allowed in and a nodeSelector or node affinity so it's sent there. The taint keeps every other Pod off those nodes.

**Q5. What are the taint effects?**
NoSchedule: new Pods without a toleration aren't placed. PreferNoSchedule: the scheduler avoids the node if it can. NoExecute: new Pods aren't placed and running Pods without a toleration are evicted.

**Q6. What does `IgnoredDuringExecution` mean in node affinity?**
The rule is checked only when the Pod is scheduled. If the node's labels change later, Pods already running there aren't moved.

**Q7. Why don't app Pods run on the control plane node?**
In self-managed clusters the control plane node has the taint `node-role.kubernetes.io/control-plane:NoSchedule`. On EKS the control plane is managed by AWS and isn't a node in the cluster at all.

**Q8. A Pod is stuck in Pending. How do you check if scheduling rules are the cause?**
Run `kubectl describe pod` and read the Events: messages like "didn't match Pod's node affinity/selector" or "had untolerated taint" show the cause. Then compare with `kubectl get nodes --show-labels` and the node taints.

**Q9. What's the difference between host-based and path-based routing in an Ingress?**
Host-based routes by domain (`api.shop.com` → api). Path-based routes by URL path under one domain (`shop.com/api` → api). Both can share one ALB.

**Q10. A path rule `/blog` sends traffic to the blog app, but it returns 404. Why?**
The app receives the full path `/blog/...`, but it only serves pages at `/`. Fix it by setting the app's base path to `/blog`, using host-based routing instead, or rewriting the path (NGINX `rewrite-target` annotation).

**Q11. What does pathType do?**
It sets how the path is matched: Prefix matches the path and everything under it, Exact matches only that path, and ImplementationSpecific leaves it to the controller (used for regex with NGINX). When several paths match, the longest one wins.

---

**Source:** [Kubernetes docs: Assigning Pods to Nodes](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/) · [Taints and Tolerations](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/) · [Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/) · [AWS Load Balancer Controller: Ingress annotations](https://kubernetes-sigs.github.io/aws-load-balancer-controller/latest/guide/ingress/annotations/) · [Ingress NGINX retirement](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/)
