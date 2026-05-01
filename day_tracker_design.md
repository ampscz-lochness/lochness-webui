# Day Tracker — Design Spec (Detailed, Reproducible)

## Objective

Add a **Day Tracker** page under the Monitoring section that visualises per-participant data-flow relative to each participant's study Day-1. The page is specific to AMP-SCZ, where Day-1 is defined by REDCap consent/enrolment.

---

## Route & Navigation

| Item | Value |
|---|---|
| URL | `/monitoring/daytracker` |
| Nav label | `Day Tracker` |
| Nav parent | `Monitoring` (existing sidebar group) |
| Nav position | Below `Logs` in the `Monitoring` group |

### Changes required

1. **`src/components/layout/routes.ts`** — add an entry to the `Monitoring` `items` array:
   ```ts
   { title: "Day Tracker", url: "/monitoring/daytracker", isActive: false }
   ```
2. **`src/app/monitoring/page.tsx`** — the existing redirect to `/monitoring/logs` stays; the new page lives at its own route and does not replace it.
3. Create **`src/app/monitoring/daytracker/page.tsx`** (client component, mirroring the layout of `monitoring/logs/page.tsx`).

---

## Pre-implementation Investigation

Before writing code, the agent must run the following queries against the live database and record the findings inline.

### 1. Confirm the Day-variable

The existing codebase already uses `subjects.subject_metadata->>'consent_date'` as the per-participant Day-1 anchor (see `monitoring.ts`, `pullTrendQuery`, and `getDaysFromConsentDate` in `monitoring/logs/page.tsx`).

**Verify** this is the correct AMP-SCZ Day-1 marker by running:

```sql
SELECT
    subject_id,
    subject_metadata->>'consent_date'        AS consent_date,
    subject_metadata->>'chric_consent_date'  AS chric_consent_date,
    subject_metadata->>'start_date'          AS start_date
FROM public.subjects
WHERE subject_metadata->>'consent_date' IS NOT NULL
LIMIT 20;
```

**Expected outcome:** `consent_date` is non-null and well-formed (`YYYY-MM-DD`).  
If `chric_consent_date` is more reliably populated, use that instead and update the Day-variable definition below.

**Day-variable (working definition):** `subject_metadata->>'consent_date'`  
Fallback candidates (in order): `chric_consent_date`, `start_date`.

### 2. Check for a pre-computed "days-from-day-1" variable

Some REDCap instruments include a computed field such as `ampscz_days_since_consent` or `fu_days_since_consent`. Check whether such a value is stored in the database:

```sql
-- Check subjects JSONB keys across all sites for day-offset fields
SELECT DISTINCT jsonb_object_keys(subject_metadata) AS key
FROM public.subjects
ORDER BY key;
```

Also check the `data_pulls` JSONB payload (if any column stores the pulled REDCap record):

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('data_pulls', 'data_pull')
ORDER BY table_name, ordinal_position;
```

**Likely finding:** No pre-computed day-offset field exists in the database; the offset must be computed at query time as `pull_date - consent_date`.

### 3. Identify REDCap change-level granularity

The existing monitoring uses `file_md5` to detect that a REDCap file changed but not *which fields* changed.

Run the following to check if there is a finer-grained change table:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Look for tables named `redcap_changes`, `record_changes`, `field_changes`, or similar.  
Also check whether `data_pulls` stores a JSONB diff column:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('data_pulls', 'data_pull')
  AND data_type IN ('jsonb', 'json');
```

**Likely finding:** No field-level diff is available. The finest available granularity is:
- **File-level change** detected by a new distinct `file_md5` on a given day per data source.
- The `file_path` column encodes the data type / modality (e.g., `redcap`, `mindlamp`, `cantab`).

The Day Tracker should therefore visualise **data-source / modality activity per day relative to Day-1**, not individual REDCap field changes.  
If a finer diff table is found during investigation, document it here and extend the model accordingly.

---

## Core Definitions

| Term | Definition |
|---|---|
| Day-variable | `subject_metadata->>'consent_date'` (consent date = study Day-1) |
| Day offset | `pull_date::date - consent_date::date` (integer, can be negative for pre-consent pulls) |
| Consented subject | `subject_metadata->>'missing_required_variables' = ''` (same rule as monitoring page) |
| Unique data event | One distinct non-empty `file_md5` value first seen on a given calendar day (same counting unit as monitoring page) |
| Modality | Data source category derived from `data_source_name` using the same normalization logic as the monitoring page |

---

## Schema Mapping Rules

Reuse the identical auto-detection logic already in `src/lib/models/monitoring.ts`:

1. Pull table: prefer `data_pulls`, fallback `data_pull`.
2. Pull timestamp column: `pull_timestamp` → `created_at` → `inserted_at` → `updated_at`.
3. Pull source column: `data_source_name` → `source_name` → `data_source_identifier`.
4. File path column: `file_path` → `filepath` → `path`.
5. Subject created-at: `subjects.created_at` → `subject_metadata->>'created_at'` → `subject_metadata->>'consent_date'`.

---

## API Endpoint

**`GET /api/v1/daytracker/[projectId]`**  
File: `src/app/api/v1/daytracker/[project_id]/route.ts`

### Response shape

```ts
type DayTrackerPayload = {
    project_id: string;
    day_variable: string;          // e.g. "consent_date"
    activity_by_subject: Array<{
        subject_id: string;
        site_id: string;
        consent_date: string | null;   // YYYY-MM-DD
        days: Array<{
            day_offset: number;        // integer days from consent date (0 = Day-1)
            calendar_date: string;     // YYYY-MM-DD
            modality_key: string;      // e.g. "redcap", "mindlamp"
            unique_file_count: number; // distinct file_md5 count first seen on this day
            file_paths: string[];      // sample file paths for tooltip
        }>;
    }>;
    metadata: {
        data_pulls_available: boolean;
        file_md5_available: boolean;
        day_offset_range: { min: number; max: number } | null;
    };
};
```

### Query logic (server model)

Create **`src/lib/models/daytracker.ts`** with a `DayTracker` class mirroring `Monitoring`.

The core query computes day offsets from consent date:

```sql
WITH consent_by_subject AS (
    SELECT
        subject_id,
        site_id,
        NULLIF(subject_metadata->>'consent_date', '')::date AS consent_date
    FROM public.subjects
    WHERE project_id = $1
      AND COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = ''
      AND NULLIF(subject_metadata->>'consent_date', '') IS NOT NULL
),
first_seen_per_md5 AS (
    SELECT DISTINCT ON (p.subject_id, modality_key, NULLIF(p.file_md5::text, ''))
        p.subject_id,
        <modality_case_expression>                                    AS modality_key,
        date_trunc('day', p.<pull_timestamp_col>::timestamptz)::date  AS calendar_date,
        p.<pull_timestamp_col>::timestamptz                           AS first_seen_ts,
        NULLIF(p.file_md5::text, '')                                  AS file_md5,
        NULLIF(p.<file_path_col>::text,  '')                          AS file_path
    FROM <data_pulls_table> p
    WHERE p.subject_id = ANY($2::text[])
      AND NULLIF(p.file_md5::text, '') IS NOT NULL
    ORDER BY p.subject_id, modality_key, NULLIF(p.file_md5::text, ''),
             p.<pull_timestamp_col>::timestamptz ASC NULLS LAST
)
SELECT
    f.subject_id,
    f.modality_key,
    f.calendar_date,
    (f.calendar_date - c.consent_date)::int AS day_offset,
    COUNT(*)::int                           AS unique_file_count,
    array_agg(f.file_path ORDER BY f.first_seen_ts DESC NULLS LAST)
        FILTER (WHERE f.file_path IS NOT NULL)  AS file_paths
FROM first_seen_per_md5 f
JOIN consent_by_subject c USING (subject_id)
WHERE f.modality_key IS NOT NULL
GROUP BY f.subject_id, f.modality_key, f.calendar_date, c.consent_date
ORDER BY f.subject_id, day_offset, f.modality_key
LIMIT 5000;
```

Replace `<modality_case_expression>`, `<pull_timestamp_col>`, `<file_path_col>`, and `<data_pulls_table>` with the auto-detected identifiers using the same helper functions (`pickFirstColumn`, `quoteIdentifier`) already in `monitoring.ts`.

If `file_md5` is unavailable, fall back to counting raw pull records per day (same fallback pattern as monitoring page).

---

## Frontend Page

File: **`src/app/monitoring/daytracker/page.tsx`**  
Type: `"use client"` component.  
Template: mirror `src/app/monitoring/logs/page.tsx` for layout, state, loading skeleton, and error handling.

### State

```ts
const [projectIdInput, setProjectIdInput] = React.useState("Procan");
const [projectId, setProjectId]           = React.useState("Procan");
const [subjectFilter, setSubjectFilter]   = React.useState("");   // default filter shown at top
const [data, setData]                     = React.useState<DayTrackerPayload | null>(null);
const [loading, setLoading]               = React.useState(true);
const [activeModalityTab, setActiveModalityTab] = React.useState<string>("all");
```

### Heading

```tsx
<Heading
    icon={<CalendarDays className="h-8 w-8" />}
    title="Day Tracker"
    subtitle="Data activity per participant relative to study Day-1 (consent date)"
/>
```

Use `CalendarDays` from `lucide-react`.

### Controls (top bar)

Identical pattern to the monitoring page:

1. **Project ID input + Load button** — same as monitoring page.
2. **Subject ID filter input** — visible at the top by default (unlike monitoring page where trend filter is inside a section). Placeholder: `Filter by subject ID…`. Filters the chart list in real time.
3. **Modality tab strip** (`Tabs` / `TabsList`) — tabs: `All`, then one tab per modality present in the data, using `COVERAGE_MODALITY_COLUMNS` labels. Mirrors `activeTrendTab` behaviour in monitoring page.
4. **Refresh button** — same icon (`RefreshCcw`) and behaviour as monitoring page.

### Day Tracker Figure (main visualisation)

Render one row per (filtered) subject. Each row contains:

- **Subject ID** label (left, fixed width).
- **Consent date** label in small muted text below the subject ID.
- **Bar strip** — a horizontal sequence of day-offset buckets. Each occupied bucket is rendered as a coloured bar segment proportional to `unique_file_count`. Day-offset 0 (Day-1) is always rendered as a reference line even if empty.
- **Tooltip on hover** — show `Day {offset}`, calendar date, modality, file count, and up to 3 sample file paths.

Axis labels:
- **X axis** (shared, pinned below the list): integer day offsets. Show ticks at 0, 30, 60, 90, 180, 365 (and negative equivalents if pre-consent pulls exist). Label Day-0 as "Day 1".
- **Y axis**: one row per participant (implicit from the list layout — no explicit axis needed).

Colour coding: reuse `TREND_MODALITY_COLOR_BY_KEY` from the monitoring page. When `activeModalityTab === "all"`, render stacked/grouped segments per modality per day bucket using the same `TrendSegment` type.

### Empty / loading states

Reuse `<Placeholder.Empty>` and `<Placeholder.Card>` exactly as in the monitoring page.

### No Day-variable warning

If a subject has no `consent_date`, render a muted inline badge `No consent date` in the subject row instead of a chart. Do not hide the row.

---

## Filtering

- Filter is applied client-side on `activity_by_subject` using `subjectFilter.trim().toLowerCase()` against `subject_id`.
- If the filter is empty, all subjects are shown.
- Show a result count label: `Showing {n} of {total} participants`.

---

## Print / Export (stretch goal, not required for initial version)

Follow the same `monitoring-print-only` pattern used in the monitoring page if print support is added later.

---

## File Checklist

| File | Action |
|---|---|
| `src/components/layout/routes.ts` | Add Day Tracker nav item |
| `src/app/monitoring/daytracker/page.tsx` | Create (client component) |
| `src/app/api/v1/daytracker/[project_id]/route.ts` | Create (GET handler) |
| `src/lib/models/daytracker.ts` | Create (server model, mirrors `monitoring.ts`) |
| `src/types/daytracker.ts` | Create (shared `DayTrackerPayload` type) |