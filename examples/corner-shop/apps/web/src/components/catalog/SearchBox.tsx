/** A plain GET form to /search: it works before any JavaScript loads, and the results page is linkable. */
export function SearchBox({ query = '' }: { query?: string }) {
  return (
    <form role="search" action="/search" className="search-box">
      <label className="visually-hidden" htmlFor="search-q">
        Search the shop
      </label>
      <input id="search-q" name="q" type="search" defaultValue={query} placeholder="Search mugs, totes, SKUs…" minLength={2} required />
    </form>
  );
}
