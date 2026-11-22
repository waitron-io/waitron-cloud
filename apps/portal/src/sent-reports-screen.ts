import {html, nothing, type LitElement} from 'lit';
import type {PortalApp} from './app.ts';
import {formatDateTime} from './dates.ts';
import {permissionActions} from './permission-actions.ts';

export function sentReportsScreen(app: PortalApp, venueId: string) {
 const c = app.copy, reports = app.sentReports;
 const titleId = `sent-reports-${venueId}`, triggerId = `open-${titleId}`, detailId = `report-${venueId}`;
 const busy = reports.pending || !!reports.waiting || app.installations.pending;
 const focus = (id: string) => app.root.querySelector<HTMLElement>('#' + id)?.focus();

 if (reports.venueId !== venueId) return html`<wt-button id=${triggerId} .disabled=${busy} @click=${() => {
  void reports.open(venueId);
  focus(titleId);
 }}>${c.sentReports}</wt-button>`;

 const detail = reports.detail;
 return html`<section class="sent-reports" aria-labelledby=${titleId}>
  <h4 id=${titleId} tabindex="-1">${c.sentReports}</h4>
  ${reports.error ? html`<p role="alert">${c[reports.error]}</p>${permissionActions(app, reports.error)}` : nothing}
  ${reports.pending ? html`<p role="status">${c.wait}</p>` : nothing}
  ${reports.page && !reports.page.reports.length ? html`<p>${c.noSentReports}</p>` : nothing}
  ${reports.page?.reports.length ? html`<ul>${reports.page.reports.map(report => html`<li>
   <wt-button .disabled=${busy} @click=${async () => {
    await reports.read(report);
    if (reports.detail?.reportId === report.reportId && reports.detail.installationId === report.installationId) focus(detailId);
   }}><span><time datetime=${report.reportedAt}>${formatDateTime(report.reportedAt, app.locale)}</time> · ${report.version}</span></wt-button>
  </li>`)}</ul>` : nothing}
  <div class="sent-reports-actions">
   <wt-button .disabled=${busy} @click=${() => { void reports.load(); }}>${c.refreshSentReports}</wt-button>
   ${reports.page?.nextCursor ? html`<wt-button .disabled=${busy} @click=${async () => {
    await reports.load(true);
    if (!reports.page?.nextCursor) focus(titleId);
   }}>${c.olderSentReports}</wt-button>` : nothing}
   <wt-button @click=${async () => {
    reports.close();
    app.draw();
    const trigger = app.root.querySelector<LitElement>('#' + triggerId);
    await trigger?.updateComplete;
    trigger?.shadowRoot?.querySelector('button')?.focus();
   }}>${c.closeSentReports}</wt-button>
  </div>
  ${detail ? html`<h5 id=${detailId} tabindex="-1">${c.sentReportBody}</h5><pre>${detail.reportBody}</pre>
   ${detail.descriptionBody === null ? nothing : html`<h5>${c.sentReportDescription}</h5><pre>${detail.descriptionBody}</pre>`}` : nothing}
 </section>`;
}
