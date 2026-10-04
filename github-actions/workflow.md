# Workflows — Day by Day

What I built each day. Concepts are explained in [README.md](./README.md).

## Day 1 — Intro, Workflows, Triggers, Node.js, Artifacts, CodeQL

- **Intro:** what CI/CD is and how GitHub Actions automates build, test, and deploy.
- **Workflows:** wrote my first workflow file in `.github/workflows/`.
- **Triggers:** runs on every push to `main`/`master`, or manually (`workflow_dispatch`).
- **Node.js:** installed the app's dependencies with npm.
- **Artifacts:** saved the build output so it can be downloaded or used by later jobs.
- **CodeQL:** added a security scan that finds vulnerabilities in the code.

### Simple CI Pipeline

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches:
      - master
      - main
  workflow_dispatch:

jobs:
  build_and_package:
    name: BUILD-JOB
    runs-on: ubuntu-slim

    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Install Dependencies
        run: npm install

      - name: Test
        run: echo "code is tested!"

      - name: Deploy
        run: echo "my code is deployed"
```

- **`on: push`**: runs the workflow automatically when code is pushed.
- **`workflow_dispatch`**: adds a **Run workflow** button to run it manually.
- **`runs-on: ubuntu-slim`**: a small GitHub-hosted runner (1 CPU, 15-minute job limit).
- **`uses:`** runs a ready-made action. **`run:`** runs a shell command.

## Day 2 — Cache, Dependabot, Matrix Jobs, Conditions, Status Check

- **Cache + build → test → deploy:** split the pipeline into 3 jobs and cached npm packages.
- **Matrix jobs + conditions:** 2 operating systems × 3 Node versions, deploy only on a push to
  `main`, and rollback with `if: failure()`.
- **Dependabot:** `.github/dependabot.yml`, set to check for updates weekly.
- **Status check:** made the workflow a required check, so a PR can't merge until it passes.

### Cache + Build → Test → Deploy

Split the pipeline into 3 jobs that run one after another using `needs:`, and cached npm
packages so installs are faster.

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches:
      - master
      - main
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-slim
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Cache Dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}

      - name: Build
        run: npm install

  test:
    runs-on: ubuntu-slim
    needs: build
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Cache Dependencies
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}

      - name: Test
        run: echo "code is tested"

  deploy:
    runs-on: ubuntu-slim
    needs: test
    steps:
      - name: Deploy
        run: echo "code is deploy"
```

- **`needs: build`**: `test` starts only after `build` passes. `deploy` waits for `test`.
- **Cache `key`**: built from a hash of `package-lock.json`. Same lock file → same key → cache is
  reused. Lock file changes → new key → fresh cache.
- Each job runs on a **new runner**, so every job checks out the code again.

### Matrix Jobs + Conditions

One job definition runs on **every combination** of OS and Node version (2 × 3 = 6 runs).
Deploy runs only on a push to `main`, and rollback runs only if deploy fails.

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

jobs:
  build_and_test:
    name: BUILD (${{ matrix.os }}, Node ${{ matrix.node-version }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false # one failing combo doesn't cancel the others
      matrix:
        os: [ubuntu-latest, windows-latest]
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - run: npm test

  deploy:
    needs: build_and_test # waits for all 6 matrix runs
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: echo "my code is deployed"
      - name: Rollback
        if: failure() # only if a step above failed
        run: echo "rollback is done"
```

- **`strategy.matrix`**: runs the same job for each combination.
- **`fail-fast: false`**: if one combination fails, the others keep running.
- **`if:` on a job**: the job runs only when the condition is true.
- **`if: failure()` on a step**: the step runs only when an earlier step failed.

### Dependabot

Added `.github/dependabot.yml`. Dependabot checks every week for newer package versions and opens a
pull request to update them.

```yaml
version: 2
updates:
  - package-ecosystem: 'npm'
    directory: '/'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
    labels:
      - dependencies
      - security
    commit-message:
      prefix: 'deps'

  - package-ecosystem: 'github-actions' # also updates actions/checkout@vX etc.
    directory: '/'
    schedule:
      interval: 'weekly'
```

### Status Check

Made the pipeline a **required status check**, so a pull request **can't be merged until the
workflow passes**.

**Settings → Branches (or Rules → Rulesets) → add a rule for `main` → Require status checks to
pass → select the job (e.g. `BUILD-JOB`).**

The PR page then shows ✅ or ❌ next to each check, and the **Merge** button stays blocked until
they're green.

## Day 3 — Parallel Builds, Self-Hosted Runner

- **Parallel builds:** build, test, and security jobs run at the same time; deploy waits for all.
- **Self-hosted runner:** ran the pipeline on my own machine instead of GitHub's servers.

### Parallel Builds

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

### Self-Hosted Runner

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
