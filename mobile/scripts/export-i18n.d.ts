export const SOURCE: string;
export const OUT_DIR: string;
export const LANGUAGES: string[];
export function extractLiteral(source: string): string;
export function extractDictionaries(source: string): Record<string, Record<string, string>>;
export function render(dictionary: Record<string, string>): string;
export function expectedFiles(): Record<string, string>;
