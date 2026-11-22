import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {relayBody, RelayMessageError, type RelayBody} from '../src/relay-payload.ts';
import {relayTemplate} from '../src/relay-smtp.ts';

const at = '2026-01-02T00:15:00.000Z';
const common = {
  version: 2,
  messageId: randomUUID(),
  grantId: randomUUID(),
  grantRevision: 1,
  recipient: 'old@example.test',
  displayName: 'Cafe Norte',
  timeZone: 'America/New_York',
  expiresAt: '2026-01-02T01:15:00.000Z',
};
const warning = {class: 'email_changed', facts: {editorName: 'Ana', at}};
const security = {class: 'security_change', facts: {change: 'passkey_removed', at}};
const role = {class: 'role_membership_changed', facts: {change: 'added', editorName: 'Ana', at}};

for (const [locale, emailSubject, securityText, roleText, date] of [
  ['en-GB', 'Your sign-in email was changed', /passkey was removed/, /Ana added you to Manager/, /1 Jan 2026, 19:15/],
  ['es-ES', 'Se cambió tu correo de acceso', /Se eliminó una llave de acceso/, /Ana te añadió al rol Encargado/, /1 ene 2026, 19:15/],
] as const) {
  test(`Cloud renders the three account notices in ${locale} with venue-local time`, () => {
    const cases = [
      [warning, /Ana.*Cafe Norte/],
      [security, securityText],
      [{...role, facts: {...role.facts, builtInKey: 'manager'}}, roleText],
    ] as const;
    for (const [notice, expected] of cases) {
      const submitted = {...common, locale, ...notice};
      const body = relayBody(JSON.stringify(submitted), true) as RelayBody;
      assert.deepEqual(body, submitted);
      const rendered = relayTemplate({...body, managementOrigin: 'https://manage.example.test'});
      assert.match(rendered.text, expected);
      assert.match(rendered.text, date);
      assert.doesNotMatch(rendered.text, /https?:\/\//);
      if (notice.class === 'email_changed') assert.equal(rendered.subject, emailSubject);
    }
  });
}

test('a custom role is named in the body of a removal, with a fixed subject', () => {
  const submitted = {...common, locale: 'en-GB', ...role, facts: {...role.facts, change: 'removed', roleName: 'Stock Lead'}};
  const body = relayBody(JSON.stringify(submitted), true) as RelayBody;
  const rendered = relayTemplate({...body, managementOrigin: 'https://manage.example.test'});
  assert.match(rendered.text, /Ana removed you from Stock Lead/);
  assert.doesNotMatch(rendered.subject, /Stock Lead/);
});

test('version 2 accepts only the declared classes and their exact bounded facts', () => {
  const builtInRole = {...role.facts, builtInKey: 'staff'};
  const invalid = [
    {...warning, version: 1},
    {...warning, class: 'email_change'},
    {...warning, class: 'box_alert'},
    {...warning, class: ['email_changed']},
    {...warning, subject: 'Choose my subject'},
    {...warning, facts: {...warning.facts, newEmail: 'new@example.test'}},
    {...warning, facts: {...warning.facts, actionUrl: 'https://extra.example.test'}},
    {...warning, facts: {...warning.facts, editorName: 'a'.repeat(81)}},
    {...warning, facts: {...warning.facts, editorName: 'Ana\nBcc: another@example.test'}},
    {...warning, facts: {...warning.facts, at: '2026-02-30T00:00:00.000Z'}},
    {...security, facts: {...security.facts, change: 'toString'}},
    {...security, facts: {...security.facts, subject: 'A custom subject'}},
    {...role, facts: role.facts},
    {...role, facts: {...builtInRole, roleName: 'Stock Lead'}},
    {...role, facts: {...builtInRole, builtInKey: 'owner'}},
    {...role, facts: {...builtInRole, change: 'edited'}},
    {...role, facts: {...role.facts, roleName: 'a'.repeat(81)}},
  ];
  for (const notice of invalid) {
    const body = {...common, locale: 'en-GB', ...notice};
    assert.throws(() => relayBody(JSON.stringify(body), true), RelayMessageError, JSON.stringify(notice));
  }
});

test('the worker renderer revalidates decrypted notice facts', () => {
  const malformed = {...common, locale: 'en-GB', ...warning,
    facts: {...warning.facts, actionUrl: 'https://extra.example.test'}};
  assert.throws(() => relayTemplate({
    ...malformed as RelayBody, managementOrigin: 'https://manage.example.test',
  }), RelayMessageError);
});

test('notice labels must contain a name on a single line', () => {
  const invalid = [
    {...warning, facts: {...warning.facts, editorName: '  '}},
    {...warning, facts: {...warning.facts, editorName: 'Ana\u2028Manager'}},
    {...role, facts: {...role.facts, roleName: ''}},
    {...role, facts: {...role.facts, editorName: '  ', builtInKey: 'staff'}},
  ];
  for (const notice of invalid) {
    assert.throws(() => relayBody(JSON.stringify({...common, locale: 'en-GB', ...notice}), true),
      RelayMessageError, JSON.stringify(notice));
  }
});

test('saved role labels stay literal in text and are escaped in HTML', () => {
  for (const [roleName, htmlLabel] of [
    ['Night <service>', 'Night &lt;service&gt;'],
    ['Service 👩‍💻', 'Service 👩‍💻'],
  ] as const) {
    const submitted = {...common, locale: 'en-GB', ...role,
      facts: {...role.facts, editorName: 'Ana & Bea', roleName}};
    const body = relayBody(JSON.stringify(submitted), true) as RelayBody;
    const rendered = relayTemplate({...body, managementOrigin: 'https://manage.example.test'});
    assert.ok(rendered.text.includes('Ana & Bea added you to ' + roleName));
    assert.ok(rendered.html?.includes('Ana &amp; Bea added you to ' + htmlLabel));
    assert.doesNotMatch(rendered.html!, /<service>/);
  }
});

const clock = {
  code: 'clock.corrected', before: '2026-01-02T03:00:00.000Z', after: '2026-01-02T03:05:00.000Z',
  beforeOffsetMinutes: -240, afterOffsetMinutes: 60, stepMs: -120_000,
  source: 'staff', unverified: false, person: 'Ana & Bea', device: 'Till <2>',
};

for (const [locale, english] of [['en-GB', true], ['es-ES', false]] as const) {
  test(`Cloud renders box alerts and certificate reminders in ${locale}`, () => {
    const cases = [
      ['box_alert', {code: 'storage.space_low'}, /Box status/, /Estado del servidor/],
      ['box_alert', {code: 'storage.disk_full'}, /deletes only files/, /borra solo archivos/],
      ['box_alert', {code: 'backup.archives_deleted', count: 1, date: '2026-01-02', lastDate: '2026-01-02'},
        /oldest backup \(2 Jan 2026\)/, /más antigua \(2 ene 2026\)/],
      ['box_alert', {code: 'backup.archives_deleted', count: 2, date: '2026-01-02', lastDate: '2026-01-02'},
        /2 oldest backups \(2 Jan 2026\)/, /2 copias más antiguas \(2 ene 2026\)/],
      ['box_alert', {code: 'backup.archives_deleted', count: 3, date: '2026-01-02', lastDate: '2026-01-04'},
        /3 oldest backups \(2 Jan 2026 to 4 Jan 2026\)/, /3 copias más antiguas \(del 2 ene 2026 al 4 ene 2026\)/],
      ['box_alert', {code: 'backup.run_stopped', neededBytes: 2_000_000_000, availableBytes: 0},
        /needs 2 GB.*has 0 MB/, /necesita 2 GB.*tiene 0 MB/],
      ['box_alert', {code: 'upgrade.rolled_back', fromVersion: '1.2.3', toVersion: '1.3.0-rc.1'},
        /upgrade to 1\.3\.0-rc\.1.*back on 1\.2\.3/, /actualización a 1\.3\.0-rc\.1.*versión 1\.2\.3/],
      ['certificate_reminder', {stage: 'due', date: '2026-01-02', daysLeft: 0},
        /AEAT.*2 Jan 2026.*today/, /AEAT.*2 ene 2026.*hoy/],
      ['certificate_reminder', {stage: 'expired', date: '2026-01-02'},
        /AEAT.*2 Jan 2026.*Sales continue.*fiscal records wait/, /AEAT.*2 ene 2026.*Las ventas continúan.*registros fiscales esperan/],
    ] as const;
    for (const [kind, facts, en, es] of cases) {
      const submitted = {...common, locale, class: kind, facts};
      const parsed = relayBody(JSON.stringify(submitted), true) as RelayBody;
      assert.deepEqual(parsed, submitted);
      const {subject, text, html} = relayTemplate({...parsed, managementOrigin: 'https://manage.example.test'});
      assert.match(text, english ? en : es);
      assert.ok(subject.length > 0);
      assert.doesNotMatch(text, /https?:\/\//);
      assert.ok(html?.includes('</p><p>'));
    }
  });

  test(`Cloud renders the measured clock step, observed times and staff labels in ${locale}`, () => {
    const render = (facts: unknown) => {
      const body = relayBody(JSON.stringify({...common, locale, class: 'box_alert', facts}), true) as RelayBody;
      return relayTemplate({...body, managementOrigin: 'https://manage.example.test'});
    };
    const {text, html} = render(clock);
    assert.match(text, /Ana & Bea/);
    assert.match(text, /Till <2>/);
    assert.ok(html?.includes('Ana &amp; Bea'));
    assert.ok(html?.includes('Till &lt;2&gt;'));
    assert.match(text, english ? /moved back 2 minutes/ : /atrasó 2 minutos/);
    assert.match(text, /1 (Jan|ene) 2026, 23:00.*2 (Jan|ene) 2026, 0?4:05/);
    const {person, device, ...anonymous} = clock;
    assert.match(render({...anonymous, unverified: true}).text,
      english ? /Check the box's clock/ : /Comprueba la hora/);
    assert.match(render({...anonymous, source: 'setup'}).text, english ? /setup or restore/ : /configuración o restauración/);
    assert.match(render({...anonymous, source: 'admin', person, stepMs: 60_000}).text,
      english ? /Ana & Bea.*moved forward 1 minute/ : /Ana & Bea.*adelantó 1 minuto/);
  });
}

test('new notice classes refuse invalid facts and fields', () => {
  const backup = {code: 'backup.archives_deleted', count: 1, date: '2026-01-02', lastDate: '2026-01-02'};
  const due = {stage: 'due', date: '2026-01-02', daysLeft: 0};
  const invalid = [
    ['box_alert', {code: 'clock.unusable'}],
    ['box_alert', {code: 'storage.disk_full', text: 'extra'}],
    ['box_alert', {...backup, lastDate: '2026-02-30'}],
    ['box_alert', {...backup, lastDate: '2026-01-01'}],
    ['box_alert', {...backup, count: Number.MAX_SAFE_INTEGER + 1}],
    ['box_alert', {code: 'backup.run_stopped', neededBytes: 1, availableBytes: -1}],
    ['box_alert', {code: 'upgrade.rolled_back', fromVersion: 'free text', toVersion: '1.2.3'}],
    ['box_alert', {code: 'upgrade.rolled_back', fromVersion: '1.2.3', toVersion: `${'1'.repeat(47)}.0.0`}],
    ['box_alert', {...clock, before: undefined}],
    ['box_alert', {...clock, unverified: true, device: undefined}],
    ['box_alert', {...clock, source: 'admin'}],
    ['box_alert', {...clock, device: 'a'.repeat(81)}],
    ['box_alert', {...clock, stepMs: 1.5}],
    ['box_alert', {...clock, beforeOffsetMinutes: -841}],
    ['box_alert', {...clock, stepMs: undefined, direction: 'back'}],
    ['certificate_reminder', {...due, date: '2026-02-29'}],
    ['certificate_reminder', {...due, daysLeft: undefined}],
    ['certificate_reminder', {...due, daysLeft: -1}],
    ['certificate_reminder', {...due, stage: 'expired'}],
  ] as const;
  for (const [kind, facts] of invalid) {
    assert.throws(() => relayBody(JSON.stringify({...common, locale: 'en-GB', class: kind, facts}), true),
      RelayMessageError, JSON.stringify(facts));
  }
});
