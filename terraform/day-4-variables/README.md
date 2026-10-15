# Day 4 — Terraform Variables, Outputs & Locals

[← All notes](../README.md)

## Quick Definitions

**Input variable** = a value **passed in from outside**, so nothing is hardcoded.
- Same code → different environments (dev / prod).

**Local** = a value **built inside the code**, usually from variables, reused many times.
- Can't be changed from outside.

**Output** = a value Terraform **shows after apply** (IP, ID).
- Also how modules pass values to each other.

## Overview

| Term               | Simple meaning                                               | Reference          |
| ------------------ | ------------------------------------------------------------ | ------------------ |
| **Input variable** | A value that **changes** (dev / prod), set from **outside**  | `var.env`          |
| **Local**          | A value you **build once and reuse**, usually from variables | `local.name`       |
| **Output**         | A value Terraform **shows after apply** (IP, ID)             | `terraform output` |

```
env = dev  ──►  local.name = roboshop-dev  ──►  roboshop-dev-frontend  ──►  output: private IP
(variable)        (local)                         (resource)                   (output)
```

## Input Variable vs Local vs Output

|                    | Input variable                          | Local                              | Output                          |
| ------------------ | --------------------------------------- | ---------------------------------- | ------------------------------- |
| **Purpose**        | Values that change per environment      | Avoid repeating the same value     | Show results after apply        |
| **Who sets it**    | Caller / user (from outside)            | The code itself (inside)           | The code itself                 |
| **Can override?**  | ✅ `-var`, tfvars, `TF_VAR_`            | ❌                                 | ❌                              |
| **Keyword**        | `variable "env" {}`                     | `locals { }` (plural)              | `output "ip" {}`                |
| **Reference**      | `var.env`                               | `local.name` (singular)            | `terraform output ip`           |
| **File**           | `variables.tf`                          | `locals.tf`                        | `outputs.tf`                    |
| **Analogy**        | Function parameter                      | Local variable inside function     | Function return value           |

**When to use what**

| Ask yourself                                  | Use      |
| --------------------------------------------- | -------- |
| Will this value change per environment?       | Variable |
| Am I typing the same thing again and again?   | Local    |
| Do I need to see / share a result after apply? | Output   |

## Input Variables

A value passed **into** Terraform so nothing is hardcoded. Same code → dev, test, prod.

```hcl
variable "env" {
  description = "Environment name"
  type        = string
  default     = "dev"
}
```

**Ways to pass the value** (lowest → highest priority)

| Way          | Example                            |
| ------------ | ---------------------------------- |
| Default      | `default = "dev"`                  |
| Env variable | `export TF_VAR_env=prod`           |
| tfvars file  | `env = "prod"` in `terraform.tfvars` |
| CLI flag     | `terraform apply -var="env=prod"`  |

## Data Types

| Type       | Short description                           | Example                                   |
| ---------- | ------------------------------------------- | ----------------------------------------- |
| **string** | Text                                        | `"t3.micro"`                              |
| **number** | Whole or decimal number                     | `3`, `8080`                               |
| **bool**   | true / false                                | `true`                                    |
| **list**   | Collection of values, **same type only** (all strings or all numbers), index from 0 | `["frontend", "user", "cart"]` or `[80, 443, 8080]` |
| **map**    | Key = value pairs, **same type** values     | `{ dev = "t3.micro", prod = "t3.large" }` |
| **object** | Key = value pairs, **different types**, fixed keys | `{ name = "web", port = 80, public = true }` |
| **tuple**  | Collection of values, **different types allowed** (string, number, bool together), index from 0 | `["web", 80, true]` |

### List

A **list** is an ordered collection of values where each element can be accessed by its **index
(starting at 0)**. All values in a list must be of the **same type** — either all strings, all
numbers, or all booleans, but **not mixed**.

For example, consider a variable that uses a list of prefixes:

```hcl
variable "prefix" {
  type    = list(string)
  default = ["Mr", "Mrs", "Sir"]
}
```

| Index | Value | Access            |
| ----- | ----- | ----------------- |
| 0     | Mr    | `var.prefix[0]`   |
| 1     | Mrs   | `var.prefix[1]`   |
| 2     | Sir   | `var.prefix[2]`   |

```hcl
["Mr", "Mrs", "Sir"]   # ✅ all strings
[80, 443, 8080]        # ✅ all numbers
["Mr", 80, true]       # ❌ mixed types → not a list (use a tuple)
```

```hcl
variable "instance_type" {
  type    = string
  default = "t3.micro"
}

variable "instance_count" {
  type    = number
  default = 3
}

variable "enable_monitor" {
  type    = bool
  default = true
}

variable "components" {
  type    = list(string)
  default = ["frontend", "user", "cart"]
}

variable "size_per_env" {
  type    = map(string)
  default = { dev = "t3.micro", prod = "t3.large" }
}

variable "server" {
  type    = object({ name = string, port = number, public = bool })
  default = { name = "web", port = 80, public = true }
}

variable "mixed" {
  type    = tuple([string, number, bool])
  default = ["web", 80, true]
}
```

**Access values**

| Type   | Syntax                       | Result     |
| ------ | ---------------------------- | ---------- |
| list   | `var.components[0]`          | `frontend` |
| map    | `var.size_per_env["prod"]`   | `t3.large` |
| object | `var.server.port`            | `80`       |
| tuple  | `var.mixed[1]`               | `80`       |

## Locals

A value built **inside** the code, used many times. Change the variable once → every local and
resource updates automatically.

**variables.tf** — values that change
```hcl
variable "project" { default = "roboshop" }
variable "env"     { default = "dev" }
```

**locals.tf** — build once
```hcl
locals {
  name = "${var.project}-${var.env}"     # roboshop-dev

  common_tags = {
    Project     = var.project
    Environment = var.env
    ManagedBy   = "terraform"
  }
}
```

**main.tf** — reuse many times
```hcl
resource "aws_instance" "frontend" {
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  tags          = merge(local.common_tags, { Name = "${local.name}-frontend" })
}

resource "aws_instance" "user" {
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  tags          = merge(local.common_tags, { Name = "${local.name}-user" })
}

resource "aws_instance" "cart" {
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  tags          = merge(local.common_tags, { Name = "${local.name}-cart" })
}
```

`merge()` = joins the common tags with each server's own `Name` tag.

```bash
terraform apply                    # dev
terraform apply -var="env=prod"    # prod — no code change
```

| env  | local.name    | Servers created                                              |
| ---- | ------------- | ------------------------------------------------------------ |
| dev  | roboshop-dev  | roboshop-dev-frontend, roboshop-dev-user, roboshop-dev-cart    |
| prod | roboshop-prod | roboshop-prod-frontend, roboshop-prod-user, roboshop-prod-cart |

## Outputs

Shows values **after apply** — IPs, IDs, names. Also how modules pass values to each other.

**outputs.tf**
```hcl
output "frontend_private_ip" {
  value = aws_instance.frontend.private_ip
}

output "name_prefix" {
  value = local.name
}
```

```bash
terraform output                       # all outputs
terraform output frontend_private_ip   # one output
```

## Syntax Cheat Sheet

| Where            | Write                    |
| ---------------- | ------------------------ |
| Directly         | `var.env`                |
| Inside a string  | `"roboshop-${var.env}"`  |
| Locals block     | `locals { }` → `local.name` |
| Secret value     | `sensitive = true`       |

## Interview One-Liners

- **Input variable** = a value that changes, passed from outside, so the same code works for dev and prod.
- **Local** = a value built inside the code, usually from variables, so I don't repeat myself. It can't be set from outside.
- **Output** = a value shown after apply (IP, ID); also how a child module passes values to its parent.
- **Variable vs local?** "Variables are for values that change. Locals are for values I build inside the code to avoid repetition."
- **map vs object?** Map = all values same type. Object = fixed keys, values can be different types.
- **list vs tuple?** List = all items same type. Tuple = items can be different types.
