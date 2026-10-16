# Day 1 — Intro to Terraform

[← All notes](../README.md)

## Table of Contents

1. [Overview](#overview)
2. [Traditional IT vs Cloud vs Terraform](#traditional-it-vs-cloud-vs-terraform)
3. [What is Terraform?](#what-is-terraform)
4. [Why Terraform?](#why-terraform)
5. [Interview One-Liners](#interview-one-liners)

**[Part 2 — count, for_each, Lifecycle & More](#part-2--count-for_each-lifecycle--more)**

6. [Quick Definitions](#quick-definitions)
7. [count vs for_each — Quick Rule](#count-vs-for_each--quick-rule)
8. [count — numbered copies](#count--numbered-copies)
9. [for_each — named resources](#for_each--named-resources)
10. [Why not count with a list of names?](#why-not-count-with-a-list-of-names)
11. [count vs for_each](#count-vs-for_each)
12. [Parallelism](#parallelism)
13. [Current vs Desired Infrastructure](#current-vs-desired-infrastructure)
14. [Terraform Drift](#terraform-drift)
15. [depends_on](#depends_on)
16. [Lifecycle Rules](#lifecycle-rules)
17. [-target (act on one resource only)](#-target-act-on-one-resource-only)
18. [Interview One-Liners (Part 2)](#interview-one-liners-part-2)

## Overview

Before learning Terraform, let's understand **why** we need it — what problems IT teams faced
before Terraform, and how things changed step by step:

```
Traditional IT  ──►  Cloud (console)  ──►  Terraform
weeks to months      minutes, by hand      one command, repeatable
```

**1. Traditional IT (own data center)**
To get one server, the company **bought hardware**, waited for delivery, then many teams
(procurement, network, storage, backup) set it up **by hand**. It took **weeks to months**, cost a
lot up front, and every server ended up set up a bit differently.

**2. Cloud (AWS, Azure, GCP console)**
Cloud removed the hardware. Now we **rent servers** and pay only for what we use — a server is ready
in **minutes**. But we still **click by hand** in the console, again for dev, staging and prod. Miss
one setting and the servers are different.

**3. Terraform (Infrastructure as Code)**
We **write the server once as code**, save it in Git, and run one command to create it. Same code →
same server every time, in every environment. No clicking, no guessing.

> **Traditional IT was slow. Cloud made it fast but manual. Terraform makes it fast AND repeatable.**

## Traditional IT vs Cloud vs Terraform

![Traditional IT vs Cloud vs Terraform](./images/traditional-it-vs-cloud-vs-terraform.png)

|                    | Traditional IT        | Cloud (console)          | Terraform               |
| ------------------ | --------------------- | ------------------------ | ----------------------- |
| **How**            | Buy & set up hardware | Click in the AWS console | Write code, run it      |
| **Time**           | Weeks to months       | Minutes                  | Minutes, every time     |
| **Repeatable?**    | ❌                    | ❌ (manual clicks)       | ✅ same code everywhere |
| **Change history** | ❌                    | ❌                       | ✅ in Git               |

## What is Terraform?

![Terraform workflow: write, init, plan, apply, destroy](./images/workflow.png)

**Terraform** = an open-source **Infrastructure as Code (IaC)** tool by **HashiCorp**. You write
your infrastructure (servers, VPCs, databases) as **code**, and Terraform **creates it** in the
cloud for you.

- Language: **HCL** (HashiCorp Configuration Language), in `.tf` files
- Works with **many clouds**: AWS, Azure, GCP, Kubernetes, and more (through **providers**)

```
.tf code ──► terraform plan ──► terraform apply ──► AWS resources created
```

## Why Terraform?

| Why                 | In short                                                  |
| ------------------- | --------------------------------------------------------- |
| **Automation**      | No manual clicking in the console                         |
| **Repeatable**      | Same code → identical dev, staging, prod                  |
| **Version control** | Code lives in Git → review, history, rollback             |
| **Fewer mistakes**  | `plan` shows what will change before you `apply`          |
| **Multi-cloud**     | One tool for AWS, Azure, GCP                              |
| **Cost control**    | `terraform destroy` removes everything → no forgotten bills |

## Interview One-Liners

- **IaC** = managing infrastructure with code instead of manual steps.
- **Terraform** = open-source IaC tool by HashiCorp that creates cloud resources from `.tf` code.
- **Why not the console?** Manual clicks are slow, error-prone and not repeatable. Terraform code is
  automated, repeatable and tracked in Git.

---

# Part 2 — count, for_each, Lifecycle & More

## Quick Definitions

**count** = meta-argument that tells Terraform **how many copies** of a resource to create from one block.
- Each copy gets a number `count.index`, starting at 0.
- **Use when:** identical resources (web-1, web-2, web-3).

**for_each** = meta-argument that creates **one resource for each item** in a map or set.
- Tracked by **name (key)**, not number. Use `each.key` and `each.value`.
- **Use when:** each resource has a different name / settings (frontend, user, cart).

**count vs for_each** = count for identical numbered copies; for_each for named resources.
- count tracks by **position** → remove from middle → others shift and get recreated.
- for_each tracks by **name** → only the removed one is deleted.

**Parallelism** = how many resources Terraform creates **at the same time**.
- Default **10**. Change with `terraform apply -parallelism=5`.
- **Use when:** lower it if the cloud API gives rate-limit errors.

**Current vs desired** = desired is what your **code** says; current is what **actually exists** in the cloud.
- `plan` shows the difference, `apply` makes current match desired.

**Drift** = real infrastructure is **different from the code** because someone changed it by hand.
- Detect with `terraform plan`. Fix with `terraform apply`, or update the code to accept the change.

**depends_on** = **force Terraform to create one resource before another**.
- Terraform usually finds the order itself; use only when there's no direct link.
- **Use when:** the app must wait for the database.

**Lifecycle rules** = change how Terraform **creates, updates or destroys** a resource.
- **create_before_destroy** → new first, then delete old (no downtime).
- **prevent_destroy** → Terraform refuses to delete it (protect prod DB).
- **ignore_changes** → ignore changes to listed fields (tags changed by another tool).

**-target** = run plan / apply / destroy on **one resource only**.
- Example: remove 1 VM out of 5 → `terraform destroy -target='aws_instance.web[2]'`.
- **Use when:** emergencies / testing only — next `apply` recreates it if it's still in the code.

## count vs for_each — Quick Rule

| Want                                                      | Use        |
| --------------------------------------------------------- | ---------- |
| Same kind of VM, numbered names (web-1, web-2, web-3)     | `count`    |
| Different names / settings (frontend, user, cart)         | `for_each` |

## count — numbered copies

![count creates numbered copies](./images/count.png)

**count** = make **N copies** of the same block. Each copy gets a number: `count.index`
(starts at 0).

```hcl
resource "aws_instance" "web" {
  count         = 3
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  tags = {
    Name = "web-${count.index + 1}"    # +1 so names start from 1
  }
}
```

| Terraform address     | count.index | Name tag |
| --------------------- | ----------- | -------- |
| `aws_instance.web[0]` | 0           | web-1    |
| `aws_instance.web[1]` | 1           | web-2    |
| `aws_instance.web[2]` | 2           | web-3    |

**Scale:** `count = 5` → adds web-4, web-5. `count = 2` → removes web-3 (always from the **end**).

## for_each — named resources

![for_each named resources vs count shifting](./images/foreach.png)

**for_each** = loop over a **map** (or set). Each resource is tracked by its **name (key)**.
Use `each.key` and `each.value`.

```hcl
resource "aws_instance" "app" {
  for_each = {
    frontend = "t3.micro"
    user     = "t3.micro"
    cart     = "t3.small"
  }
  ami           = "ami-0abc123"
  instance_type = each.value            # t3.micro / t3.small
  tags = {
    Name = each.key                     # frontend / user / cart
  }
}
```

| Terraform address              | each.key | each.value |
| ------------------------------ | -------- | ---------- |
| `aws_instance.app["frontend"]` | frontend | t3.micro   |
| `aws_instance.app["user"]`     | user     | t3.micro   |
| `aws_instance.app["cart"]`     | cart     | t3.small   |

## Why not count with a list of names?

You *can*, but it's risky:

```hcl
count = 3
tags  = { Name = ["frontend", "user", "cart"][count.index] }
```

Remove `"user"` from the list:

|     | Before   | After                                  |
| --- | -------- | -------------------------------------- |
| [0] | frontend | frontend ✅                            |
| [1] | user     | **cart** ❌ (user renamed to cart)     |
| [2] | cart     | **destroyed** ❌                       |

count tracks by **position** → items shift → wrong VMs change. for_each tracks by **name** →
removing `user` deletes **only** user.

## count vs for_each

|                        | count                           | for_each                     |
| ---------------------- | ------------------------------- | ---------------------------- |
| **Input**              | A number                        | A map or set of strings      |
| **Tracked by**         | Index `[0]`, `[1]`              | Key `["user"]`               |
| **Access**             | `count.index`                   | `each.key`, `each.value`     |
| **Remove from middle** | ❌ Others shift → recreated     | ✅ Only that one is removed  |
| **Best for**           | Identical copies (web-1, web-2) | Different names / settings   |
| **On / off switch**    | ✅ `count = var.create ? 1 : 0` | —                            |

| Question                                       | Use                          |
| ---------------------------------------------- | ---------------------------- |
| Identical VMs, only number in the name?        | `count`                      |
| Each VM has its own name / settings?           | `for_each`                   |
| Will you remove items from the middle later?   | `for_each`                   |
| Create a resource only if a flag is true?      | `count = var.create ? 1 : 0` |

## Parallelism

![Parallelism default 10](./images/parallelism.png)

Terraform creates **independent** resources **at the same time** — by default **10 at once**.

```bash
terraform apply -parallelism=5     # max 5 at a time (fewer API calls)
terraform apply -parallelism=20    # faster for big setups
```

| Use lower value           | Use higher value            |
| ------------------------- | --------------------------- |
| Cloud API rate-limit errors | Many independent resources |

## Current vs Desired Infrastructure

![Desired vs current infrastructure](./images/desired.png)

| Term                       | Meaning                                         | Where it lives                |
| -------------------------- | ----------------------------------------------- | ----------------------------- |
| **Desired** infrastructure | What you **want** — written in your code        | `.tf` files                   |
| **Current** infrastructure | What **actually exists** right now in the cloud | AWS (recorded in state file)  |

Terraform's job = make **current = desired**.

```
Desired (.tf code)          Current (AWS)
3 servers, t3.micro   vs    2 servers, t3.micro
            │
     terraform plan   → "1 to add"   (shows the difference)
     terraform apply  → creates 1    (now current = desired)
```

| Situation                          | What `plan` shows      |
| ---------------------------------- | ---------------------- |
| In code, not in AWS                | `+` create             |
| In both, but settings differ       | `~` update / `-/+` replace |
| In AWS (state), removed from code  | `-` destroy            |
| Same in both                       | `No changes`           |

> **Drift** (below) = current changed **outside** Terraform, so it no longer matches desired.

## Terraform Drift

![Terraform drift](./images/drift.png)

**Drift** = real infrastructure is **different** from what Terraform knows (state/code), because
someone **changed it by hand** in the console.

```
Code says: t3.micro   ──►   Someone changes it in console to t3.large   ──►   DRIFT
```

| Step       | Command                            | What it does                                   |
| ---------- | ---------------------------------- | ---------------------------------------------- |
| **Detect** | `terraform plan`                   | Shows the difference                           |
| **Fix (code wins)** | `terraform apply`         | Changes infra back to match the code           |
| **Accept change** | Update the code, then `terraform apply -refresh-only` | Code + state now match the manual change |

> **Prevent drift:** all changes through Terraform, no console clicks.

## depends_on

![depends_on creation order](./images/dependson.png)

Terraform finds the order **automatically** when one resource **uses** another (e.g. `vpc_id =
aws_vpc.main.id`). **depends_on** = force an order when there is **no direct link**.

```hcl
resource "aws_instance" "app" {
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  depends_on    = [aws_db_instance.mysql]   # create DB first, then app
}
```

| Type     | How                        |
| -------- | -------------------------- |
| Implicit | Referencing another resource (preferred) |
| Explicit | `depends_on = [...]` (only when needed)  |

## Lifecycle Rules

![Lifecycle rules](./images/lifecycle.png)

Change Terraform's **default** create / update / destroy behaviour.

| Rule                        | What it does                                               | Use case                                 |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `create_before_destroy`     | Build the **new** one first, then delete the old one       | No downtime when replacing a server      |
| `prevent_destroy`           | Terraform **errors** if anything tries to delete it        | Protect prod database, S3 state bucket   |
| `ignore_changes`            | Ignore changes to listed attributes                        | Tags changed by another tool, autoscaling size |

```hcl
resource "aws_instance" "web" {
  ami           = "ami-0abc123"
  instance_type = "t3.micro"

  lifecycle {
    create_before_destroy = true
    prevent_destroy       = true
    ignore_changes        = [tags]
  }
}
```

```
Default:               destroy old ──► create new     (downtime)
create_before_destroy: create new  ──► destroy old    (no downtime)
```

## -target (act on one resource only)

![-target one resource](./images/target.png)

**-target** = run plan / apply / destroy on **one resource** only, not everything.

**Example:** you have 5 VMs and want to remove only one.

```bash
# count  → use the index
terraform destroy -target='aws_instance.app[2]'

# for_each → use the key
terraform destroy -target='aws_instance.app["cart"]'
```

⚠️ Use for emergencies / testing only. If the code still has 5 VMs, the next `apply` creates it
**again**. To remove it permanently → remove it from the code (count / map) and `apply`.

## Interview One-Liners (Part 2)

- **count vs for_each?** count for identical copies like web-1 to web-3; for_each for named resources with different settings like frontend, user, cart. for_each is tracked by key, so removing one doesn't shift or recreate the others.
- **Current vs desired?** Desired = what the code says; current = what exists in the cloud. `plan` shows the difference, `apply` makes current match desired.
- **Parallelism** = Terraform builds independent resources at the same time, 10 by default (`-parallelism=N`).
- **Drift** = real infra changed outside Terraform; `terraform plan` detects it.
- **depends_on** = force creation order when there's no direct reference.
- **create_before_destroy** = replace with no downtime. **prevent_destroy** = protect critical resources. **ignore_changes** = don't fight changes made outside Terraform.
- **-target** = act on one resource; for exceptions, not daily use.
