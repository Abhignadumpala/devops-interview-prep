# Class Workflows — Corrected

The workflows from class (Day 1–3), each fixed, with a list of **what was wrong and why**.
Concepts are explained in [README.md](./README.md).

> **Note:** `ubuntu-slim` (used in class) **is a valid runner**: 1 CPU, container-based, 15-minute
> job limit. It's fine for light jobs, but use `ubuntu-latest` for CodeQL, matrix builds, or anything
> heavy.

## Day 1 — Build + CodeQL + Artifact

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    name: BUILD-JOB
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci # install exact dependencies
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: app-build
          path: dist/ # the build output, not package*.json

  codeql: # separate job → runs in PARALLEL with build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write # upload results to the Security tab
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript]
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}
      - uses: github/codeql-action/analyze@v4
        with:
          category: '/language:${{ matrix.language }}'
```

**What was fixed:**

- **Only `master` was a trigger.** This repo's default branch is now `main`, so pushes to `main`
  never ran the workflow. Both branches are now listed.
- **CodeQL was mixed into the build job.** Moving it into its own job lets it run **in parallel**
  with the build, and `security-events: write` is given only to the job that needs it.
- **The `autobuild` step was removed.** JavaScript/TypeScript doesn't need to be compiled, so CodeQL
  scans it directly. Autobuild is only needed for compiled languages like Java, C#, or Go.
- **`codeql-action@v3` → `@v4`**, and **`checkout@v4` → `@v7`**. The old versions still run, but
  newer major versions exist.
- **`npm install` is not a build.** It only installs dependencies. Use `npm ci` in CI, then the real
  test and build commands.
- **The artifact was `package*`**, which only uploaded `package.json` and `package-lock.json`. Those
  files are already in Git. An artifact should be the **build output** (`dist/`) or **reports**.

## Day 2 — Matrix + Cache + Conditions + Rollback

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read

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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm # correct cache folder on Linux AND Windows
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with:
          name: artifact-${{ runner.os }}-node-${{ matrix.node-version }}
          path: dist/

  deploy:
    needs: build_and_test # waits for all 6 matrix runs
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: artifact-Linux-node-22
          path: dist/
      - name: Deploy
        run: echo "my code is deployed"
      - name: Rollback
        if: failure() # only if deploy failed
        run: echo "rollback is done"
```

**What was fixed:**

- **Broken YAML indentation.** `on: push: branches:` was on one line, and `os:` was not indented
  under `matrix:`. YAML depends on indentation, so the workflow would not even load.
- **Deploy ran inside the matrix**, so it would deploy **6 times** (2 OS × 3 versions). Deploy is
  now a separate job that runs **once**, after all builds pass (`needs:`).
- **The `if:` condition didn't match the triggers.** The workflow ran on `main` and `master`, but the
  job only allowed `master`, so pushes to `main` were skipped. The condition is now on the deploy job
  only, so every push still gets built and tested.
- **The cache path `~/.npm` is wrong on Windows.** npm keeps its cache in a different folder there,
  so the Windows runs saved an empty cache. `setup-node` with `cache: npm` uses the right folder on
  every OS. (Including `node-version` in the manual key, as in class, was a good idea.)
- **Unused settings were removed.** The `language` matrix key and `security-events: write` were only
  needed for CodeQL, which this workflow doesn't run. An unused matrix key adds confusion, and an
  unused permission is a security risk.
- **Node 18 → Node 24.** Node 18 is end-of-life (no more security fixes).
- **`npm install` → `npm ci`**, and a real `npm test` instead of `echo "code is tested!"`.

## Day 2 — Build → Test → Deploy (Sequential)

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-slim
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v7 # pass the build to later jobs
        with:
          name: app-build
          path: dist/

  test:
    needs: build
    runs-on: ubuntu-slim
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm # fast, because build already saved the cache
      - run: npm ci
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-slim
    steps:
      - uses: actions/download-artifact@v8 # deploy exactly what build made
        with:
          name: app-build
          path: dist/
      - run: echo "code is deployed"
```

**What was fixed:**

- **A cache doesn't pass files between jobs.** In class, the test job restored the cache but never
  installed or used anything. The cache only speeds up `npm ci`. To pass the **build output** from
  one job to the next, use **artifacts** (upload → download).
- **`deploy` now downloads the artifact.** It deploys the **same files that were built and
  tested** (build once, promote).
- **`npm install` → `npm ci`**, and `setup-node` sets the Node version so all jobs use the same one.

## Day 2 — Dependabot

```yaml
# .github/dependabot.yml
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

  - package-ecosystem: 'github-actions' # keeps actions/checkout@vX etc. up to date
    directory: '/'
    schedule:
      interval: 'weekly'
```

**What was fixed:**

- **Wrong indentation.** `interval` must be inside `schedule:`, and `prefix` inside
  `commit-message:`. `open-pull-requests-limit`, `labels`, and `commit-message` must be indented
  under the `- package-ecosystem` item, not at the `updates:` level.
- **`reviewers:` was removed.** It's no longer a supported Dependabot option. To auto-assign
  reviewers, add a **`.github/CODEOWNERS`** file (e.g. `* @devopsbyraham`).
- **Added the `github-actions` ecosystem**, so Dependabot also opens PRs when actions like
  `checkout@v4` get a newer version.

## Day 3 — Self-Hosted Runner

```yaml
name: Secure DevSecOps Pipeline

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  build:
    runs-on: [self-hosted, linux] # labels pick the right machine
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7 # don't rely on whatever Node is on the server
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: npm run build
      - run: echo "code is deployed"
```

**What was fixed:**

- **YAML on one line** (`jobs: build: runs-on: ...`) was split back into proper indentation.
- **`actions/cache` was removed.** A self-hosted runner **keeps its files between runs**, so
  `~/.npm` is already there. Uploading and downloading a cache from GitHub just adds time.
- **Added `setup-node`**, so the job doesn't depend on whatever Node version is installed on the
  server.
- **`npm install` → `npm ci`.** On a self-hosted runner it also deletes the old `node_modules` left
  by the last run.
- ⚠️ **Only use self-hosted runners on private repos.** On a public repo, anyone can open a PR from a
  fork and run their code on your machine.
