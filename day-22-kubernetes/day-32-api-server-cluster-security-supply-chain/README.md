# Day 32 - API Server, Cluster Security Layers and Supply Chain Security

[← Kubernetes notes](../README.md)

> **In short:** the **API server** is the **front door** of Kubernetes: every request (kubectl, Pods, Argo CD) goes through it, gets checked, and is stored in etcd. The **API operations** (get, list, watch, create, update, patch, delete) are the actions you can do. A cluster is protected in **layers**: secure images, supply chain checks, a private cluster, RBAC, ServiceAccounts, Security Contexts, admission controllers and Network Policies. **Supply chain security** makes sure **only trusted, verified images** run: **Build → Scan (SBOM) → Sign (Cosign) → Enforce (Kyverno)**. Unsigned images are blocked.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | API server, common API operations and patch, the layers that protect a cluster, private cluster, Docker image strategies (traditional, multi-stage, distroless), supply chain security (4 pillars, Trivy, Syft, Cosign, Kyverno), the best real-time pipeline | How a request is handled, and every way to protect a cluster |
| **Part 2: Lab** | Watch kubectl's API calls, call the API with curl, 3 kinds of patch, build 3 images and compare size + vulnerabilities, generate an SBOM, sign with Cosign, block unsigned images with Kyverno | Do each security step yourself |

> **Before this:** [Day 30 - RBAC](../day-30-rbac/README.md) · [Day 31 - ServiceAccounts and Security Context](../day-31-service-accounts/README.md) · Admission controllers: [Day 28](../day-28-kustomize-admission-controllers-crds/README.md) · **Next:** [Day 33 - OpenTelemetry](../day-33-opentelemetry/README.md)

## Table of Contents

**Part 1: Concepts**
1. [The API server: front door of the cluster](#1-the-api-server-front-door-of-the-cluster)
2. [Common API operations](#2-common-api-operations)
3. [Update vs patch, and the 3 patch types](#3-update-vs-patch-and-the-3-patch-types)
4. [How many ways can you protect a Kubernetes cluster?](#4-how-many-ways-can-you-protect-a-kubernetes-cluster)
5. [Private cluster](#5-private-cluster)
6. [Docker image strategies: smaller, faster, more secure](#6-docker-image-strategies-smaller-faster-more-secure)
7. [What is software supply chain security?](#7-what-is-software-supply-chain-security)
8. [The 4 pillars: Build → Inspect → Verify → Enforce](#8-the-4-pillars-build--inspect--verify--enforce)
9. [Best real-time pipeline: e-commerce example](#9-best-real-time-pipeline-e-commerce-example)

**Part 2: Lab**

10. [Lab setup](#10-lab-setup)
11. [Lab A: See kubectl's API calls](#11-lab-a-see-kubectls-api-calls)
12. [Lab B: Call the API with curl](#12-lab-b-call-the-api-with-curl)
13. [Lab C: The 3 patch types](#13-lab-c-the-3-patch-types)
14. [Lab D: Traditional vs multi-stage vs distroless](#14-lab-d-traditional-vs-multi-stage-vs-distroless)
15. [Lab E: Scan with Trivy and create an SBOM with Syft](#15-lab-e-scan-with-trivy-and-create-an-sbom-with-syft)
16. [Lab F: Sign the image with Cosign](#16-lab-f-sign-the-image-with-cosign)
17. [Lab G: Block unsigned images with Kyverno](#17-lab-g-block-unsigned-images-with-kyverno)
18. [Clean up](#18-clean-up)

**Wrap-up**

19. [Troubleshooting](#19-troubleshooting)
20. [What I learned](#20-what-i-learned)
21. [Commands](#21-commands)
22. [Interview Questions](#22-interview-questions)

---

# Part 1: Concepts

## 1. The API server: front door of the cluster

**Definition:** the **API server** (`kube-apiserver`) is the control plane component that **receives every request** to the cluster, **checks it**, and **stores the result in etcd**. Nothing else talks to etcd directly. It's the front door of the cluster.

```
  User (kubectl)    Application (Pod / Argo CD)    Other components (kubelet, scheduler, controllers)
        │                    │                                  │
        └────────────────────┼──────────────────────────────────┘
                             ▼
                    ┌─────────────────┐
                    │   API SERVER    │
                    │ ① Authentication│  who are you?        (IAM / certificate / SA token)
                    │ ② Authorization │  are you allowed?    (RBAC, Day 30)
                    │ ③ Admission     │  is the object OK?   (Day 28, Kyverno, Pod Security)
                    │ ④ Validation    │  is the YAML valid?
                    └────────┬────────┘
                             ▼
                          etcd   (cluster data store)
```

| What the API server does | Meaning |
|---|---|
| **Front door** | The only entry point to the cluster |
| **Receives all requests** | From users, applications and other components |
| **Validates requests** | Bad YAML or a disallowed object is rejected before anything happens |
| **Stores data in etcd** | Every Pod, Deployment, Secret is saved in etcd through it |
| **Enforces security** | Authentication + authorization (+ admission) on every request |
| **Only it talks to etcd** | The scheduler, kubelet, controllers all go through the API server |

> **Interview one-liner:** the API server is the front door of Kubernetes: every request from users, apps and components goes through it, it authenticates, authorizes, runs admission and validation, then stores the object in etcd; no component talks to etcd directly.

---

## 2. Common API operations

**Definition:** **API operations** (also called **verbs**) are the **actions you can perform on Kubernetes resources**. They are the same words you write in an RBAC Role (Day 30).

| Operation | What it does | kubectl example | HTTP call |
|---|---|---|---|
| **get** | Retrieve **one** resource | `kubectl get pod web` | `GET /api/v1/namespaces/ns/pods/web` |
| **list** | Retrieve **many** resources | `kubectl get pods` | `GET /api/v1/namespaces/ns/pods` |
| **watch** | Monitor changes **in real time** | `kubectl get pods -w` | `GET .../pods?watch=true` |
| **create** | Create a **new** resource | `kubectl create -f pod.yaml` | `POST .../pods` |
| **update** | Replace an **existing** resource (whole object) | `kubectl replace -f pod.yaml` | `PUT .../pods/web` |
| **patch** | Change **only specific fields** | `kubectl patch`, `kubectl scale`, `kubectl apply` | `PATCH .../pods/web` |
| **delete** | Remove a resource | `kubectl delete pod web` | `DELETE .../pods/web` |

```
 kubectl get pods  ──►  HTTPS GET /api/v1/namespaces/default/pods  ──►  API server  ──►  JSON  ──►  table
```

> **kubectl is just an API client.** Every command becomes an HTTPS call. Add `-v=6` to any command to see it (Lab A).

> **Interview one-liner:** the API operations are get, list, watch, create, update, patch and delete; kubectl turns each command into an HTTP call (GET, POST, PUT, PATCH, DELETE), and RBAC uses the same verbs to allow or deny them.

---

## 3. Update vs patch, and the 3 patch types

| | **update** (PUT) | **patch** (PATCH) |
|---|---|---|
| Sends | The **whole** object | **Only the fields to change** |
| Risk | Overwrites changes someone else made meanwhile (conflict error if the object changed) | Small, safe, fewer conflicts |
| Used by | `kubectl replace`, `kubectl edit` (sends the full object) | `kubectl patch`, `kubectl scale`, `kubectl apply`, `kubectl label` |

**The 3 patch types:**

| Type | Flag | How it works | Example |
|---|---|---|---|
| **Strategic merge** (default) | `--type=strategic` | Kubernetes-aware merge: knows lists like `containers` are matched by `name` | `kubectl patch deploy web -p '{"spec":{"replicas":3}}'` |
| **JSON merge** | `--type=merge` | Plain merge: a list is **replaced** as a whole. Works on CRDs too | `kubectl patch deploy web --type=merge -p '{"metadata":{"labels":{"team":"shop"}}}'` |
| **JSON patch** | `--type=json` | A list of exact operations (`add`, `replace`, `remove`) on a path | `kubectl patch deploy web --type=json -p '[{"op":"replace","path":"/spec/replicas","value":2}]'` |

**When to use patch in real time:** quick fixes in scripts and pipelines (change replicas, an image, a label, the blue-green Service selector from Day 29) without editing the full YAML. In GitOps (Argo CD) we change the YAML in Git instead, otherwise Argo CD reverts the patch.

---

## 4. How many ways can you protect a Kubernetes cluster?

Security is done in **layers**: if one fails, the next one still stops the attacker. Follow a request and an image from the developer to the running Pod:

```
 ① Secure images ─► ② Supply chain ─► ③ Private cluster ─► ④ RBAC + ⑤ ServiceAccounts
 (multi-stage,      (scan, SBOM,      (no public API,        (who can do what
  distroless)        sign, verify)     private nodes)         in the API)
                                              │
 ⑧ Network Policies ◄─ ⑦ Admission controllers ◄─ ⑥ Security Context
 (who can talk         (Kyverno / Pod Security:    (non-root, drop ALL
  to whom)              block bad objects)          capabilities)
                                              │
                    ⑨ Secrets, ⑩ audit logs + runtime security (Falco), upgrades
```

| # | Layer | Protects against | Tool / setting | Notes |
|---|---|---|---|---|
| 1 | **Secure images** (multi-stage, distroless) | Extra tools and libraries an attacker can use, more CVEs | Multi-stage Dockerfile, distroless base | [Section 6](#6-docker-image-strategies-smaller-faster-more-secure) |
| 2 | **Supply chain security** | Vulnerable, fake or modified images | Trivy, Syft, Cosign, Kyverno | [Section 7](#7-what-is-software-supply-chain-security) |
| 3 | **Private cluster** | Attacks on the API server from the internet | Private endpoint, private subnets, bastion | [Section 5](#5-private-cluster) |
| 4 | **RBAC** | Users and tools doing more than they should in the API | Role, ClusterRole, bindings | [Day 30](../day-30-rbac/README.md) |
| 5 | **ServiceAccounts** | Pods sharing one identity, leaked tokens | Custom SA per app, `automountServiceAccountToken: false` | [Day 31](../day-31-service-accounts/README.md) |
| 6 | **Security Context** | Root processes, privilege escalation inside a container | `runAsNonRoot`, drop ALL capabilities | [Day 31](../day-31-service-accounts/README.md#20-what-is-a-security-context) |
| 7 | **Admission controllers** | Bad objects being created (root Pods, `:latest`, unsigned images) | Pod Security Admission, Kyverno, OPA Gatekeeper | [Day 28](../day-28-kustomize-admission-controllers-crds/README.md) |
| 8 | **Network Policies** | A hacked Pod reaching every other Pod (e.g. the database) | NetworkPolicy, default deny | [Day 25](../day-25-dns-network-policy/README.md) |
| 9 | **Secrets management** | Passwords in images, Git or plain ConfigMaps | AWS Secrets Manager, External Secrets, etcd encryption with KMS | |
| 10 | **Audit + runtime security** | Attacks that get past everything else | API audit logs (CloudWatch), Falco, regular upgrades | [Day 24](../day-24-probes/README.md) |

> **Interview answer:** "I protect a cluster in layers: small, scanned, signed images; a private cluster; RBAC and a custom ServiceAccount per app; Security Contexts with non-root and dropped capabilities; admission controllers like Kyverno and Pod Security to block bad or unsigned workloads; Network Policies with default deny; secrets in AWS Secrets Manager; and audit logs plus Falco for detection."

---

## 5. Private cluster

**Definition:** a **private cluster** is a cluster whose **API server and worker nodes are not reachable from the internet**. Only machines inside the VPC (bastion, VPN, CI runners in the VPC) can run kubectl.

| | Public cluster | Private cluster |
|---|---|---|
| API endpoint | Public internet (anyone can try to connect) | Private IP in the VPC only |
| Worker nodes | Can have public IPs | Private subnets, no public IPs |
| kubectl from | Anywhere | Bastion / VPN / CI runner inside the VPC |
| Internet access for nodes | Direct | NAT gateway (pull images) |
| Users reach the app | Load balancer | Load balancer in public subnets (only the app is public, not the cluster) |

**On EKS:** `endpoint_public_access = false`, `endpoint_private_access = true`, node groups in private subnets. Our Day 23 setup already used private subnets and a **bastion** for kubectl. If the public endpoint must stay on, restrict it with `public_access_cidrs` to the office IP.

---

## 6. Docker image strategies: smaller, faster, more secure

**Definition:** an **image strategy** is **how you write the Dockerfile**, which decides what ends up in the final image. Everything in the image (shell, package manager, libraries) is something an attacker can use and something that can have a vulnerability (**CVE**). So: **build containers the right way to get smaller, faster and more secure images.**

### Strategy 1: Traditional (heavy)

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y python3
COPY app.py /app/
CMD ["python3", "/app/app.py"]
```

**What's inside:** a full OS: `bash`, `apt`, hundreds of system libraries, plus the app.

### Strategy 2: Multi-stage build

**Definition:** a **multi-stage build** uses **several `FROM` lines in one Dockerfile**. The first stage has all the build tools (compiler, SDK) and builds the app. The last stage starts from a **small** image and **copies only the result** (`COPY --from=builder`). Build tools never reach the final image.

```dockerfile
# Stage 1: build (big, has the Go compiler)
FROM golang:1.23 AS builder
WORKDIR /app
COPY . .
RUN go build -o main .

# Stage 2: run (small, only the binary)
FROM alpine:3.20
COPY --from=builder /app/main .
CMD ["./main"]
```

**What's inside:** Alpine (~5 MB) + the binary. Still has `sh` and the `apk` package manager.

### Strategy 3: Distroless runtime

**Definition:** a **distroless** image contains **only the app and what it needs to run** (runtime libraries, CA certificates). **No shell, no package manager, no OS tools.** Google publishes them at `gcr.io/distroless/...`.

```dockerfile
FROM node:20 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM gcr.io/distroless/nodejs20-debian12:nonroot
COPY --from=build /app /app
WORKDIR /app
CMD ["server.js"]
```

**What's inside:** Node.js + the app. No `sh`, no `bash`, no `apt`. The `:nonroot` tag runs as a non-root user (works with the Security Context from Day 31).

### Comparison

| Strategy | Size | Key benefit | Security risk |
|---|---|---|---|
| **Traditional** | Biggest (hundreds of MB) | Easy to troubleshoot, all OS tools available | 🔴 **High**: package managers, shells and many system libraries with vulnerabilities |
| **Multi-stage** (Alpine runtime) | Much smaller | Build tools separated from runtime, smaller download | 🟡 **Medium**: still has `sh` and `apk` |
| **Distroless** (multi-stage + distroless runtime) | Smallest | Minimum size, faster pulls and startup | 🟢 **Low**: no shell, so an attacker can't easily run commands |

```
 Traditional ──────────► Multi-stage ──────────► Distroless
 biggest & riskiest      smaller & safer         smallest & most secure
```

**Which is best in real time:** **multi-stage + distroless (or a minimal base) + non-root user**, with the base image **pinned** to a version (never `latest`).

| Question | Answer |
|---|---|
| How do I debug a distroless container without a shell? | `kubectl debug -it <pod> --image=busybox --target=<container>` adds a temporary debug container next to it |
| Go / Rust static binaries? | `gcr.io/distroless/static` or even `FROM scratch` (empty image) |
| Java? Python? | `gcr.io/distroless/java21-debian12`, `gcr.io/distroless/python3-debian12` |
| Other minimal images | Chainguard images, `-slim` / `-alpine` variants |

> **Interview one-liner:** I use multi-stage builds so compilers and build tools stay in the build stage, and a distroless non-root runtime image so the final image has only the app: smaller, faster to pull, fewer CVEs, and no shell for an attacker.

---

## 7. What is software supply chain security?

**Definition:** the **software supply chain** is **everything that goes into your running app**: your code, open-source libraries, the base image, the CI/CD pipeline, the registry, and the deploy step. **Supply chain security** makes sure **only trusted, verified and secure software enters your Kubernetes cluster**.

```
 Code ─► Dependencies ─► Base image ─► CI/CD build ─► Registry ─► Kubernetes
   │          │              │              │             │
   └──────────┴──── each step can be attacked ────────────┘
```

| Attack | Example |
|---|---|
| **Vulnerable library** | An old version of a logging library with a known critical CVE |
| **Malicious dependency** | A library or tool whose new release contains a backdoor (real cases: SolarWinds 2020, the `xz` backdoor 2024) |
| **Untrusted public image** | `docker pull someone/nginx-fast` with a crypto miner inside |
| **Image replaced in the registry** | Attacker pushes a different image with the same tag `shop:v1` |
| **Unapproved image deployed** | Someone runs `kubectl run` with any image from Docker Hub |

Scanning alone doesn't stop the last two. That's why we need all **4 pillars**.

---

## 8. The 4 pillars: Build → Inspect → Verify → Enforce

```
  1. ARTIFACTS          2. METADATA (SBOM)       3. ATTESTATIONS         4. POLICIES
     BUILD        ─►       INSPECT         ─►       VERIFY         ─►      ENFORCE
  trusted code +        list everything         sign: who built it,     allow only trusted
  secure base image     inside, find CVEs       not modified            images to run
  Docker, distroless    Trivy, Syft             Cosign, Tekton Chains   Kyverno, OPA
```

### Pillar 1: Artifacts: Build

**Definition:** an **artifact** is **what the build produces**: here, the **container image**. Build it from **trusted code** and a **trusted, minimal base image**.

| ✅ Do | ❌ Don't |
|---|---|
| Official / distroless / company-approved base images | Unknown public images from Docker Hub |
| Pin versions: `node:20.18-bookworm-slim` or a digest `@sha256:...` | `FROM node:latest` |
| Multi-stage + non-root (section 6) | Build tools and root in the final image |
| Build only in CI (GitHub Actions / Jenkins), never on a laptop | Manual `docker build` + `docker push` |

**Tool:** Docker (BuildKit).

### Pillar 2: Metadata (SBOM): Inspect

**Definition:** an **SBOM (Software Bill of Materials)** is a **list of everything inside the image**: every OS package and library with its version. Like the ingredients list on a food packet. **Scanning** compares that list with vulnerability databases to find **CVEs**.

| Tool | Does | Command |
|---|---|---|
| **Syft** | Creates the SBOM (SPDX or CycloneDX format) | `syft <image> -o spdx-json > sbom.json` |
| **Trivy** | Scans for vulnerabilities (and can also create an SBOM) | `trivy image --severity HIGH,CRITICAL --exit-code 1 <image>` |

**Why both scan and SBOM?** The scan tells you what's vulnerable **today**. The SBOM is kept: when a new CVE appears next month, you search the SBOMs and know in minutes **which images contain that library**, without rebuilding anything.

**Real time:** in CI, `--exit-code 1` **fails the pipeline** if a HIGH/CRITICAL CVE is found, so the image is never pushed.

### Pillar 3: Attestations: Verify

**Definition:** **signing** an image means adding a **digital signature** that proves **who built it** and that it **wasn't modified** after the build. An **attestation** is a signed statement **about** the image, for example "this is its SBOM" or "it was built by this pipeline from this commit".

**How Cosign signing works:**

```
 CI pipeline                               Registry (ECR)                     Kubernetes
 ┌────────────────────────────┐           ┌──────────────────────┐           ┌──────────────────────┐
 │ cosign sign --key cosign.key│ ──push──► │ shop@sha256:ab12…    │ ──pull──► │ Kyverno: verify with │
 │  (private key, kept secret) │           │ + signature          │           │ cosign.pub (public)  │
 └────────────────────────────┘           └──────────────────────┘           └──────────────────────┘
```

| Term | Meaning |
|---|---|
| **Private key** (`cosign.key`) | Only the CI pipeline has it. Used to **sign** |
| **Public key** (`cosign.pub`) | Shared with the cluster. Used to **verify** |
| **Sign by digest** | Sign `image@sha256:...`, not a tag: a tag can be moved to another image, a digest can't |
| **Keyless signing** | No key file: CI proves its identity with OIDC (e.g. GitHub Actions), Sigstore gives a short-lived certificate, the signature is logged in the public **Rekor** transparency log. Best practice today |

> ⚠️ **A signature does not mean "no vulnerabilities".** It proves **authenticity** (built by **our** pipeline) and **integrity** (**not changed**). That's why we **scan before we sign**: the pipeline only signs images that passed the scan. Signed = "trusted, came from us, passed our checks".

**Tools:** **Cosign** (Sigstore) signs and verifies. **Tekton Chains** signs automatically for every build in a Tekton pipeline. On AWS, **AWS Signer + Notation** is the native alternative for ECR.

### Pillar 4: Policies: Enforce

**Definition:** a **policy engine** is an **admission controller** (Day 28) that checks every new Pod **before** it is created. For supply chain security it checks the **image signature**: **signed by our key → allow; unsigned or wrong signature → block**.

```
 kubectl apply / Argo CD ──► API server ──► Kyverno admission webhook
                                                 │
                       signature valid ──────────┼──────── invalid / unsigned
                              ▼                                   ▼
                       ✅ Pod created                      ❌ request denied
```

**Kyverno policy (simplified):**

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-image-signature
spec:
  webhookTimeoutSeconds: 30
  rules:
  - name: check-signature
    match:
      any:
      - resources:
          kinds:
          - Pod
    verifyImages:
    - imageReferences:
      - "<account-id>.dkr.ecr.us-east-1.amazonaws.com/shop/*"
      failureAction: Enforce        # block (Audit = only report)
      attestors:
      - entries:
        - keys:
            publicKeys: |-
              -----BEGIN PUBLIC KEY-----
              <contents of cosign.pub>
              -----END PUBLIC KEY-----
```

| Tool | Policies written in | Notes |
|---|---|---|
| **Kyverno** | YAML (Kubernetes style) | Easiest; built-in `verifyImages` for Cosign; also mutates and generates |
| **OPA Gatekeeper** | Rego (its own language) | Very flexible, used across many systems, image verification needs extra setup |
| **Sigstore policy-controller** | YAML | Only for signature checks |

**Other useful supply chain policies:** only allow images from our ECR, block the `:latest` tag, require an SBOM attestation, require non-root (Pod Security).

> **Interview one-liner:** supply chain security is Build → Inspect → Verify → Enforce: build from trusted minimal images, scan and create an SBOM with Trivy/Syft, sign the image in CI with Cosign, and let Kyverno block any image that isn't signed by our pipeline.

---

## 9. Best real-time pipeline: e-commerce example

Deploying a shopping app (like RoboShop's `catalogue`) with a trusted and verified image:

```
 Developer push
      │
      ▼
 ┌────────────────────────────── CI (GitHub Actions) ──────────────────────────────┐
 │ ① Build        multi-stage + distroless, non-root, pinned base                  │
 │ ② Scan         trivy image --exit-code 1 --severity HIGH,CRITICAL  ── fail? stop │
 │ ③ SBOM         syft → sbom.spdx.json                                            │
 │ ④ Push         ECR (immutable tags, scan on push)  → get the digest             │
 │ ⑤ Sign         cosign sign (keyless, GitHub OIDC) image@sha256:…                │
 │ ⑥ Attest       cosign attest --predicate sbom.spdx.json                         │
 │ ⑦ Update Git   new digest in the Helm values / kustomization                    │
 └─────────────────────────────────────────────────────────────────────────────────┘
      │
      ▼
 Argo CD syncs ──► API server ──► Kyverno verifyImages
                                      ├── signature valid  = ✅ allow (deploy)
                                      └── invalid/unsigned = ❌ block
      │
      ▼
 Running Pods: Security Context (non-root), Network Policies, Falco + Trivy Operator keep scanning
```

| Stage | Pillar | Tool | Why |
|---|---|---|---|
| Build | Artifacts | Docker (multi-stage, distroless) | Small image, few CVEs |
| Scan + SBOM | Metadata | Trivy + Syft | Stop vulnerable images, keep an ingredients list |
| Sign + attest | Attestations | Cosign (keyless) | Prove it came from our pipeline, unchanged |
| Deploy check | Policies | Kyverno | Unsigned / unknown images never run |

> **Key takeaway:** **Build → Scan → Sign → Enforce = a secure, trusted, policy-driven deployment.**

---

# Part 2: Lab

## 10. Lab setup

| What | Details |
|---|---|
| **Cluster** | EKS + `kubectl` from the bastion as cluster admin ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)) |
| **Docker** | On the same machine (Labs D–F). On Amazon Linux / RHEL: `sudo dnf install -y docker && sudo systemctl start docker && sudo usermod -aG docker $USER`, then log out and in |
| **Registry** | Labs F–G use **ttl.sh**, a free anonymous registry where images are deleted after the time in the tag (`:1h`). Fine for a lab; in real projects use **ECR** |

**Step 1: Create a namespace**

```bash
kubectl create namespace api-lab
```

---

## 11. Lab A: See kubectl's API calls

**Step 1: List Pods with verbose output**

```bash
kubectl get pods -n kube-system -v=6
```

**Expected:** a line like `GET https://<api-endpoint>/api/v1/namespaces/kube-system/pods?limit=500 200 OK` ✅. kubectl is just an HTTPS client.

**Step 2: Create something and look at the call**

```bash
kubectl create deployment web -n api-lab --image=nginx -v=6 2>&1 | grep -E 'POST|GET'
```

**Expected:** `POST https://.../apis/apps/v1/namespaces/api-lab/deployments 201 Created` ✅. `create` = `POST`.

**Step 3: Watch in real time**

```bash
kubectl get pods -n api-lab -w
```

**Expected:** the list stays open and prints new lines when Pods change. Press `Ctrl+C` to stop.

---

## 12. Lab B: Call the API with curl

**Step 1: Start a local proxy** (handles authentication for you)

```bash
kubectl proxy --port=8001 &
```

**Step 2: list**

```bash
curl -s localhost:8001/apis/apps/v1/namespaces/api-lab/deployments | grep '"name"'
```

**Expected:** `"name": "web"` ✅

**Step 3: get**

```bash
curl -s localhost:8001/apis/apps/v1/namespaces/api-lab/deployments/web | grep '"replicas"'
```

**Expected:** `"replicas": 1`

**Step 4: patch (scale to 2)**

```bash
curl -s -X PATCH -H "Content-Type: application/merge-patch+json" -d '{"spec":{"replicas":2}}' localhost:8001/apis/apps/v1/namespaces/api-lab/deployments/web | grep '"replicas"' | head -1
```

**Expected:** `"replicas": 2` ✅. Only one field was sent.

**Step 5: Stop the proxy**

```bash
kill %1
```

---

## 13. Lab C: The 3 patch types

**Step 1: Strategic merge (default): change replicas**

```bash
kubectl patch deployment web -n api-lab -p '{"spec":{"replicas":3}}'
```

**Expected:** `deployment.apps/web patched`

**Step 2: Strategic merge on a list: change the container image** (matched by container `name`)

```bash
kubectl patch deployment web -n api-lab -p '{"spec":{"template":{"spec":{"containers":[{"name":"nginx","image":"nginx:1.27"}]}}}}'
```

**Step 3: Check the image**

```bash
kubectl get deployment web -n api-lab -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

**Expected:** `nginx:1.27` ✅

**Step 4: JSON merge: add a label**

```bash
kubectl patch deployment web -n api-lab --type=merge -p '{"metadata":{"labels":{"team":"shop"}}}'
```

**Step 5: JSON patch: exact operation**

```bash
kubectl patch deployment web -n api-lab --type=json -p '[{"op":"replace","path":"/spec/replicas","value":1}]'
```

**Step 6: Check**

```bash
kubectl get deployment web -n api-lab --show-labels
```

**Expected:** `READY 1/1` and `team=shop` in the labels ✅

---

## 14. Lab D: Traditional vs multi-stage vs distroless

**Step 1: Create a folder**

```bash
mkdir ~/image-lab && cd ~/image-lab
```

**Step 2: Create `main.go`** (a tiny web app)

```go
package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "hello from roboshop")
	})
	http.ListenAndServe(":8080", nil)
}
```

**Step 3: Create `Dockerfile.traditional`** (ships the whole Go SDK)

```dockerfile
FROM golang:1.23
WORKDIR /app
COPY main.go .
RUN go mod init demo && CGO_ENABLED=0 go build -o main .
CMD ["./main"]
```

**Step 4: Create `Dockerfile.multistage`**

```dockerfile
FROM golang:1.23 AS builder
WORKDIR /app
COPY main.go .
RUN go mod init demo && CGO_ENABLED=0 go build -o main .

FROM alpine:3.20
COPY --from=builder /app/main /main
CMD ["/main"]
```

**Step 5: Create `Dockerfile.distroless`**

```dockerfile
FROM golang:1.23 AS builder
WORKDIR /app
COPY main.go .
RUN go mod init demo && CGO_ENABLED=0 go build -o main .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /app/main /main
CMD ["/main"]
```

**Step 6: Build all three**

```bash
docker build -f Dockerfile.traditional -t demo:traditional .
```

```bash
docker build -f Dockerfile.multistage -t demo:multistage .
```

```bash
docker build -f Dockerfile.distroless -t demo:distroless .
```

**Step 7: Compare sizes**

```bash
docker images demo
```

**Expected (roughly):** `traditional` ~800+ MB, `multistage` ~15 MB, `distroless` ~10 MB ✅. Same app.

**Step 8: Try to get a shell**

```bash
docker run --rm -it demo:multistage sh -c 'echo I have a shell'
```

**Expected:** `I have a shell`. An attacker would too.

```bash
docker run --rm -it demo:distroless sh
```

**Expected:** `exec: "sh": executable file not found` ✅. No shell to use.

**Step 9: Check the user**

```bash
docker run --rm --entrypoint "" demo:multistage id
```

**Expected:** `uid=0(root)`. The distroless `:nonroot` image runs as UID **65532** instead.

---

## 15. Lab E: Scan with Trivy and create an SBOM with Syft

**Step 1: Install Trivy** (pin a version in real projects)

```bash
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sudo sh -s -- -b /usr/local/bin
```

**Step 2: Scan the traditional image**

```bash
trivy image --severity HIGH,CRITICAL demo:traditional
```

**Expected:** a table of HIGH/CRITICAL CVEs in OS packages and Go libraries.

**Step 3: Scan the distroless image**

```bash
trivy image --severity HIGH,CRITICAL demo:distroless
```

**Expected:** far fewer (often **0**) ✅. Fewer packages = fewer CVEs.

**Step 4: Use it as a CI gate**

```bash
trivy image --severity CRITICAL --exit-code 1 demo:traditional; echo "exit code: $?"
```

**Expected:** `exit code: 1` if any CRITICAL is found. In CI that fails the pipeline and stops the push.

**Step 5: Install Syft**

```bash
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sudo sh -s -- -b /usr/local/bin
```

**Step 6: Create the SBOM**

```bash
syft demo:distroless -o spdx-json > sbom.spdx.json
```

**Step 7: See what's inside the image**

```bash
syft demo:distroless
```

**Expected:** a short list: a few Debian base packages (`base-files`, `tzdata`, `netbase`…) and the Go standard library. That's the image's ingredients list ✅.

---

## 16. Lab F: Sign the image with Cosign

**Step 1: Install Cosign v2**

```bash
curl -sSfL -o cosign https://github.com/sigstore/cosign/releases/download/v2.4.1/cosign-linux-amd64
```

```bash
sudo install cosign /usr/local/bin/cosign
```

**Step 2: Pick a unique image name** (ttl.sh is shared, so add something random)

```bash
export IMG=ttl.sh/roboshop-demo-$RANDOM$RANDOM
```

```bash
echo $IMG
```

**Step 3: Tag and push the signed-to-be image (valid 1 hour)**

```bash
docker tag demo:distroless $IMG:1h
```

```bash
docker push $IMG:1h
```

**Step 4: Push a second image that we will NOT sign**

```bash
docker tag demo:multistage $IMG-unsigned:1h
```

```bash
docker push $IMG-unsigned:1h
```

**Step 5: Get the digest of the image to sign**

```bash
export DIGEST=$(docker inspect --format='{{index .RepoDigests 0}}' $IMG:1h)
```

```bash
echo $DIGEST
```

**Expected:** `ttl.sh/roboshop-demo-…@sha256:…`

**Step 6: Create a key pair** (enter a password twice)

```bash
cosign generate-key-pair
```

**Expected:** `cosign.key` (private, keep secret) and `cosign.pub` (public) ✅

**Step 7: Sign by digest**

```bash
cosign sign --yes --key cosign.key $DIGEST
```

**Expected:** asks for the key password, then `Pushing signature to: ttl.sh/roboshop-demo-…` ✅. The signature is stored in the registry next to the image (and logged in the public Rekor log).

**Step 8: Verify the signed image**

```bash
cosign verify --key cosign.pub $IMG:1h
```

**Expected:** `The cosign claims were validated` and `The signatures were verified against the specified public key` ✅

**Step 9: Verify the unsigned image**

```bash
cosign verify --key cosign.pub $IMG-unsigned:1h
```

**Expected:** `Error: no signatures found` ✅

**Step 10 (optional): Attach the SBOM as a signed attestation**

```bash
cosign attest --yes --key cosign.key --type spdxjson --predicate sbom.spdx.json $DIGEST
```

---

## 17. Lab G: Block unsigned images with Kyverno

**Step 1: Install Kyverno with Helm**

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
```

```bash
helm repo update
```

```bash
helm install kyverno kyverno/kyverno -n kyverno --create-namespace
```

**Step 2: Wait until it's ready**

```bash
kubectl get pods -n kyverno
```

**Expected:** all Pods `Running`.

**Step 3: Create the policy file `verify-images.yaml`** with your public key

```bash
cat > verify-images.yaml <<EOF
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-roboshop-images
spec:
  webhookTimeoutSeconds: 30
  rules:
  - name: check-signature
    match:
      any:
      - resources:
          kinds:
          - Pod
    verifyImages:
    - imageReferences:
      - "ttl.sh/roboshop-demo-*"
      failureAction: Enforce
      attestors:
      - entries:
        - keys:
            publicKeys: |-
$(sed 's/^/              /' cosign.pub)
EOF
```

**What it does:** any Pod using an image that matches `ttl.sh/roboshop-demo-*` must be signed with **our** `cosign.pub`. Other images (nginx, system Pods) are not affected by this rule.

**Step 4: Check the file**

```bash
cat verify-images.yaml
```

**Expected:** the `-----BEGIN PUBLIC KEY-----` block indented under `publicKeys: |-`.

**Step 5: Apply it**

```bash
kubectl apply -f verify-images.yaml
```

**Step 6: Wait until the policy is ready**

```bash
kubectl get clusterpolicy verify-roboshop-images
```

**Expected:** `READY True`.

**Step 7: Run the SIGNED image**

```bash
kubectl run signed -n api-lab --image=$IMG:1h
```

**Expected:** `pod/signed created` ✅. Signature valid = allow.

**Step 8: Run the UNSIGNED image**

```bash
kubectl run unsigned -n api-lab --image=$IMG-unsigned:1h
```

**Expected:** `Error from server: admission webhook "mutate.kyverno.svc-fail" denied the request: ... verify-roboshop-images ... no signatures found` ✅. Unsigned = **blocked**, the Pod is never created.

**Step 9: Check what's running**

```bash
kubectl get pods -n api-lab
```

**Expected:** `signed` is there, `unsigned` is not ✅.

**Step 10: See the image Kyverno used**

```bash
kubectl get pod signed -n api-lab -o jsonpath='{.spec.containers[0].image}{"\n"}'
```

**Expected:** the image **with `@sha256:...`** added: Kyverno pins the verified digest so the tag can't be swapped later.

---

## 18. Clean up

```bash
kubectl delete clusterpolicy verify-roboshop-images
```

```bash
helm uninstall kyverno -n kyverno
```

```bash
kubectl delete namespace api-lab kyverno
```

```bash
docker rmi demo:traditional demo:multistage demo:distroless $IMG:1h $IMG-unsigned:1h
```

Delete `cosign.key` from the lab machine (never commit it). The ttl.sh images expire by themselves after 1 hour.

---

# Wrap-up

## 19. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `kubectl patch`: `the server rejected our request ... json: cannot unmarshal` | Quotes broken in the JSON | Wrap the JSON in single quotes, keys in double quotes |
| Strategic patch didn't change the image | Container `name` in the patch doesn't match | Use the exact name from `kubectl get deploy -o yaml` |
| `exec: "sh": executable file not found` | Distroless image has no shell | Expected; debug with `kubectl debug --image=busybox --target=<container>` |
| Distroless Node/Python app fails: `cannot find module` | Dependencies not copied from the build stage | `COPY --from=build` the whole app folder incl. `node_modules` / venv |
| `cosign sign` warns about signing a tag | Signed a tag instead of a digest | Sign `image@sha256:...` |
| `cosign verify`: `no signatures found` | Image not signed, or different digest (re-pushed) | Sign the exact digest you deploy |
| Signed image is blocked by Kyverno | Wrong public key / key indentation in the policy, or the policy expects a different signature format | Check the `publicKeys` block; sign and verify with the same Cosign major version |
| Kyverno: `context deadline exceeded` | Cluster can't reach the registry / Rekor in time | Check NAT / egress, raise `webhookTimeoutSeconds` |
| Everything blocked after installing a policy | `imageReferences` too broad (`*`) | Match only your registry/repos |

---

## 20. What I learned

**Concepts**
- The **API server** is the front door: authN → authZ → admission → validation → etcd. Only it talks to etcd.
- **API operations:** get, list, watch, create, update, patch, delete = the RBAC verbs = HTTP GET/POST/PUT/PATCH/DELETE.
- **Patch** changes only some fields; 3 types: strategic (default), merge, json.
- **Protect a cluster in layers:** secure images, supply chain, private cluster, RBAC, ServiceAccounts, Security Context, admission controllers, Network Policies, secrets, audit + runtime.
- **Image strategies:** traditional (biggest, riskiest) → multi-stage (smaller, safer) → distroless (smallest, most secure).
- **Supply chain:** Build → Inspect (SBOM, scan) → Verify (sign) → Enforce (policy).
- **Signed ≠ vulnerability-free.** Signing proves who built it and that it wasn't changed; scan first, then sign.

**Lab**
- `kubectl -v=6` shows the real HTTP calls.
- Distroless: ~10 MB, no shell, far fewer CVEs than a full image.
- Cosign signs by digest; Kyverno `verifyImages` allows signed images and blocks unsigned ones.

```
 Build ──► Scan ──► Sign ──► Enforce  =  secure, trusted, policy-driven deployment
```

## 21. Commands

| Command | What it does |
|---|---|
| `kubectl get pods -v=6` | Show the API calls kubectl makes |
| `kubectl proxy --port=8001` | Local, authenticated access to the API for curl |
| `kubectl api-resources` | All resources, their API groups and short names |
| `kubectl patch deploy D -p '{"spec":{"replicas":3}}'` | Strategic merge patch |
| `kubectl patch deploy D --type=json -p '[{"op":"replace","path":"/spec/replicas","value":2}]'` | JSON patch |
| `kubectl debug -it POD --image=busybox --target=C` | Debug a distroless container |
| `trivy image --severity HIGH,CRITICAL --exit-code 1 IMG` | Scan, fail on findings |
| `syft IMG -o spdx-json > sbom.spdx.json` | Create an SBOM |
| `cosign generate-key-pair` | Create signing keys |
| `cosign sign --key cosign.key IMG@sha256:...` | Sign an image |
| `cosign verify --key cosign.pub IMG` | Verify a signature |
| `cosign attest --key cosign.key --type spdxjson --predicate sbom.spdx.json IMG@sha256:...` | Attach a signed SBOM |
| `kubectl get clusterpolicy` | List Kyverno policies |

## 22. Interview Questions

### ⭐ Very Important

**Q1. What is the Kubernetes API server?**
The front door of the cluster. It receives every request from users, applications and components, authenticates and authorizes it, runs admission and validation, and stores the result in etcd. No other component talks to etcd directly.

**Q2. What are the common Kubernetes API operations?**
get (one resource), list (many), watch (real-time changes), create (new), update (replace the whole object), patch (change only some fields) and delete. They map to HTTP GET/POST/PUT/PATCH/DELETE and are the same verbs used in RBAC Roles.

**Q3. In how many ways can you protect a Kubernetes cluster?**
In layers: secure images (multi-stage, distroless), supply chain security (scan, SBOM, sign, verify), a private cluster, RBAC, a custom ServiceAccount per app, Security Contexts (non-root, drop capabilities), admission controllers (Kyverno, Pod Security), Network Policies, secrets in a secrets manager, and audit logs plus runtime security like Falco.

**Q4. What is a multi-stage Docker build and why use it?**
A Dockerfile with several `FROM` stages: one stage builds the app with all the tools, the final stage copies only the result into a small base image. The final image is smaller, faster to pull and has fewer vulnerabilities because compilers and build tools are left behind.

**Q5. What is a distroless image?**
An image with only the app and its runtime dependencies: no shell, no package manager. It's the smallest and most secure option because an attacker can't easily run commands and there are far fewer packages to have CVEs.

**Q6. What is software supply chain security in Kubernetes?**
Making sure only trusted, verified, secure images run in the cluster, using 4 pillars: Build trusted artifacts, Inspect them (SBOM + scan with Syft/Trivy), Verify them (sign with Cosign), and Enforce with policies (Kyverno/OPA block unsigned or untrusted images).

**Q7. How do you make sure only signed images run in your cluster?**
Sign every image in CI with Cosign (by digest, after it passes the Trivy scan), and install Kyverno with a `verifyImages` ClusterPolicy holding our public key (or keyless identity). Kyverno checks the signature at admission: signed by us = allowed, unsigned or wrongly signed = blocked.

### Other Questions

**Q8. What is the difference between update and patch?**
Update (PUT) replaces the whole object and can conflict with other changes; patch (PATCH) sends only the fields to change. kubectl apply, scale and label use patch.

**Q9. What are the 3 patch types?**
Strategic merge (default, Kubernetes-aware, matches list items like containers by name), JSON merge (plain merge, lists replaced), and JSON patch (explicit add/replace/remove operations on paths).

**Q10. What is an SBOM and why do you need it?**
A Software Bill of Materials: a list of every package and library in an image with versions. When a new CVE is announced, you can instantly find which images contain the affected library without rescanning or rebuilding.

**Q11. Does a signed image mean it's secure?**
No. A signature proves who built it and that it wasn't modified. It says nothing about vulnerabilities. That's why the pipeline scans first and only signs images that pass.

**Q12. Why sign by digest and not by tag?**
A tag like `v1` can be moved to a different image; a digest (`sha256:...`) is the image's unique fingerprint and can't change.

**Q13. What is keyless signing?**
Cosign signing without a long-lived key: the CI job proves its identity with OIDC (for example GitHub Actions), Sigstore issues a short-lived certificate, and the signature is recorded in the public Rekor transparency log. No private key to leak.

**Q14. Kyverno vs OPA Gatekeeper?**
Both are admission-controller policy engines. Kyverno policies are plain Kubernetes YAML and it has built-in image signature verification; Gatekeeper uses the Rego language, which is more flexible but harder to learn.

**Q15. How do you debug a distroless container that has no shell?**
`kubectl debug -it <pod> --image=busybox --target=<container>` adds an ephemeral debug container that shares the process namespace with the app.

**Q16. What is a private EKS cluster?**
The API endpoint is only reachable inside the VPC (`endpoint_public_access = false`) and nodes run in private subnets. kubectl is used from a bastion, VPN or CI runner in the VPC; only the app's load balancer is public.

**Q17. How do you stop vulnerable images from reaching production?**
Scan in CI with Trivy and `--exit-code 1` on HIGH/CRITICAL so the pipeline fails before push, enable ECR scan on push, keep scanning running images with the Trivy Operator, and only sign images that passed the scan so Kyverno blocks the rest.

**Source:** [Kubernetes API concepts](https://kubernetes.io/docs/reference/using-api/api-concepts/) · [kubectl patch](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/update-api-object-kubectl-patch/) · [Distroless images](https://github.com/GoogleContainerTools/distroless) · [Cosign](https://docs.sigstore.dev/cosign/signing/overview/) · [Kyverno verify images](https://kyverno.io/docs/writing-policies/verify-images/) · [Trivy](https://trivy.dev/) · [Syft](https://github.com/anchore/syft)
