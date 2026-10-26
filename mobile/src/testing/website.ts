/**
 * Helpers for the PARITY tests: they run the website's own code (static/*.js, and functions lifted out of templates/*.html) so the
 * app's ported logic is compared against the original, not against a second guess at what the original does.
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = path.join(__dirname, '..', '..', '..');

export function readRepoFile(...parts: string[]): string {
  return fs.readFileSync(path.join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');
}

/** Index just past the `}` closing the first `{` at or after `from`. Understands strings, template literals (nested `${}`) and comments. */
export function matchingBrace(source: string, from: number): number {
  const stack: ('template' | 'brace')[] = [];
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    const top = stack[stack.length - 1];
    if (top === 'template') {
      if (ch === '\\') i++;
      else if (ch === '`') stack.pop();
      else if (ch === '$' && source[i + 1] === '{') {
        stack.push('brace');
        i++;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === '\\') i++;
    } else if (ch === '`') {
      stack.push('template');
    } else if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
    } else if (ch === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i) + 1;
    } else if (ch === '{') {
      stack.push('brace');
    } else if (ch === '}') {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  throw new Error('unbalanced braces');
}

/** The full source text of `function name(...) {...}` (or `async function`) found in a script. */
export function extractFunction(source: string, name: string): string {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`function ${name} not found`);
  // The body's `{` comes after the parameter list, which may itself hold braces (a destructured parameter).
  let depth = 0;
  let i = match.index + match[0].length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) break;
  }
  return source.slice(match.index, matchingBrace(source, source.indexOf('{', i)));
}

/** The text of `const NAME = ...;` (an object/array/regex-bearing literal) up to its closing bracket and semicolon. */
export function extractConst(source: string, name: string): string {
  const start = source.indexOf(`const ${name} =`);
  if (start < 0) throw new Error(`const ${name} not found`);
  const open = source.slice(start).search(/[[{]/) + start;
  const end = matchingBracket(source, open);
  return source.slice(start, source.indexOf(';', end) + 1);
}

function matchingBracket(source: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '{': '}' };
  const closeFor = pairs[source[open]];
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "'") for (i++; i < source.length && source[i] !== ch; i++) if (source[i] === '\\') i++;
    if (ch === '/' && source[i + 1] === '/') i = source.indexOf('\n', i);
    if (ch === source[open]) depth++;
    if (ch === closeFor && --depth === 0) return i + 1;
  }
  throw new Error('unbalanced brackets');
}

/** Functions and constants lifted from a template, evaluated together so they can see each other; returns the named things. */
export function lift<T extends Record<string, unknown>>(source: string, pieces: string[], names: string[], scope: Record<string, unknown> = {}): T {
  const keys = Object.keys(scope);
  const body = `${pieces.join('\n')}\nreturn { ${names.join(', ')} };`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

export class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

/** Runs a website script (an IIFE that hangs things on `window`) in a sandbox and returns the sandbox's `window`. */
export function runWebsiteScript(file: string, setup: (window: Record<string, any>) => void, now?: Date): Record<string, any> {
  const source = readRepoFile('static', file);
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args: any[]) {
      if (args.length === 0 && now) super(now.getTime());
      else super(...(args as [any]));
    }
  }
  const window: Record<string, any> = {
    Date: now ? FakeDate : RealDate,
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    document: { addEventListener() {}, dispatchEvent() {} },
    CustomEvent: class {},
    setTimeout: () => 0,
    RepCheckI18n: { locale: () => 'en-US' },
    REPCHECK_LOGGED_IN: false,
    console,
    Math,
    JSON,
    Set,
    Array,
    Object,
    String,
    Number,
    isFinite,
    isNaN,
    parseFloat,
  };
  window.window = window;
  setup(window);
  vm.runInNewContext(source, window);
  return window;
}
