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

- **Cache:** saved npm packages between runs, so `npm ci` is faster.
- **Jobs with `needs:`:** split the pipeline into lint → test → build → deploy.
- **Matrix jobs:** ran the tests on 2 operating systems × 3 Node versions (6 runs).
- **Conditions:** deploy only on a push to `main`, and rollback only if deploy fails.
- **Dependabot:** `.github/dependabot.yml` checks for library updates every week.
- **Status check:** made the pipeline a required check, so a PR can't merge until it passes.

### The Full Day 2 Workflow

`.github/workflows/ci.yml`

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches:
      - master
      - main
  pull_request: # also run on PRs, so the status check shows on the PR
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read

jobs:
  # 1. LINT: check code quality and formatting (once)
  lint:
    name: Lint & Format
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js + Cache # CACHE: saves ~/.npm, key = hash of package-lock.json
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install Dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Format Check
        run: npm run format:check

  # 2. TEST: MATRIX → 2 OS × 3 Node versions = 6 jobs in parallel
  test:
    name: Test (${{ matrix.os }}, Node ${{ matrix.node-version }})
    needs: lint # starts only after lint passes
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false # if one combination fails, the others keep running
      matrix:
        os: [ubuntu-latest, windows-latest]
        node-version: [20, 22, 24]
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js + Cache
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - name: Install Dependencies
        run: npm ci

      - name: Test
        run: npm run test:ci

  # 3. BUILD: create dist/ and save it as an artifact
  build:
    name: Build
    needs: test # waits for ALL 6 matrix jobs to pass
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js + Cache
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install Dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-build
          path: dist/

  # 4. DEPLOY: CONDITIONS → only on a push to main, rollback only on failure
  deploy:
    name: Deploy
    needs: build
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - name: Download Artifact
        uses: actions/download-artifact@v4
        with:
          name: app-build
          path: dist/

      - name: Deploy
        run: echo "code is deployed"

      - name: Rollback
        if: failure() # runs only if a step above failed
        run: echo "rollback is done"
```

**Flow:**

```
lint ──→ test (6 matrix jobs in parallel) ──→ build ──→ deploy (main only)
                                                          └─ rollback (if deploy fails)
```

### Cache

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    cache: npm
```

- `cache: npm` saves the npm download folder (`~/.npm`) after the run, and restores it next time.
- The cache **key** is made from a hash of `package-lock.json`. Same lock file → cache is reused.
  Lock file changes → a new cache is made.
- It's the same as writing `actions/cache` yourself, but it finds the right folder on **every OS**
  (Linux, Windows, macOS):

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.npm
    key: ${{ runner.os }}-node-${{ hashFiles('**/package-lock.json') }}
```

- A cache only makes **installs faster**. To pass files **between jobs** (like `dist/`), use
  **artifacts** (upload → download).

### Matrix Jobs

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, windows-latest]
    node-version: [20, 22, 24]
```

- One job definition runs on **every combination**: 2 × 3 = **6 jobs**, all in parallel.
- `${{ matrix.os }}` and `${{ matrix.node-version }}` are filled in for each job.
- **`fail-fast: false`**: if one combination fails, the others still finish, so you see every
  failure at once.
- **Why:** proves the app works on every OS and Node version your users might have.

### Conditions

| Where     | Condition                                                            | Meaning                            |
| --------- | -------------------------------------------------------------------- | ---------------------------------- |
| Job       | `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` | Deploy only on a push to `main`    |
| Step      | `if: failure()`                                                      | Run only if an earlier step failed |
| (default) | `if: success()`                                                      | Run only if everything passed      |
| Step      | `if: always()`                                                       | Run every time (e.g. cleanup)      |

On a **pull request**, lint, test and build run, but deploy is **skipped**, so unmerged code is
never deployed.

### Dependabot

`.github/dependabot.yml` (not a workflow: GitHub reads it directly)

```yaml
version: 2
updates:
  - package-ecosystem: 'npm' # libraries in package.json
    directory: '/'
    schedule:
      interval: 'weekly'
    open-pull-requests-limit: 10
    labels:
      - dependencies
      - security
    commit-message:
      prefix: 'deps'

  - package-ecosystem: 'github-actions' # actions/checkout@v4 etc. in workflows
    directory: '/'
    schedule:
      interval: 'weekly'
```

- Every week, Dependabot checks for newer versions and **opens a pull request** for each update.
- That PR runs the pipeline above, so you **see if the update breaks anything** before merging.

### Status Check

Makes the pipeline a **required check**: a PR **can't be merged** until it passes.

1. **Settings → Branches → Add branch protection rule** (or **Settings → Rules → Rulesets**).
2. Branch name pattern: `main`.
3. Tick **Require status checks to pass before merging**.
4. Search and select the checks: `Lint & Format`, each `Test (...)` job, and `Build`.
5. Save.

- The checks appear in the list only **after the workflow has run once**.
- This is why the workflow also runs on **`pull_request`**: the checks run on the PR, and the
  **Merge** button stays blocked until they're ✅.

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
