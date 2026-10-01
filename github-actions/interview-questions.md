# GitHub Actions — Interview Questions

Based on [Understanding GitHub Actions](https://docs.github.com/en/actions/get-started/understand-github-actions).
Notes: [README.md](./README.md)

### 1. What is GitHub Actions?

A CI/CD and automation platform built into GitHub. It lets you build, test, and deploy code, and
automate any repository task (labeling issues, releases, etc.) in response to events.

### 2. What are the main components of GitHub Actions?

**Workflows, events, jobs, steps, actions, and runners.** An event triggers a workflow; the workflow
has jobs; each job runs on a runner and consists of steps; each step is a shell command or an
action.

### 3. Where are workflows stored and in what format?

As **YAML** files in the **`.github/workflows/`** directory of the repository.

### 4. Can a repository have more than one workflow?

Yes. Each workflow can do something different — e.g. one for PR tests, one for deployments on
release, one for issue triage.

### 5. What are the ways to trigger a workflow?

1. A repository **event** (`push`, `pull_request`, `issues`, `release`, …)
2. **Manually** — `workflow_dispatch`
3. A **schedule** — `schedule` with cron syntax
4. An external call to the **REST API** — `repository_dispatch`

### 6. Do jobs run in parallel or sequentially?

**In parallel by default.** Use `needs:` to make a job wait for another job to finish.

### 7. Do steps run in parallel or sequentially?

**Sequentially**, in the order defined, on the same runner.

### 8. How do steps in the same job share data? Can different jobs share data the same way?

Steps run on the **same runner**, so they share the filesystem and environment — a build step's
output can be used by the next test step. Different jobs run on **different runners (fresh VMs)**, so
they must share data via **artifacts** (`actions/upload-artifact` / `download-artifact`) or job
**outputs**.

### 9. What is the difference between `run` and `uses`?

- `run:` executes a **shell command/script** on the runner.
- `uses:` invokes a **reusable action** (e.g. `actions/checkout@v4`).

### 10. What is an action? Give examples.

A pre-defined, reusable piece of code for a common task, used to reduce repetition. Examples:
`actions/checkout` (clone repo), `actions/setup-node` (install toolchain),
`aws-actions/configure-aws-credentials` (cloud auth). Found in the **GitHub Marketplace** or
written yourself.

### 11. Why pin action versions? How?

To get reproducible builds and protect against malicious or breaking changes. Pin a tag
(`@v4`) or — more secure — a **full commit SHA**.

### 12. What is a runner? What types exist?

A server that executes a workflow job. Each runner runs **one job at a time**.

- **GitHub-hosted**: Ubuntu, Windows, macOS (plus larger runners).
- **Self-hosted**: your own machine — for custom OS, hardware, or network access.

### 13. When would you choose a self-hosted runner?

When you need a specific OS/hardware (GPU, ARM), access to private network resources, bigger or
cheaper compute, or pre-installed tooling/caches that persist.

### 14. Is anything preserved between workflow runs on GitHub-hosted runners?

No. **Each run gets a fresh, newly-provisioned VM.** Use `actions/cache` for dependencies and
artifacts for build outputs.

### 15. What is a matrix strategy?

Running the same job multiple times with different variable combinations, e.g. testing on Node
18/20/22 across Linux and Windows:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
    node: [18, 20, 22]
runs-on: ${{ matrix.os }}
```

### 16. Scenario: build for 3 architectures, then package once all succeed. How?

Three build jobs (or one matrix job) with no dependencies run **in parallel**; a `package` job with
`needs: [build]` runs only after all of them succeed.

### 17. Walk through a basic CI workflow for a Node.js app.

Trigger on `push`/`pull_request` to `main` → job on `ubuntu-latest` → `actions/checkout` →
`actions/setup-node` with npm cache → `npm ci` → lint → format check → test → build. See the worked
example in [README.md](./README.md#8-example--nodejs-ci-workflow).

### 18. What is `npm ci` and why use it in CI instead of `npm install`?

`npm ci` installs exactly what's in `package-lock.json`, fails if it's out of sync with
`package.json`, and deletes `node_modules` first — giving clean, reproducible, faster installs.
