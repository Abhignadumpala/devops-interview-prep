# Day 44 - AWS WAF: Protect an ALB with IP, Geo and Rate-Limit Rules

> **In short:** **AWS WAF (Web Application Firewall)** checks every HTTP/HTTPS request **before it reaches your app** and decides to **allow**, **block**, **count** or **challenge** it based on rules you write. In this lab we launch **2 EC2 web servers**, put an **Application Load Balancer (ALB)** in front of them, and attach a **WAF web ACL** to the ALB. Then we block requests in three ways: **by IP address**, **by country (geo block)** and **by request rate (rate limit)**. Blocked users get `403 Forbidden` and never touch our servers.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | What WAF is, what it protects against, where it attaches, web ACL / rules / rule groups / IP sets, rule actions, evaluation order, managed rules, WCU and pricing, WAF vs SG vs NACL vs Shield | How WAF thinks about a request |
| **Part 2: Lab** | 2 EC2 + target group + ALB → web ACL on the ALB → IP block → geo block → rate limit → metrics → lock EC2 to ALB only → clean up | Securing a real app entry point |
| **Part 3: Extras** | WAF on EKS (Ingress annotation), WAF as Terraform code, production checklist | How WAF is used in real projects |

## Table of Contents

**Part 1: Concepts**
1. [What is AWS WAF?](#1-what-is-aws-waf)
2. [What WAF protects against](#2-what-waf-protects-against)
3. [Where WAF attaches (Regional vs CloudFront)](#3-where-waf-attaches-regional-vs-cloudfront)
4. [Main components](#4-main-components)
5. [Rule actions: Allow, Block, Count, CAPTCHA, Challenge](#5-rule-actions-allow-block-count-captcha-challenge)
6. [How WAF evaluates a request](#6-how-waf-evaluates-a-request)
7. [Rule types: IP, geo, rate-based and more](#7-rule-types-ip-geo-rate-based-and-more)
8. [AWS managed rule groups](#8-aws-managed-rule-groups)
9. [WCU and pricing](#9-wcu-and-pricing)
10. [WAF vs Security Group vs NACL vs Shield vs Network Firewall](#10-waf-vs-security-group-vs-nacl-vs-shield-vs-network-firewall)
11. [Production reference architecture](#11-production-reference-architecture)

**Part 2: Lab**

12. [Lab overview](#12-lab-overview)
13. [Step 1: Create the security groups](#13-step-1-create-the-security-groups)
14. [Step 2: Launch 2 EC2 web servers](#14-step-2-launch-2-ec2-web-servers)
15. [Step 3: Create the target group](#15-step-3-create-the-target-group)
16. [Step 4: Create the Application Load Balancer](#16-step-4-create-the-application-load-balancer)
17. [Step 5: Test the ALB (before WAF)](#17-step-5-test-the-alb-before-waf)
18. [Step 6: Create the web ACL and attach it to the ALB](#18-step-6-create-the-web-acl-and-attach-it-to-the-alb)
19. [Step 7: IP block rule](#19-step-7-ip-block-rule)
20. [Step 8: Geo block rule](#20-step-8-geo-block-rule)
21. [Step 9: Rate limit rule](#21-step-9-rate-limit-rule)
22. [Step 10: Watch metrics and sampled requests](#22-step-10-watch-metrics-and-sampled-requests)
23. [Step 11: Lock the EC2s so nobody can bypass WAF](#23-step-11-lock-the-ec2s-so-nobody-can-bypass-waf)
24. [Step 12: Clean up](#24-step-12-clean-up)
25. [Troubleshooting](#25-troubleshooting)

**Part 3: Extras**

26. [WAF on EKS: attach a web ACL from an Ingress](#26-waf-on-eks-attach-a-web-acl-from-an-ingress)
27. [WAF as code (Terraform)](#27-waf-as-code-terraform)
28. [Production checklist](#28-production-checklist)
29. [What I learned](#29-what-i-learned)
30. [Interview Questions](#30-interview-questions)

---

# Part 1: Concepts

## 1. What is AWS WAF?

**AWS WAF** is a managed **Layer 7 (HTTP/HTTPS) firewall**. It inspects each web request (IP, country, headers, URL, query string, body, request rate) and **allows, blocks, counts or challenges** it according to your rules, before the request reaches your application.

- **Looks inside the request:** a security group only sees IP + port. WAF sees *what* is being asked (`/login`, `?id=1 OR 1=1`, `User-Agent: bad-bot`).
- **Sits in front, not on the server:** you attach it to an ALB, API Gateway or CloudFront. Nothing to install on EC2.
- **Rules are reusable and managed:** write your own rules, or switch on AWS-maintained rule groups (SQL injection, bad IPs, bots) in one click.

**Analogy:** WAF is the **security guard at a shopping mall entrance**. The building's locked doors (security groups) only check *which door* you use. The guard checks *who you are and what you carry*: people on the banned list (IP block), people from a restricted area (geo block), someone running in and out 500 times a minute (rate limit), someone carrying a weapon (SQL injection).

```
Internet requests
  👤 Customer          ──┐
  💀 SQL injection     ──┤        ┌──────────────┐  ALLOWED  ┌───────────────┐
  🤖 Bot / scraper     ──┼──────► │   AWS WAF    │ ────────► │  ALB → EC2    │
  🔁 1000 logins/min   ──┘        │  (web ACL)   │           │  (your app)   │
                                  └──────┬───────┘           └───────────────┘
                                         │ BLOCKED
                                         ▼
                                  403 Forbidden (dropped at the edge,
                                  your servers never see it)
```

| | Lab | Production |
|---|---|---|
| Attached to | 1 ALB | CloudFront (global) + ALB / API Gateway (regional) |
| Rules | 3 custom rules (IP, geo, rate) | Managed rule groups + custom rules + bot control |
| New rules start in | Block (to see it work) | **Count** first, review logs, then Block |
| Logging | Sampled requests in console | Full logs to CloudWatch Logs / S3 / Firehose |

**One-liner:** *AWS WAF is a Layer 7 firewall that inspects HTTP requests and allows, blocks, counts or challenges them using rules, before they reach the app.*

---

## 2. What WAF protects against

| Threat | What it is | WAF feature that stops it |
|---|---|---|
| **SQL injection (SQLi)** | Malicious SQL in a form/URL to read or change the database | SQLi match statement, `AWSManagedRulesSQLiRuleSet` |
| **Cross-site scripting (XSS)** | Malicious `<script>` injected to steal user data | XSS match statement, Core rule set |
| **Malicious request patterns** | Weird encodings, oversized bodies, path traversal (`../../etc/passwd`) | Core rule set, Known bad inputs, size constraints |
| **Known bad IPs** | IPs AWS has seen attacking others | `AWSManagedRulesAmazonIpReputationList`, your own IP set |
| **Excessive request rates** | Floods, brute force logins, Layer 7 DDoS | Rate-based rules |
| **Bots and scraping** | Crawlers copying prices/content, fake signups | Bot Control, CAPTCHA, Challenge |
| **Common exploits** | Known CVE signatures (Log4j, PHP, WordPress) | Known bad inputs, PHP / WordPress rule sets |
| **Unexpected methods / headers / paths** | `TRACE`, `/admin` from the internet, missing `Host` header | Custom rules on method, header, URI path |

**One-liner:** *WAF stops application-layer attacks: SQLi, XSS, bad IPs, bots, floods and exploit patterns, things a security group can't see.*

---

## 3. Where WAF attaches (Regional vs CloudFront)

A web ACL has a **scope**, chosen at creation time and never changeable:

| Scope | Protects | Where you create it |
|---|---|---|
| **Regional** | Application Load Balancer, API Gateway (REST), AppSync GraphQL API, Cognito user pool, App Runner, Verified Access, Amplify | Same region as the resource |
| **CloudFront (global)** | CloudFront distributions | Always **us-east-1 (N. Virginia)** |

**Not supported:** Network Load Balancer, Gateway Load Balancer, Classic Load Balancer, EC2 directly. WAF needs to read HTTP, and an NLB works at Layer 4 (TCP/UDP).

```
            CloudFront scope (global, us-east-1)
            ┌────────────────────────────────┐
 Users ───► │ CloudFront + WAF (edge filter) │
            └───────────────┬────────────────┘
                            ▼
            Regional scope (e.g. us-east-1)
            ┌────────────────────────────────┐
            │  ALB + WAF   /  API GW + WAF   │
            └───────────────┬────────────────┘
                            ▼
                  EC2 / ECS / EKS / Lambda
```

**Rules of thumb:**
- One resource can have **only one** web ACL. One web ACL can protect **many** resources (same scope, same region).
- Blocking at **CloudFront** is cheaper and closer to the attacker (traffic is dropped at the edge location).

**One-liner:** *Regional web ACLs protect ALB, API Gateway, AppSync, Cognito, App Runner; CloudFront web ACLs are global and live in us-east-1. NLB is not supported because it's Layer 4.*

---

## 4. Main components

| # | Component | What it is | Example |
|---|---|---|---|
| 1 | **Web ACL** (console now calls it a **protection pack**) | The container: an ordered list of rules + a **default action** | `waf-day44` with default Allow |
| 2 | **Rule** | One condition + one action. *If request matches X → do Y* | If source IP in `blocked-ips` → Block |
| 3 | **Rule group** | Reusable bundle of rules you can add to many web ACLs | `company-baseline-rules` |
| 4 | **Managed rule group** | Rule group maintained by AWS or a Marketplace vendor, updated for new attacks | `AWSManagedRulesCommonRuleSet` |
| 5 | **IP set** | A list of IPv4 or IPv6 addresses/CIDRs, used by rules | `203.0.113.10/32`, `198.51.100.0/24` |
| 6 | **Regex pattern set** | A list of regex patterns, used by rules | `^/admin`, `(?i)curl` |
| 7 | **Logging** | Full record of each inspected request and which rule matched | CloudWatch Logs `aws-waf-logs-day44` |
| 8 | **Metrics** | CloudWatch counts per rule: allowed, blocked, counted | `BlockedRequests` for `ipblock` |
| 9 | **CAPTCHA / Challenge** | Adds friction to suspicious traffic instead of a hard block | Puzzle on `/login` |
| 10 | **Rate-based rule** | Counts requests per IP (or key) in a time window and acts over a limit | > 100 requests / 1 min → Block |

```
Web ACL: waf-day44   (default action: ALLOW)
├── priority 0  rule: ipblock      IP set "blocked-ips"     → BLOCK
├── priority 1  rule: geoblock     country in [XX]          → BLOCK
├── priority 2  rule: ratelimit    > 10 req / 60s per IP    → BLOCK
└── priority 3  managed group: AWSManagedRulesCommonRuleSet → (its own actions)
```

**Analogy:** web ACL = the guard's **rulebook**; each rule = one **page** in it; a rule group = a **chapter** you can copy into other rulebooks; managed rule groups = chapters **written and updated by AWS security experts**; IP set = the **banned list** pinned to the wall.

**One-liner:** *A web ACL is an ordered list of rules plus a default action; rules use IP sets, regex sets, rate limits and managed rule groups.*

---

## 5. Rule actions: Allow, Block, Count, CAPTCHA, Challenge

| Action | What happens | Stops evaluation? |
|---|---|---|
| **Allow** | Request goes to the app | ✅ Yes (terminating) |
| **Block** | Request rejected, client gets **403 Forbidden** (or a custom response) | ✅ Yes (terminating) |
| **Count** | Request is only counted/labelled, then the next rule is checked | ❌ No (non-terminating) |
| **CAPTCHA** | User must solve a puzzle; passes with a valid token | ✅ if no valid token |
| **Challenge** | Silent browser check (JavaScript), no puzzle; bots usually fail | ✅ if no valid token |

**Count is the safe test mode:** in production you add a new rule in **Count**, watch the metrics/logs for a few days to make sure real customers aren't matched (false positives), then switch it to **Block**. That's why the console shows many recommended rules with a **Count** badge.

**One-liner:** *Allow and Block stop evaluation; Count only records and moves on, so new rules are tested in Count before Block.*

---

## 6. How WAF evaluates a request

```
 1. Incoming HTTP/S request
            │
            ▼
 2. Rules checked in PRIORITY order (lowest number first)
    ┌────────┐   no   ┌────────┐   no   ┌────────┐   no
    │ Rule 0 │ ─────► │ Rule 1 │ ─────► │ Rule 2 │ ─────► ...
    └───┬────┘        └───┬────┘        └───┬────┘
        │ match           │ match           │ match
        ▼                 ▼                 ▼
 3. Rule action:  ALLOW → stop, forward to ALB → app
                  BLOCK → stop, return 403
                  COUNT → record it, continue to next rule
            │
            ▼ (no terminating rule matched)
 4. Web ACL DEFAULT ACTION  (Allow or Block)
```

- **Order matters.** Put cheap, high-confidence rules first (IP allowlist, IP blocklist), expensive ones (body inspection, bot control) later.
- **Default action Allow** = "blocklist model": allow everyone except what rules block. Most public apps.
- **Default action Block** = "allowlist model": block everyone except what rules allow. Internal/admin apps.

**One-liner:** *WAF checks rules from lowest priority number up; the first Allow or Block wins, and if nothing terminates, the web ACL's default action applies.*

---

## 7. Rule types: IP, geo, rate-based and more

### IP set rule (IP block / allow)

Match the request's source IP against an **IP set** (CIDR list). A single IP is written as `/32`.

```
Request from 203.0.113.10 ──► in IP set "blocked-ips"? ── yes ──► BLOCK (403)
```

Use: ban an attacker's IP, allow only office IPs on `/admin`.

### Geo match rule (geo block)

Match the request's **country** (ISO 2-letter code: `IN`, `US`, `CN`, `RU`...). AWS maps the IP to a country.

```
Request from an IP in country XX ──► country in [XX]? ── yes ──► BLOCK (403)
```

Use: business only serves some countries, or legal/compliance restrictions. Weakness: VPNs and proxies hide the real country, so combine with `AWSManagedRulesAnonymousIpList`.

### Rate-based rule (rate limit)

WAF **counts requests per IP** (or per header, cookie, query arg, URI... "custom keys") in a sliding **evaluation window** (60, 120, 300 or 600 seconds). When an IP goes over the **limit** (minimum 10), WAF applies the action to that IP until its rate drops back below the limit.

```
IP 198.51.100.7:  ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮  (16 requests in 60s, limit 10)
                             ▲
                       over the limit → BLOCK until the rate drops
```

Use: stop brute force on `/login`, Layer 7 floods, aggressive scrapers. A **scope-down statement** limits it to part of the traffic, e.g. only `POST /login`.

### Other match statements

| Statement | Checks | Example |
|---|---|---|
| String match | Header / URI / query / body contains text | `User-Agent` contains `sqlmap` |
| Regex match | Field matches a regex pattern set | URI matches `^/wp-admin` |
| SQLi match | SQL injection in a field | Query string `id=1 OR 1=1` |
| XSS match | Script injection in a field | Body contains `<script>` |
| Size constraint | Field size > N bytes | Body > 8 KB |
| Label match | A label added by an earlier rule | `awswaf:managed:aws:bot-control:bot:verified` |
| AND / OR / NOT | Combine statements | Geo = IN **AND** URI starts with `/admin` |

**One-liner:** *IP rules match source IP against an IP set, geo rules match the country, and rate-based rules block an IP that sends more than N requests in a time window.*

---

## 8. AWS managed rule groups

Ready-made rules from AWS, updated automatically when new attacks appear. You just add them to the web ACL.

| # | Managed rule group | Protects against |
|---|---|---|
| 1 | `AWSManagedRulesCommonRuleSet` (Core rule set, CRS) | Common web exploits, OWASP Top 10 style patterns |
| 2 | `AWSManagedRulesKnownBadInputsRuleSet` | Known malicious inputs (e.g. Log4j `${jndi:...}`) |
| 3 | `AWSManagedRulesSQLiRuleSet` | SQL injection |
| 4 | `AWSManagedRulesAmazonIpReputationList` | IPs Amazon threat intelligence flags as malicious |
| 5 | `AWSManagedRulesAnonymousIpList` | VPNs, proxies, Tor, hosting providers hiding the real user |
| 6 | `AWSManagedRulesLinuxRuleSet` | Linux-specific attacks (LFI, `/etc/passwd`) |
| 7 | `AWSManagedRulesUnixRuleSet` | Unix/POSIX-specific attacks |
| 8 | `AWSManagedRulesAdminProtectionRuleSet` | Access to admin pages from outside |
| 9 | `AWSManagedRulesBotControlRuleSet` | Bot detection and mitigation (extra cost) |

Others: `PHPRuleSet`, `WordPressRuleSet`, `WindowsRuleSet`, Account Takeover Prevention (ATP), Account Creation Fraud Prevention (ACFP), Anti-DDoS.

**Tip:** you can override a single rule inside a managed group to **Count** if it blocks a real customer request (false positive), without turning off the whole group.

**One-liner:** *Managed rule groups are AWS-maintained rule bundles (core rule set, SQLi, IP reputation, bots) you turn on instead of writing every rule yourself.*

---

## 9. WCU and pricing

### WCU (Web ACL Capacity Units)

Every rule costs **WCUs** based on how much work it is to check. Simple IP match ≈ 1 WCU, regex or body inspection costs more, the Core rule set = 700 WCU.

- A web ACL includes **1,500 WCU** in the base price. You can go up to 5,000 WCU for an extra fee.
- If you add too many rules, the console says *"capacity exceeded"*.

### Pricing (current standard model, check the AWS pricing page)

| Item | Price |
|---|---|
| Web ACL | $5.00 per month (prorated hourly) |
| Each rule or rule group in it | $1.00 per month |
| Requests | $0.60 per 1 million requests |
| Bot Control, ATP, ACFP, CAPTCHA | Extra per request / subscription |

**Lab cost:** web ACL + 3 rules for ~2 hours ≈ a few cents. The ALB (~$0.0225/hour + LCU) and 2 × t3.micro are the bigger part. Total for a 2-hour lab is well under $1 if you clean up.

> The console shows a notice that AWS WAF moves to a simpler per-resource + request-fee pricing model from **February 1, 2027**, with a flat-rate option for CloudFront. Check the pricing page when you run the lab.

**One-liner:** *Each rule uses WCUs (1,500 included per web ACL); you pay per web ACL, per rule and per million requests.*

---

## 10. WAF vs Security Group vs NACL vs Shield vs Network Firewall

| Service | Layer | Attached to | Checks | Example |
|---|---|---|---|---|
| **Security Group** | L3/L4 | ENI (EC2, ALB, RDS) | IP, port, protocol. Stateful, allow rules only | Allow 80 from ALB SG |
| **NACL** | L3/L4 | Subnet | IP, port. Stateless, allow + deny | Deny 203.0.113.0/24 on the subnet |
| **AWS WAF** | **L7** | ALB, API GW, CloudFront, AppSync, Cognito | HTTP content: URL, headers, body, country, rate | Block `?id=1 OR 1=1`, block country, rate limit |
| **AWS Shield Standard** | L3/L4 | Automatic on all AWS | Network DDoS (SYN flood, UDP reflection) | Free, always on |
| **AWS Shield Advanced** | L3/L4/L7 | CloudFront, ALB, NLB, EIP, Route 53 | DDoS + 24/7 response team + cost protection | $3,000/month, includes WAF at no extra charge for protected resources |
| **AWS Network Firewall** | L3–L7 | VPC (firewall subnets) | Stateful inspection, domain filtering, IDS/IPS (Suricata rules) | Allow outbound only to `*.github.com` |
| **AWS Firewall Manager** | Central | AWS Organization | Pushes WAF / SG / Shield / Network Firewall policies to all accounts | Same WAF baseline on 50 accounts |

```
Internet ──► Shield (DDoS, L3/L4) ──► CloudFront + WAF (L7) ──► ALB + WAF (L7)
         ──► NACL (subnet) ──► Security Group (instance) ──► App
```

**One-liner:** *Security groups and NACLs filter by IP and port; WAF filters by HTTP content; Shield handles DDoS; Firewall Manager applies them all across accounts.*

---

## 11. Production reference architecture

```
 Users (Internet)
      │
      ▼
 ① Route 53 ─────────── DNS: shop.example.com → CloudFront
      │
      ▼
 ② CloudFront + AWS WAF (global scope)
      │   edge filtering, TLS, caching, bot control, geo block
      ▼
 ③ Application Load Balancer (+ regional WAF where needed)
      │   public subnets, only accepts traffic from CloudFront
      ▼
 ④ Private app subnets (2+ AZs)
      │   EC2 / ECS / EKS, SG allows only the ALB SG
      ▼
 ⑤ Data layer: RDS · DynamoDB · S3
```

- **Block as early as possible:** WAF on CloudFront drops bad traffic at the edge, so it never costs you ALB, compute or data transfer.
- **No bypass:** the ALB only accepts CloudFront (managed prefix list `com.amazonaws.global.cloudfront.origin-facing` + a secret header), and app servers only accept the ALB SG. Otherwise attackers skip WAF by hitting the origin directly.
- **Secure, scalable, highly available:** multi-AZ at every layer.

**One-liner:** *Production: Route 53 → CloudFront + WAF → ALB → private EC2/ECS/EKS → RDS/DynamoDB/S3, with each layer only accepting traffic from the one in front.*

---

# Part 2: Lab

## 12. Lab overview

```
                       ┌───────────────── VPC (default) ─────────────────┐
 You (laptop)          │                                                  │
 curl / browser        │   ┌──────────── alb-sg: 80 from 0.0.0.0/0 ──┐    │
     │                 │   │                                          │    │
     ▼                 │   │  ALB: alb-day44  (us-east-1a + 1b)       │    │
 ┌─────────┐  allowed  │   │  listener HTTP:80 → tg-day44             │    │
 │ WAF     │ ────────► │   └───────────┬──────────────┬───────────────┘    │
 │ web ACL │           │               ▼              ▼                    │
 │waf-day44│           │   ┌─ web-sg ─────────┐ ┌─ web-sg ─────────┐      │
 └────┬────┘           │   │ web-server-1     │ │ web-server-2     │      │
      │ blocked        │   │ us-east-1a nginx │ │ us-east-1b nginx │      │
      ▼                │   └──────────────────┘ └──────────────────┘      │
   403 Forbidden       └──────────────────────────────────────────────────┘
```

| Item | Value |
|---|---|
| Region | `us-east-1` (any region works; the web ACL must be in the same region as the ALB) |
| VPC | Default VPC (public subnets with internet gateway route) |
| EC2 | `web-server-1` (us-east-1a), `web-server-2` (us-east-1b), t3.micro, Amazon Linux 2023, nginx |
| Security groups | `alb-sg` (80 from anywhere), `web-sg` (80 from anywhere first, later only from `alb-sg`) |
| Target group | `tg-day44`, instances, HTTP:80, health check `/` |
| ALB | `alb-day44`, internet-facing, 2 AZs |
| Web ACL | `waf-day44`, Regional, default action Allow |
| Rules | `ipblock` (IP set), `geoblock` (country), `ratelimit` (10 requests / 60 s) |

---

## 13. Step 1: Create the security groups

**EC2 → Security Groups → Create security group**

| Name | Inbound rule | Why |
|---|---|---|
| `alb-sg` | HTTP 80 from `0.0.0.0/0` | Public users reach the ALB |
| `web-sg` | HTTP 80 from `0.0.0.0/0` (temporary), SSH 22 from My IP (optional) | We test servers directly first; Step 11 locks it to `alb-sg` |

Outbound: leave the default (all traffic).

---

## 14. Step 2: Launch 2 EC2 web servers

**EC2 → Launch instances**

| Setting | Value |
|---|---|
| Name | `web-server-1` |
| AMI | Amazon Linux 2023 |
| Type | t3.micro |
| Key pair | your key pair (optional, only for SSH) |
| Network | default VPC, subnet in **us-east-1a**, auto-assign public IP **Enable** |
| Security group | `web-sg` |
| Advanced → User data | script below |

User data for `web-server-1` (installs nginx and writes a page that shows the server name):

```bash
#!/bin/bash
dnf install -y nginx
echo "<h1>Hello from web-server-1 ($(hostname -f))</h1>" > /usr/share/nginx/html/index.html
systemctl enable --now nginx
```

Launch a second instance the same way with:
- Name `web-server-2`, subnet in **us-east-1b**
- Same user data, but change the text to `web-server-2`

Wait for **Status check: 2/2 passed**, then open each public IP in the browser:

```bash
curl http://<web-server-1-public-ip>
```

```bash
curl http://<web-server-2-public-ip>
```

You should see `Hello from web-server-1` and `Hello from web-server-2`.

---

## 15. Step 3: Create the target group

**EC2 → Target groups → Create target group**

| Setting | Value |
|---|---|
| Target type | Instances |
| Name | `tg-day44` |
| Protocol : Port | HTTP : 80 |
| VPC | default VPC |
| Health check | HTTP, path `/` |

Default health check settings (good to know for interviews):

| Setting | Default |
|---|---|
| Interval | 30 seconds |
| Timeout | 5 seconds |
| Healthy threshold | 5 checks in a row |
| Unhealthy threshold | 2 checks in a row |
| Success codes | 200 |

**Register targets:** tick `web-server-1` and `web-server-2` → port `80` → **Include as pending below** → **Create target group**.

---

## 16. Step 4: Create the Application Load Balancer

**EC2 → Load balancers → Create load balancer → Application Load Balancer**

The console offers 4 types:

| Type | Layer | Use when |
|---|---|---|
| **Application Load Balancer** | L7 (HTTP/HTTPS) | Web apps, path/host routing. **WAF works here** ✅ |
| Network Load Balancer | L4 (TCP/UDP/TLS) | Ultra-high performance, static IPs. No WAF ❌ |
| Gateway Load Balancer | L3 (GENEVE) | Route traffic through third-party firewall appliances |
| ELB for Envoy (proxy) | L7 | You already run Envoy and need Wasm/Lua/ext filters |

| Setting | Value |
|---|---|
| Name | `alb-day44` |
| Scheme | Internet-facing |
| IP address type | IPv4 |
| VPC | default VPC |
| Availability Zones | tick **us-east-1a** and **us-east-1b** (minimum 2 AZs), one public subnet each |
| Security group | `alb-sg` (remove `default`) |
| Listener | HTTP : 80 → forward to `tg-day44` |

**Create load balancer** and wait until **State: Active** (2–3 minutes). Copy the **DNS name**, e.g. `alb-day44-1234567890.us-east-1.elb.amazonaws.com`.

> The subnet picker shows "Network ACL ALLOW rules" and "Route table: IGW (✓)". An internet-facing ALB needs public subnets (route to an internet gateway), and each subnet needs at least 8 free IPs.

---

## 17. Step 5: Test the ALB (before WAF)

Check the targets are healthy:

**EC2 → Target groups → tg-day44 → Targets** → both `healthy`.

Or with the CLI:

```bash
aws elbv2 describe-target-health --target-group-arn <tg-day44-arn> --query 'TargetHealthDescriptions[].TargetHealth.State'
```

Hit the ALB a few times and watch it alternate between the two servers (round robin):

```bash
for i in 1 2 3 4 5 6; do curl -s http://<alb-dns-name>; echo; done
```

```
<h1>Hello from web-server-1 (...)</h1>
<h1>Hello from web-server-2 (...)</h1>
<h1>Hello from web-server-1 (...)</h1>
...
```

Right now **anyone** can reach the app, and nothing filters bad requests. Time for WAF.

---

## 18. Step 6: Create the web ACL and attach it to the ALB

Search **WAF & Shield** in the console → **Protection packs (web ACLs)** → **Create protection pack (web ACL)**.

### 6a. Tell us about your app

| Setting | Value |
|---|---|
| App category | e.g. **E-commerce & transaction platforms** (AWS uses this to recommend rules) |
| App focus | **Both API and web** / API / Web |

### 6b. Select resources to protect

**Add resources → Add regional resources** → tick `alb-day44` (type Application Load Balancer) → **Add**.

> Make sure the console region is the ALB's region (us-east-1). A Regional web ACL only sees resources in its own region.

### 6c. Choose initial protections

| Option | What you get |
|---|---|
| **Recommended rules for you** | Everything in Essentials + rate limits for GET and POST/PUT/DELETE, Amazon IP reputation, anonymous IP, managed IP DDoS, common bot control (many start in **Count**) |
| **Essential rules** | Layer 7 anti-DDoS, IP allowlist/blocklist, geographic restriction, global rate limit, body size restriction, AWS core rule set, known bad inputs, PHP protection... |
| **Build your own pack** ✅ (lab) | Start empty and add only the rules you choose |

For the lab pick **Build your own pack from all of the protections AWS WAF offers**, so we see exactly what each rule does. We add the rules in Steps 7–9.

### 6d. Name, default action, metrics

| Setting | Value |
|---|---|
| Name | `waf-day44` |
| Default action | **Allow** (blocklist model) |
| CloudWatch metrics | Enabled |
| Sampled requests | Enabled |

Create it, then confirm with the CLI that the ALB is protected:

```bash
aws wafv2 list-web-acls --scope REGIONAL --region us-east-1
```

```bash
aws wafv2 get-web-acl-for-resource --resource-arn <alb-day44-arn> --region us-east-1
```

> You can add rules during creation (Step 6c → "Add rule") or afterwards from **waf-day44 → Rules → Add rule**. Both open the same rule panel on the right.

---

## 19. Step 7: IP block rule

**Goal:** block your own laptop's IP and see a 403.

### 7a. Find your public IP

```bash
curl -s https://checkip.amazonaws.com
```

### 7b. Add the rule

**Add rule → Custom rule → IP-based rule**

| Setting | Value |
|---|---|
| Action | **Block** |
| Rule name | `ipblock` |
| Statement | Use existing IP set **off** (or create IP set `blocked-ips` first and switch it on) |
| IP address version | IPv4 |
| IP addresses (CIDR) | `<your-ip>/32` |

**Add rule** → **Save**.

### 7c. Test

Wait about a minute, then:

```bash
curl -i http://<alb-dns-name>
```

```
HTTP/1.1 403 Forbidden
Server: awselb/2.0
...
<html><head><title>403 Forbidden</title></head>...
```

- The `403` comes from the **ALB/WAF**, not nginx. The EC2s never received the request.
- Open the ALB URL on your **phone using mobile data** (a different IP): it still works. Only your IP is blocked.

### 7d. Undo

Remove your IP from the rule (or set the rule action to **Count**) so you can test the next rules. Check you get `200` again.

**Real use:** add an attacker's IP from the logs to the IP set. With an IP set, many rules (and web ACLs) share one list, and you update the list without editing rules.

---

## 20. Step 8: Geo block rule

**Goal:** block requests from a country, and test it by blocking **your own country**.

### 8a. Add the rule

**Add rule → Custom rule → Geo-based rule (country)**

| Setting | Value |
|---|---|
| Action | **Block** |
| Rule name | `geoblock` |
| Country codes | your country, e.g. `India (IN)` |
| IP address to use | Source IP address |

**Add rule** → **Save**.

### 8b. Test

```bash
curl -i http://<alb-dns-name>
```

→ `403 Forbidden`, because your IP is in the blocked country.

A VPN in another country gets through (shows why geo block alone isn't enough; add `AWSManagedRulesAnonymousIpList` in production).

### 8c. Undo

Remove your country (or switch the rule to **Count**), check you get `200` again.

**Real use:** an Indian-only food delivery app blocks all countries except `IN` with **NOT (country = IN) → Block**, or a company blocks countries where it gets only attack traffic.

---

## 21. Step 9: Rate limit rule

**Goal:** block any single IP that sends more than 10 requests in 1 minute.

### 9a. Add the rule

**Add rule → Custom rule → Rate-based rule**

| Setting | Value |
|---|---|
| Action | **Block** |
| Rule name | `ratelimit` |
| Rate limit | `10` (the minimum) |
| Evaluation window | 1 minute (60 seconds) |
| Request aggregation | Source IP address |
| Scope of inspection | All requests (production: scope down to e.g. `/login`) |

**Add rule** → **Save**.

### 9b. Test

Send 60 requests and print only the status codes:

```bash
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}\n" http://<alb-dns-name>; sleep 0.5; done
```

```
200
200
...
200
403
403
403
```

- The first requests pass (`200`). After WAF notices your IP is over the limit, it switches to `403`.
- WAF checks rates every few seconds, so a few extra requests over 10 may get through before blocking starts. That's normal.
- Stop sending, wait 1–2 minutes, and your IP is allowed again automatically.

### 9c. See who is being rate-limited

```bash
aws wafv2 get-rate-based-statement-managed-keys --scope REGIONAL --region us-east-1 --web-acl-name waf-day44 --web-acl-id <web-acl-id> --rule-name ratelimit
```

→ lists the IPs currently blocked by the rule (your IP while the loop runs).

**Real use:** 100 requests / 5 min on `POST /login` stops password brute force; 2,000 / 5 min site-wide stops scrapers and Layer 7 floods.

---

## 22. Step 10: Watch metrics and sampled requests

**WAF & Shield → waf-day44**

| Tab | What you see |
|---|---|
| **Overview / Traffic** | Allowed vs blocked requests over time, per rule |
| **Sampled requests** | Up to the last 3 hours of sample requests: source IP, country, URI, which rule matched, action |
| **CloudWatch metrics** | `AllowedRequests`, `BlockedRequests`, `CountedRequests` per rule (namespace `AWS/WAFV2`) |

### (Optional) Full logging

**waf-day44 → Logging and metrics → Enable logging** → CloudWatch Logs log group.

- The log group name **must start with `aws-waf-logs-`**, e.g. `aws-waf-logs-day44`.
- Each log line shows the full request (headers, URI, country) and `terminatingRuleId`, so you can see exactly **why** a request was blocked.
- Delete the log group in cleanup.

---

## 23. Step 11: Lock the EC2s so nobody can bypass WAF

**Problem:** the EC2s still have public IPs and `web-sg` allows port 80 from anywhere. An attacker can skip the ALB and WAF and hit `http://<web-server-1-public-ip>` directly.

```
 Attacker ──► ALB + WAF ──► EC2      ✅ filtered
 Attacker ─────────────────► EC2     ❌ bypasses WAF!
```

**Fix:** **EC2 → Security Groups → web-sg → Edit inbound rules**:
- Delete `HTTP 80 from 0.0.0.0/0`
- Add `HTTP 80` with source = **`alb-sg`** (the security group, not an IP)

Test:

```bash
curl -m 5 http://<web-server-1-public-ip>
```

→ times out (blocked by the security group).

```bash
curl http://<alb-dns-name>
```

→ still works, through WAF.

**Production:** the servers sit in **private subnets** with no public IP at all, and only accept the ALB SG.

---

## 24. Step 12: Clean up

Order matters: a web ACL can't be deleted while attached, and an IP set can't be deleted while a rule uses it.

| # | Delete | Where |
|---|---|---|
| 1 | Disassociate the ALB from the web ACL | waf-day44 → Associated AWS resources → Disassociate |
| 2 | Web ACL `waf-day44` | WAF & Shield → Protection packs → Delete |
| 3 | IP set `blocked-ips` (if you created one) | WAF & Shield → IP sets |
| 4 | Log group `aws-waf-logs-day44` (if enabled) | CloudWatch → Log groups |
| 5 | Load balancer `alb-day44` | EC2 → Load balancers |
| 6 | Target group `tg-day44` | EC2 → Target groups |
| 7 | Terminate `web-server-1` and `web-server-2` | EC2 → Instances |
| 8 | Security groups `web-sg`, then `alb-sg` | EC2 → Security groups (`web-sg` references `alb-sg`, so delete it first) |

Verify nothing is left:

```bash
aws wafv2 list-web-acls --scope REGIONAL --region us-east-1
```

```bash
aws elbv2 describe-load-balancers --region us-east-1 --query 'LoadBalancers[].LoadBalancerName'
```

```bash
aws ec2 describe-instances --region us-east-1 --filters Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId'
```

All three should return empty lists.

---

## 25. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| ALB not listed in "Add resources" | Console region ≠ ALB region, or you chose CloudFront scope | Switch the console to the ALB's region; use Regional resources |
| NLB not listed | WAF doesn't support NLB (Layer 4) | Use an ALB, or CloudFront in front |
| Targets `unhealthy` | nginx not running, or `web-sg` doesn't allow 80 from the ALB | `systemctl status nginx` on the EC2; allow 80 from `alb-sg` |
| ALB returns `502 Bad Gateway` | No healthy targets / app crashed | Fix target health first |
| ALB returns `503` | Target group has no registered targets | Register the instances |
| Rule added but no `403` | Change not saved, still propagating, or rule in **Count** | Click Save, wait ~1 minute, check the action is Block |
| IP block not working | Wrong IP (IPv6 used, or office NAT IP differs) | Use `checkip.amazonaws.com`; add the IPv6 CIDR or use `curl -4` |
| Rate limit never triggers | Requests too slow, or limit too high | Limit 10 / 60 s, send faster; wait 30–60 s for WAF to react |
| Real users getting `403` | False positive from a managed rule | Find the rule in sampled requests/logs, override that rule to **Count** |
| Can't delete web ACL | Still associated with the ALB | Disassociate first |
| Can't delete IP set | Still referenced by a rule | Delete the rule / web ACL first |
| Logging setup fails | Log group name doesn't start with `aws-waf-logs-` | Rename the log group |
| "WCU capacity exceeded" | Too many / too heavy rules | Remove rules or raise the web ACL capacity (extra cost above 1,500) |

---

# Part 3: Extras

## 26. WAF on EKS: attach a web ACL from an Ingress

On EKS, the **AWS Load Balancer Controller** creates the ALB from an Ingress. Attach the WAF web ACL with one annotation:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  annotations:
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/wafv2-acl-arn: arn:aws:wafv2:us-east-1:<account-id>:regional/webacl/waf-prod/<id>
spec:
  ingressClassName: alb
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

- The controller's IAM role needs `wafv2:AssociateWebACL`, `wafv2:DisassociateWebACL`, `wafv2:GetWebACL`, `wafv2:GetWebACLForResource`.
- Same idea as the lab: the web ACL protects the ALB, the pods sit behind it.

---

## 27. WAF as code (Terraform)

The same lab web ACL as Terraform: IP set + 3 rules + association to the ALB.

```hcl
resource "aws_wafv2_ip_set" "blocked" {
  name               = "blocked-ips"
  scope              = "REGIONAL"
  ip_address_version = "IPV4"
  addresses          = ["203.0.113.10/32"]
}

resource "aws_wafv2_web_acl" "main" {
  name  = "waf-day44"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "ipblock"
    priority = 0
    action {
      block {}
    }
    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.blocked.arn
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ipblock"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "geoblock"
    priority = 1
    action {
      block {}
    }
    statement {
      geo_match_statement {
        country_codes = ["XX"] # replace with real ISO codes
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "geoblock"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "ratelimit"
    priority = 2
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit                 = 100
        evaluation_window_sec = 300
        aggregate_key_type    = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "ratelimit"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "aws-common"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "waf-day44"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
```

- Custom rules use `action { }`; managed rule groups use `override_action { none {} }` (keep the group's own actions) or `override_action { count {} }` (test mode).
- For a CloudFront web ACL: `scope = "CLOUDFRONT"` with an `aws` provider in **us-east-1**, and attach it through `web_acl_id` on the `aws_cloudfront_distribution` (no association resource).

---

## 28. Production checklist

| ✅ | Item |
|---|---|
| ☐ | WAF on **CloudFront** for public sites (edge blocking), regional WAF on ALB / API Gateway where needed |
| ☐ | Baseline managed groups: Core rule set, Known bad inputs, Amazon IP reputation, SQLi (+ Linux/PHP/WordPress to match the stack) |
| ☐ | Rate-based rules: site-wide limit + tighter limit on `/login`, `/signup`, `/api/otp` |
| ☐ | Every new rule starts in **Count**, reviewed in logs, then switched to **Block** |
| ☐ | Full logging to CloudWatch Logs / S3 (`aws-waf-logs-*`), redact sensitive fields (Authorization, cookies) |
| ☐ | CloudWatch alarm on a spike in `BlockedRequests` |
| ☐ | **No bypass:** origin only accepts CloudFront/ALB; servers in private subnets; SG allows only the ALB SG |
| ☐ | WAF defined in **Terraform**, changes go through PR review |
| ☐ | Multi-account: **Firewall Manager** pushes the same baseline web ACL to every account |
| ☐ | Bot Control / CAPTCHA on high-value pages if scraping or fake signups are a problem |
| ☐ | Shield Advanced for business-critical apps (DDoS response team + cost protection) |

---

## 29. What I learned

- **WAF = Layer 7 firewall.** It reads the HTTP request (IP, country, URL, headers, body, rate); security groups and NACLs only see IP and port.
- **Web ACL → rules → actions.** Rules run in priority order; the first Allow/Block wins; otherwise the default action applies.
- **Attaches to ALB, API Gateway, CloudFront** (and AppSync, Cognito, App Runner), **not NLB or EC2**. CloudFront web ACLs live in us-east-1.
- **Built the lab:** 2 EC2 (nginx) behind an ALB across 2 AZs, then a WAF web ACL on the ALB with an **IP block**, a **geo block** and a **rate limit**. Blocked requests got `403 Forbidden` from the ALB and never reached the servers.
- **Count before Block** in production to avoid blocking real customers.
- **WAF is useless if it can be bypassed.** Lock the servers' security group to the ALB SG (or use private subnets).
- **Managed rule groups** give SQLi/XSS/bad-IP/bot protection without writing rules.

---

## 30. Interview Questions

### Other Questions

**Q1. What is AWS WAF?**
A managed Layer 7 web application firewall. It inspects HTTP/HTTPS requests to an ALB, API Gateway, CloudFront, AppSync, Cognito or App Runner and allows, blocks, counts or challenges them based on rules.

**Q2. What's the difference between WAF and a security group?**
A security group works at Layer 3/4: IP, port, protocol, allow rules only, attached to an ENI. WAF works at Layer 7: it reads URL, headers, body, country and request rate, and can block SQL injection or rate-limit an IP. You use both.

**Q3. What is a web ACL?**
The main WAF resource: an ordered list of rules plus a default action (Allow or Block). It's associated with one or more resources of the same scope and region.

**Q4. Which AWS resources can you attach WAF to? Can you attach it to an NLB?**
ALB, API Gateway REST API, AppSync, Cognito user pools, App Runner, Verified Access, Amplify (regional) and CloudFront (global). Not NLB, GWLB, Classic LB or EC2 directly: NLB is Layer 4 and WAF needs to read HTTP. For an NLB, put CloudFront in front or use Network Firewall.

**Q5. Regional vs CloudFront scope?**
Regional web ACLs protect resources in one region and are created in that region. CloudFront web ACLs are global and must be created in us-east-1. Scope can't be changed after creation.

**Q6. How does WAF evaluate rules?**
In priority order, lowest number first. The first rule that matches with a terminating action (Allow, Block, or CAPTCHA/Challenge without a valid token) ends evaluation. Count is non-terminating, so evaluation continues. If no terminating rule matches, the default action applies.

**Q7. What is the Count action used for?**
Testing. You deploy a new rule or managed group in Count, watch metrics and logs for false positives, then switch it to Block. Count is also used to add labels that later rules match on.

**Q8. What is a rate-based rule?**
A rule that counts requests per aggregation key (source IP by default, or forwarded IP, header, cookie, URI, custom keys) over an evaluation window of 1, 2, 5 or 10 minutes. When a key goes over the limit (minimum 10), the action applies to that key until its rate drops. Used against brute force, scraping and Layer 7 floods.

**Q9. How would you stop brute-force attacks on a login page?**
Rate-based rule with a scope-down statement on `URI = /login AND method = POST`, e.g. 100 requests per 5 minutes per IP → Block or CAPTCHA. Add the Account Takeover Prevention (ATP) managed group for credential-stuffing detection.

**Q10. How do you block a specific country? What's the weakness?**
A geo match rule with the country codes → Block (or NOT country in [allowed list] → Block). Weakness: VPNs and proxies hide the real location, so add the Anonymous IP list managed group.

**Q11. What are managed rule groups? Name a few.**
AWS- or Marketplace-maintained rule bundles that update automatically: Core rule set (CRS), Known bad inputs, SQLi, Amazon IP reputation list, Anonymous IP list, Linux/Unix/PHP/WordPress, Admin protection, Bot Control, ATP.

**Q12. A managed rule is blocking legitimate customers. What do you do?**
Find the rule in sampled requests or WAF logs (`terminatingRuleId`), override just that rule inside the group to Count (keep the rest blocking), and if needed add a scope-down statement or an earlier Allow rule for the trusted path or IP.

**Q13. What does a user see when WAF blocks them?**
HTTP `403 Forbidden` by default, returned by the ALB/CloudFront, so the backend never sees the request. You can configure a custom response code, headers and body.

**Q14. What are WCUs?**
Web ACL Capacity Units: each rule costs capacity based on complexity (IP match is cheap, regex and body inspection cost more, the Core rule set is 700). A web ACL includes 1,500 WCU; up to 5,000 for an extra fee.

**Q15. How do you log WAF traffic?**
Enable logging to CloudWatch Logs, S3 or Kinesis Data Firehose. The destination name must start with `aws-waf-logs-`. Logs show the full request and which rule matched. Use redacted fields for sensitive headers. Sampled requests in the console show only recent samples.

**Q16. WAF vs Shield?**
Shield protects against DDoS. Shield Standard is free and automatic for L3/L4 attacks. Shield Advanced adds L7 DDoS protection, the Shield Response Team, cost protection, and includes WAF for protected resources. WAF is the rule engine for L7 filtering; Shield Advanced uses WAF for L7 mitigation.

**Q17. What is AWS Firewall Manager?**
A central service for AWS Organizations that applies WAF web ACLs, Shield Advanced, security groups and Network Firewall policies across all accounts, and auto-protects new resources.

**Q18. You attached WAF to the ALB, but attackers still reach your app. Why?**
They're bypassing the ALB: hitting the EC2 public IPs directly, or hitting the ALB directly when WAF is only on CloudFront. Fix: servers in private subnets / SG only from the ALB SG, and the ALB only accepting CloudFront (origin-facing prefix list + secret custom header checked by an ALB listener rule or WAF rule).

**Q19. How do you attach WAF to an ALB created by Kubernetes?**
With the AWS Load Balancer Controller annotation `alb.ingress.kubernetes.io/wafv2-acl-arn: <web-acl-arn>` on the Ingress. The controller associates the web ACL with the ALB it creates.

**Q20. CAPTCHA vs Challenge?**
CAPTCHA shows the user a puzzle to solve. Challenge runs a silent JavaScript check in the browser with no user interaction. Both give a token valid for a set time, and both stop most simple bots. Challenge is better for user experience; CAPTCHA is stronger.
