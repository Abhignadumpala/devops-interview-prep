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

## Artifacts + CodeQL

Added a real build that saves `dist/` as an **artifact**, and a **CodeQL** security scan that runs
**in parallel** with the build.

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
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4 # NODE.JS: install Node 22
        with:
          node-version: 22
      - run: npm ci # install exact dependencies from package-lock.json
      - run: npm test
      - run: npm run build # creates dist/
      - uses: actions/upload-artifact@v4 # ARTIFACT: save dist/ from this run
        with:
          name: app-build
          path: dist/

  codeql: # separate job → runs at the SAME TIME as build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write # allows uploading results to the Security tab
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v4 # CODEQL: start the scan
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v4 # CODEQL: analyse and upload results
```

- **Artifact:** a file or folder saved from a run. Here: name **`app-build`**, folder
  **`dist/`**. Full details are in [Day 2 → Artifact](../day-2/README.md#artifact--name-path-and-where-to-find-it).
- Download it from the run page (**Artifacts**
  section), or pass it to a later job with `actions/download-artifact`.
- **CodeQL:** GitHub's security scanner (**SAST**). It finds problems like user input reaching a
  database query. Results appear in **Security → Code scanning**.
- **`permissions`:** the workflow only gets the access it needs. Only the `codeql` job can write
  security results.
- JavaScript isn't compiled, so CodeQL scans the code directly (no build step needed).

## Screenshots

<!-- Put screenshots in ./images/ and show them like this:
![Workflow run in the Actions tab](./images/actions-run.png)
-->
