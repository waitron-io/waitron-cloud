> Moved from [Waitron at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-07-31-cloud-storage-model-design.md) on 2026-09-22.
> This is a historical reference. Its original decisions, proposals and evidence have
> been preserved; read the [current product discussion](../product-and-platform.md)
> and [cloud backlog](../backlog.md) for current scope and unresolved decisions.
> Technical and legal claims below have not been revalidated as part of this move.

# The cloud storage model: a sync root, not a shared system of record

**Date:** 2026-07-31
**Status:** approved design, not yet implemented
**Decides:** how many databases the cloud has, what they hold, and what a venue gets back after a
disaster.

---

## 1. Why this spec exists

`2026-07-18-pos-architecture-design.md` §5 establishes a sync tree — tills are leaves, a local
server is an interior node, "the cloud, when present, is the root" — and §4 records that the cloud
database is Postgres "with RLS as tenant backstop". What it does not settle is whether the cloud is a
**system of record** or a **sync target**, and the two answers produce very different systems.

The question surfaced from an unrelated direction. `fix/provisioning-migrate-gate` made
`waitron-provision instance` apply migrations on every run, which raised: when may a column ever be
dropped? For a shared multi-tenant database serving customers on different software versions, the
answer is "once every customer has upgraded" — which is unanswerable today, because **nothing records
what version any deployment runs** (`deployment` carries `environment` and `stamped_at` and nothing
else; there is no `app_version`/`schema_version` anywhere in `packages` or `apps`). That made the
tenancy model a blocker for an unrelated piece of work, which is why it is being settled now.

**Scope.** This spec decides the storage and tenancy model only. The sync protocol, the analytics
projection, the remote-admin surface and the local restore flow each depend on its answers and each
get their own spec (§10).

## 2. The cloud is a sync root and never a primary store

**Every venue runs a local server as its system of record.** The cloud holds copies.

> **Scoped, 2026-08-01 (#33).** This rule governs the **shared multi-tenant** store, and its reason is
> version skew — many tenants on one schema at many versions. A **dedicated single-tenant** cloud
> server has no such skew and *may* originate transactions: as a failover mirror, or deliberately as a
> venue's primary or only server (with the key ring then in the cloud as a standing posture). See
> [`2026-08-01-local-server-sif-and-failover-design.md`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-08-01-local-server-sif-and-failover-design.md)
> §9. The shared store described here is unchanged; the text below is left as written, per `CLAUDE.md`
> §6.

> **Superseded 2026-09-05 (owner decision).** There is no shared multi-tenant store: **one tenant per
> database everywhere, the cloud included.** Every cloud instance is a dedicated single-tenant server
> (the built cloud mirror's shape), so the version-skew reason above never arises and §9's isolation
> model has no consumer. Record: `docs/backlog.md` → *Whole-project design review (2026-09-05)*. Text
> left as written.

**This supersedes one row of `2026-07-18-pos-architecture-design.md` §5's topology table.** That table
lists "Cloud SaaS, no local hardware | till → cloud" as a supported deployment; under this design it
is not, because it would make the cloud a primary transactional store for those tenants and
reintroduce every problem §2 exists to remove — a shared schema serving multiple software versions,
with no version telemetry to reason about it. The architecture design carries a dated pointer to
this spec; its table is left as written, per `CLAUDE.md` §6. Reinstating that topology is not a
tweak to this design — it is a different one, and would need this spec revisited whole.

This is the decision everything else follows from, and it dissolves the problem that prompted the
spec:

| Store | Writers | Versions in play | Skew? |
| --- | --- | --- | --- |
| A venue's local database | that venue's server | one — code and schema deploy together | none |
| The cloud database | the cloud deployment | one | none |
| Between them | the sync protocol | many | **all of it, here** |

No schema is ever shared between two software versions. Version skew moves entirely into the sync
protocol, which is a place designed to have it and where versioning is a solved problem. The
corollary matters for the work that raised this: **the additive-only migration constraint applies to
the protocol, not to any database schema**, and `instance` provisioning a single-tenant database
becomes the ordinary case rather than a special one.

## 3. The cloud is never in a critical path

Stated as invariants, because each is a thing the design must not quietly acquire later:

- **Never in the sale path.** Nothing about taking a sale consults it.
- **Never in the payment path.** No provider callback need ever reach Waitron's cloud for a payment
  to become correct. Card-present outcomes resolve on the local server — synchronously through the
  till's own call where the terminal answers in time, and otherwise by a local sweep: the SumUp
  design (`2026-07-30-sumup-card-present-provider-design.md`) leaves a timed-out poll `attempting`
  and settles it later via `resolvePending`, and `packages/payments/src/store.ts` carries the
  analogous `accepted_offline` path. Card-not-present is backstopped by the reconciler, built around
  "the processor's settlement report for a window" (`packages/payments/src/reconcile.ts:49`) — a
  pull, not a callback. Webhooks are therefore a **latency optimisation, not a correctness
  requirement**, as that spec already states independently.
- **Never holds the key ring.** See §6.
- **May be down indefinitely** without a venue losing the ability to trade.

**One concession, made explicitly rather than discovered later: the cloud IS required to commission a
till, for subscribers.** See §6a — a taxpayer's installation-number counter must have exactly one
writer, and "every venue runs its own server" removes the single writer that a multi-site taxpayer
previously had. Commissioning is rare, administrative, and never happens mid-service; selling is
neither. The invariant is therefore *never needed to sell*, not *never needed at all*, and the
difference is stated here so nothing quietly widens it.

A venue with no internet loses asynchronous card confirmation — the provider cannot reach anyone —
and cannot commission a new till until the link returns. It keeps trading on the tills it has.

## 4. What the cloud stores

| Shape | Contents | Mutability |
| --- | --- | --- |
| **Fiscal archive** | `registros_facturacion`, keyed to the SIF lifetime that produced them (§5) | **Append-only.** The source is immutable by trigger — `REVOKE ALL`, an append-only trigger and a TRUNCATE-blocking trigger (`packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql`) — so a mutable copy could silently disagree with the venue's own. |
| **Submission state** | `envios` | **Mutable, deliberately.** `packages/fiscal-verifactu/src/schema/envios.ts` describes it as "the delivery state that mutates constantly… submission state cannot live on an immutable table", and `app_user` holds `UPDATE` on it. An append-only copy would freeze every archived record at `pendiente` and report a fully-filed venue as unsubmitted. |
| **History** | Sales and invoices | Append-only; immutable once closed at the source. |
| **Mutable history** | `payments`, `incidents` | **Mutable, like `envios`.** A payment moves `attempting` → `captured`/`failed` and an `accepted_offline` one settles later (`packages/payments/src/store.ts`); an incident gains `acknowledged_at`/`acknowledged_by`. `app_user` holds `UPDATE` on both locally. Frozen in the archive, every card payment reads as still in flight and every acknowledged incident stays open. See §9. |
| **Configuration** | Tenant identity (`tenant_id`), catalogue, locations, till registry **including each `tills.id`**, the `invoice_series` definitions (`code`, `purpose`, `till_id` — but NOT `next_number`, see Counters), staff, sealed credentials, hardware settings | **Versioned snapshots**, not current-state. |
| **Counters** | `invoice_series.next_number` (venue is authoritative; the cloud holds a high-water mark), `contadores_instalacion.proximo_numero` (the **cloud** is authoritative for subscribers — §6a) | **Monotonic.** Synced continuously, never versioned, never rolled back. The two flow in opposite directions and that is deliberate: see below. |

**Counters are not configuration, and putting them there was a category error.** An earlier draft of
this spec filed `next_number` inside the configuration snapshot. That is wrong twice over. First, the
snapshot exists so an operator can say "restore my configuration as of last Tuesday" — which would
drag the invoice counter backwards with the menu and reissue numbers already used. Second, a busy
till advances `next_number` on every sale, so a counter inside a whole-config snapshot produces a new
snapshot per invoice rather than the kilobytes the design claims.

Counters are therefore their own row, with one rule: **a counter may only ever move forward.** Sync
carries the high-water mark; restore resumes past it (§5); nothing may set either counter to a value
at or below one already observed.

**They do not flow the same way, and the authoritative side is named per counter rather than left to
be inferred.** `next_number` is allocated by the venue as it sells — the cloud only observes it, and
observes it late. `contadores_instalacion` is the opposite: §6a makes the cloud the single allocator
for subscribers, precisely because the venue cannot be. Under-specifying which side owns a counter is
what produced the multi-venue collision §6a exists to fix, so it is stated rather than implied. A gap in a series is visible and legal — this codebase already
tolerates one when a pre-production database burns numbers — whereas a repeat is neither.

Configuration is the one that had to change shape. A current-state, last-write-wins snapshot
faithfully replicates mistakes: someone deletes half the menu, it syncs up, and the backup has
destroyed the recovery point. **Whole-config snapshots, content-addressed and deduplicated, retained
indefinitely** — an unchanged config records "still in effect at T" rather than storing a copy.

Whole-config rather than per-entity versioning, because restore then means "give me the configuration
as of T" rather than assembling a consistent view from independently-versioned entities — fewer
failure modes at the moment they are least affordable. Configuration is kilobytes; retaining every
distinct version is free.

A useful side effect is an audit trail: every configuration a venue has ever had, with the window
each was in effect. Capturing the actor alongside it is worth doing where the local server knows it,
but is not a requirement of this design.

This does not affect fiscal correctness in either direction: §6 of the architecture design already
establishes that invoices snapshot their values rather than referencing them, so a historical price
lives on the invoice and is never derived from configuration history.

## 5. The restore promise

**What a venue is owed after losing its server: its records, its history, and its configuration.
Not its in-flight trading state.**

**The governing rule is that every counter jumps FORWARD, never back.** The cloud knows a counter
only as of the last successful sync, and §3 permits it to be offline indefinitely — so a venue that
traded past its last sync and then lost its server has a cloud value that is *behind reality*.
Resuming exactly at the remembered value would reissue numbers already used. Resuming past it cannot.
An earlier draft of this spec said numbering "resumes from the restored `next_number`", which was
wrong for precisely this reason and is the shape of error this rule exists to prevent.

Given a replacement box and the key ring the operator was told to keep:

1. `waitron-provision instance` — a blank local database.
2. Configuration is pulled from the cloud: catalogue, locations, staff, series, sealed credentials,
   **and every `tills.id` unchanged**. Till identity is not cosmetic: `invoice_series.till_id` is a
   foreign key and `packages/core/src/record-sale.ts` refuses a series whose till does not match the
   selling till, so a regenerated till ID does not orphan the series quietly — `onDelete: "restrict"` means the
   restore fails outright — and an operator who works around it by creating fresh series starts at
   1.
3. The operator supplies the key ring; credentials unseal. **`tenant_id` must be restored, never
   regenerated** — see §6.
4. Each till is re-registered, minting a **new installation number** from the counter in §6a — which
   is the existing invariant for reimaged hardware, and is also what keeps the second lifetime's
   records from colliding with the first — see "Why the archive keys on the SIF lifetime" below.
5. **Series numbering resumes STRICTLY ABOVE the remembered `next_number`.** The chain restarts and
   the numbering skips forward; the skipped range is a visible gap, which is the acceptable outcome.

   **What this does and does not guarantee.** It makes it impossible to reuse a number the cloud has
   SEEN. It cannot by itself rule out reusing one issued after the last successful sync, because §3
   permits the cloud to be arbitrarily far behind and those numbers are unknown to it by
   construction. A fixed "safety margin" is a guess at an unknowable quantity and is not claimed
   here. The residual is real: a collision would be caught at the archive by
   `registros_identidad_uq` — after the record was filed with AEAT, which is too late to be a
   control. Closing it needs a source of truth that survived the disaster, and the tills are the
   obvious candidate, since sales flow UP and each till holds what it sent. That belongs to the
   restore-flow spec (§10), which must not treat this rule as sufficient on its own.
6. The fiscal archive and history are **not** replayed into the new local database.

Point 6 is a decision, not an omission. Replaying historical records into tables whose purpose is
append-only immutability, under a hash chain the replacement till is not part of, is the operation
most likely to produce something unverifiable — and unverifiable is the one outcome Veri*Factu exists
to make detectable. The venue keeps access to its history through §7 instead.

**Why the archive keys on the SIF lifetime.** `cadenas.secuencia` is documented
"monotonic across SIF identities and never reset", but a blank database restarts it at 1 — while the
cloud archive still holds 1…N for that till from its previous life. Keyed on `(tenant, till,
secuencia)` alone, the restored venue's very first record would collide with an archived one and
every subsequent ingest would fail, with no repair path behind an append-only ingest role.

The fix needs no new column. `registros_facturacion` already carries `sif_id`, a foreign key to the
`registro_sif` row that produced it, and point 4 mints a fresh `registro_sif` per lifetime — so
`sif_id` is already distinct per lifetime and per venue. Keying the archive on it removes the
collision. (An earlier draft said "tagged with the installation number… without inventing anything";
the number itself lives on `registro_sif.numero_instalacion`, not on the archived row, so `sif_id` is
what the archive actually has to hand.)

## 6. Credentials survive a disaster without the cloud ever holding a secret

`tenant_credentials` stores AES-GCM sealed blobs — `ciphertext`, `iv`, `auth_tag`, `key_version` —
with the AAD bound to `(tenant_id, purpose)` (`packages/credentials/src/cipher.ts:23-25`; the
`key_version` column itself is declared in `packages/credentials/src/schema/tenant-credentials.ts`). The rows are
useless without the key ring, and **the cloud never holds the key ring**. So the sealed blobs can be
synced and restored, which is what makes "get installed again after a disaster" reach the fiscal
certificate and the payment credentials rather than stopping short of them.

Two consequences the implementation must respect:

- **`tenant_id` is restored, not regenerated.** The AAD binds to it; a fresh UUID makes every sealed
  blob permanently unopenable.
- **The key ring remains the operator's to keep.** This design does not weaken that, and must not
  drift into "the cloud can recover it for you" — it cannot, by construction, and that is the point.

## 6a. The installation-number counter has exactly one writer

`contadores_instalacion` is keyed `(nif, id_sistema_informatico)` and carries deliberately no
`tenant_id` and no RLS. Its own comment states the reason: *"a single writer cannot guarantee
uniqueness over rows a policy hides from it"* — the counter is sound only where one thing allocates
for a given taxpayer.

**§2 removes that single writer.** A taxpayer is one NIF (`tenants_nif_key` makes it unique **within a database** — and under §2 each venue has its own, so the same NIF legitimately exists in several, which is the whole reason a per-venue allocator cannot work) and may
run several venues; under this design each venue has its own server and therefore its own counter,
and two branches would both mint installation number 1. AEAT is explicit that they must not:
`docs/compliance/verifactu-findings.md` quotes the FAQ — *"cada una de esas facturaciones distintas
(sean de distintos OEF o del mismo OEF pero de distintos centros de facturación independientes, como
tiendas) debe tener un nº de instalación propio y distinto al resto"*. The topology §2 supersedes was
the only one in which a single allocator served all of a taxpayer's tills; removing it without
replacing the allocator was a defect in this spec's first draft.

**The installation number therefore becomes an input the tool accepts, not only a value it
generates**, with two sources:

- **Subscribers: the cloud allocates.** One writer per NIF, across every venue that taxpayer runs.
  This is the §3 concession — required to commission a till, never to sell.
- **Self-hosted: the operator sets it during setup**, documented, with the constraint stated plainly:
  each billing point of the same taxpayer needs its own number, and no number is ever reused. A
  multi-branch self-hosted operator assigns them.

Both paths obey §4's forward-only rule. An operator restoring without a cloud record and without
their own note has one safe move: **choose a number above any they have used.** Numbers that were
skipped cost nothing; a number reused cannot be repaired, because chains cannot be merged.

## 7. Reporting: one projection, two hosts

Reports run **from the cloud for subscribers** and **locally for self-hosted deployments**. The same
projection — one schema, one transform — deployed in either place, following
`2026-07-18-pos-architecture-design.md` §5's "one sync implementation, tested once" rather than
inventing a cloud-only concept.

This turns **this document's** §5 point 6 from a limitation into the product: a subscriber's reports live where their
data lives, and a venue that never subscribes runs the identical reporting locally over its own data.

**Export on demand is a requirement, not a courtesy.** A customer ending their subscription takes
their data with them. This is also regulatory — see §8.

## 8. Regulatory position

Per `CLAUDE.md` §1, external claims carry their source's own words rather than a paraphrase.

Quoted in full rather than trimmed to the convenient clause. An earlier draft of this section elided
both of the emphasised passages below, and each elision mattered — which is `CLAUDE.md` §1's own
warning ("qualifiers carry the meaning and are exactly what compression removes") landing on the
section that cites it.

| Source | Verbatim |
| --- | --- |
| RRSIF (RD 1007/2023) art. 7.a) | *"Podrá utilizarse un mismo sistema informático **para el cumplimiento del presente Reglamento** por parte de diversos obligados tributarios en el ejercicio de su actividad económica siempre que los registros de facturación de cada obligado tributario se encuentren diferenciados **y se cumplan los requisitos exigidos en este Reglamento por separado para cada uno de los obligados tributarios**"* |
| AEAT FAQ, SIF for multiple obligados | *"debe gestionar separadamente los registros de facturación y, en su caso, de evento de cada OEF incluido en el SIF, **cumpliendo con los requisitos exigidos en los artículos 7.a) y 8 del RRSIF**, con encadenamiento independiente para dichos registros de cada OEF"* |
| RRSIF art. 8.2.c) | *"El sistema informático deberá contar con un procedimiento de descarga, volcado y archivo seguro de los registros de facturación generados por él, que deberán poder ser exportados a un almacenamiento externo en formato electrónico legible."* |

Sources: [BOE RD 1007/2023](https://www.boe.es/buscar/act.php?id=BOE-A-2023-24840) ·
[AEAT FAQ](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/caracteristicas-requisitos-sistemas-informaticos-facturacion-multiple.html)

**What the sources establish.** A multi-taxpayer system is permitted, on two conjoined conditions:
records *diferenciados*, **and** the Regulation's requirements met *por separado* for each taxpayer.
Independent chaining is what AEAT names when glossing the first — it is one requirement among those
of arts. 7.a) and 8, not the whole test. Neither source mentions physical separation, separate
databases or separate instances.

Waitron already satisfies the chaining condition structurally rather than by policy: a SIF is
identified by NIF + IdSIF + NºInstalación, enforced by `registro_sif_instalacion_uq`
(`packages/fiscal-verifactu/src/schema/sif.ts`), with the 23505 pinned by tests in
`registro-sif.test.ts`. §6a is what keeps that true once every venue runs its own server.

**What they do not establish, and the tension is real rather than rhetorical.** Art. 7.a) is scoped
by its own words to a system used *"para el cumplimiento del presente Reglamento"* — a SIF. The cloud
archive is **not** a SIF: it issues no invoices and generates no registros. So the article most
directly on point governs something other than the thing being ruled on, and no provision was found
that expressly addresses a third party conserving registros on a taxpayer's behalf. Absence of text
is weak evidence in both directions.

What art. 7.a) does supply is evidence about what Spanish fiscal law *cares about* when one system
holds several taxpayers' records: differentiation and separate compliance, not storage topology. That
is an inference from the regulator's evident concern, not an application of the article.

**Ruling taken 2026-07-31, by the user, on that basis:** records need not be stored separately per
taxpayer; they must be **exportable** separately. The export path must therefore produce one
taxpayer's registros in isolation in legible electronic format — which art. 8.2.c) requires
independently of this design, and which is why §7 treats export as a requirement rather than a
courtesy.

This remains a sourced reading rather than legal advice. One branch is left open: if the archive
*were* in scope, the strongest text against a shared store is the conjunct restored above — *"y se
cumplan los requisitos exigidos en este Reglamento por separado para cada uno de los obligados
tributarios"* — and this design engages it only by arguing the archive is probably out of scope.

### 8a. The RRSIF is the wrong regulation for the archive. The ROF is the right one.

An earlier version of this section closed by asking an advisor *"does the RRSIF reach a backup archive
that is not itself a SIF?"* — a question this same section had already answered two paragraphs
earlier, and which pointed at the regulation **least** likely to govern an archive. The RRSIF governs
systems that *support invoicing processes*. An archive issues nothing.

What governs records once they exist is the **ROF** — the Reglamento de obligaciones de facturación,
RD 1619/2012 — and it addresses a third party holding them directly. The articles that bear on this
design:

| Source | Verbatim |
| --- | --- |
| ROF art. 19.3 | *"Las obligaciones a las que se refiere el apartado anterior se podrán cumplir materialmente por un tercero, que actuará en todo caso en nombre y por cuenta del empresario o profesional o sujeto pasivo, el cual será, en cualquier caso, responsable del cumplimiento de todas las obligaciones que se establecen en este capítulo."* |
| ROF art. 22.1 | *"…podrá determinar el lugar de cumplimiento de dicha obligación, a condición de que ponga a disposición del órgano de la Administración tributaria que esté desarrollando una actuación dirigida a la comprobación de su situación tributaria, ante cualquier solicitud de dicho órgano y sin demora injustificada, toda la documentación o información así conservadas."* |
| ROF art. 22.2 | *"Cuando la conservación se efectúe **fuera de España**, tal obligación únicamente se considerará válidamente cumplida si se realiza mediante el uso de medios electrónicos que garanticen el acceso en línea así como la carga remota y utilización por parte de la Administración tributaria… deberán comunicar **con carácter previo** esta circunstancia a la Agencia Estatal de Administración Tributaria."* |
| ROF art. 23 | *"…se deberá garantizar a cualquier órgano de la Administración tributaria que esté realizando una actuación de comprobación… el acceso en línea a los documentos conservados, así como su carga remota y utilización."* |

Source: [BOE RD 1619/2012](https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696). Arts. 19.3 and
22.2 were read twice, on separate fetches, because the hosting constraint below rests on them.
**Art. 19.4 is reported at one remove and is NOT quoted here**: it restricts third-party fulfilment
outside the EU unless the third party sits in Canarias, Ceuta, Melilla or a state with mutual-
assistance instruments comparable to the EU's, with prior notification. It is the most
decision-shaping of the four and the least verified — read it directly before relying on it.

**This may constrain where the cloud is allowed to run**, which is why it is in the spec rather than
in a follow-up. The layers, weakest to strongest:

1. **Hosted in Spain** — art. 22.1 only: available to AEAT without unjustified delay.
2. **Hosted elsewhere in the EU** — art. 22.2 adds online access, remote download and use by AEAT,
   **and a prior notification to AEAT**. Note whose duty that is: art. 19.3 keeps every obligation on
   the client, so the notification is *theirs*, and a product that silently puts their records outside
   Spain has created a filing duty they do not know they have.
3. **Hosted outside the EU** — art. 19.4's restriction, above.

Art. 23 is not conditional on location: any electronic conservation must be able to give an
inspecting body online access, remote download and use. That is a **stronger requirement than §7's
"exportable on demand"**, and this design does not currently meet it — export produces a file, where
art. 23 describes access. §10 records the gap.

**The questions actually worth an advisor's time**, replacing the retired one:

1. Is Waitron a *tercero* under art. 19.3 while the client's own local server remains the system of
   record and holds its own copy — or only in the disaster case, when our archive is briefly the only
   copy left? §5 is built around exactly that case.
2. If we are, does art. 22.2's prior-notification duty fall on every client whose records we hold
   outside Spain, and is that a duty we must prompt them to discharge?
3. Does art. 23's online-access requirement reach us as the holder, or only the client as the
   obligado?

## 9. Isolation

> **Superseded 2026-09-05 (owner decision):** one tenant per database, cloud included — there is no
> shared cloud database, so the RLS-scoped store below is not built. The per-table
> immutability-by-grant point still applies to a dedicated mirror (SP-3a #238 verified it on
> `postgres:18`). Text left as written.

**One shared cloud database**, tenant-scoped by RLS — the model already built and exercised for
exactly this shape. Two additions beyond reusing it:

**Reproduce the local immutability guarantees at the grant level, table by table — not blanket.**
Locally, `registros_facturacion` carries `REVOKE ALL`, an append-only trigger and a TRUNCATE-blocking
trigger; the cloud archive carries the same, and the ingest role holds `INSERT` and nothing else on
it. A cloud that can `UPDATE` a fiscal record it received is a cloud that can silently disagree with
the venue's own copy, and the archive's entire value is that it agrees.

**Which tables are append-only is decided by reading each one's local grants, never by category.**
`registros_facturacion` is immutable and the ingest role holds `INSERT` on it alone. Three others in
§4 are not, and each would break in the same way if swept into the immutable rule:

- **`envios`** — submission state, mutating as AEAT responds; `app_user` holds `UPDATE`
  (`packages/fiscal-verifactu/drizzle/0001_registros_inmutables.sql`). Frozen, it reports a
  fully-filed venue as `pendiente` forever.
- **`payments`** — `attempting` → `captured`/`failed`, and the `accepted_offline` path settles later
  (`packages/payments/src/store.ts`); `app_user` holds `UPDATE`
  (`packages/payments/drizzle/0001_payments_rls.sql`). Frozen, every archived card payment reads as
  still in flight — and §3's own account of card-present capture describes exactly this mutation.
- **`incidents`** — `app_user` holds `UPDATE` on `acknowledged_at`/`acknowledged_by`
  (`packages/db/drizzle/0008_incidents_privileges.sql`). Frozen, an acknowledged incident stays open
  in the archive forever.

An earlier draft of this section said the ingest role holds `UPDATE` "on `envios` and on nothing
else". That was wrong in the sentence immediately after correctly diagnosing the identical problem
for `envios` — this repository's "grep the siblings" rule, missed on the very fix written to satisfy
it. **The implementation derives the ingest grants from each table's local grants rather than from a
list in this document**, so the next mutable table added cannot silently acquire the same bug.

**One shared cloud database means one environment.** `2026-07-29-deployment-environment-design.md`
fixes "one database per environment, and a pre-production database is never promoted", and the reason
is exactly the counters §4 governs: a pre-production venue's `next_number` handed back to a production
one leaves a permanent hole in a live series. Pre-production venues therefore sync to a **separate
pre-production cloud store**, stamped as such, and the ingest path refuses a venue whose stamp
disagrees with the store's. "One shared cloud database" in this section means one per environment.

**Separate roles by job**, following the least-privilege pattern the provisioning tool establishes: an
ingest role, a read role for remote admin, an analytics role. None a superuser, none holding
`BYPASSRLS` — `planInstance`'s `assertUsable` already refuses those for a reason that transfers
directly: a role that ignores tenant isolation produces a deployment that looks provisioned and
isolates nothing.

## 10. Out of scope

Each of these depends on this spec's answers and gets its own:

- **The sync protocol** — the version boundary §2 puts all the skew into. The largest of these.
- **The analytics/reporting projection** and its transform (§7).
- **The remote-admin read surface.**
- **The local restore flow** — the client half of §5.
- **Data export** — the mechanism art. 8.2.c) requires and §7 promises.

**Deliberately not built:** a control-plane database (needed only for per-tenant cloud databases, which
this design rejects); fleet migration tooling (the cloud is one deployment at one version); a webhook
endpoint as a correctness mechanism (§3 demotes it to an optimisation).

**Open, and owned by nobody yet:**

- **Where the cloud is allowed to run** (§8a). Hosting outside Spain triggers art. 22.2's online-
  access conditions and a prior-notification duty that falls on the *client*; hosting outside the EU
  meets art. 19.4's restriction. This is a decision to take **before** anything is built, because it
  is a hosting choice with a customer-facing filing obligation attached, and unwinding it later means
  moving other people's fiscal records.
- **Art. 23 access versus §7 export.** §7 promises records are *exportable* on demand. Art. 23
  describes *"acceso en línea… carga remota y utilización"* by an inspecting body — access, not a
  file. Whether that binds us or only the client is §8a's third question, but if it binds us the
  export mechanism is not sufficient and the remote-admin spec inherits the requirement.
- The three advisor questions in §8a, and the one residual branch in §8 (what follows if the archive
  *is* in RRSIF scope after all).
- Whether version telemetry is worth adding for its own sake, now that it is no longer load-bearing
  for schema evolution.
