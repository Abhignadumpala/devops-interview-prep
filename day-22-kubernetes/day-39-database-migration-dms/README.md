# Day 39 - Database Migration with AWS DMS (MariaDB on EC2 → Amazon Aurora MySQL)

[← Kubernetes notes](../README.md)

> **In short:** a **database migration** moves data from one database (the **source**) to another (the **target**) without losing anything, usually from self-managed servers to a managed cloud database. **AWS DMS** (Database Migration Service) does this for you: a **replication instance** reads from the **source endpoint** and writes to the **target endpoint**, following a **migration task**. It can copy everything once (**full load**) and then keep copying new changes (**CDC**) until you switch the app over (**cutover**). In this lab we migrate a **MariaDB** database on an **Ubuntu EC2** to **Amazon Aurora MySQL**.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | What a migration is and why, homogeneous vs heterogeneous, offline vs online, AWS DMS and its building blocks, migration types (full load, CDC), Aurora, the IAM roles and S3 bucket DMS needs | How a database migration works and every piece involved |
| **Part 2: Lab** | MariaDB on EC2 (source) → sample data → Aurora MySQL (target) → DMS replication instance, endpoints and task → verify → test CDC → clean up | Do a real migration end to end in the AWS console |
| **Part 3: Production** | Cutover plan, validation, rollback, heterogeneous migrations | How real teams migrate with minimal downtime |

## Table of Contents

**Part 1: Concepts**
1. [What is database migration?](#1-what-is-database-migration)
2. [Homogeneous vs heterogeneous](#2-homogeneous-vs-heterogeneous)
3. [Offline vs online migration](#3-offline-vs-online-migration)
4. [What is AWS DMS?](#4-what-is-aws-dms)
5. [DMS building blocks](#5-dms-building-blocks)
6. [Migration types: full load and CDC](#6-migration-types-full-load-and-cdc)
7. [What is Amazon Aurora?](#7-what-is-amazon-aurora)
8. [IAM roles and the S3 bucket DMS needs](#8-iam-roles-and-the-s3-bucket-dms-needs)

**Part 2: Lab**

9. [Lab overview](#9-lab-overview)
10. [Step 1: Security groups](#10-step-1-security-groups)
11. [Step 2: Source, MariaDB on Ubuntu EC2](#11-step-2-source-mariadb-on-ubuntu-ec2)
12. [Step 3: Create sample data](#12-step-3-create-sample-data)
13. [Step 4: Target, Aurora MySQL](#13-step-4-target-aurora-mysql)
14. [Step 5: S3 bucket and IAM roles](#14-step-5-s3-bucket-and-iam-roles)
15. [Step 6: DMS replication instance](#15-step-6-dms-replication-instance)
16. [Step 7: Source and target endpoints](#16-step-7-source-and-target-endpoints)
17. [Step 8: Migration task](#17-step-8-migration-task)
18. [Step 9: Verify on Aurora and test CDC](#18-step-9-verify-on-aurora-and-test-cdc)
19. [Step 10: Clean up](#19-step-10-clean-up)
20. [Troubleshooting](#20-troubleshooting)

**Part 3: Production**

21. [Cutover, validation and rollback](#21-cutover-validation-and-rollback)

**Wrap-up**

22. [What I learned](#22-what-i-learned)
23. [Commands](#23-commands)
24. [Interview Questions](#24-interview-questions)

---

# Part 1: Concepts

## 1. What is database migration?

**Definition:** database migration is moving a database (schema + data) from one place to another, for example from a MySQL server on your own machine to a managed database in AWS. The goal is that the target has **exactly the same data** as the source, and the application can switch to it with as little downtime as possible. Example: `classicmodels` on MariaDB `10.11` (EC2) → `classicmodels` on Aurora MySQL `8.0`.

**Why teams migrate:**

| Reason | Example |
|---|---|
| Stop managing servers | No more OS patches, backups and failover scripts: AWS does it (RDS/Aurora) |
| High availability | Aurora keeps 6 copies of data across 3 AZs, failover in ~30 s |
| Scale | Add read replicas in minutes |
| Cost / licences | Leave expensive Oracle/SQL Server licences for MySQL/PostgreSQL |
| Data center exit | Move everything from on-prem to the cloud |

```
   SOURCE                                         TARGET
 ┌──────────────────┐                      ┌──────────────────────┐
 │ MariaDB on EC2   │ ── schema + data ──► │ Amazon Aurora MySQL  │
 │ (self-managed)   │                      │ (managed by AWS)     │
 └──────────────────┘                      └──────────────────────┘
        app uses this today                   app uses this after cutover
```

## 2. Homogeneous vs heterogeneous

**Definition:** a **homogeneous** migration moves data between the **same (or compatible) engines**, so tables and data types stay the same. A **heterogeneous** migration moves between **different engines** (for example Oracle → PostgreSQL), so the schema and code must be **converted** first.

| | Homogeneous | Heterogeneous |
|---|---|---|
| Example | MariaDB → Aurora MySQL, MySQL → RDS MySQL | Oracle → Aurora PostgreSQL, SQL Server → MySQL |
| Schema conversion | Not needed | Needed: **DMS Schema Conversion** (or the AWS SCT tool) converts tables, views, procedures |
| Difficulty | Easy | Harder: test the converted code |
| Our lab | ✅ this one | — |

> MariaDB started as a copy (fork) of MySQL, so MariaDB → Aurora MySQL is treated as **homogeneous**.

## 3. Offline vs online migration

**Definition:** an **offline** migration stops the application, copies the data once, and starts the app on the new database (simple, but the app is down during the copy). An **online** migration copies the data **while the app keeps running**, then keeps copying new changes until a short switch-over (minutes of downtime, even for large databases).

| | Offline (full load only) | Online (full load + CDC) |
|---|---|---|
| App during copy | ❌ Stopped | ✅ Running |
| Downtime | Whole copy time (hours for big DBs) | Only the cutover (minutes) |
| When to use | Small DB, maintenance window allowed | Production, big DB, no long downtime allowed |

## 4. What is AWS DMS?

**Definition:** AWS Database Migration Service (DMS) is a managed AWS service that copies data from a source database to a target database. It supports most engines (MySQL, MariaDB, PostgreSQL, Oracle, SQL Server, MongoDB, S3…), and the source stays fully usable during the migration. You only pay for the replication instance while it runs.

```
                       ┌──────────── AWS DMS ────────────┐
 ┌──────────────┐      │  ┌──────────────────────────┐   │      ┌────────────────┐
 │ SOURCE       │      │  │  Replication instance    │   │      │ TARGET         │
 │ MariaDB      │ ───► │  │  (runs the task:         │   │ ───► │ Aurora MySQL   │
 │ (EC2)        │ read │  │   full load + CDC)       │   │write │                │
 └──────────────┘      │  └──────────────────────────┘   │      └────────────────┘
   source endpoint     └─────────────────────────────────┘        target endpoint
```

## 5. DMS building blocks

**Definition:** a DMS migration is made of 4 pieces: a **replication instance** (the worker machine), two **endpoints** (connection details for source and target), and a **task** (what to copy and how).

| Piece | What it is | In our lab |
|---|---|---|
| **Replication instance** | A managed EC2 machine (inside your VPC) that runs the migration | `dms-lab-instance`, `dms.t3.medium` |
| **Source endpoint** | Connection to the source: engine, host, port, user, password | MariaDB, EC2 private IP, `3306`, `dms_user` |
| **Target endpoint** | Connection to the target | Aurora MySQL, cluster **writer** endpoint, `3306`, `admin` |
| **Migration task** | Which tables to copy (table mappings) and the migration type | `classicmodels.%`, full load + CDC |
| **Subnet group** | Which subnets the replication instance can use | Default VPC subnets |

> 💡 **Newer option:** for MySQL/MariaDB/PostgreSQL → same engine, DMS also has **Homogeneous data migrations** (uses the database's own native tools, serverless, no replication instance to size). The classic replication instance shown here works for every engine pair, so it's the one to learn first.

## 6. Migration types: full load and CDC

**Definition:** **full load** copies all existing rows from the source tables to the target once. **CDC (Change Data Capture)** reads the source's change log (for MySQL/MariaDB: the **binary log, binlog**) and applies every new `INSERT`, `UPDATE` and `DELETE` to the target, so the target stays in sync while the app keeps writing to the source.

| Console option | Means | Use when |
|---|---|---|
| **Migrate existing data** | Full load only | Offline migration, or a one-time copy |
| **Migrate existing data and replicate ongoing changes** | Full load + CDC | ✅ Online migration (production) |
| **Replicate data changes only** | CDC only | Data was already copied another way (e.g. a dump) |

```
 time ─────────────────────────────────────────────────────────────►
 │◄──── FULL LOAD ────►│◄────────── CDC (ongoing changes) ──────────►│ CUTOVER
   copy all rows          apply new INSERT / UPDATE / DELETE            stop app writes,
                          from the binlog                               point app to target
```

**CDC needs the binlog** on the source, in **ROW** format:

| Setting | Value | Why |
|---|---|---|
| `log_bin` | on | Turn on the binary log (DMS reads changes from it) |
| `binlog_format` | `ROW` | Log the **changed rows**, not the SQL text |
| `binlog_row_image` | `FULL` | Log all columns of the row |
| `server_id` | any number, e.g. `1` | Required when the binlog is on |
| `expire_logs_days` | `1` or more | Keep binlogs long enough for DMS to read them |

## 7. What is Amazon Aurora?

**Definition:** Amazon Aurora is AWS's own cloud database engine, compatible with **MySQL** or **PostgreSQL** (apps connect with the normal MySQL/PostgreSQL clients). Its storage is shared and replicated **6 times across 3 AZs**, and it's built as a **cluster**: one **writer** instance and up to 15 **reader** replicas.

| Word | Meaning | Example |
|---|---|---|
| **DB cluster** | The Aurora database as a whole (storage + instances) | `my-db-cluster` |
| **Writer instance** | The one instance that accepts writes | `my-db-cluster-instance-1` |
| **Reader (replica)** | Read-only copies, also failover targets | none in the lab (to save cost) |
| **Cluster (writer) endpoint** | DNS name that always points to the current writer | `my-db-cluster.cluster-xxxx.us-east-1.rds.amazonaws.com` |
| **Reader endpoint** | DNS name that spreads reads across replicas | `my-db-cluster.cluster-ro-xxxx...` |

| | RDS MySQL | Aurora MySQL |
|---|---|---|
| Storage | EBS volume per instance | Shared cluster storage, 6 copies in 3 AZs |
| Failover | Multi-AZ standby, ~60–120 s | To a reader, usually ~30 s |
| Read replicas | Up to 15, async | Up to 15, share storage (low lag) |
| Cost | Lower | Higher, but faster and more available |

## 8. IAM roles and the S3 bucket DMS needs

**Definition:** DMS needs a few IAM roles so it can act inside your account: create network interfaces in your VPC, write logs to CloudWatch, and (optionally) write reports to S3. The console creates them automatically the **first** time; if it doesn't, the task fails with an IAM error and you create them yourself.

| Role | Trusts | Policy | Why |
|---|---|---|---|
| `dms-vpc-role` | `dms.amazonaws.com` | `AmazonDMSVPCManagementRole` | Lets DMS create the replication instance's network interfaces in your VPC. **Must** have exactly this name |
| `dms-cloudwatch-logs-role` | `dms.amazonaws.com` | `AmazonDMSCloudWatchLogsRole` | Lets DMS write task logs to CloudWatch |
| Assessment role (any name) | `dms.amazonaws.com` | S3 write to your bucket | Lets DMS save the **premigration assessment** report to S3 |

**S3 bucket:** a **premigration assessment** checks the source and target **before** you start (unsupported data types, missing primary keys, binlog settings…) and saves the report in an S3 bucket, for example `db-bucketmigration-00`.

---

# Part 2: Lab

## 9. Lab overview

**What we build:** everything in the same region (`us-east-1`) and the same **default VPC**, so DMS reaches both databases over private IPs.

```
                         Default VPC (172.31.0.0/16), us-east-1
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                                                                              │
 │  ┌──────────────────┐     ┌───────────────────────┐     ┌──────────────────┐ │
 │  │ EC2 Ubuntu       │     │ DMS replication       │     │ Aurora MySQL     │ │
 │  │ MariaDB :3306    │ ──► │ instance              │ ──► │ my-db-cluster    │ │
 │  │ classicmodels    │     │ task: full load + CDC │     │ :3306            │ │
 │  │ sg: mariadb-sg   │     └───────────────────────┘     │ sg: aurora-sg    │ │
 │  └──────────────────┘                                   └──────────────────┘ │
 │                                  S3: db-bucketmigration-00 (assessment report)│
 └──────────────────────────────────────────────────────────────────────────────┘
```

| Step | What | Where |
|---|---|---|
| 1 | Security groups | EC2 console |
| 2 | Source: MariaDB on Ubuntu EC2 | EC2 + SSH |
| 3 | Sample data | MariaDB |
| 4 | Target: Aurora MySQL | RDS console |
| 5 | S3 bucket + IAM roles | S3 / IAM console |
| 6 | Replication instance | DMS console |
| 7 | Source + target endpoints | DMS console |
| 8 | Migration task | DMS console |
| 9 | Verify + test CDC | SSH |
| 10 | Clean up 💰 | All |

> 💰 **Cost:** Aurora (~`db.t3.medium`), the DMS replication instance and EC2 all charge **per hour**. Do the lab in one session and run **Step 10** right after.

## 10. Step 1: Security groups

**Why first:** DMS connects to both databases on port **3306** from inside the VPC. Without these rules, the endpoint tests in Step 7 fail.

**EC2 console → Security Groups → Create security group** (VPC: default):

**`mariadb-sg`** (for the source EC2):

| Type | Port | Source | Why |
|---|---|---|---|
| SSH | 22 | My IP | You log in to the EC2 |
| MySQL/Aurora | 3306 | `172.31.0.0/16` (the VPC CIDR) | DMS reads from MariaDB |

**`aurora-sg`** (for Aurora):

| Type | Port | Source | Why |
|---|---|---|---|
| MySQL/Aurora | 3306 | `172.31.0.0/16` | DMS writes to Aurora, and you check the data from the EC2 |

> Your default VPC CIDR: **VPC console → Your VPCs → IPv4 CIDR**. In production, allow only the replication instance's security group, not the whole VPC.

## 11. Step 2: Source, MariaDB on Ubuntu EC2

### 2a. Launch the EC2

**EC2 console → Launch instance:** name `mariadb-source`, **Ubuntu 24.04**, `t3.micro`, your key pair, default VPC, **auto-assign public IP: enable**, security group `mariadb-sg`.

**SSH in** (from your laptop):

```bash
ssh -i ~/.ssh/<your-key>.pem ubuntu@<ec2-public-ip>
```

**Expected:** prompt `ubuntu@ip-172-31-x-x:~$`.

### 2b. Update the package list

```bash
sudo apt update
```

**What it does:** refreshes the list of available packages.

### 2c. Install MariaDB

```bash
sudo apt install -y mariadb-server
```

**What it does:** installs the MariaDB server and the `mysql`/`mariadb` client.

### 2d. Start and check it

```bash
sudo systemctl start mariadb
```

```bash
sudo systemctl status mariadb
```

**Expected:** `Active: active (running)`. Press `q` to exit.

### 2e. Secure the installation

```bash
sudo mariadb-secure-installation
```

| Prompt | Answer | Why |
|---|---|---|
| Enter current password for root | Press **Enter** | No password yet |
| Switch to unix_socket authentication | `n` | Keep password login |
| Change the root password? | `Y`, then your password twice | Protect root |
| Remove anonymous users? | `Y` | No login without a user name |
| Disallow root login remotely? | `Y` | Root only from this machine; DMS gets its own user (2g) |
| Remove test database? | `Y` | Not needed |
| Reload privilege tables now? | `Y` | Apply the changes |

> Some guides answer `n` to "Disallow root login remotely" so DMS can log in as root. A **dedicated migration user** (2g) is the safer, real-world way.

### 2f. Allow remote connections + turn on the binlog (for CDC)

MariaDB on Ubuntu listens only on `127.0.0.1` by default, so DMS can't reach it. Open the config file:

```bash
sudo vim /etc/mysql/mariadb.conf.d/50-server.cnf
```

Under `[mysqld]`, change `bind-address` and add the binlog settings:

```ini
[mysqld]
bind-address      = 0.0.0.0

# Binary log for DMS CDC (ongoing changes)
server_id         = 1
log_bin           = /var/log/mysql/mysql-bin.log
binlog_format     = ROW
binlog_row_image  = FULL
```

> The file already has `expire_logs_days = 10` (binlogs kept 10 days): leave it.

| Line | Meaning |
|---|---|
| `bind-address = 0.0.0.0` | Listen on all network interfaces (the security group still limits who connects) |
| `server_id`, `log_bin` | Turn on the binary log |
| `binlog_format = ROW`, `binlog_row_image = FULL` | Log full changed rows: what DMS CDC needs |

Restart to apply:

```bash
sudo systemctl restart mariadb
```

Check that it listens on all interfaces:

```bash
sudo ss -tlnp | grep 3306
```

**Expected:** `0.0.0.0:3306`.

### 2g. Create the migration user

Log in as root:

```bash
sudo mysql -u root -p
```

Then run these SQL lines (one at a time):

```sql
CREATE USER 'dms_user'@'%' IDENTIFIED BY '<your-password>';
```

```sql
GRANT SELECT, REPLICATION CLIENT, REPLICATION SLAVE ON *.* TO 'dms_user'@'%';
```

```sql
FLUSH PRIVILEGES;
```

| Part | Meaning |
|---|---|
| `'dms_user'@'%'` | User `dms_user` that may connect from any host (`%`); the security group limits it to the VPC |
| `SELECT` | Read the tables (full load) |
| `REPLICATION CLIENT, REPLICATION SLAVE` | Read the binlog (CDC) |

Check that the binlog is on:

```sql
SHOW VARIABLES LIKE 'binlog_format';
```

**Expected:** `ROW`.

## 12. Step 3: Create sample data

Still in the MariaDB prompt.

Create the database and switch to it:

```sql
CREATE DATABASE classicmodels;
```

```sql
USE classicmodels;
```

Create a table:

```sql
CREATE TABLE customers (
  customerNumber INT PRIMARY KEY,
  customerName   VARCHAR(50) NOT NULL,
  city           VARCHAR(50) NOT NULL,
  country        VARCHAR(50) NOT NULL,
  creditLimit    DECIMAL(10,2)
);
```

> Every table should have a **primary key**: DMS needs it to apply CDC updates and deletes correctly.

Insert rows:

```sql
INSERT INTO customers VALUES
  (103, 'Atelier graphique',          'Nantes',    'France',    21000.00),
  (112, 'Signal Gift Stores',         'Las Vegas', 'USA',       71800.00),
  (114, 'Australian Collectors, Co.', 'Melbourne', 'Australia', 117300.00),
  (119, 'La Rochelle Gifts',          'Nantes',    'France',    118200.00),
  (121, 'Baane Mini Imports',         'Stavern',   'Norway',    81700.00);
```

Verify:

```sql
SELECT * FROM customers;
```

**Expected:** 5 rows. Type `exit` to leave MariaDB.

## 13. Step 4: Target, Aurora MySQL

**RDS console → Databases → Create database:**

| # | Setting | Value | Why |
|---|---|---|---|
| 1 | Creation method | **Full configuration** | See every option |
| 2 | Engine type | **Aurora (MySQL Compatible)** | Our target |
| 3 | Version | Latest **Aurora MySQL 3.x** (MySQL 8.0 compatible) | Current, supported |
| 4 | Template | **Dev/Test** | Cheaper defaults |
| 5 | DB cluster identifier | `my-db-cluster` | Unique name in your account/region |
| 6 | Master username | `admin` | |
| 7 | Credentials management | **Self managed** → your password | You'll type it in the DMS target endpoint. *Production: Managed in Secrets Manager* |
| 8 | Instance class | **Burstable → `db.t3.medium`** | Smallest class for the lab |
| 9 | Availability | **Don't create an Aurora Replica** | Lab only; production adds one in another AZ |
| 10 | Compute resource | Don't connect to an EC2 compute resource | We set the network ourselves |
| 11 | VPC | **Default VPC** | Same VPC as EC2 and DMS |
| 12 | Public access | **No** | Database stays private |
| 13 | Security group | **Choose existing → `aurora-sg`** (remove `default`) | Port 3306 from the VPC |
| 14 | Port | `3306` | MySQL default |
| 15 | Monitoring | Turn off Enhanced Monitoring / Performance Insights | Save cost |
| 16 | Backup, encryption | Keep defaults (7-day backup, KMS `aws/rds`) | |
| 17 | Deletion protection | Off | So you can delete it after the lab |

Check **Estimated monthly costs** at the bottom, then **Create database**.

**Expected:** after ~10 minutes, the cluster and its writer instance are **Available**. Copy the **writer endpoint**: Databases → `my-db-cluster` → **Connectivity & security → Endpoints → Type: Writer**.

## 14. Step 5: S3 bucket and IAM roles

### 5a. S3 bucket (for the premigration assessment report)

**S3 console → Create bucket:** General purpose, name `db-bucketmigration-<unique>` (must be globally unique), **Block all public access: on**, encryption **SSE-S3**, **Create bucket**.

### 5b. Check the DMS VPC role

**IAM console → Roles → search `dms-vpc-role`.**

- ✅ Exists with policy `AmazonDMSVPCManagementRole` → go to Step 6.
- ❌ Missing → create it (from CloudShell or your laptop):

```bash
aws iam create-role --role-name dms-vpc-role --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"dms.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
```

```bash
aws iam attach-role-policy --role-name dms-vpc-role --policy-arn arn:aws:iam::aws:policy/service-role/AmazonDMSVPCManagementRole
```

| Part | Meaning |
|---|---|
| `create-role --role-name dms-vpc-role` | The role name **must** be exactly `dms-vpc-role`: DMS looks for it by name |
| `"Principal":{"Service":"dms.amazonaws.com"}` | Trust policy: only the DMS service can use (assume) this role |
| `attach-role-policy ... AmazonDMSVPCManagementRole` | AWS-managed permissions to create network interfaces in your VPC |

> Do the same for `dms-cloudwatch-logs-role` with `AmazonDMSCloudWatchLogsRole` if you want task logs in CloudWatch.

## 15. Step 6: DMS replication instance

**DMS console → Provisioned instances → Create replication instance:**

| Setting | Value | Why |
|---|---|---|
| Name | `dms-lab-instance` | |
| Instance class | `dms.t3.medium` | Enough for a small lab |
| Engine version | Default (latest) | |
| High availability | **Dev or test workload (Single-AZ)** | Cheaper; production uses Multi-AZ |
| Allocated storage | Default (50 GB) | Stores logs and cached changes |
| VPC | **Default VPC** | Same as source and target |
| Replication subnet group | Default (created automatically) | |
| Publicly accessible | **Off** | Everything is private in the VPC |

**Create.** **Expected:** status **Available** after ~5–10 minutes.

## 16. Step 7: Source and target endpoints

**DMS console → Endpoints → Create endpoint.**

### Source endpoint

| Setting | Value |
|---|---|
| Endpoint type | **Source endpoint** |
| Endpoint identifier | `mariadb-source` |
| Source engine | **MariaDB** |
| Access | Provide access information manually |
| Server name | EC2 **private** IP (e.g. `172.31.20.15`) |
| Port | `3306` |
| User name / password | `dms_user` / your password |

### Target endpoint

| Setting | Value |
|---|---|
| Endpoint type | **Target endpoint** |
| Endpoint identifier | `aurora-target` |
| Target engine | **Amazon Aurora MySQL** |
| Server name | Aurora **writer endpoint** (Step 4) |
| Port | `3306` |
| User name / password | `admin` / your Aurora password |

**Test both:** on each endpoint, **Test endpoint connection** → choose `dms-lab-instance` → **Run test**.

**Expected:** Status **successful** for both. Failed? See [Troubleshooting](#20-troubleshooting).

## 17. Step 8: Migration task

**DMS console → Database migration tasks → Create task:**

| Setting | Value | Why |
|---|---|---|
| Task identifier | `mariadb-to-aurora` | |
| Replication instance | `dms-lab-instance` | |
| Source / target endpoint | `mariadb-source` / `aurora-target` | |
| Migration type | **Migrate existing data and replicate ongoing changes** | Full load + CDC (online migration) |
| Target table preparation mode | **Do nothing** or **Drop tables on target** | Target is empty, either works |
| LOB column settings | Limited LOB mode | Default, fast |
| Data validation | **Turn on** | DMS compares source and target rows after the copy |
| Task logs | Turn on CloudWatch logs | See errors |
| Table mappings → Selection rule | Schema: `classicmodels`, Table: `%`, Action: **Include** | Copy every table in `classicmodels` |
| Premigration assessment | Optional: turn on, choose the S3 bucket from Step 5 | Report of problems **before** starting |
| Start task | **Automatically on create** | |

**Create task.**

**Expected:** status goes **Creating → Running**, and the **Table statistics** tab shows `customers`: **Full load rows: 5**, state **Table completed**. The task stays **Running (ongoing replication)** because of CDC.

## 18. Step 9: Verify on Aurora and test CDC

### Verify the full load

From the EC2 (it already has the MariaDB client, which talks to MySQL/Aurora):

```bash
mysql -h <aurora-writer-endpoint> -u admin -p
```

```sql
SELECT * FROM classicmodels.customers;
```

**Expected:** the same **5 rows** as the source. Type `exit`.

### Test CDC (ongoing changes)

Insert a new row on the **source**:

```bash
sudo mysql -u root -p
```

```sql
INSERT INTO classicmodels.customers VALUES (124, 'Mini Gifts Distributors', 'San Rafael', 'USA', 210500.00);
```

Wait ~10 seconds, then check the **target** again:

```bash
mysql -h <aurora-writer-endpoint> -u admin -p -e "SELECT * FROM classicmodels.customers WHERE customerNumber = 124;"
```

**Expected:** the new row is there. That's CDC: the app can keep writing to the source until cutover.

**In DMS → task → Table statistics:** `Inserts: 1`, and **Validation state: Validated**.

## 19. Step 10: Clean up

Delete in this order (dependencies first) 💰:

| # | Delete | Where |
|---|---|---|
| 1 | Stop, then delete the task `mariadb-to-aurora` | DMS → Database migration tasks |
| 2 | Endpoints `mariadb-source`, `aurora-target` | DMS → Endpoints |
| 3 | Replication instance `dms-lab-instance` | DMS → Provisioned instances |
| 4 | Aurora: delete the **writer instance** first, then the **cluster** (no final snapshot) | RDS → Databases |
| 5 | EC2 `mariadb-source` → Terminate | EC2 |
| 6 | Empty, then delete the S3 bucket | S3 |
| 7 | Security groups `mariadb-sg`, `aurora-sg` | EC2 → Security Groups |

> Keep `dms-vpc-role`: it's free and DMS needs it next time.

## 20. Troubleshooting

| Problem | Why | Fix |
|---|---|---|
| Source endpoint test: `Can't connect to MySQL server` / timeout | MariaDB listens on `127.0.0.1` only, or `mariadb-sg` doesn't allow 3306 from the VPC | `bind-address = 0.0.0.0` + restart (2f); add the 3306 rule (Step 1) |
| Source test: `Access denied for user` | Wrong password, or the user only allows `localhost` | Create the user as `'dms_user'@'%'` (2g) |
| Target endpoint test: timeout | `aurora-sg` missing 3306 from the VPC, or Aurora in another VPC | Fix the rule; keep everything in the same VPC |
| `The IAM Role arn:aws:iam::<account>:role/dms-vpc-role is not configured properly` | The role is missing or has the wrong name/policy | Create `dms-vpc-role` with `AmazonDMSVPCManagementRole` (5b) |
| Task fails at CDC: binlog error | Binlog off or not `ROW` | Binlog settings in 2f, restart MariaDB |
| Full load done, but updates/deletes not applied | Table has no primary key | Add a primary key on the source |
| Validation shows mismatches | Rows changed during the check, or type differences | Re-validate; check the table in **Table statistics** |

---

# Part 3: Production

## 21. Cutover, validation and rollback

**Definition:** **cutover** is the short moment when you stop the application writing to the old database and point it to the new one. Everything before it (full load + CDC + validation) happens while the app is still running, so downtime is only a few minutes.

**Cutover steps:**

```
 1. Full load done, CDC running, validation = Validated
 2. Stop app writes (maintenance page / scale app to 0)
 3. Wait until CDC latency = 0 (target has every change)
 4. Compare row counts source vs target
 5. Point the app to the Aurora writer endpoint (config / secret / DNS)
 6. Start the app, smoke test
 7. Stop the DMS task; keep the source read-only for a few days (rollback)
```

| Practice | Why |
|---|---|
| **Rehearse** on a copy of production first | Find problems and measure the real time |
| **Premigration assessment** | Catch unsupported types, missing keys, binlog settings before starting |
| **Data validation** in DMS | Row-by-row proof that source = target |
| **Use a DNS name** (Route 53 CNAME) for the DB | Cutover = change one record, not app config everywhere |
| **Rollback plan** | Keep the source untouched until the new DB is proven; switch back if needed |
| **Secrets Manager** for passwords | No passwords in app config or task settings |
| **Multi-AZ** replication instance | The migration survives an AZ failure |
| **Heterogeneous?** Convert the schema first with **DMS Schema Conversion**, then move data with DMS | Different engines need converted tables and code |

---

# Wrap-up

## 22. What I learned

**Concepts**
- Migration = move schema + data from a **source** to a **target** with no data loss and little downtime.
- **Homogeneous** (same engine family, e.g. MariaDB → Aurora MySQL) vs **heterogeneous** (needs schema conversion).
- **Offline** (full load, app stopped) vs **online** (full load + CDC, app running, minutes of downtime).
- **DMS** = replication instance + source endpoint + target endpoint + task.
- **CDC** reads the **binlog** (`ROW` format) and applies every change.
- **Aurora** = cluster with a writer + readers, storage 6 copies in 3 AZs; connect to the **writer endpoint**.
- DMS needs **`dms-vpc-role`** (exact name); S3 stores the premigration assessment.

**Lab**
- Security groups first (3306 from the VPC) → MariaDB with `bind-address 0.0.0.0` + binlog + `dms_user` → sample data → Aurora → replication instance → endpoints (test!) → task (full load + CDC) → verify + CDC test → clean up.

```
 MariaDB (EC2) ──► DMS replication instance ──► Aurora MySQL
   binlog ROW        full load + CDC              writer endpoint
                     validation on                → app cutover
```

## 23. Commands

| Command | What it does |
|---|---|
| `sudo apt install -y mariadb-server` | Install MariaDB |
| `sudo systemctl status mariadb` | Is MariaDB running? |
| `sudo mariadb-secure-installation` | Root password, remove anonymous users and test DB |
| `sudo ss -tlnp \| grep 3306` | Which address MariaDB listens on |
| `sudo mysql -u root -p` | Log in to the local MariaDB as root |
| `mysql -h <endpoint> -u admin -p` | Connect to Aurora (or any MySQL) remotely |
| `SHOW VARIABLES LIKE 'binlog_format';` | Check the binlog format (`ROW` for CDC) |
| `SHOW MASTER STATUS;` | Current binlog file and position |
| `aws dms describe-replication-tasks --query 'ReplicationTasks[].[ReplicationTaskIdentifier,Status]'` | Task status from the CLI |
| `aws dms describe-table-statistics --replication-task-arn <arn>` | Rows loaded / inserted / validated per table |
| `aws iam get-role --role-name dms-vpc-role` | Does the DMS VPC role exist? |

## 24. Interview Questions

### Other Questions

**Q1. What is AWS DMS and how does it work?**
A managed service that migrates data between databases. A replication instance in your VPC reads from the source endpoint and writes to the target endpoint according to a migration task, which defines the tables to copy and the migration type (full load, full load + CDC, or CDC only). The source stays usable during the migration.

**Q2. What is CDC and what does it need on MySQL/MariaDB?**
Change Data Capture: after the full load, DMS keeps applying every insert, update and delete from the source to the target, so the two stay in sync while the app keeps running. On MySQL/MariaDB it reads the binary log, so the binlog must be on with `binlog_format=ROW` and `binlog_row_image=FULL`, kept long enough, and the DMS user needs `REPLICATION CLIENT` and `REPLICATION SLAVE`.

**Q3. How do you migrate a production database with minimal downtime?**
Use full load + CDC: copy everything while the app runs, keep replicating changes, validate the data, then at cutover stop writes, wait for CDC latency to reach zero, switch the app (ideally a DNS record) to the new database and start it again. Downtime is only the cutover, and the old database stays as the rollback option.

**Q4. Homogeneous vs heterogeneous migration?**
Homogeneous is between the same or compatible engines (MySQL/MariaDB → Aurora MySQL), so no schema conversion is needed. Heterogeneous is between different engines (Oracle → PostgreSQL): you first convert the schema and code with DMS Schema Conversion (or AWS SCT), then move the data with DMS.

**Q5. What are the main DMS components?**
Replication instance (the compute that runs the migration), source endpoint and target endpoint (connection details), the replication subnet group (where the instance runs), and the migration task (table mappings, migration type, settings like validation and LOB handling).

**Q6. Your DMS endpoint test fails. How do you troubleshoot?**
Check network first: same VPC or routing, security groups allowing 3306 from the replication instance, and that the database listens on a reachable address (MySQL/MariaDB `bind-address`). Then credentials and host permissions (`user@'%'`), then engine-specific settings. For IAM errors, check that `dms-vpc-role` exists with `AmazonDMSVPCManagementRole`.

**Q7. Why does DMS need primary keys?**
To apply CDC updates and deletes it must find the exact row on the target. Without a primary key or unique index, updates and deletes can't be matched reliably, and validation also needs a key to compare rows.

**Q8. What is a premigration assessment?**
A check DMS runs before the task starts: unsupported data types, missing primary keys, wrong binlog settings, LOB issues, and more. The report is saved in an S3 bucket, so you fix problems before the migration instead of during it.

**Q9. Aurora vs RDS MySQL?**
Both are managed MySQL. Aurora has shared cluster storage replicated 6 times across 3 AZs, faster failover (usually ~30 s) and low-lag readers sharing that storage; RDS MySQL uses an EBS volume per instance and costs less. Choose Aurora for high availability and read scaling, RDS MySQL for smaller, cost-sensitive workloads.

**Q10. How do you verify a migration succeeded?**
Turn on DMS data validation (row-by-row comparison), compare row counts and checksums of key tables, check the task's table statistics for errors, and run the application's smoke tests against the new database before cutover is final.

---

[← Kubernetes notes](../README.md)
