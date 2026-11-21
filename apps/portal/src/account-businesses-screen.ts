import {html, nothing} from 'lit';
import type {PortalApp} from './app.ts';

export function accountBusinessesScreen(app: PortalApp, countries: {code: string; name: string}[], countryNames: Intl.DisplayNames) {
  const c = app.copy, controller = app.businesses;
  const data = controller.data, busy = controller.pending || !!controller.waiting;
  if (data && !data.organisations.length && !data.canStartOrganisation) return nothing;
  const groups = data?.organisations.filter(group => group.canRegister) ?? [];
  const submit = (path: '/businesses' | '/organisations/rename') => async (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const body = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (!await controller.request(path, body)) return;
    if (path === '/businesses') form.reset();
    void app.transfers.load();
  };

  return html`<section id="account-businesses" aria-labelledby="businesses-heading">
    <h2 id="businesses-heading">${c.businessesTitle}</h2>
    ${controller.error ? html`<p role="alert">${controller.error === 'countryUnavailable' && controller.refusedCountry
      ? c.countryUnavailable.replace('{country}', countryNames.of(controller.refusedCountry)!) : c[controller.error]}</p>` : nothing}
    ${!data ? html`<wt-button .disabled=${busy} @click=${() => {void controller.request('/businesses');}}>${c.retry}</wt-button>` : nothing}
    ${data?.organisations.map(group => html`<div class="installation">
      <h3>${group.name || c.unnamedOrganisation}</h3>
      <ul>${data.businesses.filter(b => b.organisationId === group.id).map(b => html`<li>
        <strong>${b.legalName || c.unnamedBusiness}</strong>
        <dl><dt>${c.businessTaxNumber}</dt><dd>${b.taxNumber ?? '—'}</dd>
        <dt>${c.businessCountry}</dt><dd>${b.countryCode ? countryNames.of(b.countryCode) : '—'}</dd></dl></li>`)}</ul>
      <form class="business-choice" aria-label=${c.orgName + (group.name ? ' · ' + group.name : '')} @submit=${submit('/organisations/rename')}>
        <input type="hidden" name="organisationId" value=${group.id}>
        <label for=${'group-name-' + group.id}>${c.orgName}</label>
        <p class="help" id=${'group-hint-' + group.id}>${c.businessGroupHint}</p>
        <input type="text" id=${'group-name-' + group.id} name="name" .value=${group.name ?? ''} maxlength="200" required
          aria-describedby=${'group-hint-' + group.id} ?disabled=${busy}>
        <button class="text-button" type="submit" ?disabled=${busy}>${c.businessSaveName}</button>
      </form>
    </div>`)}
    ${groups.length || data?.canStartOrganisation ? html`<form class="business-choice" aria-label=${c.businessRegister} @submit=${submit('/businesses')}>
      ${groups.length > 1 ? html`<label for="business-group">${c.chooseOrganisation}</label>
        <select id="business-group" name="organisationId" required ?disabled=${busy}>
          <option value="">${c.chooseOrganisation}</option>
          ${groups.map(group => html`<option value=${group.id}>${group.name || c.unnamedOrganisation}</option>`)}
        </select>` : groups[0] ? html`<p class="help">${c.businessRegisterIn.replace('{name}', groups[0].name || c.unnamedOrganisation)}</p>
          <input type="hidden" name="organisationId" value=${groups[0].id}>` : nothing}
      <label for="business-name">${c.legalName}</label>
      <input type="text" id="business-name" name="legalName" maxlength="200" autocomplete="organization" required ?disabled=${busy}>
      <label for="business-tax-number">${c.businessTaxNumber}</label>
      <input type="text" id="business-tax-number" name="taxNumber" maxlength="32" required ?disabled=${busy}>
      <label for="business-country">${c.businessCountry}</label>
      <select id="business-country" name="countryCode" autocomplete="country" required ?disabled=${busy}>
        <option value="">${c.chooseBusinessCountry}</option>
        ${countries.map(country => html`<option value=${country.code}>${country.name}</option>`)}
      </select>
      <button class="text-button" type="submit" ?disabled=${busy}>${c.businessRegister}</button>
    </form>` : nothing}
  </section>`;
}
