# Day 42 - Azure DevOps: Azure Pipelines Build and Push a Docker Image to ACR

> **In short:** **Azure DevOps** is Microsoft's all-in-one DevOps platform: **Boards** (work tracking), **Repos** (Git), **Pipelines** (CI/CD), **Test Plans** and **Artifacts**. **Azure Container Registry (ACR)** is Azure's private Docker registry (the Azure version of ECR). In this lab we put a small Dockerized app on GitHub, bring it into Azure DevOps, and use the built-in **"Docker: Build and push an image to Azure Container Registry"** template. Azure Pipelines writes the `azure-pipelines.yml` for us, creates the connection to ACR automatically, and on every push to `main` builds the image and pushes it to ACR. No manual `docker build` / `docker push`.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | Azure DevOps services, organization and project, Azure Pipelines (trigger, stages, jobs, steps, tasks), agents and parallel jobs, service connections, ACR | How CI/CD is organized in Azure DevOps |
| **Part 2: Lab** | Create ACR → push app code to GitHub → Azure DevOps org + project → import the repo → pipeline from the Docker template → run → verify the image in ACR → test the trigger → clean up | Fully automated build and push to ACR |
| **Part 3: Next** | Deploy to AKS template, Azure Pipelines vs GitHub Actions vs Jenkins | Where this pipeline goes next |

## Table of Contents

**Part 1: Concepts**
1. [What is Azure DevOps?](#1-what-is-azure-devops)
2. [Organization and project](#2-organization-and-project)
3. [What is Azure Pipelines?](#3-what-is-azure-pipelines)
4. [Pipeline structure: trigger → stages → jobs → steps](#4-pipeline-structure-trigger--stages--jobs--steps)
5. [Tasks: the built-in plugins](#5-tasks-the-built-in-plugins)
6. [Agents and parallel jobs](#6-agents-and-parallel-jobs)
7. [Service connections](#7-service-connections)
8. [Azure Container Registry (ACR)](#8-azure-container-registry-acr)

**Part 2: Lab**

9. [Lab overview](#9-lab-overview)
10. [Step 1: Create the ACR](#10-step-1-create-the-acr)
11. [Step 2: Put the app code on GitHub](#11-step-2-put-the-app-code-on-github)
12. [Step 3: Create the Azure DevOps organization and project](#12-step-3-create-the-azure-devops-organization-and-project)
13. [Step 4: Import the GitHub repo into Azure Repos](#13-step-4-import-the-github-repo-into-azure-repos)
14. [Step 5: Create the pipeline from the Docker template](#14-step-5-create-the-pipeline-from-the-docker-template)
15. [Step 6: Understand the generated azure-pipelines.yml](#15-step-6-understand-the-generated-azure-pipelinesyml) (+ who decides what: template vs Dockerfile)
16. [Step 7: Check the run](#16-step-7-check-the-run)
17. [Step 8: Verify the image in ACR](#17-step-8-verify-the-image-in-acr)
18. [Step 9: Test the automatic trigger](#18-step-9-test-the-automatic-trigger)
19. [Step 10: Clean up](#19-step-10-clean-up)
20. [Troubleshooting](#20-troubleshooting)

**Part 3: Next**

21. [Deploy to AKS template](#21-deploy-to-aks-template)
22. [Azure Pipelines vs GitHub Actions vs Jenkins](#22-azure-pipelines-vs-github-actions-vs-jenkins) (+ same pipeline side by side)

**Wrap-up**

23. [What I learned](#23-what-i-learned)
24. [Interview Questions](#24-interview-questions)

---

# Part 1: Concepts

## 1. What is Azure DevOps?

**Definition:** **Azure DevOps** is Microsoft's software-as-a-service platform for the whole software lifecycle: plan the work, store the code, build, test, release and store packages, all in one place at `dev.azure.com`. It works with any language and any cloud, not only Azure.

- **What it is:** 5 services in one website; you can use all of them or only one (for example only Pipelines with your code on GitHub).
- **What happens:** a developer picks a ticket in Boards, pushes code to Repos, Pipelines builds and deploys it automatically.
- **Why teams use it:** everything is connected (a commit links to a ticket, a pipeline run links to the commit), and many tasks are built in.

**Analogy:** a factory with every department under one roof: planning office (Boards), warehouse of blueprints (Repos), assembly line (Pipelines), quality check (Test Plans), parts store (Artifacts).

```
                        Azure DevOps (dev.azure.com)
  ┌──────────┬──────────┬──────────────┬─────────────┬────────────┐
  │  Boards  │  Repos   │  Pipelines   │ Test Plans  │ Artifacts  │
  │ tickets, │ Git repos│ CI/CD: build,│ manual and  │ npm, Maven,│
  │ sprints  │ PRs      │ test, deploy │ exploratory │ NuGet, pip │
  └──────────┴──────────┴──────────────┴─────────────┴────────────┘
```

| Azure DevOps service | What it does | Similar tool |
|---|---|---|
| **Boards** | Work items, sprints, Kanban | Jira |
| **Repos** | Private Git repositories, pull requests | GitHub / GitLab repos |
| **Pipelines** | CI/CD with YAML | GitHub Actions / Jenkins |
| **Test Plans** | Manual and exploratory testing | TestRail |
| **Artifacts** | Package feeds (npm, Maven, NuGet, Python) | Nexus / JFrog Artifactory |

> **Interview one-liner:** "Azure DevOps is Microsoft's DevOps platform with Boards, Repos, Pipelines, Test Plans and Artifacts; Pipelines works with code from Azure Repos, GitHub or Bitbucket and can deploy to any cloud."

---

## 2. Organization and project

**Definition:** an **organization** is the top level of Azure DevOps, reached at `https://dev.azure.com/<org-name>`; it holds users, billing and projects. A **project** inside it holds one team's (or product's) repos, pipelines, boards and settings, for example `dev.azure.com/mycompany/shop`.

- **Organization:** usually one per company; connected to the company's Entra ID tenant for sign-in.
- **Project:** one per product or team; can be **private** (only members) or **public**.
- **Settings** like service connections and agent pools are mostly set **per project** (Project settings).

```
  Organization: dev.azure.com/mycompany
   ├── Project: shop
   │     ├── Repos:      shop-frontend, shop-api
   │     ├── Pipelines:  shop-frontend-ci, shop-api-ci
   │     └── Project settings → Service connections (ACR, AKS, Azure subscription)
   └── Project: payments
```

| Azure DevOps | GitHub equivalent |
|---|---|
| Organization | GitHub organization |
| Project | (no exact twin) a group of repos + their pipelines and boards |
| Repo | Repository |

> **Interview one-liner:** "An Azure DevOps organization holds projects; each project holds its repos, pipelines, boards and service connections."

---

## 3. What is Azure Pipelines?

**Definition:** **Azure Pipelines** is the CI/CD service of Azure DevOps. It runs your build, test and deploy steps on **agents** (machines) every time code changes. Pipelines are written in **YAML** in a file called `azure-pipelines.yml` stored in the repo, so the pipeline is versioned with the code.

- **CI (Continuous Integration):** on every push, build the code and run tests (here: build the Docker image).
- **CD (Continuous Delivery/Deployment):** push the result somewhere and deploy it (here: push to ACR; later deploy to AKS).
- **Code source:** Azure Repos Git, GitHub, Bitbucket Cloud (or any Git URL).

**Analogy:** an assembly line that starts automatically when new parts (commits) arrive and ships the finished product (image) to the warehouse (ACR).

```
  git push ──► Azure Pipelines ──► agent (Ubuntu VM)
                                     ├── checkout code
                                     ├── docker build
                                     └── docker push ──► ACR: myacr.azurecr.io/myapp:42
```

| Pipeline type | What it is | Today |
|---|---|---|
| **YAML pipelines** | Pipeline as code in `azure-pipelines.yml` | ✅ Use this |
| **Classic pipelines** (build + release UI) | Built by clicking in the UI | Older, still seen in companies |

> **Interview one-liner:** "Azure Pipelines is the CI/CD part of Azure DevOps; pipelines are YAML files in the repo that run on Microsoft-hosted or self-hosted agents."

---

## 4. Pipeline structure: trigger → stages → jobs → steps

**Definition:** a YAML pipeline has a fixed hierarchy. The **trigger** decides when it runs. A pipeline has one or more **stages** (big phases like Build, Deploy). Each stage has **jobs** (each job runs on one agent). Each job has **steps**, which are either **tasks** (ready-made plugins) or **scripts** (your own commands).

- **trigger:** `trigger: [main]` = run on every push to `main`. `pr:` = run on pull requests.
- **stage → job → step:** stages run one after another by default; jobs in a stage can run in parallel; steps in a job run in order on the same agent.
- **variables:** values reused in the file, e.g. `$(tag)`; built-in ones like `$(Build.BuildId)` (a number that grows every run).

**Analogy:** a cooking competition. Trigger = the bell, stages = rounds (starter, main), jobs = cooks in a round (each at their own station = agent), steps = the recipe lines each cook follows.

```
  trigger: main
  └── stage: Build                     ◄── phase
        └── job: Build                 ◄── runs on 1 agent (ubuntu-latest)
              ├── step: checkout       (automatic)
              └── step: task Docker@2  buildAndPush ─► ACR
  └── stage: Deploy (later)
        └── job: Deploy
              └── step: task KubernetesManifest@1 ─► AKS
```

| Azure Pipelines | GitHub Actions | Jenkins |
|---|---|---|
| `trigger` | `on:` | Build trigger / webhook |
| Stage | (no direct twin) job group with `needs` | `stage` |
| Job | Job | (node block) |
| Step / task | Step / action (`uses:`) | `step` / plugin |
| Agent | Runner | Agent / node |
| `azure-pipelines.yml` | `.github/workflows/*.yml` | `Jenkinsfile` |

> **Interview one-liner:** "An Azure YAML pipeline is trigger → stages → jobs → steps; a job runs on one agent and its steps are tasks or scripts."

---

## 5. Tasks: the built-in plugins

**Definition:** a **task** is a ready-made, versioned building block that does one job in a pipeline, written as `Name@version`, for example `Docker@2` or `AzureCLI@2`. Microsoft ships hundreds of built-in tasks, and more come from the Visual Studio Marketplace. Tasks are why you don't write long shell scripts: you give inputs and the task does the work, including logging in with the service connection.

- **Example:** `Docker@2` with `command: buildAndPush` logs in to ACR, runs `docker build`, tags the image and runs `docker push` in one step.
- **Templates:** when you create a pipeline, Azure suggests templates ("Docker: Build and push an image to Azure Container Registry", "Deploy to Azure Kubernetes Service", "Node.js"…) that write the YAML with the right tasks for you.
- **What goes wrong:** pinning only the major version (`@2`) means minor updates arrive automatically; usually good, rarely breaking.

**Analogy:** kitchen appliances. Instead of grinding by hand (shell script), you put ingredients in the mixer (task) and press a button.

| Task | What it does | Manual equivalent |
|---|---|---|
| `Docker@2` | Login, build, push images | `docker login` + `docker build` + `docker push` |
| `AzureCLI@2` | Run `az` commands logged in to Azure | `az login --service-principal …` + commands |
| `KubernetesManifest@1` | Deploy YAML to AKS, swap image tags | `kubectl apply` + `sed` image tag |
| `HelmDeploy@0` | Helm install/upgrade | `helm upgrade --install` |
| `TerraformTaskV4@4` (Marketplace) | Terraform init/plan/apply | `terraform` commands |

> **Interview one-liner:** "Tasks are Azure Pipelines' built-in plugins, like GitHub Actions; for example Docker@2 buildAndPush logs in to ACR, builds and pushes the image in one step."

---

## 6. Agents and parallel jobs

**Definition:** an **agent** is the machine that runs a pipeline job. **Microsoft-hosted agents** are fresh VMs Microsoft creates for each job (e.g. `ubuntu-latest`, `windows-latest`) and throws away after it. **Self-hosted agents** are your own VMs/containers with the agent software installed. A **parallel job** is how many jobs can run at the same time in your organization.

- **Microsoft-hosted:** nothing to maintain, Docker preinstalled; clean every run.
- **Self-hosted:** you maintain it, but it can reach private networks and keep caches.
- **Free tier:** new organizations get Microsoft-hosted parallel jobs only after a free grant request (private projects: 1 parallel job, 1,800 minutes/month); 1 self-hosted parallel job is free.

**Analogy:** Microsoft-hosted = a taxi (new car every trip, no maintenance). Self-hosted = your own car (you service it, but it can go into your private garage).

```
  Pipeline run ──► Agent pool
                    ├── Azure Pipelines (Microsoft-hosted): ubuntu-latest VM ─ used once, deleted
                    └── Default (self-hosted): my-build-vm ─ yours, inside your VNet
```

| | Microsoft-hosted | Self-hosted |
|---|---|---|
| Setup / patching | ✅ Microsoft | You |
| Clean every run | ✅ Yes | No (clean it yourself) |
| Reach a private AKS / private VNet | ❌ No | ✅ Yes |
| Cost | Free grant, then per parallel job | Free for 1 parallel job + your VM cost |

> **Interview one-liner:** "Agents run pipeline jobs; Microsoft-hosted agents are fresh managed VMs per job, self-hosted agents are your own machines used for private network access or custom tools."

---

## 7. Service connections

**Definition:** a **service connection** is a saved, secure login from Azure DevOps to an outside service: an Azure subscription, ACR, AKS, Docker Hub, GitHub. Pipelines refer to it by name (or ID), so **no password is written in the YAML**. It's in **Project settings → Service connections**.

- **What happens:** the `Docker@2` task uses the **Docker Registry** service connection to log in to ACR before pushing.
- **Who creates it:** the pipeline template creates it **automatically** when you pick your subscription and ACR; you can also create it by hand.
- **Authentication types** for Azure (you saw these in the dropdown):

| Auth type | How it logs in | Secret stored? | Use |
|---|---|---|---|
| **Workload identity federation** | OIDC token exchange with Entra ID | ✅ No secret | ✅ Recommended today |
| **Service principal** (secret) | Client ID + client secret (Day 40) | ❌ Yes, expires and must be rotated | Older setups |
| **Managed identity** | Identity of a self-hosted agent VM in Azure | ✅ No secret | Self-hosted agents in Azure |

**Analogy:** a valet key kept at the reception. The pipeline asks for "the ACR key" by name; nobody sees or copies the real key.

```
  azure-pipelines.yml                 Project settings
  containerRegistry: acr-conn ──────► Service connection "acr-conn"
                                        type: Docker Registry → Azure Container Registry
                                        auth: workload identity federation
                                               │ short-lived token
                                               ▼
                                        ACR: myacr.azurecr.io  (role: AcrPush)
```

| | GitHub Actions | Azure Pipelines |
|---|---|---|
| Stored login to a cloud | Secrets / OIDC in the workflow | **Service connection** |
| Shared variables / secrets | Repository/environment secrets | **Library → variable groups** (can link Key Vault) |

> **Interview one-liner:** "A service connection is a secure, reusable login from Azure DevOps to Azure, ACR, AKS or Docker Hub; pipelines reference it by name, and workload identity federation avoids storing any secret."

---

## 8. Azure Container Registry (ACR)

**Definition:** **Azure Container Registry (ACR)** is Azure's managed, private registry for Docker/OCI images and Helm charts. Each registry has a globally unique **login server** like `myacr.azurecr.io`, and images are stored as `myacr.azurecr.io/<repository>:<tag>`, for example `myacr.azurecr.io/myapp:42`. It's the Azure version of **Amazon ECR**.

- **What it is:** a resource in a resource group; the name must be globally unique, 5–50 lowercase letters and numbers.
- **What happens:** the pipeline pushes `myapp:<BuildId>`; AKS pulls it using the kubelet identity (`az aks update --attach-acr`, Day 40).
- **Access:** Azure RBAC roles **AcrPush** (push + pull) and **AcrPull** (pull only); the admin user (username/password) is disabled by default; keep it off.

**Analogy:** a private warehouse for shipping containers. Only trucks with a pass (AcrPush / AcrPull role) can drop off or pick up.

```
  Azure Pipelines ── AcrPush ──►  ACR: myacr.azurecr.io
                                   └── repository: myapp
                                         ├── tag 41
                                         └── tag 42  (latest build)
  AKS kubelet identity ── AcrPull ──┘   (pulls myacr.azurecr.io/myapp:42)
```

| SKU | For | Extras |
|---|---|---|
| **Basic** | Learning, small projects | Lowest storage and throughput |
| **Standard** | Most production workloads | More storage and throughput |
| **Premium** | Large / enterprise | Geo-replication, private endpoints, content trust |

| | Lab | Production |
|---|---|---|
| SKU | Basic | Standard / Premium |
| Network | Public endpoint | ✅ Private endpoint (Premium) |
| Auth | Service connection made by the template | ✅ Workload identity federation, admin user off |
| Images | Tag = build ID | ✅ Build ID or Git SHA tags, scanned (Defender for Containers), retention policy |

> **Interview one-liner:** "ACR is Azure's private container registry (like ECR); pipelines push with the AcrPush role and AKS pulls with AcrPull through the kubelet identity, so no registry passwords are needed."

---

# Part 2: Lab

## 9. Lab overview

```
  Laptop ── git push ──► GitHub repo (azure-devops-demo)
                             │ import
                             ▼
  Azure DevOps: org ─► project "demo" ─► Azure Repos (copy of the code)
                             │ push to main = trigger
                             ▼
                        Azure Pipelines (ubuntu-latest agent)
                          Docker@2 buildAndPush
                             │ service connection (created by the template)
                             ▼
  Azure: rg-day42-acr ─► ACR myacr12345.azurecr.io/azure-devops-demo:<BuildId>
```

| Item | Value in this lab |
|---|---|
| Resource group | `rg-day42-acr` (East US) |
| ACR | `myacr12345` (pick your own unique name), SKU Basic |
| GitHub repo | `azure-devops-demo` (your account) |
| Azure DevOps project | `demo` (private) |
| Pipeline template | Docker: Build and push an image to Azure Container Registry |
| Image | `myacr12345.azurecr.io/azure-devops-demo:<BuildId>` |

**Before you start:** an Azure subscription (Day 40), the Azure CLI logged in (`az login`), a GitHub account and `git` on your laptop. Sign in to Azure DevOps with the **same Microsoft account** as your Azure subscription, so the template can see your subscription and ACR.

---

## 10. Step 1: Create the ACR

You can create it in the portal (**Container registries → Create**: subscription, resource group, unique name, location, SKU Basic → Review + create) or with the CLI below.

### 1a. Create the resource group

```bash
az group create --name rg-day42-acr --location eastus
```

### 1b. Create the registry

```bash
az acr create --resource-group rg-day42-acr --name myacr12345 --sku Basic
```

**What it does:** creates a Basic ACR. Replace `myacr12345` with your own globally unique name (lowercase letters and numbers only).
**Expected:** JSON with `"loginServer": "myacr12345.azurecr.io"` and `"provisioningState": "Succeeded"`.

### 1c. Check it

```bash
az acr list --output table
```

**Expected:** your registry with `LOGIN SERVER` = `myacr12345.azurecr.io`, SKU `Basic`. Create the ACR **before** the pipeline, otherwise the template shows *No registries found*.

---

## 11. Step 2: Put the app code on GitHub

In my case I use a tiny nginx page so the build is fast. If you already have a Dockerized app on GitHub, you can use it and skip to Step 3.

### 2a. Create an empty repo on GitHub

On GitHub: **New repository** → name `azure-devops-demo` → Public → Create.

### 2b. Clone it

```bash
git clone https://github.com/<your-github-user>/azure-devops-demo.git
```

```bash
cd azure-devops-demo
```

### 2c. Create the web page

```bash
vim index.html
```

```html
<!DOCTYPE html>
<html>
  <head><title>Azure DevOps demo</title></head>
  <body>
    <h1>Built by Azure Pipelines, stored in ACR - v1</h1>
  </body>
</html>
```

### 2d. Create the Dockerfile

```bash
vim Dockerfile
```

```dockerfile
FROM nginx:1.27-alpine
COPY index.html /usr/share/nginx/html/index.html
EXPOSE 80
```

**What it does:** starts from the small nginx image and copies our page into nginx's web folder.

### 2e. Push to GitHub

```bash
git add Dockerfile index.html
```

```bash
git commit -m "Add nginx demo app"
```

```bash
git push origin main
```

**Expected:** both files visible on GitHub in the `main` branch.

---

## 12. Step 3: Create the Azure DevOps organization and project

### 3a. Create the organization

Go to `https://dev.azure.com` → sign in with the same Microsoft account as Azure → **New organization** → name it (e.g. `myname-devops`) → pick a region → Continue.
**Expected:** you land on `https://dev.azure.com/<org-name>`.

### 3b. Create the project

**+ New project** → name `demo` → Visibility **Private** → Create.
**Expected:** the project page with Overview, Boards, Repos, Pipelines, Test Plans, Artifacts on the left.

### 3c. Request the free Microsoft-hosted agent (new organizations only)

New organizations can't run Microsoft-hosted jobs until the free grant is approved. Fill in the form at `https://aka.ms/azpipelines-parallelism-request` (approval usually takes a few business days). Check under **Organization settings → Parallel jobs**: Microsoft-hosted should show **1** free parallel job.

---

## 13. Step 4: Import the GitHub repo into Azure Repos

### 4a. Open the empty repo

**Repos → Files**. The project's default repo is empty ("*demo is empty. Add some code!*").

### 4b. Import

Under **Import a repository** → **Import** → Repository type **Git** → Clone URL `https://github.com/<your-github-user>/azure-devops-demo.git` → leave *Requires Authentication* unchecked (public repo) → **Import**.
**Expected:** "On its way!" → after a few seconds **Repos → Files** shows `Dockerfile` and `index.html`.

> **Other option:** you don't have to import. When creating the pipeline you can pick **GitHub** as the source; Azure Pipelines installs its GitHub App and reads the code (and the YAML) straight from GitHub. Import gives you a copy in Azure Repos; connecting GitHub keeps one source of truth. In real projects, use whichever is your team's main Git server.

---

## 14. Step 5: Create the pipeline from the Docker template

### 5a. Start a new pipeline

**Pipelines → Pipelines → Create Pipeline**.

### 5b. Connect: where is your code?

Pick **Azure Repos Git** (or **GitHub** if you skipped the import).

### 5c. Select the repo

Pick `demo` (the imported repo).

### 5d. Configure: pick the template

From the list choose **Docker: Build and push an image to Azure Container Registry**.

| Template | Does |
|---|---|
| Docker: Build a Docker image | Build only, no push |
| ✅ **Docker: Build and push an image to Azure Container Registry** | Build + push to ACR (this lab) |
| Deploy to Azure Kubernetes Service | Build + push to ACR + deploy to AKS (Part 3) |

### 5e. Fill in the template form

| Field | Value |
|---|---|
| Azure subscription | Your subscription → **Continue** (sign in if asked) |
| Container registry | `myacr12345` |
| Image name | `azure-devops-demo` |
| Dockerfile | `$(Build.SourcesDirectory)/Dockerfile` |

Click **Validate and configure**.
**What it does behind the scenes:** creates a **Docker Registry service connection** to your ACR (with the AcrPush permission) and writes `azure-pipelines.yml` that uses it. You don't create the service connection by hand.

### 5f. Review and run

Review the YAML → **Save and run** → commit message "Set up CI with Azure Pipelines", commit directly to `main` → **Save and run**.
**What it does:** commits `azure-pipelines.yml` to the repo and starts the first run.

---

## 15. Step 6: Understand the generated azure-pipelines.yml

The template writes a file like this (your service connection ID and registry name will differ):

```yaml
# Docker
# Build and push an image to Azure Container Registry

trigger:
- main

resources:
- repo: self

variables:
  # Container registry service connection established during pipeline creation
  dockerRegistryServiceConnection: 'af3907d5-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
  imageRepository: 'azure-devops-demo'
  containerRegistry: 'myacr12345.azurecr.io'
  dockerfilePath: '$(Build.SourcesDirectory)/Dockerfile'
  tag: '$(Build.BuildId)'

  # Agent VM image name
  vmImageName: 'ubuntu-latest'

stages:
- stage: Build
  displayName: Build and push stage
  jobs:
  - job: Build
    displayName: Build
    pool:
      vmImage: $(vmImageName)
    steps:
    - task: Docker@2
      displayName: Build and push an image to container registry
      inputs:
        command: buildAndPush
        repository: $(imageRepository)
        dockerfile: $(dockerfilePath)
        containerRegistry: $(dockerRegistryServiceConnection)
        tags: |
          $(tag)
```

**In simple steps:**
1. A push to `main` starts the pipeline.
2. Azure gives it a fresh `ubuntu-latest` agent and checks out this repo.
3. The `Docker@2` task logs in to ACR using the service connection.
4. It builds the image from `Dockerfile` and tags it with the build number.
5. It pushes `myacr12345.azurecr.io/azure-devops-demo:<BuildId>` to ACR.

```
 push to main ─► ubuntu-latest agent ─► checkout ─► Docker@2: login ─► build ─► push ─► ACR
```

| Line | Meaning |
|---|---|
| `trigger: - main` | Run on every push to `main` (older repos use `master`) |
| `resources: - repo: self` | Use the repo this YAML lives in |
| `dockerRegistryServiceConnection` | ID of the service connection the template created (no password in the file) |
| `imageRepository` | Repository name inside ACR |
| `containerRegistry` | ACR login server |
| `tag: $(Build.BuildId)` | Built-in variable, a unique number per run → every build gets a new tag |
| `vmImageName: ubuntu-latest` | Microsoft-hosted Ubuntu agent with Docker preinstalled |
| `stage: Build` → `job: Build` | One stage with one job |
| `task: Docker@2`, `command: buildAndPush` | Built-in task: build + push in one step |

### Who decides what: template vs Dockerfile

**Definition:** the template does **not** read your code to decide how to build it. It writes `azure-pipelines.yml` **once** (when you create the pipeline) from the options you pick. On every push, the `Docker@2` task runs `docker build` with **your Dockerfile**, and the Dockerfile decides how the app is built.

| Piece | Who writes it | What it decides |
|---|---|---|
| **Dockerfile** (in the repo) | You / the developer | **How** the app is built (Node, Java, Python, nginx…) |
| **azure-pipelines.yml** | The template, **once**, at pipeline creation | **When** to build (`trigger`), **where** (`ubuntu-latest`), **where to push** (ACR) |
| **Docker@2 task** | Built in | Runs `docker build` + `docker push` |

```
 developer pushes new code (any change)
        │
        ▼
 same azure-pipelines.yml runs (trigger: main)
        │
        ▼
 Docker@2: docker build -f Dockerfile .   ◄── Dockerfile decides HOW to build the new code
        │
        ▼
 docker push myacr12345.azurecr.io/azure-devops-demo:<BuildId>   ◄── new tag every run
```

So **whatever code comes from Git is built and pushed automatically**, as long as:
1. The repo has a **Dockerfile** (the template doesn't create one; without it the build fails).
2. It's at the path in `dockerfilePath` (`$(Build.SourcesDirectory)/Dockerfile` = repo root).
3. The push is to a branch listed in `trigger`.

- **The wizard only suggests:** it scans the repo to recommend templates (Dockerfile → Docker, `package.json` → Node.js, `pom.xml` → Maven), but you pick one.
- **Example:** a Node.js app's Dockerfile runs `npm install` / `npm run build`; the pipeline doesn't know it's Node. Swap in a Java app with a Java Dockerfile and the same YAML still works.

> **Interview one-liner:** "The template generates the YAML once from the options you pick; on every push Docker@2 builds whatever is in the repo using its Dockerfile and pushes a new tag to ACR. The Dockerfile defines how to build, the pipeline defines when and where."

---

## 16. Step 7: Check the run

### 7a. Open the run

**Pipelines → demo → the run (e.g. `#20261126.1`)**.
**Expected:** a green ✅ on the stage **Build and push stage** (job **Build**, about 1–2 minutes).

### 7b. See the steps

Click the **Build** job.
**Expected:** these steps, all green:

| Step | What it did |
|---|---|
| Initialize job | Prepared the agent, downloaded the `Docker@2` task |
| Checkout demo@main | `git clone` of the repo |
| Build and push an image to container registry | `docker login` + `docker build` + `docker push` |
| Post-job: Checkout | Cleaned up |
| Finalize Job | Finished, reported status |

Click the **Build and push** step to see the real `docker build` and `docker push` logs, ending with the pushed digest.

### 7c. See the service connection it created

**Project settings → Service connections**.
**Expected:** a Docker Registry connection named after your ACR (e.g. `myacr12345` with a suffix). This is what the YAML ID points to.

---

## 17. Step 8: Verify the image in ACR

### 8a. List repositories

```bash
az acr repository list --name myacr12345 --output table
```

**Expected:** `azure-devops-demo`.

### 8b. List tags

```bash
az acr repository show-tags --name myacr12345 --repository azure-devops-demo --output table
```

**Expected:** one tag, the build ID of the run (e.g. `1`). Portal view: **ACR → Services → Repositories → azure-devops-demo**.

### 8c. (Optional) Pull and run it on your laptop

```bash
az acr login --name myacr12345
```

```bash
docker run -d -p 8080:80 myacr12345.azurecr.io/azure-devops-demo:<tag>
```

```bash
curl http://localhost:8080
```

**Expected:** `Built by Azure Pipelines, stored in ACR - v1`.

---

## 18. Step 9: Test the automatic trigger

### 9a. Change the page

In Azure Repos (**Repos → Files → index.html → Edit**) change `v1` to `v2` → **Commit** to `main`. (Or pull the repo, edit locally and `git push`.)

### 9b. Watch the pipeline

**Pipelines → demo**.
**Expected:** a new run started by itself, reason **Individual CI**, without clicking anything.

### 9c. Check the new tag

```bash
az acr repository show-tags --name myacr12345 --repository azure-devops-demo --output table
```

**Expected:** two tags now (e.g. `1` and `2`). Every push = new image, fully automated.

---

## 19. Step 10: Clean up

### 10a. Delete the ACR

```bash
az group delete --name rg-day42-acr --yes --no-wait
```

**What it does:** deletes the resource group and the ACR with all images (ACR Basic is billed per day while it exists).

### 10b. (Optional) Delete the service connection and project

Azure DevOps itself is free for this lab. If you don't need it: **Project settings → Service connections → delete**, then **Project settings → Overview → Delete** project. The service connection's identity in Entra ID (app registration) can be removed under **Entra ID → App registrations**.

---

## 20. Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `No hosted parallelism has been purchased or granted` | New organization has no free Microsoft-hosted parallel job yet | Request it at `https://aka.ms/azpipelines-parallelism-request` (Step 3c), or use a self-hosted agent meanwhile |
| Template / service connection shows **No registries found** | ACR not created yet, or created in another subscription | Create the ACR first (Step 1), refresh, pick the right subscription |
| **An error occurred while validating the authentication** when creating a service connection by hand | Your account can't create the identity in the tenant, a browser pop-up was blocked, or the ACR list is empty | Allow pop-ups, check you are Owner on the subscription, or let the pipeline template create the connection; prefer **Workload identity federation** |
| Pipeline doesn't start on push | Branch in `trigger` doesn't match (`master` vs `main`) | Set `trigger: - main` (your real default branch) |
| `unauthorized: authentication required` on push | Service connection deleted/expired (service principal secret expired) | Recreate the connection (workload identity federation doesn't expire) and update the ID in the YAML |
| `Dockerfile: no such file or directory` | Wrong `dockerfilePath` | Dockerfile must be at the repo root, or fix the path |
| `The pipeline is not valid. Job Build: Step input containerRegistry references service connection ... which could not be found` | Connection not authorized for this pipeline | Open the run → **Permit** / authorize the service connection for the pipeline |

---

# Part 3: Next

## 21. Deploy to AKS template

**Definition:** the **Deploy to Azure Kubernetes Service** template extends this pipeline with a **Deploy** stage: after build and push, it uses the `KubernetesManifest@1` task to apply your Kubernetes YAML to an AKS cluster, replacing the image tag with the new build ID.

```
  trigger: main
  ├── stage: Build   ── Docker@2 buildAndPush ─► ACR :<BuildId>
  └── stage: Deploy  ── KubernetesManifest@1 deploy ─► AKS (Environment "demo.default")
                         image: myacr12345.azurecr.io/azure-devops-demo:<BuildId>
```

- It creates a **Kubernetes service connection** and an **Environment** (Pipelines → Environments) that shows the deployment history and can require **approvals** before prod.
- AKS pulls from ACR via `--attach-acr` (Day 40), so no image pull secret is needed.
- In GitOps setups (Argo CD), the pipeline instead updates the image tag in a Git manifests repo and Argo CD deploys it.

---

## 22. Azure Pipelines vs GitHub Actions vs Jenkins

| Topic | Azure Pipelines | GitHub Actions | Jenkins |
|---|---|---|---|
| Hosting | SaaS (dev.azure.com) or Azure DevOps Server | SaaS (github.com) | You host it |
| Pipeline file | `azure-pipelines.yml` | `.github/workflows/*.yml` | `Jenkinsfile` (Groovy) |
| Hierarchy | Stages → jobs → steps | Jobs → steps | Stages → steps |
| Reusable blocks | **Tasks** (`Docker@2`) + templates | **Actions** (`uses:`) | **Plugins** |
| Machines | Microsoft-hosted / self-hosted agents | GitHub-hosted / self-hosted runners | Controller + agents |
| Cloud logins | **Service connections** | Secrets / OIDC | Credentials plugin |
| Approvals | Environments with checks | Environments with reviewers | `input` step |
| Best fit | Teams on Azure / Microsoft stack, need Boards + Repos + Test Plans | Code on GitHub | Full control, on-prem |

> **Interview one-liner:** "All three run YAML/code pipelines on agents; Azure Pipelines adds stages, built-in tasks, service connections and environments, and fits best when the team is already on Azure and Azure DevOps."

### Same pipeline side by side: Azure Pipelines vs GitHub Actions

**Definition:** Azure Pipelines and GitHub Actions are both YAML CI/CD with the same idea (trigger → jobs → steps on a hosted machine); mostly only the keywords change. Below is the **same job** in both: build the image and push it to ACR on every push to `main`.

**Azure Pipelines (`azure-pipelines.yml`)**

```yaml
trigger:
- main

variables:
  containerRegistry: 'myacr12345.azurecr.io'
  imageRepository: 'azure-devops-demo'
  tag: '$(Build.BuildId)'

stages:
- stage: Build
  jobs:
  - job: Build
    pool:
      vmImage: 'ubuntu-latest'
    steps:
    - task: Docker@2
      inputs:
        command: buildAndPush
        repository: $(imageRepository)
        dockerfile: 'Dockerfile'
        containerRegistry: $(dockerRegistryServiceConnection)
        tags: $(tag)
```

**GitHub Actions (`.github/workflows/acr.yml`)**

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  REGISTRY: myacr12345.azurecr.io
  IMAGE: azure-devops-demo

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
      - run: az acr login --name myacr12345
      - run: docker build -t $REGISTRY/$IMAGE:${{ github.run_number }} .
      - run: docker push $REGISTRY/$IMAGE:${{ github.run_number }}
```

| Azure Pipelines | GitHub Actions | Meaning |
|---|---|---|
| `trigger: - main` | `on: push: branches: [main]` | Run on every push to main |
| **Run pipeline** button | `workflow_dispatch` + **Run workflow** button | Manual run |
| `variables:` | `env:` | Values reused in the file |
| `$(Build.BuildId)` | `${{ github.run_number }}` | Unique number per run (image tag) |
| `stages:` → `stage:` | (none; use `needs:` between jobs) | Big phases |
| `jobs:` → `job:` | `jobs:` → `build:` | Work on one machine |
| `pool: vmImage: ubuntu-latest` | `runs-on: ubuntu-latest` | Hosted machine (agent / runner) |
| `steps:` | `steps:` | Same |
| `task: Docker@2` | `uses: some/action@v2` | Built-in plugin |
| Checkout is automatic | `actions/checkout@v4` must be written | Get the code |
| **Service connection** (Project settings) | **Secrets** + OIDC (`azure/login`) | Login to Azure/ACR, no password in YAML |
| `Docker@2 buildAndPush` (1 step) | login + build + push (3 steps) | Build and push the image |

**How runs start (the Runs page):**

| Run label in Azure | Started by | GitHub Actions equivalent |
|---|---|---|
| **Individual CI** | A push to the trigger branch | Run triggered by `push` |
| **Manually run by …** | The **Run pipeline** button | `workflow_dispatch` run |
| **Updated azure-pipelines.yml** | Editing the YAML is a commit, so it triggers by itself | Editing the workflow file also triggers a run |

**The 3 real differences:**
1. **Stages:** Azure has an extra level (stage → job → step); GitHub has jobs → steps.
2. **Service connections:** Azure stores the ACR login in Project settings, and the wizard creates it; in GitHub you set up secrets / OIDC yourself.
3. **Templates do more:** one `Docker@2` step = login + build + push, and the wizard writes the whole file; in GitHub you usually write those steps or combine actions.

> **Interview one-liner:** "Azure Pipelines and GitHub Actions are both YAML CI/CD: trigger ≈ on, pool ≈ runs-on, task ≈ action, service connection ≈ secrets/OIDC. Azure adds stages and wizard templates; GitHub needs an explicit checkout step."


---

# Wrap-up

## 23. What I learned

**Concepts**
- Azure DevOps = Boards + Repos + Pipelines + Test Plans + Artifacts; organization → project.
- Pipeline = trigger → stages → jobs → steps; steps are **tasks** (built-in plugins) or scripts.
- Agents: Microsoft-hosted (fresh VM per job) or self-hosted; new orgs need the free parallel job grant.
- **Service connections** keep logins out of the YAML; workload identity federation = no secret.
- **ACR** = private registry (≈ ECR); AcrPush for pipelines, AcrPull for AKS.

**Lab**
- ACR → code on GitHub → import into Azure Repos → **Docker build-and-push template** → it creates the service connection and `azure-pipelines.yml` → push to `main` builds and pushes a new tag to ACR automatically.

```
  git push ─► Azure Pipelines (template) ─► Docker@2 buildAndPush ─► ACR :<BuildId>  ─► (next) AKS
```

---

## 24. Interview Questions

### Other Questions

**Q1. What are the services in Azure DevOps?**
Boards (work tracking), Repos (Git), Pipelines (CI/CD), Test Plans (testing) and Artifacts (package feeds).

**Q2. Explain the structure of an Azure YAML pipeline.**
A trigger decides when it runs; a pipeline has stages; each stage has jobs that run on an agent; each job has steps, which are tasks or scripts. Variables like `$(Build.BuildId)` are reused across steps.

**Q3. What is a task in Azure Pipelines?**
A versioned built-in plugin (`Docker@2`, `AzureCLI@2`, `KubernetesManifest@1`) that performs one action with inputs, so you don't write long scripts. Similar to a GitHub Action or a Jenkins plugin.

**Q4. Microsoft-hosted vs self-hosted agent?**
Microsoft-hosted agents are fresh, managed VMs for each job with tools preinstalled. Self-hosted agents are your own machines, used when you need private network access (private AKS, private ACR), custom tools or caches.

**Q5. What is a service connection and why use it?**
A secure, reusable login from Azure DevOps to an external service (Azure subscription, ACR, AKS, Docker Hub). The pipeline references it by name or ID, so credentials never appear in the YAML. Workload identity federation is preferred because no secret is stored or expires.

**Q6. How does the pipeline push to ACR without a password?**
The Docker@2 task uses a Docker Registry service connection backed by an Entra identity that has the AcrPush role on the registry; the task logs in, builds and pushes.

**Q7. How do you tag images in the pipeline and why not `latest`?**
With a unique value like `$(Build.BuildId)` or the Git commit SHA. Unique tags make every build traceable and rollbacks easy; `latest` is overwritten and you can't tell which code is running.

**Q7b. Does the pipeline template understand your code and build it?**
No. The template writes the YAML once from the options you choose. The build steps come from the repo's Dockerfile: Docker@2 runs `docker build` with it on every push. Without a Dockerfile the build fails.

**Q8. What does "No hosted parallelism has been purchased or granted" mean?**
The organization has no Microsoft-hosted parallel job yet. New organizations must request the free grant (or buy a parallel job), or use a self-hosted agent.

**Q9. Can Azure Pipelines build code that lives on GitHub?**
Yes. Choose GitHub as the source when creating the pipeline; the Azure Pipelines GitHub App reads the code and the `azure-pipelines.yml` from GitHub and reports status back on commits and PRs.

**Q10. ACR vs ECR, and how does AKS pull from ACR?**
Both are private managed registries. AKS pulls from ACR through the kubelet managed identity, which gets the AcrPull role with `az aks update --attach-acr <acr>`, so no image pull secrets are needed.

**Q11. How do you add an approval before deploying to production?**
Deploy through an **Environment** (Pipelines → Environments) and add an **Approvals and checks** rule; the deploy stage waits until an approver approves.

**Q12. Azure Pipelines vs GitHub Actions?**
Both are YAML CI/CD with hosted and self-hosted runners. Azure Pipelines has stages, tasks, service connections, environments and integrates with Boards, Repos and Test Plans; GitHub Actions lives next to code on GitHub and uses actions from the Marketplace. Choose based on where the code and the team already are.
