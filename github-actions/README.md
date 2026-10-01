# GitHub Actions — Basics

Sources: [GitHub Docs](https://docs.github.com/en/actions/get-started/understand-github-actions) ·
[KodeKloud Notes](https://notes.kodekloud.com/) · Practice: [interview-questions.md](./interview-questions.md)

## 1. The Problem Before CI/CD

Before CI/CD, teams built, tested, and deployed code **by hand**:

- **"Works on my machine"** — code ran on the developer's laptop but broke on the server.
- **Integration hell** — developers merged big changes rarely, so merges caused many conflicts and
  bugs at once.
- **Manual testing and deployment** — slow, boring, and easy to make mistakes.
- **Late bug discovery** — bugs were found days or weeks later, when they're costly to fix.

**CI/CD fixes this:** every push is **automatically built and tested (CI)**, and good code is
**automatically released/deployed (CD)**. Small changes, fast feedback, fewer mistakes.

## 2. Traditional CI/CD Tools

| Tool                         | Type                     | Note                                 |
| ---------------------------- | ------------------------ | ------------------------------------ |
| **Jenkins**                  | Open-source, self-hosted | Most popular classic CI/CD tool      |
| **Travis CI**                | Cloud (SaaS)             | Was popular for open-source projects |
| **CircleCI**                 | Cloud / self-hosted      | Fast, Docker-friendly                |
| **GitLab CI/CD**             | Built into GitLab        | Like GitHub Actions, but for GitLab  |
| **Bamboo**                   | Atlassian, self-hosted   | Integrates with Jira and Bitbucket   |
| **TeamCity**                 | JetBrains                | Popular in enterprise                |
| **Azure DevOps Pipelines**   | Microsoft cloud          | Good for Azure / .NET                |
| **AWS CodePipeline / Build** | AWS cloud                | Good for AWS-native deployments      |
| **Argo CD**                  | GitOps CD for Kubernetes | Deploy only (CD), not CI             |

## 3. What is Jenkins?

Jenkins is an **open-source automation server** written in Java. You **install and run it on your own
server**, and it builds, tests, and deploys code. The pipeline is written in a **`Jenkinsfile`**
(Groovy). It uses a **controller** (main server that schedules jobs) and **agents** (machines that
run the jobs), and gets most features from **1,800+ plugins**.

**Pain points of Jenkins:**

- You must **set up, patch, back up, and scale** the Jenkins server yourself.
- **Plugin problems** — version conflicts, security issues, and broken upgrades.
- **Groovy pipelines** are harder to learn than simple YAML.
- Needs **webhooks and credentials** to connect to GitHub — a separate tool to manage.

## 4. Why GitHub Actions over Jenkins?

| Point           | Jenkins                                | GitHub Actions                           |
| --------------- | -------------------------------------- | ---------------------------------------- |
| **Setup**       | Install + maintain your own server     | Nothing to install — built into GitHub   |
| **Pipeline**    | `Jenkinsfile` (Groovy)                 | YAML in `.github/workflows/`             |
| **Servers**     | You manage controller + agents         | GitHub-hosted runners (or self-hosted)   |
| **Extensions**  | Plugins (installed on the server)      | Actions from Marketplace (used per step) |
| **Integration** | Needs webhooks + GitHub plugin         | Native — PRs, issues, releases, checks   |
| **Scaling**     | You add agents yourself                | GitHub scales automatically              |
| **Cost**        | Free software, but you pay for servers | Free minutes per plan, pay for extra     |

> **Interview answer:** "Our code is already on GitHub, so GitHub Actions gives us CI/CD with **no
> server to maintain**. Pipelines are simple **YAML** stored with the code, we get **ready-made
> actions** from the Marketplace, and it's **natively integrated** with PRs and issues. Jenkins is
> still good when you need **full control, on-prem setups, or very complex pipelines** — and GitHub
> Actions covers that too with **self-hosted runners**."

## 5. What is GitHub Actions?

GitHub Actions is GitHub's **built-in CI/CD and automation platform**. You write a **YAML file** in
your repo, and when something happens (push, pull request, etc.), GitHub **runs it automatically**
to build, test, and deploy your code.

> **Interview one-liner:** An **event** triggers a **workflow**. The workflow has **jobs**. Each job
> runs on a **runner** and has **steps**. A step is a shell command (`run`) or an **action**
> (`uses`).

![GitHub Actions workflow runs list](https://kodekloud.com/kk-media/image/upload/v1752870447/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-runs-interface.jpg)

![A workflow in progress](https://kodekloud.com/kk-media/image/upload/v1752870448/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-progress.jpg)

**GitHub manages the servers for you** — setup, scaling, and maintenance. You only write the
workflow. Runners are available on **Ubuntu, Windows, and macOS**.

![Ubuntu, Windows, macOS runners](https://kodekloud.com/kk-media/image/upload/v1752870449/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-ubuntu-windows-macos.jpg)

![GitHub manages infrastructure](https://kodekloud.com/kk-media/image/upload/v1752870450/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-manages-infrastructure-infographic.jpg)

## 6. Not Just CI/CD

**CI/CD:** build → test → lint → dockerize → security scan → deploy.

![CI/CD with GitHub Actions](https://kodekloud.com/kk-media/image/upload/v1752870453/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-cicd-diagram.jpg)

**Repo automation:** it also reacts to issues, pull requests, releases, and packages. For example,
when a new PR is opened it can post a welcome comment, add labels based on changed files, and
assign reviewers.

![Repository automation events](https://kodekloud.com/kk-media/image/upload/v1752870454/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-flowchart-automation.jpg)

## 7. Core Components

```text
Event ──► Workflow ──► Job(s) ──► runs on Runner ──► Step(s)
                                                     ├─ run:  shell command
                                                     └─ uses: action
```

| Term         | Simple meaning                                     | YAML key   |
| ------------ | -------------------------------------------------- | ---------- |
| **Workflow** | The automation file in `.github/workflows/*.yml`   | `name:`    |
| **Event**    | What starts the workflow (push, PR, schedule, …)   | `on:`      |
| **Job**      | A group of steps that run on one machine           | `jobs:`    |
| **Step**     | One task — a command or an action                  | `steps:`   |
| **Action**   | Ready-made reusable step (e.g. `actions/checkout`) | `uses:`    |
| **Runner**   | The machine (VM) that runs the job                 | `runs-on:` |
| **Matrix**   | Run the same job with many combos (OS × version)   | `matrix:`  |
| **Needs**    | Make one job wait for another                      | `needs:`   |

### 7.1 Workflow

A workflow is an **automated process that runs one or more jobs**. It's a **YAML file** stored in
**`.github/workflows/`** (`.yml` or `.yaml`). A repo can have **many workflows** — e.g. one to
test PRs, one to deploy on release, one to label new issues. One workflow can also **reuse another
workflow**.

### 7.2 Events

An event is **an activity that starts a workflow** — like a push, a pull request, or an opened
issue. Workflows can also run on a **schedule** (cron), **manually** (`workflow_dispatch`), or from
an **API call** (`repository_dispatch`).

```yaml
name: My Awesome App
on:
  push: # on every push
  pull_request: # on PRs to main
    branches: [main]
  schedule: # every day at midnight (UTC)
    - cron: '0 0 * * *'
  workflow_dispatch: # manual "Run workflow" button
```

### 7.3 Jobs

A job is a **set of steps that run on the same runner**. **Jobs run in parallel** by default; use
**`needs:`** to make a job wait for another. A **matrix** runs the same job for many combinations
(e.g. 3 OS × 2 Node versions = 6 runs). Different jobs run on different machines, so they **share
data using artifacts**.

### 7.4 Steps

Steps are the **individual tasks inside a job** — either a **shell command (`run`)** or an
**action (`uses`)**. They run **one after another** on the same machine, so they **share files** —
e.g. step 1 builds the app, step 2 tests the built output.

```yaml
jobs:
  unit-testing:
    strategy:
      matrix: # 3 OS × 2 versions = 6 runs
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4 # get the code
      - uses: actions/setup-node@v4 # install Node.js
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci # install dependencies
      - run: npm test # run tests

  deploy:
    needs: unit-testing # runs only after all tests pass
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying..."
```

### 7.5 Actions

An action is a **ready-made, reusable piece of code** for a common task, so you don't write the
same steps again. Examples: `actions/checkout` (get code), `actions/setup-node` (install Node),
`aws-actions/configure-aws-credentials` (cloud login). Get them from the **GitHub Marketplace** or
write your own, and always **pin the version** (`@v4` or a commit SHA).

### 7.6 Runners

A runner is the **server that runs your job** — one job at a time. **GitHub-hosted runners**
(Ubuntu, Windows, macOS) give a **fresh, clean VM for every run**, so nothing is saved between runs
(use cache/artifacts). **Self-hosted runners** are your own machines, for custom OS, hardware, or
private network access.

![Job running on Windows, Ubuntu, macOS runners](https://kodekloud.com/kk-media/image/upload/v1752870456/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-runners.jpg)

|                   | GitHub-hosted                      | Self-hosted                       |
| ----------------- | ---------------------------------- | --------------------------------- |
| **Where**         | GitHub's cloud                     | Your own server / cloud           |
| **Customization** | Only pre-installed tools           | Full control (GPU, custom OS…)    |
| **Cost**          | Free minutes in plan, limits apply | You pay for servers + maintenance |
| **Managed by**    | GitHub                             | You                               |

![GitHub-hosted vs self-hosted runners](https://kodekloud.com/kk-media/image/upload/v1752870456/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-self-hosted-runners-comparison.jpg)

> ⚠️ GitHub-hosted runners have **usage limits** based on your plan — check
> [Billing settings](https://github.com/settings/billing).

## 8. Example — Node.js CI Workflow

A typical CI pipeline in `.github/workflows/ci.yml`. Explain it in an interview like this:

```yaml
name: Node.js CI # WORKFLOW name (shown in Actions tab)

on: # EVENTS
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch: # manual run

jobs:
  build: # JOB
    runs-on: ubuntu-latest # RUNNER (fresh VM)
    steps: # STEPS (run in order)
      - uses: actions/checkout@v4 # ACTION: clone the repo
      - uses: actions/setup-node@v4 # ACTION: install Node + cache npm
        with:
          node-version: 20
          cache: npm
      - run: npm ci # install exact dependencies
      - run: npm run lint # check code quality
      - run: npm test # run tests
      - run: npm run build # build the app
```

## 9. Remember These

- Workflow files live in **`.github/workflows/`**.
- **Jobs = parallel**, **steps = sequential**.
- `run:` = shell command, `uses:` = action.
- Each job gets a **fresh VM**; jobs share data via **artifacts**.
- **Pin action versions** (`@v4`) for safe, repeatable builds.
- Use **`npm ci`** in CI (exact versions from the lock file).

**Next steps:** [Workflow templates](https://docs.github.com/en/actions/writing-workflows/using-workflow-templates)
· [CI tutorials](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing) ·
[Deployment](https://docs.github.com/en/actions/use-cases-and-examples/deploying) ·
[GitHub Actions certification](https://resources.github.com/learn/certifications/)
