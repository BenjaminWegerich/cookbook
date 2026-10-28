# Recipe Quantity Optimization Specification

## 1. Scope & System Boundaries

This specification defines the deterministic algorithm for selecting the optimal numerical representation of recipe ingredients when scaling or converting quantities.

* **In Scope:** Deciding whether to output an Additional Quantity (AQ), selecting the numerical values for Base Quantity (BQ) and AQ, and selecting the optimal unit.
* **Out of Scope (View/Presentation Layer):** String interpolation, formatting, punctuation, and whether AQ precedes BQ (e.g., `"2 tbsp (20 ml)"` vs `"20 ml [2 tbsp]"`). These are presentation-layer decisions determined by client formatting rules.
* **Base Unit Assignment:** The metric base unit (`g` or `ml`) is an inherent attribute of the **ingredient**, not the additional unit.

---

## 2. Core Domain Concepts

### 2.1 Quantities & Units
* **Target Quantity ($V_0$):** The unrounded target amount expressed in the ingredient's metric base unit (`ml` or `g`).
* **Base Quantity (BQ):** The metric volume or mass (`ml` or `g`).
* **Additional Quantity (AQ):** An optional culinary or commercial unit (`tbsp`, `tsp`, `piece`, `can`, `block`, etc.).
* **Conversion Factor ($c_u$):** Defined per `(ingredient, additional_unit)` tuple, such that:
  $$1\text{ unit of AQ} = c_u\text{ units of BQ}$$

### 2.2 Additional Unit Classification: `EXACT` vs. `NON_EXACT`
Every additional unit belongs to one of two categories:

1. **`NON_EXACT` (Heuristic tools):**
   * *Examples:* `tbsp`, `tsp`, `pinch`, `handful`, `piece`.
   * *Behavior:* BQ and AQ are selected independently from their respective global allowed-number tables. Deviations between them incur an internal conflict penalty.
2. **`EXACT` (Discrete packaging / manufactured units):**
   * *Examples:* `pack`, `can`, `bottle`, `block`.
   * *Behavior:* The physical package strictly dictates the BQ: $V_{\text{BQ}} \equiv q_{\text{AQ}} \times c_u$. BQ is **not** chosen from the allowed BQ table. By definition, $P_{\text{conflict}} = 0.0$ and $R_{\text{BQ}} = 0.0$.

---

## 3. Master Data Architecture

The engine requires four data structures:

### 3.1 `allowed_base_quantities`
Global table of allowed metric numbers (`ml` / `g`) and their clumsiness penalties ($R \in [0.0, 1.0]$).
* $0.0 = \text{perfectly round / clean}$
* $1.0 = \text{very clumsy / awkward}$

### 3.2 `allowed_additional_quantities`
**Global** table of allowed numbers for **all** culinary/packaging units (`tbsp`, `can`, `piece`, etc.) and their clumsiness penalties ($R \in [0.0, 1.0]$).

### 3.3 `additional_units`
Defines available secondary units and their type (exact / non-exact).

### 3.4 `ingredient_conversions`
Links ingredients to compatible additional units and defines the physical base unit conversion.

---

## 4. The "Precision" Setting (Genauigkeit)

Users adjust the balance between **measurement precision and convenience** via five levels:

| Level | Numeric position `g` | Meaning |
| :--- | :---: | :--- |
| `very low` | 0.00 | Prefer practical household/package measures; tolerate culinary deviation. |
| `low` | 0.25 | Lean practical, but keep amounts close. |
| `medium` | 0.50 | Balanced. |
| `high` | 0.75 | Lean exact, but accept a clean household reading when close. |
| `very high` | 1.00 | Prefer exact metric amounts; tolerate awkward numbers and metric-only output. |

Precision is a **display preference**, never a scale factor: it changes which BQ/AQ candidate wins, not `V0`.

### 4.1 Resolution Cascade
The effective precision `g` is resolved through two levels:

$$
g = g_{\text{quantity}} \;\mathbf{??}\; g_{\text{ingredient}}
$$

- **`quantity`** (optional): a per-row or per-artifact override, stored in the recipe file.
- **`ingredient`** (mandatory): the ingredient master-data value. Every ingredient row in `zutaten.csv` states one of the five levels.
- **No recipe-level and no global default.** Only values that have no applicable level at all — unitless inline artifacts (no ingredient) and unregistered sub-recipes (no master-data row) — use the internal neutral level `medium`. It is never written to a file and is not a user setting.

### 4.2 Dynamic Weight Interpolation
The system defines two boundary weight vectors: $\mathbf{W}_{\text{practical}}$ at `very low` (`g = 0`) and $\mathbf{W}_{\text{exact}}$ at `very high` (`g = 1`).

The runtime weight vector $\mathbf{W}(g)$ is calculated via linear interpolation:
$$
\mathbf{W}(g) = (1 - g) \cdot \mathbf{W}_{\text{practical}} + g \cdot \mathbf{W}_{\text{exact}}
$$

Because both boundary vectors sum to $1.0$, $\mathbf{W}(g)$ is guaranteed to sum to $1.0$ for every level.

#### System Parameter Defaults:

| Weight Component | Practical Boundary (`very low`, `g = 0`) | Exact Boundary (`very high`, `g = 1`) | Purpose |
| :--- | :---: | :---: | :--- |
| **$W_{\text{acc}}$** | **$0.20$** | **$0.70$** | Importance of matching $V_0$ |
| **$W_{\text{conflict}}$** | **$0.30$** | **$0.20$** | Penalty for text contradiction |
| **$W_{\text{round}}$** | **$0.35$** | **$0.05$** | Importance of clean numbers |
| **$W_{\text{missing}}$** | **$0.15$** | **$0.05$** | Penalty for omitting an AQ |

> This reverses the old tolerance scale: a **higher** value now means **more precision** (more metric accuracy), not more practical output.

### 4.3 Remaining System Parameters
Beyond the weights, three system-level constants are required:
1. **$p \in [0, 1]$ (User Proportion, Default: $0.5$):** Estimated fraction of cooks who use BQ (scales) vs. $(1-p)$ who use AQ (spoons/units).
2. **Candidate band (Default: factor $2$):** candidates lie in $[V_0/2, 2 \cdot V_0]$. Distance is measured symmetrically in log space, $d(x) = |\log_2(x / V_0)|$, so $\frac{1}{2}\times$ and $2\times$ are equally far; the band edge is $d = 1$.
3. **Conflict guard (Default: factor $1.5$):** a non-exact BQ/AQ pair is discarded when $|\log_2(V_{\text{BQ}} / V_{\text{AQ}})| > \log_2(1.5) \approx 0.585$, i.e. when the two readings on one line differ by more than 50 % multiplicatively.

---

## 5. Mathematical Scoring Function

The total penalty score $S_{\text{total}}$ is:

$$S_{\text{total}} = W_{\text{acc}} P_{\text{acc}} + W_{\text{conflict}} P_{\text{conflict}} + W_{\text{round}} P_{\text{round}} + W_{\text{missing}} P_{\text{missing}}$$

### Component Formulas:

| Penalty | Branch 1: `EXACT` AQ Present | Branch 2: `NON_EXACT` AQ Present | Branch 3: AQ Omitted |
| :--- | :--- | :--- | :--- |
| **$P_{\text{acc}}$** | $\lvert\log_2(V_{\text{AQ}} / V_0)\rvert$ | $p \cdot \lvert\log_2(V_{\text{BQ}} / V_0)\rvert + (1 - p) \cdot \lvert\log_2(V_{\text{AQ}} / V_0)\rvert$ | $\lvert\log_2(V_{\text{BQ}} / V_0)\rvert$ |
| **$P_{\text{conflict}}$** | $0.0$ | $\lvert\log_2(V_{\text{BQ}} / V_{\text{AQ}})\rvert$ | $0.0$ |
| **$P_{\text{round}}$** | $(1 - p) \cdot R_{\text{AQ}}$ | $p \cdot R_{\text{BQ}} + (1 - p) \cdot R_{\text{AQ}}$ | $R_{\text{BQ}}$ |
| **$P_{\text{missing}}$** | $0.0$ | $0.0$ | $1.0$ |

*Accuracy and conflict are symmetric log distances: $0$ means identical, $1$ means a factor of $2$. They are scale-free; roundness and missing remain table penalties. A non-exact pair is discarded when its conflict exceeds $\log_2(1.5)$.*

---

## 6. Optimization & Selection Algorithm

### Step 1: Candidate Generation (Windowing)
Filter master tables to the factor-$2$ band around target $V_0$:
* **$\mathcal{C}_{\text{BQ}}$:** BQs where $|\log_2(q_{\text{BQ}} / V_0)| \le 1$.
* **$\mathcal{C}_{\text{AQ}}(u)$:** For each applicable unit $u$, AQs where $|\log_2(q_{\text{AQ}} \cdot c_u / V_0)| \le 1$.

### Step 2: Evaluation
1. **Metric-Only:** Score each $q_{\text{BQ}} \in \mathcal{C}_{\text{BQ}}$ using Branch 3.
2. **Exact Units:** For each unit $u \in \text{EXACT}$ and each $q_{\text{AQ}} \in \mathcal{C}_{\text{AQ}}(u)$, compute $V_{\text{BQ}} = q_{\text{AQ}} \cdot c_u$ and score using Branch 1.
3. **Non-Exact Units:** For each unit $u \in \text{NON\_EXACT}$, evaluate all pairs $(q_{\text{BQ}}, q_{\text{AQ}}) \in \mathcal{C}_{\text{BQ}} \times \mathcal{C}_{\text{AQ}}(u)$ using Branch 2. *(Skip pairs where $|\log_2(V_{\text{BQ}} / V_{\text{AQ}})| > \log_2(1.5)$)*.

### Step 3: Strict Tie-Breaking Hierarchy
When two candidates produce equivalent scores ($|S_A - S_B| \le 10^{-5}$), break ties using the following strict priority sequence:

1. Higher numerical BQ value.
2. Higher numerical AQ value (treating `None` as $-1$).
3. Alphabetical unit name (treating `None` as `""`).

### 6.4 Master-list Quantities

The master row of an ingredient is a display of its merged step uses, not an
independent target. Its BQ is the **exact sum of the step rows' displayed BQs**;
that sum need not be an allowed BQ, and its clumsiness is not scored. Its AQ is
chosen under these constraints:

1. **One use:** the step result is reused unchanged, so step and master
   arrangement are identical.
2. **All uses share one AU:** the master AQ is the exact sum of the step AQs.
   The sum may lie outside the AQ table; a sum above one is written as a mixed
   fraction (`1+1/2`, displayed as `1 1/2`), and its clumsiness is not scored.
3. **Any AU shared with a step:** the master AQ must be strictly larger than
   that step's AQ. Otherwise a master could repeat `1 Packung` above a step that
   already reads `1 Packung`.
4. **Exact units:** outside the shared-AU sum, an exact unit is only a candidate
   when its count reaches the BQ sum exactly; otherwise the line would
   contradict itself (`2 Becher (900 g)`).
5. **Precision:** the master row uses the highest effective precision among its
   step rows.

The master AQ candidates are scored with Branch 2 (non-exact), because the BQ is
fixed by the sum rather than derived from the count. The candidate window and
the tie-break hierarchy of §6 continue to apply.
