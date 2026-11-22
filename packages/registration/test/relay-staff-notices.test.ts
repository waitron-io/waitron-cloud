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
