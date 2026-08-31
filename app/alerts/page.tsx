import { authRepository, currentUser } from '../lib/authServer';

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await currentUser();

  if (!user) {
    return (
      <section className="alertsPage">
        <div className="pageHeading">
          <div>
            <p className="eyebrow">Email alerts</p>
            <h1>Alerts</h1>
            <p>Sign in with a one-time email link to create and manage saved searches.</p>
          </div>
        </div>
        {one(params.sent) === '1' ? <p className="successNote">If the request was accepted, a sign-in link is on its way. It expires in 15 minutes.</p> : null}
        {one(params.error) === 'invalid_email' ? <p className="note">Enter a valid email address.</p> : null}
        {one(params.error) === 'expired_link' || one(params.error) === 'invalid_link' ? <p className="note">That sign-in link is invalid, expired, or has already been used. Request a new one.</p> : null}
        {one(params.error) === 'send_failed' ? <p className="note">Radar could not send the sign-in email. Please try again.</p> : null}
        <form className="searchForm authForm" action="/api/auth/request-link" method="post">
          <label>
            Email
            <input type="email" name="email" autoComplete="email" required placeholder="student@example.com" />
          </label>
          <button type="submit">Email me a sign-in link</button>
          <p className="smallNote">For abuse protection, Radar will not send repeated magic links to the same address within a short window.</p>
        </form>
      </section>
    );
  }

  const searches = await authRepository().listSavedSearches(user.id);
  return (
    <section className="alertsPage">
      <div className="pageHeading">
        <div>
          <p className="eyebrow">Email alerts</p>
          <h1>Alerts</h1>
          <p>Signed in as {user.email}</p>
        </div>
        <form action="/api/auth/logout" method="post"><button className="secondaryButton" type="submit">Sign out</button></form>
      </div>

      {one(params.created) === '1' ? <p className="successNote">Alert created.</p> : null}
      {one(params.error) === 'invalid_search' ? <p className="note">Check the alert fields and try again.</p> : null}
      {one(params.error) === 'not_found' ? <p className="note">That saved search was not found.</p> : null}

      <div className="alertsLayout">
        <form className="searchForm" action="/api/saved-searches" method="post">
          <h2>Create an alert</h2>
          <label>
            University
            <select name="university" defaultValue="frankfurt_uas">
              <option value="frankfurt_uas">Frankfurt UAS</option>
              <option value="goethe">Goethe University</option>
            </select>
          </label>
          <label>
            Maximum monthly rent
            <input name="maxRent" type="number" min="1" max="5000" step="1" defaultValue="500" required />
          </label>
          <label>
            Move-in month
            <input name="moveInMonth" type="month" />
          </label>
          <fieldset>
            <legend>Housing type</legend>
            <label className="check"><input type="checkbox" name="type" value="dorm" defaultChecked /> Dorm</label>
            <label className="check"><input type="checkbox" name="type" value="wg" defaultChecked /> WG room</label>
            <label className="check"><input type="checkbox" name="type" value="studio" defaultChecked /> Studio</label>
          </fieldset>
          <button type="submit">Create email alert</button>
          <p className="smallNote">If rent is not stated by the source, Radar can still alert you on the criteria it can verify and will tell you to check the source price.</p>
        </form>

        <div className="savedSearches">
          <h2>Your saved searches</h2>
          {searches.length === 0 ? <div className="empty">No saved searches yet.</div> : null}
          {searches.map((search) => (
            <article className="savedSearchCard" key={search.id}>
              <div>
                <strong>{search.university === 'frankfurt_uas' ? 'Frankfurt UAS' : 'Goethe University'}</strong>
                <p>≤ €{search.maxTotalMonthlyRent} · {search.moveInMonth ? search.moveInMonth.slice(0, 7) : 'any move-in month'} · {search.housingTypes.join(', ')}</p>
                <span className={search.isActive ? 'status confirmed' : 'status unknown'}>{search.isActive ? 'active' : 'paused'}</span>
              </div>
              <div className="savedSearchActions">
                <form action={`/api/saved-searches/${search.id}/toggle`} method="post">
                  <input type="hidden" name="active" value={search.isActive ? 'false' : 'true'} />
                  <button className="secondaryButton" type="submit">{search.isActive ? 'Pause' : 'Resume'}</button>
                </form>
                <form action={`/api/saved-searches/${search.id}/delete`} method="post">
                  <button className="secondaryButton dangerButton" type="submit">Delete</button>
                </form>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
