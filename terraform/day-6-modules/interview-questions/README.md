# Day 6 - Interview Questions (Modules)

[← Back to Day 6 notes](../README.md)

**1. What is a Terraform module?**

A folder of `.tf` files that groups related resources managed together. Like a function: write once, call many times with different inputs.

**2. Why do we use modules?**

Reuse (no copy-paste per environment), consistency (same tags, encryption, security rules), cleaner code, and versioning.

**3. Root module vs child module?**

Root module = the folder where you run `terraform init / plan / apply`. Child module = a module called by another module with a `module` block.

**4. How do you pass values into a module and get values out?**

In: arguments in the `module` block, declared as `variable` in the child. Out: `output` blocks in the child, read as `module.<name>.<output>`.

**5. Can the root module read a child module's variables directly?**

No. The root can only read what the child exposes as an **output**. A child also can't read the root's variables; they must be passed as arguments.

**6. Where are modules stored after `terraform init`?**

Remote modules are downloaded into `.terraform/modules/`. Provider plugins go to `.terraform/providers/`. Local modules are used from their own folder.

**7. Is `version` mandatory for a module?**

No. Without it you get the latest version, which can break later. In real time always pin it: `version = "5.13.0"` for Registry, `?ref=v1.2.0` for Git.

**8. What are the different module sources?**

Local path, Terraform Registry, GitHub/Git, HTTP URL, S3 bucket.

**9. You changed a module's `source` or `version`. What must you run?**

`terraform init` again (or `terraform get`), so Terraform downloads the new module code.

**10. What are the rules to publish a public module?**

Public GitHub repo, name `terraform-<provider>-<name>` (e.g. `terraform-aws-ec2`), a description, standard structure (`main.tf`, `variables.tf`, `outputs.tf`, `README.md`), and `x.y.z` release tags.

**11. How do you upgrade a module version safely in real time?**

Bump the version in dev first → `plan` and test → then test/prod. Read the changelog; a MAJOR version change can break inputs.

**12. When should you NOT create a module?**

When it only wraps one resource, or for a one-time small setup. Extra layers make code harder to follow.
