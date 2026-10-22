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

## 4. The "Tolerance" Setting

Users or recipes can adjust the balance between measurement precision and convenience via a normalized slider (or chips):
$$\lambda \in [0.0, 1.0]$$
* **$\lambda = 0.0$ ("Prefer Exact Quantities"):** Prioritizes recipe fidelity; tolerates awkward numbers and metric-only output.
* **$\lambda = 1.0$ ("Prefer Practical Quantities"):** Prioritizes clean numbers and household measures; tolerates culinary deviation.

### 4.1 Resolution Cascade
The effective slider value $\lambda$ is resolved using a hierarchical fallback:
$$\lambda = \lambda_{\text{quantity}} \;\mathbf{??}\; \lambda_{\text{ingredient}} \;\mathbf{??}\; \lambda_{\text{recipe}} \;\mathbf{??}\; \lambda_{\text{global\_default}}$$

### 4.2 Dynamic Weight Interpolation
The system defines two boundary weight vectors: $\mathbf{W}_{\text{exact}}$ ($\lambda = 0$) and $\mathbf{W}_{\text{practical}}$ ($\lambda = 1$).

The runtime weight vector $\mathbf{W}(\lambda)$ is calculated via linear interpolation:
$$\mathbf{W}(\lambda) = (1 - \lambda) \cdot \mathbf{W}_{\text{exact}} + \lambda \cdot \mathbf{W}_{\text{practical}}$$

Because both boundary vectors sum to $1.0$, $\mathbf{W}(\lambda)$ is guaranteed to sum to $1.0$ for any $\lambda \in [0, 1]$.

#### System Parameter Defaults:

| Weight Component | Exact Boundary ($\lambda = 0.0$) | Practical Boundary ($\lambda = 1.0$) | Purpose |
| :--- | :---: | :---: | :--- |
| **$W_{\text{acc}}$** | **$0.70$** | **$0.20$** | Importance of matching $V_0$ |
| **$W_{\text{conflict}}$** | **$0.20$** | **$0.30$** | Penalty for text contradiction |
| **$W_{\text{round}}$** | **$0.05$** | **$0.35$** | Importance of clean numbers |
| **$W_{\text{missing}}$** | **$0.05$** | **$0.15$** | Penalty for omitting an AQ |

### 4.3 Remaining System Parameters
Beyond the weights, two system-level constants are required:
1. **$p \in [0, 1]$ (User Proportion, Default: $0.5$):** Estimated fraction of cooks who use BQ (scales) vs. $(1-p)$ who use AQ (spoons/units).
2. **$\varepsilon_{\max}$ (Candidate Search Cutoff, Default: $0.50$):** Maximum relative error ($\pm 50\%$) considered during candidate generation.

---

## 5. Mathematical Scoring Function

The total penalty score $S_{\text{total}}$ is:

$$S_{\text{total}} = W_{\text{acc}} P_{\text{acc}} + W_{\text{conflict}} P_{\text{conflict}} + W_{\text{round}} P_{\text{round}} + W_{\text{missing}} P_{\text{missing}}$$

### Component Formulas:

| Penalty | Branch 1: `EXACT` AQ Present | Branch 2: `NON_EXACT` AQ Present | Branch 3: AQ Omitted |
| :--- | :--- | :--- | :--- |
| **$P_{\text{acc}}$** | $\frac{\|V_{\text{AQ}} - V_0\|}{V_0}$ | $p \cdot \frac{\|V_{\text{BQ}} - V_0\|}{V_0} + (1 - p) \cdot \frac{\|V_{\text{AQ}} - V_0\|}{V_0}$ | $\frac{\|V_{\text{BQ}} - V_0\|}{V_0}$ |
| **$P_{\text{conflict}}$** | $0.0$ | $\frac{\|V_{\text{BQ}} - V_{\text{AQ}}\|}{V_0}$ | $0.0$ |
| **$P_{\text{round}}$** | $(1 - p) \cdot R_{\text{AQ}}$ | $p \cdot R_{\text{BQ}} + (1 - p) \cdot R_{\text{AQ}}$ | $R_{\text{BQ}}$ |
| **$P_{\text{missing}}$** | $0.0$ | $0.0$ | $1.0$ |

*All deviations are normalized by $V_0$ to ensure uniform scale across all factors.*

---

## 6. Optimization & Selection Algorithm

### Step 1: Candidate Generation (Windowing)
Filter master tables to values within $\varepsilon_{\max}$ of target $V_0$:
* **$\mathcal{C}_{\text{BQ}}$:** BQs where $\frac{|q_{\text{BQ}} - V_0|}{V_0} \le \varepsilon_{\max}$.
* **$\mathcal{C}_{\text{AQ}}(u)$:** For each applicable unit $u$, AQs where $\frac{|q_{\text{AQ}} \cdot c_u - V_0|}{V_0} \le \varepsilon_{\max}$.

### Step 2: Evaluation
1. **Metric-Only:** Score each $q_{\text{BQ}} \in \mathcal{C}_{\text{BQ}}$ using Branch 3.
2. **Exact Units:** For each unit $u \in \text{EXACT}$ and each $q_{\text{AQ}} \in \mathcal{C}_{\text{AQ}}(u)$, compute $V_{\text{BQ}} = q_{\text{AQ}} \cdot c_u$ and score using Branch 1.
3. **Non-Exact Units:** For each unit $u \in \text{NON\_EXACT}$, evaluate all pairs $(q_{\text{BQ}}, q_{\text{AQ}}) \in \mathcal{C}_{\text{BQ}} \times \mathcal{C}_{\text{AQ}}(u)$ using Branch 2. *(Skip pairs where $\frac{|V_{\text{BQ}} - V_{\text{AQ}}|}{V_0} > \varepsilon_{\max}$)*.

### Step 3: Strict Tie-Breaking Hierarchy
When two candidates produce equivalent scores ($|S_A - S_B| \le 10^{-5}$), break ties using the following strict priority sequence:

1. Higher numerical BQ value.
2. Higher numerical AQ value (treating `None` as $-1$).
3. Alphabetical unit name (treating `None` as `""`).
