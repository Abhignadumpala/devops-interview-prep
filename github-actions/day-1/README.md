# Day 1 — Intro, Workflows, Triggers, Node.js, Artifacts, CodeQL

[← All notes](../README.md) · [Day 2 →](../day-2/README.md)

- **Intro:** what CI/CD is and how GitHub Actions automates build, test, and deploy.
- **Workflows:** wrote my first workflow file in `.github/workflows/`.
- **Triggers:** runs on every push to `main`/`master`, or manually (`workflow_dispatch`).
- **Node.js:** installed the app's dependencies with npm.
- **Artifacts:** saved the build output so it can be downloaded or used by later jobs.
- **CodeQL:** added a security scan that finds vulnerabilities in the code.

## Simple CI Pipeline

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

## Screenshots

<!-- Put screenshots in ./images/ and show them like this:
![Workflow run in the Actions tab](./images/actions-run.png)
-->
