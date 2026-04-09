// Datamine Macro Language Extension
// Linter + Go to Definition + Document Symbols + Hover — v1.3.0

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const LANG_ID = 'datamine-macro';
const LANG_SELECTOR = { language: LANG_ID, scheme: 'file' };

/** @type {vscode.DiagnosticCollection} */
let diagnosticCollection;

// ── Process descriptions loaded from snippets ────────────────────────────────
/** @type {Map<string, {description: string, body: string}>} */
let processInfo = new Map();

/**
 * Load process/control snippet descriptions for Hover provider
 */
function loadSnippetDescriptions(extensionPath) {
    const snippetFiles = [
        path.join(extensionPath, 'snippets', 'processes.code-snippets'),
        path.join(extensionPath, 'snippets', 'control-commands.code-snippets')
    ];
    for (const file of snippetFiles) {
        try {
            // Strip JS-style comments (// ...) before parsing
            const raw = fs.readFileSync(file, 'utf8');
            const cleaned = raw.replace(/^\s*\/\/.*$/gm, '');
            const json = JSON.parse(cleaned);
            for (const [, snippet] of Object.entries(json)) {
                if (!snippet.prefix) continue;
                const prefix = snippet.prefix.replace(/^!/, '').toUpperCase();
                const desc = Array.isArray(snippet.description)
                    ? snippet.description.join(' ').trim()
                    : (snippet.description || '').trim();
                const body = Array.isArray(snippet.body)
                    ? snippet.body.join('\n')
                    : (snippet.body || '');
                // Keep first entry (most complete) if duplicate prefix
                if (!processInfo.has(prefix)) {
                    processInfo.set(prefix, { description: desc, body });
                }
            }
        } catch (e) {
            // Silently ignore — snippets are optional for hover
        }
    }
}

// ── Document parsing (shared by all providers) ───────────────────────────────
/**
 * Parse a document and return labels, variables, macros
 * @param {vscode.TextDocument} document
 */
function parseDocument(document) {
    const labels = new Map();    // name(upper) -> {line, col, name}
    const variables = new Map(); // name(upper) -> {line, col, name}
    const macros = [];           // [{name, startLine, endLine}]

    const macroStack = [];
    const lines = document.getText().split('\n');

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = raw.trim();
        if (!trimmed) continue;

        // Labels: MYLABEL:
        const labelMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/);
        if (labelMatch) {
            const name = labelMatch[1];
            const col = raw.indexOf(name);
            if (!labels.has(name.toUpperCase())) {
                labels.set(name.toUpperCase(), { line: i, col, name });
            }
        }

        // !LET $var# = ...
        const letMatch = trimmed.match(/^!LET\s+\$([A-Za-z][A-Za-z0-9_]*)#/i);
        if (letMatch) {
            const name = letMatch[1];
            const col = raw.indexOf('$' + name);
            if (!variables.has(name.toUpperCase())) {
                variables.set(name.toUpperCase(), { line: i, col, name });
            }
        }

        // !SETVAL $var# = ...
        const setMatch = trimmed.match(/^!SETVAL\s+\$([A-Za-z][A-Za-z0-9_]*)#/i);
        if (setMatch) {
            const name = setMatch[1];
            const col = raw.indexOf('$' + name);
            if (!variables.has(name.toUpperCase())) {
                variables.set(name.toUpperCase(), { line: i, col, name });
            }
        }

        // !START MacroName
        const startMatch = trimmed.match(/^!START\s+([A-Za-z0-9_]+)/i);
        if (startMatch) {
            macroStack.push({ name: startMatch[1], startLine: i, endLine: i });
        }

        // !END
        if (/^!END\b/i.test(trimmed)) {
            if (macroStack.length > 0) {
                const m = macroStack.pop();
                m.endLine = i;
                macros.push(m);
            }
        }
    }
    // Unclosed macros
    for (const m of macroStack) {
        m.endLine = lines.length - 1;
        macros.push(m);
    }

    return { labels, variables, macros };
}

// ══════════════════════════════════════════════════════════════════════════════
//  PROVIDERS
// ══════════════════════════════════════════════════════════════════════════════

// ── Go to Definition ─────────────────────────────────────────────────────────
const definitionProvider = {
    provideDefinition(document, position) {
        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_]*/);
        if (!wordRange) return null;

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position.line).text;
        const charBefore = wordRange.start.character > 0
            ? lineText[wordRange.start.character - 1] : '';
        const charAfter = wordRange.end.character < lineText.length
            ? lineText[wordRange.end.character] : '';

        const { labels, variables } = parseDocument(document);

        // Variable: $varname#
        if (charBefore === '$' && charAfter === '#') {
            const info = variables.get(word.toUpperCase());
            if (info) {
                return new vscode.Location(document.uri,
                    new vscode.Position(info.line, info.col));
            }
            return null;
        }

        // Label: used in !GOTO LABEL, !GOSUB LABEL, !ONERR LABEL, !BACKTO LABEL
        // or after !IF ... !GOTO LABEL
        if (/!(GOTO|GOSUB|ONERR|BACKTO)\s/i.test(lineText)) {
            const info = labels.get(word.toUpperCase());
            if (info) {
                return new vscode.Location(document.uri,
                    new vscode.Position(info.line, info.col));
            }
        }

        return null;
    }
};

// ── Document Symbols (Outline + Breadcrumbs) ─────────────────────────────────
const symbolProvider = {
    provideDocumentSymbols(document) {
        const { labels, variables, macros } = parseDocument(document);
        const symbols = [];

        // Macros as top-level modules
        for (const m of macros) {
            const range = new vscode.Range(m.startLine, 0,
                m.endLine, document.lineAt(m.endLine).text.length);
            const sym = new vscode.DocumentSymbol(
                m.name,
                'macro',
                vscode.SymbolKind.Module,
                range, range
            );

            // Labels inside this macro as children
            for (const [, info] of labels) {
                if (info.line > m.startLine && info.line < m.endLine) {
                    const labelRange = new vscode.Range(info.line, 0,
                        info.line, document.lineAt(info.line).text.length);
                    sym.children.push(new vscode.DocumentSymbol(
                        info.name + ':',
                        'label',
                        vscode.SymbolKind.Key,
                        labelRange, labelRange
                    ));
                }
            }

            // Variables inside this macro as children
            for (const [, info] of variables) {
                if (info.line > m.startLine && info.line < m.endLine) {
                    const varRange = new vscode.Range(info.line, info.col,
                        info.line, info.col + info.name.length + 2);
                    sym.children.push(new vscode.DocumentSymbol(
                        '$' + info.name + '#',
                        'variable',
                        vscode.SymbolKind.Variable,
                        varRange, varRange
                    ));
                }
            }

            symbols.push(sym);
        }

        // Labels outside any macro (shouldn't happen normally, but just in case)
        for (const [, info] of labels) {
            const insideMacro = macros.some(m => info.line > m.startLine && info.line < m.endLine);
            if (!insideMacro) {
                const r = new vscode.Range(info.line, 0,
                    info.line, document.lineAt(info.line).text.length);
                symbols.push(new vscode.DocumentSymbol(
                    info.name + ':',
                    'label',
                    vscode.SymbolKind.Key,
                    r, r
                ));
            }
        }

        return symbols;
    }
};

// ── Hover Provider ───────────────────────────────────────────────────────────
const hoverProvider = {
    provideHover(document, position) {
        const lineText = document.lineAt(position.line).text;

        // 1. Hover on process/command: !SELCOP, !IF, !LET etc.
        const cmdRange = document.getWordRangeAtPosition(position, /![A-Za-z][A-Za-z0-9]*/);
        if (cmdRange) {
            const cmd = document.getText(cmdRange);
            const name = cmd.replace(/^!/, '').toUpperCase();
            const info = processInfo.get(name);
            if (info) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**!${name}**\n\n`);
                md.appendMarkdown(info.description + '\n\n');
                // Show snippet body as syntax example
                const example = info.body
                    .replace(/\$\{\d+(?:\|[^}]*\||\:[^}]*)?\}/g, (m) => {
                        // Extract default or placeholder from ${1:default} or ${1|a,b|}
                        const def = m.match(/\$\{\d+:([^}]*)\}/);
                        if (def) return def[1];
                        const opts = m.match(/\$\{\d+\|([^}]*)\|?\}/);
                        if (opts) return opts[1].split(',')[0];
                        return '…';
                    })
                    .replace(/\$\d+/g, '…');
                md.appendCodeblock(example, 'datamine-macro');
                return new vscode.Hover(md, cmdRange);
            }
        }

        // 2. Hover on variable $var# — show definition line
        const varRange = document.getWordRangeAtPosition(position, /\$[A-Za-z][A-Za-z0-9_]*#/);
        if (varRange) {
            const varText = document.getText(varRange);
            const varName = varText.replace(/^\$/, '').replace(/#$/, '').toUpperCase();
            const { variables } = parseDocument(document);
            const info = variables.get(varName);
            if (info) {
                const defLine = document.lineAt(info.line).text.trim();
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**\$${info.name}#** — defined on line ${info.line + 1}\n\n`);
                md.appendCodeblock(defLine, 'datamine-macro');
                return new vscode.Hover(md, varRange);
            }
        }

        // 3. Hover on label reference
        const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z][A-Za-z0-9_]*/);
        if (wordRange && /!(GOTO|GOSUB|ONERR|BACKTO)\s/i.test(lineText)) {
            const word = document.getText(wordRange);
            const { labels } = parseDocument(document);
            const info = labels.get(word.toUpperCase());
            if (info) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(`**${info.name}:** — label on line ${info.line + 1}`);
                return new vscode.Hover(md, wordRange);
            }
        }

        return null;
    }
};

function activate(context) {
    // Load snippet descriptions for hover
    loadSnippetDescriptions(context.extensionPath);

    diagnosticCollection = vscode.languages.createDiagnosticCollection('datamine-macro');
    context.subscriptions.push(diagnosticCollection);

    // Run on open
    if (vscode.window.activeTextEditor) {
        lintDocument(vscode.window.activeTextEditor.document);
    }

    // Run on every save
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => lintDocument(doc))
    );
    // Run on open
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(doc => lintDocument(doc))
    );
    // Run on edit (debounced)
    let timer;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(event => {
            clearTimeout(timer);
            timer = setTimeout(() => lintDocument(event.document), 500);
        })
    );
    // Clear on close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument(doc => {
            diagnosticCollection.delete(doc.uri);
        })
    );

    // ── Register providers ───────────────────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(LANG_SELECTOR, definitionProvider)
    );
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(LANG_SELECTOR, symbolProvider)
    );
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(LANG_SELECTOR, hoverProvider)
    );
}

// ── Control commands that don't use parenthesized parameters ──────────────
// Used to exclude from unbalanced-paren check
const CONTROL_NO_PARENS = new Set([
    'START','END','IF','ELSE','ELSEIF','ENDIF','REM',
    'GOTO','GOSUB','RETURN','BACKTO','ONERR',
    'ECHO','PROMPT','PAUSE','HOLD','NOHOLD',
    'VARINIT','VARLOAD','VARSAVE','STKPAR','STKSAV',
    'KBON','KBOFF','SCROFF','SCRON',
    'XRUN','NOXRUN','OPSYS','RUNPROG',
    'MDEBUG','LOCDBON','LOCDBOFF',
    'LET','SET','SETVAL',
    'NOMENU','MENU','MACST','MACEND',
    'LOADCF','SETENV','SYSPAR',
    'SCREEN'
]);

/**
 * Main lint function
 * @param {vscode.TextDocument} document
 */
function lintDocument(document) {
    if (document.languageId !== 'datamine-macro') return;

    // ── Read user configuration ──────────────────────────────────────────
    const config = vscode.workspace.getConfiguration('datamineMacro');
    if (!config.get('linting.enabled', true)) {
        diagnosticCollection.delete(document.uri);
        return;
    }
    const maxLineLength = config.get('linting.maxLineLength', 80);

    const diagnostics = [];
    const lines = document.getText().split('\n');

    // --- State tracking ---
    const macroStack     = [];    // [{name, line}]
    const ifStack        = [];    // [{line, hasBody}]
    const definedLabels  = new Map();  // name -> {line, col}  (Map for duplicate detection)
    const gotoRefs       = [];    // [{label, line, col}]
    const gosubRefs      = [];    // [{label, line, col}]
    const definedVars    = new Map();  // name -> first definition line
    const usedVars       = [];    // [{name, line, col}]
    const onerrLabels    = [];    // [{label, line}]  for duplicate !ONERR detection
    const returnLines    = [];    // [lineNum]  where !RETURN appears
    let   hasStart       = false;
    let   nestingDepth   = 0;     // track !START nesting

    // Track label-to-content for GOSUB/RETURN analysis
    // We'll record which labels have a !RETURN before next label or !END
    const labelHasReturn = new Map(); // label -> bool

    // ══════════════════════════════════════════════════════════════════════
    //  FIRST PASS — collect labels, variable definitions, returns
    // ══════════════════════════════════════════════════════════════════════
    let currentLabel = null;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const stripped = stripComment(raw);
        const trimmed = stripped.trim();
        if (!trimmed) continue;

        // Labels: MYLABEL:
        const labelMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/);
        if (labelMatch) {
            const name = labelMatch[1].toUpperCase();
            // Close previous label's return tracking
            if (currentLabel !== null && !labelHasReturn.has(currentLabel)) {
                labelHasReturn.set(currentLabel, false);
            }
            currentLabel = name;

            if (definedLabels.has(name)) {
                // Will report duplicate in second pass
            }
            definedLabels.set(name, { line: i, col: 0 });
        }

        // !RETURN — mark current label as having return
        if (/^!RETURN\b/i.test(trimmed) && currentLabel !== null) {
            labelHasReturn.set(currentLabel, true);
        }

        // !END or next !START resets label context
        if (/^!(END|START)\b/i.test(trimmed)) {
            if (currentLabel !== null && !labelHasReturn.has(currentLabel)) {
                labelHasReturn.set(currentLabel, false);
            }
            currentLabel = null;
        }

        // !LET defines a variable
        const letMatch = trimmed.match(/^!LET\s+\$([A-Za-z][A-Za-z0-9_]*)#/i);
        if (letMatch) {
            const vname = letMatch[1].toUpperCase();
            if (!definedVars.has(vname)) {
                definedVars.set(vname, i);
            }
        }

        // !SETVAL also defines a variable
        const setMatch = trimmed.match(/^!SETVAL\s+\$([A-Za-z][A-Za-z0-9_]*)#/i);
        if (setMatch) {
            const vname = setMatch[1].toUpperCase();
            if (!definedVars.has(vname)) {
                definedVars.set(vname, i);
            }
        }
    }

    // Collect all label names referenced by GOSUBs (filled in second pass)
    const gosubTargets = new Set();

    // ══════════════════════════════════════════════════════════════════════
    //  SECOND PASS — full lint
    // ══════════════════════════════════════════════════════════════════════
    let prevNonEmptyWasGoto = false;  // for unreachable code after !GOTO

    for (let i = 0; i < lines.length; i++) {
        const raw  = lines[i];
        const line = document.lineAt(i);
        const stripped = stripComment(raw);
        const trimmed = stripped.trim();

        // ── 1. Line length check — BEFORE skipping comments ──────────────
        if (raw.length > maxLineLength) {
            diagnostics.push(makeDiag(
                line.range,
                `Line exceeds ${maxLineLength} characters (${raw.length}). Datamine has an ${maxLineLength}-char limit.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }

        // Skip empty lines and pure comment lines for remaining checks
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const upper = trimmed.toUpperCase();

        // ── 2. !START ────────────────────────────────────────────────────
        const startMatch = trimmed.match(/^!START\s+([A-Za-z0-9_]+)/i);
        if (startMatch) {
            hasStart = true;
            const name = startMatch[1];

            if (name.length > 8) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, trimmed.indexOf(name), name.length),
                    `Macro name '${name}' exceeds 8 characters (Datamine limit).`,
                    vscode.DiagnosticSeverity.Error
                ));
            }

            // NEW: Nested !START warning
            if (macroStack.length > 0) {
                diagnostics.push(makeDiag(
                    line.range,
                    `Nested !START '${name}' inside '${macroStack[macroStack.length - 1].name}'. Datamine macros should not be nested in the same file.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }

            macroStack.push({ name, line: i });
            nestingDepth++;
        }

        // ── 3. !END ──────────────────────────────────────────────────────
        if (/^!END\b/i.test(trimmed)) {
            if (macroStack.length === 0) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, 0, 4),
                    '!END without matching !START.',
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                macroStack.pop();
                nestingDepth--;
            }
        }

        // ── 4. !IF block ─────────────────────────────────────────────────
        if (/^!IF\b/i.test(trimmed) && !/!GOTO\b/i.test(trimmed) && !/!GOSUB\b/i.test(trimmed)) {
            ifStack.push({ line: i, hasBody: false });
        }

        // Track if current IF block has any body content
        if (ifStack.length > 0) {
            const isControl = /^!(IF|ELSE|ELSEIF|ENDIF)\b/i.test(trimmed);
            if (!isControl) {
                ifStack[ifStack.length - 1].hasBody = true;
            }
        }

        if (/^!ELSEIF\b/i.test(trimmed) || /^!ELSE\b/i.test(trimmed)) {
            if (ifStack.length === 0) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, 0, trimmed.split(/\s/)[0].length),
                    `${trimmed.split(/\s/)[0]} without matching !IF block.`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }

        if (/^!ENDIF\b/i.test(trimmed)) {
            if (ifStack.length === 0) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, 0, 6),
                    '!ENDIF without matching !IF block.',
                    vscode.DiagnosticSeverity.Error
                ));
            } else {
                const ifInfo = ifStack.pop();
                // NEW: Empty !IF block warning
                if (!ifInfo.hasBody) {
                    diagnostics.push(makeDiag(
                        document.lineAt(ifInfo.line).range,
                        '!IF block is empty (no statements between !IF and !ENDIF).',
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }

        // ── 5. !GOTO / !GOSUB references ────────────────────────────────
        const gotoMatch = trimmed.match(/!GOTO\s+([A-Za-z][A-Za-z0-9_]*)/i);
        if (gotoMatch) {
            const label = gotoMatch[1].toUpperCase();
            gotoRefs.push({ label, line: i, col: trimmed.indexOf(gotoMatch[1]) });

            // NEW: Label name length check on GOTO target
            if (gotoMatch[1].length > 16) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, trimmed.indexOf(gotoMatch[1]), gotoMatch[1].length),
                    `Label name '${gotoMatch[1]}' exceeds 16 characters (Datamine limit).`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }

        const gosubMatch = trimmed.match(/!GOSUB\s+([A-Za-z][A-Za-z0-9_]*)/i);
        if (gosubMatch) {
            const label = gosubMatch[1].toUpperCase();
            gosubRefs.push({ label, line: i, col: trimmed.indexOf(gosubMatch[1]) });
            gosubTargets.add(label);

            if (gosubMatch[1].length > 16) {
                diagnostics.push(makeDiag(
                    lineRange(document, i, trimmed.indexOf(gosubMatch[1]), gosubMatch[1].length),
                    `Label name '${gosubMatch[1]}' exceeds 16 characters (Datamine limit).`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }

        const backtoMatch = trimmed.match(/^!BACKTO\s+([A-Za-z][A-Za-z0-9_]*)/i);
        if (backtoMatch) {
            gotoRefs.push({ label: backtoMatch[1].toUpperCase(), line: i, col: trimmed.indexOf(backtoMatch[1]) });
        }

        // ── 6. Variable name length > 16 chars ──────────────────────────
        const varDefMatch = trimmed.match(/!LET\s+\$([A-Za-z][A-Za-z0-9_]*)#/i);
        if (varDefMatch && varDefMatch[1].length > 16) {
            diagnostics.push(makeDiag(
                lineRange(document, i, trimmed.indexOf('$'), varDefMatch[1].length + 2),
                `Variable name '$${varDefMatch[1]}#' exceeds 16 characters (Datamine limit).`,
                vscode.DiagnosticSeverity.Error
            ));
        }

        // ── 7. Unbalanced parentheses on process lines ───────────────────
        const cmdMatch = trimmed.match(/^!([A-Za-z][A-Za-z0-9]*)\b/i);
        if (cmdMatch && !CONTROL_NO_PARENS.has(cmdMatch[1].toUpperCase())) {
            const opens  = (trimmed.match(/\(/g) || []).length;
            const closes = (trimmed.match(/\)/g) || []).length;
            if (opens !== closes) {
                diagnostics.push(makeDiag(
                    line.range,
                    `Unbalanced parentheses: ${opens} '(' vs ${closes} ')'.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        // ── 8. Variable usage tracking ───────────────────────────────────
        const varUseMatches = [...trimmed.matchAll(/\$([A-Za-z][A-Za-z0-9_]*)#/g)];
        for (const m of varUseMatches) {
            usedVars.push({ name: m[1].toUpperCase(), line: i, col: trimmed.indexOf(m[0]) });
        }

        // ── 9. !ONERR label reference ────────────────────────────────────
        const onerrMatch = trimmed.match(/^!ONERR\s+([A-Za-z][A-Za-z0-9_]*)/i);
        if (onerrMatch) {
            const label = onerrMatch[1].toUpperCase();
            gotoRefs.push({ label, line: i, col: trimmed.indexOf(onerrMatch[1]) });
            onerrLabels.push({ label, line: i });
        }

        // ── 10. !RETURN outside any GOSUB target ─────────────────────────
        if (/^!RETURN\b/i.test(trimmed)) {
            returnLines.push(i);
        }

        // ── 11. Unreachable code after unconditional !GOTO ───────────────
        // A label definition resets reachability
        const isLabel = /^[A-Za-z][A-Za-z0-9_]*\s*:\s*$/.test(trimmed);
        const isEnd   = /^!END\b/i.test(trimmed);
        if (prevNonEmptyWasGoto && !isLabel && !isEnd) {
            diagnostics.push(makeDiag(
                line.range,
                'Potentially unreachable code after unconditional !GOTO.',
                vscode.DiagnosticSeverity.Hint
            ));
        }

        // Track if this line is an unconditional GOTO (not inside !IF)
        prevNonEmptyWasGoto = (
            /^!GOTO\b/i.test(trimmed) &&          // starts with !GOTO
            !/^!IF\b/i.test(trimmed)               // not a one-line !IF...!GOTO
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  POST-PASS CHECKS
    // ══════════════════════════════════════════════════════════════════════

    // Unclosed !START
    for (const m of macroStack) {
        diagnostics.push(makeDiag(
            document.lineAt(m.line).range,
            `!START '${m.name}' has no matching !END.`,
            vscode.DiagnosticSeverity.Error
        ));
    }

    // Unclosed !IF blocks
    for (const ifInfo of ifStack) {
        diagnostics.push(makeDiag(
            document.lineAt(ifInfo.line).range,
            '!IF block has no matching !ENDIF.',
            vscode.DiagnosticSeverity.Error
        ));
    }

    // GOTO/GOSUB to undefined labels
    for (const ref of [...gotoRefs, ...gosubRefs]) {
        if (!definedLabels.has(ref.label)) {
            diagnostics.push(makeDiag(
                lineRange(document, ref.line, ref.col, ref.label.length),
                `Label '${ref.label}' is not defined in this file.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }

    // NEW: Duplicate labels
    {
        const labelCount = new Map();
        // Re-scan for duplicates (definedLabels Map only keeps last)
        for (let i = 0; i < lines.length; i++) {
            const stripped = stripComment(lines[i]);
            const m = stripped.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*$/);
            if (m) {
                const name = m[1].toUpperCase();
                if (!labelCount.has(name)) {
                    labelCount.set(name, []);
                }
                labelCount.get(name).push(i);
            }
        }
        for (const [name, lineNums] of labelCount) {
            if (lineNums.length > 1) {
                for (const ln of lineNums) {
                    diagnostics.push(makeDiag(
                        document.lineAt(ln).range,
                        `Duplicate label '${name}' (defined ${lineNums.length} times).`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
            }
        }
    }

    // NEW: Unused labels (defined but never referenced)
    {
        const referencedLabels = new Set();
        for (const ref of [...gotoRefs, ...gosubRefs]) {
            referencedLabels.add(ref.label);
        }
        for (const [name, info] of definedLabels) {
            if (!referencedLabels.has(name)) {
                diagnostics.push(makeDiag(
                    document.lineAt(info.line).range,
                    `Label '${name}' is defined but never used.`,
                    vscode.DiagnosticSeverity.Hint
                ));
            }
        }
    }

    // NEW: Variable used before definition
    {
        for (const use of usedVars) {
            const defLine = definedVars.get(use.name);
            // Skip if on the !LET line itself (the $var# on LHS)
            if (defLine === use.line) continue;
            if (defLine === undefined) {
                // Variable never defined — might be from !VARLOAD, !SCREEN, etc.
                // Only hint, not error
                diagnostics.push(makeDiag(
                    lineRange(document, use.line, use.col, use.name.length + 2),
                    `Variable '$${use.name}#' is used but never defined with !LET or !SETVAL in this file.`,
                    vscode.DiagnosticSeverity.Hint
                ));
            } else if (use.line < defLine) {
                diagnostics.push(makeDiag(
                    lineRange(document, use.line, use.col, use.name.length + 2),
                    `Variable '$${use.name}#' is used before its first !LET definition (line ${defLine + 1}).`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    // NEW: Unused variables (defined but never read)
    {
        const usedVarNames = new Set(usedVars.map(v => v.name));
        for (const [name, defLine] of definedVars) {
            // Count uses that are NOT on the definition line itself
            const externalUses = usedVars.filter(v => v.name === name && v.line !== defLine);
            if (externalUses.length === 0) {
                diagnostics.push(makeDiag(
                    document.lineAt(defLine).range,
                    `Variable '$${name}#' is defined but never used.`,
                    vscode.DiagnosticSeverity.Hint
                ));
            }
        }
    }

    // NEW: Duplicate !ONERR (only the last one is active)
    if (onerrLabels.length > 1) {
        for (let idx = 0; idx < onerrLabels.length - 1; idx++) {
            diagnostics.push(makeDiag(
                document.lineAt(onerrLabels[idx].line).range,
                `This !ONERR is overridden by a later !ONERR on line ${onerrLabels[onerrLabels.length - 1].line + 1}. Only the last !ONERR is active.`,
                vscode.DiagnosticSeverity.Warning
            ));
        }
    }

    // NEW: !GOSUB target label without !RETURN
    for (const ref of gosubRefs) {
        if (definedLabels.has(ref.label)) {
            const hasRet = labelHasReturn.get(ref.label);
            if (hasRet === false) {
                diagnostics.push(makeDiag(
                    lineRange(document, ref.line, ref.col, ref.label.length),
                    `!GOSUB to '${ref.label}' but that subroutine has no !RETURN.`,
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    // NEW: !RETURN not inside any known GOSUB target subroutine
    // (We check if the RETURN is between a GOSUB-target label and next label/END)
    // Simple heuristic: check if !RETURN appears before any label is defined
    // or the label it's under is never called with !GOSUB
    {
        // Build map of line -> label for each line (which label section it belongs to)
        const labelLines = [...definedLabels.entries()]
            .map(([name, info]) => ({ name, line: info.line }))
            .sort((a, b) => a.line - b.line);

        for (const retLine of returnLines) {
            // Find which label section this RETURN is in
            let inLabel = null;
            for (const lbl of labelLines) {
                if (lbl.line <= retLine) {
                    inLabel = lbl.name;
                } else {
                    break;
                }
            }
            if (inLabel === null || !gosubTargets.has(inLabel)) {
                diagnostics.push(makeDiag(
                    document.lineAt(retLine).range,
                    '!RETURN is not inside a subroutine called by !GOSUB.',
                    vscode.DiagnosticSeverity.Warning
                ));
            }
        }
    }

    // NEW: No !START found in file
    if (!hasStart && lines.length > 3) {
        diagnostics.push(makeDiag(
            document.lineAt(0).range,
            'No !START found in this macro file.',
            vscode.DiagnosticSeverity.Warning
        ));
    }

    diagnosticCollection.set(document.uri, diagnostics);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Strip inline comment from line, respecting strings */
function stripComment(line) {
    // Remove !REM lines entirely
    if (/^\s*!REM\b/i.test(line)) return '';
    // Walk character by character to handle # inside quoted strings
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
        if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
        if (!inSingle && !inDouble && ch === '#') {
            // # at start or after whitespace = comment
            if (i === 0 || /\s/.test(line[i - 1])) {
                return line.substring(0, i);
            }
        }
    }
    return line;
}

/** Create a diagnostic */
function makeDiag(range, message, severity) {
    const d = new vscode.Diagnostic(range, message, severity);
    d.source = 'DM Macro';
    return d;
}

/** Create range for a specific column in a line */
function lineRange(document, lineNum, col, length) {
    const line = document.lineAt(lineNum);
    const raw = line.text;
    const trimOffset = raw.length - raw.trimStart().length;
    const start = new vscode.Position(lineNum, trimOffset + col);
    const end   = new vscode.Position(lineNum, trimOffset + col + length);
    return new vscode.Range(start, end);
}

function deactivate() {
    if (diagnosticCollection) diagnosticCollection.clear();
}

module.exports = { activate, deactivate };
