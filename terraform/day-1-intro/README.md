# Day 1 — Intro to Terraform

[← All notes](../README.md)

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

## count

**count** = create **many copies** of the same resource from one block. Each copy gets a number:
`count.index` (starts at 0).

```hcl
variable "components" {
  default = ["frontend", "user", "cart"]
}

resource "aws_instance" "app" {
  count         = length(var.components)   # 3 servers
  ami           = "ami-0abc123"
  instance_type = "t3.micro"
  tags          = { Name = var.components[count.index] }
}
```

```
aws_instance.app[0] → frontend
aws_instance.app[1] → user
aws_instance.app[2] → cart
```

⚠️ **Problem:** remove `"user"` from the middle → `cart` moves from `[2]` to `[1]` → Terraform
**destroys and recreates** cart. Items are tracked by **position**.

## for_each

**for_each** = create many resources from a **map** or **set**. Each one is tracked by its
**key (name)**, not position. Use `each.key` and `each.value`.

```hcl
variable "servers" {
  default = {
    frontend = "t3.micro"
    user     = "t3.micro"
    cart     = "t3.small"
  }
}

resource "aws_instance" "app" {
  for_each      = var.servers
  ami           = "ami-0abc123"
  instance_type = each.value              # t3.micro / t3.small
  tags          = { Name = each.key }     # frontend / user / cart
}
```

```
aws_instance.app["frontend"]
aws_instance.app["user"]
aws_instance.app["cart"]
```

✅ Remove `user` → only `user` is destroyed. `cart` is untouched.

## count vs for_each

|                       | count                          | for_each                          |
| --------------------- | ------------------------------ | --------------------------------- |
| **Input**             | A number                       | A map or set of strings           |
| **Tracked by**        | Index `[0]`, `[1]`             | Key `["user"]`                    |
| **Access**            | `count.index`                  | `each.key`, `each.value`          |
| **Remove from middle**| ❌ Others shift → recreated    | ✅ Only that one is removed       |
| **Best for**          | Identical copies (3 same VMs)  | Different settings per resource   |
| **On / off switch**   | ✅ `count = var.create ? 1 : 0` | —                                 |

> **Rule:** identical copies → `count`. Named resources with different values → `for_each`.

## Parallelism

Terraform creates **independent** resources **at the same time** — by default **10 at once**.

```bash
terraform apply -parallelism=5     # max 5 at a time (fewer API calls)
terraform apply -parallelism=20    # faster for big setups
```

| Use lower value           | Use higher value            |
| ------------------------- | --------------------------- |
| Cloud API rate-limit errors | Many independent resources |

## Terraform Drift

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

- **count vs for_each?** count tracks by index, so removing one from the middle recreates others. for_each tracks by key, so only that one changes.
- **Parallelism** = Terraform builds independent resources at the same time, 10 by default (`-parallelism=N`).
- **Drift** = real infra changed outside Terraform; `terraform plan` detects it.
- **depends_on** = force creation order when there's no direct reference.
- **create_before_destroy** = replace with no downtime. **prevent_destroy** = protect critical resources. **ignore_changes** = don't fight changes made outside Terraform.
- **-target** = act on one resource; for exceptions, not daily use.
