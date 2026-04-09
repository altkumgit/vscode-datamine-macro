# Datamine Macro Language — VS Code Extension

Full language support for **Datamine Studio** macro files (`.mac`).

## Features

### Go to Definition (Ctrl+Click)
- Click on a label in `!GOTO LABEL` / `!GOSUB LABEL` — jumps to `LABEL:` definition
- Click on `$varname#` — jumps to its `!LET` / `!SETVAL` definition

### Document Symbols (Outline)
- **Outline panel** shows macro structure: `!START` blocks, labels, variables
- **Breadcrumbs** navigation — see which macro/label section you're in
- Hierarchical: labels and variables nested under their parent `!START`

### Hover Info
- Hover on any **process** (`!SELCOP`, `!ESTIMA`, etc.) — shows description and syntax example
- Hover on **`$variable#`** — shows where it's defined
- Hover on **label reference** — shows target line number

### Syntax Highlighting
- ✅ Control commands (`!START`, `!END`, `!IF`, `!ELSE`, `!GOTO`, `!LET`, `!SCREEN`, etc.)
- ✅ File parameters (`&in()`, `&out()`, `&in1()`)
- ✅ Field parameters (`*field()`)
- ✅ Numeric/option parameters (`@param=value`)
- ✅ Substitution variables (`$varname#`)
- ✅ Jump labels (`MYLABEL:`)
- ✅ Comments (`#` and `!REM`)
- ✅ Process names (`!SELCOP`, `!ESTIMA`, etc.) — case-insensitive

### Linter — 20+ Real-Time Checks

The built-in linter runs on every keystroke (debounced) and catches:

| Check | Severity | Description |
|-------|----------|-------------|
| Line length | ⚠ Warning | Line exceeds 80 chars (configurable) |
| Macro name length | ❌ Error | `!START` name > 8 characters |
| Nested `!START` | ⚠ Warning | `!START` inside another `!START` |
| Unclosed `!START` | ❌ Error | No matching `!END` |
| `!END` without `!START` | ❌ Error | Orphan `!END` |
| Unclosed `!IF` block | ❌ Error | No matching `!ENDIF` |
| `!ENDIF` without `!IF` | ❌ Error | Orphan `!ENDIF` |
| `!ELSE`/`!ELSEIF` orphan | ❌ Error | Without matching `!IF` |
| Empty `!IF` block | ⚠ Warning | No statements between `!IF` and `!ENDIF` |
| Undefined label | ⚠ Warning | `!GOTO`/`!GOSUB` to non-existent label |
| Duplicate label | ❌ Error | Same label defined more than once |
| Unused label | 💡 Hint | Label defined but never referenced |
| Label name > 16 | ❌ Error | Label in `!GOTO`/`!GOSUB` exceeds limit |
| Variable name > 16 | ❌ Error | `$var#` name exceeds Datamine limit |
| Variable before `!LET` | ⚠ Warning | Used before its first definition |
| Undefined variable | 💡 Hint | Used but never `!LET`/`!SETVAL` in file |
| Unused variable | 💡 Hint | Defined but never read |
| Unbalanced parens | ⚠ Warning | Mismatched `(` and `)` on process lines |
| `!GOSUB` no `!RETURN` | ⚠ Warning | Subroutine has no `!RETURN` |
| `!RETURN` outside sub | ⚠ Warning | Not inside a `!GOSUB`-target label |
| Duplicate `!ONERR` | ⚠ Warning | Only last `!ONERR` is active |
| Unreachable code | 💡 Hint | Code after unconditional `!GOTO` |
| No `!START` | ⚠ Warning | File has no `!START` command |

### Configuration

```json
{
    "datamineMacro.linting.enabled": true,
    "datamineMacro.linting.maxLineLength": 80
}
```

### Snippets — Control Commands (47)

| Prefix | Command | Description |
|--------|---------|-------------|
| `!START` | `!START` / `!END` | Macro block |
| `!IF` | `!IF` one-line | Conditional branch |
| `!IFb` | `!IF`/`!ELSEIF`/`!ELSE`/`!ENDIF` | Block IF |
| `!LET` | `!LET $var# = value` | Variable assignment |
| `!GOTO` | `!GOTO LABEL` | Unconditional jump |
| `!GOSUB` | `!GOSUB` / `!RETURN` | Subroutine call |
| `!ONERR` | `!ONERR LABEL` | Error handler |
| `!ECHO` | `!ECHO 'msg'` | Display message |
| `!SCREEN` | `!SCREEN 'title'` | User input dialog |
| `macrotemplate` | Full template | Complete macro with header, checks, error handler |
| `loopcount` | Loop template | Counter-based loop pattern |
| ... | | 47 control snippets total |

### Snippets — Processes (285)
All major Datamine Studio processes: `!SELCOP`, `!ESTIMA`, `!DESURV`, `!EXTRA`, `!PICREC`, `!MGSORT`, and many more.

## Installation

### From VSIX (manual)
```bash
code --install-extension datamine-macro-1.2.0.vsix
```

### Development
```bash
git clone https://github.com/altkumgit/vscode-datamine-macro
cd vscode-datamine-macro
# Press F5 in VS Code to launch Extension Development Host
```

## Syntax Reference

### Variables
```
!LET $counter# = 0
!LET $result# = $counter# + 1
```

### File/Field/Option parameters
```
!SELCOP &in(drillholes),&out(output),
        *f1(BHID),*f2(FROM),*f3(TO),
        @keepall=0
```

### Labels and branching
```
!IF $count# GE 10 !GOTO LOOP_END
LOOP_START:
  ...
  !GOTO LOOP_START
LOOP_END:
```

### Error handling
```
!ONERR ERR_LABEL
!FILE &in(myfile) !GOTO FILE_OK
!ECHO 'File not found'
!GOTO FINISH

FILE_OK:
  # ... process ...
FINISH:

ERR_LABEL:
!ECHO 'Fatal error occurred'
```

## Based on
Original work by [opengeostat/vscode-dm-macro](https://github.com/opengeostat/vscode-dm-macro) (MIT License).
Extended with full control command support, improved grammar, linter, and additional snippets.

## License
MIT
