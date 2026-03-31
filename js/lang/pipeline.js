// ============================================================================
// ArenaScript Compilation Pipeline — Source → Compiled Program
// ============================================================================
import { Lexer } from "./tokens.js";
import { Parser } from "./parser.js";
import { SemanticAnalyzer } from "./semantic.js";
import { Compiler } from "./compiler.js";
/** Compile ArenaScript source code through the full pipeline */
export function compile(source) {
    const errors = [];
    // Step 1: Lexing
    let tokens;
    try {
        const lexer = new Lexer(source);
        tokens = lexer.tokenize();
    }
    catch (e) {
        return {
            success: false,
            diagnostics: [],
            errors: [`Lexer error: ${e instanceof Error ? e.message : String(e)}`],
        };
    }
    // Step 2: Parsing
    let ast;
    try {
        const parser = new Parser(tokens);
        ast = parser.parse();
    }
    catch (e) {
        return {
            success: false,
            diagnostics: [],
            errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`],
        };
    }
    // Step 3: Semantic Analysis
    const analyzer = new SemanticAnalyzer();
    const diagnostics = analyzer.analyze(ast);
    const hasErrors = diagnostics.some(d => d.severity === "error");
    if (hasErrors) {
        return {
            success: false,
            diagnostics,
            errors: diagnostics.filter(d => d.severity === "error").map(d => d.message),
        };
    }
    // Step 4: Compilation to bytecode
    let program;
    let constants = [];
    try {
        const compiler = new Compiler();
        const output = compiler.compile(ast);
        program = output.program;
        constants = output.constants;
    }
    catch (e) {
        return {
            success: false,
            diagnostics,
            errors: [`Compile error: ${e instanceof Error ? e.message : String(e)}`],
        };
    }
    return {
        success: true,
        program,
        constants,
        diagnostics,
        errors: [],
    };
}
