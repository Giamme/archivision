import type { Address } from '@corner/db';

export const COUNTRIES: Array<[code: string, name: string]> = [
  ['IE', 'Ireland'],
  ['NL', 'Netherlands'],
  ['BE', 'Belgium'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['ES', 'Spain'],
  ['IT', 'Italy'],
  ['PT', 'Portugal'],
  ['AT', 'Austria'],
  ['DK', 'Denmark'],
  ['SE', 'Sweden'],
  ['FI', 'Finland'],
  ['LU', 'Luxembourg'],
];

/** The address fields, shared by the checkout and the address book. The surrounding form decides what submits. */
export function AddressForm({ address, withLabel = false }: { address?: Partial<Address> | null; withLabel?: boolean }) {
  return (
    <fieldset className="address-form">
      {address?.id && <input type="hidden" name="id" value={address.id} />}
      {withLabel && (
        <label>
          Label (home, work…) <input name="label" defaultValue={address?.label ?? ''} />
        </label>
      )}
      <label>
        Full name <input name="name" required autoComplete="name" defaultValue={address?.name ?? ''} />
      </label>
      <label>
        Street and number <input name="line1" required autoComplete="address-line1" defaultValue={address?.line1 ?? ''} />
      </label>
      <label>
        Apartment, floor (optional) <input name="line2" autoComplete="address-line2" defaultValue={address?.line2 ?? ''} />
      </label>
      <label>
        Postcode <input name="postalCode" required autoComplete="postal-code" defaultValue={address?.postalCode ?? ''} />
      </label>
      <label>
        City <input name="city" required autoComplete="address-level2" defaultValue={address?.city ?? ''} />
      </label>
      <label>
        Country
        <select name="country" required defaultValue={address?.country ?? 'IE'} autoComplete="country">
          {COUNTRIES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Phone, for the courier (optional) <input name="phone" type="tel" autoComplete="tel" defaultValue={address?.phone ?? ''} />
      </label>
    </fieldset>
  );
}
