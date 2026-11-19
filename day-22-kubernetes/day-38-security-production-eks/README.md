# Day 38 - Kubernetes Security (the 4C's), Production-Grade EKS Design and KEPs

[← Kubernetes notes](../README.md)

> **In short:** Kubernetes security is taught as the **4C's of cloud native security**: **Cloud → Cluster → Container → Code**. Each layer wraps the next one, and a weak outer layer can't be fixed by a strong inner layer. A **production-grade EKS** cluster puts all of this together with high availability: **3 AZs**, private worker nodes, ALB/NLB in front, separate node groups, **Karpenter + HPA**, **Pod Identity**, RBAC, NetworkPolicies, Secrets Manager + KMS, image scanning, centralized observability, Terraform + CI/CD + GitOps, and a tested **backup/DR** plan with clear **RTO/RPO**. A **KEP** (Kubernetes Enhancement Proposal) is the design document every big Kubernetes feature goes through before it becomes **alpha → beta → stable**.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: The 4C's of security** | Cloud (VPC, WAF, Secrets Manager, IAM, KMS, CloudTrail), Cluster (RBAC, NetworkPolicy, admission controllers, IRSA / Pod Identity, Kyverno, Secrets, ACM), Container (Trivy, security context), Code (SAST, CodeQL, SCA, secret scanning, Cosign) | What each layer protects and the one-line purpose of every tool |
| **Part 2: Production-grade EKS** | Architecture, compute and HA, security, observability, deployment and operations, backup and DR, the 60-second interview answer | How to design and explain a real production EKS platform |
| **Part 3: KEPs** | What a KEP is, why it exists, the lifecycle (alpha / beta / GA), feature gates, examples | How Kubernetes features are born and why it matters to you |

> **Before this:** most of this day connects earlier days: [RBAC](../day-30-rbac/README.md) · [NetworkPolicy](../day-25-dns-network-policy/README.md) · [Admission controllers](../day-28-kustomize-admission-controllers-crds/README.md) · [ServiceAccounts + Security Context](../day-31-service-accounts/README.md) · [Supply chain (Trivy, Cosign)](../day-32-api-server-cluster-security-supply-chain/README.md) · [Pod Identity + Kyverno](../day-36-workload-identity/README.md) · [Probes](../day-24-probes/README.md) · [Autoscaling](../day-23-eks-terraform-helm-argocd/autoscaling-hpa-nodes/README.md) · [Monitoring](../day-27-monitoring-prometheus-grafana/README.md) · [OpenTelemetry](../day-33-opentelemetry/README.md)

## Table of Contents

**Part 1: The 4C's of cloud native security**
1. [What are the 4C's?](#1-what-are-the-4cs)
2. [C1: Cloud](#2-c1-cloud)
3. [C2: Cluster](#3-c2-cluster)
4. [C3: Container](#4-c3-container)
5. [C4: Code](#5-c4-code)
6. [The 4C's in one pipeline](#6-the-4cs-in-one-pipeline)

**Part 2: Production-grade EKS design**

7. [The big picture](#7-the-big-picture)
8. [Architecture (network)](#8-architecture-network)
9. [Compute and high availability](#9-compute-and-high-availability)
10. [Security](#10-security)
11. [Observability](#11-observability)
12. [Deployment and operations](#12-deployment-and-operations)
13. [Backup and disaster recovery](#13-backup-and-disaster-recovery)
14. [The 60-second interview answer](#14-the-60-second-interview-answer)

**Part 3: KEPs**

15. [What is a KEP?](#15-what-is-a-kep)
16. [KEP lifecycle: alpha, beta, stable](#16-kep-lifecycle-alpha-beta-stable)

**Wrap-up**

17. [What I learned](#17-what-i-learned)
18. [Commands](#18-commands)
19. [Interview Questions](#19-interview-questions)

---

# Part 1: The 4C's of cloud native security

## 1. What are the 4C's?

**Definition:** the **4C's of cloud native security** is a layered model from the Kubernetes docs: **Cloud, Cluster, Container, Code**. Each layer is wrapped by the one outside it, so you secure **every** layer ("defense in depth").

```
 ┌──────────────────────────────── CLOUD ────────────────────────────────┐
 │  VPC · WAF · IAM · KMS · Secrets Manager · CloudTrail                  │
 │  ┌────────────────────────── CLUSTER ──────────────────────────────┐  │
 │  │  RBAC · NetworkPolicy · Admission controllers · Pod Identity /   │  │
 │  │  IRSA · Kyverno · Secrets · ACM                                  │  │
 │  │  ┌──────────────────── CONTAINER ───────────────────────────┐   │  │
 │  │  │  Trivy · Security context · minimal images · non-root     │   │  │
 │  │  │  ┌───────────────────── CODE ────────────────────────┐    │   │  │
 │  │  │  │  SAST · CodeQL · SCA · Secret scan · Cosign        │    │   │  │
 │  │  │  └────────────────────────────────────────────────────┘    │   │  │
 │  │  └─────────────────────────────────────────────────────────────┘   │  │
 │  └────────────────────────────────────────────────────────────────────┘  │
 └──────────────────────────────────────────────────────────────────────────┘
```

| Layer | Protects | Who usually owns it |
|---|---|---|
| **Cloud** | The infrastructure: network, accounts, keys, audit | Cloud / platform team |
| **Cluster** | Kubernetes itself: who can do what, what may run, who can talk to whom | Platform / DevOps team |
| **Container** | The image and how the container runs | DevOps + developers |
| **Code** | The application source and its dependencies | Developers + DevSecOps pipeline |

**Why layers:** if the code has a bug, the container runs non-root; if the container is broken into, NetworkPolicy limits where it can go; if the cluster is misconfigured, IAM and VPC still limit the damage.

> **Interview one-liner:** the 4C's are Cloud, Cluster, Container and Code; each wraps the next, so you secure every layer: VPC/IAM/KMS in the cloud, RBAC/NetworkPolicy/admission in the cluster, scanning and security context for containers, and SAST/SCA/secret scanning/signing for code.

---

## 2. C1: Cloud

**Definition:** the **cloud layer** is the infrastructure the cluster runs on: network, identities, encryption keys, audit logs. If it's insecure, nothing inside is safe.

| Tool | What it is (short) | What it does for Kubernetes |
|---|---|---|
| **VPC** | Your private network in AWS | Nodes in **private subnets**, only load balancers in public; security groups and NACLs control traffic |
| **WAF** (Web Application Firewall) | Filters HTTP requests before they reach your app | Attached to the **ALB**; blocks SQL injection, XSS, bad bots, rate-limits abusive IPs |
| **Secrets Manager** | Stores secrets (DB passwords, API keys), with rotation | Apps read secrets at runtime (via Pod Identity) instead of keeping them in Git or YAML |
| **IAM** | Who can do what in AWS | Least privilege for **users, nodes and Pods**; Pod Identity gives each app its own role |
| **KMS** (Key Management Service) | Creates and manages encryption keys | Encrypts **Kubernetes Secrets in etcd** (envelope encryption), EBS volumes, S3, RDS |
| **CloudTrail** | Records every AWS API call (who, what, when, from where) | Audit and investigations: who changed the cluster, who read a secret |

**Also good to know:** **GuardDuty** (threat detection, including EKS audit and runtime), **Security Hub** (one place for findings), **AWS Config** (detects misconfigurations).

> **Interview one-liner:** cloud security for EKS = private VPC design, WAF on the ALB, least-privilege IAM, secrets in Secrets Manager, KMS encryption and CloudTrail auditing.

---

## 3. C2: Cluster

**Definition:** the **cluster layer** secures **Kubernetes itself**: who can call the API, what may be deployed, which Pods can talk to each other, and how workloads get credentials.

| Tool | What it is (short) | Example |
|---|---|---|
| **RBAC** | Role-Based Access Control for the Kubernetes API ([Day 30](../day-30-rbac/README.md)) | Developers get `view` in `dev`, CI gets `edit` in one namespace, nobody shares `cluster-admin` |
| **NetworkPolicy** | Firewall rules between Pods ([Day 25](../day-25-dns-network-policy/README.md)) | Default deny; only `frontend → backend → db` allowed |
| **Admission controllers** | Check or change every request **before** it's saved ([Day 28](../day-28-kustomize-admission-controllers-crds/README.md)) | Pod Security Admission rejects privileged Pods |
| **IRSA / Pod Identity** | Gives a Pod its own temporary IAM role ([Day 36](../day-36-workload-identity/README.md)) | `payment` Pod reads only its own secret, no static keys |
| **Kyverno** | Policy engine (admission webhook) ([Day 36](../day-36-workload-identity/README.md)) | Only ECR images, no `:latest`, no static AWS keys, signed images only |
| **Secrets** | Kubernetes object for sensitive data | Encrypt at rest with **KMS**, limit `get secrets` in RBAC, or sync from Secrets Manager (External Secrets / CSI driver) |
| **ACM** (AWS Certificate Manager) | Free, auto-renewing **TLS certificates** | Attached to the ALB via the Ingress annotation, so traffic is **HTTPS** |

**Also:** private or restricted **API endpoint**, **control plane audit logs** to CloudWatch, keep the cluster **version upgraded**.

> **Interview one-liner:** cluster security = RBAC least privilege, default-deny NetworkPolicies, admission control (Pod Security + Kyverno), Pod Identity/IRSA instead of keys, KMS-encrypted Secrets, and TLS with ACM.

---

## 4. C3: Container

**Definition:** the **container layer** secures **the image** (what's inside) and **the runtime** (how the container is allowed to run on the node).

| Tool / practice | What it is (short) | Example |
|---|---|---|
| **Trivy** | Scanner for **vulnerabilities (CVEs)**, misconfigurations and secrets in images ([Day 32](../day-32-api-server-cluster-security-supply-chain/README.md)) | CI fails the build if the image has CRITICAL CVEs |
| **Security context** | Pod/container settings that limit what the process can do ([Day 31](../day-31-service-accounts/README.md)) | `runAsNonRoot`, `allowPrivilegeEscalation: false`, drop ALL capabilities, read-only root filesystem |
| **Minimal images** | Small base images (distroless, Alpine) | Fewer packages = fewer CVEs, no shell for attackers |
| **Image registry** | Private ECR with scan-on-push, immutable tags | Only trusted images are pulled |
| **Runtime detection** | Watches what containers do at runtime | **Falco** / GuardDuty runtime alerts on a shell spawned in a container |

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop: ["ALL"]
```

> **Interview one-liner:** container security = scan images with Trivy, use minimal base images from a private registry, and run them with a restrictive security context: non-root, no privilege escalation, dropped capabilities, read-only filesystem.

---

## 5. C4: Code

**Definition:** the **code layer** secures the **application source code and its dependencies**, mostly in the **CI pipeline**, **before** anything is built or deployed ("shift left").

| Tool / practice | What it is (short) | Example tools |
|---|---|---|
| **SAST** (Static Application Security Testing) | Scans **your source code** without running it, for insecure patterns | SonarQube, Semgrep, CodeQL |
| **CodeQL** | GitHub's SAST engine: treats code like data and queries it for vulnerabilities ([GitHub Actions Day 6](../../day-04-09-github-actions/day-6-codeql-self-hosted-runners/)) | SQL injection, XSS, path traversal found in a PR |
| **SCA** (Software Composition Analysis) | Scans **third-party dependencies** (libraries) for known CVEs and licenses | Dependabot, Snyk, Trivy (`fs`), OWASP Dependency-Check |
| **Secret scanning** | Finds **passwords, tokens, keys** committed to Git | GitHub secret scanning + push protection, gitleaks, TruffleHog |
| **Cosign** | **Signs** container images (Sigstore) so the cluster can verify they came from your pipeline ([Day 32](../day-32-api-server-cluster-security-supply-chain/README.md)) | CI signs the image; Kyverno only admits signed images |

| | SAST | SCA | DAST |
|---|---|---|---|
| Looks at | **Your** code | **Other people's** code (dependencies) | The **running** app |
| When | Every PR / commit | Every PR + continuously | After deploy to a test env |
| Finds | Injection, unsafe functions | Vulnerable library versions | Runtime issues (OWASP ZAP) |

> **Interview one-liner:** code security shifts left into CI: SAST/CodeQL for our code, SCA/Dependabot for dependencies, secret scanning to block leaked keys, and Cosign to sign images so only trusted builds can run.

---

## 6. The 4C's in one pipeline

```
 CODE                     CONTAINER                 CLUSTER                         CLOUD
 git push ──► SAST/CodeQL ──► docker build ──► Trivy scan ──► push to ECR ──► Kyverno admits? ──► Pod runs
              SCA                              (fail on      Cosign sign     (ECR only, signed,   with Pod Identity,
              secret scan                       CRITICAL)                     no keys, non-root)   NetworkPolicy, RBAC
                                                                                                   inside a private VPC,
                                                                                                   KMS, WAF, CloudTrail
```

> **Interview one-liner:** a secure delivery flow checks code (SAST, SCA, secrets), then the image (Trivy, Cosign), then admission (Kyverno), and the running Pod is limited by RBAC, NetworkPolicy, Pod Identity and the cloud controls around it.

---

# Part 2: Production-grade EKS design

## 7. The big picture

**Definition:** a **production-grade EKS** cluster is one that stays **available, secure, observable and recoverable** when nodes, AZs, deployments or people make mistakes.

```
                         Users
                           │ HTTPS (ACM cert)
                    Route 53 ──► WAF ──► ALB (public subnets, 3 AZs)
                                          │
 ┌─────────────────────────── VPC (dedicated) ────────────────────────────────────┐
 │   AZ-a                      AZ-b                      AZ-c                      │
 │  public:  ALB node, NAT GW  public:  ALB node, NAT GW  public:  ALB node, NAT GW │
 │  private: worker nodes      private: worker nodes      private: worker nodes     │
 │           ├ system node group (CoreDNS, controllers, monitoring)                 │
 │           └ app nodes (Karpenter) ── Pods spread across AZs (topology spread)    │
 │  db:      RDS primary       RDS standby (Multi-AZ)                               │
 └──────────────────────────────────────────────────────────────────────────────────┘
        EKS control plane: managed by AWS, highly available across AZs
        Around it: IAM + Pod Identity · Secrets Manager · KMS · ECR · CloudTrail
                   Prometheus/Grafana · CloudWatch · Terraform · CI/CD · Argo CD · Velero/AWS Backup
```

| Pillar | Goal |
|---|---|
| Architecture | Survive an AZ failure, nothing exposed directly |
| Compute & HA | Enough capacity, automatically, with no single point of failure |
| Security | Least privilege everywhere (the 4C's) |
| Observability | See problems before users do |
| Deployment & operations | Repeatable, automated, reversible changes |
| Backup & DR | Recover within the agreed RTO/RPO |

---

## 8. Architecture (network)

| Item | What to do | Why |
|---|---|---|
| **EKS** | Use **managed** EKS | AWS runs a **highly available control plane** (API server, etcd) across AZs; you don't patch it |
| **Multi-AZ** | Spread across **at least 3 Availability Zones** | One AZ can fail and the app keeps running |
| **VPC** | **Dedicated VPC** with **public and private subnets in every AZ** | Clear separation: internet-facing vs internal |
| **Private nodes** | Worker nodes and Pods in **private subnets** | Nodes have no public IP, can't be reached from the internet |
| **Load balancer** | **ALB** (HTTP/HTTPS, via AWS Load Balancer Controller) or **NLB** (TCP/UDP) to expose apps | Never expose worker nodes directly (no NodePort to the internet) |
| **NAT Gateway** | **One NAT per AZ** when workloads need outbound internet | If one AZ's NAT dies, the other AZs still get out; no cross-AZ data charges |
| **VPC endpoints** | ECR, S3, STS, Secrets Manager endpoints | Private traffic to AWS services, less NAT cost |
| **API endpoint** | Private, or public restricted to known CIDRs | Fewer people can even reach the API server |

> **Interview one-liner:** dedicated VPC across 3 AZs, public subnets only for ALB/NLB and NAT gateways (one per AZ), worker nodes in private subnets, managed EKS control plane, and VPC endpoints for AWS services.

---

## 9. Compute and high availability

| Item | What to do | Why |
|---|---|---|
| **Node groups** | **Separate system workloads from application workloads** (system node group with a taint) | A noisy app can't starve CoreDNS, controllers or monitoring |
| **Karpenter** | **Dynamically provisions EC2 capacity based on pending Pods** | Right-sized nodes in seconds, Spot + On-Demand mix, consolidation saves cost |
| **Replicas** | Run **multiple replicas** (≥ 2–3) for critical apps | One Pod crash or node loss doesn't cause downtime |
| **Pod distribution** | **Topology spread constraints** across nodes and AZs | Replicas aren't all in one AZ or on one node |
| **PDB** (PodDisruptionBudget) | Keep a minimum number of Pods up during **voluntary** disruptions | Node drains, upgrades and Karpenter consolidation don't take all replicas at once |
| **Health checks** | **Readiness, liveness and startup probes** ([Day 24](../day-24-probes/README.md)) | Traffic only to ready Pods, stuck Pods restarted |
| **Autoscaling** | **HPA** for Pods, **Karpenter / Cluster Autoscaler** for nodes | Scale with traffic, both layers |
| **Requests / limits** | Set CPU/memory requests on every container | Scheduler and autoscalers can make correct decisions |
| **PriorityClass** | Critical apps get higher priority ([Day 34](../day-34-certificates-pod-priority/README.md)) | They keep running when capacity is tight |

**Topology spread (3 replicas, one per AZ):**

```yaml
spec:
  topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app: payment
```

**PodDisruptionBudget (never fewer than 2 running during a drain):**

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: payment-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: payment
```

> **Interview one-liner:** separate system and app node groups, Karpenter for fast node capacity, multiple replicas spread across AZs with topology spread constraints, PDBs for safe drains, probes for health, and HPA plus Karpenter for autoscaling.

---

## 10. Security

This is the 4C's from Part 1, applied to EKS:

| Item | What to do |
|---|---|
| **IAM** | **Least privilege** for users, nodes and workloads; people log in with SSO/roles, not IAM users |
| **Pod Identity** | Give Pods **dedicated AWS permissions** instead of relying on the broad **node** role |
| **RBAC** | Control Kubernetes access with Role/RoleBinding and least privilege; EKS **access entries** map IAM → Kubernetes |
| **NetworkPolicy** | Restrict unnecessary Pod-to-Pod communication (default deny + allow rules) |
| **Secrets** | Store secrets in **AWS Secrets Manager**, not in Git or manifests |
| **Encryption** | **KMS** for Kubernetes Secrets (etcd), EBS, S3, RDS; TLS in transit with ACM |
| **Container security** | **Scan images** (Trivy / ECR scanning) and **avoid privileged/root containers** (security context, Pod Security Admission `restricted`) |
| **Admission policy** | **Kyverno**: ECR only, no `:latest`, signed images, no static keys |
| **Audit** | EKS control plane logs + CloudTrail + GuardDuty |

> **Interview one-liner:** least-privilege IAM, Pod Identity per app, RBAC, default-deny NetworkPolicies, secrets in Secrets Manager, KMS encryption, scanned non-root images and Kyverno admission policies.

---

## 11. Observability

| Item | What to do | Tools |
|---|---|---|
| **Metrics** | Monitor **cluster, node, Pod and application** metrics | Prometheus, kube-state-metrics, Node Exporter, CloudWatch Container Insights |
| **Logs** | **Centralize** Kubernetes and application logs | Fluent Bit → CloudWatch Logs / Loki / OpenSearch |
| **Tracing** | **Distributed tracing** for complex microservices ([Day 33](../day-33-opentelemetry/README.md)) | OpenTelemetry → Jaeger / Tempo / X-Ray |
| **Monitoring stack** | Dashboards and queries ([Day 27](../day-27-monitoring-prometheus-grafana/README.md)) | Prometheus + Grafana and/or CloudWatch (Amazon Managed Prometheus / Grafana) |
| **Alerting** | Alert on **SLOs, errors, latency and resource saturation**, not on every metric | Alertmanager → Slack / PagerDuty |

**What to alert on (the "golden signals"):** **latency**, **traffic**, **errors**, **saturation**.

> **Interview one-liner:** metrics with Prometheus/Grafana or CloudWatch, centralized logs with Fluent Bit, distributed tracing with OpenTelemetry, and alerts based on SLOs, error rate, latency and saturation.

---

## 12. Deployment and operations

| Item | What to do | Why |
|---|---|---|
| **Terraform** | Provision AWS and EKS infrastructure as code | Repeatable, reviewed, same for dev/stage/prod |
| **CI/CD** | **Build, test, scan and deploy** through an automated pipeline | No manual `kubectl apply` in production |
| **GitOps** | **Argo CD or Flux** when Git-driven deployment fits | Git is the source of truth; drift is auto-corrected; easy rollback = `git revert` |
| **Helm** | Package and manage Kubernetes apps | Versioned releases, values per environment |
| **Deployment strategy** | Rolling, canary or blue-green ([Day 29](../day-29-deployment-strategies/README.md)) | Release safely, limit blast radius |
| **Upgrades** | **Test EKS, node and add-on upgrades** in lower environments first | EKS versions have a support window; add-ons (VPC CNI, CoreDNS, kube-proxy) must match |
| **Rollback** | **Always keep a tested rollback** strategy | `helm rollback`, Argo CD sync to a previous commit, `kubectl rollout undo` |

> **Interview one-liner:** Terraform for infrastructure, CI pipelines that build, test, scan and push, GitOps with Argo CD and Helm for deployments, upgrades tested in staging first, and a rollback we've actually practiced.

---

## 13. Backup and disaster recovery

| Item | Meaning |
|---|---|
| **Backup** | Back up **application data and persistent volumes**, and **regularly test restores** (Velero for cluster objects + volumes, AWS Backup / EBS snapshots, RDS automated backups) |
| **RTO** (Recovery Time Objective) | **How quickly** the application must be back after an outage, e.g. 1 hour |
| **RPO** (Recovery Point Objective) | **How much data** the business can afford to lose, e.g. last 15 minutes |
| **Multi-region** | Use multi-region DR **only when** the business RTO/RPO justify the extra cost and complexity |

```
 last backup ◄──── RPO (data lost) ────► outage ◄──── RTO (downtime) ────► service back
```

**Good to know:** with GitOps + Terraform, the **cluster itself** is easy to rebuild; the hard part is **data** (databases, volumes). An untested backup is not a backup. More in [DR notes](../../day-20-disaster-recovery/README.md).

> **Interview one-liner:** we back up data and volumes (Velero, AWS Backup, RDS snapshots) and test restores; RTO is how fast we must recover, RPO is how much data we can lose, and those numbers decide whether multi-region is worth it.

---

## 14. The 60-second interview answer

> **"How would you design a production EKS cluster?"**
>
> "I'd build a **multi-AZ** design across **three Availability Zones** in a dedicated VPC: worker nodes in **private subnets**, an **ALB/NLB** in public subnets for application traffic, and a **NAT gateway per AZ**. **EKS** gives us a highly available, managed control plane. For the data plane I use a **system node group** for cluster add-ons and **Karpenter** for application capacity. Critical apps run **multiple replicas** with **topology spread constraints**, **PodDisruptionBudgets** and proper **readiness, liveness and startup probes**. **HPA** scales Pods and **Karpenter** scales nodes.
>
> For **security** I use least-privilege **IAM**, **Pod Identity** per workload, **RBAC**, **NetworkPolicies**, **Secrets Manager** with **KMS** encryption, **image scanning** and **Kyverno** admission policies. For **observability**, centralized logs, **Prometheus/Grafana** or **CloudWatch**, tracing with **OpenTelemetry**, and **SLO-based alerts**. Infrastructure is managed with **Terraform**, apps are deployed through **CI/CD** and **GitOps** with **Helm**, upgrades are tested in staging, and we keep a tested **rollback**. Finally, **backups** are tested regularly and the DR design follows the business **RTO and RPO**."

---

# Part 3: KEPs

## 15. What is a KEP?

**Definition:** a **KEP (Kubernetes Enhancement Proposal)** is a **design document** that describes a **significant change** to Kubernetes (a new feature, an API change, a removal): **what** it is, **why** it's needed, **how** it will work, how it will be **tested**, and how it will **graduate**. Every big feature goes through a KEP before it's built.

**In simple words:** Kubernetes is built by thousands of people in many companies. A KEP is the **official plan** everyone reviews and agrees on, so big changes don't land randomly.

| Part of a KEP | What it says |
|---|---|
| **Summary / Motivation** | What problem it solves, goals and non-goals |
| **Proposal / Design** | The API and how it works |
| **Risks** | What could go wrong |
| **Test plan** | Unit, integration, e2e tests |
| **Graduation criteria** | What's needed to move alpha → beta → stable |
| **Production readiness review** | Can it be turned on/off safely, what to monitor |

**Who and where:**
- KEPs live in the **`kubernetes/enhancements`** GitHub repo, numbered (`KEP-1234`).
- Each KEP is owned by a **SIG** (Special Interest Group), for example SIG Node, SIG Network, SIG Auth.
- The **release team** tracks which KEPs land in each Kubernetes release (about 3 releases a year).

**Examples you already met:**

| Feature | Owned by |
|---|---|
| **Native sidecar containers** (init containers with `restartPolicy: Always`) | SIG Node |
| **Pod Security Admission** (replaced PodSecurityPolicy) | SIG Auth |
| **ValidatingAdmissionPolicy** (CEL policies in Kubernetes itself) | SIG API Machinery |
| **In-place Pod resource resize** (change CPU/memory without restart) | SIG Node |
| **Gateway API** (developed as a SIG Network subproject) | SIG Network |

**Why it matters to a DevOps engineer:** before an **EKS upgrade**, you read the release notes / KEPs to know which features **graduate**, which APIs are **deprecated or removed**, and what might break your manifests.

> **Interview one-liner:** a KEP is the Kubernetes Enhancement Proposal, the design document every significant feature goes through in the kubernetes/enhancements repo, owned by a SIG and tracked from alpha to beta to stable.

---

## 16. KEP lifecycle: alpha, beta, stable

```
 KEP written ──► provisional ──► implementable ──► alpha ──► beta ──► stable (GA)
                 (idea agreed)    (design approved)   │         │          │
                                                      │         │          └ always on, API won't break
                                                      │         └ usually ON by default, well tested
                                                      └ OFF by default (feature gate), may change or be dropped
```

| Stage | Feature gate | Use in production? |
|---|---|---|
| **Alpha** | **Off** by default, you must enable a **feature gate** | ❌ No: may be buggy, change or disappear |
| **Beta** | Usually **on** by default (new beta APIs are off by default) | ⚠️ Carefully, after testing |
| **Stable / GA** | Always on, gate removed later | ✅ Yes |
| **Deprecated** | Still works, scheduled for removal | Migrate before the removal release |

**Feature gate:** a `key=true/false` switch on Kubernetes components, e.g. `--feature-gates=SomeFeature=true`. On **EKS** you can't set control plane feature gates yourself: you get what AWS enables for that version (beta/GA features).

> **Interview one-liner:** KEP features move alpha (off, behind a feature gate) → beta (usually on) → stable/GA; in production we rely on GA features and check deprecations before every upgrade.

---

# Wrap-up

## 17. What I learned

**4C's**
- **Cloud → Cluster → Container → Code**, each wraps the next, secure all of them.
- **Cloud:** VPC, WAF, Secrets Manager, IAM, KMS, CloudTrail.
- **Cluster:** RBAC, NetworkPolicy, admission controllers, IRSA/Pod Identity, Kyverno, Secrets, ACM.
- **Container:** Trivy, security context (non-root, no escalation, drop capabilities, read-only FS), minimal images.
- **Code:** SAST, CodeQL, SCA, secret scanning, Cosign.

**Production EKS**
- 3 AZs, dedicated VPC, private nodes, ALB/NLB, NAT per AZ, managed control plane.
- System vs app node groups, Karpenter, replicas, topology spread, PDB, probes, HPA.
- Least-privilege IAM, Pod Identity, RBAC, NetworkPolicy, Secrets Manager, KMS, scanning, Kyverno.
- Prometheus/Grafana/CloudWatch, centralized logs, tracing, SLO alerts.
- Terraform, CI/CD, GitOps, Helm, tested upgrades and rollback.
- Backups with tested restores, RTO/RPO decide multi-region.

**KEPs**
- Kubernetes Enhancement Proposal = design doc for every significant change, owned by a SIG, alpha → beta → GA behind feature gates.

## 18. Commands

| Command | What it does |
|---|---|
| `kubectl get nodes -L topology.kubernetes.io/zone` | Which AZ each node is in |
| `kubectl get pods -o wide -l app=X` | Are replicas spread across nodes? |
| `kubectl get pdb -A` | PodDisruptionBudgets and allowed disruptions |
| `kubectl get networkpolicy -A` | NetworkPolicies per namespace |
| `kubectl auth can-i --list --as=<user>` | What a user/SA can do (RBAC) |
| `kubectl get ns --show-labels \| grep pod-security` | Pod Security Admission level per namespace |
| `aws eks describe-cluster --name C --query cluster.encryptionConfig` | Is Secrets encryption with KMS on? |
| `aws eks describe-cluster --name C --query cluster.logging` | Control plane logs enabled? |
| `trivy image <image>` | Scan an image for CVEs |
| `cosign verify --key cosign.pub <image>` | Verify an image signature |
| `kubectl version` | Client/server version (check deprecations before upgrades) |

## 19. Interview Questions

### ⭐ Very Important

**Q1. What are the 4C's of cloud native security?**
Cloud, Cluster, Container and Code. Each layer wraps the next, so you secure all of them: cloud with VPC, WAF, IAM, KMS, Secrets Manager and CloudTrail; cluster with RBAC, NetworkPolicy, admission controllers, Pod Identity/IRSA, Kyverno, encrypted Secrets and ACM; container with Trivy scanning and a restrictive security context; code with SAST/CodeQL, SCA, secret scanning and Cosign signing.

**Q2. How would you design a production-grade EKS cluster?**
Multi-AZ across three AZs in a dedicated VPC, private worker nodes, ALB/NLB for traffic and a NAT gateway per AZ, with the managed EKS control plane. System node group for add-ons and Karpenter for apps; multiple replicas with topology spread, PDBs and probes; HPA for Pods and Karpenter for nodes. Least-privilege IAM, Pod Identity, RBAC, NetworkPolicies, Secrets Manager, KMS, image scanning and Kyverno. Prometheus/Grafana or CloudWatch, centralized logs, tracing and SLO-based alerts. Terraform, CI/CD, GitOps with Helm, tested upgrades and rollback, and tested backups designed around the business RTO and RPO.

**Q3. What is a KEP?**
A Kubernetes Enhancement Proposal: the design document for every significant Kubernetes change, kept in the kubernetes/enhancements repo and owned by a SIG. It covers motivation, design, risks, test plan and graduation criteria, and the feature moves from alpha (off behind a feature gate) to beta to stable/GA.

**Q4. SAST vs SCA vs secret scanning?**
SAST (SonarQube, Semgrep, CodeQL) analyzes our own source code for insecure patterns. SCA (Dependabot, Snyk, Trivy) checks third-party dependencies for known CVEs and licenses. Secret scanning (GitHub secret scanning, gitleaks) finds passwords, tokens and keys committed to Git, and push protection blocks them before they land.

**Q5. Why separate system and application node groups?**
So cluster-critical add-ons (CoreDNS, controllers, monitoring) always have capacity and aren't evicted or starved by application load. The system group is usually tainted so only system Pods with tolerations run there.

**Q6. What is a PodDisruptionBudget?**
A rule that keeps a minimum number (or a maximum unavailable number) of Pods running during voluntary disruptions like node drains, upgrades and Karpenter consolidation. It doesn't protect against crashes or node failures.

### Other Questions

**Q7. Why one NAT gateway per AZ?**
If one AZ (and its NAT) fails, Pods in the other AZs still have outbound internet, and traffic doesn't cross AZs, which avoids extra data charges.

**Q8. RTO vs RPO?**
RTO is how quickly the service must be back after an outage; RPO is how much data (time) the business can afford to lose. They decide the backup frequency and whether multi-region DR is worth it.

**Q9. What is WAF and where does it sit?**
A web application firewall in front of the ALB (or CloudFront/API Gateway). It inspects HTTP requests and blocks common attacks like SQL injection and XSS, bad bots, and abusive IPs with rate limiting.

**Q10. How are Kubernetes Secrets protected on EKS?**
Enable envelope encryption with a KMS key so Secrets are encrypted in etcd, restrict `get/list secrets` with RBAC, and keep the real values in AWS Secrets Manager synced via External Secrets or the Secrets Store CSI driver, accessed with Pod Identity.

**Q11. What is ACM used for in EKS?**
AWS Certificate Manager issues and auto-renews TLS certificates. You attach the certificate to the ALB through an Ingress annotation so users connect over HTTPS without managing certificates by hand.

**Q12. Karpenter vs Cluster Autoscaler?**
Cluster Autoscaler scales existing node groups up and down. Karpenter looks at pending Pods and launches right-sized EC2 instances directly (any type, Spot or On-Demand) in seconds, and consolidates underused nodes to save cost.

**Q13. Alpha vs beta vs GA features?**
Alpha is off by default behind a feature gate and may change or be removed; beta is usually on and well tested; GA is stable and its API won't break. Production should rely on GA features, and you check deprecations and removals before every upgrade.

**Q14. Why is the cluster easy to rebuild but data isn't?**
With Terraform and GitOps the infrastructure and manifests are code and can be recreated anytime. Data in databases and volumes only exists in the running systems, so it needs real backups and regularly tested restores.
