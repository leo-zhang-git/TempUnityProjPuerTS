import { readFileSync } from "node:fs";
import ts from "typescript";

function parseSource(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

export function importSpecifiers(path: string): string[] {
  const source = parseSource(path);
  const result: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      result.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) result.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

export function importedBindings(path: string): ReadonlyMap<string, readonly string[]> {
  const source = parseSource(path);
  const result = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = result.get(statement.moduleSpecifier.text) ?? [];
    const clause = statement.importClause;
    if (clause?.name) bindings.push("default");
    const named = clause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) bindings.push("*");
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) bindings.push(element.name.text);
    }
    result.set(statement.moduleSpecifier.text, bindings);
  }
  return result;
}

export function topLevelDeclarationNames(path: string): string[] {
  const source = parseSource(path);
  const names: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) names.push(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }
  return names;
}

export function nodeIdentifierNames(path: string): Set<string> {
  const source = parseSource(path);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

export function declaredMemberNames(path: string): Set<string> {
  const source = parseSource(path);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

export function asyncFunctionNames(path: string): Set<string> {
  const source = parseSource(path);
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const isFunction =
      ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
    if (isFunction && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      if (node.name && ts.isIdentifier(node.name)) names.add(node.name.text);
      else names.add("<anonymous>");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}
