# Day 7 - Interview Questions (Provisioners)

[← Back to Day 7 notes](../README.md)

**1. What is a provisioner in Terraform?**

A block inside a resource that runs a command or script after the resource is created (or before it is destroyed). Used for one-time setup Terraform has no resource for.

**2. What are the types of provisioners?**

`local-exec` (runs on the Terraform machine), `remote-exec` (runs on the server over SSH/WinRM) and `file` (copies files to the server). Vendor provisioners like chef/puppet were removed in 0.15.

**3. Why does HashiCorp call provisioners a "last resort"?**

They aren't shown in `plan`, aren't tracked in state, run only once, need SSH access, and Terraform can't tell what they changed. `user_data`, Packer or Ansible do the job more reliably.

**4. Which provisioners need a `connection` block?**

`remote-exec` and `file`. `local-exec` runs locally, so it doesn't need one.

**5. What is `self` and why use it?**

`self` refers to the parent resource inside its own provisioner or connection block (`self.public_ip`). Using `aws_instance.web.public_ip` inside `aws_instance.web` causes a cycle error.

**6. Do provisioners run on every `terraform apply`?**

No. Creation-time provisioners run only once, when the resource is created. Changing the provisioner code later doesn't re-run it.

**7. How do you run a provisioner again on an existing server?**

`terraform apply -replace="aws_instance.web"` recreates the resource, so its provisioners run again. Or move the provisioner into a `terraform_data` resource with `triggers_replace`.

**8. What happens when a creation-time provisioner fails?**

With the default `on_failure = fail`, apply errors and the resource is marked tainted. The next apply destroys and recreates it. With `on_failure = continue`, the error is ignored.

**9. What is a destroy-time provisioner?**

A provisioner with `when = destroy`. It runs before the resource is destroyed (e.g. remove the server from an inventory, take a backup). It can only reference `self`, `count.index` and `each.key`.

**10. You removed a resource block that had a destroy-time provisioner. Does it run?**

No. The provisioner is removed with the block, so it never runs. Run `terraform destroy -target=...` first, then remove the block.

**11. inline vs script vs scripts in remote-exec?**

`inline` = a list of commands. `script` = one local script copied to the server and run. `scripts` = a list of local scripts run in order. Use only one per provisioner.

**12. What is `terraform_data` vs `null_resource`?**

Both create no real infra and are used to hold provisioners. `terraform_data` is built in (Terraform 1.4+) and uses `triggers_replace`. `null_resource` needs the `hashicorp/null` provider and uses `triggers`. Use `terraform_data` today.

**13. user_data vs remote-exec to install nginx?**

`user_data` runs on the server at first boot: no SSH, no open port 22 for Terraform, and it's an argument tracked in state. `remote-exec` needs SSH from the Terraform machine and isn't tracked. Prefer `user_data`.

**14. remote-exec times out with "timeout - last error: dial tcp ...:22". What do you check?**

The security group allows port 22 from the Terraform machine, the instance has a public IP (or the runner can reach the private IP), the `host`/`user`/key or password are correct, and the server has finished booting (increase `timeout`).

**15. How would Terraform and Ansible work together using a provisioner?**

Terraform creates the servers, a `local-exec` writes their IPs to an inventory file (or runs `ansible-playbook` with them), and Ansible configures the servers. Terraform creates, Ansible configures.

**16. You added a destroy-time provisioner and now `plan` fails on your `connection` block's `private_key = tls_private_key.web.private_key_openssh`. Why?**

When a resource has a destroy-time provisioner, its connection block can only reference `self`, `count.index` and `each.key`. `tls_private_key.web` is another resource. Fix: create the key outside Terraform (`ssh-keygen`) and read it with `file()`. I hit this in my KodeKloud lab.

**17. remote-exec vs user_data vs custom AMI?**

remote-exec runs after launch and needs SSH. user_data runs at first boot with no SSH. A custom AMI (Packer or EC2 Image Builder) already has the software, so nothing runs at launch, which is fastest and most consistent for autoscaling.
