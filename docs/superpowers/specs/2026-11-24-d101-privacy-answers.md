# D101: best-guess answers to Cloud's privacy questions

**Researched by an AI from published sources on 2026-11-24. Not legal advice. Not confirmed by anyone.** Owner's decision, 2026-11-24: go with our best guess and ask the specialist to confirm later. That lifts the 9 November wait. It does not authorise slices 6–12, spending, a provider or a contract.

Words used. **Controller**: whoever decides why data is used. **Processor**: whoever handles it for them.
**Locked** (Spanish *bloqueo*): set aside so nobody can use or see it except courts and authorities, then destroyed. **Curly quotation marks hold text checked by script against the downloaded source, nothing else.** Translations in round brackets are ours. **[ours]** marks a period or limit we chose because no source sets it.

## Summary

| # | Question | Best guess | How sure | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | Does a 90-day read-only period, then deletion, work? | Yes as a contract instruction the venue can shorten. **But never destroy a venue's records until they have been returned.** | Likely; return-first: sure | Slices 8, 9, 10 |
| 2 | What does Cloud keep after exit, and how long? | Invoice and payment evidence: 6 years. Contract evidence: locked 5 years. Access and security records: locked 3 years from the event. No venue content. | Billing: sure. Rest: likely | Slices 6, 10; billing store |
| 3 | How are suppliers approved, and are AWS, SES and OpenAI acceptable? | General written approval plus a named list. 30 days' notice for our own changes, 14 for a supplier's own. AWS and SES in the EU usable with named settings; OpenAI not yet. | Likely | Slice 5 records, slice 12 |
| 4 | Are the support and emergency rules lawful? | Yes: each approval is an instruction; emergency is a standing instruction written into the contract. | Likely | Slices 6, 7, 11 |
| 5 | Do backup expiry and AWS key waiting break the 90-day promise? | Yes as worded. Promise: unreadable from day 90, all copies gone by day 120 **[ours]**, then a certificate. | Likely | Slices 7, 10 |
| 6 | What menu text may go to AI? | Only dish name, description and section of items already on the public menu, after a refusal check. Still off. | Uncertain | No numbered slice; a later AI plan |
| P8 | Waitron's own role | Processor for hosting, transport and support. Controller for accounts, billing and security records. Product repair uses only data stripped of anything personal. | Likely | Slices 6, 11 |
| 7 | May Spain's Cloud run from Paris if AWS Spain fails? | Privacy law: yes. **Invoice law: a venue keeping its invoices outside Spain must tell AEAT first.** | Privacy: sure. Tax: likely | Country policy; deployment P7 |

**Slice 5 never waited on a legal answer.** Its own plan's open points D1 to D4 are engineering.

### Where the owner's 2026-10-21 exit rules and the law could conflict

| Owner's rule | Conflict | Smallest change |
| --- | --- | --- |
| Offer a download, then delete on day 90 | Spanish law forbids a processor destroying data the venue must by law keep; it must be given back (question 1). An offer nobody took up is not a return. | Deletion runs only after proof of return. Without proof, lock the data instead of destroying it. |
| Delete everything except billing records | Cloud must lock, not just delete, its **own** account and security records (question 2) | Add one locked evidence file, with no venue content |
| Everything deleted at day 90 | AWS keys take 7 to 30 days to destroy; shared backups expire later (question 5) | Day 90: nothing can be opened. Day 120: everything gone. |
| Never send personal data to AI | Nobody can guarantee that for typed text (question 6) | Keep the rule as the design. To customers, say what we block, not "never". |

### Costly or irreversible if we are wrong, and how to stay safe

1. **Destroying a venue's data.** Build and test the purge, but leave the final destroy step off in production until confirmed. The first real one cannot happen before 90 days after the first customer leaves.
2. **Destroying an AWS key.** Disable the key; do not schedule its deletion until confirmed.
3. **Signed customer contracts.** Hard to change once signed. Use numbered versions, and get the specialist's yes before the first customer.
4. **Keeping too much.** A wrong locking period can be a fine either way. Give each locked record its own destroy date, so a period can be shortened in one change. Too short cannot be undone, so err long until confirmed.
5. **Sending menu text to an AI supplier.** Cannot be recalled. Stays off.
6. **Using venue reports for product repair.** Cannot be unmixed. Only stripped records go there.
7. **Running from Paris for a hosted venue.** Do not enable before question 7's tax point is settled.
8. **Monthly snapshots kept 12 months** (`packages/backups/src/retention.ts:2`). One guest's erased data would stay in them up to a year; adviser point P4 proposes 30 days. Either build the replay list (question 5) or keep fewer.

## 1. The agreement, the 90 days, and return before deletion

**Question.** Does a contract instruction to keep backups read-only for 90 days, with earlier return or deletion on request, satisfy the law, and does any duty stop the deletion?

**Best guess, as rules.**
- The agreement says: read-only for 90 days after service end, then delete. The venue can change that to "return and delete now" at any time, by a verified owner.
- **Destroy only after proof of return.** Proof is (a) a completed, checksum-verified full download by the current owner, or (b) for a paired venue, the venue's own box confirming it holds the final captured state. A venue's statement that it has a copy is not proof until the specialist says so.
- With no proof at day 90, or on an earlier delete request: lock it. No support, no resubscription; only return to the owner, or a court or authority. Remind on days 30, 60, 75 and 85 **[ours]**. Destroy when returned, or six years after the last entry, whichever is first **[ours, using the Código de Comercio period in question 2]**.

**Why.**
- GDPR art. 28(3)(g): “at the choice of the controller, deletes or returns all the personal data to the controller after the end of the provision of services relating to processing, and deletes existing copies unless Union or Member State law requires storage of the personal data” [S1].
- EDPB 07/2020 para. 140: “The contract or other legal act should reflect the possibility for the data controller to change the choice made before the end of the provision of services” [S2]. So a default plus a change is fine.
- LOPDGDD art. 33.3: “No procederá la destrucción de los datos cuando exista una previsión legal que obligue a su conservación, en cuyo caso deberán ser devueltos al responsable, que garantizará su conservación mientras tal obligación persista” (data must not be destroyed where a law requires keeping it; it must be returned to the controller, who ensures it is kept while the duty lasts) [S3]. The AEPD's legal office calls this “una regla especial vinculada a la finalización de la prestación de los servicios del encargado” (a special rule for the end of a processor's service) [S4]. Its contract guide: “En todo caso, los datos deberán ser devueltos al responsable cuando se requiera la conservación de los datos personales” (in every case return it where the law requires it kept) [S5].
- A venue database holds such data: invoice copies, RD 1619/2012 art. 19.1, “deberán conservar, durante el plazo previsto en la Ley 58/2003” [S6]; working-time records, Estatuto art. 34.9, “La empresa conservará los registros a que se refiere este precepto durante cuatro años” (four years) [S7]; billing records, RD 1007/2023 art. 8.2.c (“todos los registros de facturación generados por el propio sistema informático”) [S8].
- The duty stays the venue's: RD 1619/2012 art. 19.3 lets a third party do it, but the business “será, en cualquier caso, responsable del cumplimiento” (stays responsible in every case) [S6]. Cloud is not a fiscal archive.
- **Locking does not bind a processor by default.** LOPDGDD art. 32.1 says “El responsable del tratamiento estará obligado a bloquear los datos” (the *controller* must lock) [S3]. For a processor, art. 33.4 says “podrá” (may): “El encargado del tratamiento podrá conservar, debidamente bloqueados, los datos en tanto pudieran derivarse responsabilidades de su relación con el responsable del tratamiento” [S3]. The AEPD closed a 2024 case against a processor that did this during a lawsuit: “la previsión del artículo 33.4 de la LOPDGDD ampara esta actuación” (art. 33.4 covers it), despite the controller's repeated deletion requests, keeping one sealed copy with a notary [S9]. One contrary hint: the AEPD's labour guide says destroyed data needs locking (“debiendo procederse al bloqueo en el primer caso”), without saying by whom [S10].
- The Commission's art. 28 clauses are optional: the contract “may be based, in whole or in part, on standard contractual clauses” (GDPR 28(6)) [S1]. But they may not be altered (clause 2), and clause 7.7(e) requires a supplier contract letting the venue step in if Cloud disappears: “The processor shall agree a third party beneficiary clause with the sub-processor” [S11]. AWS's standard addendum contains no such clause (we searched it) [S12]. **So use their structure, and do not say we have adopted them.**

**How sure.** 90 days: likely. Return first: sure about the rule, uncertain what counts as return. A specialist saying a venue's written statement is enough would simplify it.
**Build now.** Slice 8 (return bundle and its proof record), slice 9 (state and clocks), and slice 10's rule that purge needs a return proof or goes to locked. Slice 4's journal already holds the times.
**Ask.** "Under LOPDGDD 33.3, may Cloud destroy a departed venue's database on its signed statement that it holds a copy, and if it never responds, is sealing it until six years after the last entry right?"

## 2. What Cloud keeps after exit

**Question.** Which billing evidence must stay, for how long, and can any support or security record survive?

**Best guess, as rules.** (`serviceId` names are the register's.)

| Record | Keep usable | Then | Source of the period |
| --- | --- | --- | --- |
| Cloud's invoices, credit notes, payment outcome and provider reference, mandate reference, the usage totals an invoice rests on (`cloud-billing`, part of `cloud-usage`) | 6 years from the last entry in that year's books: destroy on 1 July of year +7 (the six-month margin is **[ours]**) | Destroy | Código de Comercio 30 |
| Same, for a year whose tax losses or deductions are carried forward | 10 years from that return's deadline; a per-year hold flag the tax adviser sets | Destroy | LGT 66 bis.2, 70.3 |
| Agreement versions, orders, approvals, instructions, supplier notices, return and deletion receipts, breach notices | Service term | Locked 5 years from service end | Código Civil 1964.2 |
| Account and membership (`cloud-account`) | While the account exists | Locked 3 years from closure | LOPDGDD 72 |
| Support, emergency and audit events, fixed fields only (`cloud-support`, `cloud-audit`) | Service term; a copy goes in the venue's export | Locked until 3 years after each event | LOPDGDD 72, 33.4 |
| Gateway and sign-in security logs (`cloud-gateway-security`) | 12 months **[ours; CNIL range]** | Locked until 3 years after the event | CNIL; LOPDGDD 72 |
| Passwords, tokens, recovery material (`cloud-authentication`) | While needed | Destroy at once, not locked | Our reading, as adviser point P6 |
| Email body, venue or account | Until the outcome is settled | Destroy | [ours] |
| Email delivery outcome | 12 months **[ours]**, sooner for a venue's own mail at its exit | Account mail: locked to 3 years. Venue mail: destroy | [ours]; LOPDGDD 72 |
| Reports and diagnostics for one venue | Until 30 days after the case closes **[ours]** | Destroy; the stripped record stays | See P8 |

Billing rows hold invoice fields and payment references. Never card numbers, full bank numbers or venue content. Access: billing staff only. Locked file: no screen; opened only for a court, authority or Cloud's own defence, by a named person, recorded. Any other hold needs a written legal reason, scope, end date, six-monthly review
**[ours]** and notice to the venue unless a law forbids it.

**Why.**
- Código de Comercio 30.1: “Los empresarios conservarán los libros, correspondencia, documentación y justificantes concernientes a su negocio, debidamente ordenados, durante seis años, a partir del último asiento realizado en los libros” (six years from the last entry) [S13]. LGT 66: “Prescribirán a los cuatro años” (four years), shorter [S14]. LGT 66 bis.2: “prescribirá a los diez años” (ten years) for carried-forward losses and deductions [S14].
- While a law requires keeping, neither erasure nor locking applies: “no procede el derecho de supresión” (there is no right to erasure) [S4]; basis GDPR 6(1)(c) and 17(3)(b).
- Cloud is controller of its own records, so art. 32.1 binds it, and breach is in LOPDGDD 72.1.n: “El incumplimiento de la obligación de bloqueo de los datos establecida en el artículo 32 de esta ley orgánica cuando la misma sea exigible” (listed as a very serious infringement) [S3].
- Three years: the AEPD says “el plazo máximo del bloqueo para este supuesto será el de tres años” (three years at most) for data-protection liability [S4]. Five: for contract claims, “durante este plazo de 5 años, los datos suprimidos deberán ser bloqueados” [S4], from Código Civil 1964.2, “prescriben a los cinco años” [S15].
- The same report found that company's periods “exceden en mucho de las exigencias derivadas de la normativa aplicable” (far exceed what the rules need) and wants “el plazo concreto” (the specific period) per activity [S4]. Hence the table.
- Security logs: GDPR recital 49 makes necessary network security “a legitimate interest of the data controller concerned” [S1]. No Spanish text we found sets a length. France's CNIL advises “une durée comprise entre six mois et un an” (six months to a year) and, for internal-control systems, “dans les cas les plus courants une durée maximale de trois ans” (at most three years usually) [S16]. Not binding in Spain.

**How sure.** Billing: sure of six years; the ten-year flag is for the tax adviser. Locked file: likely. Locking old security logs: uncertain, since art. 32.5 lets the AEPD make exceptions and we found none.
**Build now.** Slice 10's exception list, slice 6's audit retention, and the billing store's retention (today it keeps everything). Also the missing cutoffs in `history-cleanup.ts`.
**Ask.** "Is this table right, in particular must Cloud lock routine security logs for three years after 12 months' use, or may it simply delete them?"

## 3. Suppliers: approval, objection, entities and transfers

**Question.** What approval process is enough, and which of AWS, SES and the AI suppliers may be used?

**Best guess, as rules.**
- General written authorisation, with the list in the agreement: each supplier's name, address, contact, task, location and safeguards. Each change is **sent** to the venue, not only published. Silence after the period is consent.
- Notice: 30 days when Cloud adds or replaces a supplier; 14 when a supplier changes its own chain **[ours]**. We cannot promise 30 there: AWS gives us 30, so passing it on leaves nothing. Subscribe to AWS's change emails.
- A venue that objects: no new flow to that supplier. For a change inside AWS we cannot hold AWS, so the remedy is the exit in question 1, without penalty. Say this in the contract.
- **AWS (S3, KMS, compute) in `eu-south-2`, encrypted copy in `eu-west-3`: usable**, with AWS's addendum captured, no AI features that process elsewhere, the service-improvement opt-out set, and no customer data put in AWS support cases.
- **SES: usable in an EU region.** AWS's endpoint page now lists Spain for the API but not for SMTP, so D102 should re-check whether the Stockholm or Paris exception is still needed (the D101 design says there is no Spain endpoint). **OpenAI, Anthropic, Google: not yet** (question 6).
- Human access to venue data from outside the EEA can count as a transfer. Refuse it from anywhere outside the EU (the owner's line; the law's is the EEA) unless the policy names a qualified exception.
- SumUp and Stripe are for Cloud's own billing, not venue data. Treat each as deciding for itself how it moves money, and name them in Cloud's privacy notice. Their rows stay unqualified.

**Why.**
- GDPR 28(2): “the processor shall inform the controller of any intended changes concerning the addition or replacement of other processors, thereby giving the controller the opportunity to object to such changes” [S1]. EDPB 07/2020 para. 157: “the controller’s failure to object within the set timeframe can be interpreted as authorisation”; para. 158: the period must be “reasonable in light of the type of processing” [S2]. The Commission's clauses leave it blank (“at least [SPECIFY TIME PERIOD] in advance”) [S11]. **No law says 30 days.**
- EDPB Opinion 22/2024: controllers should have “the information on the identity” of all sub-processors “readily available at all times” [S17].
- AWS addendum 6.1: “At least 30 days before AWS engages a Sub-processor, AWS will update the applicable website”; 12.1: “AWS will not transfer Customer Data from Customer’s selected Region(s) except as necessary to provide the Services initiated by Customer, or as necessary to comply with the law” [S12]. The US parent is a party: “Amazon Web Services, Inc. and the AWS Contracting Party” [S12].
- AWS's list names “Amazon Data Services Spain, S.L.U.” for the Spain region. Service improvement runs “Unless customer opts out”. Support entities “do not process Customer Data unless the customer agrees to share Customer Data in the course of requesting support” [S18].
- EDPB 05/2021: “remote access from a third country (even if it takes place only by means of displaying personal data on a screen, for example in support situations, troubleshooting or for administration purposes)” counts as a transfer when its three criteria are met [S19]. Where an EU processor answers to foreign law, the test is sufficient guarantees, and reliability “may be in doubt” [S19].
- OpenAI names “OpenAI Ireland Limited” for EEA data [S20]; its logs are “retained for up to 30 days” by default [S21]; EU residency needs eligibility, and “Data residency does not apply to system data” [S22].

**How sure.** Process: sure. 30 and 14 days: our numbers. AWS: likely. The EU–US adequacy decision that backs US-parent transfers is in force but under appeal (search results only); if it falls, AWS rests on standard clauses. We did **not** verify that any supplier is certified under it.
**Build now.** Slice 5's policy and evidence records, the supplier list and notice records, and an EU-only access check in slice 6. Real qualification stays in slice 12.
**Ask.** "Is general authorisation with 30 and 14 days acceptable, and does AWS in Spain with Paris backup need any further written transfer assessment?"

## 4. Support and emergency access

**Question.** Are per-session approved support, a single-person emergency route, and the audit records lawful?

**Best guess, as rules.**
- Normal support: each approval is a documented instruction: operator, venue, reason, actions, end time (24 hours at most). Nothing outside it.
- Emergency: a standing, conditional instruction in the signed agreement: venue cannot trade **and** cannot be reached; recovery actions only; short; logged first; reported at once. If it is not in the agreement, refuse. One on-call person who states the facts in writing is enough, provided the log is tamper-resistant and the venue can dispute it.
- Support staff sign confidentiality terms before first access and work from inside the EU.
- The venue sees every read, command, refusal and outcome, and may audit.

**Why.**
- GDPR 28(3)(a): “only on documented instructions from the controller” [S1]; Commission clause 7.1(a): “Subsequent instructions may also be given by the controller throughout the duration of the processing of personal data. These instructions shall always be documented.” [S11]. Art. 29 forbids acting without one [S1].
- EDPB 07/2020, call-centre example: support staff “can only access data in order to provide the support that Company X has procured” [S2]. GDPR 28(3)(h): make available “all information necessary to demonstrate compliance” [S1].
- No text we read requires a second approver. Art. 32(1) asks for measures appropriate to the risk.

**How sure.** Normal route: sure. Emergency as standing instruction: likely; a specialist might want a second approver once there are two staff.
**Build now.** Slice 6 whole, disabled; slice 7's human key routes.
**Ask.** "Is a conditional emergency instruction in the signed agreement, used by one on-call person with a prior log and immediate report, a valid documented instruction?"

## 5. Backups, key waiting and the deletion promise

**Question.** Do shared-backup expiry and AWS's key waiting period break the promised deletion date?

**Best guess, as rules.**
- Day 90: withdraw all access, stop readers, destroy plaintext and cached keys, delete every copy we can delete, and disable the venue's own key (with a shared key, drop only the venue's wrapped data key; never touch a shared key). Once confirmed, schedule key deletion with the 7-day minimum, after all copies are observed gone.
- Shared backups of Cloud's own database expire within 30 days **[ours]**, so all is gone by day 120. Any restore replays the deletion list before anyone gets access. A residual copy shows as pending, never deleted.
- At the end the venue gets a certificate: what was deleted, when, what remains and why. Never its content.
- One person's erasure in a live venue: the same replay list on every restore, kept outside the database (P4).

**Why.**
- No fixed deadline exists: EDPB 07/2020 para. 141: “The processor should confirm to the controller that the deletion has been completed within an agreed timescale and in an agreed manner” [S2]. Clause 10(d): “certify to the controller that it has done so” and, meanwhile, “the processor shall continue to ensure compliance with these Clauses” [S11].
- EDPB 2026 report on backups: where deleting inside one is not advisable, “organisations should have appropriate procedures to keep track of erasure requests and comply with them on restored systems” [S23]. It mentions one month as practice seen, does not approve it, and says half the authorities raised concerns.
- AWS KMS: “The default waiting period is 30” days, range 7 to 30, and “the actual waiting period might be up to 24 hours longer” [S24]. AWS's own addendum ties return and deletion to the customer using its controls [S12].

**How sure.** Likely, if the contract says it plainly. A firm AEPD view on backups would change the 30 days.
**Build now.** Slice 10's inventory, states and certificate; slice 7's dependency checks and disable step.
**Ask.** "Is 'unreadable from day 90, destroyed by day 120, with a certificate' acceptable contract wording?"

## 6. What may be sent to an AI supplier

**Question.** Which concrete rule upholds the owner's no-personal-data instruction for menu translation?

**Best guess, as a rule (AI stays off).** Send a string only if **all** hold: (1) it is the customer-facing name, description or section title of an item **now on the venue's public menu**; house style becomes a fixed list, never typed text; internal and kitchen names are never sent; (2) no refusal pattern: email, web or social address, 6 or more digits in a row **[ours]**, DNI/NIE/NIF, bank number, date of birth, a title before a name, or text addressing a person; (3) checked **on the venue's side**, no word matches a name held for its staff, bookings or customers, unless a manager marks that exact string as a dish name; (4) a manager approved the exact strings; (5) the supplier has an art. 28 contract and an EU endpoint. Re-check every pass and retry. Rejected text is never logged. Nothing else goes out with it.

| Send (once enabled) | Refuse |
| --- | --- |
| Croquetas de jamón | Marta 600123456, sin frutos secos |
| Pizza Margherita (a manager confirms if a Margherita works there) | Menú para la Sra. López |
| Contiene frutos secos (a fact about a dish) | Sin gluten para la mesa de Juan (health of a person) |
| Tarta de la abuela | El arroz de [a named living chef]: identifiable, rename or skip |

**Why.** GDPR 4(1): personal data is “any information relating to an identified or identifiable natural person”; recital 26: the principles “should therefore not apply to anonymous information” [S1]. Dish text is normally not about a person; a name or phone makes it so. **Being public does not take it out of the law.** But the law does not demand zero: with a valid contract a stray name is lawful processing, not a breach. Rule 5 is that safety net. The CJEU (C-413/23 P, para. 82) looks at whether identification is “prohibited by law or impossible in practice” [S25]. The monitoring investigator's bundle (monitoring design section 13) needs its own list: error codes, versions, counts and code only, no log text; today's masked logs are still personal data (Waitron privacy research, Q57-2).

**How sure.** Uncertain: names that are also words cannot be settled by a filter.
**Build now.** None of slices 5–12 needs it. The rule and examples can be written as tests behind slice 1's refusal. Enabling still needs the owner's acceptance and its own plan.
**Ask.** "Given rule 5, is this five-part rule enough, and may we describe it as designed to exclude personal data?"

## P8. Waitron's own role

**Question.** When is Waitron (and Cloud) a processor, and when a controller?

**Best guess, as rules.**
- **Processor:** hosting, backup, export, venue email, remote transport on both paths (staff traffic it cannot read, and customer traffic it can read in memory), and diagnosing one venue's problem. Encryption changes nothing.
- **Controller:** accounts, sign-in, subscriptions, billing, and its own security and traffic records. These need Cloud's own privacy notice.
- **Every report is support first.** The agreement instructs Cloud to make a stripped record from it: error code, version, stack without values, counts; no free text, ids, or names of things. Only that feeds product repair. Never move a report into product repair as it is: for that Cloud would be a controller needing its own basis and a venue disclosure.
- The venue's notice names Waitron as a recipient. Breach notice to the venue: at once, and never later than 24 hours **[ours; AEPD: under 72]**, with updates after.

**Why.**
- EDPB 07/2020: a host that does not look at encrypted data “is processing personal data on employer A’s behalf and is therefore a processor”; a communications provider is controller for what runs the service “(e.g., traffic and billing data)” but not for the message; and a processor “may not carry out processing for its own purpose(s)” [S2].
- LOPDGDD 33.2: “Tendrá asimismo la consideración de responsable del tratamiento quien figurando como encargado utilizase los datos para sus propias finalidades” (a processor using data for its own ends is a controller) [S3]. GDPR 28(10) likewise.
- CNIL: reuse by a processor to improve its cloud service could be compatible “sous réserve de garanties appropriées telle que l’anonymisation des données” (with safeguards such as anonymising), and “une autorisation préalable et générale de réutilisation des données n’est pas légale” (a blanket prior permission is not legal) [S26]. French, persuasive only.
- GDPR 33(2): notify “without undue delay”; the AEPD's model says the contract's limit “debe ser inferior a 72 horas en cualquier caso” (under 72 hours in any case) [S1, S5].

**How sure.** Roles: likely to sure. Stripped record as an instructed step: likely.
**Build now.** Slice 6's intake roles and slice 11's routing and notice clocks.
**Ask.** "Confirm these roles, and that stripping a report on the venue's instruction keeps product repair outside the report's personal data."

## 7. Spain's Cloud running from Paris (added by the deployment design)

**Question.** If AWS Spain fails, may Spanish venues' data and keys be used from Paris?

**Best guess, as a rule.** Yes if the agreement names `eu-west-3` as an emergency location for that venue. A paired venue's box holds its invoices in Spain. A **hosted** venue may fail over only after it has told AEAT its invoices may be kept outside Spain; store that evidence in the country policy and refuse without it. The ordinary Paris backup does not change where the invoices are kept.

**Why.** GDPR 1(3): “The free movement of personal data within the Union shall be neither restricted nor prohibited” [S1]. But RD 1619/2012 art. 22.2: invoices kept outside Spain need “el acceso en línea” (online access), and the business “deberán comunicar con carácter previo esta circunstancia a la Agencia Estatal de Administración Tributaria” (must tell AEAT beforehand) [S6].

**How sure.** Privacy: sure. Tax: likely; whether a temporary failover counts is for the **tax** adviser.
**Build now.** A per-venue, per-country failover permission with evidence, default refused (slice 5's records).
**Ask the tax adviser.** "Does a temporary failover to France of a hosted venue's records need prior notice to AEAT?"

## Not asked anywhere, worth one minute of the specialist

- Does hosting many venues' allergy notes make Cloud need a data protection officer? GDPR 37(1)(c) covers “processing on a large scale of special categories of data” as a core activity of a controller **or processor** [S1].
- Cloud needs a processor's record of processing (GDPR 30(2)). The register is a start; it lacks each venue's contact.
- Stopping a hosted venue for non-payment is contract law, not answered here. Its data must stay returnable (question 1).

## Sources (all fetched 2026-11-24 unless noted)

[S1] GDPR, English: publications.europa.eu/resource/celex/32016R0679 (EUR-Lex itself returned an empty 202). Spanish also at boe.es DOUE-L-2016-80807.
[S2] EDPB 07/2020 v2.1: edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf
[S3] LOPDGDD, consolidated: boe.es/buscar/act.php?id=BOE-A-2018-16673
[S4] AEPD legal office report 0148/2019: aepd.es/documento/2019-0148.pdf (reviews one company's schedule; we apply it generally)
[S5] AEPD contract guide: aepd.es/guias/guia-directrices-contratos.pdf
[S6] RD 1619/2012: boe.es BOE-A-2012-14696 · [S7] Estatuto de los Trabajadores: boe.es BOE-A-2015-11430
[S8] RD 1007/2023: boe.es BOE-A-2023-24840 · [S9] AEPD closing decision AI/00040/2024: aepd.es/documento/ai-00040-2024.pdf
[S10] AEPD labour guide: aepd.es/guias/la-proteccion-de-datos-en-las-relaciones-laborales.pdf (a recruitment passage)
[S11] Decision (EU) 2021/915: publications.europa.eu/resource/celex/32021D0915
[S12] AWS addendum: d1.awsstatic.com/legal/aws-dpa/aws-dpa.pdf (the file is dated July 2023; check it is the current one) · [S13] Código de Comercio: boe.es BOE-A-1885-6627
[S14] LGT: boe.es BOE-A-2003-23186 · [S15] Código Civil: boe.es BOE-A-1889-4763
[S16] CNIL on logging: cnil.fr/fr/la-cnil-publie-une-recommandation-relative-aux-mesures-de-journalisation
[S17] EDPB Opinion 22/2024: edpb.europa.eu/system/files/2024-10/edpb_opinion_202422_relianceonprocessors-sub-processors_en.pdf
[S18] AWS sub-processors: aws.amazon.com/compliance/sub-processors/ · SES endpoints: docs.aws.amazon.com/general/latest/gr/ses.html
[S19] EDPB 05/2021 v2.0: edpb.europa.eu/system/files/2023-02/edpb_guidelines_05-2021_interplay_between_the_application_of_art3-chapter_v_of_the_gdpr_v2_en_0.pdf
[S20] OpenAI addendum: openai.com/policies/data-processing-addendum/ · [S21] developers.openai.com/api/docs/guides/your-data
[S22] developers.openai.com/api/docs/guides/data-residency
[S23] EDPB 2026 erasure report: edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf
[S24] docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html · [S25] CJEU C-413/23 P: publications.europa.eu/resource/celex/62023CJ0413 (about Regulation 2018/1725; applied by analogy)
[S26] CNIL on reuse by processors: cnil.fr/fr/sous-traitants-la-reutilisation-de-donnees-confiees-par-un-responsable-de-traitement

**Fetched, not quoted:** EDPB 9/2022 (breaches); AEPD reports 58/2022 and 84/2021; AEPD cloud guides for customers and providers; AI Act; Decision 2023/1795.
**Could not get:** EUR-Lex pages; the CJEU docket page for the appeal (C-703/25 P; no text without a browser).
**Search results only:** that the appeal is pending, and that the Digital Omnibus (which would change art. 33) is not adopted.
**Limits.** BOE consolidated texts and EU copies have no legal value in themselves. One web search and the AEPD documents above showed nothing on backups after a processor's exit, what counts as "return", log lengths, or an art. 32.5 exception. Absence is not proof. No supplier account, contract or certification was checked. Only what is quoted was checked.
