# Day 40 - Azure Basics (Tenants, Subscriptions, Resource Groups, RBAC) and AKS

> **In short:** **Microsoft Azure** is Microsoft's public cloud. Everything in Azure lives in a hierarchy: a **tenant** (your organization's identity directory in Microsoft Entra ID) holds **management groups**, which hold **subscriptions** (billing + access boundary), which hold **resource groups** (folders for related resources), which hold the **resources** (VMs, VNets, AKS clusters…). Every request goes through **Azure Resource Manager (ARM)**, and access is controlled with **Azure RBAC** at any level of that hierarchy. **AKS** (Azure Kubernetes Service) is Azure's managed Kubernetes, the Azure version of EKS. In the lab we create a resource group, build an AKS cluster with the Azure CLI, deploy nginx behind an Azure Load Balancer, and clean everything up.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Azure basics** | Regions and availability zones, the hierarchy (tenant → management group → subscription → resource group → resource), ARM, identities and Azure RBAC, tags / Policy / locks, Azure vs AWS service names | How Azure is organized and who can do what, where |
| **Part 2: AKS concepts** | What AKS is, architecture and the node resource group (MC_…), system vs user node pools, networking (kubenet, Azure CNI, CNI Overlay), identity (managed identity, Entra ID, workload identity, ACR), storage, scaling, pricing tiers, built-in add-ons (Managed Prometheus/Grafana, Istio, KEDA, Policy), EKS vs AKS | How a managed Kubernetes cluster is built on Azure |
| **Part 3: Lab** | Azure CLI → login → subscription → resource group → AKS cluster → kubectl → nginx with a LoadBalancer Service → user node pool → KEDA + Managed Prometheus add-ons → stop/start → clean up | Build and delete a real AKS cluster end to end |
| **Part 4: Production** | Production-grade AKS checklist | What real teams turn on before going live |

## Table of Contents

**Part 1: Azure basics**
1. [What is Microsoft Azure?](#1-what-is-microsoft-azure)
2. [Regions, availability zones and region pairs](#2-regions-availability-zones-and-region-pairs)
3. [The Azure hierarchy (the big picture)](#3-the-azure-hierarchy-the-big-picture)
4. [Tenant (Microsoft Entra ID)](#4-tenant-microsoft-entra-id)
5. [Management groups](#5-management-groups)
6. [Subscriptions](#6-subscriptions)
7. [Resource groups](#7-resource-groups)
8. [Resources and Azure Resource Manager (ARM)](#8-resources-and-azure-resource-manager-arm)
9. [Identities and Azure RBAC](#9-identities-and-azure-rbac) (+ AWS access key vs Azure service principal)
10. [Governance: tags, Azure Policy, resource locks](#10-governance-tags-azure-policy-resource-locks)
11. [Azure vs AWS: service names](#11-azure-vs-aws-service-names)

**Part 2: AKS concepts**

12. [What is AKS?](#12-what-is-aks)
13. [AKS architecture and the node resource group](#13-aks-architecture-and-the-node-resource-group)
14. [Node pools: system vs user](#14-node-pools-system-vs-user)
15. [AKS networking](#15-aks-networking)
16. [AKS identity and access](#16-aks-identity-and-access)
17. [Storage, scaling and pricing tiers](#17-storage-scaling-and-pricing-tiers)
18. [Built-in add-ons: no Helm installs](#18-built-in-add-ons-no-helm-installs)
19. [EKS vs AKS](#19-eks-vs-aks)

**Part 3: Lab**

20. [Lab overview](#20-lab-overview)
21. [Step 1: Install the Azure CLI and log in](#21-step-1-install-the-azure-cli-and-log-in)
22. [Step 2: Pick the subscription](#22-step-2-pick-the-subscription)
23. [Step 3: Create the resource group](#23-step-3-create-the-resource-group)
24. [Step 4: Create the AKS cluster](#24-step-4-create-the-aks-cluster)
25. [Step 5: Connect with kubectl](#25-step-5-connect-with-kubectl)
26. [Step 6: Look at the node resource group](#26-step-6-look-at-the-node-resource-group)
27. [Step 7: Deploy nginx with a LoadBalancer Service](#27-step-7-deploy-nginx-with-a-loadbalancer-service)
28. [Step 8: Add a user node pool](#28-step-8-add-a-user-node-pool)
29. [Step 9: Turn on built-in add-ons (KEDA + Managed Prometheus)](#29-step-9-turn-on-built-in-add-ons-keda--managed-prometheus)
30. [Step 10: Stop and start the cluster](#30-step-10-stop-and-start-the-cluster)
31. [Step 11: Clean up](#31-step-11-clean-up)
32. [Troubleshooting](#32-troubleshooting)

**Part 4: Production**

33. [Production-grade AKS checklist](#33-production-grade-aks-checklist)

**Wrap-up**

34. [What I learned](#34-what-i-learned)
35. [Commands](#35-commands)
36. [Interview Questions](#36-interview-questions)

---

# Part 1: Azure basics

## 1. What is Microsoft Azure?

**Definition:** **Microsoft Azure** is Microsoft's public cloud platform. It rents you computing resources (virtual machines, networks, storage, databases, Kubernetes) on demand, over the internet, and you pay only for what you use. It is the second-largest cloud after AWS and is very common in companies that already use Microsoft products (Windows, Office 365, Active Directory).

- **What it is:** hundreds of services you create from the Azure portal (`portal.azure.com`), the Azure CLI (`az`), PowerShell, Terraform or Bicep.
- **What happens:** you ask for a resource (for example a VM in East US), Azure builds it in one of its data centers in minutes.
- **Why companies pick it:** single sign-on with the company's Microsoft accounts (Entra ID), Windows/SQL Server licenses, hybrid setups with on-prem.

**Analogy:** like renting a fully furnished office instead of building one. You pick the size, move in today, and stop paying when you leave.

| Service model | You manage | Azure manages | Azure example |
|---|---|---|---|
| **IaaS** (Infrastructure as a Service) | OS, runtime, app | Hardware, network, virtualization | Virtual Machines |
| **PaaS** (Platform as a Service) | Your app and data | Everything below the app | App Service, Azure SQL Database, AKS (control plane) |
| **SaaS** (Software as a Service) | Only your data/users | Everything | Microsoft 365, Outlook |

> **Interview one-liner:** "Azure is Microsoft's public cloud; you rent IaaS, PaaS and SaaS services on demand and pay per use, and it integrates tightly with Microsoft identity through Entra ID."

---

## 2. Regions, availability zones and region pairs

**Definition:** a **region** is a geographic area with one or more Azure data centers, for example `eastus`, `westeurope` or `centralindia`. An **availability zone (AZ)** is a physically separate data center (own power, cooling, network) inside a region; zone-enabled regions have **3 zones**. A **region pair** is two regions in the same geography (for example East US ↔ West US) that Azure links for disaster recovery.

- **Region:** you choose it when you create a resource; it decides latency and data residency.
- **Availability zone:** spread VMs / AKS nodes across zones 1, 2, 3, so one data center failure doesn't take the app down.
- **Region pair:** Azure updates paired regions one at a time and prioritises recovering one of them in a large outage; geo-redundant storage (GRS) copies data to the pair.

**Analogy:** a region is a city, availability zones are separate buildings in that city, and a region pair is a sister city far away where you keep a backup.

```
                 Geography: United States
  ┌──────────── Region: East US ────────────┐      ┌──── Region: West US ────┐
  │  ┌───────┐   ┌───────┐   ┌───────┐      │ pair │                         │
  │  │ Zone 1│   │ Zone 2│   │ Zone 3│      │◄────►│   (disaster recovery)   │
  │  │  DC   │   │  DC   │   │  DC   │      │      │                         │
  │  └───────┘   └───────┘   └───────┘      │      └─────────────────────────┘
  └─────────────────────────────────────────┘
```

| | Lab | Production |
|---|---|---|
| Regions | 1 region (`eastus`) | 1 main region + DR in the paired region |
| Zones | No zones (cheaper, simpler) | ✅ Nodes spread over zones 1, 2, 3 |

> **Interview one-liner:** "A region is a geographic location, an availability zone is a separate data center inside it (3 per region), and a region pair is a linked region used for disaster recovery."

---

## 3. The Azure hierarchy (the big picture)

**Definition:** Azure organizes everything in a **4-level hierarchy** under one **tenant**: **management groups → subscriptions → resource groups → resources**. Permissions (RBAC) and rules (Policy) set on a higher level are **inherited** by everything below it.

- **Top:** the tenant is the organization's identity (users, groups, apps).
- **Middle:** management groups group subscriptions; subscriptions pay the bill.
- **Bottom:** resource groups are folders; resources (VM, VNet, AKS) are the actual things.

**Analogy:** a company (tenant) → departments (management groups) → each team's credit card (subscription) → project folders (resource groups) → files (resources).

```
  Tenant: mycompany.onmicrosoft.com   (Microsoft Entra ID: users, groups, apps)
   │
   └── Root management group
        ├── MG: Production
        │    └── Subscription: prod-sub            ◄── billing + access boundary
        │         ├── Resource group: rg-shop-prod   ◄── folder
        │         │    ├── AKS cluster: aks-shop-prod  ◄── resources
        │         │    ├── VNet: vnet-shop-prod
        │         │    └── Key Vault: kv-shop-prod
        │         └── Resource group: rg-shared-prod
        └── MG: Non-production
             ├── Subscription: dev-sub
             └── Subscription: test-sub

  RBAC role / Azure Policy assigned at a level ──► inherited by everything below
```

| Level | Holds | Typical owner |
|---|---|---|
| Tenant | Users, groups, apps, all subscriptions | Identity / IT team |
| Management group | Subscriptions (and other MGs) | Cloud platform team |
| Subscription | Resource groups | Billing owner, team lead |
| Resource group | Resources of one app/environment | App or DevOps team |
| Resource | Nothing (it's the actual thing) | App or DevOps team |

> **Interview one-liner:** "Azure hierarchy is tenant → management groups → subscriptions → resource groups → resources, and RBAC and Policy flow down from parent to child."

---

## 4. Tenant (Microsoft Entra ID)

**Definition:** a **tenant** is one dedicated instance of **Microsoft Entra ID** (the new name of Azure Active Directory since 2023) that belongs to one organization. It stores the organization's **users, groups and applications** and handles sign-in. It has a unique **tenant ID** (a GUID like `72f988bf-86f1-41af-91ab-2d7cd011db47`) and a default domain like `mycompany.onmicrosoft.com`.

- **What it is:** the identity directory: who you are when you sign in.
- **What happens:** when you sign up for Azure, a tenant is created for you; every subscription trusts **exactly one** tenant for sign-in.
- **What goes wrong:** a user from tenant A can't see subscriptions in tenant B unless invited as a guest (B2B).

**Analogy:** the company's ID-card office. It issues ID cards (accounts); every building (subscription) checks ID cards from this office only.

```
  ┌──────── Tenant (Entra ID) ────────┐
  │ Users:  alice, bob                │
  │ Groups: devops-team               │      trusts 1 tenant
  │ Apps:   github-actions (SP)       │◄──────────── Subscription: dev-sub
  │                                   │◄──────────── Subscription: prod-sub
  └───────────────────────────────────┘
```

| | Tenant (Entra ID) | Subscription |
|---|---|---|
| Answers | **Who** are you? (identity) | **Where** do resources live and who pays? |
| How many | Usually 1 per company | Many per tenant |

> **Interview one-liner:** "A tenant is an organization's Microsoft Entra ID instance; it holds users, groups and apps, and every subscription trusts exactly one tenant for authentication."

---

## 5. Management groups

**Definition:** a **management group** is a container that groups **subscriptions** (and other management groups) so you can apply **RBAC and Azure Policy once** to many subscriptions. Every tenant has one **root management group** at the top; you can nest management groups up to **6 levels** deep.

- **What it is:** a level above subscriptions, only for governance (no resources live directly in it).
- **What happens:** assign "only `eastus` and `centralindia` allowed" Policy on the `Production` MG → every prod subscription inherits it.
- **Why:** with 50 subscriptions you don't want to set the same rule 50 times.

**Analogy:** a department head. A rule announced to the department applies to every team in it.

```
  Root MG ── Policy: "allowed regions = eastus, centralindia"
   ├── MG: Production ── RBAC: platform-team = Owner
   │     ├── prod-sub-1   (inherits both)
   │     └── prod-sub-2   (inherits both)
   └── MG: Sandbox
         └── sandbox-sub  (inherits the region policy only)
```

| | Small company | Large enterprise |
|---|---|---|
| Management groups | Often not used (1–2 subscriptions) | ✅ Prod / Non-prod / Sandbox / Platform MGs (Azure landing zone) |

> **Interview one-liner:** "Management groups sit above subscriptions and let you apply RBAC and Azure Policy to many subscriptions at once through inheritance."

---

## 6. Subscriptions

**Definition:** a **subscription** is an agreement with Microsoft to use Azure, and it is the **billing boundary** and an **access boundary**. Every resource you create is billed to one subscription. It has a **subscription ID** (a GUID) and a name like `prod-sub`, and it has its own **quotas** (for example the number of vCPUs per region).

- **What it is:** the "account" you create resources in, the closest thing to an **AWS account**.
- **What happens:** the invoice is per subscription; you can give a team access to one subscription only.
- **What goes wrong:** you hit the subscription's vCPU quota and a new VM / AKS node fails until you request more.

**Analogy:** a company credit card for one team. All purchases on it show on one bill, and only card holders can use it.

```
  Subscription: dev-sub   (ID: 1111-...)     Subscription: prod-sub  (ID: 2222-...)
  ┌─────────────────────────────┐            ┌─────────────────────────────┐
  │ rg-app-dev   rg-test        │            │ rg-app-prod   rg-shared     │
  │ Bill: $300 / month          │            │ Bill: $4,000 / month        │
  │ Quota: 10 vCPU in eastus    │            │ Quota: 200 vCPU in eastus   │
  └─────────────────────────────┘            └─────────────────────────────┘
        devs = Contributor                          devs = Reader only
```

| Common pattern | Why |
|---|---|
| Separate **dev / test / prod** subscriptions | Separate bills, separate access, a mistake in dev can't touch prod |
| One subscription per big product or team | Clear cost ownership |
| Subscription types: Free trial ($200 credit, 30 days), Pay-As-You-Go, Enterprise Agreement | Free trial for learning, EA for companies |

> **Interview one-liner:** "A subscription is Azure's billing and access boundary, like an AWS account; companies usually separate dev, test and prod into different subscriptions."

---

## 7. Resource groups

**Definition:** a **resource group (RG)** is a logical container (folder) that holds related resources that share the **same lifecycle**, for example everything for `shop` in `dev`. Every resource must be in **exactly one** resource group. Deleting a resource group **deletes every resource inside it**.

- **What it is:** a folder inside a subscription, for example `rg-shop-dev`. Resource groups can't be nested.
- **What happens:** you grant RBAC, set tags or apply locks on the RG, and everything inside inherits them; `az group delete` cleans up a whole environment in one command.
- **What goes wrong:** the RG has a location (where its metadata is stored), but its resources can be in other regions, so don't assume "RG in eastus = everything in eastus".

**Analogy:** a project box. Everything for one project goes in one box; throw the box away and everything inside goes with it.

```
  Subscription: dev-sub
   ├── rg-shop-dev  (location: eastus)
   │     ├── aks-shop-dev        (eastus)
   │     ├── vnet-shop-dev       (eastus)
   │     └── kv-shop-dev         (eastus)
   └── rg-shop-dr   (location: westus)
         └── storage-backup      (westus)

  az group delete -n rg-shop-dev   ──►  AKS + VNet + Key Vault all deleted
```

| How to group | Good for |
|---|---|
| By **app + environment** (`rg-shop-dev`, `rg-shop-prod`) | ✅ Most common, easy cleanup and access |
| By **resource type** (`rg-networking`, `rg-databases`) | Shared platform resources used by many apps |

> **Interview one-liner:** "A resource group is a container for resources that share a lifecycle; a resource lives in exactly one RG, and deleting the RG deletes everything in it."

---

## 8. Resources and Azure Resource Manager (ARM)

**Definition:** a **resource** is one manageable item in Azure: a VM, a VNet, a disk, a storage account, an AKS cluster. **Azure Resource Manager (ARM)** is the single API layer that **every** request goes through, whether it comes from the portal, the CLI, PowerShell, Terraform or Bicep. ARM authenticates you (Entra ID), checks RBAC and Policy, then asks the right **resource provider** (for example `Microsoft.ContainerService` for AKS) to do the work.

- **What it is:** each resource has a unique **resource ID**: `/subscriptions/<sub-id>/resourceGroups/rg-shop-dev/providers/Microsoft.ContainerService/managedClusters/aks-shop-dev`.
- **What happens:** same rules for everyone: a Terraform apply and a portal click are checked the same way.
- **What goes wrong:** in a new subscription a resource provider may not be **registered** yet, so creating that resource type fails until you register it.

**Analogy:** the reception desk of a big office. Whoever you are and however you arrive (portal, CLI, Terraform), you go through the same desk that checks your ID and permissions before sending you to the right department.

```
  Portal   CLI (az)   PowerShell   Terraform / Bicep
     │        │           │              │
     └────────┴─────┬─────┴──────────────┘
                    ▼
        ┌──── Azure Resource Manager ────┐
        │ 1. Authenticate (Entra ID)     │
        │ 2. Authorize   (Azure RBAC)    │
        │ 3. Check       (Azure Policy)  │
        └───────────────┬────────────────┘
                        ▼
   Resource providers: Microsoft.Compute  Microsoft.Network  Microsoft.ContainerService
```

| Infrastructure as Code on Azure | What it is |
|---|---|
| **ARM templates** | JSON files describing resources (the original, verbose) |
| **Bicep** | Microsoft's simpler language that compiles to ARM JSON |
| **Terraform** (`azurerm` provider) | ✅ Most common in multi-cloud DevOps teams |

> **Interview one-liner:** "ARM is Azure's management layer; every portal, CLI or Terraform request goes through it for authentication, RBAC and Policy checks before a resource provider creates the resource."

---

## 9. Identities and Azure RBAC

**Definition:** **Azure RBAC** (role-based access control) decides **who** can do **what** on **which** resources. A **role assignment** has 3 parts: a **security principal** (who), a **role definition** (what actions), and a **scope** (where: management group, subscription, resource group or one resource). Assignments are inherited down the hierarchy.

### The 4 kinds of security principal (who)

| Principal | What it is | Example |
|---|---|---|
| **User** | A person in Entra ID | `alice@mycompany.com` |
| **Group** | A set of users | `devops-team` |
| **Service principal** | An identity for an app or tool (has a client ID + secret or certificate) | GitHub Actions / Jenkins deploying to Azure |
| **Managed identity** | A service principal that Azure creates and rotates for you, no secret to store | AKS cluster, a VM reading Key Vault |

### AWS access key + secret → Azure service principal

**Definition:** a **subscription is not a credential**: it's like an AWS account (where resources live and who pays). The Azure version of an AWS **access key ID + secret access key** is a **service principal** with a **client ID + client secret**. A script or pipeline uses it to log in, and its RBAC role decides what it can do.

| What you need | AWS | Azure |
|---|---|---|
| Where resources live / who pays | AWS account (12-digit ID) | **Subscription** (subscription ID, a GUID) |
| Organization's login directory | IAM / Identity Center | **Tenant** (tenant ID) |
| Login for a script or pipeline | IAM user → access key ID + secret access key | **Service principal** → client ID + client secret |
| Permissions for that login | IAM policy | **RBAC role** (e.g. Contributor) on a scope |
| Login for a person at the terminal | `aws configure` / `aws sso login` | `az login` (browser) |
| No-secret identity for a server | IAM role (instance profile) | **Managed identity** |

**AWS needs 2 values to log in, Azure usually needs 4:**

```
 AWS:    AWS_ACCESS_KEY_ID      +  AWS_SECRET_ACCESS_KEY      (+ region)

 Azure:  ARM_CLIENT_ID          ← service principal's "username" (appId)
         ARM_CLIENT_SECRET      ← service principal's "password"
         ARM_TENANT_ID          ← which directory to log in to
         ARM_SUBSCRIPTION_ID    ← which subscription to create resources in (not a secret)
```

**Create a service principal** (like creating an IAM user + access key):

```bash
az ad sp create-for-rbac --name sp-terraform --role Contributor --scopes /subscriptions/<subscription-id>
```

**Expected:** JSON with `appId` (client ID), `password` (client secret) and `tenant`. Azure shows the password **only once**, like an AWS secret key, so save it in a secret store right away.

**Log in with it:**

```bash
az login --service-principal -u <appId> -p <password> --tenant <tenant-id>
```

| | Lab / quick start | Production |
|---|---|---|
| Pipeline login | Service principal + client secret | ✅ **OIDC federated credential** (GitHub Actions, no secret stored), like an AWS IAM role with OIDC |
| Azure VM / AKS / Function login | Service principal secret in a config file ❌ | ✅ **Managed identity** |

> **Interview one-liner:** "A subscription is like an AWS account, not a credential. The Azure version of an access key/secret is a service principal's client ID + client secret, used with the tenant ID and subscription ID. In production use managed identities or OIDC federation instead of secrets."

### Built-in roles (what)

| Role | Can do |
|---|---|
| **Owner** | Everything, including giving access to others |
| **Contributor** | Create/change/delete everything, but **can't** give access |
| **Reader** | View only |
| **User Access Administrator** | Only manage access (role assignments) |

- **What happens:** assign `devops-team` = **Contributor** at scope `rg-shop-dev` → they can manage everything in that RG, nothing elsewhere.
- **Inheritance:** Reader at the subscription = Reader on every RG and resource in it.
- **What goes wrong:** giving Owner at subscription scope "to make it work" means that person can give anyone else access too. Use least privilege.

**Analogy:** a hotel key card. The card (role) opens certain doors (actions), only on certain floors (scope), for a certain guest (principal).

```
  Role assignment
  ┌─────────────────────┬─────────────────────┬──────────────────────────┐
  │ WHO (principal)     │ WHAT (role)         │ WHERE (scope)            │
  │ group: devops-team  │ Contributor         │ /subscriptions/../rg-shop-dev │
  └─────────────────────┴─────────────────────┴──────────────────────────┘
       Management group ─► Subscription ─► Resource group ─► Resource
       (assign high = applies to everything below)
```

| | Lab | Production |
|---|---|---|
| Your access | You are Owner of your free subscription | ✅ Least privilege, groups not individual users |
| CI/CD login | `az login` as yourself | ✅ Service principal with **OIDC federation** (no stored secret) or managed identity |

> **Interview one-liner:** "Azure RBAC = principal + role + scope; roles assigned at a higher scope are inherited below, and pipelines should use managed identities or OIDC-federated service principals instead of secrets."

---

## 10. Governance: tags, Azure Policy, resource locks

### Tags

**Definition:** a **tag** is a key-value label on a resource or resource group, for example `env=dev`, `owner=devops-team`, `costcenter=1234`. Tags help you **filter and split the bill** (Cost Management can group costs by tag). Tags on an RG are **not** inherited by its resources automatically (use Policy to enforce that).

### Azure Policy

**Definition:** **Azure Policy** is a set of rules that every resource must follow, checked by ARM when a resource is created or changed. Example rules: "only `eastus` and `centralindia` allowed", "every RG must have an `owner` tag", "no public IPs". Effects include **Deny** (block it), **Audit** (allow but report), **Modify** (fix it, e.g. add a tag) and **DeployIfNotExists**.

- RBAC = **who** can act; Policy = **what** the result must look like. A Contributor still can't create a VM in a denied region.

### Resource locks

**Definition:** a **resource lock** stops accidental deletes or changes, even by an Owner. **CanNotDelete** = you can change but not delete; **ReadOnly** = you can't change or delete. You must remove the lock first, then delete.

**Analogy:** tags are name stickers on boxes, Policy is the building code every new room must follow, and a lock is a padlock on a cupboard so nobody throws it away by mistake.

```
  Request: "create VM in westus, no tags"
        │
        ▼
  RBAC: are you allowed?  ──► yes (Contributor)
  Policy: allowed region? ──► ❌ DENY (only eastus/centralindia)

  Request: "delete rg-shop-prod"
  Lock: CanNotDelete       ──► ❌ blocked, even for Owner
```

| Tool | Answers | Example |
|---|---|---|
| **RBAC** | Who can do it? | devs = Reader on prod |
| **Policy** | Is the result allowed? | Deny regions outside eastus |
| **Lock** | Can it be deleted/changed at all? | CanNotDelete on prod database |
| **Tags** | Whose is it, what does it cost? | `env=prod owner=shop-team` |

> **Interview one-liner:** "RBAC controls who can act, Azure Policy controls what resources must look like, locks prevent accidental deletes, and tags organize resources and costs."

---

## 11. Azure vs AWS: service names

**Definition:** most Azure services have an AWS equivalent with a different name. Knowing the mapping lets you reuse everything you learned on AWS.

| Area | AWS | Azure |
|---|---|---|
| Account boundary | AWS account | **Subscription** |
| Multi-account management | AWS Organizations (OUs, SCPs) | **Management groups** + Azure Policy |
| Identity directory | IAM Identity Center | **Microsoft Entra ID** (tenant) |
| Grouping resources | Tags / CloudFormation stacks | **Resource groups** |
| Permissions | IAM policies / roles | **Azure RBAC** role assignments |
| Identity for a service | IAM role (instance profile) | **Managed identity** |
| Virtual machine | EC2 | **Virtual Machines** |
| Auto Scaling group | Auto Scaling group | **VM Scale Sets (VMSS)** |
| Private network | VPC | **Virtual Network (VNet)** |
| Firewall rules | Security group | **Network Security Group (NSG)** |
| Load balancer (L4 / L7) | NLB / ALB | **Azure Load Balancer / Application Gateway** |
| Object storage | S3 | **Blob Storage** (in a storage account) |
| Block disk | EBS | **Managed Disks** |
| Managed MySQL / SQL | RDS / Aurora | **Azure Database for MySQL / Azure SQL Database** |
| Secrets | Secrets Manager / KMS | **Key Vault** |
| DNS | Route 53 | **Azure DNS** |
| Monitoring / logs | CloudWatch | **Azure Monitor / Log Analytics** |
| IaC | CloudFormation | **ARM templates / Bicep** |
| Container registry | ECR | **Azure Container Registry (ACR)** |
| Managed Kubernetes | EKS | **AKS** |
| Pod → cloud permissions | IRSA / EKS Pod Identity | **Microsoft Entra Workload ID** |
| Database migration | DMS | **Azure Database Migration Service** |

> **Interview one-liner:** "Subscription ≈ AWS account, resource group has no direct AWS twin, VNet ≈ VPC, NSG ≈ security group, managed identity ≈ IAM role, AKS ≈ EKS, ACR ≈ ECR."

---

# Part 2: AKS concepts

## 12. What is AKS?

**Definition:** **Azure Kubernetes Service (AKS)** is Azure's managed Kubernetes service. Azure runs and patches the **control plane** (API server, etcd, scheduler, controller manager) for you, and you only manage the **worker nodes** and your workloads. On the Free tier the control plane costs nothing; you pay for the node VMs, disks, load balancers and public IPs.

- **What it is:** a normal, CNCF-certified Kubernetes cluster; the same `kubectl`, YAML, Helm and Argo CD you used on EKS work here.
- **What happens:** `az aks create` builds the control plane + a pool of VMs as nodes + networking in a few minutes.
- **Why:** running your own control plane (kubeadm) means handling etcd backups, certificates and upgrades yourself.

**Analogy:** renting a car with a driver-managed engine. Microsoft maintains the engine (control plane); you decide where to drive and what to carry (nodes and apps).

```
  ┌──────── Managed by Microsoft (hidden) ────────┐
  │  API server   etcd   scheduler   controllers  │
  └──────────────────────┬────────────────────────┘
                         │ (secure tunnel)
  ┌──────── In your subscription ─────────────────┐
  │  Node pool (VM Scale Set)                     │
  │   ┌────────┐  ┌────────┐  ┌────────┐          │
  │   │ node 1 │  │ node 2 │  │ node 3 │  ◄─ your Pods
  │   └────────┘  └────────┘  └────────┘          │
  └───────────────────────────────────────────────┘
```

| | Self-managed (kubeadm on VMs) | AKS |
|---|---|---|
| Control plane setup, etcd, certificates | You | ✅ Microsoft |
| Control plane cost | Your VMs | ✅ Free tier: $0 (Standard tier adds an SLA) |
| Upgrades | Manual, risky | ✅ `az aks upgrade` or auto-upgrade |

> **Interview one-liner:** "AKS is Azure's managed Kubernetes; Microsoft runs the control plane, I manage node pools and workloads, and on the Free tier I only pay for the nodes and other resources."

---

## 13. AKS architecture and the node resource group

**Definition:** when you create an AKS cluster, Azure creates **two resource groups**: the one you chose (it holds only the **cluster resource**) and a **node resource group** named `MC_<resource-group>_<cluster-name>_<region>` that holds the infrastructure AKS builds for the nodes: **VM Scale Sets, NICs, disks, the Azure Load Balancer, public IPs, NSG, route table and (if AKS created it) the VNet**.

- **What it is:** for our lab: you create `rg-day40-aks`, AKS creates `MC_rg-day40-aks_aks-day40_eastus`.
- **What happens:** when you create a `LoadBalancer` Service or a PVC, AKS adds the load balancer rule, public IP or disk **in the MC_ group**.
- **What goes wrong:** editing or deleting things in the `MC_` group by hand breaks the cluster. Treat it as AKS-owned. It's deleted automatically when you delete the cluster.

**Analogy:** you rent an apartment (your RG with the cluster); the building's plumbing and wiring room (MC_ group) belongs to the landlord. You use it, but you don't rewire it yourself.

```
  Subscription
   ├── rg-day40-aks                         ◄── you created this
   │     └── aks-day40   (Managed cluster)
   │
   └── MC_rg-day40-aks_aks-day40_eastus     ◄── AKS created this (don't touch)
         ├── aks-nodepool1-...-vmss  (VM Scale Set = the nodes)
         ├── kubernetes             (Azure Load Balancer)
         ├── kubernetes-xxxx        (public IP for a LoadBalancer Service)
         ├── aks-agentpool-...-nsg  (Network Security Group)
         ├── aks-vnet-...           (VNet, when AKS creates it)
         └── pvc-xxxx               (Managed Disk for a PVC)
```

| | EKS | AKS |
|---|---|---|
| Where node infra lives | Your VPC / account, mixed with your resources | ✅ Separate `MC_` node resource group |
| Node group backed by | EC2 Auto Scaling group | VM Scale Set (VMSS) |

> **Interview one-liner:** "AKS creates a separate node resource group (MC_…) holding the VMSS, load balancer, disks and NSG; it's managed by AKS and shouldn't be changed by hand."

---

## 14. Node pools: system vs user

**Definition:** a **node pool** is a group of nodes with the **same VM size, OS and settings**, backed by one **VM Scale Set**. AKS has 2 modes: a **system node pool** runs critical add-on Pods (CoreDNS, metrics-server, konnectivity agent), and **user node pools** run your application Pods. Every cluster needs at least one Linux system node pool.

- **System pool:** created with the cluster; at least 2 vCPU / 4 GB RAM per node; use 3 nodes across zones in production. Optional taint `CriticalAddonsOnly=true:NoSchedule` keeps app Pods off it.
- **User pools:** added later with `az aks nodepool add --mode User`; can be Linux or Windows, GPU, spot VMs, different sizes per workload.
- **What goes wrong:** running everything on the system pool means a noisy app can starve CoreDNS and break DNS for the whole cluster.

**Analogy:** a hospital. The system pool is the ICU staff that keeps the building alive; user pools are the regular wards. You don't put walk-in patients in the ICU.

```
  AKS cluster: aks-day40
  ┌── systempool (mode: System) ─────┐   ┌── userpool (mode: User) ────────┐
  │  coredns  metrics-server         │   │  nginx  shop-frontend  cart     │
  │  konnectivity  azure-cns         │   │                                  │
  │  VMSS: 2 x Standard_B2s          │   │  VMSS: 1-5 x Standard_D4s_v5    │
  └──────────────────────────────────┘   └──────────────────────────────────┘
```

| | Lab | Production |
|---|---|---|
| Pools | 1 system pool, apps run there too | ✅ System pool (tainted, 3 nodes, 3 zones) + user pools per workload |
| Scaling | Fixed node count | ✅ Cluster autoscaler min/max per pool |

> **Interview one-liner:** "AKS node pools are VM Scale Sets; the system pool runs critical add-ons like CoreDNS and user pools run applications, and in production they're separated."

---

## 15. AKS networking

**Definition:** the **network plugin** (CNI) decides **where Pod IP addresses come from** and how Pods talk to each other and to the VNet. AKS has 3 main options: **kubenet**, **Azure CNI** (flat, Pods get VNet IPs) and **Azure CNI Overlay** (Pods get IPs from a private overlay range). **Azure CNI Overlay** is the recommended choice for most new clusters.

| Plugin | Node IP from | Pod IP from | Good / bad |
|---|---|---|---|
| **kubenet** (basic) | VNet subnet | Separate range, routed with a route table | Saves VNet IPs, but extra hop; **being retired (March 2028)** |
| **Azure CNI** (flat) | VNet subnet | **Same VNet subnet** | Pods directly reachable from the VNet, but uses **a lot** of VNet IPs (plan a big subnet) |
| **Azure CNI Overlay** | VNet subnet | Private overlay CIDR (e.g. `10.244.0.0/16`) | ✅ Saves VNet IPs, good performance, up to 250 Pods per node; Pods leave the cluster via the node IP |

- **What happens (Overlay):** node `aks-nodepool1-0` gets `10.224.0.4` from the VNet; its Pods get `10.244.0.x` from the overlay; traffic leaving the cluster is SNAT-ed to the node IP.
- **Network policy:** add `--network-policy cilium` (with `--network-dataplane cilium`) or `calico` to use NetworkPolicy, same YAML as on EKS.
- **Services:** a `type: LoadBalancer` Service gets a frontend IP on the **Azure Standard Load Balancer** in the `MC_` group. For HTTP routing use an Ingress / Gateway API controller (**Application Gateway for Containers** or the AKS **application routing add-on**).

**Analogy:** flat Azure CNI gives every Pod its own street address in the city (uses many addresses). Overlay gives Pods flat numbers inside a building, and the building's street address is used for outside mail.

```
  Azure CNI Overlay
  VNet 10.224.0.0/16
  ┌──────── node 1: 10.224.0.4 ────────┐   ┌──────── node 2: 10.224.0.5 ────────┐
  │  pod 10.244.0.10   pod 10.244.0.11 │   │  pod 10.244.1.10   pod 10.244.1.11 │
  └─────────────────┬──────────────────┘   └─────────────────┬──────────────────┘
                    └────────── pod-to-pod: direct ──────────┘
  Pod → internet / VNet: SNAT to the node IP
  Internet → Pod:  Azure Load Balancer (public IP) ──► Service ──► Pods
```

| | Lab | Production |
|---|---|---|
| Plugin | Azure CNI Overlay | ✅ Azure CNI Overlay (or flat Azure CNI if Pods must be directly routable) |
| VNet | Created by AKS | ✅ Your own VNet (bring your own subnet), planned CIDRs, private cluster |
| Network policy | None | ✅ Cilium or Calico, default deny |

> **Interview one-liner:** "AKS supports kubenet, Azure CNI and Azure CNI Overlay; Overlay is the default choice today because Pods get IPs from a private range so you don't burn VNet addresses."

---

## 16. AKS identity and access

**Definition:** AKS uses identities at 4 places: the **cluster identity** (a managed identity AKS uses to create load balancers, disks, etc.), the **kubelet identity** (used by nodes, for example to pull from ACR), **user access** to the cluster (Entra ID + RBAC), and **workload identity** (Pods calling Azure services without secrets).

### a. Cluster and kubelet managed identities

- AKS creates a **system-assigned managed identity** for the control plane and a **kubelet identity** in the `MC_` group. No service principal secrets to rotate.
- **ACR:** `az aks update --attach-acr <acr-name>` gives the kubelet identity the **AcrPull** role on the registry, so nodes pull private images without `imagePullSecrets` (like the EKS node role + ECR).

### b. Users: Entra ID + RBAC

| Option | Who logs in | Who authorizes |
|---|---|---|
| Local accounts (default) | Certificate in kubeconfig | Kubernetes RBAC |
| **Entra ID integration** | ✅ Company Entra ID users (`kubelogin`) | Kubernetes RBAC (bind Entra groups) |
| **Entra ID + Azure RBAC for Kubernetes** | ✅ Entra ID users | Azure roles like *Azure Kubernetes Service RBAC Reader / Writer / Admin / Cluster Admin* |

- **Getting kubeconfig:** `az aks get-credentials` needs the Azure role *Azure Kubernetes Service Cluster User Role* (or Admin role for `--admin`).
- **Production:** `--enable-aad --enable-azure-rbac --disable-local-accounts` so every login goes through Entra ID.

### c. Microsoft Entra Workload ID (Pods → Azure services)

**Definition:** **workload identity** lets a Pod get Azure access tokens using its **Kubernetes ServiceAccount**, through OIDC federation: no client secret in the Pod. It's the AKS version of **IRSA / EKS Pod Identity**.

1. Turn on `--enable-oidc-issuer --enable-workload-identity` on the cluster.
2. Create a **user-assigned managed identity** and give it a role (e.g. *Key Vault Secrets User*).
3. Add a **federated credential** on that identity: "trust ServiceAccount `shop/cart-sa` from this cluster's OIDC issuer".
4. Annotate the ServiceAccount `azure.workload.identity/client-id: <client-id>` and label the Pod `azure.workload.identity/use: "true"`.

**Analogy:** the cluster's OIDC issuer is a trusted notary. The Pod shows its notarized ServiceAccount letter to Entra ID and gets a short-lived badge, instead of carrying a permanent master key.

```
  Pod (ServiceAccount cart-sa)
     │ 1. projected SA token (signed by the cluster OIDC issuer)
     ▼
  Microsoft Entra ID ── checks federated credential: issuer + "system:serviceaccount:shop:cart-sa"
     │ 2. short-lived Azure access token
     ▼
  Key Vault / Storage / SQL   (allowed by the managed identity's RBAC role)
```

| | EKS | AKS |
|---|---|---|
| Pod → cloud | IRSA / EKS Pod Identity | Microsoft Entra Workload ID |
| Node → registry | Node IAM role + ECR | Kubelet identity + `--attach-acr` (AcrPull) |
| User login | IAM + access entries | Entra ID + Azure RBAC |

> **Interview one-liner:** "AKS uses managed identities for the cluster and kubelet, Entra ID with Azure RBAC for users, and Entra Workload ID (OIDC federation, like IRSA) so Pods reach Azure services without secrets."

---

## 17. Storage, scaling and pricing tiers

### Storage

**Definition:** AKS ships **CSI drivers** and ready **StorageClasses**: `managed-csi` (the `default` class, **Azure Disk**, ReadWriteOnce, one node at a time) and `azurefile-csi` (**Azure Files**, ReadWriteMany, shared by many Pods). An Azure Disk is **zonal** (stuck in one zone), exactly like an EBS volume, so a StatefulSet Pod must come back in the same zone as its disk.

| StorageClass | Backed by | Access | Use for |
|---|---|---|---|
| `managed-csi` (`default`) | Azure Disk (Standard SSD) | RWO, zonal | Databases, StatefulSets |
| `managed-csi-premium` | Azure Disk (Premium SSD) | RWO, zonal | Busy production databases |
| `azurefile-csi` | Azure Files (SMB/NFS) | RWX | Shared uploads, many Pods reading the same files |

### Scaling

| What | How on AKS | EKS equivalent |
|---|---|---|
| Pods | HPA (`kubectl autoscale`), **KEDA add-on** for events | HPA / KEDA |
| Nodes | **Cluster autoscaler** per pool: `--enable-cluster-autoscaler --min-count 1 --max-count 5` | Cluster Autoscaler |
| Nodes (smart) | **Node auto-provisioning** (built on Karpenter) | Karpenter |
| Manual | `az aks scale` / `az aks nodepool scale` | `eksctl scale nodegroup` |

### Pricing tiers (control plane)

| Tier | Control plane cost | SLA | Use for |
|---|---|---|---|
| **Free** | $0 | No financially backed SLA | Learning, dev/test, small clusters |
| **Standard** | Paid per cluster-hour | ✅ Uptime SLA (99.95% with zones) | Production |
| **Premium** | Standard + extra | ✅ SLA + Long-Term Support (2-year Kubernetes versions) | Teams that can't upgrade often |

Nodes, disks, load balancers and public IPs are paid in every tier. Cost saver for labs: `az aks stop` stops the whole cluster (nodes deallocated) and `az aks start` brings it back with the same state.

> **Interview one-liner:** "AKS gives Azure Disk (RWO, zonal like EBS) and Azure Files (RWX) via CSI, scales with HPA/KEDA and the cluster autoscaler, and the control plane is free on the Free tier or SLA-backed on Standard."

---

## 18. Built-in add-ons: no Helm installs

**Definition:** an **AKS add-on** (or managed extension) is a tool that Microsoft installs, configures, patches and upgrades **for you** inside the cluster. You turn it on with a **checkbox** in the portal (the *Integrations*, *Monitoring* and *Security* tabs of "Create Kubernetes cluster") or one `az aks` flag. You don't run `helm install`, and you don't maintain the tool yourself.

- **What it is:** Prometheus, Grafana, Istio, KEDA, Azure Policy, Key Vault CSI, ingress and backup are all available as ready-made options.
- **What happens:** tick "Enable Prometheus metrics" + "Enable Grafana" → AKS deploys the metrics agents (`ama-metrics` Pods), sends data to an **Azure Monitor workspace**, and the portal shows ready dashboards under **Monitoring → Dashboards with Grafana**.
- **What to watch:** the tool is managed but **not free**: Managed Grafana, Azure Monitor data ingestion and Defender are billed. You also get only the versions Microsoft supports (e.g. Istio revision `asm-1-xx`).

**Analogy:** buying a car with factory-fitted GPS, dashcam and parking sensors, instead of buying each one separately and wiring it in yourself. The garage (Microsoft) also services them.

```
  EKS labs (what we did before)            AKS
  ─────────────────────────────            ─────────────────────────────
  helm install kube-prometheus-stack   ►   ☑ Enable Prometheus metrics
  helm install grafana                 ►   ☑ Enable Grafana
  istioctl install                     ►   ☑ Enable Istio
  helm install keda                    ►   ☑ Enable KEDA add-on
  helm install kyverno                 ►   ☑ Azure Policy
  helm install aws-load-balancer-ctrl  ►   ☑ App routing / App Gateway for Containers
  You upgrade + patch each one         ►   Microsoft upgrades + patches them
```

| Tool | Portal (where) | CLI flag | What you'd do on EKS |
|---|---|---|---|
| **ACR** (private registry) | Integrations → Container registry | `--attach-acr <acr>` | Node IAM role + ECR |
| **Istio** service mesh | Integrations → Service mesh, Istio | `az aks mesh enable` | `istioctl install` / Helm |
| **Azure Policy** (Gatekeeper) | Integrations → Azure Policy | `--enable-addons azure-policy` | Helm install Kyverno/Gatekeeper |
| **Managed Prometheus** | Monitoring → Enable Prometheus metrics | `--enable-azure-monitor-metrics` | Helm kube-prometheus-stack or AMP |
| **Managed Grafana** | Monitoring → Enable Grafana | `--grafana-resource-id <id>` (with the flag above) | Helm Grafana or AMG |
| **Container Insights** (logs) | Monitoring → Container logs | `--enable-addons monitoring` | CloudWatch agent / Fluent Bit |
| **Network observability** (ACNS) | Monitoring → Container Network Observability | `--enable-acns` | Cilium Hubble yourself |
| **KEDA** (event autoscaling) | Settings → Application scaling | `--enable-keda` | Helm install KEDA |
| **Key Vault secrets** (CSI) | Security / Add-ons | `--enable-addons azure-keyvault-secrets-provider` | Helm Secrets Store CSI + AWS provider |
| **Ingress** (managed NGINX) | Networking → App routing | `--enable-app-routing` | Helm AWS Load Balancer Controller |
| **Defender for Containers** | Security | `--enable-defender` | GuardDuty EKS / third-party |
| **Backup** | Settings → Backup | AKS Backup extension + Backup vault | Velero |

**The portal also gives you, without installing anything:**

| Portal blade | Replaces |
|---|---|
| **Kubernetes resources** → Workloads, Services, Storage, Events | `kubectl get` / `kubectl get events` |
| **Events** with a **Troubleshoot** button on warnings (FailedScheduling, Unhealthy probe…) | Reading `kubectl describe` yourself |
| **Run command** | `kubectl` from your laptop (works even for private clusters) |
| **Diagnose and solve problems** | Manual checks of nodes, DNS, networking |
| **Cost analysis** | Separate cost tools (Kubecost) |

| | Self-installed with Helm (EKS labs) | AKS add-on |
|---|---|---|
| Install | You run Helm, write values | ✅ Checkbox / one flag |
| Upgrades + security patches | You | ✅ Microsoft |
| Support | Community | ✅ Microsoft support |
| Version and config choice | ✅ Any version, full control | Only supported versions, fewer knobs |
| Cost | Only the Pods' resources | Managed services billed (Grafana, Monitor ingestion) |

> **Interview one-liner:** "On AKS, tools like Managed Prometheus, Managed Grafana, Istio, KEDA, Azure Policy and Key Vault CSI are built-in add-ons you enable with a checkbox or one flag, and Microsoft upgrades and supports them, instead of installing and maintaining them with Helm like on EKS."

---

## 19. EKS vs AKS

| Topic | EKS (AWS) | AKS (Azure) |
|---|---|---|
| Control plane price | Paid per cluster-hour | ✅ Free tier $0 (Standard tier for SLA) |
| Create with | `eksctl` / Terraform / console | `az aks create` / Terraform / Bicep / portal |
| Nodes | Managed node groups (EC2 ASG), Fargate, Karpenter | Node pools (VMSS), virtual nodes (ACI), node auto-provisioning |
| Node infra location | Your VPC | `MC_` node resource group |
| Networking | VPC CNI (Pods get VPC IPs) | Azure CNI / **Azure CNI Overlay** / kubenet |
| L7 ingress | AWS Load Balancer Controller → ALB | Application Gateway for Containers / app routing add-on |
| Registry | ECR | ACR (`--attach-acr`) |
| User auth | IAM → access entries | Entra ID → Kubernetes RBAC or Azure RBAC |
| Pod → cloud | IRSA / Pod Identity | Entra Workload ID |
| Secrets | Secrets Manager + CSI driver | Key Vault + Secrets Store CSI driver add-on |
| Monitoring | CloudWatch Container Insights, AMP + AMG | Azure Monitor Container Insights, Managed Prometheus + Managed Grafana |
| Extra tools (Prometheus, Istio, KEDA, policy) | Mostly installed by you with Helm | ✅ Built-in add-ons: checkbox / one flag |
| Kubeconfig | `aws eks update-kubeconfig` | `az aks get-credentials` |

> **Interview one-liner:** "EKS and AKS are both managed Kubernetes; the main differences are the free AKS control plane tier, VMSS node pools in a separate MC_ resource group, Azure CNI Overlay networking, and Entra ID instead of IAM for identity."

---

# Part 3: Lab

## 20. Lab overview

We build a small AKS cluster from an Ubuntu laptop/terminal with the Azure CLI, deploy nginx, expose it on the internet with an Azure Load Balancer, add a user node pool, then delete everything.

```
  Laptop (Ubuntu) ── az CLI ──► Azure Resource Manager
                                   │
  Subscription ── rg-day40-aks ── aks-day40 (Free tier)
                    │
                    └── MC_rg-day40-aks_aks-day40_eastus
                          ├── VMSS: 2 x Standard_B2s (system pool)
                          ├── VMSS: 1 x Standard_B2s (user pool)
                          └── Azure Load Balancer + public IP ──► nginx Pods
                                        ▲
  Browser / curl ───────────────────────┘
```

| Item | Value in this lab |
|---|---|
| Region | `eastus` |
| Resource group | `rg-day40-aks` |
| Cluster | `aks-day40`, Free tier, Azure CNI Overlay |
| System pool | 2 x `Standard_B2s` (2 vCPU, 4 GB) |
| User pool | 1 x `Standard_B2s` |
| App | nginx Deployment (3 replicas) + `LoadBalancer` Service |

**Before you start:** you need an Azure account. If you don't have one, sign up for the Azure free account (it comes with $200 credit for 30 days). **Cost:** you pay for the node VMs, disks, load balancer and public IP while they run, so finish the lab and do Step 10 the same day.

---

## 21. Step 1: Install the Azure CLI and log in

### 1a. Install the Azure CLI (Ubuntu/Debian)

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**What it does:** adds Microsoft's apt repository and installs the `az` command.
**Expected:** finishes without errors.

### 1b. Check the version

```bash
az version
```

**Expected:** JSON with `"azure-cli": "2.x.x"`.

### 1c. Log in

```bash
az login
```

**What it does:** opens a browser to sign in with your Microsoft account (the tenant), then saves a token in `~/.azure/`. On a server with no browser, use `az login --use-device-code` and enter the code on another device.
**Expected:** a list of the subscriptions you can access.

---

## 22. Step 2: Pick the subscription

### 2a. List your subscriptions

```bash
az account list --output table
```

**Expected:** a table with `Name`, `SubscriptionId`, `TenantId`, `IsDefault`.

### 2b. Select the one to use

```bash
az account set --subscription "<subscription-name-or-id>"
```

**What it does:** every following `az` command creates resources in this subscription (this is where the bill goes).

### 2c. Confirm the tenant and subscription

```bash
az account show --query "{tenant:tenantId, subscription:name, user:user.name}" --output table
```

**Expected:** your tenant ID, subscription name and login. This is the top of the hierarchy from Part 1.

### 2d. Register the AKS resource provider

New subscriptions may not have the AKS provider registered yet.

```bash
az provider register --namespace Microsoft.ContainerService
```

```bash
az provider show --namespace Microsoft.ContainerService --query registrationState --output tsv
```

**Expected:** `Registered` (it can show `Registering` for a minute or two; run it again).

---

## 23. Step 3: Create the resource group

```bash
az group create --name rg-day40-aks --location eastus --tags env=lab owner=devops
```

**What it does:** creates the folder for this lab, with tags so it shows up in cost reports.
**Expected:** JSON with `"provisioningState": "Succeeded"`.

```bash
az group list --output table
```

**Expected:** `rg-day40-aks` in `eastus`.

---

## 24. Step 4: Create the AKS cluster

### 4a. Install kubectl (and kubelogin)

```bash
sudo az aks install-cli
```

**What it does:** installs `kubectl` and `kubelogin` (needed later for Entra ID logins). Skip if you already have `kubectl` from the EKS labs.

### 4b. Create the cluster

```bash
az aks create \
  --resource-group rg-day40-aks \
  --name aks-day40 \
  --tier free \
  --node-count 2 \
  --node-vm-size Standard_B2s \
  --network-plugin azure \
  --network-plugin-mode overlay \
  --generate-ssh-keys
```

**What it does:**

| Flag | Meaning |
|---|---|
| `--tier free` | Free control plane, no SLA (fine for a lab) |
| `--node-count 2` | 2 nodes in the default **system** node pool `nodepool1` |
| `--node-vm-size Standard_B2s` | 2 vCPU / 4 GB, the smallest size allowed for a system pool |
| `--network-plugin azure --network-plugin-mode overlay` | Azure CNI Overlay (section 15) |
| `--generate-ssh-keys` | Uses `~/.ssh/id_rsa.pub` for node SSH, creating it if it doesn't exist |

**Expected:** takes about 5–10 minutes, then prints JSON with `"provisioningState": "Succeeded"`.

### 4c. Check the cluster

```bash
az aks list --output table
```

**Expected:** `aks-day40` in `eastus`, `ProvisioningState` = `Succeeded`, plus the Kubernetes version.

---

## 25. Step 5: Connect with kubectl

### 5a. Download the kubeconfig

```bash
az aks get-credentials --resource-group rg-day40-aks --name aks-day40
```

**What it does:** merges the cluster's credentials into `~/.kube/config` and switches the context to `aks-day40`. This is the AKS version of `aws eks update-kubeconfig`.

### 5b. See the nodes

```bash
kubectl get nodes -o wide
```

**Expected:** 2 nodes named like `aks-nodepool1-12345678-vmss000000`, `STATUS Ready`, `INTERNAL-IP` from the VNet (e.g. `10.224.0.4`). The `vmss` in the name shows they are VM Scale Set instances.

### 5c. See the system Pods

```bash
kubectl get pods -n kube-system
```

**Expected:** `coredns`, `metrics-server`, `konnectivity-agent`, `azure-cns`, `cloud-node-manager`, `csi-azuredisk-node`, `csi-azurefile-node`, `kube-proxy`… all `Running`. No API server, etcd or scheduler Pods: the control plane is managed by Microsoft and hidden.

### 5d. See the node pool mode

```bash
az aks nodepool list --resource-group rg-day40-aks --cluster-name aks-day40 --output table
```

**Expected:** `nodepool1` with `Mode` = `System`, `Count` = 2.

---

## 26. Step 6: Look at the node resource group

### 6a. Get its name

```bash
az aks show --resource-group rg-day40-aks --name aks-day40 --query nodeResourceGroup --output tsv
```

**Expected:** `MC_rg-day40-aks_aks-day40_eastus`.

### 6b. List what AKS built

```bash
az resource list --resource-group MC_rg-day40-aks_aks-day40_eastus --output table
```

**Expected:** a VM Scale Set (`aks-nodepool1-...-vmss`), a load balancer `kubernetes`, a public IP (for outbound traffic), an NSG, a VNet `aks-vnet-...`, a route table and managed identities. Look but don't change anything here (section 13).

---

## 27. Step 7: Deploy nginx with a LoadBalancer Service

### 7a. Create the manifest

```bash
vim nginx-aks.yaml
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:1.27
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: nginx
spec:
  type: LoadBalancer
  selector:
    app: nginx
  ports:
    - port: 80
      targetPort: 80
```

**What it does:** 3 nginx Pods, and a `LoadBalancer` Service. On AKS this makes the cloud controller add a public IP + rule on the Azure Standard Load Balancer `kubernetes` in the `MC_` group.

### 7b. Apply it

```bash
kubectl apply -f nginx-aks.yaml
```

**Expected:** `deployment.apps/nginx created` and `service/nginx created`.

### 7c. Check the Pods and their overlay IPs

```bash
kubectl get pods -o wide
```

**Expected:** 3 Pods `Running`, with IPs from the overlay range like `10.244.0.x` / `10.244.1.x`, different from the node IPs (`10.224.0.x`). That's Azure CNI Overlay.

### 7d. Wait for the public IP

```bash
kubectl get svc nginx --watch
```

**Expected:** `EXTERNAL-IP` changes from `<pending>` to a public IP like `20.121.45.10` in about 1–2 minutes. Press `Ctrl+C`.

### 7e. Test it

```bash
curl http://<EXTERNAL-IP>
```

**Expected:** the HTML of the "Welcome to nginx!" page. You can also open it in a browser.

### 7f. See the new public IP in Azure

```bash
az network public-ip list --resource-group MC_rg-day40-aks_aks-day40_eastus --output table
```

**Expected:** a new public IP named `kubernetes-<id>` with the same address as `EXTERNAL-IP`. Kubernetes created an Azure resource for you.

---

## 28. Step 8: Add a user node pool

This adds 2 more vCPUs. On a free trial the regional vCPU quota is small; if you get a quota error, skip this step (see Troubleshooting).

### 8a. Add the pool

```bash
az aks nodepool add \
  --resource-group rg-day40-aks \
  --cluster-name aks-day40 \
  --name userpool \
  --mode User \
  --node-count 1 \
  --node-vm-size Standard_B2s \
  --labels workload=apps
```

**What it does:** creates a second VM Scale Set as a **User** pool, with the node label `workload=apps` so apps can target it.
**Expected:** `"provisioningState": "Succeeded"` after a few minutes.

### 8b. Check both pools

```bash
az aks nodepool list --resource-group rg-day40-aks --cluster-name aks-day40 --output table
```

**Expected:** `nodepool1` (System, 2) and `userpool` (User, 1).

### 8c. Move nginx to the user pool

```bash
kubectl patch deployment nginx -p '{"spec":{"template":{"spec":{"nodeSelector":{"workload":"apps"}}}}}'
```

**What it does:** adds a `nodeSelector` so new nginx Pods only go to nodes with `workload=apps`.

```bash
kubectl get pods -o wide
```

**Expected:** all 3 nginx Pods now on the `aks-userpool-...` node. `curl http://<EXTERNAL-IP>` still works.

---

## 29. Step 9: Turn on built-in add-ons (KEDA + Managed Prometheus)

No Helm here: each tool is one `az aks update` flag (section 18). In the portal it's the same checkbox you see on the cluster's *Application scaling* and *Monitoring* pages.

### 9a. Enable KEDA

```bash
az aks update --resource-group rg-day40-aks --name aks-day40 --enable-keda
```

**What it does:** AKS installs the KEDA operator and keeps it upgraded.

```bash
kubectl get pods -n kube-system | grep keda
```

**Expected:** `keda-operator`, `keda-operator-metrics-apiserver` and `keda-admission-webhooks` Pods `Running`.

### 9b. Enable Managed Prometheus

```bash
az aks update --resource-group rg-day40-aks --name aks-day40 --enable-azure-monitor-metrics
```

**What it does:** deploys the Azure Monitor metrics agent and sends Prometheus metrics to an **Azure Monitor workspace**. With no workspace given, Azure creates a default one in a `DefaultResourceGroup-<region>` resource group (in the portal you'd see something like `defaultazuremonitorworkspace-eus`).

```bash
kubectl get pods -n kube-system | grep ama-metrics
```

**Expected:** `ama-metrics-...` and `ama-metrics-node-...` Pods `Running`.

### 9c. See the dashboards

In the portal open **aks-day40 → Monitoring → Dashboards with Grafana** and pick *Kubernetes / Compute Resources / Pod*. **Expected:** CPU and memory charts for your Pods, with no Grafana installed by you. A full **Managed Grafana** workspace (`--grafana-resource-id`) is optional and billed separately, so we skip it in the lab.

---

## 30. Step 10: Stop and start the cluster

A useful cost saver when you pause a lab for a day.

### 10a. Stop it

```bash
az aks stop --resource-group rg-day40-aks --name aks-day40
```

**What it does:** stops the control plane and deallocates all nodes; VM compute billing stops (disks and public IPs are still charged).

```bash
az aks show --resource-group rg-day40-aks --name aks-day40 --query powerState.code --output tsv
```

**Expected:** `Stopped`.

### 10b. Start it again

```bash
az aks start --resource-group rg-day40-aks --name aks-day40
```

**Expected:** `powerState` = `Running` after a few minutes; `kubectl get pods` shows nginx back.

---

## 31. Step 11: Clean up

### 11a. Delete the resource group

```bash
az group delete --name rg-day40-aks --yes --no-wait
```

**What it does:** deletes the RG and everything in it. Deleting the cluster also deletes the `MC_` node resource group (VMSS, load balancer, public IPs, disks). `--no-wait` returns immediately while Azure deletes in the background (5–10 minutes).

### 11b. Confirm it's gone

```bash
az group list --output table
```

**Expected:** no `rg-day40-aks` and no `MC_rg-day40-aks_aks-day40_eastus`. If Step 9b created a `DefaultResourceGroup-EUS` (Azure Monitor workspace), list what's inside it with `az resource list --resource-group DefaultResourceGroup-EUS --output table`. If only this lab's monitoring resources are there, delete it with `az group delete --name DefaultResourceGroup-EUS --yes`. You may also see `NetworkWatcherRG`: Azure creates it automatically when a VNet is created in a region; it's free and can stay.

### 11c. Remove the old kubectl context

```bash
kubectl config delete-context aks-day40
```

---

## 32. Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `MissingSubscriptionRegistration ... Microsoft.ContainerService` | AKS provider not registered | Step 2d, wait for `Registered` |
| `Operation could not be completed as it results in exceeding approved ... Cores quota` | Subscription vCPU quota too small (free trial) | Use fewer/smaller nodes, skip Step 8, or request a quota increase (portal → Quotas) |
| `The VM size of Standard_B2s is not allowed in your subscription in location 'eastus'` | Size not available in that region/subscription | Run `az vm list-skus --location eastus --size Standard_B --output table`, or use `Standard_D2s_v5`, or another region |
| `kubectl` says `Unable to connect to the server` | Wrong context or cluster stopped | `kubectl config current-context`; `az aks show ... --query powerState`; rerun `az aks get-credentials` |
| `EXTERNAL-IP` stays `<pending>` | Load balancer / public IP still being created, or public IP quota | Wait 2–3 minutes; `kubectl describe svc nginx` → check Events |
| Pods `Pending` after the patch in Step 8c | No node with `workload=apps` (user pool not ready) | `kubectl get nodes --show-labels`; wait for `userpool` to be `Ready` |

---

# Part 4: Production

## 33. Production-grade AKS checklist

| Area | Production setting | Flag / tool |
|---|---|---|
| **SLA** | Standard tier | `--tier standard` |
| **High availability** | Nodes across 3 zones | `--zones 1 2 3` |
| **Node pools** | Tainted system pool (3 nodes) + separate user pools | `--nodepool-taints CriticalAddonsOnly=true:NoSchedule`, `az aks nodepool add --mode User` |
| **Autoscaling** | Cluster autoscaler + HPA/KEDA | `--enable-cluster-autoscaler --min-count --max-count` |
| **Network** | Own VNet/subnet, Azure CNI Overlay, Cilium network policy, default deny | `--vnet-subnet-id`, `--network-policy cilium` |
| **API server access** | Private cluster or authorized IP ranges | `--enable-private-cluster` / `--api-server-authorized-ip-ranges` |
| **User access** | Entra ID + Azure RBAC, no local accounts | `--enable-aad --enable-azure-rbac --disable-local-accounts` |
| **Pod identity** | Workload identity, no secrets in Pods | `--enable-oidc-issuer --enable-workload-identity` |
| **Secrets** | Key Vault via Secrets Store CSI driver | `--enable-addons azure-keyvault-secrets-provider` |
| **Images** | Private ACR, scanned and signed, AcrPull via kubelet identity | `--attach-acr`, Defender for Containers |
| **Guardrails** | Azure Policy add-on (Gatekeeper) or Kyverno | `--enable-addons azure-policy` |
| **Monitoring** | Container Insights + Managed Prometheus + Managed Grafana | `--enable-azure-monitor-metrics` |
| **Upgrades** | Auto-upgrade channel + planned maintenance window | `--auto-upgrade-channel patch`, `az aks maintenanceconfiguration` |
| **IaC + GitOps** | Terraform for the cluster, Argo CD / Flux for apps | `azurerm_kubernetes_cluster` |
| **Governance** | Separate prod subscription, tags, CanNotDelete lock on the prod RG | `az lock create --lock-type CanNotDelete` |

> **Interview one-liner:** "Production AKS = Standard tier across 3 zones, separate system/user pools with autoscaling, private API, Entra ID + Azure RBAC, workload identity with Key Vault, private ACR, Azure Policy, Managed Prometheus, and everything in Terraform + GitOps."

---

# Wrap-up

## 34. What I learned

**Azure basics**
- Azure hierarchy: **tenant (Entra ID) → management groups → subscriptions → resource groups → resources**, with RBAC and Policy inherited downward.
- **Tenant** = who you are; **subscription** = who pays and the access boundary (≈ AWS account); **resource group** = a folder that shares a lifecycle.
- Every request goes through **ARM**, which checks Entra ID, RBAC and Policy.
- **RBAC** = principal + role + scope; **Policy** = what's allowed; **locks** = no accidental delete; **tags** = ownership and cost.

**AKS**
- Microsoft runs the control plane (free on the Free tier); nodes are **VM Scale Sets** in a separate **MC_** resource group.
- **System pool** for CoreDNS & co., **user pools** for apps.
- **Azure CNI Overlay**: nodes get VNet IPs, Pods get overlay IPs.
- Identity: managed identities for the cluster/kubelet, Entra ID for users, **Workload ID** for Pods (≈ IRSA).
- **Built-in add-ons**: Prometheus, Grafana, Istio, KEDA, Azure Policy, Key Vault CSI are a checkbox / one flag, managed by Microsoft. No Helm installs like on EKS.

**Lab**
- `az login` → `az group create` → `az aks create` → `az aks get-credentials` → `kubectl apply` → LoadBalancer public IP → `az aks nodepool add` → `--enable-keda` / `--enable-azure-monitor-metrics` → `az aks stop/start` → `az group delete`.

```
  az login ─► subscription ─► rg-day40-aks ─► aks-day40 ─► kubectl ─► nginx + LB ─► delete RG
```

---

## 35. Commands

| Command | What it does |
|---|---|
| `az login` | Sign in to your tenant |
| `az account list -o table` / `az account set --subscription <id>` | List / select subscription |
| `az provider register --namespace Microsoft.ContainerService` | Enable AKS in the subscription |
| `az group create -n <rg> -l <region>` | Create a resource group |
| `az aks create -g <rg> -n <cluster> ...` | Create an AKS cluster |
| `az aks get-credentials -g <rg> -n <cluster>` | Write kubeconfig |
| `az aks show -g <rg> -n <cluster> --query nodeResourceGroup -o tsv` | Get the MC_ group name |
| `az aks nodepool add/list/scale/delete` | Manage node pools |
| `az aks get-upgrades` / `az aks upgrade --kubernetes-version <v>` | See / do upgrades |
| `az aks update --attach-acr <acr>` | Let nodes pull from ACR |
| `az aks update --enable-keda` / `--enable-azure-monitor-metrics` | Turn on built-in add-ons |
| `az aks mesh enable` | Turn on the Istio add-on |
| `az aks stop` / `az aks start` | Pause / resume the cluster |
| `az group delete -n <rg> --yes --no-wait` | Delete everything in the RG |

---

## 36. Interview Questions

### Other Questions

**Q1. Explain the Azure resource hierarchy.**
Tenant (Microsoft Entra ID) → management groups → subscriptions → resource groups → resources. RBAC role assignments and Azure Policy set at a higher level are inherited by all levels below.

**Q2. What is the difference between a tenant and a subscription?**
A tenant is the organization's identity directory (users, groups, apps) in Entra ID; it answers "who are you". A subscription is a billing and access boundary where resources are created; it answers "where and who pays". One tenant can have many subscriptions; each subscription trusts exactly one tenant.

**Q3. What is a resource group, and what happens when you delete one?**
A logical container for resources that share a lifecycle. Every resource is in exactly one RG. Deleting the RG deletes every resource inside it, unless a resource lock blocks it.

**Q4. Can resources in a resource group be in different regions?**
Yes. The RG location only stores its metadata; its resources can be in any region.

**Q5. What are management groups used for?**
To group subscriptions and apply RBAC and Azure Policy once for all of them, for example a "only these regions" policy on the Production management group.

**Q6. Azure RBAC vs Azure Policy?**
RBAC controls **who** can perform actions at a scope. Policy controls **what** the resulting resources must look like (allowed regions, required tags, no public IPs), no matter who creates them.

**Q7. Owner vs Contributor?**
Both can manage all resources; only Owner can assign roles to others. Contributor cannot grant access.

**Q8. Service principal vs managed identity?**
Both are app identities in Entra ID. A service principal needs a secret or certificate that you store and rotate. A managed identity is created and rotated by Azure and is tied to an Azure resource (VM, AKS, Function), so there is no secret to manage.

**Q8b. Is a subscription the Azure version of AWS access keys?**
No. A subscription is like an AWS account. The Azure version of an access key + secret is a service principal's client ID + client secret. Logging in also needs the tenant ID, and the subscription ID picks where resources are created (e.g. `ARM_CLIENT_ID`, `ARM_CLIENT_SECRET`, `ARM_TENANT_ID`, `ARM_SUBSCRIPTION_ID` for Terraform).

**Q9. What is the MC_ resource group in AKS?**
The node resource group AKS creates (`MC_<rg>_<cluster>_<region>`). It holds the VM Scale Sets, load balancer, public IPs, disks, NSG and route table. It's managed by AKS; don't change it by hand. It's deleted with the cluster.

**Q10. System node pool vs user node pool?**
The system pool runs critical add-ons (CoreDNS, metrics-server, konnectivity) and must exist (Linux). User pools run application workloads. In production you taint the system pool with `CriticalAddonsOnly=true:NoSchedule` and run apps on user pools.

**Q11. kubenet vs Azure CNI vs Azure CNI Overlay?**
kubenet: Pods get IPs from a separate range with route tables (being retired). Azure CNI: Pods get real VNet IPs (directly routable but uses many IPs). Azure CNI Overlay: Pods get IPs from a private overlay CIDR, nodes from the VNet; saves IP space and is the recommended default.

**Q12. How does an AKS Pod access Key Vault without a secret?**
With Microsoft Entra Workload ID: enable the OIDC issuer and workload identity on the cluster, create a user-assigned managed identity with a Key Vault role, add a federated credential for the Pod's ServiceAccount, annotate the ServiceAccount with the identity's client ID, and label the Pod. The Pod exchanges its ServiceAccount token for a short-lived Entra token. It's the AKS version of IRSA.

**Q13. How do AKS nodes pull images from a private ACR?**
`az aks update --attach-acr <acr>` gives the kubelet managed identity the AcrPull role on the registry, so no `imagePullSecrets` are needed.

**Q14. What happens when you create a `LoadBalancer` Service on AKS?**
The Azure cloud controller adds a frontend public IP and load-balancing rules on the Azure Standard Load Balancer (`kubernetes`) in the MC_ group, pointing to the nodes; the Service's `EXTERNAL-IP` shows that public IP.

**Q15. How do you save AKS costs in non-production?**
Free tier control plane, `az aks stop` outside working hours, cluster autoscaler with low min counts, spot node pools for tolerant workloads, right-sized VMs, and deleting the resource group when the lab ends.

**Q16. How do you set up Prometheus and Grafana on AKS?**
You don't need Helm: enable **Managed Prometheus** (`--enable-azure-monitor-metrics`, or the "Enable Prometheus metrics" checkbox), which sends metrics to an Azure Monitor workspace, and link an **Azure Managed Grafana** workspace for dashboards. Microsoft runs, scales and upgrades both. The same applies to Istio, KEDA, Azure Policy and Key Vault CSI, which are built-in add-ons.

**Q17. Built-in add-on vs installing with Helm: when would you still use Helm?**
Use the add-on by default (Microsoft support, automatic upgrades). Use Helm when you need a version or feature the add-on doesn't support, full control over the configuration, or the same setup across clouds (e.g. the same kube-prometheus-stack on EKS and AKS).

**Q18. EKS vs AKS, main differences?**
AKS has a free control plane tier, uses VMSS node pools in a separate MC_ resource group, Azure CNI Overlay networking, Entra ID + Azure RBAC for users and Entra Workload ID for Pods. EKS charges per cluster-hour, uses EC2 node groups/Karpenter in your VPC, VPC CNI, IAM access entries, and IRSA/Pod Identity.
