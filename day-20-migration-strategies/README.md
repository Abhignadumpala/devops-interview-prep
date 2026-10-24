# Day 20 — Migration Strategies: Short and Simple

> **In short:** A migration strategy = **how** you move an app from one place (on-prem / AWS / Azure) to another.
> Class teaches the **6 R's**. AWS's official list today is **7 Rs** (adds *Relocate*).

---

## 1. The R's at a glance

| # | Strategy | Nickname | Simple definition | Example |
|---|---|---|---|---|
| 1 | **Rehost** | Lift & Shift | Move as-is, almost no changes | AWS EC2 → Azure VM |
| 2 | **Replatform** | Lift, tinker & shift | Move + small platform upgrades | EC2 + self-run MySQL → VM + managed DB (RDS) |
| 3 | **Refactor** | Re-architect | Redesign the app for the cloud | Monolith on VMs → microservices on EKS / AKS / GKE |
| 4 | **Repurchase** | Drop & Shop | Replace with a bought / SaaS product | Self-hosted CRM → Salesforce |
| 5 | **Retire** | Switch off | Shut down apps nobody needs | Old app with no users for 90 days |
| 6 | **Retain** | Keep as is | Don't move it (yet) | App tied to special hardware or compliance |
| 7 | **Relocate** *(AWS only)* | Move platform | Move servers to the cloud version of the same platform, or to another VPC / region / account | VMware on-prem → VMware Cloud on AWS |

```
Least change ◀──────────────────────────────────────▶ Most change
 Retain · Retire · Rehost · Relocate · Replatform · Repurchase · Refactor
```

---

## 2. The 3 main ones (asked most)

### 1️⃣ Rehost (Lift & Shift)

**Definition:** Move the app to the new cloud with minimal changes.

- **When:** migration must be quick, app is stable, no time to modernize
- **DevOps work:** Terraform, Ansible, Packer, CI/CD, monitoring, DNS, networking

> **Interview line:** "Rehosting moves the workload with minimal changes. I recreate the infra with IaC, migrate the data, validate the app, then do a controlled traffic cutover."

### 2️⃣ Replatform (Move + Optimize)

**Definition:** Move the app and make **small** improvements, without changing the code much.

```
Self-managed DB            → Managed DB (RDS / Azure DB)
Self-managed load balancer → Cloud load balancer (ALB)
```

- **When:** want less ops work, better reliability, managed services

> **Interview line:** "Replatforming moves the workload with limited platform changes, like replacing self-managed parts with managed cloud services."

### 3️⃣ Refactor (Redesign)

**Definition:** Rebuild the app's architecture to use cloud-native features.

- **When:** current setup has problems with scaling, availability, deploy speed, maintenance
- **DevOps work:** Terraform, Kubernetes, Helm, CI/CD, service discovery, observability, security, autoscaling
- **AWS tip:** most complex and costly. In big migrations, rehost/replatform first and **modernize later**.

> **Interview line:** "Refactoring is a deeper migration where I redesign the app architecture instead of just moving the existing infra."

---

## 3. A senior engineer should explain

Not just the names, but **how**:

| Question | Short answer |
|---|---|
| Why this strategy? | Based on time, budget, risk, business need |
| How is infra moved? | Recreate with IaC (Terraform) |
| How is data moved? | Replicate / dump-restore (e.g. AWS DMS), then sync |
| How is downtime controlled? | Replicate first, short cutover window |
| How is traffic switched? | DNS (Route 53 weighted → 100%) |
| How is rollback handled? | Keep old env running until new one is stable; switch DNS back |
| How is it validated? | Smoke tests, monitoring, compare data |

---

## 4. Interview Questions

### ⭐ Very Important (asked in class)

**Q1. What are the 6 R's of migration?**
Rehost, Replatform, Refactor, Repurchase, Retire, Retain. (AWS now lists 7: + Relocate.)

**Q2. Rehost vs Replatform vs Refactor?**
Rehost = move as-is. Replatform = move + small upgrades (managed DB). Refactor = redesign for cloud (microservices on Kubernetes).

### Other Questions

**Q1. Which is fastest?** Rehost (or Relocate). **Most costly?** Refactor.

**Q2. Why not refactor everything during migration?** Too risky and slow; move first, modernize after.

**Q3. When do you Retain an app?** Compliance, special hardware, or it was just upgraded.

---

**Source:** [AWS Prescriptive Guidance: migration strategies (7 Rs)](https://docs.aws.amazon.com/prescriptive-guidance/latest/large-migration-guide/migration-strategies.html)
