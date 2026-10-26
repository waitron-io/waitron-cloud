import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountMail} from '../src/account-mail.ts';
import type {ServiceAlert} from '../src/service-alert.ts';

const base = {email: 'owner@example.test', incidentId: '11111111-1111-4111-8111-111111111111',
  venueId: '22222222-2222-4222-8222-222222222222', revision: 1, state: 'open' as const};
const checkedAt = '2026-10-24T12:00:00.000Z', certificateNotAfter = '2026-10-29T12:00:00.000Z';

for (const locale of ['en', 'es'] as const) for (const kind of ['public', 'staff'] as const) {
  for (const condition of ['route_failed', 'probe_stale', 'certificate_expiring'] as const) {
    const issue = `${kind}_${condition}` as ServiceAlert['issue'];
    test(`${locale} ${issue}: email points to available checks and names operator limits`, () => {
      const alert: ServiceAlert = {...base, locale, issue, checkedAt,
        ...(condition === 'certificate_expiring' ? {certificateNotAfter} : {})};
      const mail = accountMail(new URL('https://cloud.example.test'), 'service_alert', alert);
      assert.ok(mail.text.includes('https://cloud.example.test/account'));
      assert.ok(mail.text.includes(base.venueId));
      if (condition === 'probe_stale') {
        assert.ok(mail.text.includes(locale === 'en' ? 'Refresh status' : 'Actualizar estado'));
        assert.match(mail.text, locale === 'en' ? /does not confirm an outage/ : /no confirma una caída/);
        assert.doesNotMatch(mail.text, locale === 'en' ? /failed its latest/ : /falló en la última/);
      } else {
        assert.ok(mail.text.includes(locale === 'en' ? 'Set up remote access' : 'Configurar acceso remoto'));
        assert.match(mail.text, locale === 'en' ? /selected hostname and status/ : /nombre seleccionado y el estado/);
        assert.match(mail.text, locale === 'en' ? /require operator tools/ : /requieren herramientas de operador/);
        if (condition === 'route_failed') {
          assert.match(mail.text, locale === 'en' ? /venue internet connection/ : /conexión a internet del local/);
          assert.doesNotMatch(mail.text, locale === 'en' ? /certificate expires soon/ : /certificado .*caduca pronto/);
        } else {
          assert.match(mail.text, locale === 'en' ? /certificate expires soon/ : /certificado .*caduca pronto/);
          assert.match(mail.text, locale === 'en' ? /Renewal and installation/ : /La renovación y la instalación/);
          assert.ok(mail.text.includes(locale === 'en' ? 'Refresh status' : 'Actualizar estado'));
          assert.doesNotMatch(mail.text, locale === 'en' ? /failed its latest/ : /falló en la última/);
        }
      }
      for (const patch of [{state: 'recovered' as const}, {notification: 'reminder' as const}]) {
        const update = accountMail(new URL('https://cloud.example.test'), 'service_alert', {...alert, ...patch});
        assert.doesNotMatch(update.text, /Set up remote access|Configurar acceso remoto|require operator tools|requieren herramientas de operador/);
        assert.ok(update.text.includes('https://cloud.example.test/account'));
        assert.match(update.text, locale === 'en' ? /current service status/ : /estado actual de los servicios/);
      }
    });
  }
}
