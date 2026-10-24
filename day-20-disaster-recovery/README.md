# Day 20 — Disaster Recovery (DR): Short and Simple

## What is Disaster Recovery?

**Definition:** Disaster Recovery (DR) is the plan, setup and steps to **bring your application and its data back** after a big failure, so the business can keep running.

**What is a disaster?** Something that takes down far more than one server:

| Type | Example |
|---|---|
| Region / data centre outage | AWS Mumbai region goes down |
| Data loss | Someone runs `DROP TABLE` or deletes an S3 bucket |
| Cyber attack | Ransomware encrypts the database |
| Bad change | A wrong deployment or Terraform run breaks production |
| Natural event | Flood or fire at the data centre |

**Why we need DR:**
- Downtime = **lost money** (no orders) and angry customers
- Lost data = **lost orders and payments** that may never come back
- Many companies (banks, healthcare) **must** have DR by law/compliance

**How DR works (the idea):**

```
Normal:    Users ──▶ PRIMARY region (app + DB)      ── copies data ──▶  DR region
Disaster:  Users ──▶ DR region  (app brought up from the copies)
```

**Two questions decide every DR design:**

- **RPO (Recovery Point Objective):** the maximum amount of data, measured in time, that the business can afford to lose. It is the gap between the **last good copy** of data and the **disaster**.
  *Example:* backup every 1 hour → up to 1 hour of orders can be lost → RPO = 1 hr.
  👉 Question it answers: **how much data can we lose?**
- **RTO (Recovery Time Objective):** the maximum time the app can stay **down** after a disaster before it must be working again. It is the gap between the **disaster** and the **app being back up**.
  *Example:* the business says "the app must be back within 30 minutes" → RTO = 30 min.
  👉 Question it answers: **how long can we be down?**

**Small RPO/RTO = less loss but more cost. Big RPO/RTO = more loss but cheaper.**

The answers pick one of **4 strategies**, from cheap and slow to costly and instant. The deciding factor is **what is already running in the DR region**.

> **AWS rule:** if the DR setup costs more than the loss it prevents, don't build it (unless a law requires it). Some low-risk apps need no DR at all, and a **multi-AZ** setup in one region already covers a single data-centre failure.

![DR in one picture](./images/dr-simple.png)

---

## 1. Key words

| Word | Simple definition |
|---|---|
| **Disaster** | A big failure: a whole region down, data deleted, ransomware |
| **DR (Disaster Recovery)** | The plan and setup to bring the app and data back after a disaster |
| **Primary region** | Where the app normally runs (e.g. Mumbai `ap-south-1`) |
| **DR region** | The backup location (e.g. Singapore `ap-southeast-1`) |
| **RPO** (Recovery Point Objective) | Max **data** you can lose, in time. *"How old can my last copy be?"* AWS: *max acceptable time since the last data recovery point* |
| **RTO** (Recovery Time Objective) | Max **downtime**. *"How fast must the app be back?"* AWS: *max acceptable delay between service interruption and restoration* |
| **Failover** | Switching users from the primary to the DR region |
| **Failback** | Moving back to the primary after it is fixed |
| **HA vs DR** | HA = survive a small failure (1 server / 1 AZ) automatically. DR = survive losing a whole region, or lost/corrupted data |
| **Active/passive** | Only the primary serves users; DR waits (Backup & Restore, Pilot Light, Warm Standby) |
| **BIA** (Business Impact Analysis) | Study of what downtime and data loss cost the business; used to set RTO/RPO |

### RPO vs RTO in one example

```
10:00 last backup ─────── 11:30 💥 disaster ─────── 13:00 app back
      └── RPO: 1h30m of DATA lost ──┘└── RTO: 1h30m of DOWNTIME ──┘
```

- **RPO → data loss** (orders placed 10:00–11:30 are gone)
- **RTO → business loss** (no one can order 11:30–13:00)
- The **business** sets the targets (from a BIA); **DevOps** builds to meet them and tests them.

| | RPO | RTO |
|---|---|---|
| **Question** | How much **data** can we lose? | How long can we be **down**? |
| **Looks** | Backward: disaster → last good copy | Forward: disaster → app back up |
| **Loss type** | Data loss (saved orders gone) | Business loss (no new orders) |
| **Controlled by** | How **often** data is copied | How **ready** the DR region is |

### Is MTTR / MTTF the same as RTO / RPO?

**No.** RTO/RPO = **targets** set before a disaster. MTTR/MTTF = **averages measured** after many failures. Goal: **MTTR < RTO**.
👉 Full comparison with example: [SRE Day 21 — MTTR/MTTF vs RTO/RPO](../day-21-sre/day-21-sre-incidents/README.md#is-mttr--mttf-the-same-as-rto--rpo)

### Questions to set RTO and RPO

**Definition:** Questions you ask the **app owner** to find the right RTO and RPO for an app.

**RTO questions (downtime):**

| Ask | Meaning |
|---|---|
| Impact if the app is down? Does it get worse over time? | What breaks, and how fast it hurts. AWS example: payroll down **just before payday** = huge impact; just after = small |
| Money lost per hour? | Cost of downtime |
| Reputation cost? | Public notices, e.g. company homepage down |
| Any SLA with customers? | Uptime already promised |
| Compliance / regulatory rules? | A law may fix the recovery time |
| Dependencies? | Which apps it needs, and which apps need it |

**RPO questions (data loss):** the same questions (impact, money, reputation, SLA, compliance), plus:

| Ask | Meaning |
|---|---|
| Do other apps use this app's data? What RPO do they need? | Their RPO limits yours |
| Can lost data be recreated? How long would it take? | If it can be re-imported, a bigger RPO is OK |
| How often does the data change? | Changes every second (payments) → small RPO. Once a day (reports) → daily backup is enough |

> **One line:** big loss per hour → small RTO/RPO → costly strategy (warm / active-active). Small loss → bigger RTO/RPO → cheap strategy (backup & restore).

---

## 2. The 4 DR Strategies

AWS groups DR into **4 strategies**. They trade **cost** for **recovery speed**.

### 1️⃣ Backup & Restore

**Definition:** Take backups and **rebuild** the environment when a disaster happens.

```
PRIMARY REGION
      │
      ▼
   Backups
      │
      ▼
S3 / Backup Vault   (other region · nothing running)
```

- **On disaster:** rebuild infra (Terraform) → restore data from backups → deploy app → switch DNS
- **Back up more than data (AWS):** also AMIs, config and IaC code. Without IaC the rebuild is slow and may miss the RTO
- **AWS examples:** AWS Backup, S3, EBS snapshots, RDS snapshots, S3 Object Lock, cross-region backups
- **Advantages:** low cost, simple, good for less-critical workloads
- **Disadvantages:** slow recovery, more recovery work, higher RTO

> **Interview answer:** "Backup and restore means keeping recoverable backups in another location and rebuilding the infrastructure and application when a disaster occurs."

**Official AWS diagram (backup & restore):**

![AWS backup and restore architecture](https://docs.aws.amazon.com/images/whitepapers/latest/disaster-recovery-workloads-on-aws/images/backup-restore-architecture.png)

**How to read it:**
- **Left region (primary):** EBS, EC2, EFS and RDS are backed up as snapshots into **S3 / AWS Backup**. RDS transaction logs also go to S3.
- **Top arrow "Cross-region backup":** the backups are copied to the **right region (DR)**.
- **Right region:** only storage exists. The faded (light) servers and DB **do not exist yet**. On disaster they are **restored** from the backups.
- **Traffic:** no traffic routing here. Users get nothing until the restore is done → slowest recovery.

### 2️⃣ Pilot Light

**Definition:** Keep the **critical components ready**, but don't run the full production environment.

```
PRIMARY                     DR REGION
EKS + Database              Small infrastructure
      │                     +
      └── replication ───▶  Database replica
```

- **On disaster:** scale up the infrastructure and deploy the rest of the environment, promote the DB, switch DNS
- **Critical components** = core infra (VPC, subnets, security groups, IAM, EKS cluster / ASG at 0) + data (DB replica). App servers are **not running** yet.
- **AWS wording:** databases and storage are **always on**; app servers are **"switched off"**: code, AMIs and config are ready, but the servers are not deployed until failover.
- **AWS service:** AWS Elastic Disaster Recovery (DRS) works the pilot light way
- **Name meaning:** like a gas stove pilot flame: small flame always on, turn it up when needed

> **Interview answer:** "Pilot light keeps critical infrastructure and data ready in the DR region so the environment can be activated quickly during a disaster."

**Official AWS diagram (pilot light):**

![AWS pilot light architecture](https://docs.aws.amazon.com/images/whitepapers/latest/disaster-recovery-workloads-on-aws/images/pilot-light-architecture.png)

**How traffic flows:**
- **Route 53** sends users only to the **left region** (`Active`). The line to the right region says **"Inactive for production traffic"**.
- **Left region:** ELB → front-end servers → app servers → **Aurora Primary**, spread across 2 AZs with Auto Scaling groups.
- **Bottom arrow:** **Aurora Global Database** copies data to the right region (**asynchronous cross-region replication**).
- **Right region:** VPC, ELB, Auto Scaling groups and **Aurora Replica** exist, but the servers are faded: **"No instances running"**. That is the pilot light: critical infra + data ready, app off.
- **On disaster:** start the instances (ASG desired count up), promote Aurora Replica, switch Route 53 to the right region.

### 3️⃣ Warm Standby

**Definition:** Run a **smaller working version** of production in the DR region.

```
PRIMARY  10 nodes
            │ replication
            ▼
DR        3 nodes   (already running)
```

- **On disaster:** scale DR (3 → 10 nodes) → promote database → switch DNS
- **DB in DR is read-only** until promoted, so before failover it serves only reads / test traffic
- **AWS:** warm standby can take traffic **immediately** at reduced capacity; pilot light cannot without extra steps
- **Hot standby (AWS term):** like warm standby but at **full size**, still not serving users (active/passive)

> **Interview answer:** "Warm standby maintains a scaled-down but functional version of production that can be scaled during failover."

**Official AWS diagram (warm standby):**

![AWS warm standby architecture](https://docs.aws.amazon.com/images/whitepapers/latest/disaster-recovery-workloads-on-aws/images/warm-standby-architecture.png)

**How traffic flows:**
- **Route 53** still sends production users only to the **left region** (`Active`); the right one is **"Inactive for production traffic"**.
- **Right region:** **"Minimal instances running"**: 1 front-end + 1 app server are live (the others are faded), connected to the **Aurora Replica**.
- **"Write forwarding to Aurora Primary":** if the DR app needs to write (e.g. a test), Aurora forwards the write to the primary DB, because the replica is read-only.
- **Difference from pilot light:** same picture, but here some servers are **already running** → it can take traffic straight away.
- **On disaster:** scale up the ASGs, promote Aurora Replica, switch Route 53.

#### Pilot Light vs Warm Standby (most confused)

**Key idea:** "infrastructure" has 2 parts. **Core infra** = network, security, DB, cluster. **App capacity** = the servers/nodes that run the app.

| In DR region | Pilot Light | Warm Standby |
|---|---|---|
| Core infra (VPC, subnets, SG, IAM) | ✅ Ready | ✅ Ready |
| Data (DB replica, read-only) | ✅ Live, replicating | ✅ Live, replicating |
| App servers / nodes | ❌ **0**: not running | ✅ **3** running (primary has 10) |
| Can take traffic right now? | ❌ No | ✅ Yes, at low capacity |
| On disaster | Start app servers 0 → 10, deploy app, promote DB | Scale 3 → 10, promote DB |

> **One line:** Pilot light = **stage is set, actors at home**. Warm standby = **a small cast is already performing**.

### 4️⃣ Active-Active

**Definition:** **Both environments actively serve production traffic.**

```
            GLOBAL DNS
                │
     ┌──────────┴──────────┐
  REGION A              REGION B
     │                     │
    EKS                   EKS
     │                     │
  Database              Database
```

- **On disaster:** traffic keeps flowing through the other region. AWS: *"there is no such thing as failover"* here
- **Advantages:** very fast recovery, no break for users if one region fails
- **Disadvantages:** highest cost, highest complexity, data consistency challenges, more operations work
- **Still needs backups:** if data is deleted or corrupted, it is copied to both regions, so RPO is not zero for that case

**How writes work (AWS):** reads are served from the nearest region. Writes:

| Write style | Meaning | AWS DB |
|---|---|---|
| **Write global** | All writes go to one region; promote another if it fails | Aurora Global Database (promote < 1 min) |
| **Write local** | Each region takes writes; conflicts = *last writer wins* | DynamoDB Global Tables |
| **Write partitioned** | Each user's writes go to one fixed region (by user ID) | S3 two-way replication |

> **Interview answer:** "Active-active runs workloads in multiple locations simultaneously so traffic can continue through another location if one fails."

**Official AWS diagram (multi-site active/active):**

![AWS multi-site active/active architecture](https://docs.aws.amazon.com/images/whitepapers/latest/disaster-recovery-workloads-on-aws/images/multi-site-active-active-architecture.png)

**How traffic flows:**
- **Route 53** shows **Active** on **both** lines → users are sent to **both regions** at the same time (e.g. by latency or geolocation routing).
- **Each region** is full size: ELB → front-end → app servers in 2 AZs.
- **Database:** each region has its own **DynamoDB** table. **DynamoDB global tables** replicate data automatically **both ways**, so both regions can write.
- **DynamoDB continuous backup** in each region protects against deleted or corrupted data.
- **On disaster:** Route 53 health checks stop sending users to the failed region; the other region already has all the data.

---

## 3. Comparison Table

| Strategy | Infrastructure | Recovery Speed | Cost | Complexity |
|---|---|---|---|---|
| Backup & Restore | Mostly offline | Slow | Low | Low |
| Pilot Light | Critical components | Medium | Medium | Medium |
| Warm Standby | Reduced production | Fast | High | High |
| Active-Active | Full production | Very fast | Very high | Very high |

> These are **relative** comparisons. Actual recovery times depend on the workload and implementation.
> For a rough idea, the AWS whitepaper gives RPO/RTO of: **hours · tens of minutes · minutes · near zero (real time)**.
> The first 3 are **active/passive**; only Active-Active serves users from both regions.

---

## 4. How to choose a strategy

```
Business need → RTO / RPO target → Budget → Strategy
```

Don't pick the most impressive one. Pick the **cheapest one that meets the RTO/RPO**.

| App | Down 1 hour = ? | Strategy |
|---|---|---|
| Internal HR tool | Fine | Backup & Restore |
| Company website / blog | Annoying | Pilot Light |
| Food delivery / e-commerce | Lost orders | Warm Standby |
| Payments / UPI / banking | Not allowed | Active/Active |

---

## 5. Failover and Failback

### What is Failover?

**Definition:** Failover = **moving users and work from the failed primary region to the DR region**, so the app keeps running.

- **When:** the primary region is down or badly broken
- **Example:** Mumbai region fails → Route 53 starts sending users to Singapore → the app runs from Singapore
- **Type:** an emergency step, done **during** the disaster

### What is Failback?

**Definition:** Failback = **moving users and work back from the DR region to the primary region** after the primary is fixed.

- **When:** the primary region is healthy again
- **Example:** Mumbai is back → copy the new data from Singapore to Mumbai → switch Route 53 back to Mumbai
- **Type:** a planned step, done **after** the disaster, in a quiet time window

| | Failover | Failback |
|---|---|---|
| Direction | Primary → DR | DR → Primary |
| When | During the disaster | After the primary is fixed |
| Planned? | No, emergency | Yes, planned window |
| Data | DR replica promoted to writer | New data copied back DR → primary first |

```
Normal:    Users ──▶ Mumbai (primary)
Failover:  Users ──▶ Singapore (DR)        💥 Mumbai down
Failback:  Users ──▶ Mumbai (primary)      ✅ Mumbai fixed, data synced back
```

### Failover steps (pilot light / warm standby)

```
1. Detect: health check / alarm fires → team decides to fail over
2. Scale DR up (ASG / EKS nodes / terraform apply)
3. Promote DB replica → writer
4. Switch traffic to DR region (Route 53 failover / Global Accelerator)
5. Test + monitor
```

- **AWS advice:** automatic failover on a false alarm also causes data loss and downtime, so many teams **start failover manually** but **automate every step** ("one button").

![Failover](./images/failover.png)

### Failback steps

```
1. Fix the primary region
2. Copy (re-sync) data from DR → primary
3. Make primary DB the writer again
4. Switch DNS back to primary in a planned window
5. Test + monitor, then shrink DR back to standby size
```

> **Interview line:** "Failover moves traffic to the DR region during a disaster; failback moves it back to the primary after it's fixed and the data is synced. Failback is planned as carefully as failover."

---

## 6. What AWS docs add (official tips)

| Tip | Why |
|---|---|
| Deploy with **IaC** (Terraform / CloudFormation) | Rebuild in the DR region fast and without mistakes |
| Replication is **not** a backup | If data is deleted/corrupted, the deletion is copied too → also keep point-in-time backups |
| Use **AWS Backup** cross-region / cross-account copies | Protects even if the account is hacked |
| **Manual trigger, automated steps** | Auto failover on a false alarm also loses data; make the manual failover "one button" |
| Check **service quotas** in the DR region | You can't scale up if limits are low |
| **Test DR regularly** | An untested DR plan is just a guess |

**AWS services to remember:** AWS Backup · RDS read replicas · Aurora Global Database · DynamoDB Global Tables · S3 Cross-Region Replication · Route 53 health checks · AWS Elastic Disaster Recovery (DRS).

---

## 7. Interview Questions

### ⭐ Very Important (asked in class)

**Q1. Explain the 4 DR strategies.**
Backup & Restore (keep backups, rebuild on disaster: slow, low cost) → Pilot Light (critical components ready: small infra + DB replica: medium) → Warm Standby (smaller working copy, scale up and promote DB: fast) → Active-Active (both regions serve traffic: very fast, very high cost). Faster recovery costs more.

**Q2. How do you choose a DR strategy?**
Start from the business's RTO/RPO, then the budget. Choose the cheapest strategy that meets the target. Don't choose one just because it is technically impressive.

### Other Questions

**Q1. RPO vs RTO?** RPO = max data loss (time since last copy). RTO = max downtime.

**Q2. Pilot Light vs Warm Standby?** Pilot light: only critical components ready, deploy/scale the rest. Warm standby: small working copy already runs, only scale up.

**Q3. HA vs DR?** HA = one server/AZ fails, handled inside the region. DR = whole region lost, move to another region.

**Q4. Is replication enough for DR?** No. A deletion or corruption is replicated too, so you also need point-in-time backups.

**Q5. Failover vs failback?** Failover = move to DR. Failback = return to primary after it is fixed.

---

## Detailed notes (optional, read only if needed)

- [RTO and RPO Explained (detailed)](./rto-rpo-explained/README.md)
- [Migration Strategies (6 R's / AWS 7 Rs)](../day-20-migration-strategies/README.md)

**Images:** architecture diagrams © Amazon Web Services, shown from the official whitepaper.

**Source:** [AWS whitepaper: Disaster Recovery of Workloads on AWS](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
