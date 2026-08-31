import pg from 'pg';

export type FactStatus = 'CONFIRMED' | 'INFERRED' | 'NOT_STATED' | 'CONFLICTING';
export type Fact = { value?: unknown; status: FactStatus; evidence?: string };
export type ListingFacts = Record<string, Fact | undefined>;

export type HousingListing = {
  id: string;
  lifecycleState: 'NEW' | 'ACTIVE' | 'POSSIBLY_STALE' | 'INACTIVE' | 'REMOVED';
  facts: ListingFacts;
  sourceUrl: string;
  lastConfirmedActiveAt: Date | null;
};

export type HousingFilters = {
  university?: 'frankfurt_uas' | 'goethe';
  maxRent?: number;
  moveInMonth?: string;
  housingTypes?: string[];
};

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to render housing data');
  pool ??= new pg.Pool({ connectionString: databaseUrl, max: 5 });
  return pool;
}

function fact<T>(facts: ListingFacts, key: string): { value: T | undefined; status: FactStatus } | null {
  const raw = facts[key];
  if (!raw) return null;
  return { value: raw.value as T | undefined, status: raw.status };
}

function monthOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (iso) return `${iso[1]}-${iso[2]}`;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  return de ? `${de[3]}-${de[2]?.padStart(2, '0')}` : null;
}

export function classifyHousingType(facts: ListingFacts): 'dorm' | 'wg' | 'studio' | null {
  const roomType = fact<string>(facts, 'roomType');
  if (!roomType || roomType.status === 'NOT_STATED' || roomType.status === 'CONFLICTING') return null;
  const value = roomType.value?.toLowerCase() ?? '';
  if (/wohnheim|dorm|studentenwohn/.test(value)) return 'dorm';
  if (/studio|apartment|wohnung|1-zimmer/.test(value)) return 'studio';
  if (/wg|zimmer|room/.test(value)) return 'wg';
  return null;
}

export function listingMatches(listing: HousingListing, filters: HousingFilters): boolean {
  if (listing.lifecycleState !== 'NEW' && listing.lifecycleState !== 'ACTIVE') return false;

  if (filters.maxRent) {
    const rent = fact<number>(listing.facts, 'totalMonthlyRent');
    if (rent?.status === 'CONFIRMED') {
      if (typeof rent.value !== 'number' || rent.value > filters.maxRent) return false;
    } else if (rent && rent.status !== 'NOT_STATED') {
      return false;
    }
  }

  if (filters.moveInMonth) {
    const moveIn = fact<string>(listing.facts, 'availableFrom');
    if (!moveIn || moveIn.status === 'NOT_STATED' || moveIn.status === 'CONFLICTING') return false;
    if (monthOf(moveIn.value) !== filters.moveInMonth) return false;
  }

  if (filters.housingTypes?.length) {
    const kind = classifyHousingType(listing.facts);
    if (kind && !filters.housingTypes.includes(kind)) return false;
    if (!kind && filters.housingTypes.length < 3) return false;
  }

  if (filters.university) {
    const eligible = fact<string[]>(listing.facts, 'eligibleUniversities');
    if (eligible && eligible.status === 'CONFIRMED' && Array.isArray(eligible.value) && !eligible.value.includes(filters.university)) return false;
    if (eligible && (eligible.status === 'INFERRED' || eligible.status === 'CONFLICTING')) return false;
  }

  return true;
}

type ListingRow = {
  id: string;
  lifecycle_state: HousingListing['lifecycleState'];
  extracted_facts: ListingFacts;
  last_confirmed_active_at: Date | null;
  source_url: string;
};

const BASE_QUERY = `SELECT
  l.id,
  l.lifecycle_state,
  l.extracted_facts,
  l.last_confirmed_active_at,
  source_link.source_url
FROM listings l
JOIN LATERAL (
  SELECT si.source_url
  FROM listing_source_items lsi
  JOIN source_items si ON si.id = lsi.source_item_id
  WHERE lsi.listing_id = l.id
  ORDER BY si.last_seen_at DESC, si.id ASC
  LIMIT 1
) source_link ON TRUE`;

function mapListing(row: ListingRow): HousingListing {
  return {
    id: String(row.id),
    lifecycleState: row.lifecycle_state,
    facts: row.extracted_facts ?? {},
    sourceUrl: row.source_url,
    lastConfirmedActiveAt: row.last_confirmed_active_at ? new Date(row.last_confirmed_active_at) : null,
  };
}

export async function listHousing(filters: HousingFilters = {}): Promise<HousingListing[]> {
  const result = await getPool().query<ListingRow>(`${BASE_QUERY}\nWHERE l.lifecycle_state IN ('NEW', 'ACTIVE')\nORDER BY l.last_confirmed_active_at DESC NULLS LAST, l.id DESC`);
  return result.rows.map(mapListing).filter((listing) => listingMatches(listing, filters));
}

export async function getHousing(id: string): Promise<HousingListing | null> {
  if (!/^\d+$/.test(id)) return null;
  const result = await getPool().query<ListingRow>(`${BASE_QUERY}\nWHERE l.id = $1\nLIMIT 1`, [id]);
  return result.rows[0] ? mapListing(result.rows[0]) : null;
}

export function factText(facts: ListingFacts, key: string): { value: string; status: FactStatus } {
  const raw = facts[key];
  if (!raw || raw.status === 'NOT_STATED' || raw.value === null || raw.value === undefined || raw.value === '') {
    return { value: 'Not stated', status: 'NOT_STATED' };
  }
  return { value: Array.isArray(raw.value) ? raw.value.join(', ') : String(raw.value), status: raw.status };
}

export function freshnessText(date: Date | null): string {
  if (!date) return 'Active status has no confirmation timestamp yet';
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 2) return 'Last confirmed active just now';
  if (minutes < 60) return `Last confirmed active ${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last confirmed active ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Last confirmed active ${days} day${days === 1 ? '' : 's'} ago${days >= 3 ? ' — may be gone' : ''}`;
}
