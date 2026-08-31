export default function HomePage() {
  return (
    <section className="searchPage">
      <div>
        <p className="eyebrow">Frankfurt student housing</p>
        <h1>Find current housing</h1>
      </div>

      <form className="searchForm" action="/housing" method="get">
        <label>
          University
          <select name="university" defaultValue="frankfurt_uas">
            <option value="frankfurt_uas">Frankfurt UAS</option>
            <option value="goethe">Goethe University</option>
          </select>
        </label>

        <label>
          Maximum monthly budget
          <select name="maxRent" defaultValue="500">
            <option value="500">€500</option>
            <option value="600">€600</option>
            <option value="700">€700</option>
          </select>
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

        <button type="submit">Find housing</button>
      </form>
    </section>
  );
}
