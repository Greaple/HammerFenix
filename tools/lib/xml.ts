import { XMLParser } from 'fast-xml-parser';

/** Minimal ordered XML element tree, close to Flash's XmlNode API. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated text content of direct text children (untrimmed). */
  text: string;
}

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  commentPropName: '#comment',
});

type OrderedNode = Record<string, unknown> & { ':@'?: Record<string, string> };

function convert(node: OrderedNode): XmlElement | null {
  const name = Object.keys(node).find((k) => k !== ':@');
  if (!name || name === '#text' || name === '#comment') return null;
  const rawChildren = (node[name] as OrderedNode[]) ?? [];
  const children: XmlElement[] = [];
  let text = '';
  for (const c of rawChildren) {
    if ('#text' in c) text += String(c['#text']);
    else {
      const el = convert(c);
      if (el) children.push(el);
    }
  }
  return { name, attrs: { ...(node[':@'] ?? {}) }, children, text };
}

/** Parses an XML document and returns its root element. */
export function parseXml(source: string): XmlElement {
  const clean = source.replace(/^\uFEFF/, '');
  const nodes = parser.parse(clean) as OrderedNode[];
  for (const n of nodes) {
    const el = convert(n);
    if (el) return el;
  }
  throw new Error('XML document has no root element');
}

/** Returns the first direct child with the given name (throws if missing). */
export function child(el: XmlElement, name: string): XmlElement {
  const c = el.children.find((x) => x.name === name);
  if (!c) throw new Error(`<${el.name}> has no <${name}> child`);
  return c;
}

/** AS2 `int(str)` semantics: NaN/undefined become 0. */
export function int(v: string | undefined): number {
  const n = parseInt(v ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
}
