# Day 3 — CodeQL (SAST), Self-Hosted Runners, Parallel Builds

[← Day 2](../day-2/README.md) · [All notes](../README.md)

- **CodeQL (SAST):** scanned my source code for security issues on every push and PR.
- **Self-hosted runners:** set up my own AWS EC2 machine as a runner and ran jobs on it.
- **Parallel builds:** build, test, and security jobs run at the same time; deploy waits for all.

<!-- toc -->

## Table of Contents

- [CodeQL — SAST](#codeql--sast)
  - [Testing vs CodeQL](#testing-vs-codeql)
  - [CodeQL Workflow](#codeql-workflow)
  - [What Each Part Does](#what-each-part-does)
  - [Where to See the Results](#where-to-see-the-results)
- [Self-Hosted Runners](#self-hosted-runners)
  - [Why Use Self-Hosted Runners?](#why-use-self-hosted-runners)
  - [GitHub-Hosted vs Self-Hosted](#github-hosted-vs-self-hosted)
  - [Set Up a Self-Hosted Runner on AWS EC2](#set-up-a-self-hosted-runner-on-aws-ec2)
  - [Use the Self-Hosted Runner in a Workflow](#use-the-self-hosted-runner-in-a-workflow)
  - [Things to Remember](#things-to-remember)
- [Parallel Builds](#parallel-builds)

<!-- tocstop -->

## CodeQL — SAST

**SAST (Static Application Security Testing)** is an automated code review that finds security
issues in your code **without running it**. **CodeQL** is GitHub's SAST tool.

![CodeQL SAST](./images/codeql-sast.svg)

CodeQL checks: **"Does my source code contain security vulnerabilities?"**

Examples of what it finds:

- **SQL Injection** — user input goes straight into a database query
- **XSS (Cross-Site Scripting)** — user input is shown on a web page without escaping
- **Command Injection** — user input is passed into a shell command

### Testing vs CodeQL

| Testing              | CodeQL                |
| -------------------- | --------------------- |
| Checks functionality | Checks security       |
| Finds bugs           | Finds vulnerabilities |
| Runs the code        | Reads the code        |
| "Does it work?"      | "Is the code secure?" |

**Interview one-liner:** Testing validates application functionality, while CodeQL analyzes source
code for potential security vulnerabilities.

### CodeQL Workflow

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

jobs:
  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    timeout-minutes: 20 # stop the job if it runs longer than 20 min

    permissions:
      actions: read
      contents: read
      security-events: write # required to upload findings to the Security tab

    strategy:
      fail-fast: false
      matrix:
        language: ['javascript-typescript'] # languages to scan

    defaults:
      run:
        shell: bash

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Cache Dependencies
        uses: actions/cache@v5
        with:
          path: ~/.npm
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-node-

      - name: Install Dependencies
        run: npm ci

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}

      - name: Autobuild
        uses: github/codeql-action/autobuild@v4

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4
        with:
          category: '/language:${{ matrix.language }}'
```

### What Each Part Does

| Part                        | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `timeout-minutes: 20`       | Kills the job if it hangs, so it doesn't waste runner minutes        |
| `security-events: write`    | Lets CodeQL upload its findings to the **Security** tab              |
| `matrix.language`           | Which language to scan. Add more (e.g. `python`) to scan them too    |
| `defaults.run.shell: bash`  | Every `run:` step uses bash                                          |
| `actions/cache` on `~/.npm` | Reuses downloaded packages, so `npm ci` is faster                    |
| `init`                      | Starts CodeQL and creates a database for the language                |
| `autobuild`                 | Builds the code if needed (JavaScript needs no build, so it's quick) |
| `analyze`                   | Runs the security queries and uploads the results                    |
| `category`                  | Labels the results per language in the Security tab                  |

```
checkout → cache → npm ci → init CodeQL → autobuild → analyze → Security tab
```

### Where to See the Results

**Repo → Security → Code scanning.** Each alert shows the file, the line, how serious it is, and how
to fix it. No alerts = no known vulnerabilities found.

## Self-Hosted Runners

A **self-hosted runner** is a machine (VM / server) **managed by your organization** that runs
GitHub Actions jobs, instead of GitHub's own machines.

**In short:** self-hosted runner = **your machine, your control**. GitHub still controls the
workflow; your machine just runs the jobs.

![Self-Hosted Runners](./images/self-hosted-runners.svg)

### Why Use Self-Hosted Runners?

Organizations may need:

1. **Custom software** — a special OS or tools that GitHub's machines don't have
2. **Private network access** — reach private databases or servers inside the company network
3. **Special hardware** — GPU, more RAM, more CPU
4. **More control** — choose the machine, OS, security rules, and where the code runs

### GitHub-Hosted vs Self-Hosted

![GitHub-Hosted vs Self-Hosted](./images/github-vs-self-hosted.svg)

|               | GitHub-Hosted                      | Self-Hosted                       |
| ------------- | ---------------------------------- | --------------------------------- |
| Where         | GitHub's cloud                     | Your own server / cloud (EC2)     |
| Managed by    | GitHub                             | You / your organization           |
| Setup         | Easy, nothing to set up            | Needs setup and maintenance       |
| Tools         | Node, npm, git already installed   | You install everything            |
| Customization | Standard environments only         | Full control (GPU, custom OS…)    |
| Cost          | Free minutes in plan, limits apply | You pay for servers + maintenance |
| Machine       | Fresh VM for every job             | Keeps files between jobs          |
| Best for      | General workloads                  | Custom / private workloads        |

### Set Up a Self-Hosted Runner on AWS EC2

![Set up a self-hosted runner on AWS EC2](./images/self-hosted-setup-ec2.svg)

**Step 1 — Launch an EC2 instance**

- OS: **Ubuntu**
- Type: **t2.medium** at least (2 vCPU, **4 GB RAM**). Smaller machines run out of memory during
  `npm ci` and tests.
- Key pair for SSH, and a security group with **SSH (port 22)** open.
- No other inbound port is needed. The runner connects **out** to GitHub over HTTPS.

**Step 2 — Connect as the `ubuntu` user**

```bash
ssh -i my-key.pem ubuntu@<EC2_PUBLIC_IP>
```

**Step 3 — Download the runner**

Copy these from **Repo → Settings → Actions → Runners → New self-hosted runner → Linux x64**.

```bash
# Create a folder
mkdir actions-runner && cd actions-runner

# Download the latest runner package
curl -o actions-runner-linux-x64-2.337.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.337.0/actions-runner-linux-x64-2.337.0.tar.gz

# Optional: validate the hash
echo "70920811a4f8ad4328818682bca5c6469c1c942fab52448868071d0063816613  actions-runner-linux-x64-2.337.0.tar.gz" | shasum -a 256 -c

# Extract the installer
tar xzf ./actions-runner-linux-x64-2.337.0.tar.gz
```

**Step 4 — Configure (connect the machine to my GitHub repo)**

```bash
./config.sh --url https://github.com/Abhignadumpala/devops-interview-prep --token <YOUR_TOKEN>
```

> The token comes from the same GitHub page. It **expires in 1 hour** and is a secret, so never
> commit it.

Answers I gave:

| Question          | Answer                  |
| ----------------- | ----------------------- |
| Runner group      | Press Enter → `Default` |
| Runner name       | `dev`                   |
| Additional labels | `label1`                |
| Work folder       | Press Enter → `_work`   |

**Step 5 — Run it**

```bash
./run.sh
```

- The terminal shows **"Connected to GitHub"** and **"Listening for Jobs"**.
- In **Settings → Actions → Runners**, the runner `dev` shows as **Idle** (green).
- `run.sh` stops when you close the terminal. To keep it running in the background, install it as a
  service: `sudo ./svc.sh install && sudo ./svc.sh start`.

### Use the Self-Hosted Runner in a Workflow

Use this in each job that should run on my machine:

```yaml
runs-on: self-hosted
```

**Important:** a GitHub-hosted runner already has Node.js and npm installed. My EC2 machine is
**empty**, so the job **fails** with `npm: command not found`. Fix: install Node.js **in the
pipeline** with `actions/setup-node`.

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build:
    runs-on: self-hosted # or [self-hosted, label1] to pick a runner by label
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20' # Node.js version to install
          cache: 'npm' # caches npm packages for faster runs

      - name: Install Dependencies
        run: npm ci

      - name: Test
        run: npm test

      - name: Build
        run: npm run build
```

```
push → GitHub → my EC2 runner (dev) → checkout → setup Node → npm ci → test → build
```

### Things to Remember

- **Self-hosted = install everything yourself.** GitHub-hosted = GitHub gives you the tools.
- The machine **keeps its files between runs** (GitHub-hosted runners start clean every time).
- ⚠️ Use self-hosted runners only on **private repos**. On a public repo, anyone can open a PR and
  run code on your machine.
- **Stop the EC2 instance** when you're done, so it doesn't keep costing money.

**Interview one-liner:** A self-hosted runner is a machine managed by the organization that executes
GitHub Actions jobs instead of using GitHub-hosted infrastructure.

## Parallel Builds

Jobs **without `needs:`** run **at the same time**. Build, test, and security don't depend on each
other, so they run in parallel. Deploy waits for all three.

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run build

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high

  deploy:
    needs: [build, test, security] # starts only after all 3 pass
    runs-on: ubuntu-latest
    steps:
      - run: echo "code is deployed"
```

```
build    ─┐
test     ─┼──→ deploy
security ─┘
```

**Why:** the pipeline takes as long as the **slowest** job, not the **sum** of all jobs, so you get
faster feedback.
