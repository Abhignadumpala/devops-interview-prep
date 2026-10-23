# Day 1 - Interview Questions (Disaster Recovery Strategies)

[← Back to Day 1 notes](../README.md)

**1. What is Disaster Recovery?**

The plan, tools and steps to restore infrastructure, applications and data after a major failure (region outage, data deletion, ransomware), within the agreed RTO and RPO. Backup is only one part of it.

**2. RPO vs RTO, with an example?**

RPO = maximum data loss in time; RTO = maximum downtime. Backups at 10:00, disaster at 11:30, service back at 13:00 → 1 h 30 m of data lost (RPO), 1 h 30 m down (RTO).

**3. Who decides RPO and RTO?**

The business, based on what downtime and data loss cost. DevOps designs a setup that meets the targets and proves it with DR tests.

**4. HA vs DR?**

HA handles small failures (an instance or an AZ) automatically inside one region: Multi-AZ, ALB, Auto Scaling. DR handles losing a whole region or site, using a second region and a failover process.

**5. We have RDS Multi-AZ. Do we have DR?**

No. Multi-AZ protects against an AZ failure in the same region. A region outage, an accidental delete or corruption still needs cross-region copies and backups.

**6. Why isn't replication enough? Why keep backups too?**

Replication copies every change, including a `DROP TABLE`, a bad deploy's wrong data or ransomware encryption, within seconds. Only point-in-time backups let you go back to before the problem.

**7. Explain Backup & Restore.**

Only backups (snapshots, AMIs, S3 copies) exist in the DR region. On disaster, create the infra with IaC and restore data. RPO and RTO are hours. Cheapest. Good for non-critical apps.

**8. Pilot Light vs Warm Standby?**

Pilot light: data replicates live but the app tier is off (ASG = 0), so it can't serve traffic until you start it. Warm standby: a smaller, fully working copy is already running and just needs scaling up. Warm standby has a lower RTO and costs more.

**9. When would you choose Multi-site Active/Active?**

When downtime costs are very high (payments, trading, large consumer apps) and the data layer supports multi-region writes (DynamoDB Global Tables, or Aurora Global Database with quick promotion). It's the most expensive and the most complex (conflicts, consistency).

**10. How does Route 53 failover routing work?**

Two records with the same name: PRIMARY (with a health check) and SECONDARY. Route 53 answers with the primary while its health check passes, and with the secondary when it fails. Keep a low TTL so clients switch quickly.

**11. Walk me through a failover for a pilot-light setup.**

Detect and declare the disaster → promote the DB read replica in the DR region → scale the ASG from 0 to production size (`terraform apply -var=dr_capacity=4`) → Route 53 switches to the DR ALB → smoke tests and monitoring → inform stakeholders.

**12. What is failback, and why is it risky?**

Moving back to the primary after it is fixed. New data was written in the DR region, so it must be replicated back and in sync before switching DNS again, in a planned window. If it's done in a hurry, you can lose the data written during the outage.

**13. How does Terraform help in DR?**

The same modules can create identical infra in the DR region using a provider alias and different variables. A pilot light scales up with one `apply`. The code also prevents drift between regions and documents what exists.

**14. Your Terraform state is in an S3 bucket in the region that just failed. What now?**

Prevent it ahead of time: enable versioning and replicate the state bucket to the DR region, or keep the DR stack's state in the DR region. Without that, Terraform can't plan or apply during the outage.

**15. What else must exist in the DR region besides infrastructure code?**

AMIs (copied), container images (ECR replication), data (replicas or backups), secrets (Secrets Manager replica secrets), DNS records, certificates (ACM is regional) and enough service quotas.

**16. Which AWS services help with DR?**

AWS Backup (cross-region and cross-account copies, Vault Lock), S3 CRR, RDS cross-region read replicas, Aurora Global Database, DynamoDB Global Tables, EBS snapshot copy, AWS Elastic Disaster Recovery, Route 53 health checks and failover, Global Accelerator, and Terraform for IaC.

**17. How do you protect backups from ransomware or a compromised admin?**

Copy backups to a separate account and region, and use AWS Backup Vault Lock (WORM: no one can delete them before retention ends). Use S3 Object Lock for S3 data. Use least-privilege IAM.

**18. How do you know your DR actually works?**

Test it: regular restore tests, tabletop runbook reviews and real DR drills (game days) that measure the actual RPO and RTO. Fix the gaps found. An untested backup or plan can't be trusted.

**19. How would you choose a DR strategy for a company with many apps?**

Tier the apps by business impact. Agree RPO/RTO per tier. Use active/active or warm standby only for critical apps, pilot light for important ones, and backup & restore for the rest. Compare the monthly DR cost with the cost of downtime.

**20. How do you do DR for Kubernetes / EKS?**

Recreate the cluster with Terraform in the DR region, redeploy apps with GitOps (Argo CD/Flux), restore cluster resources and volumes with Velero backups stored in replicated S3, and replicate container images with ECR replication.
