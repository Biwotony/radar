import * as cheerio from 'cheerio';

import type {
  ExtractedFact,
  HousingSource,
  Observation,
  RawItem,
} from './types.js';

const INDEX_URL = 'https://www.wohnraum-gesucht.de/wohnraumangebote';
const DETAIL_PARAM = 'tx_powermail_pi2[mail]';

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractExternalId(href: string): { externalId: string; sourceUrl: string } | null {
  try {
    const url = new URL(href, INDEX_URL);
    const externalId = url.searchParams.get(DETAIL_PARAM);

    if (!externalId || !/^\d+$/.test(externalId)) {
      return null;
    }

    return {
      externalId,
      sourceUrl: url.toString(),
    };
  } catch {
    return null;
  }
}

function sanitizeArea(areaCandidate: string): string | null {
  const candidate = collapseWhitespace(areaCandidate).replace(/^in\s+/i, '');

  if (!candidate) {
    return null;
  }

  // If an exact street precedes a postal code, retain only coarse location metadata.
  const postalLocality = candidate.match(/\b(\d{5}\s+[A-Za-zÄÖÜäöüß][^,]*)/);
  if (postalLocality) {
    return collapseWhitespace(postalLocality[1]);
  }

  const frankfurt = candidate.match(/\bFrankfurt(?:\s+am\s+Main)?(?:\s+[A-Za-zÄÖÜäöüß-]+)?/i);
  if (frankfurt) {
    return collapseWhitespace(frankfurt[0]);
  }

  const offenbach = candidate.match(/\bOffenbach(?:\s+am\s+Main)?(?:\s+[A-Za-zÄÖÜäöüß-]+)?/i);
  if (offenbach) {
    return collapseWhitespace(offenbach[0]);
  }

  // Avoid retaining likely street-level location data from this metadata-only source.
  if (/\d|straße|strasse|weg|allee|platz|gasse|ring\b/i.test(candidate)) {
    return null;
  }

  return candidate.length <= 80 ? candidate : null;
}

function parseSummary(summaryText: string): Pick<RawItem, 'roomType' | 'area' | 'availableFromRaw'> {
  const summary = collapseWhitespace(summaryText);
  const availabilityMatch = summary.match(/,?\s*frei\s+ab:\s*(.+)$/i);
  const availableFromRaw = availabilityMatch
    ? collapseWhitespace(availabilityMatch[1])
    : null;

  const beforeAvailability = availabilityMatch
    ? collapseWhitespace(summary.slice(0, availabilityMatch.index))
    : summary;

  const locationSplitIndex = beforeAvailability.toLocaleLowerCase('de-DE').lastIndexOf(' in ');

  if (locationSplitIndex === -1) {
    return {
      roomType: beforeAvailability || null,
      area: null,
      availableFromRaw,
    };
  }

  const roomType = collapseWhitespace(beforeAvailability.slice(0, locationSplitIndex));
  const areaCandidate = beforeAvailability.slice(locationSplitIndex + 4);

  return {
    roomType: roomType || null,
    area: sanitizeArea(areaCandidate),
    availableFromRaw,
  };
}

export function parseIndexHtml(html: string): RawItem[] {
  const $ = cheerio.load(html);
  const items = new Map<string, RawItem>();

  $('a[href*="tx_powermail_pi2"]').each((_index, element) => {
    const href = $(element).attr('href');
    if (!href) {
      return;
    }

    const identity = extractExternalId(href);
    if (!identity) {
      return;
    }

    const summaryText = collapseWhitespace($(element).text());
    if (!summaryText) {
      return;
    }

    const metadata = parseSummary(summaryText);

    items.set(identity.externalId, {
      ...identity,
      ...metadata,
    });
  });

  return [...items.values()];
}

function confirmedOrNotStated(value: string | null): ExtractedFact<string> {
  if (value === null) {
    return { value: null, status: 'NOT_STATED' };
  }

  return {
    value,
    status: 'CONFIRMED',
    evidence: value,
  };
}

export class WohnraumGesuchtSource implements HousingSource {
  async fetch(): Promise<RawItem[]> {
    // Audited 2026-08-30: the live index is single-page; if pagination appears later,
    // this fetch will need explicit traversal or results beyond page 1 would be missed.
    const response = await fetch(INDEX_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Radar/0.1 (+https://github.com/Biwotony/radar)',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`wohnraum-gesucht.de returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('text/html')) {
      throw new Error(`wohnraum-gesucht.de returned unexpected content type: ${contentType}`);
    }

    // The full page is parsed in memory only. Returned RawItems intentionally contain
    // detection metadata, not source descriptions or exact addresses.
    return parseIndexHtml(await response.text());
  }

  async parse(item: RawItem): Promise<Observation> {
    return {
      externalId: item.externalId,
      sourceUrl: item.sourceUrl,
      extractedFacts: {
        roomType: confirmedOrNotStated(item.roomType),
        area: confirmedOrNotStated(item.area),
        availableFrom: confirmedOrNotStated(item.availableFromRaw),
      },
    };
  }
}
