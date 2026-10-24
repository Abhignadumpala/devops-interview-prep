# Day 22 — Kubernetes Intro: Architecture, Pods, ReplicaSet, Deployment

[← Kubernetes notes](../README.md)

> **In short:** Docker runs containers on **one** machine. **Kubernetes** runs and manages containers across **many** machines: it restarts them when they crash, scales them, spreads them across servers, and updates them with zero downtime. You tell it **what you want** (YAML) and it keeps it that way.

## Table of Contents

1. [What is Kubernetes?](#1-what-is-kubernetes)
2. [Why Kubernetes? (problems with only Docker)](#2-why-kubernetes-problems-with-only-docker)
3. [Kubernetes in Real Time](#3-kubernetes-in-real-time)
4. [Kubernetes Architecture](#4-kubernetes-architecture)
5. [Pod](#5-pod)
6. [ReplicaSet](#6-replicaset)
7. [Deployment](#7-deployment)
8. [Pod vs ReplicaSet vs Deployment](#8-pod-vs-replicaset-vs-deployment)
9. [Commands Cheat Sheet](#9-commands-cheat-sheet)
10. [Interview Questions](#10-interview-questions)

---

## 1. What is Kubernetes?

**Definition:** Kubernetes (**K8s**) is an open-source **container orchestration** platform. It automatically **deploys, scales, heals and manages** containers across a group of servers (a **cluster**).

- **K8s** = K + 8 letters + s
- Built by **Google** (from its internal system Borg), now run by the **CNCF**
- **Orchestration** = managing many containers together, like a conductor managing an orchestra

| Word | Simple meaning |
|---|---|
| **Container** | App + everything it needs, packed together (Docker image running) |
| **Cluster** | A group of machines Kubernetes manages as one |
| **Node** | One machine (EC2 / VM) in the cluster |
| **Pod** | The smallest unit in K8s: wraps 1+ containers |
| **Desired state** | What you ask for in YAML, e.g. "3 copies of nginx" |
| **Actual state** | What is really running right now |

**Key idea: desired state.** You write *"I want 3 nginx pods"*. Kubernetes checks all the time: if only 2 run, it starts 1 more. You say **what**, K8s handles **how**.

---

## 2. Why Kubernetes? (problems with only Docker)

**Docker alone** is great on one server. In production with many containers and servers, these problems appear:

| Problem with only Docker | What Kubernetes does |
|---|---|
| Container crashes at 2 AM → stays down until someone restarts it | **Self-healing:** restarts / replaces it automatically |
| Traffic spikes (sale day) → you add containers by hand | **Auto-scaling:** adds pods when CPU is high (HPA) |
| Server dies → all its containers die | **Reschedules** the pods on healthy nodes |
| Which server has free CPU/RAM? You decide by hand | **Scheduler** places pods on the best node |
| New version → stop old, start new → **downtime** | **Rolling update:** replaces pods one by one, no downtime |
| Bad release → manual fix | **Rollback** with one command |
| Containers' IPs keep changing → how to find them? | **Service** gives a fixed name/IP + load balancing |
| Passwords in the image / env files | **Secrets & ConfigMaps** |

> **One line:** Docker **builds and runs** containers; Kubernetes **manages** them at scale (heal, scale, update, network).

---

## 3. Kubernetes in Real Time

**Where it's used:** almost every company running microservices: Netflix, Spotify, Swiggy, Zomato, banks, SaaS products.

**Real example: food delivery app (like our RoboShop)**

```
Frontend · Catalogue · Cart · User · Payment · Shipping   → each is a Deployment
MongoDB · Redis · MySQL · RabbitMQ                         → databases / queues
```

| Real situation | Kubernetes feature |
|---|---|
| Lunch time traffic 10x | HPA scales `cart` from 3 → 15 pods, back to 3 after |
| `payment` pod crashes | ReplicaSet creates a new pod in seconds |
| Release v2 of `catalogue` at 3 PM | Deployment rolling update, users don't notice |
| v2 has a bug | `kubectl rollout undo` → back to v1 in a minute |
| One EC2 node dies | Pods moved to other nodes automatically |

**Managed Kubernetes (used in real jobs):** you don't build the control plane yourself.

| Cloud | Service |
|---|---|
| AWS | **EKS** (Elastic Kubernetes Service) |
| Azure | AKS |
| Google Cloud | GKE |

Local practice: **minikube**, **kind**, **k3s**.

---

## 4. Kubernetes Architecture

**Definition:** a cluster has 2 parts: the **control plane** (the brain that **decides**) and **worker nodes** (the muscle that **runs** your pods).

![Kubernetes architecture](images/architecture.png)

### Control plane (master) components

| Component | Simple job | Analogy |
|---|---|---|
| **kube-apiserver** | Front door. Every request (kubectl, nodes, controllers) goes through it | Reception desk |
| **etcd** | Key-value database storing the **whole cluster state** | The company register |
| **kube-scheduler** | Decides **which node** a new pod runs on (free CPU/RAM, rules) | HR assigning desks |
| **kube-controller-manager** | Runs controllers that keep **desired = actual** (ReplicaSet, Node, Deployment controllers) | Manager checking "do we have 3 people on shift?" |
| **cloud-controller-manager** | Talks to the cloud (AWS load balancers, volumes, nodes) | Contact with the landlord |

### Worker node components

| Component | Simple job |
|---|---|
| **kubelet** | Agent on every node. Gets pod specs from the API server, starts them, reports health |
| **kube-proxy** | Network rules on each node so **Services** can reach the right pods |
| **Container runtime** | Actually runs containers: **containerd** (or CRI-O). Docker images still work |

### What happens on `kubectl apply -f deploy.yaml`

```
1. kubectl          → sends YAML to the API server
2. API server       → validates it, saves it in etcd
3. Controller       → sees "Deployment wants 3 pods, 0 exist" → creates 3 pod objects
4. Scheduler        → picks a node for each pod
5. kubelet (node)   → tells containerd to pull the image and start the containers
6. kubelet          → reports "Running" back to the API server
```

> **Remember:** only the **API server** talks to **etcd**. Everything else talks to the API server.

> **On EKS:** AWS runs and manages the whole control plane for you; you manage only the worker nodes (or use Fargate).

---

## 5. Pod

**Definition:** a **Pod** is the **smallest deployable unit** in Kubernetes. It wraps **one or more containers** that share the same **IP address, network and storage**.

- Usually **1 container per pod**. Extra helper containers are called **sidecars** (e.g. a log shipper).
- Pods are **temporary**: if a pod dies, it is **not** brought back by itself. A new pod (new name, new IP) must replace it → that's why we use ReplicaSet / Deployment.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: nginx-pod
  labels:
    app: nginx
spec:
  containers:
    - name: nginx
      image: nginx:1.27
      ports:
        - containerPort: 80
```

```bash
kubectl apply -f pod.yaml
kubectl get pods
kubectl delete pod nginx-pod     # it is gone for good, nobody recreates it
```

---

## 6. ReplicaSet

**Definition:** a **ReplicaSet** makes sure a **fixed number of identical pods** (replicas) is **always running**. A pod dies → it creates a new one. Too many → it deletes extras.

- It finds "its" pods using **labels** (`selector.matchLabels` must match the pod template labels).

```yaml
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: nginx-rs
spec:
  replicas: 3                  # desired count
  selector:
    matchLabels:
      app: nginx               # "my pods are the ones with app=nginx"
  template:                    # how to create a pod
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
```

**Self-healing test:**

```bash
kubectl apply -f rs.yaml
kubectl get pods                         # 3 pods
kubectl delete pod <one-pod-name>
kubectl get pods                         # still 3: a new pod was created
kubectl scale rs nginx-rs --replicas=5   # now 5
```

**Limitation:** if you change the image in a ReplicaSet, **existing pods are not updated**. No rolling update, no rollback. → Use a **Deployment**.

---

## 7. Deployment

**Definition:** a **Deployment** manages **ReplicaSets** for you and adds **rolling updates** and **rollbacks**. It's what we use in real projects for stateless apps.

```
Deployment  →  ReplicaSet  →  Pods
(versions)     (count)        (containers)
```

![Deployment, ReplicaSet and rolling update](images/deployment-replicaset.png)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1        # at most 1 pod down during the update
      maxSurge: 1              # at most 1 extra pod during the update
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
```

**Rolling update and rollback:**

```bash
kubectl apply -f deploy.yaml
kubectl get deploy,rs,pods                           # 1 Deployment, 1 ReplicaSet, 3 pods

kubectl set image deployment/web web=nginx:1.28      # update the version
kubectl rollout status deployment/web                # watch pods replaced one by one
kubectl get rs                                       # 2 ReplicaSets: old (0 pods), new (3 pods)

kubectl rollout history deployment/web               # list revisions
kubectl rollout undo deployment/web                  # back to the previous version
```

**Deployment strategies:**

| Strategy | How | Downtime |
|---|---|---|
| **RollingUpdate** (default) | Replace pods a few at a time | No |
| **Recreate** | Kill all old pods, then start new ones | Yes (short) |

> Links to SRE: rollback is the first choice when a deploy breaks prod. See [War Rooms: rollback or fix forward](../../day-21-sre/day-3-war-rooms/README.md#6-rollback-or-fix-forward).

---

## 8. Pod vs ReplicaSet vs Deployment

| | Pod | ReplicaSet | Deployment |
|---|---|---|---|
| **What** | 1+ containers | Keeps N pods running | Manages ReplicaSets + versions |
| **Self-healing** | ❌ | ✅ | ✅ |
| **Scaling** | ❌ | ✅ | ✅ |
| **Rolling update** | ❌ | ❌ | ✅ |
| **Rollback** | ❌ | ❌ | ✅ |
| **Use in real projects?** | Rarely directly | Rarely directly (Deployment creates it) | ✅ **Yes, always** |

> **One line:** Pod runs the container, ReplicaSet keeps the count, Deployment manages versions. In practice you create **Deployments**.

---

## 9. Commands Cheat Sheet

| Command | What it does |
|---|---|
| `kubectl get nodes` | List cluster nodes |
| `kubectl get pods -o wide` | Pods + which node + IP |
| `kubectl apply -f file.yaml` | Create / update from YAML |
| `kubectl describe pod <name>` | Details + **Events** (why it's failing) |
| `kubectl logs <pod>` | Container logs |
| `kubectl exec -it <pod> -- sh` | Shell inside the container |
| `kubectl get deploy,rs,pods` | See all three levels |
| `kubectl scale deploy web --replicas=5` | Scale |
| `kubectl set image deploy/web web=nginx:1.28` | Update image |
| `kubectl rollout status / history / undo deploy/web` | Watch / list / roll back |
| `kubectl delete -f file.yaml` | Delete what the file created |

---

## 10. Interview Questions

### Other Questions

**Q1. What is Kubernetes?**
An open-source container orchestration platform that deploys, scales, heals and manages containers across a cluster.

**Q2. Why Kubernetes if we have Docker?**
Docker runs containers on one machine. Kubernetes manages them across many machines: self-healing, auto-scaling, rolling updates, rollback, service discovery.

**Q3. Explain Kubernetes architecture.**
Control plane: API server (front door), etcd (state database), scheduler (picks a node), controller manager (keeps desired = actual). Worker nodes: kubelet (runs pods), kube-proxy (networking), container runtime (containerd).

**Q4. What is etcd?**
A key-value database that stores the entire cluster state. Only the API server talks to it. Back it up.

**Q5. What does the scheduler do?**
Chooses which node a new pod runs on, based on free resources and rules.

**Q6. What is a Pod?**
The smallest deployable unit: one or more containers sharing IP and storage. Temporary.

**Q7. ReplicaSet vs Deployment?**
ReplicaSet keeps N pods running. Deployment manages ReplicaSets and adds rolling updates and rollbacks. Use Deployments.

**Q8. What happens when you delete a pod managed by a Deployment?**
The ReplicaSet notices the count dropped and creates a new pod.

**Q9. How do you roll back a bad release?**
`kubectl rollout undo deployment/<name>`: the old ReplicaSet scales back up.

**Q10. What is EKS?**
AWS-managed Kubernetes: AWS runs the control plane, you run (or let Fargate run) the worker nodes.

---

**Source:** [Kubernetes docs: components](https://kubernetes.io/docs/concepts/overview/components/) · [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/) · [ReplicaSet](https://kubernetes.io/docs/concepts/workloads/controllers/replicaset/)
