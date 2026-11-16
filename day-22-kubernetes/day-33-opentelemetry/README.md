# Day 33 - OpenTelemetry: Traces, Metrics and Logs the Standard Way

[← Kubernetes notes](../README.md)

> **In short:** **OpenTelemetry (OTel)** is a **standard, vendor-neutral way to collect, process and export telemetry** from applications: **traces** (the journey of a request), **metrics** (numbers over time) and **logs** (event details). You **instrument** the app once, send the data to the **OpenTelemetry Collector**, and the Collector exports it to any backend: Prometheus, Grafana, Jaeger, Tempo, Loki or a commercial platform. **Important:** OpenTelemetry is **not a monitoring dashboard**; it's the plumbing that gets the data to the tools that store, analyze, visualize and alert on it.

## About this topic

| Part | Topic | What you learn |
|---|---|---|
| **Part 1: Concepts** | Observability vs monitoring, the 3 signals, traces and spans (root, child, events), why OTel, the 5-part architecture, OTLP ports and paths, the Collector (receivers / processors / exporters / connectors), agent vs gateway, auto-instrumentation on Kubernetes, OTel vs Prometheus vs Grafana vs Jaeger | What OpenTelemetry is, how data flows, and how it's used in real projects |
| **Part 2: Lab** | Jaeger as the trace backend, OTel Collector with Helm, test traces, a 3-service Python shop (gateway → order → inventory), metrics to Prometheus | Run the full pipeline on EKS: apps → Collector → Jaeger + Prometheus, and find the slow / failing service |

> **Before this:** [Day 27 - Monitoring with Prometheus and Grafana](../day-27-monitoring-prometheus-grafana/README.md) (metrics). OpenTelemetry adds **traces** and a single standard for all three signals. · **Next:** [Day 34 - Certificates, Pod Priority and Static Pods](../day-34-certificates-pod-priority/README.md)

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
12. [OpenTelemetry vs Prometheus vs Grafana vs Jaeger](#12-opentelemetry-vs-prometheus-vs-grafana-vs-jaeger)

**Part 2: Lab**

13. [Lab setup](#13-lab-setup)
14. [Lab A: Deploy Jaeger (trace backend)](#14-lab-a-deploy-jaeger-trace-backend)
15. [Lab B: Deploy the OpenTelemetry Collector](#15-lab-b-deploy-the-opentelemetry-collector)
16. [Lab C: Send traces and see them in the Collector](#16-lab-c-send-traces-and-see-them-in-the-collector)
17. [Lab D: Follow the request in the Jaeger UI](#17-lab-d-follow-the-request-in-the-jaeger-ui)
18. [Lab E: A 3-service shop, one request across all services](#18-lab-e-a-3-service-shop-one-request-across-all-services)
19. [Lab F: Send metrics to Prometheus](#19-lab-f-send-metrics-to-prometheus)
20. [Clean up](#20-clean-up)

**Wrap-up**

21. [Troubleshooting](#21-troubleshooting)
22. [What I learned](#22-what-i-learned)
23. [Commands](#23-commands)
24. [Interview Questions](#24-interview-questions)

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

**In simple words:**
- **Telemetry** = the data the system gives us: metrics like **CPU, memory, request count**, plus traces and logs.
- **Monitoring** watches that data and tells us **what** is wrong and **when** (CPU 95%, error rate up) and **sends alerts**.
- **Observability** sits **on top of monitoring**. It helps us find out **why** the issue happened: **RCA (root cause analysis)**, debugging, following the request to the exact service.

```
 Telemetry (data)  ──►  Monitoring (what is wrong? alert!)  ──►  Observability (why? RCA, debug)
 CPU, memory,           "checkout error rate 12%"                 "payment waits 6 s on the DB"
 traces, logs           → page the on-call engineer               → fix the slow query
```

> **Small detail:** monitoring tells you **that** something is wrong (and can predict it from trends, e.g. disk will be full in 2 hours), but the **why** comes from observability: traces + logs for that request.

---

## 3. The 3 signals: traces, metrics, logs

| Signal | What it is | Answers | Example | Typical backend |
|---|---|---|---|---|
| **Traces** | The **journey of one request** through all services | **Where** is it slow or failing? | Client → frontend → cart → payment → MySQL: payment took 2.8 s of 3 s | Jaeger, Grafana Tempo |
| **Metrics** | **Numbers over time** | **How much / how often**? Is it getting worse? | requests/sec, error rate, p95 latency, CPU | Prometheus (+ Grafana) |
| **Logs** | **Event details** with a timestamp | **What exactly** happened? | `ERROR payment declined: card expired order=1234` | Loki, Elasticsearch, CloudWatch |

> **Remember this forever:**
> - **Metrics** tell you **what** is happening (the health: request rate 1.2K req/s, error rate 0.5%, CPU 65%, memory 3.2 GB).
> - **Traces** tell you **where** the time is spent (the journey: API 100 ms → Order 200 ms → **Payment 2,000 ms** → DB 300 ms).
> - **Logs** tell you **what happened in detail** (timestamp, level, service, trace ID, error message).

**In simple words:** every request is stored as a **trace**, and the trace shows the **time taken at each step**, so we see which service is slow.

**A log line with a trace ID** (OTel adds the `trace_id`, so you can jump from the trace to this log):

```json
{
  "timestamp": "2026-10-24T10:15:30Z",
  "level": "ERROR",
  "service": "payment-service",
  "trace_id": "4f8e2c1d9b3a7e6f",
  "message": "Payment declined: insufficient funds"
}
```

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

**Definition:** a **trace** is the **whole path of one request** through the system (end to end). It is made of **spans**.

**Definition:** a **span** is **one operation within a trace**, with a start time, end time (so a duration) and attributes.

**Examples of a span:**

| Operation | Span |
|---|---|
| Receiving an HTTP request | `GET /checkout` |
| Executing a SQL query | `SELECT * FROM orders` |
| Calling a payment API | `POST /pay` |
| Publishing a message to Kafka / RabbitMQ | `orders publish` |
| Processing a background job | `send-invoice-email` |

**Root span and child spans:**

```
 Trace (end-to-end request)
 └─ Root span: HTTP request ............ 500 ms   (top-level, no parent)
     ├─ Child span: SQL query ........ 120 ms
     ├─ Child span: Payment API ...... 200 ms
     └─ Child span: Publish to Kafka .  80 ms
```

| | Meaning |
|---|---|
| **Root span** | The **top-level operation**, normally the incoming request (e.g. `GET /checkout`). It has **no parent** |
| **Child span** | A **nested operation** done for its parent: a call to another service (`POST /orders`), a DB query, a queue publish |
| **Span event** | Something that happened **inside** a span at a point in time, like a **retry** or an **exception**. An event is **not** a separate span (no duration of its own) |

**In simple words:** the root span is the HTTP request that came in; the child spans are everything it did to answer it: the `POST`/`GET` calls to other services, the SQL queries, etc. Each one shows its own time.

> **Small detail:** child spans aren't only `POST`/`PUT` calls. **Any** operation can be a child span: a `GET`, a DB query, a Kafka publish, or a custom step like `validate-order`.

**Another example (RoboShop order):**

```
 Trace 4bf92f35…   (user clicks "Place order", total 3.0 s)
 │
 ├─ span: frontend  POST /api/order ......................... 3.0 s   (root span)
 │   ├─ span: cart  GET /cart/123 ...... 0.1 s
 │   └─ span: payment  POST /pay ............................ 2.8 s
 │        ├─ span: MySQL  SELECT orders ..................... 2.6 s   ◄── the problem
 │        └─ span: rabbitmq  publish order .. 0.05 s
```

**What a span contains:**

| Field | Meaning |
|---|---|
| **Trace ID** | Identifies the whole distributed request; shared by every span of it |
| **Span ID** | Identifies this one operation |
| **Parent span ID** | The span that called this one (builds the tree); empty for the root span |
| **Start and end times** | Give the **duration** |
| **Attributes** | Operation metadata (key/values): `http.method=POST`, `http.status_code=500`, `db.system=mysql` |
| **Events** | Timestamped events during the operation (retry, exception) |
| **Status** | Whether the operation **succeeded or failed** (OK / Error) |
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

**OTLP (OpenTelemetry Protocol):** the standard format OTel uses to send telemetry. Ports: **4317 = gRPC**, **4318 = HTTP** (details in [section 6](#otlp-opentelemetry-protocol)).

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

### The OpenTelemetry architecture (5 parts)

```
 ① Application ──► ② Instrumentation ──► ③ OTel SDK ──► ④ OTel Collector ──► ⑤ Backend
   Java, Python,     auto (agent)          sampling        receive              Prometheus, Grafana,
   Node.js,          OR manual (API        processing      process              Jaeger, Tempo, Loki,
   databases         calls in code)        batching        export               Datadog, Splunk…
                                           export
 └──────────── inside your app / Pod ────────────┘ └─ separate service ─┘ └─ store, analyze, visualize, alert
```

| # | Part | What it does |
|---|---|---|
| 1 | **Application** | Your business logic, framework and database calls (the thing we want to see inside) |
| 2 | **Instrumentation** | Adds telemetry: **auto** (agent, no code change) **or manual** (OTel API calls in code) |
| 3 | **OTel SDK** | Handles telemetry **inside the app**: **sampling** (reduce data), **processing** (enrich, filter), **batching** (group data), **export** (send to the Collector) |
| 4 | **OTel Collector** | Central service: **receives** from SDKs/agents, **processes** (filter, transform, enrich), **exports** to backends |
| 5 | **Backend** | **Stores, analyzes, visualizes and alerts**: Prometheus (metrics), Grafana (dashboards), Jaeger/Tempo (traces), Loki (logs), commercial (Datadog, Splunk, New Relic) |

### OTLP (OpenTelemetry Protocol)

**Definition:** **OTLP** is the **standard protocol for transmitting OpenTelemetry telemetry** between applications, Collectors and compatible backends.

```
 App / Service             OTLP                   OTel Collector           Compatible backends
 (instrumented with  ──►  OTLP/gRPC   ──►  receives, processes,  ──►  Grafana, Prometheus, Jaeger,
  the OTel SDK)            OTLP/HTTP        forwards telemetry          Loki, Elastic, AWS CloudWatch
                          (transport)
```

**Common OTLP endpoints:**

| Transport | Default port | Common use |
|---|---|---|
| **OTLP/gRPC** | **4317** | Binary protobuf over gRPC (most SDKs, Collector to Collector) |
| **OTLP/HTTP** | **4318** | Protobuf (or JSON) over HTTP (browsers, proxies that only allow HTTP) |

**OTLP/HTTP paths:** one per signal.

| Signal | Path | Full example |
|---|---|---|
| Traces | `/v1/traces` | `http://otel-collector:4318/v1/traces` |
| Metrics | `/v1/metrics` | `http://otel-collector:4318/v1/metrics` |
| Logs | `/v1/logs` | `http://otel-collector:4318/v1/logs` |

> ⚠️ **Important:** these ports and paths are **defaults, not guarantees**. The real endpoint depends on the receiver or exporter config (e.g. Prometheus accepts OTLP metrics on `:9090/api/v1/otlp/v1/metrics`).

> **Interview answer:** OTLP standardizes **how telemetry is transported**; it does **not** define how a backend stores or visualizes the data.

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

**Definition:** the **OpenTelemetry Collector** is a **standalone service that receives, processes and exports telemetry**. Apps send to the Collector instead of directly to each backend. Think of it as a **telemetry traffic controller** between your applications and the observability backends.

```
 Your applications                        OpenTelemetry Collector                       Backends
 ┌──────────────────┐  traces   ┌───────────────┬───────────────┬───────────────┐   ┌──────────────────────┐
 │ Microservices    │──────────►│  RECEIVERS    │  PROCESSORS   │  EXPORTERS    │──►│ Grafana  (visualize) │
 │ Web apps         │  metrics  │  accept data  │  batch,       │  send to one  │──►│ Prometheus (metrics) │
 │ Servers          │──────────►│  (OTLP,       │  enrich,      │  or more      │──►│ Tempo    (traces)    │
 │ Cloud services   │  logs     │  Jaeger,      │  filter,      │  destinations │──►│ Loki     (logs)      │
 │ Containers       │──────────►│  Prometheus)  │  transform    │               │──►│ AWS CloudWatch       │
 └──────────────────┘           ├───────────────┴───────────────┴───────────────┤──►│ Datadog, Splunk…     │
                                │ CONNECTORS: link one pipeline to another      │   └──────────────────────┘
                                └───────────────────────────────────────────────┘
```

> **In one word: CONTROLLER.** It **receives** telemetry, **processes** it, and **routes** it to one or more observability backends.

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
| **Connectors** | Link **one pipeline to another**: they act as an exporter in the first and a receiver in the second | `spanmetrics` (turns traces into request/error/duration metrics), `count`, `routing` |
| **Pipelines** | Wire receivers → processors → exporters for **traces**, **metrics** or **logs** | One per signal |

> **Rule to remember:** read the config **top to bottom** (receivers → processors → exporters), then check `service.pipelines`. **Nothing runs unless it appears in a pipeline.** A defined exporter that isn't in any pipeline does nothing.

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

## 12. OpenTelemetry vs Prometheus vs Grafana vs Jaeger

Each tool has **one job**:

| Tool | Job in one word | What it does |
|---|---|---|
| **OpenTelemetry** | **COLLECT** | Generates, collects and exports telemetry (metrics, logs, traces) through the Collector |
| **Prometheus** | **METRICS** | Collects and stores metrics; PromQL queries and alerting rules |
| **Grafana** | **VISUALIZE** | Dashboards for metrics, logs and traces from its data sources (stores nothing) |
| **Jaeger** | **TRACING** | Stores and visualizes distributed traces (has its own UI) |
| **Grafana Tempo** | **TRACE DB** | Cheap distributed trace storage and querying (viewed in Grafana) |
| **Grafana Loki** | **LOGS** | Log aggregation and querying |
| **Alertmanager** | **ALERTS** | Groups, routes and manages Prometheus alerts (to Slack, email, PagerDuty) |

```
                           ┌──► traces  ──► Jaeger / Tempo ──┐
 Apps ──► OpenTelemetry ───┼──► metrics ──► Prometheus ──────┼──► Grafana (one UI)
          Collector        └──► logs    ──► Loki ────────────┘
                                              │
                                              └──► Alertmanager ──► Slack / email / PagerDuty
```

**In simple words:** OpenTelemetry collects everything; **traces are sent to Jaeger**, **metrics are sent to Prometheus**, logs to Loki, and we look at all of them in Grafana.

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

We build the pipeline in steps: first **test traces → OTel Collector → Jaeger** (Labs A–D), then a **real 3-service shop** whose traces go to Jaeger and metrics to Prometheus (Labs E–F).

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

## 18. Lab E: A 3-service shop, one request across all services

`telemetrygen` is fake. Now a **real** mini shop: 3 small Python (Flask) services, **auto-instrumented** with `opentelemetry-instrument` (no OTel code needed for HTTP), plus a few **manual spans**.

```
 curl ──► gateway:5000 ──► order-service:5001 ──► inventory-service:5002
          GET /checkout    POST /orders           GET /stock/<item>
              │                 │                      │
              └──────────── OTLP gRPC :4317 ───────────┘
                                │
                                ▼
                 otel-collector (namespace observability)
                     │ traces              │ metrics
                     ▼                     ▼
               Jaeger :16686        Prometheus :9090  (Lab F)
```

**Step 1: Create the namespace**

```bash
kubectl create namespace shop
```

**Step 2: Create the file `shop-code.yaml`** (the code of the 3 services, in a ConfigMap, so we don't need to build images)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: shop-code
  namespace: shop
data:
  gateway.py: |
    import os, requests
    from flask import Flask, request, jsonify

    app = Flask(__name__)
    ORDER_URL = os.environ["ORDER_URL"]

    @app.get("/checkout")
    def checkout():
        item = request.args.get("item", "laptop")
        r = requests.post(f"{ORDER_URL}/orders", json={"item": item}, timeout=10)
        return jsonify(r.json()), r.status_code

    app.run(host="0.0.0.0", port=5000)

  order.py: |
    import os, requests
    from flask import Flask, request, jsonify
    from opentelemetry import trace

    app = Flask(__name__)
    tracer = trace.get_tracer("order-service")
    INVENTORY_URL = os.environ["INVENTORY_URL"]

    @app.post("/orders")
    def create_order():
        item = request.get_json()["item"]
        with tracer.start_as_current_span("validate-order") as span:   # manual span
            span.set_attribute("order.item", item)
        r = requests.get(f"{INVENTORY_URL}/stock/{item}", timeout=10)
        if r.status_code >= 500:
            return jsonify(error="inventory failed"), 502
        if r.json()["count"] == 0:
            return jsonify(status="out of stock", item=item), 409
        return jsonify(status="order placed", item=item)

    app.run(host="0.0.0.0", port=5001)

  inventory.py: |
    import random, time
    from flask import Flask, jsonify
    from opentelemetry import trace

    app = Flask(__name__)
    tracer = trace.get_tracer("inventory-service")
    STOCK = {"laptop": 5, "phone": 0, "tv": 3}

    @app.get("/stock/<item>")
    def stock(item):
        with tracer.start_as_current_span("db-lookup") as span:        # manual span
            span.set_attribute("db.item", item)
            if item == "boom":
                span.set_status(trace.StatusCode.ERROR, "db down")
                return jsonify(error="db down"), 500
            time.sleep(2 if item == "tv" else random.uniform(0.02, 0.1))   # tv = slow DB query
            count = STOCK.get(item, 0)
        return jsonify(item=item, count=count)

    app.run(host="0.0.0.0", port=5002)
```

| Item | What happens | Why it's useful |
|---|---|---|
| `laptop` | Order placed (200) | Normal request |
| `phone` | Out of stock (409) | Business "no", not an error |
| `tv` | Order placed but **slow** (2 s in `db-lookup`) | Practice finding **where the delay is** |
| `boom` | Inventory 500 → order 502 → gateway 502 | Practice finding **which service failed** |

**Step 3: Apply it**

```bash
kubectl apply -f shop-code.yaml
```

**Step 4: Create the file `shop.yaml`** (3 Deployments + 3 Services)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gateway
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: gateway
  template:
    metadata:
      labels:
        app: gateway
    spec:
      containers:
      - name: app
        image: python:3.12-slim
        command: ["sh", "-c"]
        args:
        - |
          set -e
          pip install -q flask requests opentelemetry-distro opentelemetry-exporter-otlp
          opentelemetry-bootstrap -a install
          exec opentelemetry-instrument python /code/gateway.py
        env:
        - name: ORDER_URL
          value: http://order-service:5001
        - name: OTEL_SERVICE_NAME
          value: gateway
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: http://otel-collector.observability:4317
        - name: OTEL_EXPORTER_OTLP_PROTOCOL
          value: grpc
        - name: OTEL_TRACES_EXPORTER
          value: otlp
        - name: OTEL_METRICS_EXPORTER
          value: otlp
        - name: OTEL_LOGS_EXPORTER
          value: none
        - name: OTEL_METRIC_EXPORT_INTERVAL
          value: "10000"                 # send metrics every 10 s (default 60 s)
        ports:
        - containerPort: 5000
        volumeMounts:
        - name: code
          mountPath: /code
      volumes:
      - name: code
        configMap:
          name: shop-code
---
apiVersion: v1
kind: Service
metadata:
  name: gateway
  namespace: shop
spec:
  selector:
    app: gateway
  ports:
  - port: 5000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: order-service
  template:
    metadata:
      labels:
        app: order-service
    spec:
      containers:
      - name: app
        image: python:3.12-slim
        command: ["sh", "-c"]
        args:
        - |
          set -e
          pip install -q flask requests opentelemetry-distro opentelemetry-exporter-otlp
          opentelemetry-bootstrap -a install
          exec opentelemetry-instrument python /code/order.py
        env:
        - name: INVENTORY_URL
          value: http://inventory-service:5002
        - name: OTEL_SERVICE_NAME
          value: order-service
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: http://otel-collector.observability:4317
        - name: OTEL_EXPORTER_OTLP_PROTOCOL
          value: grpc
        - name: OTEL_TRACES_EXPORTER
          value: otlp
        - name: OTEL_METRICS_EXPORTER
          value: otlp
        - name: OTEL_LOGS_EXPORTER
          value: none
        - name: OTEL_METRIC_EXPORT_INTERVAL
          value: "10000"
        ports:
        - containerPort: 5001
        volumeMounts:
        - name: code
          mountPath: /code
      volumes:
      - name: code
        configMap:
          name: shop-code
---
apiVersion: v1
kind: Service
metadata:
  name: order-service
  namespace: shop
spec:
  selector:
    app: order-service
  ports:
  - port: 5001
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: inventory-service
  namespace: shop
spec:
  replicas: 1
  selector:
    matchLabels:
      app: inventory-service
  template:
    metadata:
      labels:
        app: inventory-service
    spec:
      containers:
      - name: app
        image: python:3.12-slim
        command: ["sh", "-c"]
        args:
        - |
          set -e
          pip install -q flask requests opentelemetry-distro opentelemetry-exporter-otlp
          opentelemetry-bootstrap -a install
          exec opentelemetry-instrument python /code/inventory.py
        env:
        - name: OTEL_SERVICE_NAME
          value: inventory-service
        - name: OTEL_EXPORTER_OTLP_ENDPOINT
          value: http://otel-collector.observability:4317
        - name: OTEL_EXPORTER_OTLP_PROTOCOL
          value: grpc
        - name: OTEL_TRACES_EXPORTER
          value: otlp
        - name: OTEL_METRICS_EXPORTER
          value: otlp
        - name: OTEL_LOGS_EXPORTER
          value: none
        - name: OTEL_METRIC_EXPORT_INTERVAL
          value: "10000"
        ports:
        - containerPort: 5002
        volumeMounts:
        - name: code
          mountPath: /code
      volumes:
      - name: code
        configMap:
          name: shop-code
---
apiVersion: v1
kind: Service
metadata:
  name: inventory-service
  namespace: shop
spec:
  selector:
    app: inventory-service
  ports:
  - port: 5002
```

| Line | Meaning |
|---|---|
| `pip install ... opentelemetry-distro opentelemetry-exporter-otlp` | The OTel SDK + the OTLP exporter |
| `opentelemetry-bootstrap -a install` | Detects Flask and requests and installs their instrumentation libraries |
| `opentelemetry-instrument python app.py` | **Auto-instrumentation:** starts the app with tracing and metrics turned on, no code change |
| `OTEL_SERVICE_NAME` | The name you'll see in Jaeger (`gateway`, `order-service`, `inventory-service`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Send OTLP to the Collector in the `observability` namespace, port 4317 (gRPC) |
| `OTEL_LOGS_EXPORTER: none` | Keep the lab to traces + metrics |

> **Real time:** you'd build the dependencies into the image (Dockerfile, Day 32), not `pip install` at startup. Here it's done at startup so the lab needs no image registry. The nodes need internet access (NAT gateway) for pip.

**Step 5: Apply it**

```bash
kubectl apply -f shop.yaml
```

**Step 6: Wait until all 3 are ready** (pip install takes about a minute)

```bash
kubectl get pods -n shop -w
```

**Expected:** `gateway`, `order-service`, `inventory-service` all `1/1 Running` ✅. Press `Ctrl+C`.

**Step 7: Send 20 checkout requests**

```bash
kubectl run curl -n shop --rm -it --restart=Never --image=curlimages/curl:8.11.1 -- sh -c 'for i in $(seq 1 20); do curl -s "http://gateway:5000/checkout?item=laptop"; echo; done'
```

**Expected:** 20 × `{"item":"laptop","status":"order placed"}` ✅

**Step 8: Send one slow, one out-of-stock and one failing request**

```bash
kubectl run curl -n shop --rm -it --restart=Never --image=curlimages/curl:8.11.1 -- sh -c 'for item in tv phone boom; do curl -s "http://gateway:5000/checkout?item=$item"; echo; done'
```

**Expected:** `order placed` (after ~2 s), `out of stock`, `inventory failed` ✅

**Step 9: Open Jaeger** (port-forward + SSH tunnel as in [Lab D](#17-lab-d-follow-the-request-in-the-jaeger-ui)), then **Service:** `gateway` → **Find Traces**.

**Expected:** traces named **`gateway: GET /checkout`**, each with **7 spans**: `gateway (2)`, `order-service (3)`, `inventory-service (2)` ✅

**Step 10: Click one trace and read the waterfall**

```
 gateway            GET /checkout ............................ 180 ms   (root span: the incoming request)
 gateway             └─ POST ................................. 170 ms   (requests call to order-service)
 order-service           └─ POST /orders ..................... 165 ms
 order-service               ├─ validate-order ...............   0.1 ms (manual span)
 order-service               └─ GET .......................... 150 ms   (requests call to inventory)
 inventory-service               └─ GET /stock/<item> ........ 145 ms
 inventory-service                   └─ db-lookup ............ 140 ms   (manual span)
```

This is **one request travelling through 3 services**, joined into **one trace** by the `traceparent` header that the instrumented `requests` library adds automatically.

**Step 11: Investigate like a DevOps engineer**

| Exercise | How | What you find |
|---|---|---|
| **Find the delay** | Set **Min Duration** `1s` → Find Traces → open the `tv` trace | The 2 s is in **`inventory-service` → `db-lookup`**: the "slow DB query" |
| **Find the failure** | **Tags:** `error=true` → Find Traces → open the `boom` trace | Red spans; the deepest red one is **`db-lookup`** in `inventory-service` (status `db down`); the others fail because of it |
| **Business "no" vs error** | Open the `phone` trace | `http.status_code=409`, but **not** red: a 4xx is the client's problem, not a server error |
| **See the service map** | **System Architecture** tab | `gateway → order-service → inventory-service`, built from the traces |

---

## 19. Lab F: Send metrics to Prometheus

The Python services already send **metrics** (request count and duration) to the Collector; right now they only go to the `debug` exporter. Now we send them to **Prometheus**, and add a processor that puts a `team` attribute on every span.

```
 shop services ──OTLP──► otel-collector ──► traces  ──► Jaeger        (+ team=shop attribute)
                                        └─► metrics ──► Prometheus :9090  (OTLP push)
```

**Step 1: Create the file `prometheus.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: observability
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: prometheus
  namespace: observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: prometheus
  template:
    metadata:
      labels:
        app: prometheus
    spec:
      containers:
      - name: prometheus
        image: prom/prometheus:v3.1.0
        args:
        - --config.file=/etc/prometheus/prometheus.yml
        - --web.enable-otlp-receiver          # accept OTLP metrics on /api/v1/otlp
        ports:
        - containerPort: 9090
        volumeMounts:
        - name: config
          mountPath: /etc/prometheus
      volumes:
      - name: config
        configMap:
          name: prometheus-config
---
apiVersion: v1
kind: Service
metadata:
  name: prometheus
  namespace: observability
spec:
  selector:
    app: prometheus
  ports:
  - port: 9090
```

**Step 2: Apply it**

```bash
kubectl apply -f prometheus.yaml
```

**Step 3: Update `collector-values.yaml`**

```yaml
mode: deployment
fullnameOverride: otel-collector
image:
  repository: otel/opentelemetry-collector-k8s

config:
  processors:
    attributes/team:
      actions:
      - key: team
        value: shop
        action: insert           # add team=shop to every span
  exporters:
    otlp/jaeger:
      endpoint: jaeger.observability.svc.cluster.local:4317
      tls:
        insecure: true
    otlphttp/prometheus:
      endpoint: http://prometheus.observability.svc.cluster.local:9090/api/v1/otlp
      tls:
        insecure: true
  service:
    pipelines:
      traces:
        processors: [memory_limiter, attributes/team, batch]
        exporters: [debug, otlp/jaeger]
      metrics:
        exporters: [debug, otlphttp/prometheus]
```

| New part | Meaning |
|---|---|
| `processors.attributes/team` | A **processor** that adds `team=shop` to every span (real time: add `env`, remove passwords, etc.) |
| `exporters.otlphttp/prometheus` | Send metrics over **OTLP/HTTP** to Prometheus; the exporter adds `/v1/metrics` to the path |
| `traces.processors` | `memory_limiter` first, `batch` last, our processor in the middle |
| `metrics.exporters` | Metrics now go to Prometheus (and still to `debug`) |

> **Remember:** defining `attributes/team` or `otlphttp/prometheus` alone does nothing. **Nothing runs unless it appears in a pipeline.**

**Step 4: Upgrade the Collector**

```bash
helm upgrade otel-collector open-telemetry/opentelemetry-collector -n observability -f collector-values.yaml
```

**Step 5: Check the new pipelines**

```bash
kubectl get configmap otel-collector -n observability -o yaml | grep -A12 'pipelines:'
```

**Expected:** `metrics` has `otlphttp/prometheus`; `traces` has `attributes/team` ✅

**Step 6: Send traffic again** (same as Lab E Step 7)

```bash
kubectl run curl -n shop --rm -it --restart=Never --image=curlimages/curl:8.11.1 -- sh -c 'for i in $(seq 1 50); do curl -s "http://gateway:5000/checkout?item=laptop" > /dev/null; done; echo done'
```

**Step 7: On the bastion, port-forward Prometheus**

```bash
kubectl port-forward svc/prometheus 9090:9090 -n observability
```

**Step 8: On your laptop, open an SSH tunnel**

```bash
ssh -L 9090:localhost:9090 ec2-user@<bastion-public-ip>
```

**Step 9: Open Prometheus in the laptop browser**

```
http://localhost:9090
```

**Step 10: Find the HTTP metrics** — in the query box type `http_server` and pick from the autocomplete, or list them:

```promql
count by (__name__) ({__name__=~"http_server.*"})
```

**Expected:** metrics like `http_server_duration_milliseconds_count` / `_bucket` ✅ (the exact name depends on the instrumentation version). The `job` label = the `service.name` (`gateway`, `order-service`, `inventory-service`).

**Step 11: Requests per second per service**

```promql
sum by (job) (rate(http_server_duration_milliseconds_count[1m]))
```

**Expected:** one line per service ✅. **Metrics tell you _what_ is happening** (rate, latency, errors); when a number looks bad, open **Jaeger** to see **_where_** the time went.

**Step 12: Check the processor worked** — in Jaeger open any new `gateway` trace and click a span.

**Expected:** tag `team=shop` on every span ✅

> **Two ways to get OTel metrics into Prometheus:**
>
> | Way | How |
> |---|---|
> | **Push (this lab)** | Collector `otlphttp` exporter → Prometheus with `--web.enable-otlp-receiver` (or `prometheusremotewrite`) |
> | **Pull (scrape)** | Collector `prometheus` exporter opens `:8889/metrics` and Prometheus scrapes it (use the `-contrib` Collector image, which always includes it) |

---

## 20. Clean up

```bash
kubectl delete namespace shop
```

```bash
helm uninstall otel-collector -n observability
```

```bash
kubectl delete namespace observability
```

---

# Wrap-up

## 21. Troubleshooting

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
| Shop Pods restart or stay not ready for a while | `pip install` at startup is slow or nodes have no internet | Wait ~1 min; check `kubectl logs deploy/gateway -n shop`; nodes need a NAT gateway (real time: bake deps into the image) |
| Jaeger shows only `gateway` spans, no `order-service` | Order Pod not instrumented, or wrong `ORDER_URL` | Check the order Pod logs and that it starts with `opentelemetry-instrument` |
| Collector logs: `otlphttp/prometheus ... 404` | Prometheus started without the OTLP receiver | Add `--web.enable-otlp-receiver` to Prometheus args |
| No `http_server*` metrics in Prometheus | `metrics` pipeline doesn't include the exporter, or not enough time passed | Check the pipeline in the ConfigMap; metrics are sent every 10 s (`OTEL_METRIC_EXPORT_INTERVAL`) |
| A processor or exporter has no effect | Defined but not listed in `service.pipelines` | Nothing runs unless it's in a pipeline |

---

## 22. What I learned

**Concepts**
- **Telemetry** = the data; **monitoring** = what is wrong + alerts; **observability** = why it happened (RCA, debugging).
- **OpenTelemetry** = standard way to **collect, process and export** traces, metrics and logs. **Not a dashboard.**
- **Metrics** tell **what** is happening, **traces** tell **where** the time is spent, **logs** tell **what happened in detail**.
- A **trace** is the end-to-end request; a **span** is one operation in it. **Root span** = the incoming request, **child spans** = the calls it makes, **span events** = retries/exceptions inside a span. The `traceparent` header carries the trace ID between services.
- Architecture: **Application → Instrumentation → SDK → Collector → Backend.**
- **OTLP** = the transport protocol: **4317 gRPC, 4318 HTTP**, paths `/v1/traces`, `/v1/metrics`, `/v1/logs`.
- **Collector** = the "controller": receivers → processors → exporters (+ connectors), wired by pipelines per signal. **Nothing runs unless it's in a pipeline.** Change backends without touching apps.
- One job each: OTel **collects**, Prometheus **metrics**, Jaeger/Tempo **traces**, Loki **logs**, Grafana **visualizes**, Alertmanager **alerts**.
- **Agent** (DaemonSet) + **gateway** (Deployment) is the common Kubernetes setup.
- The **OTel Operator** auto-instruments Pods with one annotation.
- Backends: Prometheus (metrics), Jaeger/Tempo (traces), Loki (logs), Grafana (UI), or a vendor.

**Lab**
- Collector via Helm, Jaeger as backend, `telemetrygen` for test traces, `debug` exporter to confirm data flows.
- A 3-service Python shop auto-instrumented with `opentelemetry-instrument`: one `GET /checkout` = **one trace with 7 spans** across 3 services.
- Found the **slow** service (`db-lookup` 2 s) and the **failing** one (`error=true`) in Jaeger.
- Sent metrics to **Prometheus** over OTLP and added a `team` attribute with a processor.

```
 App ──OTLP──► Collector ──► Jaeger / Tempo · Prometheus · Loki ──► Grafana
```

## 23. Commands

| Command | What it does |
|---|---|
| `helm install otel-collector open-telemetry/opentelemetry-collector -n NS -f values.yaml` | Install a Collector |
| `kubectl logs deploy/otel-collector -n NS` | See received data (debug exporter) and errors |
| `kubectl get cm otel-collector -n NS -o yaml` | See the Collector config |
| `telemetrygen traces --otlp-endpoint=HOST:4317 --otlp-insecure --traces=5` | Send test traces |
| `kubectl port-forward svc/jaeger 16686:16686 -n NS` | Open the Jaeger UI |
| `opentelemetry-instrument python app.py` | Auto-instrument a Python app |
| `java -javaagent:opentelemetry-javaagent.jar -jar app.jar` | Auto-instrument a Java app |
| `opentelemetry-bootstrap -a install` | Install instrumentation libraries for the Python packages it finds |
| `helm upgrade otel-collector open-telemetry/opentelemetry-collector -n NS -f values.yaml` | Apply a changed Collector config |
| `kubectl port-forward svc/prometheus 9090:9090 -n NS` | Open the Prometheus UI |
| `sum by (job) (rate(http_server_duration_milliseconds_count[1m]))` | PromQL: requests per second per service |

## 24. Interview Questions

### ⭐ Very Important

**Q1. What problem does OpenTelemetry solve?**
In microservices, one request passes through many services (frontend → order → payment → inventory → database). When it's slow, separate dashboards and logs can't show which service is the problem. OpenTelemetry tracks each request end to end with a trace ID and shows the time spent in each service, for example "payment took 6.5 s of 8 s". In one word: visibility.

**Q2. What is observability, and how is it different from monitoring?**
Observability is the ability to understand a system's internal behavior from the data it produces (logs, metrics, traces). Monitoring tells you **what** is wrong and sends alerts (CPU above 90%, error rate up). Observability sits on top and tells you **why** (a slow database query is blocking requests), so we can do root cause analysis and debugging.

**Q3. What is OpenTelemetry?**
A standard, vendor-neutral way to collect, process and export application telemetry (traces, metrics and logs) so we can understand application behavior and troubleshoot production problems. It provides APIs, SDKs, auto-instrumentation and the Collector.

**Q4. What are traces, metrics and logs?**
Metrics tell you **what** is happening (request rate, error rate, CPU, memory over time). Traces tell you **where** the time is spent (the journey of one request across services). Logs tell you **what happened in detail** (timestamped events with level, service, trace ID and message).

**Q5. Is OpenTelemetry a monitoring dashboard?**
No. It's the instrumentation and telemetry infrastructure. It sends data to systems that store, analyze, visualize and alert on it, like Prometheus, Grafana, Jaeger, Tempo, Loki or commercial platforms.

**Q6. What is the OpenTelemetry flow?**
Instrument the app (SDK or auto-instrumentation) → Collect (Collector receivers, OTLP) → Process (batch, sample, add Kubernetes metadata, remove sensitive data) → Export to backends.

**Q7. Explain the OpenTelemetry architecture.**
Five parts: the **application**; **instrumentation** (auto via agents or manual API calls); the **SDK** inside the app (sampling, processing, batching, exporting); the **Collector** (receive, process, export); and the **backend** (Prometheus, Grafana, Jaeger, Tempo, Loki or a vendor) that stores, analyzes, visualizes and alerts.

**Q8. What is a span? Root span vs child span vs span event?**
A span is one operation within a trace (an HTTP request, a SQL query, a payment API call, a Kafka publish). It has a trace ID, span ID, parent span ID, start/end time, attributes, events and status. The root span is the top-level operation with no parent (the incoming request); child spans are nested operations done for it. A span event is a timestamped event inside a span (a retry, an exception), not a separate span.

**Q9. What is the OpenTelemetry Collector and why use it?**
A telemetry "traffic controller" between apps and backends. It receives telemetry (receivers), processes it (batch, enrich, filter, transform: processors) and routes it to one or more backends (exporters), wired into pipelines; connectors link one pipeline to another. Apps send to one place, and we can change or add backends, sample and filter without redeploying apps.

**Q10. What is OTLP? Which ports and paths?**
The OpenTelemetry Protocol, the standard way to transmit telemetry between apps, Collectors and backends. OTLP/gRPC on 4317 and OTLP/HTTP on 4318, with HTTP paths `/v1/traces`, `/v1/metrics` and `/v1/logs`. These are defaults, set by the receiver/exporter config. OTLP standardizes transport; it doesn't define how a backend stores or visualizes the data.

**Q11. OpenTelemetry vs Prometheus vs Grafana vs Jaeger?**
OpenTelemetry **collects** and exports telemetry. Prometheus stores and queries **metrics** (PromQL, alert rules). Grafana **visualizes** metrics, logs and traces but stores nothing. Jaeger stores and shows **traces** (Tempo is another trace store, Loki stores logs, Alertmanager routes Prometheus alerts). They work together: OTel sends traces to Jaeger and metrics to Prometheus, and Grafana shows them all.

### Other Questions

**Q12. How does a trace continue across microservices?**
Context propagation: the instrumented HTTP or messaging client adds the W3C `traceparent` header with the trace ID and parent span ID, and the next service continues the same trace.

**Q13. Automatic vs manual instrumentation?**
Automatic attaches an agent and traces frameworks (HTTP, DB, queues) with no code changes. Manual uses the OTel API to add business spans and attributes. In real projects we start with automatic and add manual spans for important flows.

**Q14. How do you instrument apps on Kubernetes without changing images?**
Install the OpenTelemetry Operator, create an `Instrumentation` resource with the Collector endpoint and sampler, and add `instrumentation.opentelemetry.io/inject-<language>: "true"` to the Pod template. The Operator injects the agent and `OTEL_*` variables.

**Q15. Agent vs gateway Collector?**
Agent: a DaemonSet, one per node, close to the apps, collects node logs and metrics and adds metadata. Gateway: a central Deployment that does tail sampling and exports to backends. Production often uses both.

**Q16. Head vs tail sampling?**
Head sampling decides at the start of a request in the app (e.g. keep 10%). Tail sampling decides in the Collector after the trace finishes, so it can keep all errors and slow traces and drop most normal ones.

**Q17. How does OpenTelemetry avoid vendor lock-in?**
Apps are instrumented with the open OTel standard and send OTLP to the Collector. Switching from, say, Jaeger to Datadog only changes the Collector's exporter config, not the application code.

**Q18. How would you troubleshoot a slow checkout with OpenTelemetry?**
A metric alert shows high checkout latency; open a slow trace for the checkout endpoint (filter by min duration) and find the longest span (e.g. inventory's `db-lookup` or payment's MySQL query); then filter logs by that trace ID to see the exact error or cause.

**Q19. How do you get OpenTelemetry metrics into Prometheus?**
Push: the Collector's `otlphttp` exporter sends to Prometheus's OTLP endpoint (`--web.enable-otlp-receiver`) or uses `prometheusremotewrite`. Pull: the Collector's `prometheus` exporter exposes `/metrics` on a port and Prometheus scrapes it.

**Q20. I added an exporter to the Collector config but no data reaches the backend. Why?**
It's probably not listed in `service.pipelines`. A receiver, processor or exporter only runs when a pipeline uses it. Also check the Collector logs for export errors (wrong endpoint, TLS).

**Source:** [OpenTelemetry docs](https://opentelemetry.io/docs/) · [Collector configuration](https://opentelemetry.io/docs/collector/configuration/) · [OpenTelemetry Operator](https://opentelemetry.io/docs/platforms/kubernetes/operator/) · [Collector Helm chart](https://github.com/open-telemetry/opentelemetry-helm-charts) · [Jaeger](https://www.jaegertracing.io/docs/)
