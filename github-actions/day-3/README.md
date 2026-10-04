# Day 3 — Parallel Builds, Self-Hosted Runner

[← Day 2](../day-2/README.md) · [All notes](../README.md)

- **Parallel builds:** build, test, and security jobs run at the same time; deploy waits for all.
- **Self-hosted runner:** ran the pipeline on my own machine instead of GitHub's servers.

<!-- toc -->

## Table of Contents

- [Parallel Builds](#parallel-builds)
- [Self-Hosted Runner](#self-hosted-runner)
- [Screenshots](#screenshots)

<!-- tocstop -->

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
