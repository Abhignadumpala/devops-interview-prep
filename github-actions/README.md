# GitHub Actions — Basics

Sources: [GitHub Docs](https://docs.github.com/en/actions/get-started/understand-github-actions) ·
[KodeKloud Notes](https://notes.kodekloud.com/) · Practice: [interview-questions.md](./interview-questions.md)

## 1. What is GitHub Actions?

GitHub Actions is GitHub's **built-in tool for CI/CD and automation**.

- You write a **YAML file** in your repo.
- When something happens (push, pull request, etc.), GitHub **runs it automatically**.
- Use it to **build, test, and deploy** code — no Jenkins or external tool needed.

> **Interview one-liner:** An **event** triggers a **workflow**. The workflow has **jobs**. Each job
> runs on a **runner** and has **steps**. A step is a shell command (`run`) or an **action**
> (`uses`).

![GitHub Actions workflow runs list](https://kodekloud.com/kk-media/image/upload/v1752870447/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-runs-interface.jpg)

![A workflow in progress](https://kodekloud.com/kk-media/image/upload/v1752870448/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-progress.jpg)

**GitHub manages the servers for you** — setup, scaling, and maintenance. You only write the
workflow. Runners are available on **Ubuntu, Windows, and macOS**.

![Ubuntu, Windows, macOS runners](https://kodekloud.com/kk-media/image/upload/v1752870449/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-ubuntu-windows-macos.jpg)

![GitHub manages infrastructure](https://kodekloud.com/kk-media/image/upload/v1752870450/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-manages-infrastructure-infographic.jpg)

## 2. Not Just CI/CD

**CI/CD:** build → test → lint → dockerize → security scan → deploy.

![CI/CD with GitHub Actions](https://kodekloud.com/kk-media/image/upload/v1752870453/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-cicd-diagram.jpg)

**Repo automation:** it can also react to issues, pull requests, releases, and packages. For
example, when a new PR is opened:

- Post a welcome comment
- Add labels based on changed files
- Assign reviewers

![Repository automation events](https://kodekloud.com/kk-media/image/upload/v1752870454/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-flowchart-automation.jpg)

## 3. Core Concepts

```text
Event ──► Workflow ──► Job(s) ──► runs on Runner ──► Step(s)
                                                     ├─ run:  shell command
                                                     └─ uses: action
```

| Term         | Simple meaning                                     | YAML key   |
| ------------ | -------------------------------------------------- | ---------- |
| **Workflow** | The automation file in `.github/workflows/*.yml`   | `name:`    |
| **Event**    | What starts the workflow (push, PR, schedule, …)   | `on:`      |
| **Job**      | A group of steps that run on one machine           | `jobs:`    |
| **Step**     | One task — a command or an action                  | `steps:`   |
| **Action**   | Ready-made reusable step (e.g. `actions/checkout`) | `uses:`    |
| **Runner**   | The machine (VM) that runs the job                 | `runs-on:` |
| **Matrix**   | Run the same job with many combos (OS × version)   | `matrix:`  |
| **Needs**    | Make one job wait for another                      | `needs:`   |

### Workflow + Events

- Files must be in **`.github/workflows/`** with `.yml` or `.yaml` extension.
- A repo can have **many workflows**.
- 3 ways to trigger: **event** (push/PR), **schedule** (cron), **manual** (`workflow_dispatch`).

```yaml
name: My Awesome App
on:
  push: # on every push
  pull_request: # on PRs to main
    branches: [main]
  schedule: # every day at midnight (UTC)
    - cron: '0 0 * * *'
  workflow_dispatch: # manual "Run workflow" button
```

### Jobs + Steps

- **Jobs run in parallel** by default. Use `needs:` to run them in order.
- **Steps run one after another** on the same machine, so they share files.
- Different jobs = different machines → they **don't share files** (use artifacts).

```yaml
jobs:
  unit-testing:
    strategy:
      matrix: # 3 OS × 2 versions = 6 runs
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18, 20]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4 # get the code
      - uses: actions/setup-node@v4 # install Node.js
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci # install dependencies
      - run: npm test # run tests

  deploy:
    needs: unit-testing # runs only after all tests pass
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying..."
```

## 4. Runners

Every job gets a **fresh, clean VM**. Nothing is saved between runs (use cache/artifacts). One
runner runs **one job at a time**. After a run, check logs and download artifacts from the
**Actions** tab.

![Job running on Windows, Ubuntu, macOS runners](https://kodekloud.com/kk-media/image/upload/v1752870456/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-actions-workflow-runners.jpg)

|                   | GitHub-hosted                      | Self-hosted                       |
| ----------------- | ---------------------------------- | --------------------------------- |
| **Where**         | GitHub's cloud                     | Your own server / cloud           |
| **Customization** | Only pre-installed tools           | Full control (GPU, custom OS…)    |
| **Cost**          | Free minutes in plan, limits apply | You pay for servers + maintenance |
| **Managed by**    | GitHub                             | You                               |

![GitHub-hosted vs self-hosted runners](https://kodekloud.com/kk-media/image/upload/v1752870456/notes-assets/images/Certified-Jenkins-Engineer-Github-Actions-Basics/github-self-hosted-runners-comparison.jpg)

> ⚠️ GitHub-hosted runners have **usage limits** based on your plan — check
> [Billing settings](https://github.com/settings/billing).

## 5. Remember These

- Workflow files live in **`.github/workflows/`**.
- **Jobs = parallel**, **steps = sequential**.
- `run:` = shell command, `uses:` = action.
- Each job gets a **fresh VM**.
- **Pin action versions** (`@v4`) for safe, repeatable builds.
- Use `npm ci` in CI (exact versions from the lock file).
