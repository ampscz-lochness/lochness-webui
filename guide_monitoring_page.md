# Monitoring Page Spec (Detailed, Reproducible)

## Objective
Create a project-level monitoring dashboard that is consistent across environments and reproducible from schema introspection.

## Scope
This guide defines both:
1. Product behavior (what users should see).
2. Implementation behavior (how backend and frontend should calculate and render each section).

## Core Definitions
1. "Subject with consent date" in this app means:
	`subjects.subject_metadata.missing_required_variables = ""`
2. Data pull counting unit:
	unique non-null/non-empty `file_md5` values.
3. Last night window:
	from previous local day start (00:00) to current day start (00:00).

## Schema Mapping Rules (Required)
Use these rules before writing queries:
1. Pull table name must be auto-detected:
	1. Prefer `data_pulls`.
	2. Fallback to `data_pull`.
2. Pull timestamp column auto-detection order:
	1. `pull_timestamp`
	2. `created_at`
	3. `inserted_at`
	4. `updated_at`
3. Pull source column auto-detection order:
	1. `data_source_name`
	2. `source_name`
	3. `data_source_identifier`
4. Subject timestamp for "newly added":
	1. Use subjects table `created_at` if present.
	2. Else use `subject_metadata.created_at` if parseable.
	3. Else fallback to `subject_metadata.consent_date` as date-only timestamp.

## Required Monitoring Outputs

### 1) Summary
Show three KPI cards:
1. Subjects With Consent Date
2. Sites With Any Consented Subject
3. Newly Added Subjects Last Night

### 2) Subjects With Consent Date (Site Table)
Render a table with columns:
1. Site ID
2. Subject IDs
3. Count

Rules:
1. Subject IDs must be in-table (not separate top text).
2. Count must match the number of listed subject IDs.

### 3) Data Pull Coverage
For each consented subject, show:
1. Total Pulls: total raw pull records.
2. Pulls With Unique file_md5: count of distinct non-empty `file_md5`.
3. Data source columns with recent pull timestamps.

Data source column normalization rule:
1. Normalize site-specific source names by removing the prefix up to first underscore.
2. Example:
	1. `ProcanOR_cantab` -> `cantab`
	2. `ProcanYA_cantab` -> `cantab`

Cell rendering rule:
1. For each subject + normalized source column, show recent timestamps (most recent first).
2. Show `N/A` when no records exist for that subject/source.

### 4) Pull Trend Of Data Pull Counts Over Time
Required metric:
1. daily count of unique non-empty `file_md5` per subject.

Rendering:
1. Render as a per-subject bar chart style list.
2. Sort rows in descending time order (newest day first).
3. Display day labels in human-readable date format.

### 5) Newly Added Subjects Last Night
Include subjects that satisfy:
1. consent rule (`missing_required_variables = ""`).
2. subject timestamp inside last night window.

Table columns:
1. Subject ID
2. Site ID
3. Creation Timestamp (or fallback timestamp source)

### 6) Recent Warning Logs
Show last 20 project warnings with columns:
1. Timestamp
2. Log level
3. Message
4. Site
5. Subject
6. Data source

Noise filtering rule:
1. Exclude low-signal warnings such as:
	`Record with subject_id XX is missing required variables: consent_date.`

## Query Logic Requirements
1. Unique pull count expression:
	`COUNT(DISTINCT NULLIF(file_md5::text, ''))`
2. Raw pull count expression:
	`COUNT(*)`
3. Trend grouping:
	`GROUP BY subject_id, date_trunc('day', pull_timestamp)`
4. Warning level filter:
	use enum-safe text prefix match, e.g. `log_level::text ILIKE 'WARN%'`.

## API Contract Expectations
Monitoring payload should include at minimum:
1. `summary`
2. `newly_added_last_night`
3. `data_pull_coverage_by_subject`
4. `data_pull_trend_by_subject`
5. `last_warning_logs`
6. `metadata.notes` for schema detection fields (table, timestamp/source columns, file_md5 availability)

## UI Behavior Requirements
1. All large datasets should render in tables or bar rows with stable ordering.
2. Dates and timestamps must be human-readable.
3. Missing values should render as `N/A`.
4. Monitoring page must remain functional even when some optional pull fields are absent.

## Validation Checklist
1. `/monitoring` route resolves and loads monitoring page.
2. Summary cards show non-null values.
3. Site table contains Subject IDs column and matching counts.
4. Coverage section shows normalized data source columns (shared across sites).
5. Trend section shows descending bars by date per subject.
6. Warning log section shows 20 records max and excludes consent-date noise records.

## Notes For Future Development
1. Always introspect schema in each environment before assuming table/column names.
2. If `file_md5` is partially missing in historical data, keep both raw and unique counters.
3. If schema changes, update mapping order first, then queries, then UI labels.


