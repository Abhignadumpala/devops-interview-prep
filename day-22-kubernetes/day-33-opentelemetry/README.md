# Day 33 - OpenTelemetry: Traces, Metrics and Logs the Standard Way

[← Kubernetes notes](../README.md)

> **In short:** **OpenTelemetry (OTel)** is a **standard, vendor-neutral way to collect, process and export telemetry** from applications: **traces** (the journey of a request), **metrics** (numbers over time) and **logs** (event details). You **instrument** the app once, send the data to the **OpenTelemetry Collector**, and the Collector exports it to any backend: Prometheus, Grafana, Jaeger, Tempo, Loki or a commercial platform. **Important:** OpenTelemetry is **not a monitoring dashboard**; it's the plumbing that gets the data to the tools that store, analyze, visualize and alert on it.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | Observability vs monitoring, the 3 signals, why OTel, Instrument → Collect → Process → Export, traces and spans, context propagation, the Collector (receivers / processors / exporters), agent vs gateway, auto-instrumentation on Kubernetes, backends, OTel vs Prometheus | What OpenTelemetry is, how data flows, and how it's used in real projects |
| **Part 2: Lab** | Jaeger as the trace backend, OTel Collector with Helm, send test traces, follow a request in the Jaeger UI | Run the full pipeline on EKS: app → Collector → Jaeger |

> **Before this:** [Day 27 - Monitoring with Prometheus and Grafana](../day-27-monitoring-prometheus-grafana/README.md) (metrics). OpenTelemetry adds **traces** and a single standard for all three signals.

## Table of Contents

**Part 1: Concepts**
1. [What is OpenTelemetry?](#1-what-is-opentelemetry)
2. [Monitoring vs observability](#2-monitoring-vs-observability)
3. [The 3 signals: traces, metrics, logs](#3-the-3-signals-traces-metrics-logs)
4. [Traces and spans in detail](#4-traces-and-spans-in-detail)
5. [Why OpenTelemetry? (the problem it solves)](#5-why-opentelemetry-the-problem-it-solves)
6. [The flow: Instrument → Collect → Process → Export](#6-the-flow-instrument--collect--process--export)
7. [Instrumentation: manual vs automatic](#7-instrumentation-manual-vs-automatic)
8. [The OpenTelemetry Collector](#8-the-opentelemetry-collector)
9. [Agent vs gateway on Kubernetes](#9-agent-vs-gateway-on-kubernetes)
10. [Auto-instrumentation with the OpenTelemetry Operator](#10-auto-instrumentation-with-the-opentelemetry-operator)
11. [Observability backends](#11-observability-backends)
12. [OpenTelemetry vs Prometheus vs Jaeger](#12-opentelemetry-vs-prometheus-vs-jaeger)

**Part 2: Lab**

13. [Lab setup](#13-lab-setup)
14. [Lab A: Deploy Jaeger (trace backend)](#14-lab-a-deploy-jaeger-trace-backend)
15. [Lab B: Deploy the OpenTelemetry Collector](#15-lab-b-deploy-the-opentelemetry-collector)
16. [Lab C: Send traces and see them in the Collector](#16-lab-c-send-traces-and-see-them-in-the-collector)
17. [Lab D: Follow the request in the Jaeger UI](#17-lab-d-follow-the-request-in-the-jaeger-ui)
18. [Clean up](#18-clean-up)

**Wrap-up**

19. [Troubleshooting](#19-troubleshooting)
20. [What I learned](#20-what-i-learned)
21. [Commands](#21-commands)
22. [Interview Questions](#22-interview-questions)

---

# Part 1: Concepts

## 1. What is OpenTelemetry?

**Definition:** **OpenTelemetry (OTel)** is an open-source **standard plus a set of tools** (APIs, SDKs, auto-instrumentation agents and the Collector) to **collect, process and export application telemetry** (traces, metrics and logs), so you can **understand application behavior and troubleshoot production problems**. It's a CNCF project, created by merging OpenTracing and OpenCensus.

```
   YOUR APPLICATION             OPENTELEMETRY                         OBSERVABILITY BACKENDS
 ┌──────────────────┐   ┌───────────────────────────────────┐   ┌─────────────────────────────┐
 │ Java  Python     │   │ Instrument → Collect → Process →  │   │ Prometheus   Grafana        │
 │ Node.js          │──►│                         Export    │──►│ Jaeger       Tempo          │
 │ Microservices    │   │                                   │   │ Loki         Commercial     │
 └──────────────────┘   └───────┬──────────┬──────────┬─────┘   │ (Datadog, New Relic…)      │
                                ▼          ▼          ▼         └─────────────────────────────┘
                             TRACES     METRICS     LOGS
                          request      numbers     event
                          journey      over time   details
```

> ⚠️ **Important: OpenTelemetry is not a monitoring dashboard.** It is the **instrumentation and telemetry infrastructure** that **sends data** to systems that **store, analyze, visualize and alert** on it (Prometheus, Grafana, Jaeger…). OTel has no UI and no database of its own.

> **Interview one-liner:** OpenTelemetry is the vendor-neutral standard for instrumenting apps and collecting traces, metrics and logs; the app sends data in the OTLP format to the OTel Collector, which processes it and exports it to backends like Prometheus, Jaeger, Tempo, Loki or Datadog.

---

## 2. Monitoring vs observability

| | **Monitoring** | **Observability** |
|---|---|---|
| Answers | **Is** something wrong? | **Why** is it wrong, and **where**? |
| Based on | Known checks and thresholds (CPU > 80%, error rate > 5%) | Rich data (traces + metrics + logs) you can explore |
| Good for | Known problems | **Unknown** problems in complex microservices |
| Example | "Checkout error rate is 12%" | "Checkout fails because `payment` waits 9 s on MySQL for users in region X" |

**Telemetry** = the data an application sends out about itself. Observability is built on telemetry, and OpenTelemetry is how we collect it.

**Definition:** **observability** is the **ability to understand a system's internal behavior from the data it produces** (logs, metrics, traces).

```
 Application                    Signals                         OpenTelemetry            Backends
 ┌─────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────┐   ┌──────────────────────┐
 │ Service A  frontend │──►│ Logs     what happened?      │   │ collects and     │   │ Grafana    visualize │
 │ Service B  logic    │──►│ Metrics  how is it doing?    │──►│ sends telemetry  │──►│ Prometheus metrics   │
 │ Service C  database │──►│ Traces   how did it flow?    │   │                  │   │ Jaeger     traces    │
 └─────────────────────┘   └──────────────────────────────┘   └──────────────────┘   │ ELK / Loki logs      │
                                                                                     └──────────────────────┘
```

**The 5 words to know:**

| Term | Simple meaning | Example |
|---|---|---|
| **Monitoring** | **Is** something wrong? | CPU is above 90% |
| **Observability** | **Why** is it wrong? | A slow database query is blocking requests |
| **Telemetry** | Data describing system behavior | Traces, metrics, logs |
| **Instrumentation** | Adding the ability to generate telemetry | Adding an OTel SDK or agent to the app |
| **OpenTelemetry** | Standard tooling and APIs for telemetry | Sending traces to a backend |

---

## 3. The 3 signals: traces, metrics, logs

| Signal | What it is | Answers | Example | Typical backend |
|---|---|---|---|---|
| **Traces** | The **journey of one request** through all services | **Where** is it slow or failing? | Client → frontend → cart → payment → MySQL: payment took 2.8 s of 3 s | Jaeger, Grafana Tempo |
| **Metrics** | **Numbers over time** | **How much / how often**? Is it getting worse? | requests/sec, error rate, p95 latency, CPU | Prometheus (+ Grafana) |
| **Logs** | **Event details** with a timestamp | **What exactly** happened? | `ERROR payment declined: card expired order=1234` | Loki, Elasticsearch, CloudWatch |

**How they work together during an incident:**

```
 ① Metric alert: "checkout p95 latency 4 s"   (something is wrong)
        │
        ▼
 ② Trace: the slow request → 3.5 s inside "payment → SELECT orders"   (where)
        │   trace_id = 4bf92f35...
        ▼
 ③ Logs filtered by that trace_id: "connection pool exhausted (max 10)"   (why)
```

OTel puts the **same `trace_id`** on spans and on logs, so you can jump from a trace straight to its logs. This correlation is one of its biggest benefits.

---

## 4. Traces and spans in detail

**Definition:** a **trace** is the **whole path of one request** through the system. It is made of **spans**: one span = **one unit of work** (an HTTP call, a DB query) with a start time, duration and attributes.

```
 Trace 4bf92f35…   (user clicks "Place order", total 3.0 s)
 │
 ├─ span: frontend  POST /api/order ......................... 3.0 s   (root span)
 │   ├─ span: cart  GET /cart/123 ...... 0.1 s
 │   └─ span: payment  POST /pay ............................ 2.8 s
 │        ├─ span: MySQL  SELECT orders ..................... 2.6 s   ◄── the problem
 │        └─ span: rabbitmq  publish order .. 0.05 s
```

| Term | Meaning |
|---|---|
| **Trace ID** | One ID shared by every span of the same request |
| **Span ID** | ID of one span |
| **Parent span** | The span that called this one (builds the tree) |
| **Root span** | The first span (no parent) |
| **Attributes** | Key/values on a span: `http.method=POST`, `http.status_code=500`, `db.system=mysql` |
| **Span status** | OK / Error |
| **Resource** | Who produced it: `service.name=payment`, `k8s.pod.name=…`, `k8s.namespace.name=shop` |

### Context propagation

**Definition:** **context propagation** is how the trace ID **travels from one service to the next**, so separate services' spans join into **one** trace. With HTTP, OTel adds the W3C **`traceparent`** header to outgoing calls:

```
 frontend ──HTTP──► payment
    traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
                     │  └── trace ID (same for whole request)  └ parent span ID  └ sampled
                     version
```

Without propagation, you'd get 5 separate small traces instead of one end-to-end picture.

### Sampling

Recording **every** request in a busy shop is expensive. **Sampling** keeps only some:

| Type | Where | Example |
|---|---|---|
| **Head sampling** | In the app, at the start of the request | Keep 10% of traces (`parentbased_traceidratio` = 0.1) |
| **Tail sampling** | In the Collector, after the trace is complete | Keep **100% of errors and slow traces**, 5% of the rest (smarter, needs a gateway Collector) |

---

## 5. Why OpenTelemetry? (the problem it solves)

### The main problem: "my order is slow, but where?"

An e-commerce app with many services. A customer places an order:

```
 Customer ──► Frontend ──► Order service ──► Payment service ──► Inventory service ──► Database
 places       receives     creates order     processes payment   checks stock          stores order
 an order     request
```

The customer complains: **"My order takes 8 seconds to complete."**

| ❌ Without OpenTelemetry | ✅ With OpenTelemetry |
|---|---|
| You open the frontend dashboard, order-service logs, payment metrics, inventory logs, database dashboard… one by one | You open **one trace** for that order request |
| Each tool shows only its own piece; nothing links them together | The trace shows **every service the request passed through, in order, with its time** |
| Hard to find **which component is slow**; hours of guessing between teams | Answer in seconds |

**With OpenTelemetry, the trace shows:**

```
 Frontend           120 ms   █
 Order service      200 ms   ██
 Payment service   6.5 s     ████████████████████████████████████  ◄── the delay is HERE
 Inventory service  150 ms   █
 Database           100 ms   █
```

It **clearly shows the payment service takes 6.5 seconds**. Now the payment team checks that trace's spans and logs (slow card-gateway call? slow query?) instead of every team searching.

**In simple words:**
- Every request gets a **trace ID** and is **tracked** as it goes from **server to server, service to service**.
- For each step we see **where the time went**, so when something is **wrong or slow**, we know exactly which service caused it.
- OpenTelemetry **captures the logs, metrics and traces of every service**, sends them to backends, and we **visualize everything in Grafana** (metrics from Prometheus, traces from Tempo/Jaeger, logs from Loki).

> **Answer in one word: VISIBILITY.** OpenTelemetry gives **end-to-end visibility** to find **exactly where the delay happens**.

> **Two small details:**
> - In production we usually **sample** (e.g. keep all error/slow traces and a % of normal ones) because tracing every single request is costly. In a lab or low-traffic app we keep 100%.
> - Grafana doesn't store anything: it **shows** data stored in Prometheus (metrics), Tempo/Jaeger (traces) and Loki (logs). Jaeger also has its own trace UI.

### Other problems it solves

**Before OTel:** every vendor had its own agent and its own format.

| Problem | Before | With OpenTelemetry |
|---|---|---|
| **Vendor lock-in** | Datadog agent + Datadog SDK in code; moving to New Relic = re-instrument every service | Instrument **once** with OTel; change the backend in **Collector config only** |
| **Different tools per signal** | Prometheus client for metrics, Jaeger client for traces, log shipper for logs | **One** standard and one protocol (**OTLP**) for all three |
| **Many languages** | Each team picks a different library | Same concepts and semantic conventions in Java, Python, Node.js, Go, .NET… |
| **No correlation** | Metrics, traces and logs can't be linked | Shared `trace_id` and resource attributes link them |

**OTLP (OpenTelemetry Protocol):** the standard format OTel uses to send telemetry. Ports: **4317 = gRPC**, **4318 = HTTP**.

---

## 6. The flow: Instrument → Collect → Process → Export

| Step | What happens | Who does it |
|---|---|---|
| **1. Instrument** | Code (or an auto agent) creates spans, metrics and logs | OTel SDK / auto-instrumentation in the app |
| **2. Collect** | The app sends telemetry over OTLP; the Collector receives it (and can also scrape Prometheus metrics or read log files) | Collector **receivers** |
| **3. Process** | Batch, sample, add Kubernetes metadata (pod, namespace), drop noisy data, remove passwords from attributes | Collector **processors** |
| **4. Export** | Send each signal to its backend | Collector **exporters** |

```
 App + OTel SDK ──OTLP──► OTel Collector ──► traces  ──► Jaeger / Tempo
 (instrument)            (collect, process) ──► metrics ──► Prometheus ──► Grafana
                                            ──► logs    ──► Loki
```

---

## 7. Instrumentation: manual vs automatic

**Definition:** **instrumentation** means **adding code (or an agent) to the app so it produces telemetry**.

| | **Automatic (zero-code)** | **Manual (code-based)** |
|---|---|---|
| How | Attach an agent: Java `-javaagent:opentelemetry-javaagent.jar`, Python `opentelemetry-instrument python app.py`, Node.js `--require @opentelemetry/auto-instrumentations-node/register` | Use the OTel API in code to create your own spans and metrics |
| Gives you | Spans for HTTP servers/clients, DB calls, message queues **without changing code** | Business details: `order.id`, `payment.amount`, custom spans like "calculate shipping" |
| Effort | Minutes | Developer work |
| Real time | **Start here** for every service | Add on top for important flows |

**Manual example (Python):**

```python
from opentelemetry import trace

tracer = trace.get_tracer("payment")

def pay(order):
    with tracer.start_as_current_span("charge-card") as span:
        span.set_attribute("order.id", order.id)
        span.set_attribute("payment.amount", order.total)
        ...
```

**Configuration through standard environment variables** (same in every language):

| Variable | Example |
|---|---|
| `OTEL_SERVICE_NAME` | `payment` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector.observability:4318` |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio` / `0.1` |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=prod` |

---

## 8. The OpenTelemetry Collector

**Definition:** the **OpenTelemetry Collector** is a **standalone service that receives, processes and exports telemetry**. Apps send to the Collector instead of directly to each backend.

**Config has 4 parts, connected by pipelines:**

```yaml
receivers:                 # how data comes IN
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:                # what happens IN THE MIDDLE
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
  k8sattributes: {}        # adds k8s.pod.name, k8s.namespace.name …
  batch: {}                # send in batches (efficient)

exporters:                 # where data goes OUT
  otlp/jaeger:
    endpoint: jaeger.observability:4317
    tls:
      insecure: true
  prometheus:
    endpoint: 0.0.0.0:8889
  debug: {}                # print to the Collector's own logs (testing)

service:
  pipelines:               # connect them, per signal
    traces:
      receivers: [otlp]
      processors: [memory_limiter, k8sattributes, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

| Part | Job | Common ones |
|---|---|---|
| **Receivers** | Accept data | `otlp`, `prometheus` (scrape), `filelog` (read container logs), `jaeger`, `zipkin` |
| **Processors** | Change data | `memory_limiter` (first), `batch` (last), `k8sattributes`, `attributes` (remove secrets), `tail_sampling`, `filter` |
| **Exporters** | Send data | `otlp` (Tempo, Jaeger, vendors), `otlphttp`, `prometheus` / `prometheusremotewrite`, `loki`/OTLP to Loki, `awsxray`, `debug` |
| **Pipelines** | Wire receivers → processors → exporters for **traces**, **metrics** or **logs** | One per signal |

**Why use a Collector instead of sending straight from the app:**
- App stays simple: it just sends OTLP to one place.
- Change backends **without redeploying apps**.
- Central place for batching, retries, sampling, removing sensitive data.
- Send to **two backends at once** during a migration.

**Distributions:** `otelcol` (core), `otelcol-contrib` (all community components), `otelcol-k8s` (Kubernetes-focused), and vendor builds like the **AWS Distro for OpenTelemetry (ADOT)** on EKS.

---

## 9. Agent vs gateway on Kubernetes

| Pattern | How it runs | Good for |
|---|---|---|
| **Agent** | **DaemonSet**: one Collector per node; apps send to their node's Collector | Low latency, reading node log files (`filelog`), node metrics, adding k8s metadata |
| **Gateway** | **Deployment** (several replicas) behind a Service | Central processing: tail sampling, auth to vendors, one place to change backends |
| **Sidecar** | One Collector container inside each Pod | Special cases, per-app isolation |

**Real-time setup (most common):**

```
 Pods ──► Agent Collector (DaemonSet, every node) ──► Gateway Collector (Deployment) ──► backends
          + container logs, node metrics              tail sampling, export
```

---

## 10. Auto-instrumentation with the OpenTelemetry Operator

**Definition:** the **OpenTelemetry Operator** is a Kubernetes operator (Day 28: CRDs + controller) that **manages Collectors** and can **inject auto-instrumentation into Pods** with just an annotation. No Dockerfile or code change.

**Step 1: an `Instrumentation` object** (where to send, which propagators, how much to sample):

```yaml
apiVersion: opentelemetry.io/v1alpha1
kind: Instrumentation
metadata:
  name: shop-instrumentation
  namespace: shop
spec:
  exporter:
    endpoint: http://otel-collector.observability.svc.cluster.local:4318
  propagators:
  - tracecontext
  - baggage
  sampler:
    type: parentbased_traceidratio
    argument: "0.25"          # keep 25% of traces
```

**Step 2: one annotation on the Deployment's Pod template:**

```yaml
spec:
  template:
    metadata:
      annotations:
        instrumentation.opentelemetry.io/inject-java: "true"     # shipping
        # inject-python: "true"   → payment
        # inject-nodejs: "true"   → catalogue, user, cart
```

**What happens:** the Operator's admission webhook adds an **init container** that copies the OTel agent into the Pod and sets the `OTEL_*` environment variables. The app starts already instrumented.

| RoboShop service | Language | Annotation |
|---|---|---|
| catalogue, user, cart | Node.js | `inject-nodejs` |
| shipping | Java | `inject-java` |
| payment | Python | `inject-python` |
| frontend (nginx) | — | nginx needs its own module; often traced from the load balancer / ingress instead |

> The Operator needs **cert-manager** (for its webhook certificates). On EKS, the **ADOT add-on** provides the same Operator, managed by AWS.

---

## 11. Observability backends

OTel only collects and sends. The backend **stores, analyzes, visualizes and alerts**:

| Backend | Stores | Notes |
|---|---|---|
| **Prometheus** | Metrics | Collector exports with `prometheus` / `prometheusremotewrite`; Prometheus also accepts OTLP directly in newer versions |
| **Grafana** | Nothing (UI) | Dashboards and alerts on Prometheus, Tempo, Loki, Jaeger |
| **Jaeger** | Traces | Open-source trace UI; Jaeger v2 is itself built on the OTel Collector |
| **Grafana Tempo** | Traces | Cheap trace storage in S3, linked with Loki and Prometheus in Grafana |
| **Grafana Loki** | Logs | Accepts OTLP logs |
| **Commercial** | All | Datadog, New Relic, Dynatrace, Honeycomb, Splunk, AWS X-Ray / CloudWatch: all accept OTLP |

**Popular open-source stack:** OTel Collector → **Prometheus** (metrics) + **Tempo** (traces) + **Loki** (logs) → **Grafana** (one UI). Called the "LGTM" stack (Loki, Grafana, Tempo, Mimir/Prometheus).

---

## 12. OpenTelemetry vs Prometheus vs Jaeger

| | OpenTelemetry | Prometheus | Jaeger |
|---|---|---|---|
| Is | Instrumentation + collection **standard** | Metrics **database** + alerting | Trace **storage + UI** |
| Signals | Traces, metrics, logs | Metrics | Traces |
| Stores data? | ❌ No | ✅ Yes | ✅ Yes |
| Has a UI? | ❌ No | Basic | ✅ Yes |
| Replace each other? | No: OTel **feeds** Prometheus and Jaeger | | |

> **Interview one-liner:** OpenTelemetry produces and ships the data, Prometheus stores metrics, Jaeger or Tempo store traces, Loki stores logs, and Grafana shows them all; they work together, they don't compete.

---

# Part 2: Lab

We build the trace pipeline: **test app → OTel Collector → Jaeger**, then follow a request in the Jaeger UI.

```
 telemetrygen (fake "roboshop-cart" service)
        │ OTLP gRPC :4317
        ▼
 otel-collector (Deployment)  ── debug exporter → Collector logs
        │ OTLP gRPC :4317
        ▼
 jaeger (storage + UI :16686)  ◄── browser via SSH tunnel
```

## 13. Lab setup

**Prereqs:** EKS + `kubectl` and `helm` on the bastion ([Day 23](../day-23-eks-terraform-helm-argocd/README.md)).

**Step 1: Create a namespace**

```bash
kubectl create namespace observability
```

---

## 14. Lab A: Deploy Jaeger (trace backend)

**Step 1: Create the file `jaeger.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: jaeger
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: jaeger
  template:
    metadata:
      labels:
        app: jaeger
    spec:
      containers:
      - name: jaeger
        image: jaegertracing/jaeger:2.5.0     # all-in-one: OTLP in, memory storage, UI
        ports:
        - containerPort: 4317                 # OTLP gRPC
        - containerPort: 4318                 # OTLP HTTP
        - containerPort: 16686                # UI
---
apiVersion: v1
kind: Service
metadata:
  name: jaeger
  namespace: observability
spec:
  selector:
    app: jaeger
  ports:
  - name: otlp-grpc
    port: 4317
  - name: otlp-http
    port: 4318
  - name: ui
    port: 16686
```

**Step 2: Apply it**

```bash
kubectl apply -f jaeger.yaml
```

**Step 3: Check it's running**

```bash
kubectl get pods -n observability -l app=jaeger
```

**Expected:** `1/1 Running` ✅. (In-memory storage: traces are lost on restart. Production uses Elasticsearch/OpenSearch, Cassandra, or Tempo with S3.)

---

## 15. Lab B: Deploy the OpenTelemetry Collector

**Step 1: Add the Helm repo**

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
```

```bash
helm repo update
```

**Step 2: Create the file `collector-values.yaml`**

```yaml
mode: deployment                 # gateway style (DaemonSet = agent)
fullnameOverride: otel-collector # Service name = otel-collector
image:
  repository: otel/opentelemetry-collector-k8s

config:
  exporters:
    otlp/jaeger:
      endpoint: jaeger.observability.svc.cluster.local:4317
      tls:
        insecure: true           # lab only: no TLS inside the cluster
  service:
    pipelines:
      traces:
        exporters: [debug, otlp/jaeger]   # print AND send to Jaeger
```

**What it does:** the chart's default config already has the `otlp` receiver (4317/4318), `memory_limiter` and `batch` processors and the `debug` exporter. We add a Jaeger exporter and put it in the traces pipeline.

**Step 3: Install**

```bash
helm install otel-collector open-telemetry/opentelemetry-collector -n observability -f collector-values.yaml
```

**Step 4: Check it's running**

```bash
kubectl get pods,svc -n observability
```

**Expected:** `otel-collector-…` Pod `Running` and Service `otel-collector` with ports `4317`, `4318` ✅

**Step 5: Look at the final config the chart built**

```bash
kubectl get configmap otel-collector -n observability -o yaml | grep -A6 'pipelines:'
```

**Expected:** a `traces` pipeline with `exporters: [debug, otlp/jaeger]`.

---

## 16. Lab C: Send traces and see them in the Collector

`telemetrygen` is an official OTel test tool that pretends to be an instrumented app.

**Step 1: Send 5 traces as a fake `roboshop-cart` service**

```bash
kubectl run telemetrygen -n observability --rm -it --restart=Never --image=ghcr.io/open-telemetry/opentelemetry-collector-contrib/telemetrygen:v0.120.0 -- traces --otlp-endpoint=otel-collector:4317 --otlp-insecure --traces=5 --service=roboshop-cart
```

**Expected:** log lines ending with `traces generated` / `stop the batch span processor`, then `pod "telemetrygen" deleted` ✅

**Step 2: See them arrive in the Collector (debug exporter)**

```bash
kubectl logs deployment/otel-collector -n observability --tail=20
```

**Expected:** lines like `Traces {"kind": "exporter", "data_type": "traces", "name": "debug", "resource spans": 1, "spans": 2}` ✅. The Collector received the spans and passed them on.

---

## 17. Lab D: Follow the request in the Jaeger UI

**Step 1: On the bastion, port-forward the Jaeger UI**

```bash
kubectl port-forward svc/jaeger 16686:16686 -n observability
```

Leave it running.

**Step 2: On your laptop (new terminal), open an SSH tunnel to the bastion**

```bash
ssh -L 16686:localhost:16686 ec2-user@<bastion-public-ip>
```

**Step 3: Open the UI in the laptop browser**

```
http://localhost:16686
```

**Step 4: Find the traces**

**Search** → **Service:** `roboshop-cart` → **Find Traces**.

**Expected:** 5 traces ✅. Click one: a timeline with a **parent span** (`lets-go`) and a **child span** (`okey-dokey`), each with duration, attributes and the `service.name`. This is the request journey view you'd use to find the slow service in a real outage.

**Step 5: Find the trace ID**

On the trace page, the ID at the top (32 hex characters) is the **trace ID**: the same value that travels in the `traceparent` header and that you'd search for in Loki to see this request's logs.

---

## 18. Clean up

```bash
helm uninstall otel-collector -n observability
```

```bash
kubectl delete namespace observability
```

---

# Wrap-up

## 19. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| Helm: `'image.repository' must be set` | Newer chart versions need a Collector image chosen | Set `image.repository: otel/opentelemetry-collector-k8s` (or `-contrib`) |
| telemetrygen: `connection refused` / `context deadline exceeded` | Wrong endpoint or Collector not ready | Use `otel-collector:4317` (same namespace) or the full `otel-collector.observability.svc.cluster.local:4317`; check the Pod is `Running` |
| Collector logs: `failed to export ... jaeger` | Jaeger Service name/port wrong, or TLS expected | `jaeger.observability.svc.cluster.local:4317` with `tls.insecure: true` |
| Spans in Collector logs but not in Jaeger | `otlp/jaeger` not in the `traces` pipeline | Check the pipeline in the ConfigMap |
| Each service shows a separate trace | Context not propagated (custom HTTP client, proxy strips headers) | Use instrumented HTTP libraries, propagators `tracecontext,baggage`, don't drop `traceparent` |
| Collector `OOMKilled` | No `memory_limiter`, too much data | Put `memory_limiter` first, set resource limits, sample more |
| Too much data / high cost | 100% sampling | Head sampling in the app or tail sampling in a gateway Collector |
| Service shows as `unknown_service` | `OTEL_SERVICE_NAME` not set | Set it (the Operator sets it from the Deployment name) |

---

## 20. What I learned

**Concepts**
- **OpenTelemetry** = standard way to **collect, process and export** traces, metrics and logs. **Not a dashboard.**
- **Traces** = request journey (where), **metrics** = numbers over time (how much), **logs** = event details (what exactly).
- A **trace** is a tree of **spans**; the `traceparent` header carries the trace ID between services.
- Flow: **Instrument → Collect → Process → Export.** Protocol: **OTLP** (4317 gRPC, 4318 HTTP).
- **Collector** = receivers → processors → exporters, wired by pipelines per signal. Change backends without touching apps.
- **Agent** (DaemonSet) + **gateway** (Deployment) is the common Kubernetes setup.
- The **OTel Operator** auto-instruments Pods with one annotation.
- Backends: Prometheus (metrics), Jaeger/Tempo (traces), Loki (logs), Grafana (UI), or a vendor.

**Lab**
- Collector via Helm, Jaeger as backend, `telemetrygen` for test traces, `debug` exporter to confirm data flows.

```
 App ──OTLP──► Collector ──► Jaeger / Tempo · Prometheus · Loki ──► Grafana
```

## 21. Commands

| Command | What it does |
|---|---|
| `helm install otel-collector open-telemetry/opentelemetry-collector -n NS -f values.yaml` | Install a Collector |
| `kubectl logs deploy/otel-collector -n NS` | See received data (debug exporter) and errors |
| `kubectl get cm otel-collector -n NS -o yaml` | See the Collector config |
| `telemetrygen traces --otlp-endpoint=HOST:4317 --otlp-insecure --traces=5` | Send test traces |
| `kubectl port-forward svc/jaeger 16686:16686 -n NS` | Open the Jaeger UI |
| `opentelemetry-instrument python app.py` | Auto-instrument a Python app |
| `java -javaagent:opentelemetry-javaagent.jar -jar app.jar` | Auto-instrument a Java app |

## 22. Interview Questions

### ⭐ Very Important

**Q1. What problem does OpenTelemetry solve?**
In microservices, one request passes through many services (frontend → order → payment → inventory → database). When it's slow, separate dashboards and logs can't show which service is the problem. OpenTelemetry tracks each request end to end with a trace ID and shows the time spent in each service, for example "payment took 6.5 s of 8 s". In one word: visibility.

**Q2. What is observability, and how is it different from monitoring?**
Observability is the ability to understand a system's internal behavior from the data it produces (logs, metrics, traces). Monitoring tells you **if** something is wrong (CPU above 90%); observability tells you **why** (a slow database query is blocking requests).

**Q3. What is OpenTelemetry?**
A standard, vendor-neutral way to collect, process and export application telemetry (traces, metrics and logs) so we can understand application behavior and troubleshoot production problems. It provides APIs, SDKs, auto-instrumentation and the Collector.

**Q4. What are traces, metrics and logs?**
Traces show the journey of one request across services (where it's slow or failing). Metrics are numbers over time (rates, latency, CPU). Logs are detailed event records (what exactly happened).

**Q5. Is OpenTelemetry a monitoring dashboard?**
No. It's the instrumentation and telemetry infrastructure. It sends data to systems that store, analyze, visualize and alert on it, like Prometheus, Grafana, Jaeger, Tempo, Loki or commercial platforms.

**Q6. What is the OpenTelemetry flow?**
Instrument the app (SDK or auto-instrumentation) → Collect (Collector receivers, OTLP) → Process (batch, sample, add Kubernetes metadata, remove sensitive data) → Export to backends.

### Other Questions

**Q7. What is the OpenTelemetry Collector and why use it?**
A service that receives, processes and exports telemetry using receivers, processors and exporters wired into pipelines. Apps send to one place, and we can change or add backends, sample, batch and filter without redeploying apps.

**Q8. What is OTLP?**
The OpenTelemetry Protocol, the standard format for sending traces, metrics and logs. Port 4317 for gRPC, 4318 for HTTP.

**Q9. What is a span and how does it relate to a trace?**
A span is one unit of work (HTTP call, DB query) with timing and attributes. A trace is the tree of all spans for one request, linked by the same trace ID and parent span IDs.

**Q10. How does a trace continue across microservices?**
Context propagation: the instrumented HTTP or messaging client adds the W3C `traceparent` header with the trace ID and parent span ID, and the next service continues the same trace.

**Q11. Automatic vs manual instrumentation?**
Automatic attaches an agent and traces frameworks (HTTP, DB, queues) with no code changes. Manual uses the OTel API to add business spans and attributes. In real projects we start with automatic and add manual spans for important flows.

**Q12. How do you instrument apps on Kubernetes without changing images?**
Install the OpenTelemetry Operator, create an `Instrumentation` resource with the Collector endpoint and sampler, and add `instrumentation.opentelemetry.io/inject-<language>: "true"` to the Pod template. The Operator injects the agent and `OTEL_*` variables.

**Q13. Agent vs gateway Collector?**
Agent: a DaemonSet, one per node, close to the apps, collects node logs and metrics and adds metadata. Gateway: a central Deployment that does tail sampling and exports to backends. Production often uses both.

**Q14. Head vs tail sampling?**
Head sampling decides at the start of a request in the app (e.g. keep 10%). Tail sampling decides in the Collector after the trace finishes, so it can keep all errors and slow traces and drop most normal ones.

**Q15. OpenTelemetry vs Prometheus?**
Prometheus is a metrics database with alerting. OpenTelemetry is the standard to produce and ship metrics, traces and logs. OTel can send metrics to Prometheus; they work together.

**Q16. How does OpenTelemetry avoid vendor lock-in?**
Apps are instrumented with the open OTel standard and send OTLP to the Collector. Switching from, say, Jaeger to Datadog only changes the Collector's exporter config, not the application code.

**Q17. How would you troubleshoot a slow checkout with OpenTelemetry?**
A metric alert shows high checkout latency; open a slow trace for the checkout endpoint and find the longest span (e.g. payment's MySQL query); then filter logs by that trace ID to see the exact error or cause.

**Source:** [OpenTelemetry docs](https://opentelemetry.io/docs/) · [Collector configuration](https://opentelemetry.io/docs/collector/configuration/) · [OpenTelemetry Operator](https://opentelemetry.io/docs/platforms/kubernetes/operator/) · [Collector Helm chart](https://github.com/open-telemetry/opentelemetry-helm-charts) · [Jaeger](https://www.jaegertracing.io/docs/)
