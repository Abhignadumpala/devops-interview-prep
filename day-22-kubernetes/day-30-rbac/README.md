# Day 30 - RBAC: Role, RoleBinding, ClusterRole and ClusterRoleBinding

[← Kubernetes notes](../README.md)

> **In short:** **RBAC (Role-Based Access Control)** decides **who can do what** in a Kubernetes cluster. A **Role** or **ClusterRole** is a **list of allowed actions** (for example "get and list Pods"). A **RoleBinding** or **ClusterRoleBinding** **gives that list to someone**: a user, a group or a ServiceAccount. The "Cluster" versions work **across the whole cluster**; the plain versions work **inside one namespace**.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | What RBAC is and why, subjects, rules (apiGroups / resources / verbs), Role, RoleBinding, ClusterRole, ClusterRoleBinding, the 4 combinations, built-in roles, ServiceAccounts, when to use which | What each object is, why we need it and when to pick it |
| **Part 2: Lab** | A read-only ServiceAccount (Role + RoleBinding), a node reader (ClusterRole + ClusterRoleBinding), reusing a ClusterRole in one namespace, a Pod calling the API with its ServiceAccount | Create each object on EKS and prove it with `kubectl auth can-i` |

> **Next:** [Day 31 - ServiceAccounts and Security Context](../day-31-service-accounts/README.md). Related: how the bastion got admin access (EKS access entry + `cluster-admin`) is in [Day 23](../day-23-eks-terraform-helm-argocd/README.md). Admission controllers, which run **after** RBAC, are in [Day 28](../day-28-kustomize-admission-controllers-crds/README.md).

## Table of Contents

**Part 1: Concepts**
1. [What is RBAC and why do we need it?](#1-what-is-rbac-and-why-do-we-need-it)
2. [Subjects: who gets the permission](#2-subjects-who-gets-the-permission)
3. [Rules: apiGroups, resources and verbs](#3-rules-apigroups-resources-and-verbs)
4. [Role](#4-role)
5. [RoleBinding](#5-rolebinding)
6. [ClusterRole](#6-clusterrole)
7. [ClusterRoleBinding](#7-clusterrolebinding)
8. [The 4 combinations](#8-the-4-combinations)
9. [Built-in ClusterRoles](#9-built-in-clusterroles)
10. [ServiceAccounts with RBAC](#10-serviceaccounts-with-rbac)
11. [When to use which: real scenarios](#11-when-to-use-which-real-scenarios)

**Part 2: Lab**

12. [Lab setup](#12-lab-setup)
13. [Lab A: Read-only ServiceAccount (Role + RoleBinding)](#13-lab-a-read-only-serviceaccount-role--rolebinding)
14. [Lab B: Node reader (ClusterRole + ClusterRoleBinding)](#14-lab-b-node-reader-clusterrole--clusterrolebinding)
15. [Lab C: Reuse a ClusterRole in one namespace (ClusterRole + RoleBinding)](#15-lab-c-reuse-a-clusterrole-in-one-namespace-clusterrole--rolebinding)
16. [Lab D: A Pod calls the API with its ServiceAccount](#16-lab-d-a-pod-calls-the-api-with-its-serviceaccount)
17. [Clean up](#17-clean-up)

**Wrap-up**

18. [Troubleshooting](#18-troubleshooting)
19. [What I learned](#19-what-i-learned)
20. [Commands](#20-commands)
21. [Interview Questions](#21-interview-questions)

---

# Part 1: Concepts

## 1. What is RBAC and why do we need it?

**Definition:** **RBAC (Role-Based Access Control)** is the Kubernetes way to **allow specific actions on specific resources to specific identities**. Example: "the `dev-team` group can create Deployments in the `dev` namespace, but can't touch `prod` or delete Nodes".

Every request to the API server (from `kubectl`, a Pod, Argo CD, Jenkins…) goes through 3 checks:

```
 kubectl / Pod / CI tool
          │
          ▼
 ① Authentication   "Who are you?"        (EKS: AWS IAM · Pods: ServiceAccount token)
          │
          ▼
 ② Authorization    "Are you allowed?"    ◄── RBAC lives here
          │
          ▼
 ③ Admission        "Is the object OK?"   (Day 28: mutating / validating)
          │
          ▼
        etcd
```

**Why we need it:**

| Without RBAC | With RBAC |
|---|---|
| Everyone with access is admin | Each person / app gets only what it needs (**least privilege**) |
| A developer can delete `prod` by mistake | Developers can only change their own namespace |
| A hacked Pod can read every Secret in the cluster | A Pod's ServiceAccount can only do its own job |
| No clear answer to "who can do this?" | `kubectl auth can-i` answers it, auditors are happy |

**Key rules to remember:**
- RBAC is **allow-only**. There is **no "deny"** rule. If nothing allows an action, it is denied.
- Permissions **add up**. If two bindings give you `get` and `delete`, you have both.
- RBAC uses **4 objects**: Role, ClusterRole, RoleBinding, ClusterRoleBinding.

```
   WHAT can be done                    WHO gets it
 ┌─────────────────────┐   bound by  ┌──────────────────────┐
 │ Role / ClusterRole  │ ◄────────── │ RoleBinding /        │ ──► User / Group /
 │ (list of rules)     │             │ ClusterRoleBinding   │     ServiceAccount
 └─────────────────────┘             └──────────────────────┘
```

> **Interview one-liner:** RBAC is the authorization step of the API server: Roles and ClusterRoles list allowed actions, RoleBindings and ClusterRoleBindings give them to users, groups or ServiceAccounts, and anything not allowed is denied.

---

## 2. Subjects: who gets the permission

**Definition:** a **subject** is the identity a binding gives permissions to.

| Subject | What it is | Example | Created by |
|---|---|---|---|
| **User** | A person (or tool) | `abhi` | **Not** a Kubernetes object. Comes from outside (on EKS: an IAM user/role mapped by an access entry) |
| **Group** | A set of users | `dev-team`, `bastion-admin` | **Not** a Kubernetes object. Also comes from outside (EKS access entry `kubernetesGroups`) |
| **ServiceAccount** | The identity of a **Pod** / app | `system:serviceaccount:rbac-lab:viewer` | **Is** a Kubernetes object (`kubectl create serviceaccount`) |

> On EKS people log in with **AWS IAM**. An **EKS access entry** maps the IAM role to a Kubernetes user / group, and RBAC decides what that group can do. That's how our bastion is admin (Day 23).

---

## 3. Rules: apiGroups, resources and verbs

**Definition:** a **rule** is one line of permission: **which API group**, **which resources**, **which actions (verbs)**.

```yaml
rules:
- apiGroups: [""]              # "" = core group (pods, services, secrets…)
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: ["apps"]
  resources: ["deployments"]
  verbs: ["get", "list", "create", "update", "patch"]
```

| apiGroup | Resources in it |
|---|---|
| `""` (core) | pods, services, configmaps, secrets, namespaces, nodes, persistentvolumes |
| `apps` | deployments, replicasets, statefulsets, daemonsets |
| `batch` | jobs, cronjobs |
| `networking.k8s.io` | ingresses, networkpolicies |
| `rbac.authorization.k8s.io` | roles, rolebindings, clusterroles, clusterrolebindings |

| Verb | kubectl command it allows |
|---|---|
| `get` | `kubectl get pod web` (one object) |
| `list` | `kubectl get pods` (many) |
| `watch` | `kubectl get pods -w` |
| `create` | `kubectl create` / `apply` (new) |
| `update`, `patch` | `kubectl edit`, `apply`, `scale`, `patch` |
| `delete` | `kubectl delete` |
| `*` | everything (avoid) |

> Find the group of any resource with `kubectl api-resources` (the APIVERSION column: `apps/v1` → group `apps`, `v1` → core `""`).

---

## 4. Role

**Definition:** a **Role** is a **set of permissions inside one namespace**. It only lists what is allowed; it gives nothing to anyone until a binding uses it.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: dev          # ← works ONLY in dev
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
```

| | |
|---|---|
| **Scope** | One namespace |
| **Why** | Give a team or app access to **its own** namespace only |
| **When** | "Developers of team A can view Pods and logs in `team-a`" |

---

## 5. RoleBinding

**Definition:** a **RoleBinding** **gives a Role (or a ClusterRole) to users, groups or ServiceAccounts inside one namespace**.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: dev-team-pod-reader
  namespace: dev
subjects:                 # WHO
- kind: Group
  name: dev-team
  apiGroup: rbac.authorization.k8s.io
- kind: ServiceAccount
  name: viewer
  namespace: dev
roleRef:                  # WHAT
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

| | |
|---|---|
| **Scope** | One namespace (the binding's namespace) |
| **Why** | Connects the "what" (Role) to the "who" (subjects) |
| **When** | Every time someone needs a Role, or needs a ClusterRole but **only in one namespace** |

> `roleRef` **can't be changed** after creation. To point to another role, delete the binding and create a new one.

---

## 6. ClusterRole

**Definition:** a **ClusterRole** is a **set of permissions that is not tied to a namespace**. It is used for 3 things:

| Use | Example | Why a Role can't do it |
|---|---|---|
| **Cluster-wide resources** | nodes, namespaces, persistentvolumes, storageclasses, CRDs | They don't live in a namespace |
| **The same resource in all namespaces** | "read Pods in every namespace" for Prometheus | A Role covers only one namespace |
| **A reusable template** | One `pod-reader` ClusterRole bound in 20 namespaces | Otherwise you copy the same Role 20 times |

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader       # ← no namespace
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
```

| | |
|---|---|
| **Scope** | Whole cluster (what it really grants depends on the binding) |
| **Why** | Cluster resources, all-namespace access, reuse |
| **When** | Monitoring, logging agents, ingress controllers, cluster admins, shared templates |

---

## 7. ClusterRoleBinding

**Definition:** a **ClusterRoleBinding** **gives a ClusterRole to users, groups or ServiceAccounts across the whole cluster**: every namespace plus cluster-wide resources.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: monitoring-node-reader     # ← no namespace
subjects:
- kind: ServiceAccount
  name: prometheus
  namespace: monitoring
roleRef:
  kind: ClusterRole                # must be a ClusterRole
  name: node-reader
  apiGroup: rbac.authorization.k8s.io
```

| | |
|---|---|
| **Scope** | Whole cluster |
| **Why** | Tools and admins that need access everywhere |
| **When** | Prometheus, Fluent Bit, Karpenter, the AWS Load Balancer Controller, platform admins |

> ⚠️ A ClusterRoleBinding to `cluster-admin` = **full control of everything**. Give it to very few identities.

---

## 8. The 4 combinations

| Permissions object | Binding | Result | Allowed? |
|---|---|---|---|
| **Role** | **RoleBinding** | Access in **one namespace** | ✅ most common for teams |
| **ClusterRole** | **RoleBinding** | ClusterRole's rules, but **only in the binding's namespace** | ✅ reuse one definition in many namespaces |
| **ClusterRole** | **ClusterRoleBinding** | Access in **all namespaces + cluster resources** | ✅ for cluster tools / admins |
| **Role** | **ClusterRoleBinding** | — | ❌ not possible (a Role belongs to one namespace) |

| Where does it work? | ns `dev` | ns `prod` | ns `monitoring` | nodes (cluster) |
|---|---|---|---|---|
| Role + RoleBinding (both in `dev`) | ✅ | ❌ | ❌ | ❌ |
| ClusterRole + RoleBinding (binding in `dev`) | ✅ | ❌ | ❌ | ❌ |
| ClusterRole + ClusterRoleBinding | ✅ | ✅ | ✅ | ✅ |

> **Interview one-liner:** the **binding** decides the scope. A RoleBinding limits even a ClusterRole to one namespace; only a ClusterRoleBinding gives access everywhere.

---

## 9. Built-in ClusterRoles

Kubernetes ships with ready ClusterRoles. Use them before writing your own:

| ClusterRole | Can do | Typical binding |
|---|---|---|
| `cluster-admin` | **Everything**, everywhere | ClusterRoleBinding for platform admins only |
| `admin` | Everything in a namespace, including Roles/RoleBindings (not the namespace itself or quotas) | RoleBinding for a team lead in their namespace |
| `edit` | Create / change most objects in a namespace, **no** RBAC changes | RoleBinding for developers / CI deployer |
| `view` | Read most objects, **no Secrets** | RoleBinding for read-only users, support |

```bash
kubectl get clusterroles | grep -E '^(cluster-admin|admin|edit|view) '
```

---

## 10. ServiceAccounts with RBAC

**Definition:** a **ServiceAccount** is the **identity a Pod uses** when it calls the Kubernetes API. Every namespace has a `default` ServiceAccount with almost no permissions.

```
 Pod (serviceAccountName: viewer)
   │  token mounted at /var/run/secrets/kubernetes.io/serviceaccount/token
   ▼
 API server ──► RBAC: what can system:serviceaccount:<ns>:viewer do?
```

| Who uses a ServiceAccount + RBAC | Why |
|---|---|
| **Argo CD** | Create / update app objects in the cluster |
| **Prometheus** | List Pods, Services, Nodes to scrape them |
| **CI/CD deployer** (Jenkins, GitHub Actions) | Deploy into one namespace only |
| **Operators / controllers** (ALB controller, Karpenter) | Watch and manage their resources |

> Full ServiceAccount notes and lab: [Day 31](../day-31-service-accounts/README.md).

> On EKS, a ServiceAccount can also get **AWS** permissions (S3, Secrets Manager) through **EKS Pod Identity** or **IRSA**. That is IAM, separate from RBAC: RBAC = Kubernetes API, IAM = AWS API.

---

## 11. When to use which: real scenarios

| Scenario | Use | Why |
|---|---|---|
| Developers of team A can deploy only in `team-a` | Built-in `edit` ClusterRole + **RoleBinding** in `team-a` | Reuse, limited to one namespace |
| Support team can only look at Pods and logs in `prod` | **Role** `pod-reader` + **RoleBinding** in `prod` | Custom, narrow, one namespace |
| Prometheus must read Pods/Nodes everywhere | **ClusterRole** + **ClusterRoleBinding** | All namespaces + Nodes (cluster resource) |
| Jenkins deploys only to `staging` | ServiceAccount + `edit` + **RoleBinding** in `staging` | A leaked token can't touch `prod` |
| Platform / DevOps admins | `cluster-admin` + **ClusterRoleBinding** to an IAM-mapped group | Full access, but only for that group |
| Same custom read role in 20 namespaces | 1 **ClusterRole** + 20 **RoleBindings** | Define once, bind many |
| A storage tool must manage PersistentVolumes | **ClusterRole** + **ClusterRoleBinding** | PVs are cluster-scoped |

**Decision flow:**

```
 Is the resource cluster-wide (nodes, PVs, namespaces)?
     yes ──► ClusterRole + ClusterRoleBinding
     no
      │
 Needed in ALL namespaces?
     yes ──► ClusterRole + ClusterRoleBinding
     no
      │
 Will the same rules be used in several namespaces (or a built-in role fits)?
     yes ──► ClusterRole + RoleBinding (one per namespace)
     no  ──► Role + RoleBinding
```

**Best practices:**
- **Least privilege:** start with nothing, add only needed verbs. Avoid `*`.
- **Bind groups, not single users**, so joiners/leavers are handled in IAM.
- **Be careful with Secrets:** `get`/`list` on secrets = read every password in that namespace.
- **One ServiceAccount per app**, and don't use the `default` one.
- **Audit regularly:** `kubectl auth can-i --list --as=...`.

---

# Part 2: Lab

## 12. Lab setup

**Prereqs:** an EKS cluster and `kubectl` from the bastion as cluster admin ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)). We test permissions with `--as` (impersonation), which works because our bastion is `cluster-admin`.

**Step 1: Create a namespace**

```bash
kubectl create namespace rbac-lab
```

**Step 2: Create a second namespace (to prove access is limited)**

```bash
kubectl create namespace rbac-other
```

**Step 3: Create a ServiceAccount**

```bash
kubectl create serviceaccount viewer -n rbac-lab
```

**Step 4: Check it has no permissions yet**

```bash
kubectl auth can-i list pods -n rbac-lab --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅. A new ServiceAccount can't do anything.

---

## 13. Lab A: Read-only ServiceAccount (Role + RoleBinding)

**Step 1: Create the file `role-pod-reader.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: rbac-lab
rules:
- apiGroups: [""]
  resources: ["pods", "pods/log"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: viewer-pod-reader
  namespace: rbac-lab
subjects:
- kind: ServiceAccount
  name: viewer
  namespace: rbac-lab
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
```

**Step 2: Apply it**

```bash
kubectl apply -f role-pod-reader.yaml
```

**Expected:** `role.rbac.authorization.k8s.io/pod-reader created` and `rolebinding.rbac.authorization.k8s.io/viewer-pod-reader created`.

**Step 3: Can it list Pods in rbac-lab?**

```bash
kubectl auth can-i list pods -n rbac-lab --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `yes` ✅

**Step 4: Can it delete Pods?**

```bash
kubectl auth can-i delete pods -n rbac-lab --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅ (only get/list/watch were allowed)

**Step 5: Can it list Pods in another namespace?**

```bash
kubectl auth can-i list pods -n rbac-other --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅. A Role works in its own namespace only.

**Step 6: Can it read Secrets?**

```bash
kubectl auth can-i get secrets -n rbac-lab --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅

**Step 7: See everything it can do**

```bash
kubectl auth can-i --list -n rbac-lab --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `pods` and `pods/log` with `[get list watch]`, plus a few default discovery entries.

> Same thing with one command each, without YAML: `kubectl create role pod-reader --verb=get,list,watch --resource=pods -n rbac-lab` and `kubectl create rolebinding viewer-pod-reader --role=pod-reader --serviceaccount=rbac-lab:viewer -n rbac-lab`.

---

## 14. Lab B: Node reader (ClusterRole + ClusterRoleBinding)

**Step 1: Can the viewer list Nodes now?**

```bash
kubectl auth can-i list nodes --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no`. Nodes are cluster-wide, so no Role can ever allow this.

**Step 2: Create the file `clusterrole-node-reader.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: node-reader
rules:
- apiGroups: [""]
  resources: ["nodes"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: viewer-node-reader
subjects:
- kind: ServiceAccount
  name: viewer
  namespace: rbac-lab
roleRef:
  kind: ClusterRole
  name: node-reader
  apiGroup: rbac.authorization.k8s.io
```

**Step 3: Apply it**

```bash
kubectl apply -f clusterrole-node-reader.yaml
```

**Step 4: Check again**

```bash
kubectl auth can-i list nodes --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `yes` ✅

**Step 5: Really list them as the ServiceAccount**

```bash
kubectl get nodes --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** the EKS worker nodes ✅.

**Step 6: Can it delete a node?**

```bash
kubectl auth can-i delete nodes --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅

---

## 15. Lab C: Reuse a ClusterRole in one namespace (ClusterRole + RoleBinding)

We give the built-in `view` ClusterRole to the viewer, but **only in `rbac-other`**.

**Step 1: Create the RoleBinding**

```bash
kubectl create rolebinding viewer-view -n rbac-other --clusterrole=view --serviceaccount=rbac-lab:viewer
```

**Step 2: Can it list Deployments in rbac-other?**

```bash
kubectl auth can-i list deployments -n rbac-other --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `yes` ✅ (from `view`)

**Step 3: Can it list Deployments in default?**

```bash
kubectl auth can-i list deployments -n default --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅. The RoleBinding limited the ClusterRole to `rbac-other`.

**Step 4: Can it read Secrets in rbac-other?**

```bash
kubectl auth can-i get secrets -n rbac-other --as=system:serviceaccount:rbac-lab:viewer
```

**Expected:** `no` ✅. The built-in `view` role skips Secrets on purpose.

---

## 16. Lab D: A Pod calls the API with its ServiceAccount

`--as` only simulates. Here a real Pod uses the `viewer` token.

**Step 1: Create a test Pod in rbac-lab**

```bash
kubectl run nginx -n rbac-lab --image=nginx
```

**Step 2: Create the file `api-client.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: api-client
  namespace: rbac-lab
spec:
  serviceAccountName: viewer
  containers:
  - name: curl
    image: curlimages/curl:8.10.1
    command: ["sleep", "36000"]
```

**Step 3: Apply it**

```bash
kubectl apply -f api-client.yaml
```

**Step 4: Open a shell in it**

```bash
kubectl exec -it api-client -n rbac-lab -- sh
```

**Step 5: Set the token and CA paths (inside the Pod)**

```sh
SA=/var/run/secrets/kubernetes.io/serviceaccount
```

```sh
TOKEN=$(cat $SA/token)
```

**Step 6: List Pods in rbac-lab (allowed)**

```sh
curl -s --cacert $SA/ca.crt -H "Authorization: Bearer $TOKEN" https://kubernetes.default.svc/api/v1/namespaces/rbac-lab/pods | grep '"name"' | head
```

**Expected:** the names `nginx` and `api-client` ✅

**Step 7: List Secrets (denied)**

```sh
curl -s --cacert $SA/ca.crt -H "Authorization: Bearer $TOKEN" https://kubernetes.default.svc/api/v1/namespaces/rbac-lab/secrets
```

**Expected:** `"code": 403`, `"reason": "Forbidden"`, message `... cannot list resource "secrets" ...` ✅. RBAC blocked the Pod.

**Step 8: Leave the Pod**

```sh
exit
```

---

## 17. Clean up

ClusterRoles and ClusterRoleBindings are **not** deleted with a namespace, so remove them first:

```bash
kubectl delete -f clusterrole-node-reader.yaml
```

```bash
kubectl delete namespace rbac-lab rbac-other
```

---

# Wrap-up

## 18. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `Error from server (Forbidden): ... cannot list resource "pods"` | No binding gives that verb/resource | Check with `kubectl auth can-i`, add the rule or binding |
| Allowed in one namespace, forbidden in another | Role / RoleBinding is in a different namespace | Create a RoleBinding in that namespace (or use a ClusterRoleBinding) |
| Deployments still forbidden after adding a rule | Wrong `apiGroups` (used `""` instead of `apps`) | Check with `kubectl api-resources` |
| `cannot change roleRef` | `roleRef` is immutable | Delete and recreate the binding |
| Can't create a Role with more rights than you have | RBAC blocks privilege escalation | Ask an admin, or get the `escalate`/`bind` verbs |
| `kubectl` on EKS: `Unauthorized` (not Forbidden) | Authentication failed: IAM role has no EKS access entry | Add an access entry for the IAM role |
| Leftover ClusterRoleBinding after deleting namespace | Cluster objects don't belong to a namespace | Delete them explicitly |

> **Unauthorized (401)** = "who are you?" failed (authentication). **Forbidden (403)** = "you're not allowed" (RBAC).

---

## 19. What I learned

**Concepts**
- RBAC = **who** (subject) can do **what** (verbs) on **which** resources (apiGroups + resources).
- **Role** = permissions in one namespace. **ClusterRole** = permissions cluster-wide or reusable.
- **RoleBinding** = give it in one namespace. **ClusterRoleBinding** = give it everywhere.
- The **binding** decides the scope. Role + ClusterRoleBinding is not possible.
- RBAC is **allow-only** and **additive**; no deny rules.
- Use built-in `view` / `edit` / `admin` / `cluster-admin` before writing your own.
- Pods use **ServiceAccounts**; people on EKS use **IAM + access entries**, then RBAC.

**Lab**
- `kubectl auth can-i ... --as=system:serviceaccount:<ns>:<sa>` tests permissions without logging in as them.
- Nodes need a ClusterRole; no Role can grant them.
- A ClusterRole bound with a RoleBinding works only in that namespace.
- A real Pod with a limited ServiceAccount gets **403 Forbidden** for anything not allowed.

```
 Role ──────────► RoleBinding ─────────► one namespace
 ClusterRole ───► RoleBinding ─────────► one namespace (reused rules)
 ClusterRole ───► ClusterRoleBinding ──► whole cluster
```

## 20. Commands

| Command | What it does |
|---|---|
| `kubectl create role NAME --verb=get,list --resource=pods -n NS` | Create a Role |
| `kubectl create rolebinding NAME --role=ROLE --serviceaccount=NS:SA -n NS` | Bind a Role |
| `kubectl create clusterrole NAME --verb=get,list --resource=nodes` | Create a ClusterRole |
| `kubectl create clusterrolebinding NAME --clusterrole=CR --group=GROUP` | Bind a ClusterRole cluster-wide |
| `kubectl create rolebinding NAME --clusterrole=view --user=USER -n NS` | Reuse a ClusterRole in one namespace |
| `kubectl auth can-i VERB RESOURCE -n NS --as=USER` | Test a permission |
| `kubectl auth can-i --list -n NS --as=USER` | List all permissions |
| `kubectl get roles,rolebindings -n NS` | See namespace RBAC |
| `kubectl get clusterroles,clusterrolebindings` | See cluster RBAC |
| `kubectl describe rolebinding NAME -n NS` | Who is bound to what |
| `kubectl api-resources` | Find the apiGroup of a resource |

## 21. Interview Questions

### ⭐ Very Important

**Q1. What is RBAC in Kubernetes?**
Role-Based Access Control: the authorization layer of the API server. Roles / ClusterRoles define allowed verbs on resources, and RoleBindings / ClusterRoleBindings assign them to users, groups or ServiceAccounts. Anything not allowed is denied.

**Q2. What is the difference between a Role and a ClusterRole?**
A Role is a set of permissions inside one namespace. A ClusterRole is not namespaced: it's used for cluster-wide resources (nodes, PVs, namespaces), for access across all namespaces, or as a reusable template.

**Q3. What is the difference between a RoleBinding and a ClusterRoleBinding?**
A RoleBinding assigns a Role (or a ClusterRole) to subjects inside one namespace. A ClusterRoleBinding assigns a ClusterRole to subjects across the whole cluster.

**Q4. Why and when do we use RBAC?**
For least privilege and security: developers get only their namespace, CI tools can deploy only where they should, a hacked Pod can't read every Secret, and auditors can see who can do what. We use it for every person, team and app that talks to the cluster.

**Q5. What is a ServiceAccount and how is it used with RBAC?**
A ServiceAccount is the identity of a Pod. We bind a Role or ClusterRole to it, so the app (Argo CD, Prometheus, a CI deployer) gets only the API access it needs.

### Other Questions

**Q6. Can you bind a ClusterRole with a RoleBinding?**
Yes. The ClusterRole's rules then apply only in the RoleBinding's namespace. This is how we reuse built-in roles like `edit` or `view` per namespace.

**Q7. Can you bind a Role with a ClusterRoleBinding?**
No. A Role belongs to one namespace; a ClusterRoleBinding can only reference a ClusterRole.

**Q8. Does RBAC support deny rules?**
No. RBAC is allow-only and additive. If no rule allows an action, it's denied. To block something, don't grant it (or use admission policies).

**Q9. What are the built-in ClusterRoles?**
`cluster-admin` (everything), `admin` (everything in a namespace including RBAC), `edit` (change most objects, no RBAC), `view` (read most objects, no Secrets).

**Q10. How do you check what a user or ServiceAccount can do?**
`kubectl auth can-i <verb> <resource> -n <ns> --as=<user>`, or `--list` for all permissions. For a ServiceAccount use `--as=system:serviceaccount:<ns>:<name>`.

**Q11. How do users get access to an EKS cluster?**
They authenticate with AWS IAM. An EKS access entry maps the IAM user/role to a Kubernetes user or group (or an EKS access policy), and RBAC bindings give that group its permissions.

**Q12. A developer gets "Forbidden" when running `kubectl get deployments -n dev`. How do you debug?**
Run `kubectl auth can-i list deployments -n dev --as=<user>`. Check the RoleBindings in `dev` (`kubectl get rolebindings -n dev -o wide`), that the user/group name matches, and that the Role uses apiGroup `apps`. If the error is `Unauthorized` instead, it's an authentication (IAM access entry) problem, not RBAC.

**Q13. RBAC vs IAM on EKS?**
IAM controls the AWS API (S3, EC2, Secrets Manager) and who can log in to EKS. RBAC controls the Kubernetes API (Pods, Deployments, Secrets). A Pod gets AWS access through Pod Identity / IRSA, and Kubernetes access through its ServiceAccount + RBAC.

**Q14. Why is giving `get`/`list` on Secrets risky?**
Secrets hold passwords and tokens. Read access to Secrets in a namespace means reading every credential there, and Pods that can create workloads can mount them too. Grant it only to the app that really needs that secret.

**Source:** [Using RBAC authorization](https://kubernetes.io/docs/reference/access-authn-authz/rbac/) · [Service Accounts](https://kubernetes.io/docs/concepts/security/service-accounts/) · [EKS access entries](https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html)
