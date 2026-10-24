# Disaster Recovery (DR): Short and Simple

> **In short:** DR = how you bring the app and its data back when a whole region or site is lost.
> The strategy you pick depends on **what is already running in the DR region**.

![DR in one picture](./images/dr-simple.png)

---

## 1. Key words

| Word | Simple definition |
|---|---|
| **Disaster** | A big failure: a whole region down, data deleted, ransomware |
| **DR (Disaster Recovery)** | The plan and setup to bring the app and data back after a disaster |
| **Primary region** | Where the app normally runs (e.g. Mumbai `ap-south-1`) |
| **DR region** | The backup location (e.g. Singapore `ap-southeast-1`) |
| **RPO** (Recovery Point Objective) | Max **data** you can lose, in time. *"How old can my last copy be?"* |
| **RTO** (Recovery Time Objective) | Max **downtime**. *"How fast must the app be back?"* |
| **Failover** | Switching users from the primary to the DR region |
| **Failback** | Moving back to the primary after it is fixed |
| **HA vs DR** | HA = survive a small failure (1 server / 1 AZ) automatically. DR = survive losing a whole region |

### RPO vs RTO in one example

```
10:00 last backup ─────── 11:30 💥 disaster ─────── 13:00 app back
      └── RPO: 1h30m of DATA lost ──┘└── RTO: 1h30m of DOWNTIME ──┘
```

- **RPO → data loss** (orders placed 10:00–11:30 are gone)
- **RTO → business loss** (no one can order 11:30–13:00)
- The **business** sets the targets; **DevOps** builds to meet them and tests them.

---

## 2. The 4 DR Strategies

### 1️⃣ Backup & Restore

**Definition:** Keep backups in another region. When disaster hits, rebuild everything from them.

```
PRIMARY                       DR REGION
App + DB  ── backups ──▶  snapshots, AMIs, S3 copies   (nothing running)
```

- **On disaster:** `terraform apply` → restore DB from snapshot → deploy app → switch DNS
- **RPO / RTO:** hours · **Cost:** 💲 lowest
- **Back up more than the DB:** AMIs, config and IaC code too (AWS says use IaC, or rebuild is slow)
- **Use for:** internal tools, dev/test, reports

> **Interview line:** "Backup and restore keeps backups in another region and rebuilds the infra and app from them during a disaster."

### 2️⃣ Pilot Light

**Definition:** Only the core (the database) is live in the DR region. The app is **off**.

```
PRIMARY                       DR REGION
EKS / EC2 + DB ─ replication ─▶ DB replica (read-only, LIVE)
                                 App servers OFF (0 instances)
```

- **On disaster:** promote replica → writer, turn app on, switch DNS
- **RPO / RTO:** 10s of minutes · **Cost:** 💲💲
- **Name meaning:** like a gas stove pilot flame: small flame always on, turn up when needed

> **Interview line:** "Pilot light keeps the critical parts (data) ready in the DR region so the full environment can be switched on quickly."

### 3️⃣ Warm Standby

**Definition:** A **small but working** copy of production always runs in the DR region.

```
PRIMARY                       DR REGION
10 nodes + DB ─ replication ─▶ 3 nodes + DB replica (read-only)
                               already RUNNING
```

- **On disaster:** promote DB → scale 3 nodes to 10 → switch DNS
- **RPO / RTO:** minutes · **Cost:** 💲💲💲
- **DB is still read-only** until promoted, so before failover it serves only reads / test traffic

> **Interview line:** "Warm standby runs a scaled-down but working copy of production that we scale up during failover."

#### Pilot Light vs Warm Standby (most confused)

| | Pilot Light | Warm Standby |
|---|---|---|
| App in DR | **Off** | **Running (small)** |
| Can take traffic right now? | ❌ No, must switch on first | ✅ Yes, at low capacity |
| On disaster | Turn on + scale up | Only scale up |

*(AWS whitepaper: "pilot light cannot process requests without additional action, warm standby can handle traffic at reduced capacity immediately.")*

### 4️⃣ Active/Active (Multi-site)

**Definition:** **Both regions run full size and serve users at the same time.**

```
              Global DNS (Route 53)
               ┌──────┴──────┐
           REGION A       REGION B
             EKS            EKS
           Database ◀─────▶ Database
```

- **On disaster:** DNS just stops sending users to the failed region (no real "failover")
- **RPO / RTO:** near zero · **Cost:** 💲💲💲💲 highest, most complex
- **DB must accept writes in both regions:** DynamoDB Global Tables (Aurora Global = one writer + fast promote)
- **Use for:** payments, banking, big e-commerce

> **Interview line:** "Active-active runs the workload in multiple regions at once, so if one fails, traffic continues through the other."

---

## 3. Comparison Table

| Strategy | What runs in DR | RPO / RTO (AWS) | Cost | Complexity |
|---|---|---|---|---|
| Backup & Restore | Only backups | Hours | Low | Low |
| Pilot Light | DB replica (app off) | 10s of minutes | Medium | Medium |
| Warm Standby | Small full stack | Minutes | High | High |
| Active/Active | Full stack, serving users | Near zero | Very high | Very high |

> These are rough ranges. Real numbers depend on the app and how well it is automated.

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

## 5. Failover steps (pilot / warm)

```
1. Health check fails (Route 53 / alarm)
2. Promote DB replica → writer
3. Scale app up (ASG / EKS nodes / terraform apply)
4. Switch DNS to DR region (Route 53 failover)
5. Test + monitor
```

![Failover](./images/failover.png)

**Failback:** later, copy data back DR → primary and switch DNS back in a planned window.

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
Backup & Restore (only backups, rebuild on disaster, hours) → Pilot Light (live DB replica, app off, 10s of minutes) → Warm Standby (small working copy, scale up, minutes) → Active/Active (both regions serve users, near zero). More running in DR = faster recovery = more cost.

**Q2. How do you choose a DR strategy?**
Start from the business's RTO/RPO, then the budget. Choose the cheapest strategy that meets the target.

### Other Questions

**Q1. RPO vs RTO?** RPO = max data loss (time since last copy). RTO = max downtime.

**Q2. Pilot Light vs Warm Standby?** Pilot light: app is off, must be switched on. Warm standby: app already runs small, only scale up.

**Q3. HA vs DR?** HA = one server/AZ fails, handled inside the region. DR = whole region lost, move to another region.

**Q4. Is replication enough for DR?** No. A deletion or corruption is replicated too, so you also need point-in-time backups.

**Q5. Failover vs failback?** Failover = move to DR. Failback = return to primary after it is fixed.

---

## Detailed notes (optional, read only if needed)

- [RTO and RPO Explained (detailed)](./rto-rpo-explained/README.md)
- [Migration Strategies (6 R's / AWS 7 Rs)](../migration-strategies/README.md)

**Source:** [AWS whitepaper: Disaster Recovery of Workloads on AWS](https://docs.aws.amazon.com/whitepapers/latest/disaster-recovery-workloads-on-aws/disaster-recovery-options-in-the-cloud.html)
