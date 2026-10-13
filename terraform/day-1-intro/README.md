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
