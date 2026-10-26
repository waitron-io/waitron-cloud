import assert from 'node:assert/strict';

export async function captured(inbox: string, subject: string, recipient: string) {
  const response = await fetch(`${inbox}/api/v1/messages`);
  assert.equal(response.status, 200);
  const list = await response.json() as {messages: {ID: string; Subject: string}[]};
  // Concurrent database fixtures share this inbox, so a subject alone cannot identify their mail.
  for (const summary of list.messages.filter(message => message.Subject === subject)) {
    const detail = await fetch(`${inbox}/api/v1/message/${summary.ID}`);
    assert.equal(detail.status, 200);
    const message = await detail.json() as { Text: string; To: {Address: string}[] };
    if (message.To.some(to => to.Address === recipient)) return message;
  }
  assert.fail(`Expected captured email: ${subject} for ${recipient}`);
}
