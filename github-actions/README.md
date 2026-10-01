# GitHub Actions — Understanding the Basics

Source: [Understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions)

## 1. What is GitHub Actions?

GitHub Actions is a **CI/CD platform built into GitHub**. It automates build, test, and deployment
pipelines. You can:

- Build and test every pull request.
- Deploy merged pull requests to production.
- Run workflows on _any_ repository event, not just code changes — e.g. auto-add labels when
  someone opens an issue.

GitHub provides **Linux, Windows, and macOS virtual machines** to run workflows, or you can host
your own **self-hosted runners** in your own data center or cloud.

> One-liner for interviews: _"GitHub Actions is GitHub's native CI/CD and automation platform. An
> **event** triggers a **workflow**, which contains **jobs** that run on **runners**, and each job
> is a sequence of **steps** that run a shell script or an **action**."_

---

## 2. The Components

```text
 Event (push / PR / schedule / manual)
   │
   ▼
 Workflow  (.github/workflows/*.yml)
   ├── Job 1  ──► Runner 1 (fresh VM)
   │     ├── Step 1: uses: actions/checkout@v4   (action)
   │     ├── Step 2: run: npm ci                 (shell script)
   │     └── Step 3: run: npm test
   └── Job 2  ──► Runner 2 (fresh VM)
         ├── Step 1 ...
         └── Step 2 ...
```

### 2.1 Workflow

- A **configurable automated process that runs one or more jobs**.
- Defined by a **YAML file** checked into the repo under **`.github/workflows/`**.
- A repo can have **multiple workflows**, each doing a different set of tasks, e.g.:
  - one to build and test pull requests,
  - one to deploy the app on every release,
  - one to add a label whenever a new issue is opened.
- A workflow is triggered in three ways:
  1. An **event** in the repository.
  2. **Manually** (`workflow_dispatch`).
  3. On a **schedule** (`schedule` with cron syntax).
- A workflow can **reference another workflow** (reusable workflows).

### 2.2 Events

- A **specific activity in a repository that triggers a workflow run**.
- Examples: a pull request is created, an issue is opened, a commit is pushed.
- Can also be triggered **on a schedule**, by **posting to a REST API** (`repository_dispatch`), or
  **manually**.

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 2 * * *' # every day at 02:00 UTC
  workflow_dispatch: # manual "Run workflow" button
```

### 2.3 Jobs

- A **set of steps in a workflow that execute on the same runner**.
- Each step is either a **shell script** or an **action**.
- Steps run **in order** and **depend on each other**.
- Because steps of a job run on the **same runner**, they can **share data** (files on disk, env
  vars) — e.g. step 1 builds the app, step 2 tests the built output.
- **Jobs run in parallel by default.** Use `needs:` to make a job depend on another (sequential).
  - When a job depends on another, it **waits for the dependent job to finish** first.
  - Example: several build jobs for different architectures with no dependencies (parallel), and a
    packaging job that `needs` all of them (runs last).
- A **matrix** runs the same job multiple times with different variable combinations (e.g. OS ×
  Node version).

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci && npm test

  deploy:
    needs: build # waits for ALL matrix builds to pass
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying..."
```

### 2.4 Actions

- A **pre-defined, reusable set of code that performs a frequently repeated task**.
- Reduces repetitive code in workflow files.
- Typical uses:
  - Pull your Git repository from GitHub (`actions/checkout`).
  - Set up the toolchain for your build environment (`actions/setup-node`, `actions/setup-python`).
  - Set up authentication to your cloud provider (`aws-actions/configure-aws-credentials`).
- You can **write your own** actions or find existing ones in the **GitHub Marketplace**.
- Used in a step with `uses:` — always **pin a version** (`@v4`, or a full commit SHA for maximum
  security).

### 2.5 Runners

- A **server that runs your workflows when they're triggered**.
- Each runner runs **a single job at a time**.
- **GitHub-hosted runners**: Ubuntu Linux, Microsoft Windows, macOS.
  - **Each workflow run executes in a fresh, newly-provisioned virtual machine** — nothing persists
    between runs (use caching/artifacts to carry data).
- **Larger runners** are available for bigger configurations.
- **Self-hosted runners**: needed when you want a different OS or specific hardware config; you
  manage the machine.

```yaml
runs-on: ubuntu-latest # GitHub-hosted
runs-on: windows-latest
runs-on: macos-latest
runs-on: [self-hosted, linux] # self-hosted with labels
```

---

## 3. Worked Example — This Repo's CI

This repository's own pipeline, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml), maps
directly onto the components above:

```yaml
name: Node.js CI # Workflow name shown in the Actions tab

on: # EVENTS that trigger the workflow
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
  workflow_dispatch: # manual trigger

jobs:
  build: # JOB id
    runs-on: ubuntu-latest # RUNNER (GitHub-hosted, fresh VM)

    steps: # STEPS run in order on the same runner
      - name: Checkout code
        uses: actions/checkout@v4 # ACTION – clone the repo onto the runner

      - name: Setup Node.js
        uses: actions/setup-node@v4 # ACTION – install Node + npm cache
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci # SHELL step

      - name: Run ESLint
        run: npm run lint

      - name: Check formatting
        run: npm run format:check

      - name: Run tests
        run: npm run test:ci

      - name: Build application
        run: npm run build
```

| Component | In this file                                            |
| --------- | ------------------------------------------------------- |
| Workflow  | `.github/workflows/ci.yml` (`name: Node.js CI`)         |
| Events    | `push` / `pull_request` to `main`, `workflow_dispatch`  |
| Job       | `build`                                                 |
| Runner    | `ubuntu-latest`                                         |
| Steps     | checkout → setup-node → install → lint → format → test… |
| Actions   | `actions/checkout@v4`, `actions/setup-node@v4`          |

---

## 4. Quick Revision Cheat Sheet

| Term     | Definition                                                         | YAML keyword       |
| -------- | ------------------------------------------------------------------ | ------------------ |
| Workflow | Automated process of one or more jobs, YAML in `.github/workflows` | file + `name:`     |
| Event    | Activity that triggers a workflow run                              | `on:`              |
| Job      | Set of steps executed on the same runner                           | `jobs.<job_id>:`   |
| Step     | A shell command or an action, run in order                         | `steps:`           |
| Action   | Reusable unit of code for a common task                            | `uses:`            |
| Runner   | Server (VM) that executes a job                                    | `runs-on:`         |
| Shell    | Run a command directly                                             | `run:`             |
| Depends  | Make a job wait for another                                        | `needs:`           |
| Matrix   | Run a job across combinations of variables                         | `strategy.matrix:` |

Key facts to remember:

- Jobs → **parallel** by default; steps → **sequential**.
- Steps in the same job **share the runner's filesystem**; different jobs **do not** (use
  artifacts).
- GitHub-hosted runners are **ephemeral** — a fresh VM for every run.
- One runner = **one job at a time**.

See [interview-questions.md](./interview-questions.md) for Q&A practice.

## 5. Next Steps (from the docs)

- [Use workflow templates](https://docs.github.com/en/actions/writing-workflows/using-workflow-templates)
- [Continuous integration tutorials](https://docs.github.com/en/actions/use-cases-and-examples/building-and-testing)
- [Publishing packages](https://docs.github.com/en/actions/use-cases-and-examples/publishing-packages)
- [Deployment](https://docs.github.com/en/actions/use-cases-and-examples/deploying)
- [GitHub Actions certification](https://resources.github.com/learn/certifications/)
