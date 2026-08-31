import Link from 'next/link';

import { factText, freshnessText, listHousing, type HousingFilters } from '../lib/housing';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function filtersFrom(params: SearchParams): HousingFilters {
  const university = one(params.university);
  const maxRent = Number(one(params.maxRent));
  return {
    university: university === 'goethe' ? 'goethe' : university === 'frankfurt_uas' ? 'frankfurt_uas' : undefined,
    maxRent: Number.isFinite(maxRent) && maxRent > 0 ? maxRent : undefined,
    moveInMonth: one(params.moveInMonth) || undefined,
    housingTypes: many(params.type).filter((value) => ['dorm', 'wg', 'studio'].includes(value)),
  };
}

function statusClass(status: string): string {
  return status === 'CONFIRMED' ? 'status confirmed' : status === 'NOT_STATED' ? 'status unknown' : 'status caution';
}

export default async function HousingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const filters = filtersFrom(params);
  const listings = await listHousing(filters);

  return (
    <section>
      <div className="pageHeading">
        <div>
          <p className="eyebrow">Current matches</p>
          <h1>Housing</h1>
          <p>{listings.length} active listing{listings.length === 1 ? '' : 's'}, freshest first.</p>
        </div>
        <Link className="secondaryButton" href="/">New search</Link>
      </div>

      <details className="mobileFilters">
        <summary>Filters</summary>
        <FilterSummary filters={filters} />
      </details>

      <div className="resultsLayout">
        <aside className="filterSidebar"><FilterSummary filters={filters} /></aside>
        <div className="cards">
          {listings.length === 0 ? <div className="empty">No active listings match these filters.</div> : null}
          {listings.map((listing) => {
            const room = factText(listing.facts, 'roomType');
            const area = factText(listing.facts, 'area');
            const moveIn = factText(listing.facts, 'availableFrom');
            const rent = factText(listing.facts, 'totalMonthlyRent');
            return (
              <article className="listingCard" key={listing.id}>
                <div className="cardTopline"><span>{freshnessText(listing.lastConfirmedActiveAt)}</span><span>{listing.lifecycleState}</span></div>
                <h2>{room.value}</h2>
                <p className="area">{area.value}</p>
                <dl className="factGrid">
                  <div><dt>Move-in</dt><dd>{moveIn.value} <span className={statusClass(moveIn.status)}>{moveIn.status.replace('_', ' ').toLowerCase()}</span></dd></div>
                  <div><dt>Rent</dt><dd>{rent.value} <span className={statusClass(rent.status)}>{rent.status.replace('_', ' ').toLowerCase()}</span></dd></div>
                  <div><dt>Area</dt><dd><span className={statusClass(area.status)}>{area.status.replace('_', ' ').toLowerCase()}</span></dd></div>
                </dl>
                {rent.status === 'NOT_STATED' ? <p className="note">Rent is not stated in Radar. Check the original listing for the actual price before applying.</p> : null}
                <div className="cardActions">
                  <Link href={`/housing/${listing.id}`}>View details</Link>
                  <a href={listing.sourceUrl} target="_blank" rel="noreferrer">Original source ↗</a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FilterSummary({ filters }: { filters: HousingFilters }) {
  return (
    <div className="filterSummary">
      <h2>Filters</h2>
      <dl>
        <div><dt>University</dt><dd>{filters.university === 'goethe' ? 'Goethe University' : filters.university === 'frankfurt_uas' ? 'Frankfurt UAS' : 'Any'}</dd></div>
        <div><dt>Budget</dt><dd>{filters.maxRent ? `≤ €${filters.maxRent}` : 'Any'}</dd></div>
        <div><dt>Move-in</dt><dd>{filters.moveInMonth || 'Any'}</dd></div>
        <div><dt>Type</dt><dd>{filters.housingTypes?.length ? filters.housingTypes.join(', ') : 'Any'}</dd></div>
      </dl>
      <p className="smallNote">Listings with unstated rent can appear because Radar is not claiming they fit your budget; verify price on the source page.</p>
    </div>
  );
}
