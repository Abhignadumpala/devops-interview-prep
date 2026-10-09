# Day 5 — Input & Output Parameters, GitHub Copilot, Zomato CI

[← Day 4](../day-4/README.md) · [All notes](../README.md)

- **Inputs:** values passed **into** a workflow, reusable workflow or action (like function
  arguments).
- **Outputs:** values passed **out of** a step, job, reusable workflow or action (like a function's
  return value).
- **Secrets:** sensitive inputs (passwords, tokens) — passed separately and hidden in logs.
- **GitHub Copilot:** an AI coding assistant that helps generate, understand, troubleshoot, and
  improve code and automation.
- **Zomato CI integration:** enterprise CI pipeline — build, CodeQL, Trivy, hadolint, Docker
  Buildx, push to DockerHub, smoke test → [Zomato CI notes](./zomato-ci/README.md)

<!-- toc -->

## Table of Contents

- [1. What are Parameters?](#1-what-are-parameters)
  - [Why & When We Use Them](#why--when-we-use-them)
  - [Benefits](#benefits)
  - [Example — Node.js CI with Input Parameters](#example--nodejs-ci-with-input-parameters)
  - [Run Workflow Options](#run-workflow-options)
- [2. Inputs](#2-inputs)
  - [2.1 Manual Run Inputs — `workflow_dispatch`](#21-manual-run-inputs--workflow_dispatch)
  - [2.2 Reusable Workflow Inputs — `workflow_call`](#22-reusable-workflow-inputs--workflow_call)
  - [2.3 Composite Action Inputs](#23-composite-action-inputs)
  - [Input Types](#input-types)
- [3. Secrets](#3-secrets)
- [4. Outputs](#4-outputs)
  - [4.1 Step Output](#41-step-output)
  - [4.2 Job Output — Pass Data Between Jobs](#42-job-output--pass-data-between-jobs)
  - [4.3 Reusable Workflow Output](#43-reusable-workflow-output)
  - [4.4 Composite Action Output](#44-composite-action-output)
- [5. How Data Flows](#5-how-data-flows)
- [6. Inputs vs Outputs vs Env vs Secrets](#6-inputs-vs-outputs-vs-env-vs-secrets)
- [7. Common Mistakes](#7-common-mistakes)
- [8. GitHub Copilot](#8-github-copilot)
- [Interview One-Liners](#interview-one-liners)

<!-- tocstop -->

## 1. What are Parameters?

**Parameters** are nothing but **inputs**. Whenever we want to pass any input into our pipeline, we
use the **`inputs:` block**. The same pipeline can then work with different values **without
changing the code**.

| Parameter            | In short                                                     | Example                |
| -------------------- | ------------------------------------------------------------ | ---------------------- |
| **Input parameter**  | A value we **give to** a workflow/job/action before it runs  | `environment: prod`    |
| **Output parameter** | A value a step/job **produces** for the next step/job to use | `image-tag: app:1.2.3` |

Think of a workflow like a **function**:

```
          inputs                         outputs
 caller ──────────► [ workflow / job ] ──────────► next job / caller
 (environment=dev)                     (version=1.2.3)
```

### Why & When We Use Them

| Scenario                                            | Parameter used                        |
| --------------------------------------------------- | ------------------------------------- |
| Deploy the same pipeline to dev / staging / prod    | **Input** — `environment`             |
| Choose Node version or run tests only (dry run)     | **Input** — `node-version`, `dry-run` |
| Manual run with a form in the Actions tab           | **Input** — `workflow_dispatch`       |
| Build job creates an image tag, deploy job needs it | **Output** — job output + `needs`     |
| Reusable workflow returns a version to the caller   | **Output** — `workflow_call.outputs`  |

### Benefits

- **Reusable** — one pipeline for many environments/projects, no copy-paste.
- **No hard-coding** — values change at run time, not in the YAML.
- **Jobs can share data** — each job runs on its own runner; outputs connect them.
- **Fewer mistakes** — types, defaults and `choice` lists stop wrong values.
- **Easy to maintain** — fix once in the shared pipeline, every caller gets the fix.

> **Input = data IN. Output = data OUT.**

### Example — Node.js CI with Input Parameters

```yaml
name: Node.js CI

on:
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

jobs:
  ci:
    name: Build, Lint and Test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout source code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: echo "ci is done"

      - name: Run ESLint
        run: npm run lint

      - name: Check formatting
        run: npm run format:check

      - name: Run tests
        if: ${{ inputs.deploy_tests }}
        run: npm run test:ci

      - name: Build application
        run: npm run build
```

| Input          | Type      | What it does                                                    |
| -------------- | --------- | --------------------------------------------------------------- |
| `environment`  | `choice`  | Dropdown in the Actions tab: development / staging / production |
| `deploy_tests` | `boolean` | Checkbox — `Run tests` step runs only if it's `true` (`if:`)    |

### Run Workflow Options

With `workflow_dispatch`, the **Actions tab → Run workflow** button opens a form. We choose **from
which branch** the workflow runs and **to where (which environment)** we pass the inputs.

```
┌─ Run workflow ───────────────────────────┐
│ Use workflow from                        │
│ [ Branch: main          ▼ ]  ← branch    │
│                                          │
│ Target environment *                     │
│ [ development           ▼ ]  ← choice    │
│   development / staging / production     │
│                                          │
│ [✓] Run integration tests?   ← boolean   │
│                                          │
│            [ Run workflow ]              │
└──────────────────────────────────────────┘
```

| Option                 | Comes from                  | Example       |
| ---------------------- | --------------------------- | ------------- |
| **Use workflow from**  | Always there (branch / tag) | `main`, `dev` |
| **Target environment** | `environment` input         | `development` |
| **Run tests?**         | `deploy_tests` input        | ✓ = `true`    |

> **Branch = which code runs. Inputs = how it runs.**

## 2. Inputs

**Input** = a value given **to** a workflow or action when it starts. Read it with
**`${{ inputs.<name> }}`**.

| Where inputs are defined         | Who gives the value                  |
| -------------------------------- | ------------------------------------ |
| `on: workflow_dispatch: inputs:` | A **person** clicking "Run workflow" |
| `on: workflow_call: inputs:`     | A **caller workflow** using `with:`  |
| `action.yml` → `inputs:`         | A **step** using `uses:` + `with:`   |

### 2.1 Manual Run Inputs — `workflow_dispatch`

Shows a form in the **Actions tab** when you run the workflow by hand.

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Where to deploy'
        type: choice
        options: [dev, staging, prod]
        default: dev
      dry-run:
        type: boolean
        default: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying to ${{ inputs.environment }} (dry run = ${{ inputs.dry-run }})"
```

### 2.2 Reusable Workflow Inputs — `workflow_call`

From my Day 4 lab: the reusable pipeline **declares** the input, the caller **sends** it with `with:`.

```yaml
# reusable-pipeline.yml  (the callee)
on:
  workflow_call:
    inputs:
      environment:
        type: string # type is REQUIRED for workflow_call
        default: 'dev'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo "code is deployed to ${{ inputs.environment }}"
```

```yaml
# call-reusable.yml  (the caller)
jobs:
  pipeline:
    uses: ./.github/workflows/reusable-pipeline.yml
    with:
      environment: 'prod' # → inputs.environment
```

### 2.3 Composite Action Inputs

```yaml
# .github/actions/setup-node-app/action.yml
inputs:
  node-version:
    description: 'Node version to use'
    required: false
    default: '20'

runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version }}
```

```yaml
# used inside a workflow
- uses: ./.github/actions/setup-node-app
  with:
    node-version: '22'
```

### Input Types

| Type          | Example value     | Available in             |
| ------------- | ----------------- | ------------------------ |
| `string`      | `'dev'`           | dispatch + call          |
| `boolean`     | `true`            | dispatch + call          |
| `number`      | `3`               | dispatch + call          |
| `choice`      | dropdown list     | `workflow_dispatch` only |
| `environment` | repo environments | `workflow_dispatch` only |

> Composite action inputs have **no type** — they are always **strings**.

## 3. Secrets

Secrets are **not** passed as normal inputs. A reusable workflow declares them under `secrets:`.

```yaml
# callee
on:
  workflow_call:
    secrets:
      AWS_ACCESS_KEY_ID:
        required: true
```

```yaml
# caller — pass one secret...
jobs:
  pipeline:
    uses: ./.github/workflows/reusable-pipeline.yml
    secrets:
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
```

```yaml
# ...or pass ALL secrets of the caller
secrets: inherit
```

- Secrets are **masked** (`***`) in logs.
- Never send a password through `with:` — it can show up in logs.

## 4. Outputs

**Output** = a value a step/job **produces** so a later step/job can use it.

| Level             | Set with                             | Read with                          |
| ----------------- | ------------------------------------ | ---------------------------------- |
| Step              | `echo "key=value" >> $GITHUB_OUTPUT` | `steps.<step-id>.outputs.<key>`    |
| Job               | `jobs.<job>.outputs:`                | `needs.<job>.outputs.<key>`        |
| Reusable workflow | `on.workflow_call.outputs:`          | `needs.<caller-job>.outputs.<key>` |
| Composite action  | `outputs:` in `action.yml`           | `steps.<step-id>.outputs.<key>`    |

### 4.1 Step Output

A step **must have an `id`** so other steps can find its output.

```yaml
steps:
  - id: version # ← id is required
    run: echo "tag=1.2.3" >> $GITHUB_OUTPUT

  - run: echo "Version is ${{ steps.version.outputs.tag }}"
```

> Old way `::set-output` is **deprecated** — always use `$GITHUB_OUTPUT`.

### 4.2 Job Output — Pass Data Between Jobs

Each job runs on a **separate runner**, so jobs can't see each other's variables. Use **job outputs +
`needs`**.

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.tag.outputs.tag }} # step output → job output
    steps:
      - id: tag
        run: echo "tag=app:${{ github.sha }}" >> $GITHUB_OUTPUT

  deploy:
    needs: build # needs is REQUIRED to read build's outputs
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.image-tag }}"
```

```
build job                                  deploy job
┌──────────────────────────┐   needs:     ┌─────────────────────────────────┐
│ step id=tag              │ ───────────► │ needs.build.outputs.image-tag   │
│  → $GITHUB_OUTPUT        │              └─────────────────────────────────┘
│ outputs: image-tag       │
└──────────────────────────┘
```

### 4.3 Reusable Workflow Output

Three hops: **step → job → workflow**, then the caller reads it.

```yaml
# callee
on:
  workflow_call:
    outputs:
      image-tag:
        value: ${{ jobs.build.outputs.image-tag }} # job output → workflow output

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      image-tag: ${{ steps.tag.outputs.tag }} # step output → job output
    steps:
      - id: tag
        run: echo "tag=app:1.2.3" >> $GITHUB_OUTPUT
```

```yaml
# caller
jobs:
  pipeline:
    uses: ./.github/workflows/reusable-pipeline.yml

  notify:
    needs: pipeline
    runs-on: ubuntu-latest
    steps:
      - run: echo "Built ${{ needs.pipeline.outputs.image-tag }}"
```

### 4.4 Composite Action Output

```yaml
# action.yml
outputs:
  tag:
    value: ${{ steps.make-tag.outputs.tag }} # value: is required in composite
runs:
  using: composite
  steps:
    - id: make-tag
      shell: bash
      run: echo "tag=1.2.3" >> $GITHUB_OUTPUT
```

```yaml
# workflow
- id: my-action
  uses: ./.github/actions/make-tag
- run: echo "${{ steps.my-action.outputs.tag }}"
```

## 5. How Data Flows

```
             with: / secrets:                         needs.<job>.outputs
 Caller ─────────────────────────► Reusable workflow ─────────────────────► Next caller job
                                        │
                                        ▼
                               job ── outputs ──► other job (needs:)
                                ▲
                                │
                     step ── $GITHUB_OUTPUT ──► steps.<id>.outputs
```

| Want to send data…         | Use                                |
| -------------------------- | ---------------------------------- |
| Into a workflow / action   | `inputs` (`with:`)                 |
| Step → step (same job)     | step output (`steps.<id>.outputs`) |
| Job → job                  | job output + `needs`               |
| Reusable workflow → caller | `workflow_call.outputs`            |
| Files between jobs         | **artifacts** (Day 2), not outputs |

## 6. Inputs vs Outputs vs Env vs Secrets

|                | Inputs              | Outputs                | Env                      | Secrets                 |
| -------------- | ------------------- | ---------------------- | ------------------------ | ----------------------- |
| **Direction**  | Into                | Out of                 | Inside workflow/job/step | Into                    |
| **Read with**  | `inputs.x`          | `steps.*` / `needs.*`  | `env.X` or `$X`          | `secrets.X`             |
| **Sensitive?** | No                  | No                     | No                       | Yes — masked            |
| **Example**    | `environment: prod` | `image-tag: app:1.2.3` | `NODE_ENV: test`         | `AWS_SECRET_ACCESS_KEY` |

## 7. Common Mistakes

| Mistake                                  | Fix                                                |
| ---------------------------------------- | -------------------------------------------------- |
| Step output is empty                     | Add an **`id:`** to the step                       |
| `needs.build.outputs.x` is empty         | Add **`needs: build`** and map it under `outputs:` |
| Missing `type:` in `workflow_call` input | `type` is **required** for `workflow_call` inputs  |
| Passing a password with `with:`          | Use **`secrets:`** or `secrets: inherit`           |
| Using `::set-output`                     | Use **`$GITHUB_OUTPUT`**                           |
| Sending a big file as an output          | Outputs are small strings — use **artifacts**      |

## 8. GitHub Copilot

**GitHub Copilot** = an AI coding assistant that helps generate, understand, troubleshoot, and
improve code and automation.

**In DevOps / GitHub Actions, Copilot helps with:**

| Use                     | Example                                             |
| ----------------------- | --------------------------------------------------- |
| Writing YAML            | "Write a workflow with a `workflow_dispatch` input" |
| Understanding workflows | "Explain what this workflow does"                   |
| Creating scripts        | Bash / shell scripts for build and deploy           |
| Troubleshooting errors  | Paste a failed log → ask why it failed              |
| Explaining commands     | "What does `npm ci` do?"                            |
| Improving code          | Make a script shorter, safer or faster              |
| Generating tests        | Unit tests for a function                           |

**Interview definition:** GitHub Copilot is an AI coding assistant that helps developers and DevOps
engineers generate, understand, troubleshoot, and improve code and automation such as GitHub
Actions workflows.

> **Copilot = AI assistant for coding and automation.**

## Interview One-Liners

- **Parameters** let us pass data into and out of workflows/jobs so one pipeline works with
  different values without changing code.
- **Inputs** pass values into a workflow or action; read them with `${{ inputs.name }}`.
- **`workflow_dispatch` inputs** create a form for manual runs; **`workflow_call` inputs** are sent
  by a caller workflow with `with:`.
- **Outputs** pass values out — step → `$GITHUB_OUTPUT`, job → `outputs:` + `needs`, reusable
  workflow → `on.workflow_call.outputs`.
- Jobs run on **separate runners**, so **job outputs + `needs`** is how they share small values;
  files go through **artifacts**.
- **Secrets** are passed with `secrets:` or `secrets: inherit`, never with `with:`, and are masked in
  logs.
- **GitHub Copilot** is an AI coding assistant that helps generate, understand, troubleshoot, and
  improve code and automation such as GitHub Actions workflows.
