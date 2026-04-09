# Changelog

## 1.3.0
### New Features
- **Go to Definition** — Ctrl+Click on label in `!GOTO`/`!GOSUB` jumps to `LABEL:` definition; Ctrl+Click on `$var#` jumps to its `!LET`/`!SETVAL`
- **Document Symbols** — Outline panel shows macros (`!START`), labels, and variables with hierarchy; Breadcrumbs navigation
- **Hover Info** — Hover on any `!PROCESS` shows description and syntax example from built-in snippets; hover on `$var#` shows definition line; hover on label shows target line

## 1.2.1
### Fixes
- Fixed repository URL in package.json
- Added CHANGELOG.md for Marketplace display

## 1.2.0
### Bug Fixes
- **Config settings now respected**: `datamineMacro.linting.enabled` and `maxLineLength` are actually read
- **Comment lines checked for length**: line-length warning was skipped for comment-only lines
- **`#` inside strings**: `!ECHO 'Item #5'` no longer truncated as comment
- **process_names case-insensitive**: `!selcop` now highlighted correctly (was uppercase-only)
- **`!SCREEN` added** to control keywords in grammar

### New Linter Checks
- Duplicate labels (Error)
- Unused labels (Hint)
- Variable used before `!LET` definition (Warning)
- Undefined variable — never assigned with `!LET`/`!SETVAL` (Hint)
- Unused variable — defined but never read (Hint)
- `!GOSUB` to label without `!RETURN` (Warning)
- `!RETURN` outside a subroutine (Warning)
- Empty `!IF` block (Warning)
- Nested `!START` (Warning)
- Duplicate `!ONERR` — only last is active (Warning)
- Unreachable code after unconditional `!GOTO` (Hint)
- Label name >16 chars in `!GOTO`/`!GOSUB` target (Error)
- No `!START` found in file (Warning)

### Improvements
- Control command set extracted to single `CONTROL_NO_PARENS` constant
- Updated test macro covering all 22 check categories

## 1.1.0
- Added linter with diagnostics (line length, !START/!END, !IF/!ENDIF, labels, parens, variables)
- Added 267 process snippets

## 1.0.0
- Improved grammar: control commands highlighted separately from process names
- Added labels highlighting (`LABEL:`)
- Added snippets for all 35 macro control commands
- Added macro templates: full macro, error handler, loop pattern
- Fixed language-configuration.json (correct line comment `#`, auto-indent rules)
- Based on opengeostat/vscode-dm-macro 0.0.2 (MIT)
