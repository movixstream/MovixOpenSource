import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exécute le vrai callback d'un composant volumineux sans monter ses lecteurs,
// requêtes réseau et SDK. Les dépendances fournies simulent seulement le DOM
// et les services du scénario de régression.
export function sourceFunction(file, name, bindings = {}, includes = '') {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer?.getText(source).includes(includes)) {
      expression = node.initializer.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error(`Callback ${name} introuvable dans ${file}`);
  const js = ts.transpile(`const callback = ${expression};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return new Function(...Object.keys(bindings), `${js}\nreturn callback;`)(...Object.values(bindings));
}

export function sourceEffect(file, includes, bindings = {}) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes(includes)) {
      expression = node.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error(`Effet introuvable dans ${file}: ${includes}`);
  const js = ts.transpile(`const effect = ${expression};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return new Function(...Object.keys(bindings), `${js}\nreturn effect;`)(...Object.values(bindings));
}

export function sourceJsxHandler(file, attribute, includes, bindings = {}) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === attribute
      && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression?.getText(source).includes(includes)) {
      expression = node.initializer.expression.getText(source);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!expression) throw new Error(`Gestionnaire JSX introuvable dans ${file}: ${includes}`);
  const js = ts.transpile(`const handler = ${expression};`, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None });
  return new Function(...Object.keys(bindings), `${js}\nreturn handler;`)(...Object.values(bindings));
}
