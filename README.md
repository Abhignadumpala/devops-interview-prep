# Secure DevSecOps Pipeline

A small Node.js app used to practise building a **CI/CD pipeline with GitHub Actions**, adding
security checks step by step. The app itself is tiny on purpose: the focus is the **pipeline**,
not the app.

> Notes on GitHub Actions concepts: [github-actions/README.md](./github-actions/README.md)

## Project Structure

```
devops-interview-prep/
├── .github/workflows/ci.yml   # The CI/CD pipeline (GitHub Actions)
├── test/index.test.js         # Unit test for index.js
├── index.js                   # The application code
├── package.json               # Project info, scripts, dev tools
├── package-lock.json          # Exact versions of every installed package
├── eslint.config.js           # ESLint rules (code quality)
├── .prettierrc                # Prettier rules (code formatting)
├── .prettierignore            # Files Prettier should skip
├── .gitignore                 # Files Git should not track
└── github-actions/            # Study notes (not part of the app)
```

## Files Explained

### 1. `index.js` — the application

```js
const http = require('http'); // Node's built-in web server module

function add(a, b) {
  return a + b; // simple function so we have something to test
}

if (require.main === module) {
  // Runs ONLY when started with "node index.js",
  // NOT when a test file does require('../index')
  const port = process.env.PORT || 3000; // use PORT env var, else 3000
  http
    .createServer((req, res) => res.end('Hello, world!')) // every request gets "Hello, world!"
    .listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = { add }; // export add() so tests can use it
```

- **`require.main === module`** stops the server from starting when tests load this file.
  Without it, `npm test` would start a server and never finish.
- **`module.exports`** makes `add` available to other files (like the test).

### 2. `test/index.test.js` — the unit test

```js
const test = require('node:test'); // Node's built-in test runner (no Jest needed)
const assert = require('node:assert'); // built-in checks like strictEqual
const { add } = require('../index'); // import the function to test

test('add returns the sum of two numbers', () => {
  assert.strictEqual(add(2, 3), 5); // fails if add(2, 3) is not exactly 5
});
```

Run with `npm test`. If the assertion fails, the command exits with an error, and **the CI job
fails**. That's how a pipeline stops broken code.

### 3. `package.json` — project info and commands

| Field             | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| `name`, `version` | Project name (`secure-devsecops-pipeline`) and version    |
| `main`            | Entry file of the project (`index.js`)                    |
| `scripts`         | Short commands you run with `npm run <name>` (used in CI) |
| `devDependencies` | Tools needed only for development/CI, not to run the app  |
| `license`         | MIT: anyone can use the code                              |

**Scripts:**

| Command                | Runs                                 | Purpose                                    |
| ---------------------- | ------------------------------------ | ------------------------------------------ |
| `npm start`            | `node index.js`                      | Start the server                           |
| `npm run lint`         | `eslint .`                           | Check code quality                         |
| `npm run format`       | `prettier --write .`                 | Auto-fix formatting (local use)            |
| `npm run format:check` | `prettier --check .`                 | Only check formatting, don't change (CI)   |
| `npm test`             | `node --test`                        | Run all tests                              |
| `npm run test:ci`      | `node --test --test-reporter=spec`   | Run tests with readable output for CI logs |
| `npm run build`        | `mkdir -p dist && cp index.js dist/` | Create the `dist/` folder to deploy        |

**devDependencies:**

| Package      | What it is                                                            |
| ------------ | --------------------------------------------------------------------- |
| `eslint`     | The linter (finds bugs and bad patterns)                              |
| `@eslint/js` | ESLint's recommended rule set                                         |
| `globals`    | List of Node global names (`require`, `process`) so ESLint knows them |
| `prettier`   | The code formatter                                                    |

The app itself has **no runtime dependencies**. It uses only Node's built-in `http` module.

### 4. `package-lock.json` — exact versions

`package.json` says `"eslint": "^9.39.5"`, meaning _"9.39.5 or any newer 9.x"_. The lock file
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
  { ignores: ['node_modules/', 'dist/'] }, // don't lint installed packages or build output
  js.configs.recommended, // turn on ESLint's recommended rules
  {
    languageOptions: {
      ecmaVersion: 'latest', // allow modern JavaScript syntax
      sourceType: 'commonjs', // we use require/module.exports
      globals: globals.node, // Node globals like process, require are allowed
    },
  },
];
```

Examples of what ESLint catches: unused variables, using a variable that doesn't exist,
unreachable code, duplicate keys in an object.

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
package-lock.json   # generated by npm, must not be reformatted
```

### 8. `.gitignore` — files Git doesn't track

```
node_modules/   # can be re-created anytime with npm ci, and is huge
dist/           # build output: CI creates it fresh each run
```

## Lint vs Format vs Test vs CodeQL

These are often confused. They are **four different checks**:

| Check      | Tool        | Question it answers                | Example problem it finds                    |
| ---------- | ----------- | ---------------------------------- | ------------------------------------------- |
| **Format** | Prettier    | Does the code **look** consistent? | Double quotes instead of single quotes      |
| **Lint**   | ESLint      | Is the code **written correctly**? | Unused variable, undefined variable         |
| **Test**   | `node:test` | Does the code **work**?            | `add(2, 3)` returns `6` instead of `5`      |
| **SAST**   | CodeQL      | Is the code **secure**?            | SQL injection, user input used in a command |

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
npm test               # unit tests
npm run build          # creates dist/
npm start              # http://localhost:3000
```
