import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { captured } from './fixtures/captured-mail.ts';

const email = 'cafe-owner@example.test';
const otherEmail = 'upgrade-one@example.test';
const subjects = ['Verify your Waitron Cloud email', 'Reset your Waitron Cloud password', 'Your Waitron Cloud password changed'];

for (const subject of subjects) {
  for (const ownMessagePresent of [true, false]) {
    test(`${subject}: ${ownMessagePresent ? 'selects its recipient past another fixture' : 'refuses another fixture when its own message is absent'}`, async t => {
      const messages = [
        { ID: 'foreign', Subject: subject, To: [{ Address: otherEmail }], Text: 'Another fixture' },
        { ID: 'other-subject', Subject: 'Unrelated message', To: [{ Address: email }], Text: 'Wrong subject' },
        ...(ownMessagePresent ? [{ ID: 'own', Subject: subject, To: [{ Address: email }], Text: 'Own message' }] : []),
      ];
      const server = createServer((request, response) => {
        const message = messages.find(message => request.url === `/api/v1/message/${message.ID}`);
        const body = request.url === '/api/v1/messages' ? { messages } : message;
        response.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body ?? {}));
      });
      t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const inbox = `http://127.0.0.1:${address.port}`;
      if (ownMessagePresent) {
        const message = await captured(inbox, subject, email);
        assert.equal(message.Text, 'Own message');
        assert.equal(message.To[0]?.Address, email);
      } else {
        await assert.rejects(captured(inbox, subject, email), /Expected captured email/);
      }
    });
  }
}
