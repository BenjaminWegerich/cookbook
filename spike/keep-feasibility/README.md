# Google Keep feasibility spike

Answers the open questions before any cloud host is provisioned for the Keep
integration. Two questions can be settled on the laptop; two need a host and a
week of observation.

| Gate | Question | Artefact | Status |
| --- | --- | --- | --- |
| **Gate 1** | Can the throwaway account, as a *sharee*, add items to the shared shopping list and control their order? | `scratch` / `write` / `cleanup` | **PASS**, including the Keep-app check |
| **Gate 2** | Does master-token authentication survive from a cloud host IP over days? | `gate2-healthcheck.py` + `mint-in-cloud.py` | **PASS, with a catch: the token must be minted *from* the cloud; see [findings.md](findings.md)** |
| **Gate 3** | Is zero cost *guaranteed*, not merely likely? | [findings.md](findings.md) | **Cloud Run at $0 within limits, with the billing guard** |
| **Gate 4** | How slow is a cold start and a full sync? | `read` | **answered - 0.73 s cold, so cold starts are a non-issue** |

Gate 1 is the only test that can prove the design impossible. Everything else is
infrastructure, so it runs first.

## Why a spike at all

Google Keep has no usable API for personal Google accounts. The official Keep API
is Workspace-only and has no `update` method at all, so it cannot edit a list even
if it could be authorised. The unofficial route (`gkeepapi`) talks to Google's
private mobile Keep API using a long-lived **master token**.

A master token grants full access to the account it belongs to, so this spike runs
against a **dedicated throwaway account** that has only the two Keep notes shared
into it. If the token leaks, the blast radius is those two notes - and if Google
suspends the automating account, the main account is untouched.

## 1. Setup (already done)

```sh
cd spike/keep-feasibility
python3 -m venv --without-pip .venv          # this Ubuntu image lacks ensurepip
curl -sS https://bootstrap.pypa.io/get-pip.py | ./.venv/bin/python
./.venv/bin/pip install -r requirements.txt
```

Verified on Python 3.14.4. `pycryptodomex` ships an abi3 manylinux wheel, so **no C
toolchain and no `sudo apt install` is needed**.

## 2. Create the throwaway Google account

1. Sign out of Google, or use a private window, and create a new **personal**
   `@gmail.com` account at <https://accounts.google.com/signup>.
   Do **not** use a Google Workspace account: gkeepapi's FAQ documents
   `DeviceManagementRequiredOrSyncDisabled` failures caused by Android device
   policies that Workspace admins enforce, and there is no free Workspace tier for
   new signups anyway.
2. **Do not link it to your main account.** Leave the recovery email and phone
   empty, and do not add it as a recovery option for your main account either.
   A recovery link would turn a compromise of the throwaway into a pivot path to
   your real account, which is the whole thing we are trying to prevent.
3. **Use it for nothing else.** No Gmail, no Drive, no other Keep notes. The
   mitigation is "the account holds nothing else", so it only works while that
   stays true.

## 3. Share the two notes into it

From your **main** account:

1. Open <https://keep.google.com> and open the **shopping list** note.
2. Click the collaborator icon (person with `+`) under the note.
3. Enter the throwaway address, select it, click **Done**, then **Save**.
4. Repeat for the **meal plan** note ("Essensplan").
5. Confirm the throwaway address appears as a collaborator on both notes.

Keep **ownership** with the main account. Google's help is explicit: *"If you
delete a shared note that you own, it'll be deleted for everyone"* - so the
automation (as sharee) can never delete your originals outright.

Note the exact titles; they go into `.env` as `KEEP_SHOPPING_LIST_TITLE` and
`KEEP_MEALPLAN_LIST_TITLE` (defaults: `Einkaufsliste` and `Essensplan`).

## 4. Obtain the master token

**Open a browser session that is logged in as the THROWAWAY account** - a separate
Chrome profile or an incognito window. If you do this in your normal browser
profile, you will mint a master token for your **main** account, which would defeat
the entire security design.

```sh
cd spike/keep-feasibility
./.venv/bin/python keep-spike.py token
```

Then:

1. Open <https://accounts.google.com/EmbeddedSetup> in that throwaway session, log
   in, and click **I agree**. The page may keep loading forever; that is expected.
2. Press <kbd>F12</kbd> -> **Application** -> **Cookies** -> `https://accounts.google.com`.
3. Copy the full **Value** of the `oauth_token` cookie.
4. Paste it at the hidden prompt. It is not echoed and does not enter your shell
   history.

The token, the account email, a freshly generated **device id** and the two list
titles are written to `.env` with mode `0600`. The device id must stay stable for
the lifetime of the deployment - a changing device id makes Google treat every run
as a new device, which is the pattern that triggers extra verification.

If the exchange fails with **"Plaintext is too long"**, the `oauth_token` was
truncated or the wrong cookie; copy it again.

## 5. Gate 4 - measure sync timings

```sh
./.venv/bin/python keep-spike.py read
```

Prints three numbers and an inventory of every list the throwaway account can see:

- **cold full sync** - no cached state, everything downloaded
- **warm incremental sync** - same session, delta only
- **resumed start** - authenticating again from a cached `state.json`

**What to look for:** if the cold sync is already only a few seconds, serverless
cold starts stop being a design constraint and the state cache is not worth
persisting anywhere. Also confirm both shared notes appear, with real item counts.

**Measured on the live account:** cold 0.73 s, warm 0.23 s, resumed from cache 0.59 s
(135 items in the shopping list, 248 in the meal plan). The cache buys ~0.14 s, so it
has been dropped from the design - which also removes the ephemeral-filesystem problem
on a serverless host.

## 6. Gate 1 warm-up - the zero-risk run

```sh
./.venv/bin/python keep-spike.py scratch
```

**Always run this before touching the shared list.** It performs the identical
ordered write test, but on a note that the throwaway account **owns**, so nothing you
care about can be damaged. The note is deleted again at the end (pass `--keep` if you
want to look at it in the Keep app first).

It separates two questions that `write` alone cannot:

| Scratch result | Meaning |
| --- | --- |
| `PASS` | The whole toolchain works: token, auth, create note, add items, sort, sync. Any later failure on the shared list is then about *sharing*. |
| `FAIL (create)` | The account cannot create notes at all. The shared list is not the problem - suspect the credential or the API. |
| `FAIL (order)` | Sort ids are ignored even on a note the account owns, so sharing is ruled out. Category sorting cannot work at all. |

## 7. Gate 1 - the shared-list test

```sh
./.venv/bin/python keep-spike.py write
```

This adds exactly three items, all prefixed `GATE1-TEST`, to the shared shopping
list, with sort ids set **above** every existing item so they sit at the very top
and never interleave with real entries. They are created in the order
`alpha, bravo, charlie` but must display as `charlie, alpha, bravo` - which differs
from alphabetical order *and* from insertion order, so a pass proves our own sort
ids are being honoured rather than a default.

The script then re-reads the list in a **fresh session**, which proves the server
stored the order rather than merely echoing local state.

### Manual verification (this is the part only you can do)

The script's server-side check is necessary but not sufficient - the real question
is whether the **Keep app** renders that order.

1. Open Google Keep as your **main** account and open the shopping list.
2. Confirm the three `GATE1-TEST` items are at the top, in the order
   `charlie`, `alpha`, `bravo`.
3. Report back exactly what you see.

## 8. Cleanup

```sh
./.venv/bin/python keep-spike.py cleanup
```

Deletes every `GATE1-TEST` item and then compares the real items against the
snapshot taken before the test - reporting whether **order** and **sort ids** were
restored. Anything other than two `yes` lines means the spike disturbed the real
list and the strategy needs to be safer before it goes near production.

## Interpreting the results

The `write` phase prints an explicit verdict, and its two failure modes are kept
apart because they mean very different things:

| Outcome | Meaning | Consequence |
| --- | --- | --- |
| `RESULT: PASS` | The sharee created items *and* controlled their order | The design is viable; continue to Gate 2 |
| `RESULT: FAIL (create)` - "0 of 3" | The sharee cannot create items in a shared list at all | The 2019 shared-note regression is back. **No-go** for automatic Keep writes |
| `RESULT: FAIL (order)` | Items were created, but our sort ids were ignored | Writing works, ordering does not. Category sorting must move into the app |
| Server order passes but the Keep app shows another order | The API stored it, the UI ignores it | Same as `FAIL (order)` in practice |
| `cleanup` reports `order restored: NO` | The test disturbed the real list | Writes need an isolated test list before going near production |

## Gate 3 - guaranteeing zero cost

This turned out to be the weakest part of option C: **"always free" does not mean
"$0 for a small always-on service" on either free VM tier.** Full evidence, verbatim
citations and the decision table live in [findings.md](findings.md). The short
version:

- **GCE `e2-micro`** - compute and a 30 GB disk are genuinely free, but the free
  allowance for an **external IPv4 address is one hour per month**; the in-use rate is
  `$0.005/h`, so an always-on instance is roughly **$3.65/month**. (External IPv6 is
  not charged, but IPv6-only reachability is unproven.)
- **Oracle Always Free** - genuinely free and available in a European region, but
  Oracle **may reclaim idle instances**: CPU, network and memory below 20% over 7 days
  meets the documented criteria, which a Keep backend trivially does. Upgrading to
  Pay-as-You-Go does **not** remove this: the policy has no such carve-out.
- **Cloud Run** - its free tier is a **discount, not a cap**: "you are billed only for
  usage past the free tier". But it is the only $0 option with **nothing to reclaim**,
  so it currently ranks first - provided Gate 4 shows cold starts are tolerable.
- **No provider offers an exact hard cap.** GCP's closest mechanism is
  [auto-disabling billing on a budget threshold](https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications),
  which Google explicitly says "doesn't guarantee that you won't spend more than your
  budget" and which terminates all services in the project, free tier included.

**This needs a decision from the user, not a technical fix** - see the ranked table in
[findings.md](findings.md#gate-3-verdict).

## Gate 2 - auth survival from a host

Once Gate 1 passes and a host exists, copy `keep-spike.py`, `gate2-healthcheck.py`,
`requirements.txt` and `.env` to the VM and run the check once:

```sh
/opt/keep-feasibility/.venv/bin/python /opt/keep-feasibility/gate2-healthcheck.py
```

Each run appends one JSON line to `gate2-log.jsonl` and records four distinct
outcomes - `ok`, `rejected` (the credential died), `blocked` (the private API refuses
this host/network), `network` - plus the host's **public egress IP**, because Google
treats a changing IP as a new device.

Then sample it over days:

```sh
sudo cp deploy/keep-gate2-healthcheck.* /etc/systemd/system/
sudo systemctl enable --now keep-gate2-healthcheck.timer
```

**Cloud Run (the chosen host):** [`deploy/cloud-run/README.md`](deploy/cloud-run/README.md)
has the exact `gcloud` steps — a Cloud Run *job* on a Cloud Scheduler trigger, with the
token in Secret Manager and results in Cloud Logging. Prefer that over the systemd path now
that the platform is decided; the units are kept as the fallback if Gate 2 shows the private
API refuses Google's datacenter network.

Roll the log up at any time:

```sh
/opt/keep-feasibility/.venv/bin/python gate2-healthcheck.py --summary
```

**Pass condition:** `ok` on every run for at least a week, with a stable egress IP.
Any `rejected` means the credential died; any `blocked` means option C is not viable
from that provider's network.

## Files

| File | Purpose |
| --- | --- |
| `keep-spike.py` | The whole spike: `token`, `read`, `scratch`, `write`, `cleanup` |
| `gate2-healthcheck.py` | Gate 2: one auth sample per run, appended to a JSON-lines log |
| `test-spike.py` | 17 integration tests for the scratch/write/cleanup/read paths, against a fake Keep server |
| `deploy/keep-gate2-healthcheck.{service,timer}` | systemd units running the check every 6 hours |
| `findings.md` | Evidence log: what is verified, verbatim citations, open questions |
| `.env` | Secrets: master token, device id, list titles (0600, gitignored) |
| `state.json` | Cached gkeepapi state from the last `read` (gitignored) |
| `before-write.json` | Pre-test snapshot used by `cleanup` (gitignored) |
| `gate2-log.jsonl` | Gate 2 outcome log (gitignored) |

## Running the tests

`write` and `cleanup` touch a live shopping list, so their paths are covered before
they ever run for real:

```sh
./.venv/bin/python -m unittest test-spike -v
```

The suite drives the real `cmd_scratch` / `cmd_write` / `cmd_cleanup` / `cmd_read`
against an in-memory fake Keep server, including the failure cases where the server
ignores our sort ids, refuses new items in a shared list, and refuses to create the
note at all - plus the guard that blocks a re-run with leftover test items.

## Safety rules built into the spike

- `read` never writes anything.
- `write` refuses to run if previous `GATE1-TEST` items are still present.
- Only items carrying the `GATE1-TEST` prefix are ever created or deleted.
- Test items are placed above every real item, so real items keep their relative
  order even mid-test.
- `cleanup` proves the real arrangement was restored instead of assuming it.
