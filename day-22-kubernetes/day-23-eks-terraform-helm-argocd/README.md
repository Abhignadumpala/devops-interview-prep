# Day 23 — EKS with Terraform Modules, Helm Intro, Argo CD with Helm

[← Kubernetes notes](../README.md)

> **In short:** [Day 22](../day-22-k8s-intro/README.md#4-eks-cluster-creation-manual-console) we clicked through the AWS console to make an EKS cluster. In real jobs we build it with **Terraform modules**: one `terraform apply` creates the VPC, the EKS cluster, worker nodes and a bastion server. Then we use **Helm** (the package manager for Kubernetes) to install **Argo CD** into the cluster.

## Table of Contents

1. [Console vs Terraform](#1-console-vs-terraform)
2. [What we build (architecture)](#2-what-we-build-architecture)
3. [Beginner Guide: Who Creates What, Who You Talk To](#3-beginner-guide-who-creates-what-who-you-talk-to)
4. [Terraform module](#4-terraform-module)
5. [Project files](#5-project-files)
6. [The code](#6-the-code)
7. [Steps: create the cluster](#7-steps-create-the-cluster)
8. [Introduction to Helm](#8-introduction-to-helm)
9. [Install Argo CD with Helm](#9-install-argo-cd-with-helm)
10. [Destroy everything](#10-destroy-everything)
11. [Common problems](#11-common-problems)
12. [Commands Cheat Sheet](#12-commands-cheat-sheet)
13. [Interview Questions](#13-interview-questions)

---

## 1. Console vs Terraform

**Definition:** **Infrastructure as Code (IaC)** means writing your servers, networks and clusters as code files, then letting a tool (Terraform) create them.

| | AWS console (GUI) | Terraform |
|---|---|---|
| How | Click, click, click | Write `.tf` files, run `terraform apply` |
| Repeat in dev / test / prod | Click again, may differ | Same code → same cluster every time |
| Review | No record | Code is in Git, reviewed in a PR |
| Delete | Delete each thing by hand, in order | `terraform destroy` removes all in the right order |
| Real time | Learning only | ✅ **What companies use** |

---

## 2. What we build (architecture)

![EKS with Terraform + Argo CD architecture](images/eks-terraform-argocd-architecture.png)

```
                         Internet
                            │
┌──────────────── VPC 10.0.0.0/16 (3 AZs) ────────────────┐
│                                                         │
│  Public subnets  10.0.1-3.0/24                          │
│   ┌──────────────┐     ┌─────────────┐                  │
│   │ Bastion EC2  │     │ NAT gateway │  (+ load balancers)
│   │ kubectl/helm │     └──────┬──────┘                  │
│   └──────┬───────┘            │ outbound internet       │
│          │ port 443           │                         │
│  Private subnets 10.0.101-103.0/24                      │
│   ┌──────▼─────────────────────▼──────┐                 │
│   │ EKS worker nodes (node group 2–6) │ ← pods run here │
│   └──────────────────┬────────────────┘                 │
└──────────────────────┼──────────────────────────────────┘
                       │
        EKS control plane (AWS manages: API server, etcd)
```

| Resource | What it is | Why |
|---|---|---|
| **VPC** + 3 public + 3 private subnets | Our own private network across 3 AZs | High availability |
| **NAT gateway** (one) | Lets private nodes reach the internet (pull images) | One shared NAT = cheaper |
| **Bastion EC2** (Ubuntu) | Admin server we SSH into to run `kubectl` / `helm` | Nodes stay private; only bastion is public |
| **EKS cluster** | Managed control plane | AWS runs API server + etcd |
| **Managed node group** | Worker nodes in **private** subnets, 2 to 6 | Pods run here, auto-scaling |
| **IAM OIDC provider** | Lets pods use IAM roles (IRSA) | Needed later for add-ons like ALB controller |

---

## 3. Beginner Guide: Who Creates What, Who You Talk To

### A Kubernetes cluster has 2 parts

| Part | Also called | Job | Example |
|---|---|---|---|
| **Control plane** | Master node | The **brain**: decides where pods run, stores cluster state | API server, etcd, scheduler, controller manager |
| **Worker nodes** | Nodes | The **hands**: actually run your pods (containers) | EC2 machines with kubelet, kube-proxy, containerd |

### Do I create the control plane or only worker nodes?

**In EKS, you ask for both in the code, but AWS builds and runs the control plane for you.**

| | Control plane (master) | Worker nodes |
|---|---|---|
| Asked for in my code? | ✅ Yes: `module "eks"` → `cluster_name`, `cluster_version` | ✅ Yes: `eks_managed_node_groups` → instance type, 2–6 nodes |
| Who builds it? | **AWS** | **AWS** launches the EC2s from my settings |
| Where does it live? | In an **AWS-owned account**, not in my VPC | In **my VPC**, private subnets |
| Can I see the machines in EC2 console? | ❌ No, hidden | ✅ Yes, 2 EC2 instances |
| Can I SSH into it? | ❌ Never | ✅ Possible (from bastion), but rarely needed |
| Who patches / backs up / keeps it running? | **AWS** (3 copies across AZs) | Me (updates via node group) |
| How do I talk to it? | Through its **API endpoint** (an HTTPS URL) using `kubectl` | I don't; the control plane tells them what to run |

> **Simple:** I write *"I want a cluster named `abhigna-cluster` with 2 worker nodes"*. AWS creates the brain (control plane) in its own account and the hands (worker nodes) in my VPC.

### What is the bastion, and who do I connect to?

**Bastion host** = a small Ubuntu EC2 with a public IP, created by my code (`bastion.tf`). It is **not** part of the cluster. It is my **admin desk**: `kubectl` and `helm` are installed on it, and from there I send commands to the cluster.

**Why do I need it?**

- The **control plane is managed by AWS**, so I **cannot SSH into it**. The only way to talk to it is through its **API server**, using **HTTPS API calls on port 443**.
- `kubectl` is the tool that makes those API calls. I run `kubectl` **on the bastion**.
- The **worker nodes** are in private subnets with no public IP. I don't log in to them; the control plane manages them for me.

| Question | Answer |
|---|---|
| Who creates the bastion? | My code (`bastion.tf`); the bootstrap script installs all tools |
| Where do I **SSH**? | **Bastion only** (port 22) |
| Can I SSH into the control plane? | ❌ No, AWS manages it |
| Do I SSH into worker nodes? | ❌ No, not needed |
| How do I talk to the control plane? | `kubectl` on the bastion → **HTTPS API calls, port 443** → API server |
| Who talks to the worker nodes? | The **API server** ↔ **kubelet** on each worker node |
| Who actually runs the containers? | **Container runtime** (containerd) on the worker node |

### Step by step: what happens when I run `kubectl apply`

Example: I want 2 nginx pods (`kubectl apply -f deploy.yaml`).

| Step | Where | What happens |
|---|---|---|
| 1 | 💻 Laptop | I **SSH** into the bastion (port 22) |
| 2 | 🖥️ Bastion | I run `kubectl apply -f deploy.yaml` |
| 3 | Bastion → Control plane | `kubectl` reads `~/.kube/config`, logs in with the bastion's IAM role, and sends an **HTTPS API call (443)** to the **API server** |
| 4 | Control plane | **API server** checks I'm allowed, then saves *"2 nginx pods wanted"* in **etcd** |
| 5 | Control plane | **Scheduler** picks which **worker node** each pod should run on |
| 6 | Control plane → Worker node | **API server** gives the pod to the **kubelet** on that node (kubelet keeps watching the API server for new work) |
| 7 | Worker node | **kubelet** tells the **container runtime** (containerd): *"run nginx"* |
| 8 | Worker node | **Container runtime pulls the image** (from Docker Hub / ECR, through the NAT gateway) and **starts the container** |
| 9 | Worker node → Control plane | **kubelet** reports back to the API server: *"pod is Running"* |
| 10 | 🖥️ Bastion | `kubectl get pods` → I see 2 pods **Running** |

```
 ① SSH (22)        ② kubectl: HTTPS API call (443)     ③ API server ↔ kubelet       ④ pull + run
┌────────┐       ┌─────────────┐       ┌──────────────────────────┐       ┌───────────────────────────────┐
│ Laptop │ ────► │ Bastion EC2 │ ────► │ Control plane (AWS)      │ ────► │ Worker node (my VPC)          │
│  (me)  │       │ kubectl     │       │ API server · etcd ·      │       │ kubelet → containerd          │
│        │       │ helm        │       │ scheduler                │       │        → pulls image → pod ✅  │
└────────┘       └─────────────┘       └──────────────────────────┘       └───────────────────────────────┘
 my home          public subnet          AWS-owned account                  private subnet
```

> **Note:** `kubectl` manages what runs **on** the worker nodes (pods, deployments, services). The worker **nodes themselves** (the EC2 machines) are created by Terraform's **node group**, not by `kubectl`.

> **In one line:** I SSH into the bastion → `kubectl` makes HTTPS API calls (443) to the API server in the AWS-managed control plane → the API server talks to the kubelet on a worker node → kubelet tells the container runtime to pull the image and run the container.

### Where each command runs

| Command | Run on | Talks to |
|---|---|---|
| `terraform init / plan / apply / destroy` | **Laptop** | AWS APIs (creates VPC, EKS, nodes, bastion) |
| `ssh -i ... ubuntu@<bastion-ip>` | **Laptop** | Bastion |
| `kubectl get nodes`, `kubectl apply ...` | **Bastion** | Control plane (API server) |
| `helm install argocd ...` | **Bastion** | Control plane (API server) |

> **Interview one-liner:** In EKS, AWS creates and manages the control plane in its own account; I only define the worker nodes (node group) that run in my VPC. I SSH into a **bastion host**, and from there `kubectl` talks to the control plane's API server over HTTPS. I never SSH into the control plane.

---

## 4. Terraform module

**Definition:** A **module** is a ready-made, reusable package of Terraform code. You give it inputs; it creates many resources for you.

| Without module | With module |
|---|---|
| Write every subnet, route table, IAM role, security group yourself (hundreds of lines) | Call `terraform-aws-modules/eks/aws` with ~20 inputs |

We use two public modules from the Terraform Registry:

| Module | Creates |
|---|---|
| `terraform-aws-modules/vpc/aws` | VPC, subnets, route tables, internet gateway, NAT gateway |
| `terraform-aws-modules/eks/aws` | EKS cluster, node group, IAM roles, security groups, OIDC |

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"   # where the module comes from
  version = "~> 5.8"                          # pin the version
  cidr    = var.vpc_cidr                      # your inputs
}
```

> **One line:** a module is like a function: inputs go in, resources come out.

---

## 5. Project files

```
eks-terraform/
├── providers.tf               # Terraform + AWS + Kubernetes providers
├── variables.tf               # All inputs with default values
├── terraform.tfvars           # MY values (name, region, sizes) ← edit this
├── vpc.tf                     # VPC module
├── eks.tf                     # EKS module + node group
├── bastion.tf                 # Bastion EC2 + security group + IAM role
├── outputs.tf                 # Prints cluster name, endpoint, kubectl command
└── bastion_bootstrap.sh.tpl   # user_data: installs AWS CLI, kubectl, eksctl, helm on first boot
```

| File | Simple meaning |
|---|---|
| `variables.tf` | **What** inputs exist (and defaults) |
| `terraform.tfvars` | **Your** actual values for those inputs |
| `outputs.tf` | What Terraform prints after `apply` |
| `*.tpl` | Template file; Terraform fills in `${aws_region}` and `${cluster_name}` |

---

## 6. The code

Class code: [devopsbyraham/eks-code](https://github.com/devopsbyraham/eks-code). Names changed to mine in `terraform.tfvars`.

> **My runnable code:** [k8s-eks-projects / 01-eks-terraform](https://github.com/Abhignadumpala/k8s-eks-projects/tree/main/01-eks-terraform)

### terraform.tfvars (my values)

```hcl
aws_region   = "us-east-1"
project_name = "abhigna"

# Bastion / admin host
bastion_ami_id           = "ami-033ea4ff4a9c726dc" # Ubuntu 22.04, us-east-1 only
bastion_instance_type    = "m7i-flex.large"
bastion_root_volume_size = 30
key_pair_name            = "abhigna-eks-key"       # create this key pair first in the same region
ssh_allowed_cidr         = "0.0.0.0/0"             # real time: your IP only, e.g. "1.2.3.4/32"

# Networking
vpc_cidr             = "10.0.0.0/16"
azs                  = ["us-east-1a", "us-east-1b", "us-east-1c"]
public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
private_subnet_cidrs = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

# EKS cluster
cluster_name    = "abhigna-cluster"
cluster_version = "1.33"

# Managed node group
nodegroup_name      = "abhigna-cluster-ng-1"
node_instance_types = ["m7i-flex.large"]
node_volume_size    = 20
node_desired_size   = 2
node_min_size       = 2
node_max_size       = 6
```

> **Changing region?** Change `aws_region`, `azs`, `bastion_ami_id` (AMI IDs are different in every region) and create the key pair in that region.

### providers.tf

```hcl
terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws        = { source = "hashicorp/aws",        version = "~> 5.0" }
    kubernetes = { source = "hashicorp/kubernetes", version = "~> 2.27" }
    tls        = { source = "hashicorp/tls",        version = "~> 4.0" }
    cloudinit  = { source = "hashicorp/cloudinit",  version = "~> 2.3" }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = var.project_name, ManagedBy = "terraform" }   # tag on every resource
  }
}

# Kubernetes provider logs in to the new cluster (used for the RBAC binding in eks.tf)
data "aws_eks_cluster_auth" "this" {
  name = module.eks.cluster_name
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  token                  = data.aws_eks_cluster_auth.this.token
}
```

### variables.tf

Each input is declared like this (with a description, type and default):

```hcl
variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
  default     = "abhigna-cluster"
}
```

All inputs in the file:

| Variable | Type | Default |
|---|---|---|
| `aws_region` | string | `us-east-1` |
| `project_name` | string | `abhigna` |
| `bastion_ami_id` | string | Ubuntu 22.04 AMI (region-specific) |
| `bastion_instance_type` | string | `m7i-flex.large` |
| `bastion_root_volume_size` | number | `30` |
| `key_pair_name` | string | `abhigna-eks-key` |
| `ssh_allowed_cidr` | string | `0.0.0.0/0` |
| `vpc_cidr` | string | `10.0.0.0/16` |
| `azs` | list(string) | `us-east-1a`, `1b`, `1c` |
| `public_subnet_cidrs` | list(string) | `10.0.1.0/24`, `10.0.2.0/24`, `10.0.3.0/24` |
| `private_subnet_cidrs` | list(string) | `10.0.101.0/24`, `10.0.102.0/24`, `10.0.103.0/24` |
| `cluster_name` | string | `abhigna-cluster` |
| `cluster_version` | string | `1.33` |
| `nodegroup_name` | string | `abhigna-cluster-ng-1` |
| `node_instance_types` | list(string) | `["m7i-flex.large"]` |
| `node_volume_size` | number | `20` |
| `node_desired_size` | number | `2` |
| `node_min_size` | number | `2` |
| `node_max_size` | number | `6` |

> `terraform.tfvars` values override these defaults.

### vpc.tf

```hcl
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = "${var.project_name}-vpc"
  cidr = var.vpc_cidr

  azs             = var.azs
  public_subnets  = var.public_subnet_cidrs    # bastion, NAT, load balancers
  private_subnets = var.private_subnet_cidrs   # worker nodes

  enable_nat_gateway   = true
  single_nat_gateway   = true    # one NAT for all AZs = cheaper
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tags so EKS knows which subnets to use for load balancers
  public_subnet_tags = {
    "kubernetes.io/role/elb"                    = "1"   # internet-facing LB
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"           = "1"   # internal LB
    "kubernetes.io/cluster/${var.cluster_name}" = "shared"
  }

  tags = { Name = "${var.project_name}-vpc" }
}
```

### eks.tf

```hcl
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version

  cluster_endpoint_public_access           = true   # API reachable from outside
  enable_cluster_creator_admin_permissions = true   # whoever runs terraform = cluster admin

  # Give the bastion's IAM role access to the cluster
  access_entries = {
    bastion-admin = {
      principal_arn     = aws_iam_role.bastion.arn
      type              = "STANDARD"
      kubernetes_groups = ["bastion-admin"]
    }
  }

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets   # nodes in private subnets

  enable_irsa = true   # IAM OIDC provider → pods can use IAM roles

  eks_managed_node_group_defaults = {
    ami_type = "AL2023_x86_64_STANDARD"     # Amazon Linux 2023
  }

  eks_managed_node_groups = {
    (var.nodegroup_name) = {
      instance_types = var.node_instance_types
      capacity_type  = "ON_DEMAND"

      min_size     = var.node_min_size
      max_size     = var.node_max_size
      desired_size = var.node_desired_size
      disk_size    = var.node_volume_size

      create_launch_template     = false
      use_custom_launch_template = false

      # SSH into nodes only from the bastion
      remote_access = {
        ec2_ssh_key               = var.key_pair_name
        source_security_group_ids = [aws_security_group.bastion_sg.id]
      }

      iam_role_additional_policies = {
        AmazonEKSWorkerNodePolicy            = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
        AmazonEKS_CNI_Policy                 = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
        AmazonEC2ContainerRegistryFullAccess = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryFullAccess"
        AmazonEC2ContainerRegistryReadOnly   = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
        ElasticLoadBalancingFullAccess       = "arn:aws:iam::aws:policy/ElasticLoadBalancingFullAccess"
        AutoScalingFullAccess                = "arn:aws:iam::aws:policy/AutoScalingFullAccess"
      }

      labels = { role = "worker" }
      tags   = { Name = "${var.project_name}-eks-node" }
    }
  }

  # Bastion can talk to the EKS API on 443
  cluster_security_group_additional_rules = {
    ingress_from_bastion = {
      description              = "Allow bastion host to access EKS API"
      protocol                 = "tcp"
      from_port                = 443
      to_port                  = 443
      type                     = "ingress"
      source_security_group_id = aws_security_group.bastion_sg.id
    }
  }

  tags = { Name = var.cluster_name }
}

# Make the "bastion-admin" group a full cluster admin
resource "kubernetes_cluster_role_binding" "bastion_admin" {
  metadata { name = "${var.cluster_name}-bastion-admin" }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = "cluster-admin"
  }

  subject {
    kind      = "Group"
    name      = "bastion-admin"
    api_group = "rbac.authorization.k8s.io"
  }
}
```

**How the bastion gets cluster access (3 links):**

```
Bastion EC2 → IAM role (instance profile)
           → EKS access entry  (IAM role → K8s group "bastion-admin")
           → ClusterRoleBinding ("bastion-admin" → cluster-admin)
```

### bastion.tf

```hcl
resource "aws_security_group" "bastion_sg" {
  name   = "${var.cluster_name}-bastion-sg"
  vpc_id = module.vpc.vpc_id

  ingress {                       # SSH in
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_allowed_cidr]
  }
  egress {                        # all out
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM role the bastion EC2 uses
resource "aws_iam_role" "bastion" {
  name = "${var.cluster_name}-bastion-server-role-eks"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Needed for: aws eks update-kubeconfig
resource "aws_iam_role_policy" "bastion_eks_read" {
  name = "${var.cluster_name}-bastion-server-eks-read"
  role = aws_iam_role.bastion.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["eks:DescribeCluster", "eks:ListClusters", "eks:DescribeNodegroup", "eks:ListNodegroups"]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "bastion_ecr_readonly" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${var.cluster_name}-bastion-profile-eks"
  role = aws_iam_role.bastion.name
}

resource "aws_instance" "bastion" {
  ami                         = var.bastion_ami_id
  instance_type               = var.bastion_instance_type
  key_name                    = var.key_pair_name
  subnet_id                   = module.vpc.public_subnets[0]
  vpc_security_group_ids      = [aws_security_group.bastion_sg.id]
  iam_instance_profile        = aws_iam_instance_profile.bastion.name
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.bastion_root_volume_size
    volume_type           = "gp3"
    delete_on_termination = true
    encrypted             = true
  }

  depends_on = [module.eks]   # create the bastion only after the cluster exists

  user_data = templatefile("${path.module}/bastion_bootstrap.sh.tpl", {
    aws_region   = var.aws_region
    cluster_name = var.cluster_name
  })

  tags = { Name = "${var.cluster_name}-bastion" }
}

output "bastion_public_ip" {
  value = aws_instance.bastion.public_ip
}

output "bastion_ssh_command" {
  value = "ssh -i ${var.key_pair_name}.pem ubuntu@${aws_instance.bastion.public_ip}"
}
```

### outputs.tf

```hcl
output "cluster_name"              { value = module.eks.cluster_name }
output "cluster_endpoint"          { value = module.eks.cluster_endpoint }
output "cluster_version"           { value = module.eks.cluster_version }
output "cluster_security_group_id" { value = module.eks.cluster_security_group_id }
output "vpc_id"                    { value = module.vpc.vpc_id }
output "oidc_provider_arn"         { value = module.eks.oidc_provider_arn }
output "nodegroup_name"            { value = var.nodegroup_name }

output "configure_kubectl" {
  value = "aws eks update-kubeconfig --region ${var.aws_region} --name ${module.eks.cluster_name}"
}
```

### bastion_bootstrap.sh.tpl (runs on first boot)

| Step | What it does |
|---|---|
| 1 | `apt-get update`, install `unzip curl wget tar git jq` |
| 2 | Install **AWS CLI v2** |
| 3 | Install **kubectl** |
| 4 | Install **eksctl** |
| 5 | Install **helm** |
| 6 | Wait until the cluster status is `ACTIVE` (checks every 15s, up to 10 min) |
| 7 | Run `aws eks update-kubeconfig` for `ubuntu` and copy to `root` |
| 8 | Set `AWS_REGION`, `KUBECONFIG` and alias `k=kubectl` in `.profile` |

```bash
#!/bin/bash
set -euo pipefail
exec > >(tee -a /var/log/bastion-bootstrap.log) 2>&1   # log everything

apt-get update -y
apt-get install -y unzip curl wget tar git jq

# AWS CLI v2
cd /tmp
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip -o awscliv2.zip && ./aws/install

# kubectl
curl -LO "https://dl.k8s.io/release/v1.35.0/bin/linux/amd64/kubectl"
chmod +x kubectl && mv kubectl /usr/local/bin/kubectl

# eksctl
curl -L "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" -o eksctl.tar.gz
tar -xzf eksctl.tar.gz -C /tmp && mv /tmp/eksctl /usr/local/bin/eksctl

# helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Wait for the cluster, then write kubeconfig
mkdir -p /home/ubuntu/.kube /root/.kube
chown -R ubuntu:ubuntu /home/ubuntu/.kube
export HOME=/home/ubuntu
export AWS_DEFAULT_REGION="${aws_region}"

retry_count=0
until aws eks describe-cluster --region "${aws_region}" --name "${cluster_name}" \
      --query "cluster.status" --output text | grep -q "ACTIVE"; do
  retry_count=$((retry_count + 1))
  [ "$retry_count" -ge 40 ] && { echo "Cluster not ACTIVE"; exit 1; }
  sleep 15
done

sudo -u ubuntu bash -lc "HOME=/home/ubuntu AWS_DEFAULT_REGION=${aws_region} aws eks update-kubeconfig --region ${aws_region} --name ${cluster_name}"
cp /home/ubuntu/.kube/config /root/.kube/config
chown ubuntu:ubuntu /home/ubuntu/.kube/config
chmod 600 /home/ubuntu/.kube/config /root/.kube/config

cat > /home/ubuntu/.profile <<EOF
export AWS_REGION=${aws_region}
export KUBECONFIG=/home/ubuntu/.kube/config
alias k='kubectl'
EOF

cat > /root/.profile <<EOF
export AWS_REGION=${aws_region}
export KUBECONFIG=/root/.kube/config
alias k='kubectl'
EOF
chown ubuntu:ubuntu /home/ubuntu/.profile
```

> `${aws_region}` and `${cluster_name}` are filled in by Terraform's `templatefile()` before the script reaches the EC2.

---

## 7. Steps: create the cluster

**Before you start**

| Need | Check |
|---|---|
| Terraform ≥ 1.5 | `terraform version` |
| AWS credentials (admin-level for VPC, EC2, EKS, IAM) | `aws sts get-caller-identity` |
| Key pair `abhigna-eks-key` in `us-east-1` | EC2 → Key pairs → Create → download `.pem` |

**Step 0 — 💻 run on LAPTOP: create the key pair (once, by hand)**

The only thing the code does **not** create. Terraform uses it to let me SSH into the bastion.

```bash
# 💻 LAPTOP
aws ec2 create-key-pair --region us-east-1 --key-name abhigna-eks-key \
  --query KeyMaterial --output text > ~/.ssh/abhigna-eks-key.pem
chmod 400 ~/.ssh/abhigna-eks-key.pem      # SSH refuses keys others can read
```

Or console: EC2 → region **N. Virginia** → Key pairs → Create → name `abhigna-eks-key`, RSA, `.pem`.

**Step 1 — 💻 run on LAPTOP: get the code**

```bash
# 💻 LAPTOP
git clone git@github.com:Abhignadumpala/k8s-eks-projects.git
cd k8s-eks-projects/01-eks-terraform
cat terraform.tfvars        # my values already set: abhigna-cluster, abhigna-eks-key, us-east-1
```

**Step 2 — 💻 run on LAPTOP: create everything with Terraform**

```bash
# 💻 LAPTOP (inside 01-eks-terraform)
terraform init              # downloads AWS provider + VPC and EKS modules (~1 min)
terraform validate          # syntax check
terraform plan              # preview only: lists what will be created, creates nothing
terraform apply -auto-approve   # really creates it (~15–20 min)
```

| `terraform` command | What it means |
|---|---|
| `init` | Get ready: download plugins and modules into `.terraform/` |
| `plan` | Dry run: "this is what I would create" |
| `apply` | Do it: create resources in AWS |
| `-auto-approve` | Don't ask "yes?" before applying |

What `apply` creates, in order:

| # | Created | Who runs it after |
|---|---|---|
| 1 | VPC, subnets, NAT gateway | AWS (network) |
| 2 | EKS **control plane** (~10–12 min, slowest) | **AWS manages** |
| 3 | IAM OIDC provider + **node group** (2 worker EC2s) | AWS launches, I own |
| 4 | **Bastion** EC2 → installs AWS CLI, kubectl, eksctl, helm + sets kubeconfig | Me |

**Step 3 — 💻 run on LAPTOP: SSH into the bastion**

```bash
# 💻 LAPTOP
terraform output            # prints bastion IP, cluster name, kubectl command
ssh -i ~/.ssh/abhigna-eks-key.pem ubuntu@$(terraform output -raw bastion_public_ip)
```

`$(terraform output -raw bastion_public_ip)` = put the bastion's IP here automatically.

**Step 4 — 🖥️ run on BASTION: talk to the cluster**

```bash
# 🖥️ BASTION (prompt changes to ubuntu@ip-10-0-1-x)
kubectl get nodes           # 2 worker nodes, STATUS Ready
kubectl get pods -A         # system pods: coredns, aws-node (VPC CNI), kube-proxy
kubectl cluster-info        # shows the control plane (API server) URL

# Only if kubectl says "no configuration" (bootstrap not finished / failed):
aws eks update-kubeconfig --region us-east-1 --name abhigna-cluster
```

> Bootstrap takes a few minutes after the bastion starts. If `kubectl` is not found yet, check `sudo tail -f /var/log/bastion-bootstrap.log`.

> Bastion user is **ubuntu** (Ubuntu AMI), not `ec2-user`.

---

## 8. Introduction to Helm

**Definition:** **Helm** is the **package manager for Kubernetes**. Like `apt` / `yum` installs software on Linux, `helm install` installs a full app (all its YAML files) into a cluster with one command.

**Why Helm?** An app like Argo CD needs many YAML files: Deployments, Services, ConfigMaps, Secrets, RBAC, CRDs. Writing and applying them by hand is slow and easy to get wrong.

| Without Helm | With Helm |
|---|---|
| `kubectl apply` 20+ YAML files one by one | `helm install argocd argo/argo-cd` |
| Copy YAML for dev, test, prod, change values by hand | Same chart, different `values.yaml` |
| Upgrade = edit many files | `helm upgrade` |
| Rollback = remember old YAML | `helm rollback <release> <revision>` |
| Delete = find every object | `helm uninstall` |

### Helm words

| Word | Simple meaning | Linux example |
|---|---|---|
| **Chart** | A package: a folder of K8s YAML templates | `.rpm` / `.deb` package |
| **Repository** | A place that stores charts | yum / apt repo |
| **Release** | One installed copy of a chart in the cluster | Installed software |
| **values.yaml** | Settings you can change (replicas, image, service type) | Config file |
| **Template** | YAML with placeholders, filled from values | |
| **Revision** | Version number of a release; goes up on every upgrade | |

### Chart structure

```
mychart/
├── Chart.yaml        # name, version, description
├── values.yaml       # default settings
└── templates/        # K8s YAML with placeholders
    ├── deployment.yaml
    └── service.yaml
```

```yaml
# templates/deployment.yaml (part)
spec:
  replicas: {{ .Values.replicaCount }}
  containers:
    - image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

```yaml
# values.yaml
replicaCount: 2
image:
  repository: nginx
  tag: "1.27"
```

```
values.yaml ──┐
              ├──► helm ──► final K8s YAML ──► cluster (release)
templates/ ───┘
```

> **Interview one-liner:** Helm is the package manager for Kubernetes. A **chart** is a package of templated YAML, **values.yaml** holds the settings, and a **release** is one installed copy. It gives one-command install, upgrade and rollback.

---

## 9. Install Argo CD with Helm

**Definition:** **Argo CD** is a **GitOps** tool for Kubernetes. It watches a Git repo and keeps the cluster the same as what is in Git.

**GitOps** = Git is the single source of truth. You change YAML in Git → Argo CD sees it → applies it to the cluster.

```
Developer ──push YAML──► Git repo ◄──watches── Argo CD (in cluster) ──applies──► Pods
```

### Helm vs Argo CD: what is installed where?

> **Helm is on the bastion. Argo CD is inside the cluster.** We do **not** install Argo CD on the bastion.

| Tool | Installed where | Who installs it |
|---|---|---|
| **Helm** | 🖥️ **Bastion** | Already installed by the bootstrap script when the bastion starts. Nothing to do |
| **kubectl** | 🖥️ **Bastion** | Same, already installed |
| **Argo CD** | ☸️ **Inside the EKS cluster**, as pods on the **worker nodes** | Me, by running `helm install` **from** the bastion |

**Think of it like an app store:**

1. **Helm** = the app store program. It sits on the **bastion**.
2. I type `helm install argocd ...` on the **bastion**.
3. Helm sends the Argo CD YAML files to the cluster's **API server** (HTTPS 443).
4. Argo CD gets **installed in the cluster** and **runs on the worker nodes as pods**, **not on the bastion**.

```
🖥️ Bastion                         ☸️ EKS cluster
┌──────────────┐   helm install   ┌───────────────────────────────┐
│ helm     ✅   │ ───────────────► │ Worker nodes                  │
│ kubectl  ✅   │   (HTTPS 443)    │   argocd-server pod       ✅   │
│ argocd   ❌   │                  │   argocd-repo-server pod  ✅   │
└──────────────┘                  │   argocd-controller pod   ✅   │
                                  └───────────────────────────────┘
```

**Proof (run on 🖥️ bastion):**

```bash
kubectl get pods -n argocd -o wide   # NODE column = worker node names, not the bastion
```

### Is Argo CD installed on every worker node?

![Argo CD pods spread across worker nodes](images/eks-terraform-argocd-architecture.png)

**No.** Argo CD is a group of **pods** (Deployments + one StatefulSet), usually **1 copy of each** by default. The **scheduler** places each pod on **one** worker node that has free CPU/RAM. So the pods are **spread across** the nodes, not copied to every node.

| Argo CD pod | Job | Copies (default) |
|---|---|---|
| `argocd-server` | UI + API (what I open in the browser) | 1 |
| `argocd-repo-server` | Reads my Git repo, builds the YAML | 1 |
| `argocd-application-controller` | Compares Git vs cluster, applies changes (StatefulSet) | 1 |
| `argocd-applicationset-controller` | Creates many Argo CD apps from one template | 1 |
| `argocd-redis` | Cache | 1 |
| `argocd-dex-server` | Login with GitHub / SSO | 1 |
| `argocd-notifications-controller` | Sends Slack / email alerts | 1 |

Example with my 2 worker nodes:

```
Worker node 1                        Worker node 2
┌───────────────────────────┐       ┌───────────────────────────┐
│ argocd-server             │       │ argocd-repo-server        │
│ argocd-redis              │       │ argocd-application-ctrl   │
│ argocd-dex-server         │       │ argocd-applicationset-ctrl│
│                           │       │ argocd-notifications-ctrl │
└───────────────────────────┘       └───────────────────────────┘
        (scheduler decides; your layout may be different)
```

| Question | Answer |
|---|---|
| Who decides which node? | The **scheduler** in the control plane |
| What if a node dies? | Its Argo CD pods are **recreated on the other node** |
| Something that runs on **every** node? | That's a **DaemonSet** (e.g. `kube-proxy`, `aws-node`). Argo CD is **not** a DaemonSet |
| Production (high availability)? | Run **2+ copies** of each pod (Helm values, e.g. `server.replicas=2`) so they sit on different nodes |

### Class demo (Killercoda) vs my EKS: why did the trainer install Helm on the control plane?

In class the trainer ran `curl ... get-helm-4 | ./get_helm.sh` at the prompt `root@controlplane`. That does **not** install Helm *into* the cluster. It installs the **`helm` program** on the machine they were typing on.

| | Killercoda (class demo) | My EKS setup |
|---|---|---|
| Cluster type | Self-managed (kubeadm): I get a shell **on the control-plane machine** | AWS-managed: control plane is **hidden**, no login |
| Where I type commands | `root@controlplane` | `ubuntu@bastion` |
| Where `kubectl` + `helm` are installed | On the control-plane node's Linux | On the **bastion** |
| What `helm` does | Sends YAML to the API server | Same |

```
Killercoda:  root@controlplane ── helm ──► API server (same machine) ──► node01 pods
EKS:         ubuntu@bastion    ── helm ──► API server (AWS-managed)  ──► worker node pods
```

> **Rule:** Helm goes on **whatever machine I type commands on** (like `kubectl`). In EKS I can't get into the control plane, so the **bastion** plays that role.

**Install Helm by hand (same as the trainer):**

```bash
# 🖥️ on the machine where I run kubectl (bastion in EKS)
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4
chmod 700 get_helm.sh
./get_helm.sh            # installs /usr/local/bin/helm
helm version
```

> My bastion bootstrap script already does this automatically (it uses `get-helm-3` → Helm 3; the trainer used Helm 4). Both work for Argo CD with the same commands.

### Common questions

| Question | Answer |
|---|---|
| Where do I run the `helm` and `kubectl` commands? | 🖥️ **Bastion host** |
| Do I install Helm on the bastion? | Already done: the bootstrap script installs it. Check with `helm version` |
| Do I install Helm on the cluster too? | ❌ **No.** Helm is only a **client tool** (like `kubectl`). Nothing Helm-related runs in the cluster |
| Where does **Argo CD** get installed? | **Inside the Kubernetes cluster**, as pods in the `argocd` namespace |
| On the control plane or worker nodes? | Argo CD **pods run on the worker nodes**. The control plane only stores their records in etcd and schedules them |
| Is Argo CD installed on the bastion? | ❌ No. The bastion only **sends** the install command |
| How do I open the Argo CD UI? | Browser → **AWS load balancer** (public subnet) → `argocd-server` pod on a worker node |

### How `helm install` works, step by step

| Step | Where | What happens |
|---|---|---|
| 1 | 🖥️ Bastion | I run `helm install argocd argo/argo-cd ...` |
| 2 | 🖥️ Bastion | Helm **downloads the chart** from the Argo repo and fills the templates with values → many K8s YAMLs (Deployments, Services, Secrets, RBAC, CRDs) |
| 3 | Bastion → Control plane | Helm sends those YAMLs to the **API server** over **HTTPS (443)**, the same way `kubectl` does (uses `~/.kube/config`) |
| 4 | Control plane | API server saves them in **etcd**; **scheduler** picks worker nodes for the Argo CD pods |
| 5 | Worker nodes | **kubelet** tells **containerd** to **pull the Argo CD images** and start the pods |
| 6 | AWS | The `LoadBalancer` Service makes AWS create a **load balancer** in the public subnets |
| 7 | 💻 My browser | Open the LB address → reaches the `argocd-server` pod → Argo CD UI |

```
 🖥️ Bastion                     Control plane (AWS)              Worker nodes (my VPC, private)
┌───────────────┐  HTTPS 443  ┌──────────────────────┐        ┌──────────────────────────────────┐
│ helm install  │ ──────────► │ API server → etcd    │ ─────► │ namespace: argocd                │
│ (client only) │             │ scheduler            │        │  argocd-server  (UI + API)       │
└───────────────┘             └──────────────────────┘        │  argocd-repo-server (reads Git)  │
                                                              │  argocd-application-controller   │
                                                              │  argocd-redis, dex ...           │
💻 Browser ──► AWS Load Balancer (public subnet) ───────────► │  └─ argocd-server pod            │
                                                              └──────────────────────────────────┘
```

> **Simple:** Helm lives on the bastion and only sends orders. Argo CD lives **inside the cluster**, as pods on the **worker nodes**.

### Steps

> Step 0 starts on your **💻 laptop** (to SSH in). **Every step after that runs on the 🖥️ bastion.**

**Step 0 — 💻 LAPTOP → 🖥️ BASTION: SSH in and check tools**

```bash
# 💻 LAPTOP
ssh -i ~/.ssh/abhigna-eks-key.pem ubuntu@$(terraform output -raw bastion_public_ip)

# 🖥️ BASTION
helm version                # Helm is installed
kubectl get nodes           # cluster reachable, 2 nodes Ready
```

**Step 1 — 🖥️ run on BASTION: add the Argo Helm repo** (like adding a yum/apt repo)

```bash
# 🖥️ BASTION
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update
helm search repo argo/argo-cd          # see chart versions
```

**Step 2 — 🖥️ run on BASTION: install Argo CD into the cluster**

```bash
# 🖥️ BASTION
helm install argocd argo/argo-cd \
  --namespace argocd \
  --create-namespace \
  --set server.service.type=LoadBalancer
```

| Part | Meaning |
|---|---|
| `argocd` | Release name (my name for this install) |
| `argo/argo-cd` | Repo `argo` / chart `argo-cd` |
| `--namespace argocd --create-namespace` | Put everything in its own namespace |
| `--set server.service.type=LoadBalancer` | Change one value: create an AWS load balancer so I can open the UI |

**Step 3 — 🖥️ run on BASTION: check it is running in the cluster**

```bash
# 🖥️ BASTION
helm list -n argocd                       # release status: deployed
kubectl get pods -n argocd -o wide        # all Running; NODE column = which worker node
kubectl get svc -n argocd argocd-server   # EXTERNAL-IP = load balancer DNS
```

> `-o wide` shows the **NODE** column, proof that Argo CD pods run on the **worker nodes**.

**Step 4 — 🖥️ run on BASTION: get the admin password**

```bash
# 🖥️ BASTION
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

**Step 5 — 💻 on LAPTOP browser: open the Argo CD UI**

- 💻 **Laptop browser:** open `https://<EXTERNAL-IP from step 3>` (wait 2–3 min for the LB DNS).
- Accept the self-signed certificate warning.
- Login: user **admin**, password from step 4.

> **No load balancer?** Port-forward through the bastion with an SSH tunnel:
> ```bash
> # 🖥️ BASTION
> kubectl port-forward svc/argocd-server -n argocd 8080:443
> # 💻 LAPTOP (new terminal)
> ssh -i ~/.ssh/abhigna-eks-key.pem -L 8080:localhost:8080 ubuntu@<bastion-ip>
> ```
> Then open `https://localhost:8080` on the laptop.

**Upgrade / remove — 🖥️ run on BASTION**

```bash
# 🖥️ BASTION
helm upgrade argocd argo/argo-cd -n argocd --set server.service.type=LoadBalancer
helm history argocd -n argocd
helm rollback argocd 1 -n argocd
helm uninstall argocd -n argocd       # removes Argo CD pods and the LB
```

---

## 10. Destroy everything

EKS + NAT gateway + EC2 cost money every hour. Destroy when the lab is done.

```bash
# 1. On the bastion: delete things Kubernetes created outside Terraform (load balancers)
helm uninstall argocd -n argocd

# 2. On my machine
terraform destroy -auto-approve
```

> **Why step 1 first?** The load balancer was created by Kubernetes, not Terraform. If it is still there, `terraform destroy` can fail deleting the VPC/subnets because the LB is still using them.

| Costs money | |
|---|---|
| EKS control plane | Hourly charge per cluster |
| Worker nodes + bastion | EC2 hourly |
| NAT gateway | Hourly + per GB |
| Load balancer (Argo CD) | Hourly |

---

## 11. Common problems

| Problem | Cause | Fix |
|---|---|---|
| `InvalidKeyPair.NotFound` | Key pair not created in this region | Create `abhigna-eks-key` in `us-east-1` |
| `InvalidAMIID.NotFound` | AMI ID is from another region | Get the Ubuntu 22.04 AMI ID for your region |
| `kubectl get nodes` → `Unauthorized` / no access | kubeconfig not set, or IAM role has no access entry | Re-run `aws eks update-kubeconfig ...`; check access entry |
| `kubectl` not found on bastion | `user_data` still running or failed | `sudo tail -f /var/log/bastion-bootstrap.log` |
| Nodes `NotReady` | Node too small / CNI not ready | Use at least `t3.medium`; check `kubectl get pods -n kube-system` |
| `terraform destroy` stuck on VPC/subnet | Load balancer from a K8s Service still exists | `helm uninstall` / delete the Service, then destroy again |
| Argo CD `EXTERNAL-IP` `<pending>` | LB still being created | Wait 2–3 min |

---

## 12. Commands Cheat Sheet

| Command | Use |
|---|---|
| `terraform init` | Download providers + modules |
| `terraform plan` | Preview changes |
| `terraform apply -auto-approve` | Create everything |
| `terraform output` | Show outputs (bastion IP, kubectl command) |
| `terraform destroy -auto-approve` | Delete everything |
| `aws eks update-kubeconfig --region <r> --name <cluster>` | Connect kubectl to EKS |
| `kubectl get nodes` | Check worker nodes |
| `helm repo add <name> <url>` | Add a chart repo |
| `helm repo update` | Refresh repo list |
| `helm search repo <word>` | Find charts |
| `helm install <release> <repo/chart> -n <ns>` | Install a chart |
| `helm list -A` | List releases |
| `helm upgrade <release> <chart>` | Upgrade |
| `helm history <release>` | See revisions |
| `helm rollback <release> <rev>` | Go back to a revision |
| `helm uninstall <release>` | Remove |
| `helm show values <repo/chart>` | See all values you can change |

---

## 13. Interview Questions

### Other Questions

**Q1. Why create EKS with Terraform instead of the console?**
Repeatable, same in every environment, reviewed in Git, and `terraform destroy` cleans up everything in order.

**Q2. What is a Terraform module?**
Reusable, ready-made Terraform code. You pass inputs; it creates many resources. Example: `terraform-aws-modules/eks/aws`.

**Q3. Why put worker nodes in private subnets?**
Security: nodes get no public IP. They reach the internet through the NAT gateway; only the bastion and load balancers are public.

**Q4. What is a bastion host?**
A small public server you SSH into to manage private resources (here: run `kubectl` and `helm` against the cluster).

**Q5. Why tag subnets with `kubernetes.io/role/elb`?**
So EKS / the load balancer controller knows which subnets to use for public (`elb`) and internal (`internal-elb`) load balancers.

**Q6. What does `enable_irsa = true` do?**
Creates the IAM OIDC provider so Kubernetes service accounts (pods) can assume IAM roles (IRSA).

**Q7. How does the bastion get access to the cluster?**
IAM role on the EC2 → EKS access entry maps it to a K8s group → ClusterRoleBinding gives that group `cluster-admin`.

**Q8. What is Helm?**
The package manager for Kubernetes. It installs, upgrades and rolls back apps using charts.

**Q9. Chart vs release?**
Chart = the package (templates + values). Release = one installed copy of a chart in the cluster.

**Q10. How do you change settings when installing a chart?**
`--set key=value` for a few values, or `-f my-values.yaml` for many.

**Q11. How do you roll back a Helm release?**
`helm history <release>` to find the revision, then `helm rollback <release> <revision>`.

**Q12. What is Argo CD / GitOps?**
Argo CD is a GitOps tool: Git is the source of truth, and Argo CD keeps the cluster in sync with the YAML in Git.

**Q13. How do you get the Argo CD admin password?**
From the secret `argocd-initial-admin-secret` in the `argocd` namespace, base64-decoded.

**Q14. Why delete load balancers before `terraform destroy`?**
Kubernetes created them, not Terraform. They keep using the subnets, so the VPC delete fails until they are gone.

**Q15. In EKS, do you create the control plane?**
I request it in Terraform (`module "eks"`), but AWS builds, runs, patches and scales it in an AWS-owned account. I can't see or SSH into it. I define only the worker nodes (node group).

**Q16. You SSH into the bastion. Which part of the cluster does `kubectl` talk to?**
The control plane's API server, over HTTPS (443), using the kubeconfig and the bastion's IAM role. Not the worker nodes, and not over SSH.

**Q17. Is the bastion part of the cluster?**
No. It's a separate EC2 in a public subnet used as an admin machine with kubectl and helm installed.

**Q18. Do you install Helm in the cluster?**
No. Helm 3 is only a client tool on the machine that runs it (the bastion). It sends YAML to the API server like kubectl. (Old Helm 2 had a server part called Tiller; it was removed.)

**Q19. Where does Argo CD run?**
Inside the cluster, as pods in the `argocd` namespace on the worker nodes. The bastion only runs the `helm install` command.


**Q20. Is Argo CD installed on every worker node?**
No. It's a set of pods (1 copy each by default) that the scheduler spreads across nodes. Pods that run on every node are DaemonSets, like kube-proxy and aws-node.
---

**Source:** [Class code: devopsbyraham/eks-code](https://github.com/devopsbyraham/eks-code) · [terraform-aws-modules/eks](https://registry.terraform.io/modules/terraform-aws-modules/eks/aws/latest) · [terraform-aws-modules/vpc](https://registry.terraform.io/modules/terraform-aws-modules/vpc/aws/latest) · [Helm docs](https://helm.sh/docs/) · [Argo CD Helm chart](https://github.com/argoproj/argo-helm/tree/main/charts/argo-cd) · [Argo CD getting started](https://argo-cd.readthedocs.io/en/stable/getting_started/)
