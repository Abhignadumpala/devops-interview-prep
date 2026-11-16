# Day 34 - Kubernetes Certificates (PKI) and Pod Priority

[← Kubernetes notes](../README.md)

> **In short:** Kubernetes components (API server, etcd, kubelet, scheduler, controller manager, kube-proxy) talk to each other over the network, so every connection uses **TLS certificates**: to **encrypt** the traffic and to **prove who is talking** (certificate-based authentication). All these certificates are signed by the cluster's **Certificate Authority (CA)**; this whole setup is the **Kubernetes PKI**. **Pod priority** decides **which Pods matter more**: when the cluster is full, the scheduler can **preempt (evict) low-priority Pods** to make room for high-priority ones, using a **PriorityClass**.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Certificates (PKI)** | PKI words, why components need certificates, server vs client certificates, the 3 CAs and `/etc/kubernetes/pki`, CN/O = user/group, certificate expiry and renewal, the CSR API, kubeconfig, self-managed vs EKS | How Kubernetes components trust each other and how users get a certificate |
| **Part 2: Pod Priority** | PriorityClass, preemption, built-in system classes, `preemptionPolicy: Never`, priority vs QoS, real-time tiers | Make sure critical apps always get scheduled |
| **Part 3: Lab** | Read the cluster CA and API server certificate, create a user with a client certificate (CSR API) + RBAC, PriorityClasses and preemption on EKS | Do both topics yourself on EKS |

> **Before this:** [Day 30 - RBAC](../day-30-rbac/README.md) (certificates give the **user/group**, RBAC gives the **permissions**) · [Day 32 - API server](../day-32-api-server-cluster-security-supply-chain/README.md) (authentication is step 1 of every request)

## Table of Contents

**Part 1: Certificates (PKI)**
1. [PKI words you need](#1-pki-words-you-need)
2. [Why Kubernetes needs certificates](#2-why-kubernetes-needs-certificates)
3. [Server certificates vs client certificates](#3-server-certificates-vs-client-certificates)
4. [The 3 CAs and the /etc/kubernetes/pki folder](#4-the-3-cas-and-the-etckubernetespki-folder)
5. [How a certificate becomes a user: CN and O](#5-how-a-certificate-becomes-a-user-cn-and-o)
6. [Certificate expiry and renewal](#6-certificate-expiry-and-renewal)
7. [The CSR API: give a user a certificate](#7-the-csr-api-give-a-user-a-certificate)
8. [Certificates inside kubeconfig](#8-certificates-inside-kubeconfig)
9. [Self-managed (kubeadm) vs EKS](#9-self-managed-kubeadm-vs-eks)

**Part 2: Pod Priority**

10. [What is Pod priority?](#10-what-is-pod-priority)
11. [PriorityClass](#11-priorityclass)
12. [Preemption: how high priority gets room](#12-preemption-how-high-priority-gets-room)
13. [Built-in classes and preemptionPolicy](#13-built-in-classes-and-preemptionpolicy)
14. [Priority vs QoS, and real-time tiers](#14-priority-vs-qos-and-real-time-tiers)

**Part 3: Lab**

15. [Lab setup](#15-lab-setup)
16. [Lab A: Look at the cluster's certificates](#16-lab-a-look-at-the-clusters-certificates)
17. [Lab B: Create a user with a client certificate](#17-lab-b-create-a-user-with-a-client-certificate)
18. [Lab C: See the priority of system Pods](#18-lab-c-see-the-priority-of-system-pods)
19. [Lab D: PriorityClasses and preemption](#19-lab-d-priorityclasses-and-preemption)
20. [Lab E: preemptionPolicy Never](#20-lab-e-preemptionpolicy-never)
21. [Clean up](#21-clean-up)

**Wrap-up**

22. [Troubleshooting](#22-troubleshooting)
23. [What I learned](#23-what-i-learned)
24. [Commands](#24-commands)
25. [Interview Questions](#25-interview-questions)

---

# Part 1: Certificates (PKI)

## 1. PKI words you need

**Definition:** **PKI (Public Key Infrastructure)** is the system of **keys, certificates and a trusted Certificate Authority** used to **encrypt** connections and **prove identity**.

| Word | Simple meaning | Example in Kubernetes |
|---|---|---|
| **Private key** | Secret file only the owner has; never shared | `apiserver.key` |
| **Public key** | Shared freely; goes inside the certificate | Inside `apiserver.crt` |
| **Certificate** | "ID card": public key + name + who signed it + valid dates | `apiserver.crt` |
| **CA (Certificate Authority)** | The trusted "passport office" that signs certificates | `ca.crt` / `ca.key` |
| **CSR (Certificate Signing Request)** | "Application form" asking the CA to sign a certificate | `dev-user.csr` |
| **TLS** | Encrypted connection; the **server** proves who it is | HTTPS to the API server |
| **mTLS (mutual TLS)** | **Both sides** show a certificate and check each other | kubelet ↔ API server |

```
         CA (ca.crt + ca.key)   ◄── everyone trusts this
          │ signs
          ▼
 ┌────────────────────────┐        "Is this certificate signed by a CA I trust?
 │ Certificate            │         Is it still valid? Does the name match?"
 │ name: kube-apiserver   │        → yes: trust it, set up the encrypted connection
 │ public key             │
 │ signed by: kubernetes  │
 │ valid: 1 year          │
 └────────────────────────┘
```

---

## 2. Why Kubernetes needs certificates

**In simple words:** in Kubernetes, when components **want to talk to each other**, they need **certificates**. Every connection is TLS, and the components use certificates to **authenticate** (prove who they are).

```
 KUBE SCHEDULER   ──[client cert]──┐                       ┌──[client cert]──► ETCD SERVER
                                   │                       │
 KUBE CONTROLLER  ──[client cert]──┼──►  KUBE API SERVER  ─┤
 MANAGER                           │     [server cert]     │
                                   │                       │
 KUBE PROXY       ──[client cert]──┘          ▲            └──[client cert]──► KUBELET (every node)
                                              │                                   │
                                              └──────────[client cert]────────────┘
                                                  kubelet → API server
```

**The API server is in the middle.** Everyone talks only to the API server, and the API server talks to etcd and to the kubelets.

| Why | Without certificates |
|---|---|
| **Encryption** | Secrets, tokens and Pod specs would travel in plain text on the network |
| **Authentication** | Anyone on the network could pretend to be the scheduler or a node |
| **Trust** | A fake API server could steal data from kubelets |

---

## 3. Server certificates vs client certificates

- **Server certificate:** proves "I am the real server" to whoever connects.
- **Client certificate:** proves "I am this user/component" to the server.

| Component | Role | Certificate | Identity in the certificate (CN / O) |
|---|---|---|---|
| **kube-apiserver** | **Server** for everyone | `apiserver.crt` | CN `kube-apiserver`; SANs: `kubernetes`, `kubernetes.default.svc`, node IP, Service IP `10.96.0.1`… |
| kube-apiserver → etcd | **Client** | `apiserver-etcd-client.crt` | CN `kube-apiserver-etcd-client` |
| kube-apiserver → kubelet | **Client** | `apiserver-kubelet-client.crt` | CN `kube-apiserver-kubelet-client`, O `system:masters` (kubeadm) |
| **etcd** | **Server** (+ peer between etcd members) | `etcd/server.crt`, `etcd/peer.crt` | etcd node name |
| **kubelet** | **Server** (API server calls it for logs, exec) | kubelet serving cert | node name |
| kubelet → API server | **Client** | kubelet client cert (auto-rotated) | CN `system:node:<node-name>`, O `system:nodes` |
| **kube-scheduler** | **Client** | in `scheduler.conf` | CN `system:kube-scheduler` |
| **kube-controller-manager** | **Client** | in `controller-manager.conf` | CN `system:kube-controller-manager` |
| **kube-proxy** | **Client** | in its kubeconfig / ServiceAccount token | CN `system:kube-proxy` |
| **Admin (you)** | **Client** | in `admin.conf` / your kubeconfig | CN `kubernetes-admin`, O `kubeadm:cluster-admins` (or `system:masters`) |

> **Remember:** the **API server is both**: a **server** to kubectl, scheduler, controller manager, kube-proxy and kubelets, and a **client** to etcd and kubelets.

> **Not a certificate:** `sa.key` / `sa.pub` is a **key pair** the API server uses to **sign and verify ServiceAccount tokens** (Day 31). Pods use tokens, not client certificates.

---

## 4. The 3 CAs and the /etc/kubernetes/pki folder

A kubeadm cluster has **3 separate CAs**, so a certificate from one area can't be used in another:

| CA | Signs certificates for |
|---|---|
| **kubernetes CA** (`ca.crt`) | API server, kubelets, scheduler, controller manager, admin users |
| **etcd CA** (`etcd/ca.crt`) | etcd server and peers, and the API server's etcd client cert |
| **front-proxy CA** (`front-proxy-ca.crt`) | The API server's client cert for **API aggregation** (e.g. metrics-server) |

**Where they live on a kubeadm control-plane node:**

```
/etc/kubernetes/
├── admin.conf  scheduler.conf  controller-manager.conf  kubelet.conf   ← kubeconfigs with client certs
└── pki/
    ├── ca.crt  ca.key                             ← kubernetes CA
    ├── apiserver.crt  apiserver.key               ← API server serving cert
    ├── apiserver-kubelet-client.crt / .key        ← API server → kubelet
    ├── apiserver-etcd-client.crt / .key           ← API server → etcd
    ├── front-proxy-ca.crt / .key
    ├── front-proxy-client.crt / .key
    ├── sa.key  sa.pub                             ← ServiceAccount token signing
    └── etcd/
        ├── ca.crt  ca.key                         ← etcd CA
        ├── server.crt / .key
        ├── peer.crt / .key
        └── healthcheck-client.crt / .key
```

> ⚠️ **`ca.key` is the most sensitive file in the cluster.** Anyone with it can sign a certificate for `system:masters` and become **cluster-admin**.

---

## 5. How a certificate becomes a user: CN and O

Kubernetes has **no "users" object**. When a client certificate is used, the API server reads the user from the certificate:

| Certificate field | Becomes | Example |
|---|---|---|
| **CN** (Common Name) | **Username** | `CN=dev-user` → user `dev-user` |
| **O** (Organization) | **Group** (can be several) | `O=dev-team` → group `dev-team` |

```
 kubectl ──(client cert CN=dev-user, O=dev-team)──► API server
                                                     ① Authentication: signed by our CA? valid? → user=dev-user, groups=[dev-team]
                                                     ② Authorization (RBAC): is there a RoleBinding for dev-user or dev-team?
                                                     ③ Admission → etcd
```

**In simple words:** the **certificate says who you are** (authentication); **RBAC says what you can do** (authorization, Day 30). A valid certificate with no RoleBinding gets **403 Forbidden**.

> ⚠️ **Kubernetes can't revoke a certificate.** If a user's certificate leaks, it works until it **expires**. You can only remove their RoleBindings (or rotate the whole CA). That's why real teams give **short-lived** certificates, or use **OIDC / IAM** for people instead of certificates. Never give a user `O=system:masters`: that group bypasses RBAC completely.

---

## 6. Certificate expiry and renewal

| Item | kubeadm default validity |
|---|---|
| CA certificates | **10 years** |
| All other certificates (API server, etcd, kubeconfigs) | **1 year** |
| kubelet client certificate | Rotated **automatically** before it expires (`rotateCertificates: true`) |

**What happens when they expire:** kubectl fails with `x509: certificate has expired or is not yet valid`, components can't talk to the API server, and the cluster stops working. **This is a common real outage.**

**Check expiry (kubeadm):**

```bash
sudo kubeadm certs check-expiration
```

**Renew all (kubeadm):**

```bash
sudo kubeadm certs renew all
```

Then restart the control-plane static Pods (API server, controller manager, scheduler, etcd) so they load the new files, and copy the new `admin.conf` to `~/.kube/config`.

> **Good to know:** `kubeadm upgrade apply` **renews all certificates automatically**. Clusters that are upgraded at least once a year rarely hit expiry.

**Check any certificate with openssl:**

```bash
openssl x509 -in /etc/kubernetes/pki/apiserver.crt -noout -subject -issuer -dates
```

---

## 7. The CSR API: give a user a certificate

**Definition:** the **CertificateSigningRequest (CSR) API** lets you ask the **cluster CA** to sign a certificate **without copying `ca.key` anywhere**.

```
 ① user: private key + CSR (CN=dev-user, O=dev-team)        openssl
 ② admin: create a CertificateSigningRequest object          kubectl apply
 ③ admin: approve it                                         kubectl certificate approve
 ④ controller manager signs it with the cluster CA           (automatic)
 ⑤ user: download the certificate, put it in kubeconfig      kubectl get csr -o jsonpath
 ⑥ admin: RoleBinding for the user or group                  RBAC (Day 30)
```

```yaml
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: dev-user
spec:
  request: <base64 of dev-user.csr>
  signerName: kubernetes.io/kube-apiserver-client   # "a client cert for the API server"
  expirationSeconds: 86400                          # 1 day (short-lived is safer)
  usages:
  - client auth
```

| Signer | Used for |
|---|---|
| `kubernetes.io/kube-apiserver-client` | **Users** / clients of the API server |
| `kubernetes.io/kube-apiserver-client-kubelet` | kubelet client certs (auto-approved for nodes) |
| `kubernetes.io/kubelet-serving` | kubelet serving certs |

---

## 8. Certificates inside kubeconfig

Your kubeconfig holds **3 certificate items**:

```yaml
clusters:
- name: my-cluster
  cluster:
    server: https://ABC123.gr7.us-east-1.eks.amazonaws.com
    certificate-authority-data: <base64 CA cert>   # to TRUST the API server (server cert check)
users:
- name: dev-user
  user:
    client-certificate-data: <base64 cert>         # WHO I am (CN/O)
    client-key-data: <base64 private key>          # proves I own the cert; keep secret
```

| Field | Purpose |
|---|---|
| `certificate-authority-data` | kubectl checks the **API server's** certificate against this CA (no fake API server) |
| `client-certificate-data` + `client-key-data` | kubectl proves **who you are** to the API server |

> On **EKS**, the `users` part uses `exec: aws eks get-token` (an IAM token) instead of a client certificate. The `certificate-authority-data` is still there.

---

## 9. Self-managed (kubeadm) vs EKS

| | **Self-managed (kubeadm)** | **EKS** |
|---|---|---|
| Control-plane certs (API server, etcd) | **You** create, store and renew them | **AWS** manages and rotates them; you never see `/etc/kubernetes/pki` |
| Expiry outages | Your problem (`kubeadm certs renew`) | Not your problem |
| Cluster CA | On the control-plane node | Shown in `aws eks describe-cluster` and kubeconfig (`certificate-authority-data`) |
| How people log in | Often client certificates | **IAM** (`aws eks get-token`) + **access entries** |
| Node certificates | kubelet bootstrap + rotation | Same (kubelet rotation), nodes join with IAM |
| CSR API | Works | Works for the supported signers |

**Real time:** on EKS, people log in with IAM, Pods use ServiceAccount tokens, and AWS handles the control-plane PKI. You still need to know PKI for **CKA**, **self-managed clusters**, **`x509` errors**, and **TLS for your own apps** (cert-manager for Ingress certificates).

> **Interview one-liner:** Kubernetes uses a PKI where a cluster CA signs server and client certificates for every component, so all control-plane traffic is encrypted with mutual TLS and each component is authenticated by its certificate's CN and O; on EKS, AWS manages the control-plane certificates and users authenticate with IAM.

---

# Part 2: Pod Priority

## 10. What is Pod priority?

**Definition:** **Pod priority** is a number that tells the scheduler **how important a Pod is** compared to other Pods. Higher number = more important.

It matters when the cluster is **full**:

| Effect | What happens |
|---|---|
| **Scheduling order** | Pending Pods with higher priority are scheduled **first** |
| **Preemption** | If a high-priority Pod can't fit, the scheduler **evicts lower-priority Pods** on a node to make room |
| **Node-pressure eviction** | When a node runs out of memory, the kubelet evicts lower-priority Pods first (after QoS checks) |

**Why:** in a shared cluster, a big batch job or a dev app should **never** stop the **payment service** from running.

---

## 11. PriorityClass

**Definition:** a **PriorityClass** is a **cluster-wide** object that gives a **name** to a **priority number**. Pods use it with `priorityClassName`.

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 100000                        # higher = more important (max 1,000,000,000 for your own classes)
globalDefault: false                 # true = used by Pods with no priorityClassName (only one class can be default)
preemptionPolicy: PreemptLowerPriority   # default; or Never
description: "Customer-facing apps: payment, frontend"
```

**Use it in a Pod / Deployment:**

```yaml
spec:
  template:
    spec:
      priorityClassName: high-priority
      containers:
      - name: payment
        image: nginx:1.27
```

| Field | Meaning |
|---|---|
| `value` | The priority number. Your own classes: up to **1,000,000,000** |
| `globalDefault` | Default for Pods without a class. If no class is default, those Pods get priority **0** |
| `preemptionPolicy` | `PreemptLowerPriority` (can evict others) or `Never` (waits in line, never evicts) |
| `description` | Free text for humans |

> PriorityClass is **not namespaced**. The Pod's `spec.priority` number is filled in by the **Priority admission controller** from the class name when the Pod is created; changing the class later doesn't change running Pods.

---

## 12. Preemption: how high priority gets room

```
 Cluster is full. New Pod "payment" (priority 100000) is Pending.
        │
        ▼
 ① Scheduler: "no node has room for payment"
        │
        ▼
 ② Scheduler looks for a node where evicting LOWER-priority Pods would make enough room
        │   (tries to respect PodDisruptionBudgets, picks the fewest / lowest victims)
        ▼
 ③ Victims (e.g. batch-job Pods, priority 1000) get a graceful delete (terminationGracePeriodSeconds)
        │   payment Pod gets status.nominatedNodeName = that node
        ▼
 ④ payment is scheduled on that node ✅
        │
        ▼
 ⑤ Evicted batch Pods: their Deployment/Job creates new Pods → Pending until room comes back
```

**In simple words:** when there's no room, the scheduler **kicks out less important Pods** so the **more important Pod can run**.

| Good to know | Detail |
|---|---|
| Never evicts **equal or higher** priority | Only **lower** |
| PodDisruptionBudget | Respected **best effort**: if no other way, it can still be broken |
| Not instant | Victims get their graceful termination time first |
| Cluster Autoscaler / Karpenter | They see the evicted Pending Pods and may **add a node** for them |

---

## 13. Built-in classes and preemptionPolicy

**Built-in PriorityClasses** (for critical system Pods):

| Class | Value | Used by |
|---|---|---|
| `system-node-critical` | 2,000,001,000 | Pods a **node** can't work without: `kube-proxy`, `aws-node` (VPC CNI), CSI node drivers |
| `system-cluster-critical` | 2,000,000,000 | Pods the **cluster** needs: `coredns`, metrics-server |

> These are higher than any class you can create (max 1,000,000,000), so **your apps can never preempt system Pods**.

**`preemptionPolicy: Never`** = "schedule me **before** lower Pods in the queue, but **don't evict** anyone":

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-no-preempt
value: 100000
preemptionPolicy: Never
description: "Important batch/ML jobs: go first in line, but don't kill running work"
```

---

## 14. Priority vs QoS, and real-time tiers

| | **Priority** (PriorityClass) | **QoS class** (from requests/limits) |
|---|---|---|
| Set by | `priorityClassName` | Automatic: Guaranteed / Burstable / BestEffort |
| Used by | **Scheduler** (order + preemption) | **kubelet** (node memory pressure eviction, OOM score) |
| Question it answers | "Who gets a place in the cluster?" | "Who gets killed first when a node runs out of memory?" |

> Node-pressure eviction looks at **usage above requests first**, then **priority**. So a high-priority Pod that uses far more than it requested can still be evicted. Set requests correctly.

**Real-time tiers (RoboShop example):**

| PriorityClass | Value | Apps |
|---|---|---|
| `system-node-critical` / `system-cluster-critical` | built-in | kube-proxy, aws-node, coredns |
| `platform-critical` | 1,000,000 | Ingress controller, Argo CD, monitoring agents |
| `business-critical` | 100,000 | frontend, payment, cart, user |
| `default` (globalDefault) | 1,000 | Everything else |
| `batch-low` | 100 | Reports, CI runners, test environments (`preemptionPolicy: Never`) |

> ⚠️ **Protect it:** if anyone can use `business-critical`, everyone will. Limit it with a **ResourceQuota** per PriorityClass (`scopeSelector` on `PriorityClass`) or an admission policy (Kyverno), so only allowed namespaces can use high classes.

> **Interview one-liner:** Pod priority, set with a PriorityClass, decides scheduling order, and when the cluster is full the scheduler preempts lower-priority Pods to place higher-priority ones; system Pods use the built-in system-node-critical and system-cluster-critical classes.

---

# Part 3: Lab

## 15. Lab setup

**Prereqs:** EKS + `kubectl` and `openssl` on the bastion ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)). Run everything on the bastion.

**Step 1: Create a working folder**

```bash
mkdir -p ~/day34 && cd ~/day34
```

**Step 2: Create the lab namespaces**

```bash
kubectl create namespace cert-lab
```

```bash
kubectl create namespace priority-lab
```

---

## 16. Lab A: Look at the cluster's certificates

**Step 1: Save the cluster CA from your kubeconfig**

```bash
kubectl config view --raw --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > ca.crt
```

**Step 2: Read it**

```bash
openssl x509 -in ca.crt -noout -subject -issuer -dates
```

**Expected:** `subject=CN = kubernetes`, `issuer=CN = kubernetes` (a CA signs itself), valid for **10 years** ✅

**Step 3: Save the API server address**

```bash
APISERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}' | sed 's#https://##')
```

**Step 4: Read the API server's serving certificate**

```bash
openssl s_client -connect $APISERVER:443 -servername $APISERVER </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

**Expected:** issuer `CN = kubernetes` (signed by our cluster CA), and SANs like `kubernetes`, `kubernetes.default`, `kubernetes.default.svc.cluster.local`, the EKS endpoint name and `10.100.0.1` (the `kubernetes` Service IP) ✅. Valid for much less than 10 years: AWS rotates it.

**Step 5: Call the API without trusting the CA**

```bash
curl https://$APISERVER/version
```

**Expected:** `curl: (60) SSL certificate problem: unable to get local issuer certificate` ❌. curl doesn't know our cluster CA.

**Step 6: Call it again, trusting our CA**

```bash
curl --cacert ca.crt https://$APISERVER/version
```

**Expected:** JSON with `"gitVersion": "v1.3x.x-eks-..."` ✅. The **CA is how clients trust the server**. (`/version` is allowed without login.)

**Step 7: See how YOU log in**

```bash
kubectl config view --minify -o jsonpath='{.users[0].user.exec.args}'
```

**Expected:** `["--region","us-east-1","eks","get-token","--cluster-name",...]` ✅. On EKS you log in with an **IAM token**, not a client certificate.

---

## 17. Lab B: Create a user with a client certificate

We create user `dev-user` in group `dev-team`, signed by the cluster CA through the CSR API.

**Step 1: Create the user's private key**

```bash
openssl genrsa -out dev-user.key 2048
```

**Step 2: Create the CSR (CN = user, O = group)**

```bash
openssl req -new -key dev-user.key -out dev-user.csr -subj "/CN=dev-user/O=dev-team"
```

**Step 3: Create the CertificateSigningRequest file**

```bash
cat <<EOF > dev-user-csr.yaml
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: dev-user
spec:
  request: $(base64 -w0 dev-user.csr)
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 86400
  usages:
  - client auth
EOF
```

**Step 4: Send it to the cluster**

```bash
kubectl apply -f dev-user-csr.yaml
```

**Step 5: See it waiting**

```bash
kubectl get csr dev-user
```

**Expected:** `CONDITION: Pending` ✅

**Step 6: Approve it (as the admin)**

```bash
kubectl certificate approve dev-user
```

**Step 7: Check it's issued**

```bash
kubectl get csr dev-user
```

**Expected:** `Approved,Issued` ✅

**Step 8: Download the signed certificate**

```bash
kubectl get csr dev-user -o jsonpath='{.status.certificate}' | base64 -d > dev-user.crt
```

**Step 9: Read it**

```bash
openssl x509 -in dev-user.crt -noout -subject -issuer -dates
```

**Expected:** `subject=O = dev-team, CN = dev-user`, `issuer=CN = kubernetes`, valid for **1 day** ✅

**Step 10: Add the user to kubeconfig**

```bash
kubectl config set-credentials dev-user --client-certificate=dev-user.crt --client-key=dev-user.key --embed-certs=true
```

**Step 11: Create a context for the user**

```bash
kubectl config set-context dev-user-ctx --cluster=$(kubectl config view --minify -o jsonpath='{.clusters[0].name}') --user=dev-user --namespace=cert-lab
```

**Step 12: Try as dev-user**

```bash
kubectl --context=dev-user-ctx get pods
```

**Expected:** `Error from server (Forbidden): pods is forbidden: User "dev-user" cannot list resource "pods" ... in the namespace "cert-lab"` ✅. **Authentication worked** (the API server knows the name `dev-user` from the certificate); **authorization** (RBAC) said no.

**Step 13: Give the group read access in cert-lab (as admin)**

```bash
kubectl create rolebinding dev-team-view --clusterrole=view --group=dev-team -n cert-lab
```

**Step 14: Try again**

```bash
kubectl --context=dev-user-ctx get pods
```

**Expected:** `No resources found in cert-lab namespace.` ✅. The permission came from the **group** `dev-team` = the certificate's **O** field.

**Step 15: Check it can't write**

```bash
kubectl --context=dev-user-ctx auth can-i create deployments
```

**Expected:** `no` ✅

**Step 16: Remove access** (a certificate can't be revoked, so remove its RBAC)

```bash
kubectl delete rolebinding dev-team-view -n cert-lab
```

---

## 18. Lab C: See the priority of system Pods

**Step 1: List the PriorityClasses**

```bash
kubectl get priorityclass
```

**Expected:** `system-cluster-critical 2000000000` and `system-node-critical 2000001000` ✅

**Step 2: See which system Pods use them**

```bash
kubectl get pods -n kube-system -o custom-columns=NAME:.metadata.name,CLASS:.spec.priorityClassName,PRIORITY:.spec.priority
```

**Expected:** `aws-node-…` and `kube-proxy-…` → `system-node-critical`; `coredns-…` → `system-cluster-critical` ✅

**Step 3: See a normal Pod's priority**

```bash
kubectl run plain --image=nginx:1.27 -n priority-lab
```

```bash
kubectl get pod plain -n priority-lab -o jsonpath='{.spec.priority}{"\n"}'
```

**Expected:** `0` ✅ (no class, no global default)

```bash
kubectl delete pod plain -n priority-lab
```

---

## 19. Lab D: PriorityClasses and preemption

**Step 1: Create the file `priority-classes.yaml`**

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: low-priority
value: 1000
globalDefault: false
description: "Batch jobs, test apps"
---
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-priority
value: 100000
globalDefault: false
description: "Customer-facing apps like payment"
```

**Step 2: Apply it**

```bash
kubectl apply -f priority-classes.yaml
```

**Step 3: See how much CPU your nodes have**

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu
```

**Expected:** e.g. 2 nodes × `1930m` (t3.medium) ✅. We'll fill this with low-priority Pods.

**Step 4: Create the file `low-app.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: low-app
  namespace: priority-lab
spec:
  replicas: 4
  selector:
    matchLabels:
      app: low-app
  template:
    metadata:
      labels:
        app: low-app
    spec:
      priorityClassName: low-priority
      containers:
      - name: app
        image: nginx:1.27
        resources:
          requests:
            cpu: 400m          # big request so the nodes fill quickly
            memory: 64Mi
```

**Step 5: Apply it**

```bash
kubectl apply -f low-app.yaml
```

**Step 6: Scale up until the cluster is full**

```bash
kubectl scale deployment low-app -n priority-lab --replicas=12
```

**Step 7: Check that some are Pending**

```bash
kubectl get pods -n priority-lab -o wide
```

**Expected:** some `Running`, a few `Pending` ✅ (if all are Running, scale higher until some are Pending). The cluster is **full**.

**Step 8: Create the file `high-app.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: high-app
  namespace: priority-lab
spec:
  replicas: 2
  selector:
    matchLabels:
      app: high-app
  template:
    metadata:
      labels:
        app: high-app
    spec:
      priorityClassName: high-priority
      containers:
      - name: app
        image: nginx:1.27
        resources:
          requests:
            cpu: 400m
            memory: 64Mi
```

**Step 9: Apply it**

```bash
kubectl apply -f high-app.yaml
```

**Step 10: Watch what happens**

```bash
kubectl get pods -n priority-lab -w
```

**Expected:** some `low-app` Pods go `Terminating`, new `low-app` Pods appear as `Pending`, and both `high-app` Pods become `Running` ✅. Press `Ctrl+C`.

**Step 11: See the preemption events**

```bash
kubectl get events -n priority-lab --field-selector reason=Preempted
```

**Expected:** `Preempted by pod <uid> on node ip-10-0-…` ✅

**Step 12: Compare the priority numbers**

```bash
kubectl get pods -n priority-lab -o custom-columns=NAME:.metadata.name,CLASS:.spec.priorityClassName,PRIORITY:.spec.priority,STATUS:.status.phase
```

**Expected:** `high-app` = `100000 Running`; the Pending ones are all `low-app` = `1000` ✅

> If your cluster runs **Cluster Autoscaler or Karpenter**, a new node may appear a minute later for the Pending low Pods. That's normal: priority decides who goes first; the autoscaler adds room for the rest.

---

## 20. Lab E: preemptionPolicy Never

**Step 1: Create the file `high-no-preempt.yaml`**

```yaml
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: high-no-preempt
value: 100000
preemptionPolicy: Never
description: "Goes first in line but never evicts"
---
apiVersion: v1
kind: Pod
metadata:
  name: polite
  namespace: priority-lab
spec:
  priorityClassName: high-no-preempt
  containers:
  - name: app
    image: nginx:1.27
    resources:
      requests:
        cpu: 400m
        memory: 64Mi
```

**Step 2: Apply it** (the cluster is still full from Lab D)

```bash
kubectl apply -f high-no-preempt.yaml
```

**Step 3: Check it**

```bash
kubectl get pod polite -n priority-lab
```

**Expected:** `Pending` ✅, and no new `Preempted` events. It **waits** instead of evicting anyone.

**Step 4: Free some room**

```bash
kubectl scale deployment low-app -n priority-lab --replicas=2
```

**Step 5: Check again**

```bash
kubectl get pod polite -n priority-lab
```

**Expected:** `Running` ✅. It was scheduled **before** the Pending `low-app` Pods because its priority is higher.

---

## 21. Clean up

```bash
kubectl delete namespace priority-lab cert-lab
```

```bash
kubectl delete priorityclass low-priority high-priority high-no-preempt
```

```bash
kubectl delete csr dev-user
```

```bash
kubectl config delete-context dev-user-ctx
```

```bash
kubectl config delete-user dev-user
```

```bash
rm -rf ~/day34
```

---

# Wrap-up

## 22. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `x509: certificate has expired or is not yet valid` | Cert expired (kubeadm: 1 year), or the machine clock is wrong | `kubeadm certs check-expiration` → `kubeadm certs renew all` → restart control-plane Pods; check NTP/time |
| `x509: certificate signed by unknown authority` | Client doesn't trust the CA (wrong kubeconfig / CA, or cluster recreated) | Get the right `certificate-authority-data` (`aws eks update-kubeconfig`) |
| `x509: certificate is valid for X, not Y` | Address not in the API server cert's **SANs** (e.g. new load balancer name) | kubeadm: add it to `certSANs` and regenerate `apiserver.crt` |
| CSR stays `Pending` | Not approved yet | `kubectl certificate approve <name>` |
| CSR `Approved` but no certificate / `Failed` | Signer not supported, or wrong `usages` | Use `kubernetes.io/kube-apiserver-client` with `client auth` |
| New cert user gets `Forbidden` | Authentication OK, no RBAC | RoleBinding for the user (CN) or group (O) |
| Pod `Pending`: `no preemption victims found` | Only equal/higher-priority Pods there, or PDBs block it, or the Pod is too big for any node | Lower other priorities, check requests, add nodes |
| `no PriorityClass with name X was found` | Class not created or name typo | `kubectl get priorityclass` |
| Important Pods keep getting evicted | They have low/no priority while others are higher | Give them a higher PriorityClass; set proper requests |

---

## 23. What I learned

**Certificates**
- Components **talk to each other with certificates**: TLS for **encryption**, client certificates for **authentication**.
- The **API server** is in the middle: a **server** for scheduler, controller manager, kube-proxy, kubelet and kubectl, and a **client** to etcd and kubelets.
- **3 CAs** (kubernetes, etcd, front-proxy) in `/etc/kubernetes/pki`; `ca.key` = keys to the kingdom.
- Certificate **CN = user**, **O = group**; then **RBAC** decides permissions. Certificates **can't be revoked**.
- kubeadm certs last **1 year** (CA 10 years): check and renew with `kubeadm certs`.
- **CSR API** signs user certificates without sharing `ca.key`.
- **EKS:** AWS manages control-plane certs; people use **IAM**.

**Pod Priority**
- **PriorityClass** gives a number; Pods use `priorityClassName`. Higher = scheduled first.
- **Preemption:** when full, lower-priority Pods are evicted for higher ones. `preemptionPolicy: Never` = wait, don't evict.
- System Pods use `system-node-critical` / `system-cluster-critical`; your classes can't beat them.

## 24. Commands

| Command | What it does |
|---|---|
| `openssl x509 -in FILE.crt -noout -subject -issuer -dates` | Read a certificate |
| `openssl s_client -connect HOST:443 </dev/null \| openssl x509 -noout -text` | Read a server's live certificate |
| `kubeadm certs check-expiration` | See when kubeadm certs expire |
| `kubeadm certs renew all` | Renew all kubeadm certs |
| `openssl genrsa -out user.key 2048` | Create a private key |
| `openssl req -new -key user.key -out user.csr -subj "/CN=user/O=group"` | Create a CSR |
| `kubectl get csr` | List CSRs |
| `kubectl certificate approve NAME` | Approve a CSR |
| `kubectl get csr NAME -o jsonpath='{.status.certificate}' \| base64 -d` | Download the signed cert |
| `kubectl config set-credentials USER --client-certificate=… --client-key=… --embed-certs=true` | Add a cert user to kubeconfig |
| `kubectl get priorityclass` | List PriorityClasses |
| `kubectl get pods -o custom-columns=NAME:.metadata.name,PRIORITY:.spec.priority` | See Pod priorities |
| `kubectl get events --field-selector reason=Preempted` | See preemptions |

## 25. Interview Questions

### ⭐ Very Important

**Q1. Why does Kubernetes need certificates (PKI)?**
Kubernetes components talk to each other over the network: the scheduler, controller manager, kube-proxy and kubelets talk to the API server, and the API server talks to etcd and the kubelets. Every connection uses TLS certificates signed by the cluster CA, to encrypt the traffic and to authenticate each component, so nobody can read the data or pretend to be a component.

**Q2. Which components use certificates, and which are servers vs clients?**
The API server, etcd and the kubelet have server certificates. The scheduler, controller manager, kube-proxy, kubelet (to the API server) and admin users have client certificates. The API server is also a client to etcd and the kubelets.

**Q3. What is Pod priority and a PriorityClass?**
Pod priority is a number that says how important a Pod is. A PriorityClass is a cluster-wide object that names a priority value; Pods use it with `priorityClassName`. Higher-priority Pods are scheduled first.

**Q4. What is preemption?**
When a high-priority Pod can't be scheduled because the cluster is full, the scheduler evicts lower-priority Pods from a node to make room, then places the high-priority Pod there.

### Other Questions

**Q5. How does Kubernetes know the user from a client certificate?**
The certificate's CN becomes the username and the O fields become groups. Then RBAC checks RoleBindings for that user or group.

**Q6. What are the CAs in a kubeadm cluster?**
The kubernetes CA (API server, kubelets, components, users), the etcd CA (etcd and its clients) and the front-proxy CA (API aggregation). Files live in `/etc/kubernetes/pki`.

**Q7. What happens when control-plane certificates expire, and how do you fix it?**
kubectl and components fail with `x509: certificate has expired`, and the cluster stops working. On kubeadm, run `kubeadm certs check-expiration`, `kubeadm certs renew all`, restart the control-plane Pods and update `admin.conf`. Upgrading with kubeadm also renews them.

**Q8. How do you create a new user with a certificate?**
Create a private key and a CSR with `CN=<user>` and `O=<group>`, submit a CertificateSigningRequest with signer `kubernetes.io/kube-apiserver-client`, approve it, download the certificate, add it to kubeconfig, and create a RoleBinding.

**Q9. Can you revoke a Kubernetes client certificate?**
No, Kubernetes has no certificate revocation. It stays valid until it expires. You remove the user's RBAC bindings, use short expirations, or prefer OIDC/IAM for people.

**Q10. Why must `ca.key` and `system:masters` be protected?**
With `ca.key` anyone can sign a certificate for any user, including the `system:masters` group, which bypasses RBAC and is full cluster-admin.

**Q11. How are certificates handled on EKS?**
AWS creates, stores and rotates the control-plane certificates. The cluster CA is in kubeconfig as `certificate-authority-data`. Users authenticate with IAM tokens (`aws eks get-token`) and access entries, not client certificates.

**Q12. What is in kubeconfig related to certificates?**
`certificate-authority-data` to trust the API server, and for certificate users `client-certificate-data` and `client-key-data` to prove who they are.

**Q13. What are system-node-critical and system-cluster-critical?**
Built-in PriorityClasses with values above 2 billion for critical system Pods (kube-proxy, CNI, coredns). User classes max out at 1 billion, so apps can't preempt them.

**Q14. What does `preemptionPolicy: Never` do?**
The Pod moves ahead of lower-priority Pods in the scheduling queue but never evicts running Pods; it waits until room is free.

**Q15. Priority vs QoS class?**
Priority (PriorityClass) is used by the scheduler for order and preemption. QoS (from requests/limits) is used by the kubelet when a node is under memory pressure. Node eviction considers usage above requests first, then priority.

**Q16. What does globalDefault do?**
It makes that PriorityClass the default for Pods without a `priorityClassName`. Only one class can be the global default; without one, those Pods get priority 0.

**Q17. How do you stop teams from giving every Pod the highest priority?**
Use a ResourceQuota with a `scopeSelector` on PriorityClass to limit how many high-priority Pods a namespace can run, or an admission policy (Kyverno/Gatekeeper) to allow high classes only in certain namespaces.

**Source:** [PKI certificates and requirements](https://kubernetes.io/docs/setup/best-practices/certificates/) · [Certificate management with kubeadm](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/) · [Certificates and CSRs](https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/) · [Pod priority and preemption](https://kubernetes.io/docs/concepts/scheduling-eviction/pod-priority-preemption/) · [EKS certificate signing](https://docs.aws.amazon.com/eks/latest/userguide/cert-signing.html)
