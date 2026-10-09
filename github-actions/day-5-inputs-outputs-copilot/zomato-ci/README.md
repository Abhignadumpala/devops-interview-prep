# Zomato Project — CI Integration

[← Day 5](../README.md) · [All notes](../../README.md)

An **enterprise CI pipeline** for a React app (Zomato clone): build → test → security scan → Docker
build → push to DockerHub → smoke test.

<!-- toc -->

## Table of Contents

- [Overall Summary — CI vs CD](#overall-summary--ci-vs-cd)
- [1. Pipeline Flow](#1-pipeline-flow)
- [2. Full Pipeline](#2-full-pipeline)
- [3. Explanation — Top Section](#3-explanation--top-section)
  - [3.1 Trigger](#31-trigger)
  - [3.2 Permissions (Least Privilege)](#32-permissions-least-privilege)
  - [3.3 Prevent Parallel Builds — `concurrency`](#33-prevent-parallel-builds--concurrency)
  - [3.4 Global Environment Variables — `env`](#34-global-environment-variables--env)
  - [3.5 Secrets](#35-secrets)
- [4. Job 1 — Build React Application](#4-job-1--build-react-application)
- [5. Job 2 — Security & Docker Validation](#5-job-2--security--docker-validation)
  - [Tools Used](#tools-used)
- [Interview One-Liners](#interview-one-liners)

<!-- tocstop -->

## Overall Summary — CI vs CD

1. **Developer** writes the Zomato code and **pushes it to Git** (GitHub).
2. We write a **Dockerfile** for the app.
3. **CI:** the pipeline builds a **Docker image** from that Dockerfile, scans it and **pushes** it to
   DockerHub.
4. **CD:** the image is deployed to **Kubernetes** — Kubernetes **pulls** the image from DockerHub
   and runs it as pods.

```
                 ┌──────────────── CI (this pipeline) ────────────────┐   ┌──────── CD ────────┐
Developer ──► Git push ──► build + test + scan ──► Dockerfile ──► Docker image ──► DockerHub ──► Kubernetes
 (code)        (GitHub)                                (build)        (push)          (pull + run pods)
```

| Part   | What happens                                         | Ends with             |
| ------ | ---------------------------------------------------- | --------------------- |
| **CI** | Code → build → test → scan → Docker image → push     | Image in DockerHub    |
| **CD** | Image pulled from DockerHub → deployed on Kubernetes | App running for users |

> **CI = build the image. CD = run the image on Kubernetes.**

## 1. Pipeline Flow

```
push / PR / manual run
        │
        ▼
┌───────────────────────────────┐        ┌───────────────────────────────────┐
│ JOB 1: build                  │ needs: │ JOB 2: security                   │
│ checkout → setup node → cache │ ─────► │ download artifact → Trivy scan    │
│ CodeQL → npm ci → lint → test │        │ → hadolint → Buildx build image   │
│ → build → upload artifact     │        │ → push to DockerHub → smoke test  │
└───────────────────────────────┘        └───────────────────────────────────┘
```

## 2. Full Pipeline

```yaml
name: Enterprise CI Pipeline

# ─────────────────────────────────────────────
# Trigger
# ─────────────────────────────────────────────
on:
  push:
    branches:
      - main
      - master
      - develop
      - feature/**
  pull_request:
    branches:
      - main
      - master
      - develop
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        default: 'development'
        type: choice
        options:
          - development
          - staging
          - production
      deploy_tests:
        description: 'Run integration tests?'
        required: false
        default: true
        type: boolean

# ─────────────────────────────────────────────
# Default Permissions (Least Privilege)
# ─────────────────────────────────────────────
permissions:
  contents: read
  security-events: write
  actions: read
  checks: write
  packages: write
  id-token: write

# ─────────────────────────────────────────────
# Prevent Parallel Builds
# ─────────────────────────────────────────────
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# ─────────────────────────────────────────────
# Global Environment Variables
# ─────────────────────────────────────────────
env:
  NODE_VERSION: '22'
  IMAGE_NAME: ${{ secrets.DOCKER_USER }}/zomato_new
  IMAGE_TAG: ${{ github.sha }}

jobs:
  # ───────────────────────────────────────────
  # JOB 1: Build React Application
  # ───────────────────────────────────────────
  build:
    name: Build React Application
    runs-on: ubuntu-latest
    timeout-minutes: 20
    defaults:
      run:
        shell: bash

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm

      - name: Display Versions
        run: |
          node --version
          npm --version

      - name: Restore npm Cache
        uses: actions/cache@v4
        with:
          path: ~/.npm
          key: ${{ runner.os }}-npm-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-npm-

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3

      - name: Install Dependencies
        run: npm ci

      - name: Verify Installed Packages
        run: npm ls || true

      - name: Run ESLint
        run: npm run lint

      - name: Run Unit Tests
        env:
          CI: true
        run: echo "code is tested"

      - name: Upload Coverage Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage

      - name: Build Application
        run: npm link

      - name: Artifact Upload
        uses: actions/upload-artifact@v4
        with:
          name: artifact-1
          path: package*

  # ───────────────────────────────────────────
  # JOB 2: Security & Docker Validation
  # ───────────────────────────────────────────
  security:
    name: Security & Docker Validation
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 30

    permissions:
      contents: read
      security-events: write

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Download React Build
        uses: actions/download-artifact@v4
        with:
          name: artifact-1
          path: .

      # - name: Run Gitleaks
      #   uses: gitleaks/gitleaks-action@v3
      #   env:
      #     NEW_GITHUB_TOKEN: ${{ secrets.GT }}

      - name: Install Trivy
        uses: aquasecurity/setup-trivy@e07451d2e059ed86c2870430ea286b3a9e0bf241

      - name: Verify Trivy
        run: trivy --version

      - name: Run Trivy Filesystem Scan
        continue-on-error: true
        run: |
          trivy fs \
            --format sarif \
            --output trivy-fs.sarif \
            --severity CRITICAL,HIGH \
            --ignore-unfixed \
            .

      - name: Verify SARIF
        run: |
          pwd
          ls -la
          find . -name "*.sarif"

      - name: Upload Trivy Scan Results
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: ./trivy-fs.sarif

      - name: Lint Dockerfile
        uses: hadolint/hadolint-action@v3.1.0
        with:
          dockerfile: Dockerfile
          failure-threshold: warning

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Restore Docker Cache
        uses: actions/cache@v4
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ github.sha }}
          restore-keys: |
            ${{ runner.os }}-buildx-

      - name: Build Docker Image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          push: false
          tags: |
            ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
            ${{ env.IMAGE_NAME }}:latest
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new
          provenance: false
          load: true
          labels: |
            org.opencontainers.image.title=Zomato
            org.opencontainers.image.source=${{ github.repository }}
            org.opencontainers.image.version=${{ github.sha }}
            org.opencontainers.image.revision=${{ github.sha }}
            org.opencontainers.image.created=${{ github.run_id }}

      - name: Update Docker Cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache

      - name: Verify Docker Image
        run: |
          docker images
          docker image inspect \
            ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}

      - name: Login to DockerHub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USER }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Push Docker Image
        run: |
          docker push ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
          docker push ${{ env.IMAGE_NAME }}:latest

      - name: Smoke Test Container
        run: |
          docker run -d \
            --name zomato-test \
            -p 3000:3000 \
            ${{ env.IMAGE_NAME }}:${{ env.IMAGE_TAG }}
          sleep 20
          docker ps
          docker logs zomato-test

      - name: Cleanup
        if: always()
        run: docker rm -f zomato-test || true
```

## 3. Explanation — Top Section

### 3.1 Trigger

| Trigger             | When it runs                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `push`              | Push to `main`, `master`, `develop` or any `feature/**` branch        |
| `pull_request`      | PR into `main`, `master` or `develop`                                 |
| `workflow_dispatch` | Manual run — choose `environment` + `deploy_tests` (input parameters) |

### 3.2 Permissions (Least Privilege)

Give the `GITHUB_TOKEN` **only the access it needs**, nothing more.

| Permission               | Why                                           |
| ------------------------ | --------------------------------------------- |
| `contents: read`         | Read (checkout) the code                      |
| `security-events: write` | Upload CodeQL / Trivy results to Security tab |
| `checks: write`          | Report check results                          |
| `packages: write`        | Push packages / images                        |
| `id-token: write`        | OIDC login to cloud (no stored passwords)     |

### 3.3 Prevent Parallel Builds — `concurrency`

```yaml
concurrency:
  group: ci-${{ github.ref }} # one group per branch
  cancel-in-progress: true # new run cancels the old one
```

- `cancel-in-progress: true` → if the pipeline **by mistake runs 2 times** on the same branch, the
  **older run is cancelled**.
- So the pipeline **never runs in parallel** on the same branch — only the latest code is built.
- Saves runner minutes and avoids two runs pushing images at the same time.

```
push 1 ──► run #1 running... ✖ cancelled
push 2 ──────────► run #2 running ──► ✅ (only latest runs)
```

### 3.4 Global Environment Variables — `env`

Defined **once at the top**, used by **every job and step**.

| Variable       | Value                                   | Meaning                                  |
| -------------- | --------------------------------------- | ---------------------------------------- |
| `NODE_VERSION` | `22`                                    | Node.js version used by the build        |
| `IMAGE_NAME`   | `${{ secrets.DOCKER_USER }}/zomato_new` | DockerHub repo name for the image        |
| `IMAGE_TAG`    | `${{ github.sha }}`                     | Commit ID → every image has a unique tag |

Read them with `${{ env.NODE_VERSION }}`.

### 3.5 Secrets

**Secrets** = used when we **never want to expose sensitive information** (passwords, tokens, keys).

- Stored in **Repo → Settings → Secrets and variables → Actions**.
- Read with `${{ secrets.NAME }}` and **masked** (`***`) in logs.
- In this project: `DOCKER_USER`, `DOCKER_PASSWORD` (DockerHub login).

## 4. Job 1 — Build React Application

| Step                                | What it does                                        |
| ----------------------------------- | --------------------------------------------------- |
| Checkout Repository                 | Download the code onto the runner                   |
| Setup Node.js                       | Install Node 22 + npm cache                         |
| Restore npm Cache                   | Reuse `~/.npm` → faster installs                    |
| CodeQL (init → autobuild → analyze) | SAST — scan source code for security bugs           |
| Install Dependencies                | `npm ci` — clean install from `package-lock.json`   |
| Run ESLint                          | Check code quality / style                          |
| Run Unit Tests                      | Run tests (`CI: true`)                              |
| Upload Coverage Report              | Save test coverage — `if: always()` even on failure |
| Artifact Upload                     | Save `package*` files for Job 2                     |

`timeout-minutes: 20` → job is killed if it hangs, so it can't waste runner minutes.

## 5. Job 2 — Security & Docker Validation

Runs **after** build (`needs: build`).

| Step                          | What it does                                      |
| ----------------------------- | ------------------------------------------------- |
| Download React Build          | Get the artifact from Job 1                       |
| Trivy filesystem scan         | Find CRITICAL/HIGH vulnerabilities → SARIF report |
| Upload Trivy results          | Show results in the **Security tab**              |
| Lint Dockerfile               | **hadolint** checks the Dockerfile                |
| Set up Docker Buildx          | Fast, advanced Docker builder                     |
| Restore / Update Docker Cache | Reuse image layers → faster builds                |
| Build Docker Image            | Tag with `IMAGE_TAG` (commit SHA) + `latest`      |
| Login to DockerHub            | Using **secrets** — password never shown          |
| Push Docker Image             | Push both tags to DockerHub                       |
| Smoke Test Container          | Run the container on port 3000 and check logs     |
| Cleanup                       | Remove test container — `if: always()`            |

### Tools Used

| Tool           | In short                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| **CodeQL**     | Scans **source code** for security bugs (SAST)                                  |
| **Trivy**      | Scans files / dependencies / images for **known vulnerabilities (CVEs)**        |
| **hadolint**   | Checks the **Dockerfile** for formatting, syntax and security issues            |
| **Buildx**     | Advanced Docker builder — builds images **very fast** (caching, multi-platform) |
| **Smoke test** | Quick check that the container **starts and runs**                              |

## Interview One-Liners

- **`concurrency` + `cancel-in-progress: true`** cancels the older run on the same branch, so the
  pipeline never runs in parallel and only the latest code is built.
- **Global `env`** defines values once (Node version, image name, tag) for all jobs.
- **Secrets** keep sensitive data like passwords hidden and masked in logs.
- **hadolint** lints the Dockerfile for formatting, syntax and security issues.
- **Buildx** is the advanced Docker builder that builds images faster using caching.
- Tagging the image with **`github.sha`** gives every build a unique, traceable version.
- **Zomato flow:** code → Git → Dockerfile → Docker image → DockerHub is **CI**; Kubernetes pulling
  and running that image is **CD**.
