# Day 3 — CodeQL (SAST), Parallel Builds, Self-Hosted Runner

[← Day 2](../day-2/README.md) · [All notes](../README.md)

- **CodeQL (SAST):** scanned my source code for security issues on every push and PR.
- **Parallel builds:** build, test, and security jobs run at the same time; deploy waits for all.
- **Self-hosted runner:** ran the pipeline on my own machine instead of GitHub's servers.

<!-- toc -->

## Table of Contents

- [CodeQL — SAST](#codeql--sast)
  - [Testing vs CodeQL](#testing-vs-codeql)
  - [CodeQL Workflow](#codeql-workflow)
  - [What Each Part Does](#what-each-part-does)
  - [Where to See the Results](#where-to-see-the-results)
- [Parallel Builds](#parallel-builds)
- [Self-Hosted Runner](#self-hosted-runner)
- [Screenshots](#screenshots)

<!-- tocstop -->

## CodeQL — SAST

**SAST (Static Application Security Testing)** is an automated code review that finds security
issues in your code **without running it**. **CodeQL** is GitHub's SAST tool.

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

## Self-Hosted Runner

Ran the job on **my own machine** instead of GitHub's servers. I installed the runner app from
**Settings → Actions → Runners → New self-hosted runner**.

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build:
    runs-on: [self-hosted, linux] # labels pick the right machine
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: echo "code is deployed"
```

- The machine **keeps its files between runs** (unlike GitHub-hosted runners, which start clean).
- ⚠️ Use self-hosted runners only on **private repos**. On a public repo, anyone can open a PR and
  run code on your machine.

## Screenshots

<!-- Put screenshots in ./images/ and show them like this:
![Workflow run in the Actions tab](./images/actions-run.png)
-->
