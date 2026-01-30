# SQLite Debug Notes (Codex Analytics)

## DB path (macOS)

`~/Library/Application Support/com.qufei1993.skillshub/skills_hub.db`

## Useful sqlite3 commands

List tables:

`sqlite3 "~/Library/Application Support/com.qufei1993.skillshub/skills_hub.db" ".tables"`

Check how many Codex events were stored, and the timestamp range:

`sqlite3 "~/Library/Application Support/com.qufei1993.skillshub/skills_hub.db" "SELECT COUNT(*) AS events, datetime(MIN(ts_ms)/1000,'unixepoch') AS min_ts, datetime(MAX(ts_ms)/1000,'unixepoch') AS max_ts FROM skill_usage_events WHERE tool='codex';"`

See newest events (skill + time + project + source log line):

`sqlite3 "~/Library/Application Support/com.qufei1993.skillshub/skills_hub.db" "SELECT skill_key, datetime(ts_ms/1000,'unixepoch') AS ts, project_path, log_path, log_line FROM skill_usage_events WHERE tool='codex' ORDER BY ts_ms DESC LIMIT 30;"`

Inspect per-file scan cursors (what line we last processed for each rollout log):

`sqlite3 "~/Library/Application Support/com.qufei1993.skillshub/skills_hub.db" "SELECT log_path, last_line, datetime(updated_at_ms/1000,'unixepoch') AS updated FROM codex_scan_cursors ORDER BY updated_at_ms DESC LIMIT 50;"`

