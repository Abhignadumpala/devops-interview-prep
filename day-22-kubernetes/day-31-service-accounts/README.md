# Day 31 - ServiceAccounts: Identity for Pods

[← Kubernetes notes](../README.md)

> **In short:** a **ServiceAccount** is the **identity of an application running in a Pod**. People log in as **users**; Pods talk to the API server as a **ServiceAccount**. Every namespace has a **`default`** ServiceAccount, but real apps should get their **own** ServiceAccount with only the permissions they need (through RBAC, [Day 30](../day-30-rbac/README.md)). One word: **identity**.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | What a ServiceAccount is, user vs ServiceAccount, the `default` ServiceAccount, custom ServiceAccounts, tokens, `automountServiceAccountToken`, RBAC, AWS access with Pod Identity / IRSA, when to use, CKA/CKAD tasks | Why Pods need an identity and how to give them a safe one |
| **Part 2: Lab** | Look at `default`, create a custom ServiceAccount, run a Pod with it, read the token, call the API, turn off the token, change a Deployment's ServiceAccount, create a short-lived token | Do every ServiceAccount task on EKS |

> **Before this:** [Day 30 - RBAC](../day-30-rbac/README.md) (Role, RoleBinding, ClusterRole, ClusterRoleBinding).

## Table of Contents

**Part 1: Concepts**
1. [What is a ServiceAccount?](#1-what-is-a-serviceaccount)
2. [User account vs ServiceAccount](#2-user-account-vs-serviceaccount)
3. [The `default` ServiceAccount](#3-the-default-serviceaccount)
4. [Custom ServiceAccounts: better security](#4-custom-serviceaccounts-better-security)
5. [The token: how a Pod proves who it is](#5-the-token-how-a-pod-proves-who-it-is)
6. [Turning the token off: `automountServiceAccountToken`](#6-turning-the-token-off-automountserviceaccounttoken)
7. [ServiceAccount + RBAC: only the permissions it needs](#7-serviceaccount--rbac-only-the-permissions-it-needs)
8. [ServiceAccount + AWS: Pod Identity and IRSA](#8-serviceaccount--aws-pod-identity-and-irsa)
9. [When to use which: real scenarios](#9-when-to-use-which-real-scenarios)
10. [ServiceAccounts in CKA and CKAD](#10-serviceaccounts-in-cka-and-ckad)

**Part 2: Lab**

11. [Lab setup](#11-lab-setup)
12. [Lab A: The `default` ServiceAccount](#12-lab-a-the-default-serviceaccount)
13. [Lab B: Custom ServiceAccount + Pod](#13-lab-b-custom-serviceaccount--pod)
14. [Lab C: Look inside the token](#14-lab-c-look-inside-the-token)
15. [Lab D: Give it permissions with RBAC and call the API](#15-lab-d-give-it-permissions-with-rbac-and-call-the-api)
16. [Lab E: Turn the token off](#16-lab-e-turn-the-token-off)
17. [Lab F: Change a Deployment's ServiceAccount](#17-lab-f-change-a-deployments-serviceaccount)
18. [Lab G: Create a short-lived token](#18-lab-g-create-a-short-lived-token)
19. [Clean up](#19-clean-up)

**Wrap-up**

20. [Troubleshooting](#20-troubleshooting)
21. [What I learned](#21-what-i-learned)
22. [Commands](#22-commands)
23. [Interview Questions](#23-interview-questions)

---

# Part 1: Concepts

## 1. What is a ServiceAccount?

**Definition:** a **ServiceAccount** is a Kubernetes object that gives an **identity to the applications running inside Pods**, so they can talk to the API server **securely**. It's like an employee ID card for a Pod.

```
 Pod (serviceAccountName: app-sa)
   │  token file mounted automatically
   │  /var/run/secrets/kubernetes.io/serviceaccount/token
   ▼
 API server
   ① Authentication: "you are system:serviceaccount:shop:app-sa"   ← identity
   ② Authorization (RBAC): "app-sa may list pods in shop"          ← permissions
```

**Why Pods need an identity:** many apps call the Kubernetes API, not just humans:

| App | What it does with the API |
|---|---|
| **Argo CD** | Creates and updates Deployments, Services… |
| **Prometheus** | Lists Pods, Services and Nodes to find what to scrape |
| **AWS Load Balancer Controller** | Watches Ingresses and creates ALBs |
| **Karpenter / Cluster Autoscaler** | Watches pending Pods, adds nodes |
| **CI/CD deployer** (Jenkins agent in the cluster) | Deploys into one namespace |

Without an identity the API server can't know **who** is calling, so it can't decide **what** they may do.

> **Interview one-liner:** a ServiceAccount is the identity of an app running in a Pod; the Pod gets its token automatically, the API server authenticates it as `system:serviceaccount:<ns>:<name>`, and RBAC decides what it can do.

### Simple example: third-party tools like Argo CD, Prometheus and Grafana

**Third-party tools** are apps that someone else built, which we install in our cluster (usually with Helm). Argo CD, Prometheus and Grafana are examples. They run as Pods, and they need to **work with the Kubernetes cluster**: deploy apps, read Pods, watch changes.

But Kubernetes doesn't trust any Pod by default. So we:

1. **Give the tool an identity:** a **ServiceAccount**, like an ID card.
2. **Give that identity permissions:** with **RBAC** (Role / ClusterRole + binding).
3. The tool shows its ID card (the token) on every call. Kubernetes checks the card and the permissions, then allows or blocks the call.

```
  Argo CD Pod ──► ID card: ServiceAccount "argocd-application-controller"
                       │
                       ▼
                  RBAC: "may create / update / delete apps in the cluster"
                       │
                       ▼
                  Kubernetes API ──► Deployments, Services… created ✅
```

| Tool | What it needs to do in the cluster | Why it needs a ServiceAccount |
|---|---|---|
| **Argo CD** | **Deploy our apps**: create, update and delete Deployments, Services, ConfigMaps… from Git | Without permissions, Argo CD can't deploy anything |
| **Prometheus** | **Find and read** Pods, Services and Nodes to collect their metrics | Without permissions, it can't find what to monitor |
| **Grafana** (kube-prometheus-stack) | Its helper container **reads ConfigMaps** to load dashboards and data sources automatically | Without permissions, the dashboards don't load automatically |
| **AWS Load Balancer Controller** | **Watch Ingresses** and create ALBs | Without permissions, it can't see new Ingresses |

> **Good news:** when we install these tools with **Helm**, the chart **creates the ServiceAccount and the RBAC for us**. We can see them with `kubectl get sa -n argocd` and `kubectl get clusterrolebindings | grep argocd`.

**In simple words:**
- Third-party tools like **Argo CD, Prometheus and Grafana** need to **work with the Kubernetes cluster**.
- We give them permissions through a **ServiceAccount**: the ServiceAccount is **who they are**, and RBAC is **what they're allowed to do**.
- Example: the ServiceAccount + RBAC let **Argo CD deploy apps** in the cluster, and let **Prometheus read Pods** to monitor them.
- If we don't name one, a Pod runs with the namespace's **`default`** ServiceAccount. For **better security**, every tool gets its **own custom ServiceAccount** with **only the permissions it needs**.

> **Interview one-liner:** third-party tools like Argo CD, Prometheus and Grafana run as Pods and need to talk to the Kubernetes API, so each gets its own ServiceAccount as its identity, and RBAC gives it only what it needs: Argo CD can deploy apps, Prometheus can read Pods and Nodes to monitor them.

---

## 2. User account vs ServiceAccount

| | User account | ServiceAccount |
|---|---|---|
| **For** | Humans (and outside tools) | Apps running **in Pods** |
| **Kubernetes object?** | ❌ No. Comes from outside (EKS: AWS IAM + access entry) | ✅ Yes. `kubectl create serviceaccount` |
| **Scope** | Cluster-wide | **Namespaced** (belongs to one namespace) |
| **Name in RBAC** | `abhi`, group `dev-team` | `system:serviceaccount:<ns>:<name>` |
| **Login with** | IAM credentials / kubeconfig | Token mounted into the Pod |
| **Example** | DevOps engineer running `kubectl` | Prometheus Pod listing Pods |

---

## 3. The `default` ServiceAccount

**Definition:** **every namespace gets a ServiceAccount called `default` automatically**. If a Pod doesn't set `serviceAccountName`, Kubernetes gives it `default`.

| Fact | Detail |
|---|---|
| Created by | Kubernetes, when the namespace is created |
| Used when | Pod spec has no `serviceAccountName` |
| Permissions | Almost none by default (only basic API discovery) |
| Can you delete it? | It's recreated automatically |

**Check it:** create any namespace, then list its ServiceAccounts:

```bash
kubectl create namespace test
```

```bash
kubectl get sa -n test
```

**Expected:**

```
NAME      AGE
default   5s
```

We never created it. Kubernetes adds `default` to **every** namespace (`default`, `kube-system`, `argocd`… all have one). `sa` is the short name for `serviceaccount`; without `-n` it shows the current namespace, and `kubectl get sa -A` shows all namespaces.

**Why not just use `default`?**

| Problem | What happens |
|---|---|
| **Shared by every Pod** in the namespace | Give `default` a permission for one app → **every** Pod there gets it |
| **No clear owner** | Audit logs say `default` did it, not which app |
| **Token mounted anyway** | Pods that never call the API still carry a usable token |

---

## 4. Custom ServiceAccounts: better security

**Definition:** a **custom ServiceAccount** is one you create **for a single app**, so it gets only that app's permissions.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: catalogue-sa
  namespace: shop
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: catalogue
  namespace: shop
spec:
  replicas: 2
  selector:
    matchLabels: { app: catalogue }
  template:
    metadata:
      labels: { app: catalogue }
    spec:
      serviceAccountName: catalogue-sa      # ← the identity
      containers:
      - name: catalogue
        image: nginx
```

| Default SA | Custom SA per app |
|---|---|
| All Pods share one identity | Each app has its own identity |
| One permission leaks to all Pods | Permissions only for that app |
| Audit says "default" | Audit says "catalogue-sa" |

### Create a ServiceAccount in a namespace: step by step

Example: a `jenkins` ServiceAccount in the `prod` namespace.

**Step 1: Create the namespace**

```bash
kubectl create ns prod
```

**Expected:** `namespace/prod created`

**Step 2: Switch your current namespace to prod** (so you don't need `-n prod` every time)

```bash
kubectl config set-context --current --namespace=prod
```

**Expected:** `Context "<your-context>" modified.`

**Step 3: See the default ServiceAccount**

```bash
kubectl get sa
```

**Expected:** only `default`. Kubernetes created it with the namespace.

**Step 4: Dry run: test the command without creating anything**

```bash
kubectl create sa jenkins -n prod --dry-run=client
```

**Expected:** `serviceaccount/jenkins created (dry run)`. Nothing is created; `--dry-run=client` only checks the command on your machine.

**Step 5: Generate the YAML into a file**

```bash
kubectl create sa jenkins -n prod --dry-run=client -o yaml > sa.yml
```

**What it does:** `-o yaml` prints the object as YAML, `> sa.yml` saves it. Still nothing created in the cluster.

**Step 6: Look at the file**

```bash
cat sa.yml
```

**Expected:**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  creationTimestamp: null
  name: jenkins
  namespace: prod
```

**Step 7: Create it from the file**

```bash
kubectl apply -f sa.yml
```

**Expected:** `serviceaccount/jenkins created`

**Step 8: Check**

```bash
kubectl get sa
```

**Expected:** `default` and `jenkins` ✅

> `kubectl create -f sa.yml` also works. The difference: `create` fails if the object already exists, while `apply` creates it or updates it, so `apply` is safe to run again.

### Give the jenkins ServiceAccount permissions: Role + RoleBinding

The ServiceAccount is only an **identity**. Right now `jenkins` can do nothing. We give it permission to **create, get and list Pods in prod**.

**Step 9: Check: can jenkins list Pods yet?**

```bash
kubectl auth can-i list pods -n prod --as=system:serviceaccount:prod:jenkins
```

**Expected:** `no`

**Step 10: Generate the Role YAML**

```bash
kubectl create role jenkinsrole --resource=pods --verb=create,get,list --namespace=prod --dry-run=client -o yaml > jenkinsrole.yml
```

**What it does:** writes a Role named `jenkinsrole` that allows `create`, `get`, `list` on `pods` in `prod`.

**Step 11: Look at it**

```bash
cat jenkinsrole.yml
```

**Expected:**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  creationTimestamp: null
  name: jenkinsrole
  namespace: prod
rules:
- apiGroups:
  - ""
  resources:
  - pods
  verbs:
  - create
  - get
  - list
```

**Step 12: Create the Role**

```bash
kubectl create -f jenkinsrole.yml
```

**Expected:** `role.rbac.authorization.k8s.io/jenkinsrole created`

**Step 13: Generate the RoleBinding YAML** (attaches the Role to the jenkins ServiceAccount)

```bash
kubectl create rolebinding jenkinsrolebinding --role=jenkinsrole --serviceaccount=prod:jenkins --namespace=prod --dry-run=client -o yaml > jenkinsrolebinding.yml
```

**What it does:** `--role=jenkinsrole` is **what**, `--serviceaccount=prod:jenkins` is **who** (format `namespace:name`).

**Step 14: Create the RoleBinding**

```bash
kubectl create -f jenkinsrolebinding.yml -n prod
```

**Expected:** `rolebinding.rbac.authorization.k8s.io/jenkinsrolebinding created`

**Step 15: Check again**

```bash
kubectl auth can-i list pods -n prod --as=system:serviceaccount:prod:jenkins
```

**Expected:** `yes` ✅

**Step 16: Can it delete Pods?**

```bash
kubectl auth can-i delete pods -n prod --as=system:serviceaccount:prod:jenkins
```

**Expected:** `no` ✅. Only create, get, list were given.

```
 ServiceAccount jenkins  ◄── RoleBinding jenkinsrolebinding ──►  Role jenkinsrole
 (who)                                                          (create/get/list pods in prod)
```

### Real time: the ServiceAccount needs a token

**Note:** to work in real time, a ServiceAccount needs a **token** to talk to the Kubernetes cluster. The token is like the password of the ID card: whoever sends it is treated as `jenkins`.

| Where Jenkins runs | How it gets the token |
|---|---|
| **Inside the cluster** (Jenkins agent Pod with `serviceAccountName: jenkins`) | **Automatic.** Kubernetes mounts a short-lived token into the Pod. Nothing to do |
| **Outside the cluster** (Jenkins on an EC2 server) | We create a token and put it in Jenkins credentials / its kubeconfig |

**Step 17: Create a short-lived token (outside-cluster use)**

```bash
kubectl create token jenkins -n prod --duration=1h
```

**Expected:** a long `eyJ...` string, valid for 1 hour. Jenkins sends it as `Authorization: Bearer <token>`.

**Long-lived token (only if a tool really needs one):** a Secret of type `kubernetes.io/service-account-token`. Kubernetes fills in the token, and it **never expires** until the Secret is deleted.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: jenkins-token
  namespace: prod
  annotations:
    kubernetes.io/service-account.name: jenkins
type: kubernetes.io/service-account-token
```

> ⚠️ A never-expiring token is risky if it leaks. Prefer a Pod inside the cluster (automatic token) or short-lived tokens. On EKS, Jenkins outside the cluster usually logs in with an **IAM role + EKS access entry** instead of a ServiceAccount token.

| Way | Command | When |
|---|---|---|
| **Imperative** (direct) | `kubectl create sa jenkins -n prod` | Quick tests, CKA/CKAD exam |
| **Declarative** (YAML file) | `--dry-run=client -o yaml > sa.yml`, then `kubectl apply -f sa.yml` | Real projects: the file goes to Git, Argo CD / Helm applies it |

> **Exam tip:** `--dry-run=client -o yaml > file.yml` works for almost every `kubectl create` (deployment, role, rolebinding…). It's the fastest way to get a correct YAML to edit.

> Switch back to the default namespace later with `kubectl config set-context --current --namespace=default`.

> ⚠️ `serviceAccountName` **can't be changed on a running Pod**. Change it in the Deployment; the Deployment rolls out new Pods.

---

## 5. The token: how a Pod proves who it is

**Definition:** a **ServiceAccount token** is a signed **JWT** that the Pod sends to the API server as `Authorization: Bearer <token>`. Kubernetes mounts it into every container at:

```
/var/run/secrets/kubernetes.io/serviceaccount/
├── token       # the JWT
├── ca.crt      # to trust the API server's certificate
└── namespace   # the Pod's namespace
```

| | Old way (before Kubernetes 1.24) | Now (bound / projected tokens) |
|---|---|---|
| **Stored in** | A Secret, created automatically | Not stored; created by the kubelet for the Pod |
| **Expires?** | ❌ Never | ✅ Yes (about 1 hour, refreshed automatically by the kubelet) |
| **Tied to the Pod?** | ❌ Works anywhere if stolen | ✅ Invalid once the Pod is deleted |
| **Manual token** | Read the Secret | `kubectl create token <sa>` (short-lived) |

> A stolen token now stops working soon, and as soon as the Pod is gone. That's a big security improvement.

---

## 6. Turning the token off: `automountServiceAccountToken`

**Definition:** `automountServiceAccountToken: false` **stops Kubernetes from mounting the token** into the Pod. Most apps (a website, an API, a database) **never** call the Kubernetes API, so they don't need it.

```yaml
# on the Pod (wins)
spec:
  automountServiceAccountToken: false
```

```yaml
# or on the ServiceAccount (all Pods using it)
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web-sa
automountServiceAccountToken: false
```

| App type | Token needed? |
|---|---|
| nginx, catalogue, payment, MySQL | ❌ No → turn it off |
| Argo CD, Prometheus, controllers, operators | ✅ Yes |

> If a hacker gets a shell in a Pod, the first thing they look for is that token. No token = nothing to steal.

---

## 7. ServiceAccount + RBAC: only the permissions it needs

**Definition:** a ServiceAccount by itself is **only an identity**, with almost no permissions. **RBAC** gives it permissions ([Day 30](../day-30-rbac/README.md)).

```
 ServiceAccount (who)  ◄──  RoleBinding  ──►  Role (what)
    reporter-sa                                get, list pods in shop
```

```yaml
subjects:
- kind: ServiceAccount
  name: reporter-sa
  namespace: shop        # always give the SA's namespace
```

**Least privilege rule:** applications should get **only the permissions they need**, no more:

| ❌ Bad | ✅ Good |
|---|---|
| `cluster-admin` "so it just works" | A Role with the exact verbs and resources |
| Permissions on the `default` SA | A custom SA per app |
| ClusterRoleBinding for an app that works in one namespace | RoleBinding in that namespace |

---

## 8. ServiceAccount + AWS: Pod Identity and IRSA

RBAC covers the **Kubernetes** API. When a Pod needs **AWS** (S3, Secrets Manager, DynamoDB), on EKS we link its ServiceAccount to an **IAM role**, so no AWS access keys are stored in the Pod.

| | **EKS Pod Identity** (newer, simpler) | **IRSA** (IAM Roles for Service Accounts) |
|---|---|---|
| Setup | Install the Pod Identity Agent add-on, create a **pod identity association** (cluster + namespace + SA → IAM role) | Create an OIDC provider, trust policy with the SA name, annotate the SA with the role ARN |
| SA change | None | `eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role>` annotation |
| Use | New clusters | Older clusters, still very common |

```
 Pod ── SA: payment-sa ── linked to ──► IAM role payment-role ──► Secrets Manager / S3
         (Kubernetes identity)            (AWS identity, temporary credentials)
```

> **Interview one-liner:** on EKS the ServiceAccount is the bridge to AWS: with Pod Identity or IRSA it maps to an IAM role, so the Pod gets temporary AWS credentials for that role only and no keys live in the image or Secrets.

---

## 9. When to use which: real scenarios

| Scenario | What to do |
|---|---|
| A normal web/API app that never calls Kubernetes | Custom SA (or default) + `automountServiceAccountToken: false` |
| An app that lists Pods in its namespace | Custom SA + Role + RoleBinding |
| Prometheus reads Pods/Nodes everywhere | Custom SA + ClusterRole + ClusterRoleBinding |
| Payment Pod reads a password from AWS Secrets Manager | Custom SA + Pod Identity / IRSA → IAM role |
| Pull images from a private registry | Add `imagePullSecrets` to the SA, all its Pods use them |
| A CI tool outside the cluster needs a token for a quick job | `kubectl create token deployer-sa --duration=1h` |

---

## 10. ServiceAccounts in CKA and CKAD

ServiceAccounts are common exam tasks. Practise these until they're fast:

| Task | Command / field |
|---|---|
| Create a ServiceAccount | `kubectl create sa NAME -n NS` |
| Get its YAML without creating it | `kubectl create sa NAME -n NS --dry-run=client -o yaml > sa.yml` |
| Switch current namespace | `kubectl config set-context --current --namespace=NS` |
| Run a Pod with it | `serviceAccountName: NAME` in the Pod spec |
| Change a Deployment's SA | `kubectl set serviceaccount deployment/NAME SA -n NS` |
| Disable the token | `automountServiceAccountToken: false` |
| Give it permissions | `kubectl create role` + `kubectl create rolebinding --serviceaccount=NS:SA` |
| Check its permissions | `kubectl auth can-i list pods -n NS --as=system:serviceaccount:NS:SA` |
| Get a token | `kubectl create token SA -n NS` |
| Which SA does a Pod use? | `kubectl get pod NAME -o jsonpath='{.spec.serviceAccountName}'` |

---

# Part 2: Lab

## 11. Lab setup

**Prereqs:** an EKS cluster and `kubectl` from the bastion as cluster admin ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)).

**Step 1: Create a namespace**

```bash
kubectl create namespace sa-lab
```

---

## 12. Lab A: The `default` ServiceAccount

**Step 1: List ServiceAccounts in the new namespace**

```bash
kubectl get serviceaccounts -n sa-lab
```

**Expected:** `default` already exists ✅. We didn't create it.

**Step 2: Run a Pod without a ServiceAccount**

```bash
kubectl run plain -n sa-lab --image=nginx
```

**Step 3: Check which ServiceAccount it got**

```bash
kubectl get pod plain -n sa-lab -o jsonpath='{.spec.serviceAccountName}{"\n"}'
```

**Expected:** `default` ✅

**Step 4: See that the token is mounted**

```bash
kubectl exec plain -n sa-lab -- ls /var/run/secrets/kubernetes.io/serviceaccount
```

**Expected:** `ca.crt  namespace  token` ✅. The token is there even though nginx never uses it.

---

## 13. Lab B: Custom ServiceAccount + Pod

**Step 1: Create the ServiceAccount**

```bash
kubectl create serviceaccount reporter-sa -n sa-lab
```

**Step 2: Create the file `reporter-pod.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: reporter
  namespace: sa-lab
spec:
  serviceAccountName: reporter-sa
  containers:
  - name: curl
    image: curlimages/curl:8.10.1
    command: ["sleep", "36000"]
```

**Step 3: Apply it**

```bash
kubectl apply -f reporter-pod.yaml
```

**Step 4: Check its ServiceAccount**

```bash
kubectl get pod reporter -n sa-lab -o jsonpath='{.spec.serviceAccountName}{"\n"}'
```

**Expected:** `reporter-sa` ✅

**Step 5: Try to change it on the running Pod**

```bash
kubectl patch pod reporter -n sa-lab -p '{"spec":{"serviceAccountName":"default"}}'
```

**Expected:** an error `spec: Forbidden: pod updates may not change fields other than ...` ✅. A Pod's ServiceAccount is fixed.

---

## 14. Lab C: Look inside the token

**Step 1: Print the token's payload (middle part of the JWT)**

```bash
kubectl exec reporter -n sa-lab -- cat /var/run/secrets/kubernetes.io/serviceaccount/token | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null; echo
```

**Expected:** JSON with:

| Field | Value | Meaning |
|---|---|---|
| `sub` | `system:serviceaccount:sa-lab:reporter-sa` | Who the token is |
| `kubernetes.io.pod.name` | `reporter` | Tied to this Pod |
| `exp` | A time in the future | It expires |
| `aud` | The cluster's API server / OIDC issuer | Who should accept it |

> `base64 -d` may complain about missing padding at the end; the JSON is still readable.

**Step 2: Confirm no Secret holds the token**

```bash
kubectl get secrets -n sa-lab
```

**Expected:** `No resources found` ✅. Modern tokens aren't stored in Secrets.

---

## 15. Lab D: Give it permissions with RBAC and call the API

**Step 1: Before RBAC, can it list Pods?**

```bash
kubectl auth can-i list pods -n sa-lab --as=system:serviceaccount:sa-lab:reporter-sa
```

**Expected:** `no`. A new ServiceAccount is only an identity.

**Step 2: Create a Role**

```bash
kubectl create role pod-reader -n sa-lab --verb=get,list,watch --resource=pods
```

**Step 3: Bind it to the ServiceAccount**

```bash
kubectl create rolebinding reporter-pod-reader -n sa-lab --role=pod-reader --serviceaccount=sa-lab:reporter-sa
```

**Step 4: Check again**

```bash
kubectl auth can-i list pods -n sa-lab --as=system:serviceaccount:sa-lab:reporter-sa
```

**Expected:** `yes` ✅

**Step 5: Open a shell in the Pod**

```bash
kubectl exec -it reporter -n sa-lab -- sh
```

**Step 6: Set the token path (inside the Pod)**

```sh
SA=/var/run/secrets/kubernetes.io/serviceaccount
```

**Step 7: List Pods using the Pod's own identity**

```sh
curl -s --cacert $SA/ca.crt -H "Authorization: Bearer $(cat $SA/token)" https://kubernetes.default.svc/api/v1/namespaces/sa-lab/pods | grep '"name": "' | head
```

**Expected:** `plain` and `reporter` ✅

**Step 8: Try to list Services (not allowed)**

```sh
curl -s --cacert $SA/ca.crt -H "Authorization: Bearer $(cat $SA/token)" https://kubernetes.default.svc/api/v1/namespaces/sa-lab/services
```

**Expected:** `"code": 403`, `cannot list resource "services"` ✅. Only the permissions it needs.

**Step 9: Leave the Pod**

```sh
exit
```

---

## 16. Lab E: Turn the token off

**Step 1: Create the file `web-no-token.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: web
  namespace: sa-lab
spec:
  automountServiceAccountToken: false
  containers:
  - name: nginx
    image: nginx
```

**Step 2: Apply it**

```bash
kubectl apply -f web-no-token.yaml
```

**Step 3: Look for the token**

```bash
kubectl exec web -n sa-lab -- ls /var/run/secrets/kubernetes.io/serviceaccount
```

**Expected:** `No such file or directory` ✅. Nothing to steal.

---

## 17. Lab F: Change a Deployment's ServiceAccount

**Step 1: Create a Deployment (uses `default`)**

```bash
kubectl create deployment app -n sa-lab --image=nginx --replicas=2
```

**Step 2: Create a ServiceAccount for it**

```bash
kubectl create serviceaccount app-sa -n sa-lab
```

**Step 3: Switch the Deployment to it**

```bash
kubectl set serviceaccount deployment/app app-sa -n sa-lab
```

**Step 4: Watch the rollout**

```bash
kubectl rollout status deployment/app -n sa-lab
```

**Expected:** new Pods replace the old ones (the Pod template changed).

**Step 5: Check the new Pods**

```bash
kubectl get pods -n sa-lab -l app=app -o custom-columns=NAME:.metadata.name,SA:.spec.serviceAccountName
```

**Expected:** both Pods show `app-sa` ✅

---

## 18. Lab G: Create a short-lived token

**Step 1: Create a 10-minute token**

```bash
kubectl create token reporter-sa -n sa-lab --duration=10m
```

**Expected:** a long `eyJ...` string. It's not saved anywhere and expires in 10 minutes ✅.

> Use this for a quick external job. Never put a long-lived token in Git or a CI variable.

---

## 19. Clean up

```bash
kubectl delete namespace sa-lab
```

Deleting the namespace removes the ServiceAccounts, Pods, Deployment, Role and RoleBinding.

---

# Wrap-up

## 20. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `error looking up service account sa-lab/xyz: serviceaccount "xyz" not found` (Pods not created) | SA doesn't exist in **that** namespace | Create it in the Pod's namespace |
| App gets `403 Forbidden` from the API | SA has no RBAC permission | Role + RoleBinding for the SA |
| RoleBinding exists but still 403 | Subject `namespace` wrong, or binding in another namespace | Subject must be `kind: ServiceAccount`, correct `name` + `namespace` |
| App can't find the token file | `automountServiceAccountToken: false` | Turn it on for apps that call the API |
| Can't change `serviceAccountName` | Fixed on a running Pod | Change the Deployment (`kubectl set serviceaccount`) |
| Pod gets no AWS permissions (`AccessDenied` / uses node role) | No Pod Identity association / IRSA annotation, or wrong SA name | Check association or annotation matches namespace + SA |

---

## 21. What I learned

**Concepts**
- ServiceAccount = **identity** for apps in Pods. Users are for humans.
- Every namespace has a **`default`** SA; Pods without `serviceAccountName` use it.
- Use a **custom SA per app** so permissions don't leak to other Pods.
- The token is a **short-lived JWT**, tied to the Pod, mounted automatically.
- `automountServiceAccountToken: false` for apps that never call the API.
- SA alone = identity only. **RBAC** gives permissions. **Pod Identity / IRSA** gives AWS access.

**Lab**
- `kubectl get sa`, `serviceAccountName`, `kubectl set serviceaccount`, `kubectl create token`.
- A Pod's SA can't change; the Deployment rolls out new Pods.
- A real Pod gets `403` for anything RBAC didn't allow.

```
 Pod ──► ServiceAccount ──► RBAC Role ──► Kubernetes API
                  └──────► IAM role (Pod Identity / IRSA) ──► AWS
```

## 22. Commands

| Command | What it does |
|---|---|
| `kubectl get sa -n NS` | List ServiceAccounts |
| `kubectl create sa NAME -n NS` | Create a ServiceAccount |
| `kubectl describe sa NAME -n NS` | Details (annotations, image pull secrets) |
| `kubectl get pod P -o jsonpath='{.spec.serviceAccountName}'` | Which SA a Pod uses |
| `kubectl set serviceaccount deployment/D SA -n NS` | Change a Deployment's SA |
| `kubectl create token SA -n NS --duration=10m` | Short-lived token |
| `kubectl auth can-i VERB RES -n NS --as=system:serviceaccount:NS:SA` | Test SA permissions |
| `kubectl create rolebinding RB --role=R --serviceaccount=NS:SA -n NS` | Give an SA a Role |

## 23. Interview Questions

### ⭐ Very Important

**Q1. What is a ServiceAccount?**
The identity of an application running inside a Pod. Pods use it to access cluster resources securely: the API server authenticates the Pod's token as `system:serviceaccount:<ns>:<name>` and RBAC decides what it may do.

**Q2. What is the `default` ServiceAccount?**
Every namespace gets one automatically, and any Pod without `serviceAccountName` uses it. It has almost no permissions.

**Q3. Why should we use custom ServiceAccounts instead of `default`?**
For better security. `default` is shared by every Pod in the namespace, so any permission given to it goes to all of them. A custom SA per app gives each app only the permissions it needs and makes audit logs clear.

**Q4. How do you give a ServiceAccount only the permissions it needs?**
Create a Role (or ClusterRole) with the exact verbs and resources, and bind it to the SA with a RoleBinding in its namespace (ClusterRoleBinding only if it needs every namespace).

### Other Questions

**Q5. User account vs ServiceAccount?**
User accounts are for humans, aren't Kubernetes objects and come from outside (IAM on EKS). ServiceAccounts are namespaced Kubernetes objects for apps in Pods.

**Q6. How does a Pod get its token?**
The kubelet mounts a projected, short-lived JWT at `/var/run/secrets/kubernetes.io/serviceaccount/token`, with `ca.crt` and `namespace`. It expires and refreshes automatically and becomes invalid when the Pod is deleted. Since 1.24 no long-lived Secret token is created automatically.

**Q7. What does `automountServiceAccountToken: false` do and when do you use it?**
It stops the token from being mounted. Use it for apps that never call the Kubernetes API (web, API, DB), so a compromised container has no token to steal.

**Q8. Can you change the ServiceAccount of a running Pod?**
No, the field is immutable. Change it in the Deployment (`kubectl set serviceaccount`) and it rolls out new Pods.

**Q9. How does a Pod on EKS access AWS services without access keys?**
Link its ServiceAccount to an IAM role with EKS Pod Identity (pod identity association) or IRSA (OIDC + role ARN annotation). The Pod gets temporary credentials for that role only.

**Q10. How do you test what a ServiceAccount can do?**
`kubectl auth can-i <verb> <resource> -n <ns> --as=system:serviceaccount:<ns>:<sa>`, or `--list` for everything.

**Q11. How do you get a token for a ServiceAccount to use outside the cluster?**
`kubectl create token <sa> -n <ns> --duration=1h`. It's short-lived and not stored. Avoid long-lived Secret-based tokens.

**Q12. A Deployment's Pods are not being created and the events say the service account was not found. Why?**
The `serviceAccountName` doesn't exist in that namespace (SAs are namespaced). Create it there or fix the name.

**Source:** [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) · [Configure Service Accounts for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/) · [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) · [IRSA](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html)
