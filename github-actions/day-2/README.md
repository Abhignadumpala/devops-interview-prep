# Day 2 — Cache, Dependabot, Matrix Jobs, Conditions, Status Check

[← Day 1](../day-1/README.md) · [All notes](../README.md) · [Day 3 →](../day-3/README.md)

- **Cache:** saved npm packages between runs, so `npm ci` is faster.
- **Jobs with `needs:`:** split the pipeline into lint → test → build → deploy.
- **Matrix jobs:** ran the tests on 2 operating systems × 3 Node versions (6 runs).
- **Conditions:** deploy only on a push to `main`, and rollback only if deploy fails.
- **Dependabot:** `.github/dependabot.yml` checks for library updates every week.
- **Status check:** made the pipeline a required check, so a PR can't merge until it passes.

## The Full Day 2 Workflow

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

## Result

This workflow is the live `.github/workflows/ci.yml`. On a push to `main`, **all 9 jobs passed**:

| Job                                          | Result   |
| -------------------------------------------- | -------- |
| Lint & Format                                | ✅       |
| Test (ubuntu-latest, Node 20 / 22 / 24)      | ✅ ✅ ✅ |
| Test (windows-latest, Node 20 / 22 / 24)     | ✅ ✅ ✅ |
| Build (uploaded artifact `app-build`)        | ✅       |
| Deploy (ran because it was a push to `main`) | ✅       |

## Artifact — Name, Path and Where to Find It

| What                | Value                                                          |
| ------------------- | -------------------------------------------------------------- |
| Artifact name       | **`app-build`** (set by `name:` in the Upload Artifact step)   |
| Folder uploaded     | **`dist/`** (set by `path:`)                                   |
| Who creates `dist/` | `npm run build` → `mkdir -p dist && cp -r src/. dist/`         |
| Uploaded by job     | **Build** (`actions/upload-artifact@v4`)                       |
| Downloaded by job   | **Deploy** (`actions/download-artifact@v4`), back into `dist/` |
| Size                | About **1 KB** (zipped)                                        |
| Kept for            | **90 days** (GitHub's default), then deleted automatically     |

**What's inside `app-build`:**

```
app-build.zip
├── app.js                  ← from src/app.js
├── server.js               ← from src/server.js
└── services/
    └── calculator.js       ← from src/services/calculator.js
```

The **contents** of `dist/` go into the zip (not the `dist` folder itself). When Deploy downloads
it with `path: dist/`, the files land back in `dist/` on the deploy runner.

**Where to find it on GitHub:**

1. Open the repo → **Actions** tab.
2. Click a workflow run (e.g. the latest push to `main`).
3. On the run's **Summary** page, scroll down to **Artifacts**.
4. Click **`app-build`** to download it as `app-build.zip`.

**How it moves through the pipeline:**

```
Build runner                       GitHub storage              Deploy runner
src/ ──npm run build──→ dist/ ──upload──→ app-build ──download──→ dist/ ──→ deploy
```

- `dist/` is in **`.gitignore`**, so it's **never in the repo**. It only exists inside the runner
  and in the artifact.
- Each job runs on a **new, empty runner**. Without the artifact, Deploy would have no `dist/`
  folder to deploy.

## Cache

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

## Matrix Jobs

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

## Conditions

| Where     | Condition                                                            | Meaning                            |
| --------- | -------------------------------------------------------------------- | ---------------------------------- |
| Job       | `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` | Deploy only on a push to `main`    |
| Step      | `if: failure()`                                                      | Run only if an earlier step failed |
| (default) | `if: success()`                                                      | Run only if everything passed      |
| Step      | `if: always()`                                                       | Run every time (e.g. cleanup)      |

On a **pull request**, lint, test and build run, but deploy is **skipped**, so unmerged code is
never deployed.

## Dependabot

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

## Status Check

Makes the pipeline a **required check**: a PR **can't be merged** until it passes.

1. **Settings → Branches → Add branch protection rule** (or **Settings → Rules → Rulesets**).
2. Branch name pattern: `main`.
3. Tick **Require status checks to pass before merging**.
4. Search and select the checks: `Lint & Format`, each `Test (...)` job, and `Build`.
5. Save.

- The checks appear in the list only **after the workflow has run once**.
- This is why the workflow also runs on **`pull_request`**: the checks run on the PR, and the
  **Merge** button stays blocked until they're ✅.

## Screenshots

<!-- Put screenshots in ./images/ and show them like this:
![Workflow run in the Actions tab](./images/actions-run.png)
-->
