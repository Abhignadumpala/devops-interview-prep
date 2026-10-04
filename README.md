# Secure DevSecOps Pipeline

A small Node.js app used to practise building a **CI/CD pipeline with GitHub Actions**, adding
security checks step by step. The app itself is tiny on purpose: the focus is the **pipeline**,
not the app.

> Notes on GitHub Actions concepts: [github-actions/README.md](./github-actions/README.md)

## Project Structure

```
devops-interview-prep/
├── .github/workflows/ci.yml       # The CI/CD pipeline (GitHub Actions)
├── src/
│   ├── services/
│   │   └── calculator.js          # Business logic: add, subtract, multiply, divide
│   ├── app.js                     # Express app: routes (does NOT start the server)
│   └── server.js                  # Entry point: starts the app on a port
├── tests/
│   ├── app.test.js                # API tests for src/app.js (Supertest)
│   └── calculator.test.js         # Unit tests for src/services/calculator.js
├── package.json                   # Project info, scripts, dependencies
├── package-lock.json              # Exact versions of every installed package
├── eslint.config.js               # ESLint rules (code quality)
├── .prettierrc                    # Prettier rules (code formatting)
├── .prettierignore                # Files Prettier should skip
├── .gitignore                     # Files Git should not track
└── github-actions/                # Study notes (not part of the app)
```

**Naming rules used:**

- Folders and files are **lowercase**.
- Each file has **one job**, and its name says what that job is.
- A test file is named after the file it tests: `app.js` → `app.test.js`,
  `calculator.js` → `calculator.test.js`.

## Files in Short

| File                         | What it has                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| `src/app.js`                 | The **complete application code**: all routes and responses           |
| `src/server.js`              | The **port number** (`3000`) and the code that starts the app on it   |
| `src/services/calculator.js` | The **maths logic**: add, subtract, multiply, divide                  |
| `tests/`                     | The **tests** that check the app and the calculator work              |
| `package.json`               | **All dependencies and libraries** the project uses, plus the scripts |
| `package-lock.json`          | The **exact versions** of every installed library                     |
| `eslint.config.js`           | **Lint** rules: checks the code for mistakes                          |
| `.prettierrc`                | **Formatting** rules: how the code should look                        |
| `.prettierignore`            | Files Prettier should **not format**                                  |
| `.gitignore`                 | Files Git should **ignore** (not upload to GitHub)                    |
| `.github/workflows/ci.yml`   | The **CI/CD pipeline** that runs on every push                        |

## API Endpoints

| Method | Route                     | Example response                                      |
| ------ | ------------------------- | ----------------------------------------------------- |
| GET    | `/`                       | `{ "message": "...is running", "status": "success" }` |
| GET    | `/health`                 | `{ "status": "UP", "service": "nodejs-ci-demo" }`     |
| GET    | `/api/add?a=20&b=10`      | `{ "operation": "addition", "result": 30 }`           |
| GET    | `/api/subtract?a=20&b=10` | `{ "operation": "subtraction", "result": 10 }`        |
| GET    | `/api/multiply?a=20&b=10` | `{ "operation": "multiplication", "result": 200 }`    |
| GET    | `/api/divide?a=20&b=10`   | `{ "operation": "division", "result": 2 }`            |
| GET    | `/api/divide?a=20&b=0`    | **400** `{ "error": "Cannot divide by zero" }`        |
| GET    | any other route           | **404** `{ "error": "Route not found" }`              |

`/health` is a **health check**: load balancers, Docker, and Kubernetes call it to know whether the
app is alive.

## Files Explained

### 1. `src/` — the application

#### `src/services/calculator.js` — business logic

```js
function add(a, b) {
  return a + b;
}
// subtract and multiply work the same way

function divide(a, b) {
  if (b === 0) {
    throw new Error('Cannot divide by zero'); // stop with an error instead of returning Infinity
  }
  return a / b;
}

module.exports = { add, subtract, multiply, divide }; // export so app.js and tests can use them
```

**Services** hold the app's logic: plain functions with no web code, so they're easy to test.

#### `src/app.js` — the Express app (routes)

```js
const express = require('express'); // web framework: makes routes simple
const { add, subtract, multiply, divide } = require('./services/calculator');

const app = express();
app.use(express.json()); // read JSON request bodies

// a route: when someone calls GET /health, send this JSON back
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'nodejs-ci-demo' });
});

app.get('/api/add', (req, res) => {
  const a = Number(req.query.a); // ?a=20 arrives as the text "20", so convert to a number
  const b = Number(req.query.b);
  res.json({ operation: 'addition', result: add(a, b) });
});

app.get('/api/divide', (req, res) => {
  try {
    const result = divide(Number(req.query.a), Number(req.query.b));
    res.json({ operation: 'division', result });
  } catch (error) {
    res.status(400).json({ error: error.message }); // 400 = bad request (divide by zero)
  }
});

// runs only if no route above matched → 404 Not Found
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app; // export the app WITHOUT starting it
```

(Shortened. `/`, `/api/subtract` and `/api/multiply` follow the same pattern.)

**Routes call the service:** `app.js` only handles HTTP (read the request, send a response). The
maths lives in `calculator.js`.

#### `src/server.js` — the entry point

```js
const app = require('./app');

const PORT = process.env.PORT || 3000; // use PORT env var, else 3000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`); // start listening for requests
});
```

This is the only file that calls `listen()`. `npm start` runs it.

#### Why split into `app.js` and `server.js`?

A running server **never exits by design**: it waits for requests forever. Tests **must exit**, so
CI can move to the next step. So the code that **starts** the server lives only in `server.js`,
and **tests never import it**.

| File                     | Starts the server? | Imported by tests? |
| ------------------------ | ------------------ | ------------------ |
| `services/calculator.js` | ❌                 | ✅                 |
| `app.js`                 | ❌                 | ✅                 |
| `server.js`              | ✅                 | ❌ Never           |

**What happens if a test loads a file that starts the server:**

1. `require()` runs **all** the code in that file, so the server starts on port 3000.
2. The tests **pass**.
3. Node exits only when nothing is left running, but the server is still listening, so `npm test`
   **never finishes**.
4. The CI job hangs until GitHub kills it (15 min on `ubuntu-slim`, 6 h by default) and marks it
   **❌ failed**, even though the code is correct.

Also, two test files starting the server would both use port 3000, and the second would crash with
`EADDRINUSE`.

> **Interview one-liner:** I keep `app` (the routes) separate from `server` (starting it on a
> port). Tests import the app and logic, never `server.js`, so they don't open a port and the test
> run always exits.

### 2. `tests/` — Jest tests

Tests use **Jest** (test runner) and **Supertest** (sends fake HTTP requests to the app without
opening a real port).

#### `tests/calculator.test.js` — unit tests

Tests each calculator function **directly**, with no HTTP involved.

```js
const { add, divide } = require('../src/services/calculator');

describe('Calculator Service', () => {
  // describe = a group of related tests
  test('should add two numbers', () => {
    expect(add(10, 5)).toBe(15); // fails if add(10, 5) is not 15
  });

  test('should throw error when dividing by zero', () => {
    expect(() => divide(10, 0)).toThrow('Cannot divide by zero'); // expects an error
  });
});
```

#### `tests/app.test.js` — API tests

Tests the **routes** the way a real user would call them.

```js
const request = require('supertest');
const app = require('../src/app'); // the app, NOT server.js

describe('API Tests', () => {
  test('GET /api/add should return correct result', async () => {
    const response = await request(app).get('/api/add').query({ a: 20, b: 10 });

    expect(response.statusCode).toBe(200); // HTTP status
    expect(response.body.result).toBe(30); // JSON body
  });

  test('unknown route should return 404', async () => {
    const response = await request(app).get('/unknown');

    expect(response.statusCode).toBe(404);
  });
});
```

(Shortened. The real files test every route and function: **14 tests, 100% coverage**.)

| Test type     | File                 | What it checks                                     |
| ------------- | -------------------- | -------------------------------------------------- |
| **Unit test** | `calculator.test.js` | One function on its own: is the maths right?       |
| **API test**  | `app.test.js`        | The whole route: status code, JSON, error handling |

If any test fails, `npm test` exits with an error, and **the CI job fails**. That's how a pipeline
stops broken code.

### 3. `package.json` — project info and commands

| Field             | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| `name`, `version` | Project name (`secure-devsecops-pipeline`) and version    |
| `main`            | Entry file of the project (`src/server.js`)               |
| `scripts`         | Short commands you run with `npm run <name>` (used in CI) |
| `engines`         | Node version the app needs (`>=20`)                       |
| `dependencies`    | Packages the app needs **to run** (in production)         |
| `devDependencies` | Tools needed only for development/CI, not to run the app  |
| `license`         | MIT: anyone can use the code                              |

**Scripts:**

| Command                | Runs                                                      | Purpose                                   |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------- |
| `npm start`            | `node src/server.js`                                      | Start the server                          |
| `npm run dev`          | `node --watch src/server.js`                              | Restart automatically when a file changes |
| `npm run lint`         | `eslint .`                                                | Check code quality                        |
| `npm run format`       | `prettier --write .`                                      | Auto-fix formatting (local use)           |
| `npm run format:check` | `prettier --check .`                                      | Only check formatting, don't change (CI)  |
| `npm test`             | `jest --runInBand --coverage`                             | Run all tests + coverage report           |
| `npm run test:ci`      | `jest --runInBand --coverage --ci`                        | Same, in CI mode                          |
| `npm run build`        | `mkdir -p dist && cp -r src/. dist/`                      | Copy the app into `dist/` to deploy       |
| `npm run ci`           | `npm run lint && npm run format:check && npm run test:ci` | All checks in one command                 |

- **`--runInBand`**: run test files one after another, not in parallel. Steadier on small CI
  runners.
- **`--coverage`**: shows which lines the tests ran, and writes a report to `coverage/`.
- **`--ci`**: stricter CI mode (e.g. never writes new snapshots).
- **`&&`**: run the next command only if the previous one passed.

**dependencies** (needed to run the app):

| Package   | What it is                        |
| --------- | --------------------------------- |
| `express` | Web framework for routes and JSON |

**devDependencies** (needed only to develop and check the app):

| Package      | What it is                                                    |
| ------------ | ------------------------------------------------------------- |
| `jest`       | Test runner: `describe`, `test`, `expect`, coverage           |
| `supertest`  | Sends HTTP requests to the app inside tests                   |
| `eslint`     | The linter (finds bugs and bad patterns)                      |
| `@eslint/js` | ESLint's recommended rule set                                 |
| `globals`    | Lists of global names (Node, Jest) so ESLint knows they exist |
| `prettier`   | The code formatter                                            |

### 4. `package-lock.json` — exact versions

`package.json` says `"express": "^5.2.1"`, meaning _"5.2.1 or any newer 5.x"_. The lock file
records the **exact** version installed (and of every sub-dependency), plus an `integrity` hash
(checksum).

- **Same install everywhere:** your laptop and the CI runner get identical packages.
- **Security:** if a downloaded package doesn't match its `integrity` hash, npm refuses it.
- CI uses **`npm ci`**, which installs strictly from this file (and fails if it doesn't match
  `package.json`).

Never edit it by hand. npm updates it.

### 5. `eslint.config.js` — linting rules

```js
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'coverage/', 'dist/'] }, // don't lint these folders
  js.configs.recommended, // turn on ESLint's recommended rules
  {
    languageOptions: {
      ecmaVersion: 2022, // allow modern JavaScript syntax
      sourceType: 'commonjs', // we use require/module.exports
      globals: globals.node, // process, console, require, module are allowed
    },
    rules: {
      'no-unused-vars': 'error', // variable created but never used → fail
      'no-undef': 'error', // variable used but never created → fail
      'no-console': 'off', // console.log is allowed (server.js uses it)
    },
  },
  {
    files: ['tests/**/*.js'], // only for test files:
    languageOptions: {
      globals: globals.jest, // describe, test, expect, jest are allowed
    },
  },
];
```

Without `globals.node`, ESLint would report `process` and `console` as undefined. Without
`globals.jest`, it would report `describe`, `test` and `expect` as undefined in the tests.

### 6. `.prettierrc` — formatting rules

```json
{
  "singleQuote": true, // 'hello' instead of "hello"
  "semi": true, // end statements with ;
  "trailingComma": "all", // add comma after the last item in lists/objects
  "printWidth": 100 // wrap lines longer than 100 characters
}
```

(Comments shown only for explanation. Real JSON can't contain comments.)

Prettier only changes **how code looks**, never what it does. One shared style means code
reviews focus on logic, not on spaces and quotes.

### 7. `.prettierignore` — files Prettier skips

```
node_modules/       # installed packages: not our code
dist/               # build output: generated
coverage/           # test coverage report: generated
package-lock.json   # generated by npm, must not be reformatted
```

### 8. `.gitignore` — files Git doesn't track

```
node_modules/   # can be re-created anytime with npm ci, and is huge
dist/           # build output: CI creates it fresh each run
coverage/       # test coverage report: created by npm test
.env            # secrets and passwords: NEVER commit
npm-debug.log*  # npm error logs
.DS_Store       # macOS folder files
```

## Lint vs Format vs Test vs CodeQL

These are often confused. They are **four different checks**:

| Check      | Tool     | Question it answers                | Example problem it finds                    |
| ---------- | -------- | ---------------------------------- | ------------------------------------------- |
| **Format** | Prettier | Does the code **look** consistent? | Double quotes instead of single quotes      |
| **Lint**   | ESLint   | Is the code **written correctly**? | Unused variable, undefined variable         |
| **Test**   | Jest     | Does the code **work**?            | `add(2, 3)` returns `6` instead of `5`      |
| **SAST**   | CodeQL   | Is the code **secure**?            | SQL injection, user input used in a command |

### Is ESLint the same as CodeQL?

**No.** Both read code without running it (**static analysis**), but they have different goals:

|                  | ESLint                                  | CodeQL                                                                 |
| ---------------- | --------------------------------------- | ---------------------------------------------------------------------- |
| Goal             | **Code quality** and common mistakes    | **Security vulnerabilities**                                           |
| Made by          | Open-source community                   | GitHub                                                                 |
| How it works     | Checks rules on each file, line by line | Builds a database of the code and follows how data flows between files |
| Speed            | Seconds                                 | Minutes                                                                |
| Runs             | Locally and in CI (`npm run lint`)      | In GitHub Actions (`github/codeql-action`)                             |
| Results shown in | Terminal / CI log                       | GitHub **Security** tab → Code scanning alerts                         |
| DevSecOps term   | Linter                                  | **SAST** (Static Application Security Testing)                         |

**Simple way to remember:** ESLint finds **mistakes**, CodeQL finds **attacks**. ESLint would warn
about an unused variable. CodeQL would warn that text from a web request flows into a database
query without being cleaned.

## Pipeline Plan

The pipeline will be built step by step:

| Step | Stage                  | Command / Tool           | Status                    |
| ---- | ---------------------- | ------------------------ | ------------------------- |
| 1    | Checkout code          | `actions/checkout`       | ✅ Done                   |
| 2    | Install dependencies   | `npm ci`                 | ⏳ Uses `npm install` now |
| 3    | Lint                   | `npm run lint`           | ⏳ To add                 |
| 4    | Format check           | `npm run format:check`   | ⏳ To add                 |
| 5    | Unit test              | `npm run test:ci`        | ⏳ Placeholder `echo` now |
| 6    | Build                  | `npm run build`          | ⏳ To add                 |
| 7    | Security: SAST         | CodeQL                   | ⏳ To add                 |
| 8    | Security: dependencies | `npm audit` / Dependabot | ⏳ To add                 |
| 9    | Deploy                 | —                        | ⏳ Placeholder `echo` now |

## Run Locally

```bash
npm ci                 # install exact versions from package-lock.json
npm run lint           # code quality
npm run format:check   # formatting
npm test               # unit + API tests with coverage
npm run ci             # lint + format check + tests in one go
npm run build          # creates dist/
npm start              # http://localhost:3000
curl localhost:3000/health
curl "localhost:3000/api/add?a=20&b=10"
```
