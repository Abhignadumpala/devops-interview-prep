# Day 36 - Pod Identity (Workload Identity) and Kyverno

[← Kubernetes notes](../README.md)

> **In short:** **workload identity** means a Pod gets its **own identity** so it can talk to **third-party tools** (AWS S3, Secrets Manager, DynamoDB, Vault, GCP, Azure) **without storing any access keys**. In Kubernetes that identity is the **ServiceAccount**. On EKS we link the ServiceAccount to an **IAM role** with **EKS Pod Identity** (newer, simpler) or **IRSA** (IAM Roles for Service Accounts, OIDC-based). The Pod then receives **temporary credentials** that expire and rotate automatically. **Authentication** = *who is this Pod?* (ServiceAccount → IAM role). **Authorization** = *what may it do?* (the IAM policy on the role, or RBAC inside the cluster). **Kyverno** adds a second layer: it controls **which Pods are allowed into the cluster** at all, for example "no Pod may use the `default` ServiceAccount" or "no Pod may carry static AWS keys".

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | The problem (long-lived keys), what workload identity is, the ServiceAccount as identity, authentication vs authorization, temporary credentials, EKS Pod Identity, IRSA, Pod Identity vs IRSA, the node role trap, identity for other third-party tools, Kyverno (real-world use case, policy types, ValidatingPolicy, Audit vs Deny, safe rollout, limitations) | How a Pod proves who it is to an outside tool, and how to get least-privilege, short-lived access |
| **Part 2: Lab** | A Pod with no identity, S3 read with Pod Identity, the same with IRSA, least privilege for one secret in Secrets Manager, Kyverno policies (no static AWS keys in Pods or ConfigMaps, ECR images only, no `:latest`, signed images) | Run each method on EKS and prove what it can and can't do |

> **Before this:** [Day 30 - RBAC](../day-30-rbac/README.md) · [Day 31 - ServiceAccounts](../day-31-service-accounts/README.md) (the basics: default SA, tokens, RBAC) · [Day 28 - Admission controllers](../day-28-kustomize-admission-controllers-crds/README.md) (how Kyverno plugs in) · [Day 32 - Supply chain security](../day-32-api-server-cluster-security-supply-chain/README.md) (Kyverno for image signatures)

## Table of Contents

**Part 1: Concepts**
1. [The problem: long-lived keys in Pods](#1-the-problem-long-lived-keys-in-pods)
2. [What is workload identity?](#2-what-is-workload-identity)
3. [The ServiceAccount: the Pod's identity](#3-the-serviceaccount-the-pods-identity)
4. [Authentication vs authorization](#4-authentication-vs-authorization)
5. [Temporary credentials: why short-lived wins](#5-temporary-credentials-why-short-lived-wins)
6. [EKS Pod Identity (EKS workload identity)](#6-eks-pod-identity-eks-workload-identity)
7. [IRSA: IAM Roles for Service Accounts (OIDC)](#7-irsa-iam-roles-for-service-accounts-oidc)
8. [Pod Identity vs IRSA: which one?](#8-pod-identity-vs-irsa-which-one)
9. [The node role trap](#9-the-node-role-trap)
10. [Other third-party tools: same idea everywhere](#10-other-third-party-tools-same-idea-everywhere)
11. [Kyverno: the policy guardrail](#11-kyverno-the-policy-guardrail)

**Part 2: Lab**

12. [Lab setup](#12-lab-setup)
13. [Lab A: A Pod with no identity](#13-lab-a-a-pod-with-no-identity)
14. [Lab B: S3 read with EKS Pod Identity](#14-lab-b-s3-read-with-eks-pod-identity)
15. [Lab C: The same with IRSA](#15-lab-c-the-same-with-irsa)
16. [Lab D: Least privilege, one secret only](#16-lab-d-least-privilege-one-secret-only)
17. [Lab E: Kyverno guardrails](#17-lab-e-kyverno-guardrails)
18. [Clean up](#18-clean-up)

**Wrap-up**

19. [Troubleshooting](#19-troubleshooting)
20. [What I learned](#20-what-i-learned)
21. [Commands](#21-commands)
22. [Interview Questions](#22-interview-questions)

---

# Part 1: Concepts

## 1. The problem: long-lived keys in Pods

**Definition:** a **long-lived credential** is an access key (for example an AWS `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`) that **never expires** until someone deletes it.

A Pod sometimes needs to call outside services: S3, SQS, DynamoDB, Secrets Manager. The "quick" way is to put keys somewhere the Pod can read them:

| Where people put keys | Why it's risky |
|---|---|
| Inside the container image | Anyone who pulls the image has the keys, forever |
| Environment variable in the Deployment YAML | Lands in Git, `kubectl describe`, logs, crash dumps |
| ConfigMap | Plain text, readable by anyone with `get configmaps` |
| Kubernetes Secret | Only base64, readable by anyone with `get secrets` in that namespace |

```
 ❌ Static keys
 Pod ── env: AWS_ACCESS_KEY_ID=AKIA... ──► AWS
         (same key for months, leaks = attacker has it until you notice and rotate)
```

> **Interview one-liner:** static keys in images, env vars, ConfigMaps or Secrets never expire and leak easily; workload identity removes them completely.

---

## 2. What is workload identity?

**Definition:** **workload identity** gives a running workload (a Pod) its **own identity** that an outside system trusts, so the Pod can get **temporary credentials** for exactly the permissions it needs, **without any stored keys**.

**In simple words:** instead of handing the Pod a password, we tell AWS "trust any Pod that runs as **ServiceAccount X** in **namespace Y** of **cluster Z**, and let it act as **IAM role R**".

```
 ✅ Workload identity
 Pod ── runs as SA: s3-reader ──► EKS proves "this is s3-reader in identity-lab"
                                      │
                                      ▼
                         AWS STS gives temporary credentials for IAM role s3-reader-role
                                      │
                                      ▼
                         Pod calls S3 (only what the role's policy allows)
```

> **EKS workload identity = Pod Identity.** On EKS, when people say "workload identity" they mean **EKS Pod Identity** (or its alternative, IRSA).

| Platform | Name of the feature |
|---|---|
| AWS EKS | **EKS Pod Identity** or **IRSA** |
| Google GKE | Workload Identity Federation for GKE |
| Azure AKS | Microsoft Entra Workload ID |
| Any cluster → HashiCorp Vault | Vault **Kubernetes auth method** |

> **Interview one-liner:** workload identity = the Pod proves who it is with its ServiceAccount, and the cloud swaps that for short-lived credentials of a role, so no keys are stored anywhere.

---

## 3. The ServiceAccount: the Pod's identity

**Definition:** a **ServiceAccount (SA)** is the **identity of an application running in a Pod**. Users log in as users; Pods authenticate as a ServiceAccount. (Basics in [Day 31](../day-31-service-accounts/README.md).)

**Purpose:** whenever a Pod needs **authentication and authorization**, to the Kubernetes API **or to a third-party tool**, we give it a ServiceAccount.

| The Pod wants to talk to… | The SA is linked to… | Permissions come from… |
|---|---|---|
| Kubernetes API (list Pods, read ConfigMaps) | Role / ClusterRole via RoleBinding | **RBAC** |
| AWS (S3, Secrets Manager, DynamoDB) | **IAM role** via Pod Identity / IRSA | **IAM policy** |
| HashiCorp Vault | Vault role bound to the SA name + namespace | **Vault policy** |
| GCP / Azure | Cloud service account / managed identity | Cloud IAM |

**How the SA proves who it is:** the kubelet mounts a **short-lived, signed JWT token** (projected ServiceAccount token) into the Pod. It says `system:serviceaccount:<namespace>:<sa-name>`, has an **audience** (who should accept it) and an **expiry**, and the kubelet **rotates** it before it expires. Outside tools verify that token instead of asking for a password.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: s3-reader
  namespace: identity-lab
---
apiVersion: v1
kind: Pod
metadata:
  name: app
  namespace: identity-lab
spec:
  serviceAccountName: s3-reader     # ← the Pod's identity
  containers:
  - name: app
    image: amazon/aws-cli
```

> **Interview one-liner:** a ServiceAccount is the Pod's identity; we use it whenever a Pod needs authentication and authorization, to the Kubernetes API through RBAC or to third-party tools like AWS through an IAM role.

### The `default` ServiceAccount: does it get all permissions?

**Definition:** every namespace automatically gets a ServiceAccount called **`default`**. If a Pod doesn't set `serviceAccountName`, Kubernetes gives it `default`.

```bash
kubectl get serviceaccount -n identity-lab
```

```
NAME      SECRETS   AGE
default   0         5m     ← created automatically with the namespace
```

**No, it does not get all permissions.** Out of the box it has almost nothing:

| Area | Default ServiceAccount |
|---|---|
| Kubernetes API (list Pods, read Secrets, …) | ❌ Nothing. No Role or RoleBinding exists for it. It gets only the basic rights every logged-in identity has, like checking API discovery or asking "what can I do?" |
| AWS | ❌ Nothing of its own. No Pod Identity association and no IRSA annotation |
| Token | ⚠️ Still mounted into every Pod by default at `/var/run/secrets/kubernetes.io/serviceaccount/token` |

Check it yourself:

```bash
kubectl auth can-i list pods -n identity-lab --as=system:serviceaccount:identity-lab:default
```

**Expected:** `no`

**So why avoid it?** Because **every Pod in the namespace shares this one identity**:

```
 namespace shop
 frontend  ─┐
 cart      ─┼── all run as SA "default"
 payment   ─┘
```

| Problem | What happens |
|---|---|
| **Someone gives it permissions** (a common mistake: a Helm chart or a quick fix binds a Role to `default`) | **Every** Pod in the namespace gets those permissions, not just the one app that needed them |
| **Someone links it to an IAM role** (Pod Identity or IRSA on `default`) | `frontend` can now read the payment secrets in AWS too |
| **No least privilege** | You can't give `cart` different permissions from `payment` |
| **Poor audit trail** | Logs show `default`, so you can't tell which app made the call |
| **Token mounted for no reason** | If a Pod is hacked, the attacker gets a valid token |

It's harmless on day one, but it becomes dangerous as soon as anyone grants it something. **Best practice:**
- Each app gets **its own ServiceAccount**, with only the permissions it needs.
- Apps that never call the Kubernetes API set `automountServiceAccountToken: false`.
- Kyverno can block or report Pods on `default` ([Lab E](#17-lab-e-kyverno-guardrails)).

> **Interview one-liner:** the default ServiceAccount has almost no permissions out of the box, but every Pod in the namespace shares it. Any permission granted to it goes to all of those Pods, so each app should get its own ServiceAccount with least privilege.

---

## 4. Authentication vs authorization

**Definition:**
- **Authentication (AuthN)** = **who are you?** Prove your identity.
- **Authorization (AuthZ)** = **what are you allowed to do?** Check your permissions.

| | Authentication | Authorization |
|---|---|---|
| Question | Who is this Pod? | What may this Pod do? |
| Inside the cluster | SA token checked by the API server | **RBAC** (Role + RoleBinding) |
| To AWS | SA → IAM role via Pod Identity / IRSA, STS gives credentials | **IAM policy** attached to the role |
| Failure looks like | `Unable to locate credentials`, `InvalidIdentityToken` | `AccessDenied` / `403 Forbidden` |

```
 Pod (SA: s3-reader)
   │ 1. AuthN: "I am s3-reader in identity-lab"  → STS: OK, here are creds for s3-reader-role
   │ 2. AuthZ: "s3:ListBucket on my-bucket"      → IAM policy: allowed ✅
   │ 3. AuthZ: "s3:DeleteObject on my-bucket"    → IAM policy: not allowed ❌ AccessDenied
```

> **Interview one-liner:** authentication proves the Pod's identity (ServiceAccount → IAM role), authorization decides its permissions (IAM policy for AWS, RBAC for Kubernetes); both are needed.

---

## 5. Temporary credentials: why short-lived wins

**Definition:** **temporary credentials** are an access key + secret key + **session token** issued by **AWS STS** that **expire automatically** (usually within hours).

| | Static keys | Temporary credentials |
|---|---|---|
| Expire | Never (until deleted) | Automatically |
| Rotation | Manual, often forgotten | Automatic, the AWS SDK refreshes them |
| If leaked | Works until someone notices | Stops working soon |
| Stored in | Image / YAML / Secret | Nowhere, fetched at runtime |
| Audit in CloudTrail | Shows a user | Shows the **role + session** (with Pod Identity: cluster, namespace, SA tags) |

The app code doesn't change: the **AWS SDK default credential chain** picks the temporary credentials up from environment variables the EKS webhook injects (section 6 and 7).

> **Interview one-liner:** temporary STS credentials expire and rotate on their own, so a leak has a short life; the AWS SDK finds and refreshes them automatically.

---

## 6. EKS Pod Identity (EKS workload identity)

**Definition:** **EKS Pod Identity** links a **ServiceAccount** (cluster + namespace + SA name) to an **IAM role** with an EKS API object called a **pod identity association**. A node agent hands the Pod temporary credentials for that role.

**Purpose:** Pod Identity handles the communication between your Pod and **AWS services** (S3, Secrets Manager, DynamoDB, SQS…). Whenever your Pod wants to talk to an AWS service, you use Pod Identity to give it the right IAM role. The **alternative** to Pod Identity is **IRSA** (section 7).

```
 Pod (SA: uploader, ns: media) ──► Pod Identity ──► IAM role uploader-role ──► S3 / Secrets Manager / DynamoDB
```

**Pieces:**

| Piece | What it does |
|---|---|
| **Pod Identity Agent** add-on | A DaemonSet (`eks-pod-identity-agent`) on every node; serves credentials at `169.254.170.23` |
| **IAM role** | Trust policy trusts the service `pods.eks.amazonaws.com` with `sts:AssumeRole` + `sts:TagSession` |
| **Pod identity association** | `cluster + namespace + serviceaccount → role ARN`, stored in EKS (not in YAML) |
| **EKS mutating webhook** | Adds env vars + a token volume to new Pods that use that SA |

**Flow:**

```
 1. Pod starts with SA s3-reader → webhook injects:
      AWS_CONTAINER_CREDENTIALS_FULL_URI=http://169.254.170.23/v1/credentials
      AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE=/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token
 2. AWS SDK in the Pod calls the agent on its node with the SA token
 3. Agent calls EKS Auth API (AssumeRoleForPodIdentity)
 4. EKS checks the association → returns temporary creds for s3-reader-role
 5. SDK calls S3 with them, refreshes before expiry
```

**IAM trust policy** (the same for every cluster, no cluster ID inside):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "pods.eks.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession"]
    }
  ]
}
```

**Good to know:**
- The association is **stored by EKS**; it is **not an annotation** on the Kubernetes ServiceAccount (that's IRSA). No change to the ServiceAccount YAML.
- The namespace and ServiceAccount can be created **before or after** the association, but they must **exist before the workload (Pod) is launched**.
- One role can be reused across **many clusters** without editing its trust policy.
- Adds **session tags** (`eks-cluster-name`, `kubernetes-namespace`, `kubernetes-service-account`, …) for CloudTrail and attribute-based access (ABAC).
- Pods created **before** the association must be **restarted** (the webhook only acts at creation).
- Not for **Fargate** Pods; use IRSA there.

**Where to see it in the console:** EKS → Clusters → your cluster → **Access** tab. It has three sections:

| Section | What it holds |
|---|---|
| **IAM access entries** | Which IAM users/roles can use `kubectl` on the cluster (people and CI, not Pods) |
| **Pod Identity associations** | Association ID, IAM role, namespace, ServiceAccount (Pods → AWS) |
| **OIDC identity providers** | External OIDC login for users (for example Okta). IRSA's IAM OIDC provider is a different thing and is set up in IAM |

The **Authentication mode** shown there (for example *EKS API and ConfigMap*) decides how **people** log in to the cluster: access entries, the older `aws-auth` ConfigMap, or both.

> **Interview one-liner:** EKS Pod Identity = install the agent add-on, create a role that trusts `pods.eks.amazonaws.com`, and associate it with namespace + ServiceAccount; Pods get temporary credentials with no annotation and no OIDC setup.

---

## 7. IRSA: IAM Roles for Service Accounts (OIDC)

**Definition:** **IRSA** lets a Pod assume an IAM role by presenting its **ServiceAccount token** to AWS STS. AWS trusts the token because the cluster's **OIDC issuer** is registered in IAM as an **identity provider**.

**Pieces:**

| Piece | What it does |
|---|---|
| **OIDC provider** in IAM | One per cluster, registers the cluster's token issuer URL with IAM |
| **IAM role** | Trust policy: `Federated` = the OIDC provider, `sts:AssumeRoleWithWebIdentity`, condition `sub = system:serviceaccount:<ns>:<sa>` |
| **SA annotation** | `eks.amazonaws.com/role-arn: arn:aws:iam::<account-id>:role/<role>` |
| **EKS mutating webhook** | Injects `AWS_ROLE_ARN`, `AWS_WEB_IDENTITY_TOKEN_FILE` and the token volume |

**Flow:**

```
 1. Pod starts with SA s3-reader (annotated with role ARN) → webhook injects:
      AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/s3-reader-irsa-role
      AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/eks.amazonaws.com/serviceaccount/token
 2. AWS SDK sends that token to STS: AssumeRoleWithWebIdentity
 3. STS checks the token signature with the cluster's OIDC provider + the trust policy conditions
 4. STS returns temporary creds for the role
```

**IAM trust policy** (contains the cluster's OIDC ID, so it is per cluster):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/oidc.eks.<region>.amazonaws.com/id/<OIDC-ID>" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.<region>.amazonaws.com/id/<OIDC-ID>:sub": "system:serviceaccount:identity-lab:s3-reader-irsa",
          "oidc.eks.<region>.amazonaws.com/id/<OIDC-ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

> **Interview one-liner:** IRSA registers the cluster's OIDC issuer in IAM; the Pod's projected SA token is exchanged with STS AssumeRoleWithWebIdentity for the role in the SA's `eks.amazonaws.com/role-arn` annotation.

---

## 8. Pod Identity vs IRSA: which one?

| | **EKS Pod Identity** | **IRSA** |
|---|---|---|
| Released | 2023, newer | 2019, very common in existing clusters |
| Cluster setup | Install the Pod Identity Agent add-on | Create the IAM OIDC provider |
| Link SA → role | Pod identity association (EKS API / console / Terraform) | Annotation on the ServiceAccount |
| Trust policy | Generic: `pods.eks.amazonaws.com` | Per cluster: OIDC provider + `sub` condition |
| Reuse role in many clusters | Yes, no trust policy change | Must add each cluster's OIDC provider to the trust policy |
| STS call | EKS Auth `AssumeRoleForPodIdentity` (via node agent) | `AssumeRoleWithWebIdentity` (directly from the Pod) |
| Session tags (cluster, ns, SA) | Yes | No |
| Fargate | ❌ Not supported | ✅ Supported |
| Works outside EKS (self-managed K8s) | ❌ | ✅ (any OIDC issuer) |

**Rule of thumb:** new EKS clusters on EC2 nodes → **Pod Identity**. Fargate, non-EKS clusters, or existing IRSA setups → **IRSA**.

> **Interview one-liner:** both give a Pod temporary IAM role credentials; Pod Identity is simpler and reusable across clusters, IRSA is OIDC-based and still needed for Fargate and non-EKS clusters.

---

## 9. The node role trap

**Definition:** every EKS worker node has an **instance IAM role**. If a Pod has **no** Pod Identity or IRSA, the AWS SDK can fall back to the **instance metadata service (IMDS)** and use the **node's** role.

```
 Pod with no workload identity ──► IMDS 169.254.169.254 ──► node role credentials
 (every Pod on that node gets the SAME permissions = no least privilege)
```

| Fix | How |
|---|---|
| Give every Pod that calls AWS its own Pod Identity / IRSA role | Section 6 / 7 |
| Keep the node role minimal | Only the EKS worker, CNI and ECR read policies |
| Block Pods from IMDS | IMDSv2 required with **hop limit 1** in the node launch template (Pods on the Pod network can't reach it) |

> **Interview one-liner:** without workload identity a Pod may silently use the node's IAM role, shared by every Pod on that node; give each app its own role and block IMDS with IMDSv2 hop limit 1.

---

## 10. Other third-party tools: same idea everywhere

The pattern is always the same: **the ServiceAccount token proves who the Pod is, the tool maps it to permissions.**

| Third-party tool | How the Pod authenticates | What decides permissions |
|---|---|---|
| AWS services | Pod Identity / IRSA → IAM role | IAM policy |
| **External Secrets Operator** (syncs AWS secrets into K8s) | Its own SA with Pod Identity / IRSA | IAM policy on that role |
| HashiCorp Vault | Pod sends its SA token; Vault checks it with the K8s **TokenReview** API | Vault role bound to SA + namespace → Vault policy |
| Google Cloud | Workload Identity Federation for GKE | GCP IAM |
| Azure | Entra Workload ID (federated credential on the SA) | Azure RBAC |
| AWS Load Balancer Controller, Cluster Autoscaler, Karpenter, EBS CSI driver | Each runs with its own SA + IAM role | Only the IAM actions that controller needs |

> **Interview one-liner:** controllers like the AWS Load Balancer Controller, EBS CSI driver and External Secrets all use the same pattern: their own ServiceAccount mapped to their own IAM role.

---

## 11. Kyverno: the policy guardrail

**Definition:** **Kyverno** is a **Kubernetes policy engine**. It can **validate, mutate, generate and delete** resources, and **verify container image signatures and attestations**. It runs as an **admission webhook**, so it checks every Pod **before** it is created. Policies are YAML, with checks written in **CEL** (Common Expression Language).

**In simple words:** Kyverno is the **security guard at the cluster door**. Pod Identity decides what a Pod can do **in AWS** once it is running; Kyverno decides **whether the Pod is allowed to run at all**.

### Workload identity vs Kyverno: two layers

| Layer | Question it answers | Example |
|---|---|---|
| **Pod Identity / IRSA** | What can an **approved** workload do in **AWS**? | `payment-service` may read one S3 bucket and one RDS secret |
| **Kyverno** | Which workloads are **allowed into the cluster** and **how must they be configured**? | Only ECR images, no `:latest`, no static AWS keys, only signed images |

> Use **both** layers. Neither replaces the other.

### Real-world use case

A company runs **40 microservices** on EKS. Pods need secure access to AWS services (S3, RDS), and **only trusted, versioned images** should run.

```
 Developer ──► CI/CD (GitHub Actions / Jenkins) ──► Amazon ECR (private)
 pushes code    builds + signs the image             signed, versioned image (v1.2.3)
                                                          │
 ┌────────────────────────── EKS cluster (production) ────▼─────────────────────────────┐
 │                                                                                       │
 │  Kyverno (policy guardrail)                 namespace: payments                       │
 │  ✔ allow only ECR images        ✅ allowed   Pod payment-service                        │
 │  ✔ block :latest tag          ───────────►   SA payments-sa ──Pod Identity──► IAM role ─┼─► S3 (app data)
 │  ✔ block static AWS keys                                     (temporary creds)          │   RDS (database)
 │  ✔ allow only signed images                                                            │
 │              ▲  ❌ blocked                                                              │
 │   untrusted image: someuser/debug-tools:latest                                         │
 └───────────────────────────────────────────────────────────────────────────────────────┘
```

**How it works:**
1. The developer pushes code.
2. CI/CD builds and **signs** the image, then pushes it to **ECR** with a version tag.
3. EKS runs Pods using a Kubernetes **ServiceAccount**.
4. **Pod Identity** gives the Pod a **temporary IAM role** (no keys).
5. **Kyverno** checks policies (only ECR images, no `:latest`, no static AWS keys, signed only) **before** allowing the Pod.

**Why it matters:** if someone deploys a public debug image into `payments`, and that Pod uses a ServiceAccount with a powerful IAM role, code inside that image could use the role's AWS permissions. A compromised package or a malicious tool could do the same. Kyverno stops the image at the door.

**Benefits:** no static AWS keys in Pods · only trusted, versioned images run · risky or malicious workloads are blocked.

### What the policies block

| Policy | Blocks | Why |
|---|---|---|
| **Block static AWS keys** | Any Pod (or file like a ConfigMap) that carries `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or a key value like `AKIA…` | Keys never expire and leak; use Pod Identity / IRSA |
| **Trusted registry only** | Images **not** from your company **ECR** (Docker Hub, random public registries) | You only run images your pipeline built and scanned |
| **No `:latest`** | Images tagged `:latest` | `latest` changes silently; you can't tell what's running or roll back |
| **Signed images only** | Images **not signed** by your CI pipeline (Cosign) | Proves the image came from your pipeline and wasn't swapped ([Day 32](../day-32-api-server-cluster-security-supply-chain/README.md)) |

### Kyverno policy types (CEL-based, `policies.kyverno.io/v1`)

Newer Kyverno releases (**1.17+**) use CEL-based policy types. Older guides use `kind: ClusterPolicy` (`kyverno.io/v1`); prefer the new types for new work.

| Type | Purpose | Example |
|---|---|---|
| **ValidatingPolicy** | **Allow or deny** resources based on rules | Reject Pods with static AWS key env vars |
| **MutatingPolicy** | **Change** resources automatically | Add standard labels or safe defaults |
| **GeneratingPolicy** | **Create** related resources when something matches | Create a default NetworkPolicy for every new namespace |
| **ImageValidatingPolicy** | **Verify image signatures and attestations** | Only images signed by the CI identity |
| **DeletingPolicy** | **Delete** matching resources on a schedule | Remove expired temporary resources |
| **PolicyException** (companion) | **Exempt** selected resources from a policy | Allow one documented legacy workload during migration |

### How a ValidatingPolicy looks

```yaml
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata:
  name: disallow-static-aws-keys
spec:
  validationActions:          # what to do on a violation
    - Audit                   # Audit = allow + report, Deny = block
  matchConstraints:           # which resources to check
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: NotIn     # skip system namespaces
          values: [kube-system, kyverno]
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:                # the condition (CEL): must be true to pass
    - expression: >-
        object.spec.containers.all(c,
          !has(c.env) ||
          c.env.all(e, !(e.name in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]))
        )
      message: "Do not inject static AWS access keys into Pods. Use EKS Pod Identity or IRSA."
```

| Field | Meaning |
|---|---|
| `validationActions` | `Audit` (allow + record in PolicyReport) or `Deny` (block) |
| `matchConstraints` | Which namespaces, resources and operations the policy checks |
| `validations[].expression` | A CEL condition; `true` = pass, `false` = violation |
| `object` | The resource being created (the Pod) |
| `.all(c, …)` | True only if the condition holds for **every** item (every container) |

**Reading the condition in plain English:** "for **every** container, either it has **no** env vars, or **none** of its env var names is `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`".

### Audit vs Deny

| `validationActions` | What happens | When |
|---|---|---|
| `Audit` | Pod is **allowed**, violation recorded in a **PolicyReport** | First, to see what would break |
| `Deny` | Pod is **rejected** at admission, never created | After fixing existing violations |

### Safe production rollout

Never switch a new policy straight to `Deny` in production.

```
 1. Audit ──► 2. Measure ──► 3. Fix ──► 4. Exceptions ──► 5. Deny in staging ──► 6. Deny in prod (gradually) ──► 7. Add signature checks
```

| Step | What you do |
|---|---|
| **1. Audit first** | Apply with `validationActions: [Audit]` |
| **2. Measure** | `kubectl get policyreport -A`, look at the failures |
| **3. Fix** | Move images into ECR, pin versions/digests, remove static keys |
| **4. Exceptions** | For a workload that can't be fixed yet, a narrow `PolicyException` with an owner, reason and expiry |
| **5. Test Deny in staging** | Check that good Pods pass and bad Pods are rejected |
| **6. Promote gradually** | Roll out to production in stages, with monitoring and a rollback plan |
| **7. Verify signatures** | Add an `ImageValidatingPolicy` for Cosign-signed images from your CI |

### Limitations (know them for interviews)

| Limitation | What it means |
|---|---|
| The key policy checks **env var names** | It is a guardrail, **not a full secret scanner**. Keys hidden in the image, mounted files, command args or app config are not caught. Pair it with secret scanning in CI (for example gitleaks, Trivy) |
| Only `spec.containers` is checked in the basic version | Extend it to `initContainers` and `ephemeralContainers` |
| A registry prefix doesn't prove an image is safe | The image still needs scanning and signing |
| Tags other than `latest` can still be changed | **Digests** (`image@sha256:…`) are truly immutable |
| Pod-only rules check Pods, not Deployment templates | The Deployment is accepted and its Pods are rejected later; test controller coverage for your Kyverno version |
| Excluding `kube-system` / `kyverno` is a choice | Every exclusion is a possible bypass; keep them few |

> **Interview one-liner:** Pod Identity decides **what a Pod can do in AWS**; Kyverno decides **which Pods can run in the cluster**: only ECR images, no `:latest`, no static AWS keys, only signed images. Roll policies out in Audit first, then Deny.

---

# Part 2: Lab

We give an `aws-cli` Pod access to S3 three ways and then add Kyverno guardrails.

```
 namespace identity-lab
 no-identity     (SA default)          ──► AWS? node role or no credentials
 pi-app          (SA s3-reader)        ──► Pod Identity ──► s3-reader-role  ──► S3 read only
 irsa-app        (SA s3-reader-irsa)   ──► IRSA         ──► s3-reader-irsa-role ──► S3 read only
 secret-app      (SA secret-reader)    ──► Pod Identity ──► secret-reader-role ──► ONE secret
 Kyverno: no static AWS keys in Pods or ConfigMaps · ECR images only, no :latest · (optional) signed images only
```

## 12. Lab setup

**Prereqs:** an EKS cluster on EC2 nodes, with `kubectl`, `aws`, `eksctl` and `helm` on the bastion ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)). The bastion's IAM identity can manage IAM roles and EKS.

**Step 1: Set variables** (replace `<cluster-name>`)

```bash
export CLUSTER=<cluster-name> REGION=us-east-1
```

```bash
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

**Step 2: Check the cluster**

```bash
kubectl get nodes
```

**Expected:** nodes `Ready` ✅

**Step 3: Create the namespace**

```bash
kubectl create namespace identity-lab
```

**Step 4: Create a test bucket with one file** (bucket names are global, the account ID makes it unique)

```bash
aws s3 mb s3://identity-lab-$ACCOUNT_ID --region $REGION
```

```bash
echo "hello from workload identity" > hello.txt && aws s3 cp hello.txt s3://identity-lab-$ACCOUNT_ID/
```

---

## 13. Lab A: A Pod with no identity

**Step 1: Run an aws-cli Pod with the default SA**

```bash
kubectl run no-identity -n identity-lab --image=amazon/aws-cli --command -- sleep 3600
```

**Step 2: Ask AWS who the Pod is**

```bash
kubectl exec -n identity-lab no-identity -- aws sts get-caller-identity
```

**Expected:** one of these:
- `Unable to locate credentials` → IMDS is blocked for Pods (good) ✅
- `"Arn": "arn:aws:sts::<account-id>:assumed-role/<node-role>/i-0abc…"` → the Pod is using the **node role** (the trap from section 9) ⚠️

Either way, the Pod has **no identity of its own**.

---

## 14. Lab B: S3 read with EKS Pod Identity

**Step 1: Install the Pod Identity Agent add-on**

```bash
aws eks create-addon --cluster-name $CLUSTER --addon-name eks-pod-identity-agent --region $REGION
```

**Step 2: Check the agent runs on every node**

```bash
kubectl get daemonset eks-pod-identity-agent -n kube-system
```

**Expected:** `DESIRED` = `READY` = number of nodes ✅

**Step 3: Write the trust policy**

```bash
cat > pod-identity-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "pods.eks.amazonaws.com" },
      "Action": ["sts:AssumeRole", "sts:TagSession"]
    }
  ]
}
EOF
```

**Step 4: Create the role**

```bash
aws iam create-role --role-name s3-reader-role --assume-role-policy-document file://pod-identity-trust.json
```

**Step 5: Give it read-only S3** (authorization)

```bash
aws iam attach-role-policy --role-name s3-reader-role --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

**Step 6: Create the ServiceAccount** (no annotation needed)

```bash
kubectl create serviceaccount s3-reader -n identity-lab
```

**Step 7: Create the pod identity association** (authentication: SA → role)

```bash
aws eks create-pod-identity-association --cluster-name $CLUSTER --namespace identity-lab --service-account s3-reader --role-arn arn:aws:iam::$ACCOUNT_ID:role/s3-reader-role --region $REGION
```

**Or in the console:** EKS → Clusters → your cluster → **Access** → **Pod Identity associations** → **Create** → pick IAM role `s3-reader-role` → namespace `identity-lab` → ServiceAccount `s3-reader` → **Create**.

**Step 8: Check it**

```bash
aws eks list-pod-identity-associations --cluster-name $CLUSTER --region $REGION
```

**Expected:** an entry with `namespace: identity-lab`, `serviceAccount: s3-reader` ✅

**Step 9: Run a Pod with that SA**

```bash
kubectl run pi-app -n identity-lab --image=amazon/aws-cli --restart=Never --overrides='{"spec":{"serviceAccountName":"s3-reader"}}' --command -- sleep 3600
```

| Flag | Why |
|---|---|
| `--restart=Never` | Creates a plain Pod for testing (no restarts) |
| `--overrides='{"spec":{"serviceAccountName":"s3-reader"}}'` | `kubectl run` has no `--serviceaccount` flag, so we set the SA through an override |
| `--command -- sleep 3600` | Keeps the Pod alive for 1 hour so we can `exec` into it (the image's default command is `aws`, which exits at once) |

> **Production note:** don't use a floating `latest` (or untagged) image. Pin a reviewed version or an immutable digest (`image@sha256:…`) from a trusted registry.

**Step 10: See what the webhook injected**

```bash
kubectl exec -n identity-lab pi-app -- env | grep AWS_CONTAINER
```

**Expected:** ✅
```
AWS_CONTAINER_CREDENTIALS_FULL_URI=http://169.254.170.23/v1/credentials
AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE=/var/run/secrets/pods.eks.amazonaws.com/serviceaccount/eks-pod-identity-token
```

**Step 11: Who is the Pod now?**

```bash
kubectl exec -n identity-lab pi-app -- aws sts get-caller-identity
```

**Expected:** `"Arn": "arn:aws:sts::<account-id>:assumed-role/s3-reader-role/eks-<cluster>-pi-app-…"` ✅ temporary credentials for **its own** role

**Step 12: Read works** (allowed)

```bash
kubectl exec -n identity-lab pi-app -- aws s3 cp s3://identity-lab-$ACCOUNT_ID/hello.txt -
```

**Expected:** `hello from workload identity` ✅

**Step 13: Delete is blocked** (not in the policy)

```bash
kubectl exec -n identity-lab pi-app -- aws s3 rm s3://identity-lab-$ACCOUNT_ID/hello.txt
```

**Expected:** `An error occurred (AccessDenied) …` ❌ authentication worked, **authorization** said no ✅

---

## 15. Lab C: The same with IRSA

**Step 1: Register the cluster's OIDC provider in IAM** (once per cluster)

```bash
eksctl utils associate-iam-oidc-provider --cluster $CLUSTER --region $REGION --approve
```

**Step 2: Save the OIDC issuer (without `https://`)**

```bash
export OIDC=$(aws eks describe-cluster --name $CLUSTER --region $REGION --query "cluster.identity.oidc.issuer" --output text | sed 's#https://##')
```

```bash
echo $OIDC
```

**Expected:** `oidc.eks.us-east-1.amazonaws.com/id/ABC123…` ✅

**Step 3: Write the trust policy** (only `s3-reader-irsa` in `identity-lab` may assume it)

```bash
cat > irsa-trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/$OIDC" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$OIDC:sub": "system:serviceaccount:identity-lab:s3-reader-irsa",
          "$OIDC:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
EOF
```

**Step 4: Create the role and give it S3 read**

```bash
aws iam create-role --role-name s3-reader-irsa-role --assume-role-policy-document file://irsa-trust.json
```

```bash
aws iam attach-role-policy --role-name s3-reader-irsa-role --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess
```

**Step 5: Create the SA with the role annotation**

```bash
kubectl create serviceaccount s3-reader-irsa -n identity-lab
```

```bash
kubectl annotate serviceaccount s3-reader-irsa -n identity-lab eks.amazonaws.com/role-arn=arn:aws:iam::$ACCOUNT_ID:role/s3-reader-irsa-role
```

**Step 6: Run a Pod with that SA**

```bash
kubectl run irsa-app -n identity-lab --image=amazon/aws-cli --overrides='{"spec":{"serviceAccountName":"s3-reader-irsa"}}' --command -- sleep 3600
```

**Step 7: See what the webhook injected**

```bash
kubectl exec -n identity-lab irsa-app -- env | grep -E "AWS_ROLE_ARN|AWS_WEB_IDENTITY"
```

**Expected:** ✅
```
AWS_ROLE_ARN=arn:aws:iam::<account-id>:role/s3-reader-irsa-role
AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/eks.amazonaws.com/serviceaccount/token
```

**Step 8: Who is the Pod?**

```bash
kubectl exec -n identity-lab irsa-app -- aws sts get-caller-identity
```

**Expected:** `assumed-role/s3-reader-irsa-role/botocore-session-…` ✅

**Step 9: Read the file**

```bash
kubectl exec -n identity-lab irsa-app -- aws s3 cp s3://identity-lab-$ACCOUNT_ID/hello.txt -
```

**Expected:** `hello from workload identity` ✅

**Step 10: Prove the `sub` condition matters:** the same role from the wrong SA fails

```bash
kubectl run irsa-wrong -n identity-lab --image=amazon/aws-cli --env=AWS_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/s3-reader-irsa-role --command -- sleep 3600
```

```bash
kubectl exec -n identity-lab irsa-wrong -- aws sts get-caller-identity
```

**Expected:** no web identity token is mounted, so no role: `Unable to locate credentials` or the node role, **never** `s3-reader-irsa-role` ✅

---

## 16. Lab D: Least privilege, one secret only

A real app (like a payment service) reads **one** password from AWS Secrets Manager. `AmazonS3ReadOnlyAccess`-style managed policies are too wide; give exactly one action on exactly one ARN.

**Step 1: Create a test secret** (fake value)

```bash
aws secretsmanager create-secret --name identity-lab/db --secret-string '{"password":"<test-password>"}' --region $REGION
```

**Step 2: Save its ARN**

```bash
export SECRET_ARN=$(aws secretsmanager describe-secret --secret-id identity-lab/db --region $REGION --query ARN --output text)
```

**Step 3: Write a policy for this one secret**

```bash
cat > secret-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "$SECRET_ARN"
    }
  ]
}
EOF
```

**Step 4: Create the role (same Pod Identity trust) and add the policy**

```bash
aws iam create-role --role-name secret-reader-role --assume-role-policy-document file://pod-identity-trust.json
```

```bash
aws iam put-role-policy --role-name secret-reader-role --policy-name read-one-secret --policy-document file://secret-policy.json
```

**Step 5: SA + association + Pod**

```bash
kubectl create serviceaccount secret-reader -n identity-lab
```

```bash
aws eks create-pod-identity-association --cluster-name $CLUSTER --namespace identity-lab --service-account secret-reader --role-arn arn:aws:iam::$ACCOUNT_ID:role/secret-reader-role --region $REGION
```

```bash
kubectl run secret-app -n identity-lab --image=amazon/aws-cli --overrides='{"spec":{"serviceAccountName":"secret-reader"}}' --command -- sleep 3600
```

**Step 6: Read the allowed secret** (only print its name, not the value)

```bash
kubectl exec -n identity-lab secret-app -- aws secretsmanager get-secret-value --secret-id identity-lab/db --region us-east-1 --query Name --output text
```

**Expected:** `identity-lab/db` ✅

**Step 7: Try S3, which this role does NOT have**

```bash
kubectl exec -n identity-lab secret-app -- aws s3 ls
```

**Expected:** `AccessDenied` ❌, each app gets only its own permissions ✅

---

## 17. Lab E: Kyverno guardrails

We add four guardrails to `identity-lab`: **no static AWS keys in Pods**, **no AWS keys in ConfigMaps**, **ECR images only with no `:latest`**, and (optional) **signed images only**. The policies start in **Audit** and then switch to **Deny**.

> **Lab scope:** the lab policies match **only** the `identity-lab` namespace (`operator: In`), so nothing else in your cluster gets blocked. Production policies usually match everything **except** system namespaces (`operator: NotIn`, section 11).

### Install Kyverno

**Step 1: Add the Helm repo**

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/ && helm repo update
```

**Step 2: Install Kyverno** (CEL policy types need **1.17 or later**; in production pin a reviewed chart version with `--version`)

```bash
helm install kyverno kyverno/kyverno -n kyverno --create-namespace
```

**Step 3: Check the Pods**

```bash
kubectl get pods -n kyverno
```

**Expected:** admission, background, cleanup and reports controllers `Running` ✅

**Step 4: Check the CEL policy CRDs exist**

```bash
kubectl get crd | grep -E 'policies.kyverno.io|policyreports'
```

**Expected:** `validatingpolicies.policies.kyverno.io`, `imagevalidatingpolicies.policies.kyverno.io`, … and `policyreports.wgpolicyk8s.io` ✅ (no `validatingpolicies` = Kyverno too old, upgrade it)

### Policy 1: block static AWS keys in Pods

**Step 5: Write the policy (Audit mode)**

```bash
cat > disallow-static-aws-keys.yaml <<'EOF2'
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata:
  name: disallow-static-aws-keys
spec:
  validationActions:
    - Audit
  matchConstraints:
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: In
          values: [identity-lab]
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          !has(c.env) ||
          c.env.all(e,
            !(e.name in ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"])
          )
        )
      message: "Do not inject static AWS access keys into Pods. Use EKS Pod Identity or IRSA."
EOF2
```

**Step 6: Apply it**

```bash
kubectl apply -f disallow-static-aws-keys.yaml
```

```bash
kubectl get validatingpolicies
```

**Expected:** `disallow-static-aws-keys` listed ✅

**Step 7: Test in Audit mode** (fake key values)

```bash
kubectl run leaky1 -n identity-lab --image=amazon/aws-cli --restart=Never --overrides='{"spec":{"serviceAccountName":"s3-reader"}}' --env="AWS_ACCESS_KEY_ID=FAKEKEYID123" --env="AWS_SECRET_ACCESS_KEY=FAKESECRET123" --command -- sleep 3600
```

**Expected:** `pod/leaky1 created` ✅ Audit **allows** it, but records the violation.

**Step 8: See the violation**

```bash
kubectl get policyreport -n identity-lab
```

**Expected:** a `FAIL` for `leaky1` (it can take a minute) ✅

**Step 9: Switch to Deny**

```bash
sed -i 's/- Audit/- Deny/' disallow-static-aws-keys.yaml && kubectl apply -f disallow-static-aws-keys.yaml
```

**Step 10: Try again with a new Pod**

```bash
kubectl run leaky2 -n identity-lab --image=amazon/aws-cli --restart=Never --overrides='{"spec":{"serviceAccountName":"s3-reader"}}' --env="AWS_ACCESS_KEY_ID=FAKEKEYID123" --env="AWS_SECRET_ACCESS_KEY=FAKESECRET123" --command -- sleep 3600
```

**Expected:** ❌ rejected, the Pod is never created ✅
```
Error from server: admission webhook "...kyverno..." denied the request:
... disallow-static-aws-keys ... Do not inject static AWS access keys into Pods. Use EKS Pod Identity or IRSA.
```

> `leaky1` is still running: admission policies only check **new** creates/updates. Delete old violators yourself: `kubectl delete pod leaky1 -n identity-lab`.

### Policy 2: block AWS keys in files (ConfigMaps)

Keys are also hidden in **files**, for example an AWS `credentials` file stored in a ConfigMap and mounted into the Pod. This policy rejects any ConfigMap whose content has an AWS access key ID (`AKIA` + 16 characters) or the `aws_secret_access_key` setting.

**Step 11: Write the policy**

```bash
cat > disallow-aws-keys-in-configmaps.yaml <<'EOF2'
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata:
  name: disallow-aws-keys-in-configmaps
spec:
  validationActions:
    - Deny
  matchConstraints:
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: In
          values: [identity-lab]
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["configmaps"]
  validations:
    - expression: >-
        !has(object.data) ||
        object.data.all(k,
          !object.data[k].matches('AKIA[0-9A-Z]{16}') &&
          !object.data[k].contains('aws_secret_access_key')
        )
      message: "ConfigMaps must not contain AWS access keys. Use EKS Pod Identity or IRSA."
EOF2
```

**Reading it:** "the ConfigMap has no data, or **every** file in it has **no** `AKIA…` key ID and **no** `aws_secret_access_key` line".

**Step 12: Apply it**

```bash
kubectl apply -f disallow-aws-keys-in-configmaps.yaml
```

**Step 13: Try a ConfigMap with a credentials file** (fake key)

```bash
kubectl create configmap aws-creds -n identity-lab --from-literal=credentials="aws_access_key_id=AKIAABCDEFGHIJKLMNOP"
```

**Expected:** ❌ denied: `ConfigMaps must not contain AWS access keys…` ✅

**Step 14: A normal ConfigMap still works**

```bash
kubectl create configmap app-config -n identity-lab --from-literal=LOG_LEVEL=info
```

**Expected:** `configmap/app-config created` ✅

> Kubernetes **Secrets** are base64-encoded, so a plain text match doesn't work on them. Catch keys **before** they reach the cluster with secret scanning in CI (gitleaks, Trivy) and remove the need for keys with Pod Identity.

### Policy 3: ECR images only, no `:latest`

**Step 15: Save your ECR registry address**

```bash
export ECR_REGISTRY=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com
```

**Step 16: Write the policy** (unquoted `EOF2`, so `$ECR_REGISTRY` is filled in)

```bash
cat > trusted-registry-only.yaml <<EOF2
apiVersion: policies.kyverno.io/v1
kind: ValidatingPolicy
metadata:
  name: trusted-registry-only
spec:
  validationActions:
    - Audit
  matchConstraints:
    namespaceSelector:
      matchExpressions:
        - key: kubernetes.io/metadata.name
          operator: In
          values: [identity-lab]
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  validations:
    - expression: >-
        object.spec.containers.all(c,
          c.image.startsWith('$ECR_REGISTRY/')
        )
      message: "All container images must come from the approved ECR registry."
    - expression: >-
        object.spec.containers.all(c,
          !c.image.endsWith(':latest')
        )
      message: "The :latest tag is not allowed. Use a version tag or immutable image digest."
EOF2
```

**Step 17: Check the registry was filled in, then apply**

```bash
grep startsWith trusted-registry-only.yaml
```

**Expected:** `c.image.startsWith('<account-id>.dkr.ecr.us-east-1.amazonaws.com/')` ✅

```bash
kubectl apply -f trusted-registry-only.yaml
```

**Step 18: Test with Docker Hub images (Audit)**

```bash
kubectl run dockerhub -n identity-lab --image=nginx:1.27 --restart=Never
```

```bash
kubectl run latest-tag -n identity-lab --image=nginx:latest --restart=Never
```

**Expected:** both created (Audit), both `FAIL` in the report ✅

```bash
kubectl get policyreport -n identity-lab
```

**Step 19 (optional): Push a versioned image to ECR** (needs Docker on the bastion)

```bash
aws ecr create-repository --repository-name identity-lab/nginx --region $REGION
```

```bash
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_REGISTRY
```

```bash
docker pull nginx:1.27 && docker tag nginx:1.27 $ECR_REGISTRY/identity-lab/nginx:1.27 && docker push $ECR_REGISTRY/identity-lab/nginx:1.27
```

**Step 20: Switch to Deny**

```bash
sed -i 's/- Audit/- Deny/' trusted-registry-only.yaml && kubectl apply -f trusted-registry-only.yaml
```

**Step 21: Docker Hub image is now blocked**

```bash
kubectl run dockerhub2 -n identity-lab --image=nginx:1.27 --restart=Never
```

**Expected:** ❌ `All container images must come from the approved ECR registry.` ✅

**Step 22: ECR image with `:latest` is blocked**

```bash
kubectl run ecr-latest -n identity-lab --image=$ECR_REGISTRY/identity-lab/nginx:latest --restart=Never
```

**Expected:** ❌ `The :latest tag is not allowed…` ✅

**Step 23: ECR image with a version tag passes** (if you did step 19)

```bash
kubectl run ecr-good -n identity-lab --image=$ECR_REGISTRY/identity-lab/nginx:1.27 --restart=Never
```

**Expected:** `pod/ecr-good created` ✅

> Note: from now on `amazon/aws-cli` Pods are also blocked in `identity-lab` (Docker Hub). That is exactly the point; in real life you would mirror the aws-cli image into ECR.

### Policy 4 (optional): signed images only

You already signed an image with **Cosign** and blocked unsigned ones in [Day 32 Lab G](../day-32-api-server-cluster-security-supply-chain/README.md) using the older `ClusterPolicy` + `verifyImages`. The CEL-based way is an **ImageValidatingPolicy**:

```yaml
apiVersion: policies.kyverno.io/v1
kind: ImageValidatingPolicy
metadata:
  name: require-signed-ecr-images
spec:
  validationActions:
    - Deny
  matchConstraints:
    resourceRules:
      - apiGroups: [""]
        apiVersions: ["v1"]
        operations: ["CREATE", "UPDATE"]
        resources: ["pods"]
  matchImageReferences:
    - glob: "<account-id>.dkr.ecr.<region>.amazonaws.com/*"   # only check our ECR images
  attestors:
    - name: cosign
      cosign:
        key:
          data: |
            -----BEGIN PUBLIC KEY-----
            <contents of cosign.pub>
            -----END PUBLIC KEY-----
  validations:
    - expression: >-
        images.containers.map(image, verifyImageSignatures(image, [attestors.cosign])).all(e, e > 0)
      message: "Image is not signed by our CI pipeline."
```

| Field | Meaning |
|---|---|
| `matchImageReferences` | Which images to verify (our ECR) |
| `attestors.cosign.key` | The **public** key; only images signed with the matching private key pass |
| `verifyImageSignatures(...)` | Returns how many valid signatures were found; `> 0` = signed |

**Result:** an image built and signed by CI → allowed ✅; the same image pushed by hand without signing → **blocked**, the Pod is never created ❌. (Field names can differ slightly between Kyverno releases; check `kubectl explain imagevalidatingpolicy.spec` on your version.)

### Extra: no `default` ServiceAccount

The same style works for section 3's rule. Add this to a ValidatingPolicy's `validations` (start with Audit):

```yaml
    - expression: >-
        has(object.spec.serviceAccountName) &&
        object.spec.serviceAccountName != 'default'
      message: "Use a dedicated ServiceAccount, not 'default'."
```

---

## 18. Clean up

```bash
kubectl delete namespace identity-lab
```

```bash
kubectl delete validatingpolicy disallow-static-aws-keys disallow-aws-keys-in-configmaps trusted-registry-only
```

```bash
helm uninstall kyverno -n kyverno && kubectl delete namespace kyverno
```

Delete the pod identity associations (list them, then delete each ID):

```bash
aws eks list-pod-identity-associations --cluster-name $CLUSTER --region $REGION --query "associations[?namespace=='identity-lab'].associationId" --output text
```

```bash
aws eks delete-pod-identity-association --cluster-name $CLUSTER --region $REGION --association-id <association-id>
```

Delete the IAM roles:

```bash
aws iam detach-role-policy --role-name s3-reader-role --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess && aws iam delete-role --role-name s3-reader-role
```

```bash
aws iam detach-role-policy --role-name s3-reader-irsa-role --policy-arn arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess && aws iam delete-role --role-name s3-reader-irsa-role
```

```bash
aws iam delete-role-policy --role-name secret-reader-role --policy-name read-one-secret && aws iam delete-role --role-name secret-reader-role
```

Delete the secret and the bucket:

```bash
aws secretsmanager delete-secret --secret-id identity-lab/db --force-delete-without-recovery --region $REGION
```

```bash
aws s3 rb s3://identity-lab-$ACCOUNT_ID --force
```

If you did the optional ECR step:

```bash
aws ecr delete-repository --repository-name identity-lab/nginx --force --region $REGION
```

Keep the Pod Identity Agent add-on and the OIDC provider (other apps use them), or delete the cluster as usual.

---

# Wrap-up

## 19. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Pod has no `AWS_CONTAINER_*` env vars | Pod created **before** the association, or wrong namespace/SA name in the association | Check `list-pod-identity-associations`; delete and recreate the Pod |
| Pod has no `AWS_ROLE_ARN` (IRSA) | SA not annotated, or Pod created before the annotation | `kubectl describe sa X`; restart the Pod |
| `get-caller-identity` shows the **node role** | No Pod Identity / IRSA for that SA; SDK fell back to IMDS | Add the association/annotation; set IMDSv2 hop limit 1 on nodes |
| Pod Identity: `Unable to locate credentials` / connection refused to `169.254.170.23` | Agent add-on missing, or node role lacks `eks-auth:AssumeRoleForPodIdentity` | `kubectl get ds eks-pod-identity-agent -n kube-system`; node role needs `AmazonEKSWorkerNodePolicy` |
| IRSA: `InvalidIdentityToken` / `No OpenIDConnect provider found` | OIDC provider not registered in IAM | `eksctl utils associate-iam-oidc-provider --approve` |
| IRSA: `Not authorized to perform sts:AssumeRoleWithWebIdentity` | Trust policy `sub` doesn't match `system:serviceaccount:<ns>:<sa>` or wrong OIDC ID | Fix the namespace/SA name and OIDC ID in the trust policy |
| Pod Identity: `AccessDenied` on assume | Trust policy missing `sts:TagSession` or wrong principal | Principal `pods.eks.amazonaws.com`, actions `sts:AssumeRole` + `sts:TagSession` |
| `AccessDenied` on the AWS call itself | Authentication OK, the IAM **policy** doesn't allow that action/resource | Add the exact action + resource ARN to the role policy |
| Old SDK ignores Pod Identity | SDK version too old for container credentials | Upgrade the AWS SDK / CLI in the image |
| Fargate Pod gets nothing with Pod Identity | Pod Identity doesn't support Fargate | Use IRSA |
| Kyverno policy not blocking | `validationActions: [Audit]`, or namespace/resource/operation not matched | Set `Deny`; check `matchConstraints`; `kubectl describe validatingpolicy X` |
| `no matches for kind "ValidatingPolicy"` | Kyverno too old for the CEL policy types | Upgrade Kyverno (1.17+), check `kubectl get crd \| grep policies.kyverno.io` |
| Old violating Pod still running after switching to Deny | Admission only checks new creates/updates | Delete/redeploy old Pods; read the PolicyReport |
| Deployment accepted but its Pods never appear | Pod-level policy rejects the Pods the ReplicaSet creates | `kubectl describe rs` / `kubectl get events` shows the Kyverno denial |
| Everything in a namespace suddenly blocked (e.g. aws-cli images) | Registry policy in Deny and images still come from Docker Hub | Mirror images into ECR, or a narrow `PolicyException` with an owner and expiry |
| PolicyReport empty | Reports controller still scanning | Wait a minute; `kubectl get pods -n kyverno` |

---

## 20. What I learned

**Concepts**
- **Workload identity** = the Pod gets its own identity and **temporary credentials**, no stored keys.
- The **ServiceAccount** is that identity; whenever a Pod needs **authentication and authorization**, to the K8s API or to a third-party tool, we give it a ServiceAccount.
- **AuthN** = who (SA → IAM role); **AuthZ** = what (IAM policy / RBAC).
- **EKS Pod Identity:** agent add-on + role trusting `pods.eks.amazonaws.com` + association (cluster, namespace, SA → role). Simple, reusable roles, session tags, no Fargate.
- **IRSA:** OIDC provider + role trusting it with a `sub` condition + SA annotation. Works on Fargate and non-EKS.
- Without either, Pods may use the **node role**: shared by every Pod, so block IMDS (hop limit 1).
- Same pattern for Vault, External Secrets, LB Controller, GKE, AKS.
- **Kyverno** = policy engine at the cluster door (admission). **Pod Identity decides what a Pod can do in AWS; Kyverno decides which Pods can run.** Use both.
- Kyverno guardrails: **ECR images only**, **no `:latest`**, **no static AWS keys** (Pods and files), **signed images only**.
- CEL policy types (`policies.kyverno.io/v1`, Kyverno 1.17+): ValidatingPolicy, MutatingPolicy, GeneratingPolicy, ImageValidatingPolicy, DeletingPolicy, plus PolicyException.
- Roll out safely: **Audit → PolicyReport → fix → exceptions → Deny in staging → Deny in prod**.

**Lab**
- Pod with no identity → node role or no credentials.
- Pod Identity and IRSA Pods read S3, delete is `AccessDenied`.
- A role scoped to one secret ARN reads only that secret.
- Kyverno: static-key Pod allowed in Audit, rejected in Deny; ConfigMap with an `AKIA…` key rejected; Docker Hub and `:latest` images reported, then blocked.

## 21. Commands

| Command | What it does |
|---|---|
| `aws eks create-addon --cluster-name C --addon-name eks-pod-identity-agent` | Install the Pod Identity Agent |
| `aws eks create-pod-identity-association --cluster-name C --namespace N --service-account SA --role-arn ARN` | Link SA → IAM role (Pod Identity) |
| `aws eks list-pod-identity-associations --cluster-name C` | List associations |
| `eksctl utils associate-iam-oidc-provider --cluster C --approve` | Register the cluster's OIDC provider (IRSA) |
| `aws eks describe-cluster --name C --query cluster.identity.oidc.issuer` | Get the OIDC issuer URL |
| `kubectl annotate sa SA eks.amazonaws.com/role-arn=ARN` | Link SA → IAM role (IRSA) |
| `eksctl create iamserviceaccount --cluster C --namespace N --name SA --attach-policy-arn P --approve` | IRSA role + SA in one command |
| `kubectl exec POD -- aws sts get-caller-identity` | Which IAM identity is this Pod using? |
| `kubectl exec POD -- env \| grep AWS_` | See injected credential env vars |
| `kubectl get validatingpolicies` | List Kyverno CEL validating policies |
| `kubectl describe validatingpolicy X` | Policy details and status |
| `kubectl get crd \| grep policies.kyverno.io` | Check the CEL policy types are installed |
| `kubectl get policyreport -n N` | Audit results (PASS / FAIL) |

## 22. Interview Questions

### ⭐ Very Important

**Q1. What is a ServiceAccount, and what is its purpose?**
A ServiceAccount is the identity of an application running in a Pod. Its purpose is authentication and authorization: whenever a Pod needs to talk to the Kubernetes API or to a third-party tool (AWS, Vault, a cloud service), we give it a ServiceAccount, and permissions are attached to that identity through RBAC or a cloud IAM role.

**Q2. How do you give a Pod temporary access to a third-party tool like AWS S3 or Secrets Manager?**
Use workload identity: create a dedicated ServiceAccount, create an IAM role with only the needed permissions, and link them with EKS Pod Identity (pod identity association) or IRSA (OIDC trust + SA annotation). The Pod receives short-lived STS credentials for that role, which the AWS SDK refreshes automatically. No access keys are stored anywhere.

**Q3. What is workload identity, and why is it better than storing keys?**
It gives a workload its own identity that the cloud trusts, so the Pod gets temporary credentials instead of long-lived keys. Keys in images, env vars, ConfigMaps or Secrets never expire and leak easily; temporary credentials expire and rotate on their own, are scoped to one role, and show the role/session in CloudTrail.

**Q4. Authentication vs authorization for Pods?**
Authentication proves who the Pod is: its ServiceAccount token, exchanged for an IAM role on EKS. Authorization decides what it may do: the IAM policy on that role for AWS, or RBAC Roles and RoleBindings for the Kubernetes API.

**Q5. EKS Pod Identity vs IRSA?**
Both map a ServiceAccount to an IAM role and give temporary credentials. Pod Identity uses a node agent add-on, a generic trust policy (`pods.eks.amazonaws.com`) and an association in the EKS API, so roles are reusable across clusters and get session tags. IRSA uses the cluster's OIDC provider, a per-cluster trust policy with a `sub` condition and an annotation on the SA; it's needed for Fargate and non-EKS clusters.

**Q6. What is the purpose of EKS Pod Identity? Is it an annotation on the ServiceAccount?**
Its purpose is communication between Pods and AWS services: when a Pod wants to call S3, Secrets Manager or DynamoDB, Pod Identity gives it the right IAM role with temporary credentials. The alternative is IRSA. No, it's not an annotation: the association (cluster + namespace + ServiceAccount → IAM role) is stored in EKS. The namespace and ServiceAccount can be created before or after it, but must exist before the Pod starts.

**Q7. Where does Kyverno fit with Pod Identity / IRSA?**
They are two layers. Pod Identity / IRSA controls what an approved workload can do in AWS. Kyverno is an admission policy engine that controls which resources are allowed into the cluster and how they're configured, for example rejecting Pods with static AWS keys or Pods on the default ServiceAccount. Use both; neither replaces the other.

**Q8. How do you make sure only trusted images run in EKS?**
A Kyverno ValidatingPolicy that allows only images from our company ECR registry and blocks the `:latest` tag, plus an ImageValidatingPolicy that only allows images signed (Cosign) by our CI pipeline. Unsigned or Docker Hub images are rejected at admission, so the Pod is never created. CI also scans images before pushing them to ECR.

**Q9. How do you stop static AWS keys from being used in Pods?**
Remove the need for them with Pod Identity or IRSA, then add a Kyverno policy that denies Pods with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars and ConfigMaps containing `AKIA…` keys. It's a guardrail, not a full scanner, so CI secret scanning (gitleaks, Trivy) catches keys in code and images too.

**Q10. What is the default ServiceAccount? Does it get all permissions?**
Every namespace automatically gets a ServiceAccount called `default`, and Pods without `serviceAccountName` use it. It has almost no permissions out of the box: no RBAC Roles and no AWS role. But every Pod in the namespace shares it. Any permission granted to it goes to all of those Pods, so each app should get its own ServiceAccount with least privilege, and apps that don't call the API should set `automountServiceAccountToken: false`.

### Other Questions

**Q11. What are the Kyverno policy types?**
In the CEL-based API (`policies.kyverno.io/v1`): ValidatingPolicy (allow/deny), MutatingPolicy (change resources), GeneratingPolicy (create related resources), ImageValidatingPolicy (verify signatures and attestations), DeletingPolicy (clean up on a schedule), and the companion PolicyException to exempt specific resources. Older guides use `ClusterPolicy` with validate/mutate/generate/verifyImages rules.

**Q12. What are the limits of a Kyverno env-var key check?**
It only sees env var names in the Pod spec. Keys baked into the image, mounted files, command arguments or app config aren't caught, and the basic version skips init and ephemeral containers. Pair it with CI secret scanning and Pod Identity so no keys are needed at all.

**Q13. How does IRSA work under the hood?**
The cluster has an OIDC issuer that signs projected ServiceAccount tokens. That issuer is registered as an identity provider in IAM. The EKS webhook injects `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`; the SDK sends the token to STS `AssumeRoleWithWebIdentity`, STS verifies the signature and the trust policy's `sub`/`aud` conditions and returns temporary credentials.

**Q14. How does EKS Pod Identity work under the hood?**
The webhook injects `AWS_CONTAINER_CREDENTIALS_FULL_URI` (the agent at `169.254.170.23`) and a token file. The SDK calls the Pod Identity Agent on its node, which calls the EKS Auth API `AssumeRoleForPodIdentity`. EKS checks the association for that cluster, namespace and SA and returns credentials for the role.

**Q15. A Pod is using the node's IAM role. Why is that bad and how do you fix it?**
Every Pod on that node shares the same permissions, so there's no least privilege and a compromised Pod gets everything the node can do. Give each app its own Pod Identity / IRSA role, keep the node role minimal, and require IMDSv2 with hop limit 1 so Pods can't reach instance metadata.

**Q16. You created the association but the Pod still has no AWS credentials. What do you check?**
Was the Pod created before the association (restart it)? Do the namespace and SA name match exactly? Is the Pod Identity Agent DaemonSet running? Does the trust policy allow `pods.eks.amazonaws.com` with `sts:AssumeRole` and `sts:TagSession`? Is the SDK new enough? Is it a Fargate Pod (use IRSA)?

**Q17. Credentials work but the call returns AccessDenied. What does that mean?**
Authentication succeeded and the Pod has the role; authorization failed. The role's IAM policy doesn't allow that action on that resource. Add the exact action and resource ARN, nothing wider.

**Q18. How do Pods authenticate to HashiCorp Vault?**
With the Kubernetes auth method: the Pod sends its ServiceAccount token to Vault, Vault validates it with the Kubernetes TokenReview API, and maps the SA name + namespace to a Vault role with a Vault policy.

**Q19. Audit vs Deny in Kyverno?**
Audit lets the resource through and records the violation in a PolicyReport; Deny rejects it at admission so the Pod is never created. Start with Audit to find existing violations, fix them, test Deny in staging, then roll Deny out to production gradually.

**Q20. Which cluster add-ons need their own IAM role?**
Any controller that calls AWS: AWS Load Balancer Controller, EBS/EFS CSI drivers, Cluster Autoscaler or Karpenter, External Secrets Operator, ExternalDNS, the VPC CNI. Each gets its own ServiceAccount and IAM role with only the actions it needs.
