export type CodexAnalyticsConfig = {
  enabled: boolean
  interval_secs: number
  project_mode: 'git_root_or_workdir' | 'workdir'
  retention_enabled: boolean
  retention_days: number
  last_scan_ms?: number | null
}

export type CodexScanStats = {
  scanned_files: number
  processed_lines: number
  new_events: number
  parse_errors: number
  matched_use_skill: number
  skipped_skill_not_found: number
  duplicate_events: number
  retention_deleted: number
  now_ms: number
}

export type ClearCodexAnalyticsResult = {
  deleted_events: number
  now_ms: number
}

export type SkillUsageLeaderboardRow = {
  skill_id: string
  skill_name: string
  calls: number
  projects: number
  tools: number
  last_ts_ms: number
}

export type SkillUsageProjectRow = {
  project_path: string
  calls: number
  last_ts_ms: number
}

export type CodexSessionDay = {
  day: string
  files: number
}
