# Day 36 - Workload Identity: ServiceAccounts, EKS Pod Identity, IRSA and Kyverno

[← Kubernetes notes](../README.md)

> **In short:** **workload identity** means a Pod gets its **own identity** so it can talk to **third-party tools** (AWS S3, Secrets Manager, DynamoDB, Vault, GCP, Azure) **without storing any access keys**. In Kubernetes that identity is the **ServiceAccount**. On EKS we link the ServiceAccount to an **IAM role** with **EKS Pod Identity** (newer, simpler) or **IRSA** (IAM Roles for Service Accounts, OIDC-based). The Pod then receives **temporary credentials** that expire and rotate automatically. **Authentication** = *who is this Pod?* (ServiceAccount → IAM role). **Authorization** = *what may it do?* (the IAM policy on the role, or RBAC inside the cluster). **Kyverno** adds a second layer: it controls **which Pods are allowed into the cluster** at all, for example "no Pod may use the `default` ServiceAccount" or "no Pod may carry static AWS keys".

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | The problem (long-lived keys), what workload identity is, the ServiceAccount as identity, authentication vs authorization, temporary credentials, EKS Pod Identity, IRSA, Pod Identity vs IRSA, the node role trap, identity for other third-party tools, where Kyverno fits | How a Pod proves who it is to an outside tool, and how to get least-privilege, short-lived access |
| **Part 2: Lab** | A Pod with no identity, S3 read with Pod Identity, the same with IRSA, least privilege for one secret in Secrets Manager, Kyverno policies (no default SA, no static AWS keys) | Run each method on EKS and prove what it can and can't do |

> **Before this:** [Day 30 - RBAC](../day-30-rbac/README.md) · [Day 31 - ServiceAccounts](../day-31-service-accounts/README.md) (the basics: default SA, tokens, RBAC) · [Day 28 - Admission controllers](../day-28-kustomize-admission-controllers-crds/README.md) (how Kyverno plugs in) · [Day 32 - Supply chain security](../day-32-api-server-cluster-security-supply-chain/README.md) (Kyverno for image signatures)

## Table of Contents

**Part 1: Concepts**
1. [The problem: long-lived keys in Pods](#1-the-problem-long-lived-keys-in-pods)
2. [What is workload identity?](#2-what-is-workload-identity)
3. [The ServiceAccount: the Pod's identity](#3-the-serviceaccount-the-pods-identity)
4. [Authentication vs authorization](#4-authentication-vs-authorization)
5. [Temporary credentials: why short-lived wins](#5-temporary-credentials-why-short-lived-wins)
6. [EKS Pod Identity (newer, simpler)](#6-eks-pod-identity-newer-simpler)
7. [IRSA: IAM Roles for Service Accounts (OIDC)](#7-irsa-iam-roles-for-service-accounts-oidc)
8. [Pod Identity vs IRSA: which one?](#8-pod-identity-vs-irsa-which-one)
9. [The node role trap](#9-the-node-role-trap)
10. [Other third-party tools: same idea everywhere](#10-other-third-party-tools-same-idea-everywhere)
11. [Where Kyverno fits](#11-where-kyverno-fits)

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

## 6. EKS Pod Identity (newer, simpler)

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

## 11. Where Kyverno fits

**Definition:** **Kyverno** is a **Kubernetes-native policy engine**. It runs as an **admission webhook** and can **validate**, **mutate**, **generate** and **clean up** resources, and **verify image signatures**. Policies are written in YAML (no new language).

Workload identity and Kyverno solve **different** problems, so you use **both**:

| Layer | Question it answers | Example |
|---|---|---|
| **Pod Identity / IRSA** | What can an **approved** workload do in **AWS**? | `s3-reader` may only read one bucket |
| **Kyverno** | Which workloads are **allowed into the cluster** and **how they must be configured**? | Block Pods that use the `default` SA or carry `AWS_ACCESS_KEY_ID` |

```
 kubectl apply ──► API server ──► AuthN/AuthZ (RBAC) ──► Kyverno (admission)
                                                           │ ❌ uses default SA / has static AWS keys → rejected
                                                           │ ✅ OK → Pod created
                                                           ▼
                                                 Pod runs ──► Pod Identity ──► IAM role ──► AWS
```

**Policy modes:**

| `failureAction` | What happens |
|---|---|
| `Audit` | Pod is allowed, violation is recorded in a **PolicyReport** (good to start with) |
| `Enforce` | Pod is **rejected** at admission |

> **Interview one-liner:** Pod Identity / IRSA controls what an approved workload can do in AWS; Kyverno controls which resources may enter the cluster and how they're configured. Neither replaces the other.

---

# Part 2: Lab

We give an `aws-cli` Pod access to S3 three ways and then add Kyverno guardrails.

```
 namespace identity-lab
 no-identity     (SA default)          ──► AWS? node role or no credentials
 pi-app          (SA s3-reader)        ──► Pod Identity ──► s3-reader-role  ──► S3 read only
 irsa-app        (SA s3-reader-irsa)   ──► IRSA         ──► s3-reader-irsa-role ──► S3 read only
 secret-app      (SA secret-reader)    ──► Pod Identity ──► secret-reader-role ──► ONE secret
 Kyverno: no default SA (Audit) · no static AWS keys (Enforce)
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

**Step 1: Add the Helm repo**

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/ && helm repo update
```

**Step 2: Install Kyverno**

```bash
helm install kyverno kyverno/kyverno -n kyverno --create-namespace
```

**Step 3: Check it**

```bash
kubectl get pods -n kyverno
```

**Expected:** admission, background, cleanup and reports controllers `Running` ✅

**Step 4: Policy 1 (Audit): Pods should not use the `default` ServiceAccount**

```bash
cat > no-default-sa.yaml <<'EOF'
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-default-serviceaccount
spec:
  background: true
  rules:
  - name: no-default-sa
    match:
      any:
      - resources:
          kinds: ["Pod"]
          namespaces: ["identity-lab"]
    validate:
      failureAction: Audit
      message: "Use a dedicated ServiceAccount, not 'default'."
      pattern:
        spec:
          serviceAccountName: "!default"
EOF
```

```bash
kubectl apply -f no-default-sa.yaml
```

**Step 5: Policy 2 (Enforce): no static AWS keys in env vars**

```bash
cat > no-static-aws-keys.yaml <<'EOF'
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-static-aws-keys
spec:
  background: true
  rules:
  - name: no-aws-keys-in-env
    match:
      any:
      - resources:
          kinds: ["Pod"]
          namespaces: ["identity-lab"]
    validate:
      failureAction: Enforce
      message: "Static AWS keys are not allowed. Use EKS Pod Identity or IRSA."
      deny:
        conditions:
          any:
          - key: "{{ request.object.spec.containers[].env[].name || `[]` }}"
            operator: AnyIn
            value: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
EOF
```

```bash
kubectl apply -f no-static-aws-keys.yaml
```

**Step 6: Check both policies are ready**

```bash
kubectl get clusterpolicy
```

**Expected:** both with `READY True` ✅

**Step 7: Try a Pod with static keys (fake values)**

```bash
kubectl run leaky -n identity-lab --image=amazon/aws-cli --env=AWS_ACCESS_KEY_ID=FAKEKEY --env=AWS_SECRET_ACCESS_KEY=FAKESECRET --command -- sleep 3600
```

**Expected:** ❌ rejected ✅
```
admission webhook "validate.kyverno.svc-fail" denied the request:
... disallow-static-aws-keys: no-aws-keys-in-env: Static AWS keys are not allowed. Use EKS Pod Identity or IRSA.
```

**Step 8: Pods on the default SA are allowed but reported**

```bash
kubectl get policyreport -n identity-lab
```

**Expected:** `FAIL` counts for `no-identity` and `irsa-wrong` (they use `default`), `PASS` for `pi-app`, `irsa-app`, `secret-app` ✅ (reports can take a minute)

**Step 9: See the details**

```bash
kubectl describe policyreport -n identity-lab | grep -B2 -A6 "Result:  fail"
```

> **Next step in real life:** after teams fix the `FAIL`s, switch policy 1 from `Audit` to `Enforce`.

---

## 18. Clean up

```bash
kubectl delete namespace identity-lab
```

```bash
kubectl delete clusterpolicy disallow-default-serviceaccount disallow-static-aws-keys
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
| Kyverno policy not blocking | `failureAction: Audit`, or namespace/kind not matched | Set `Enforce`; check `match`; `kubectl get clusterpolicy` READY |
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
- **Kyverno** = admission policy engine; Pod Identity controls what an approved Pod can do in AWS, Kyverno controls what may enter the cluster. Use both.

**Lab**
- Pod with no identity → node role or no credentials.
- Pod Identity and IRSA Pods read S3, delete is `AccessDenied`.
- A role scoped to one secret ARN reads only that secret.
- Kyverno rejected a Pod with static AWS keys and reported Pods on the default SA.

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
| `kubectl get clusterpolicy` | Kyverno policies and READY status |
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

**Q8. What is the default ServiceAccount? Does it get all permissions?**
Every namespace automatically gets a ServiceAccount called `default`, and Pods without `serviceAccountName` use it. It has almost no permissions out of the box: no RBAC Roles and no AWS role. But every Pod in the namespace shares it. Any permission granted to it goes to all of those Pods, so each app should get its own ServiceAccount with least privilege, and apps that don't call the API should set `automountServiceAccountToken: false`.

### Other Questions

**Q9. How does IRSA work under the hood?**
The cluster has an OIDC issuer that signs projected ServiceAccount tokens. That issuer is registered as an identity provider in IAM. The EKS webhook injects `AWS_ROLE_ARN` and `AWS_WEB_IDENTITY_TOKEN_FILE`; the SDK sends the token to STS `AssumeRoleWithWebIdentity`, STS verifies the signature and the trust policy's `sub`/`aud` conditions and returns temporary credentials.

**Q10. How does EKS Pod Identity work under the hood?**
The webhook injects `AWS_CONTAINER_CREDENTIALS_FULL_URI` (the agent at `169.254.170.23`) and a token file. The SDK calls the Pod Identity Agent on its node, which calls the EKS Auth API `AssumeRoleForPodIdentity`. EKS checks the association for that cluster, namespace and SA and returns credentials for the role.

**Q11. A Pod is using the node's IAM role. Why is that bad and how do you fix it?**
Every Pod on that node shares the same permissions, so there's no least privilege and a compromised Pod gets everything the node can do. Give each app its own Pod Identity / IRSA role, keep the node role minimal, and require IMDSv2 with hop limit 1 so Pods can't reach instance metadata.

**Q12. You created the association but the Pod still has no AWS credentials. What do you check?**
Was the Pod created before the association (restart it)? Do the namespace and SA name match exactly? Is the Pod Identity Agent DaemonSet running? Does the trust policy allow `pods.eks.amazonaws.com` with `sts:AssumeRole` and `sts:TagSession`? Is the SDK new enough? Is it a Fargate Pod (use IRSA)?

**Q13. Credentials work but the call returns AccessDenied. What does that mean?**
Authentication succeeded and the Pod has the role; authorization failed. The role's IAM policy doesn't allow that action on that resource. Add the exact action and resource ARN, nothing wider.

**Q14. How do Pods authenticate to HashiCorp Vault?**
With the Kubernetes auth method: the Pod sends its ServiceAccount token to Vault, Vault validates it with the Kubernetes TokenReview API, and maps the SA name + namespace to a Vault role with a Vault policy.

**Q15. Audit vs Enforce in Kyverno?**
Audit lets the resource through and records the violation in a PolicyReport; Enforce rejects it at admission. Start with Audit to find existing violations, fix them, then switch to Enforce.

**Q16. Which cluster add-ons need their own IAM role?**
Any controller that calls AWS: AWS Load Balancer Controller, EBS/EFS CSI drivers, Cluster Autoscaler or Karpenter, External Secrets Operator, ExternalDNS, the VPC CNI. Each gets its own ServiceAccount and IAM role with only the actions it needs.
