import Link from 'next/link';
import { notFound } from 'next/navigation';

import { factText, freshnessText, getHousing } from '../../lib/housing';

function statusClass(status: string): string {
  return status === 'CONFIRMED' ? 'status confirmed' : status === 'NOT_STATED' ? 'status unknown' : 'status caution';
}

export default async function HousingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getHousing(slug);
  if (!listing) notFound();

  const facts = [
    ['Room type', factText(listing.facts, 'roomType')],
    ['Area', factText(listing.facts, 'area')],
    ['Move-in', factText(listing.facts, 'availableFrom')],
    ['Rent', factText(listing.facts, 'totalMonthlyRent')],
    ['University eligibility', factText(listing.facts, 'eligibleUniversities')],
    ['Anmeldung', factText(listing.facts, 'anmeldung')],
  ] as const;

  return (
    <article className="detailPage">
      <div className="breadcrumbs"><Link href="/housing">Housing</Link><span>/</span><span>Listing {listing.id}</span></div>
      <div className="pageHeading">
        <div>
          <p className="eyebrow">Listing {listing.id}</p>
          <h1>{factText(listing.facts, 'roomType').value}</h1>
          <p>{factText(listing.facts, 'area').value}</p>
        </div>
        <a className="primaryButton" href={listing.sourceUrl} target="_blank" rel="noreferrer">Open original listing ↗</a>
      </div>

      <section className="freshnessPanel">
        <strong>{listing.lifecycleState}</strong>
        <span>{freshnessText(listing.lastConfirmedActiveAt)}</span>
      </section>

      <section className="detailFacts">
        <h2>Facts from the source</h2>
        <dl>
          {facts.map(([label, extracted]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <span>{extracted.value}</span>
                <span className={statusClass(extracted.status)}>{extracted.status.replace('_', ' ').toLowerCase()}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {factText(listing.facts, 'totalMonthlyRent').status === 'NOT_STATED' ? (
        <p className="note">Rent is not stated in Radar. Check the original listing for the actual price before applying.</p>
      ) : null}

      <p className="smallNote">Radar shows only what its source supports. “Not stated” means the source data available to Radar did not confirm that fact.</p>
    </article>
  );
}
