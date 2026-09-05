# Agent Instructions & Project Rules

## Application Naming & Versioning Rules
- **Name**: `3DViewMaker`
- **Version Tracking**:
  - Current Version: `v0.94`
  - Rule: Every time changes or revisions are made, incrementally increase the version number by 0.01 (+0.01 to the hundredths place, e.g. v0.85 -> v0.86 -> v0.87).
  - Synchronize the updated version across:
    1. `src/components/Sidebar.tsx` (top header title badge)
    2. `metadata.json` (`name` field)
    3. `index.html` (`<title>` and `<meta property="og:title">` tags)
