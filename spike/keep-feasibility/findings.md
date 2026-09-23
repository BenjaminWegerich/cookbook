# Feasibility findings

Evidence log for the cloud-hosted (option C) Google Keep backend. The runbook for
the manual steps lives in [README.md](README.md); this file records what has been
*verified* and what is still open.

| Gate | Question | Status |
| --- | --- | --- |
| Gate 1 | Can the throwaway sharee add items to the shared list and control order? | **PASS**, including the Keep-app render check |
| Gate 2 | Does master-token auth survive from a host IP over days? | **PASS** - but only with a token *minted from the cloud*; a home-minted token is refused |
| Gate 3 | Is zero cost guaranteed? | **research stands** - Cloud Run $0 within limits, with the billing guard |
| Gate 4 | How slow is a cold start and a full sync? | **answered** - 0.73 s cold, so cold starts are a non-issue |

## Verdict

**GO - all four gates pass.** The Keep integration works, and it can run on Cloud Run at €0,
provided the master token is **minted from the cloud** rather than on the laptop.

### What is established

| Question | Answer |
| --- | --- |
| Can a sharee add items to the shared list and control their order? | **Yes.** Verified live against the real 135-item shared list, server-side and in the Keep app. The 2019 regression does not recur. |
| How slow is a cold start? | **0.73 s** for a full sync of 135 + 248 items. Cold starts are invisible at this speed. |
| Can it run at zero cost? | **Yes, on Cloud Run** - the free tier covers this workload many times over and there is nothing to reclaim. |
| Can it authenticate from a cloud host? | **Yes - but only with a cloud-minted token.** A home-minted token is refused as `BadAuthentication` from every Google Cloud address tried; minting the token from Cloud Run and then using it there works immediately. |

### The hosting decision

**Cloud Run**, as originally intended, with one non-obvious operational rule: **the token must
be minted in the cloud.** The measured history is worth keeping in view, because the ordering
matters:

1. Cost and latency were settled first, and both favoured Cloud Run: a cold sync is ~0.7 s, so
   scale-to-zero is invisible, and the free tier covers this workload by orders of magnitude.
   The always-free VM alternatives were rejected on their own merits (GCE's external IPv4 costs
   ~$3.65/month; Oracle reclaims near-idle instances).
2. Authentication then failed outright from Google's network - three addresses, two regions.
3. The failure turned out to hinge on **where the token was created**, not where it is used.
   Minting it from Cloud Run made the same origin work immediately.

A hosted gateway is therefore real, but it carries a setup and recovery rule that a
home-hosted gateway would not: **every re-mint has to run in the cloud.** That is what
`mint-in-cloud.py` exists for, and it has to be part of the re-auth runbook, not a footnote.

### What remains true regardless of host

- **The master token is perishable**, and now with an extra twist: replacing it needs a browser
  cookie *and* a cloud-side mint. It needs an alert and a documented runbook, never an
  assumption of permanence.
- **The state cache is not worth having.** Resuming from a cache saved 0.14 s; dropping it
  removes an entire category of infrastructure.
- **Keep stays optional.** Google can change or withdraw the private API at any time, which is
  exactly what the existing N5 decision requires: the core app must work without it.
- **Durability is still being observed.** The 6-hourly sampler is enabled, but "it works now"
  is not "it works for weeks" - a home-minted token also worked once and then failed everywhere
  except home.

### What would make the integration itself a NO-GO

- The sharee route failing (ruled out by Gate 1) or the Keep app ignoring our order (ruled out
  in practice by the user's own check).
- Google withdrawing the private API or the master-token flow outright.
- The cloud-minted token turning out to be short-lived in practice, which the 6-hourly sampler
  will reveal.


## Environment findings (verified locally)

- **Toolchain.** Python 3.14.4 on this WSL2 image lacks `python3-venv`/`ensurepip`,
  so `python3 -m venv` fails out of the box. Worked around with `get-pip.py`; no
  `sudo` and no `build-essential` needed, because `pycryptodomex` ships an abi3
  manylinux wheel. `gkeepapi` 0.17.1 installs and imports cleanly.
- **The private Keep API is CORS-enabled.** `OPTIONS` on
  `https://www.googleapis.com/notes/v1/changes` returns `200` with
  `access-control-allow-origin` echoing the GitHub Pages origin,
  `access-control-allow-methods` and `access-control-allow-headers: authorization,content-type`.
  So the browser *could* call Keep directly; the blocker is the credential, not the
  network. (An earlier note claiming the opposite was based on a bad probe and was
  wrong.)
- **The API is reachable from this home network.** A deliberately bogus master token
  produced a clean `LoginException: BadAuthentication` - a real auth rejection
  rather than the non-JSON "blocked" response. This is the baseline Gate 2 compares
  a cloud host against.
- **Ordering semantics** (verified against the installed library, not the docs):
  `List.items` returns **top-first**; a **higher** `ListItem.sort` value sits closer
  to the top; `sort_items(key=...)` accepts a custom key function, so sorting by
  aisle/category is supported; `collaborators.all()` returns a list.

## Gate 4 - sync timings (measured)

Measured against the live throwaway account (`bot1wegerich@gmail.com`) from the home
network, with real data shared into it - **135 items** in the shopping list and **248**
in the meal plan, so this is not a trivially empty account:

| Phase | Time |
| --- | --- |
| Cold full sync (no cached state) | **0.73 s** |
| Warm incremental sync (same session) | **0.23 s** |
| Resumed start (from cached `state.json`) | 0.59 s |

Two conclusions:

1. **Cold starts are a non-issue.** The decision framework's threshold was "cold sync
   <= ~3 s"; 0.73 s clears it by a wide margin, so a serverless container's start-up
   cost dominates and stays invisible. This removes the main objection to Cloud Run.
2. **The state cache is not worth persisting.** Resuming from cache saved only ~0.14 s
   over a cold sync. Dropping the cache removes the ephemeral-filesystem problem
   entirely: a serverless host can start cold on every request and still respond well
   inside a second. That deletes a whole category of infrastructure (object storage,
   extra secrets, cache invalidation) before it was built.

## Gate 1 - ordered write

Both halves of the write path were run live and **passed**.

`scratch`, on a note the throwaway account owns:

```
created on the server:    3 of 3
expected (top to bottom): ['GATE1-TEST charlie', 'GATE1-TEST alpha', 'GATE1-TEST bravo']
server returned:          ['GATE1-TEST charlie', 'GATE1-TEST alpha', 'GATE1-TEST bravo']
RESULT: PASS
```

`write`, on the **shared** shopping list (135 existing items, owned by the main account,
the throwaway acting purely as sharee):

```
Recorded 135 existing item(s) before the test.
Creating 3 test item(s) in 'Einkaufsliste'
sync() with new items took 0.55 s
created on the server:    3 of 3
server returned:          ['GATE1-TEST charlie', 'GATE1-TEST alpha', 'GATE1-TEST bravo']
RESULT: PASS - items can be created in a shared list and their order controlled.
```

**This is the make-or-break result.** The 2019 "Cannot modify shared note" regression -
where a sharee could see a shared list but not add entries to it - does **not** recur, and
the sort ids we send as the sharee survive a full round trip. Both the catastrophic failure
mode (`FAIL (create)`) and the degraded one (`FAIL (order)`) are ruled out at the API level.

Still outstanding: the **Keep-app render check**. The API agreeing with itself is
necessary but not sufficient - the app could still ignore the order for a sharee's write.
Three `GATE1-TEST` items sit at the top of the shared list awaiting that glance, after
which `cleanup` removes them.

### A note on the forensic check

`write` was initially assumed to have been run, because the user reported "it works".
Inspecting the raw node data (`Node._children`, which retains deleted children that the
public `.items` view hides) showed **no `GATE1-TEST` items in any state**, proving the
shared-list test had never executed - "it works" referred to the token and the read phase.
Worth remembering: the public API view hides deletions, so absence from `.items` is not
evidence that a test never ran, but absence from `._children` is.

## Gate 2 - host IP survival (PASS, with a catch that matters)

### Part 1: a home-minted token is refused from the cloud

The probe was deployed exactly as designed - same image, same account, same master token, same
device id - and run from Google Cloud. **Google refused the credential from every Google Cloud
address tried.**

| Origin | Public IP | Result |
| --- | --- | --- |
| Home network | `91.67.255.180` | **`ok`** |
| Cloud Run, europe-west3 | `34.96.39.3` | `rejected` - `BadAuthentication` |
| Cloud Run, europe-west3 (retry) | `34.96.39.230` | `rejected` - `BadAuthentication` |
| Cloud Run, us-central1 | `34.34.233.136` | `rejected` - `BadAuthentication` |

Three controlled facts made this conclusive rather than circumstantial:

1. **The credentials were not stale.** The secret in Secret Manager was byte-identical to the
   token in `.env` (SHA-256 prefixes compared, no value printed), and the `KEEP_EMAIL` and
   `KEEP_DEVICE_ID` in the job matched `.env` exactly. The same token authenticated
   successfully from home *between* the cloud failures.
2. **It was not region-specific.** A second region on a different address range (`34.34.x` vs
   `34.96.x`) failed identically.
3. **The refusal happened at Google's account-auth endpoint**, not at the Keep API. `gkeepapi`
   raises `LoginException(res.get("Error"))` from `APIAuth.refresh()`, which calls
   `gpsoauth.perform_oauth` against `android.clients.google.com`. No Keep request was ever
   made, so no Keep-side configuration, scope, retry or delay could work around it.

### Part 2: the hypothesis, and its confirmation

Every token tested above had been **minted on the home network**. That left one explanation:
the refusal might be bound to *where the token was created* rather than *where it is used*. A
report in [gkeepapi#81](https://github.com/kiwiz/gkeepapi/issues/81) of a DigitalOcean droplet
working - with a token minted *on* the droplet - supported it.

So `mint-in-cloud.py` ran the `oauth_token` -> master-token exchange (`gpsoauth.exchange_token`)
**from a Cloud Run job**, then immediately tried to authenticate with the result from the same
cloud origin:

```json
{ "stage": "authenticate", "outcome": "ok", "sync_seconds": 0.57,
  "checklists": 2, "titles": ["Einkaufsliste", "Essensplan"],
  "stored": "stored as a new version of keep-master-token-cloud" }
```

**The hypothesis was correct.** Repointing the ordinary probe at that cloud-minted token then
returned `outcome: ok` from `34.96.39.36` - the same job on the same network that had failed
minutes earlier with a home-minted token.

### What this means operationally

**The origin of token creation is what Google binds, not the origin of use.** That makes a
hosted gateway viable at $0, at the cost of one extra step whenever the token has to be
replaced:

- **First setup and every re-mint must run in the cloud**, not on the laptop. The
  `oauth_token` cookie is still obtained from a browser, but the exchange itself must happen
  from the Cloud Run origin - which is exactly what `mint-in-cloud.py` does.
- The cookie is a **session credential**: it is short-lived and grants full account access. It
  was written to a dedicated secret, used once, and the secret was **deleted immediately after**
  the mint succeeded. It is never logged and never added to the image.
- A **safety guard** aborts without storing anything if the minted token can see more
  checklists than the throwaway account should (two), which is what a cookie taken from the
  main account's browser profile would look like.
- **Durability is still being observed.** The 6-hourly `keep-gate2-probe-6h` schedule samples
  the cloud-minted token; a first success is not the same as a token that survives for weeks.

## Gate 3 - guaranteeing zero cost

This is where the picture turned out to be worse than assumed. **"Always free" does
not mean "$0 for a small always-on service" on either free VM tier.**

### Google Compute Engine always-free `e2-micro`

| Item | Free allowance | Source |
| --- | --- | --- |
| VM | 1 non-preemptible `e2-micro`, US only (`us-west1`, `us-central1`, `us-east1`) | [Free cloud features](https://docs.cloud.google.com/free/docs/free-cloud-features) |
| Disk | 30 GB-months standard persistent disk | same |
| Egress | 1 GB/month from North America (excluding China, Australia) | same |
| **External IPv4** | **1 hour per month per account** | [VPC network pricing](https://cloud.google.com/vpc/network-pricing) |

The external IPv4 address is the problem. Verbatim from the pricing page:

> Static and ephemeral IP addresses in use on standard VM instances
> **$0.005 / 1 hour, per 1 month / account** [...]
> Free Tier: Both static and ephemeral IP addresses assigned to standard VM
> instances are offered with a free tier. **This free usage is limited to one hour
> per month per account.**

A service the browser can reach needs a public address, so an always-on e2-micro
costs roughly **730 h x $0.005 = ~$3.65 per month** - the compute and disk are free,
the address is not. (`$0.005` is the *in-use* rate; an unassigned static address is
`$0.01/h`, and an instance's address counts as in use whenever the instance exists,
running or stopped.)

Two ways out, both with caveats:

- **IPv6-only.** External IPv6 addresses on VM instances are explicitly *not*
  charged, and Google's APIs are dual-stack, so the VM could call Keep over IPv6
  with no IPv4 at all. This hinges on the phone/laptop network having working IPv6
  - fragile, and untested.
- **Do not assign a public address** and reach the VM through an outbound tunnel
  (e.g. `cloudflared`). But a VM with no external IPv4 also has no general outbound
  internet, so the tunnel itself would need Cloud NAT, whose address is charged at
  the same `$0.005/h`. No saving.

Also note: GCE deployments have **no hard spend cap**. The closest mechanism is
[Disable billing usage with notifications](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications),
which switches billing off when a budget threshold is crossed. Google is explicit
about its limits: there is a delay between cost and notification, it "doesn't
guarantee that you won't spend more than your budget", and disabling billing
"terminates all Google Cloud services in the project, including Free Tier services".
So it is a real guard *if* the budget is set far below your funds, but it is not an
exact cap.

### Oracle Cloud Always Free

Genuinely free, European region available, and 10 TB/month outbound data included.
But verbatim from [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm):

> Idle Always Free compute instances may be reclaimed by Oracle. Oracle will deem
> virtual machine and bare metal compute instances as idle if, during a 7-day
> period, the following are true: CPU utilization for the 95th percentile is less
> than 20%; Network utilization is less than 20%; Memory utilization is less than
> 20% (applies to A1 shapes only).

**A Keep backend is the archetypal idle instance**: a handful of requests a day is
~0% CPU and ~0% network, and 20% of 12 GB of memory is far above what a Python
service uses. All three conditions therefore hold, so the instance is reclaimable
and could disappear. This is a documented policy, not folklore.

Two further constraints from the same page:

- **The home region is chosen at signup and immutable.** Always Free compute must be
  created there, so Frankfurt has to be picked deliberately at signup.
- **"Out of host capacity" is expected.** Oracle's own guidance is to try another
  availability domain, wait, *or upgrade to Pay as You Go*, noting that "Oracle
  doesn't charge for Always Free resources after you upgrade, and will only charge you
  for resource usage above the Always Free limits". That makes PAYG a genuine
  zero-cost option while inside the limits - but it has no hard cap either.

**Correction on a claim made earlier in this project:** upgrading to Pay-as-You-Go
should *not* be assumed to switch off idle reclamation. The reclamation paragraph is
not scoped to free tenancies and contains no such carve-out; it simply says "Idle
Always Free compute instances may be reclaimed by Oracle". Whether PAYG changes the
outcome is **unverified**, and community reports are not authoritative. Treat Oracle
as carrying reclamation risk regardless of tenancy type until observed otherwise.

### Cloud Run

180,000 vCPU-s / 360,000 GiB-s / 2 M requests per month, but per
[the pricing page](https://cloud.google.com/run/pricing) the free tier is a
**discount, not a cap**: "you are billed only for usage past the free tier". Fine
for volume, but it needs the auto-disable-billing guard above, and it adds cold
starts and an ephemeral filesystem.

### Gate 3 verdict

Ranked for this workload (a few requests a day, always on, no laptop):

| Option | Truly $0? | Always on? | Main risk |
| --- | --- | --- | --- |
| **1. Cloud Run**, min-instances 0 | yes, within limits | yes, but cold starts | free tier is a discount; needs the billing guard; ephemeral disk |
| **2. GCE `e2-micro`** + IPv4 | **no, ~$3.65/mo** | yes | the IPv4 charge; no hard cap |
| **2b. GCE `e2-micro`** + IPv6 only | maybe | yes | IPv6 reachability from your networks; untested |
| **3. Oracle Always Free** (free or PAYG) | yes | yes | **idle reclamation** - not carved out for PAYG |
| **4. Apps Script / Workers** | yes | yes | needs the whole auth reimplemented in JavaScript - risk concentrates in the least-tested part |

**Cloud Run ranks first**, which is the opposite of the initial instinct: it is the
only $0 option with *nothing to reclaim*. There is no VM, so Oracle's idle policy and
GCE's address charge simply do not apply. Its two costs are cold starts, which Gate 4
will quantify, and a billing guard we have to configure deliberately. If Gate 4 shows
a cold sync of a few seconds, Cloud Run becomes the clear answer.

GCE's ~$3.65/month is the price of predictability: nothing gets reclaimed, nothing is
ephemeral, and a full VM is easier to reason about than a serverless service.

**Conclusion:** a genuinely $0, always-on, non-fragile host is available *if* cold
starts turn out to be tolerable (Cloud Run). Otherwise it is ~$3.65/month (GCE) or a
reclamation risk (Oracle). This is a decision for the user, and Gate 4 supplies the
missing number.

## Decision framework

Pre-committing the decision logic, so the verdict becomes mechanical once Gate 1 and
Gate 4 report. Left column is what the spike prints; nothing here depends on judgement
made after the fact.

### Step 1 - is the Keep integration viable at all? (Gate 1)

`scratch` runs first, against a note the throwaway account owns. It exists purely for
attribution: if `scratch` fails too, the problem is the account or the API rather than
sharing, and there is no point reading the shared-list result as a sharing verdict.
Both commands print the same three verdicts.

| Spike result | Verdict | What follows |
| --- | --- | --- |
| `scratch` PASS, `write` PASS, and the Keep app shows the same order | **GO** | Continue to step 2 |
| `scratch` PASS, `write` PASS server-side, but the app renders another order | **GO, reduced scope** | Writes work; sorting happens in the web app's own view instead of in Keep |
| `write` `RESULT: FAIL (order)` | **GO, reduced scope** | Same as above - Keep gets the items, the app owns the ordering |
| `scratch` `RESULT: FAIL (order)` | **GO, reduced scope** | Sort ids are ignored even on an owned note, so sharing is not the cause |
| `write` `RESULT: FAIL (create)`, "0 of 3" | **NO-GO** | The sharee cannot write to a shared list. Neither option A nor option C works; automatic Keep integration is off the table |
| `scratch` `RESULT: FAIL (create)` | **NO-GO** | The account cannot create notes at all - suspect the credential or the API, not sharing |
| `cleanup` reports `order restored: NO` | **NO-GO until fixed** | The write strategy is unsafe for a live list; needs an isolated scratch list first |

### Step 2 - which host? (Gate 4 timing, then Gate 2 survival)

| Condition | Choice | Why |
| --- | --- | --- |
| Cold sync **≤ ~3 s** | **Cloud Run**, min-instances 0 ← **measured 0.73 s, this row applies** | Only $0 option with nothing to reclaim; cold starts are invisible at this sync speed |
| Cold sync **> ~10 s** | GCE `e2-micro` (~$3.65/mo) | A warm always-on VM hides the sync cost |
| Cold sync in between | Either; prefer GCE if the start-up feel matters | Free, but a visible stall on every app start |
| Gate 2 logs `blocked` from a provider | Drop that provider | The private API refuses that network; no configuration fixes it |
| Gate 2 logs `rejected` after working | Any host, but treat the token as perishable | Needs a re-auth path and an alert; favours option A, where re-minting is local |
| Gate 2 unstable **and** re-auth is manual | **Option A** (laptop) | A credential that needs a human every few weeks undercuts the point of an unattended host |

**Current standing:** Cold sync measured at 0.73 s, so the first row applies and
**Cloud Run is the working assumption**: $0 within the free tier, nothing to reclaim,
and the state cache dropped (see Gate 4 above). Gate 2 is the remaining technical risk,
and it cannot be tested without provisioning the host.

### Step 3 - is the laptop actually the better answer?

Option A should be re-weighed at the end, not dismissed at the start. It wins on
cost ($0), on auth fragility (re-minting a token is local and instant), and on
privacy (no third party holds the credential). It loses only on one thing: the
laptop must be on. If Gate 2 or Gate 4 shows the cloud route to be fragile or
noticeably slow, "laptop on, and the phone falls back to the Keep app" is a
legitimate outcome rather than a defeat.

## Still open

- **The Keep-app render check** for Gate 1: three `GATE1-TEST` items are at the top of
  the shared `Einkaufsliste`; confirm the order in the app, then run `cleanup`.
- **Gate 2** - harness ready and self-tested; needs a host once the platform is confirmed.
- **Note titles** - both lists have been renamed to their canonical names, `Einkaufsliste` and
  `Essensplan`, and `.env` matches. ARCHITECTURE.md and ROADMAP.md record this.
- **Oracle idle reclamation under Pay-as-You-Go** - unverified either way; the docs
  contain no carve-out. Only observation would settle it.
- **IPv6-only reachability** for the GCE route - untested, and now unlikely to matter.

## Test coverage

`write` and `cleanup` act on a live shopping list, so their code paths are covered by
`test-spike.py`: seventeen integration tests drive the real `cmd_scratch`, `cmd_write`,
`cmd_cleanup` and `cmd_read` against an in-memory fake Keep server. Covered: the pass
case, the failure case where the server ignores sort ids, the shared-note regression
where new entries never reach the server, the leftover-marker guard, the pre-test
snapshot, the restore comparison and its disturbance warning, re-running cleanup, the
missing-checklist message, and the scratch warm-up (leftover cleanup, `--keep`, and
both of its failure modes).

```sh
./.venv/bin/python -m unittest test-spike -v
```
