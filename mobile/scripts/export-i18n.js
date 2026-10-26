/**
 * Exports the website's UI translations (static/i18n.js) to src/i18n/en.json and th.json, so the website and the app say
 * the same thing until the website is retired. The dictionaries live in a closure in that file, so this finds the
 * `const DICTIONARIES = {...}` literal by brace-matching (aware of string literals) and evaluates just that literal.
 *
 *   node scripts/export-i18n.js          # rewrite the JSON files
 *   node scripts/export-i18n.js --check  # exit 1 if they are out of date (the Jest suite does the same)
 */
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'static', 'i18n.js');
const OUT_DIR = path.join(__dirname, '..', 'src', 'i18n');
const LANGUAGES = ['en', 'th'];

function extractLiteral(source) {
  const start = source.indexOf('const DICTIONARIES = ');
  if (start < 0) throw new Error('const DICTIONARIES not found in static/i18n.js');
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i) - 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i) + 1;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced braces in DICTIONARIES');
}

function extractDictionaries(source) {
  const dictionaries = new Function(`return (${extractLiteral(source)});`)();
  for (const lang of LANGUAGES) {
    if (!dictionaries[lang] || typeof dictionaries[lang] !== 'object') throw new Error(`no ${lang} dictionary`);
  }
  return dictionaries;
}

/** The exact text written to a language's JSON file (sorted keys would hide the website's own ordering, so they are kept). */
function render(dictionary) {
  return JSON.stringify(dictionary, null, 2) + '\n';
}

function expectedFiles() {
  const dictionaries = extractDictionaries(fs.readFileSync(SOURCE, 'utf8'));
  return Object.fromEntries(LANGUAGES.map((lang) => [path.join(OUT_DIR, `${lang}.json`), render(dictionaries[lang])]));
}

if (require.main === module) {
  const files = expectedFiles();
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([file, text]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text);
    if (stale.length) {
      console.error(`out of date: ${stale.map(([f]) => path.basename(f)).join(', ')} (run: node scripts/export-i18n.js)`);
      process.exit(1);
    }
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const [file, text] of Object.entries(files)) fs.writeFileSync(file, text);
    console.log(`wrote ${Object.keys(files).length} files`);
  }
}

module.exports = { extractLiteral, extractDictionaries, render, expectedFiles, SOURCE, OUT_DIR, LANGUAGES };
