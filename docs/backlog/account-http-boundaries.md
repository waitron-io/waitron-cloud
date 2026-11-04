# Account HTTP boundaries


## Signup and password-reset HTTP acknowledgements (D423)

Native account-client tests return an unsuccessful client result for malformed
signup and password-reset replies. They cover email-request acknowledgements,
signup account and business fields, reset completion, unreadable JSON, network
loss and refused replies. Uncertain operations remain single attempts; an explicit
retry can accept a valid reply. Exact request bodies preserve passwords, link
tokens and locale. Run `node --test apps/portal/test/signup-reset-response-boundary.test.ts`.
Production email delivery, browser and server authority remain separate
qualification gates. These client tests use controlled fetch responses. Exact
success status codes, empty organisation and business IDs, browser anti-forgery
headers and the 15-second request deadline are outside this file's proof.
