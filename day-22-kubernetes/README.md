# Kubernetes

Daily notes:

- [Day 22 — Kubernetes: what and why, architecture, Pods, ReplicaSet, Deployment, multi-container pods (init, sidecar, ambassador, adapter), Job, CronJob](./day-22-k8s-intro/README.md)
- [Day 23 — EKS with Terraform modules (VPC, EKS, bastion), introduction to Helm, installing Argo CD with Helm](./day-23-eks-terraform-helm-argocd/README.md)
  - [Autoscaling on EKS: HPA (Pods), Metrics Server, node groups, Cluster Autoscaler, Karpenter, Auto Mode, HPA lab](./day-23-eks-terraform-helm-argocd/autoscaling-hpa-nodes/README.md)
- [Day 24 — Probes: startup (boot check), liveness (self-healing) and readiness (traffic control); Falco runtime security, probe types, timing settings](./day-24-probes/README.md)
- [Day 25 — Networking: CNI (Pod IPs), CoreDNS (Service names), Services (why they matter, ClusterIP, NodePort, LoadBalancer, Ingress, production traffic flow), nslookup, Network Policies (frontend → backend → db lab), default deny and egress with DNS](./day-25-dns-network-policy/README.md)
- [Day 25 — Services: why we need them, ClusterIP vs NodePort vs LoadBalancer, Ingress (ALB / NGINX), what production uses, how traffic reaches a Pod, EKS lab](./day-25-services-types-and-traffic-flow/README.md)
- [Day 26 — Scheduling and Ingress rules: node labels, nodeSelector, node affinity (required / preferred, operators), taints and tolerations, dedicated nodes, host and path routing, pathType, NGINX rewrite, EKS lab](./day-26-taints-node-affinity-ingress-rules/README.md)
