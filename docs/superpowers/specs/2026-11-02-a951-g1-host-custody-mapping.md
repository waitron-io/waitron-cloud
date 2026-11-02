# A951 G1 mapping to host and socket custody

**Artifact:** `cloud-a951-g1-host-custody-v1`  
**Edition:** `proposal-2026-11-02.1`  
**Status:** Cloud engineering mapping proposal for E/G acceptance; admission CLOSED.

You need to preserve a stop across processes, stores and reboots before a signed
configuration can safely drive remote access. This maps D132's appliance profile
to the exact helper and host proposals below. It supplies requirements, local
representations and proposed E amendments, not implementations or runtime proof.
Only this documented mapping is offered for engineering acceptance. The complete
appliance artifact, host qualification and executable consumers remain unaccepted.

Publish this file immutably. After final review, hash its complete UTF-8 bytes,
including the final newline, and record the digest outside this file in Cloud's
contract and E's intake/plan. A correction needs a successor edition and digest.
No publication hash is an acceptance signature or a runtime receipt.

## 1. Sources and scope

All Waitron paths in the following table were read through `git show` at full pin
`bfb185b60bfe241b713fde536ddf87cbf4bb1ffc` (W). Cloud's review base is
`b522fa943a15badafbb4e88e9e7c637f2bd58d51` (C). These are source pins only.
Section references to A, H, X, P, I and C below mean these exact files.

| Ref | Exact source and disposition |
| --- | --- |
| A | [Appliance proposal](https://github.com/clintongormley/waitron/blob/bfb185b60bfe241b713fde536ddf87cbf4bb1ffc/docs/superpowers/specs/2026-10-23-a951-appliance-v1-proposal.md), `waitron-a951-appliance-v1` / `proposal-2026-10-23.1`; full publication SHA-256 `f97dbc1864e37911ecb9d16dd87b436d729fd43bbef220633c3b09cae7c93fb0`, normative boundary digest `fede39bb64077167f145c942cc63599526ab48fae0274e4cc0b8a4e6efcca728`. Neither is an acceptance digest. |
| H | [Original helper](https://github.com/clintongormley/waitron/blob/bfb185b60bfe241b713fde536ddf87cbf4bb1ffc/docs/superpowers/specs/2026-10-23-a951-local-helper-v1-proposal.md), `waitron-a951-helper-v1` / `proposal-2026-10-23.1`; SHA-256 `da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f`. D130 and P record E/G acceptance solely for isolated T3 with injected policy. |
| X | [Full host/custody amendment](https://github.com/clintongormley/waitron/blob/bfb185b60bfe241b713fde536ddf87cbf4bb1ffc/docs/superpowers/specs/2026-11-02-a951-host-custody-amendment.md), `waitron-a951-host-custody-v1` / `proposal-2026-11-02.1`; SHA-256 `50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2`. Full input, including sections 1–9, not code proof or host acceptance. |
| P | [Connection plan](https://github.com/clintongormley/waitron/blob/bfb185b60bfe241b713fde536ddf87cbf4bb1ffc/docs/superpowers/plans/2026-10-22-a951-connection.md), especially the dated host/A1018 updates, focused D130/D132 amendment, G1 row and T1/T2/T3/T5/T14. |
| I | [Build intake](https://github.com/clintongormley/waitron/blob/bfb185b60bfe241b713fde536ddf87cbf4bb1ffc/docs/developers/cloud-connection.md#a951-build-intake). Its dated entries preserve earlier dispositions; use C/D136 for Cloud's later routing acceptance. |
| C | [Cloud contract at review base](https://github.com/waitron-io/waitron-cloud/blob/b522fa943a15badafbb4e88e9e7c637f2bd58d51/docs/waitron-integration-contract.md), D123, D130, D132 and D136. These historical responses remain byte-for-byte unchanged. |

`git ls-tree -r --name-only W docs` shows A as the only appliance proposal at
this pin, alongside H, routing original/revision 2 and X. No successor appliance
publication or full-appliance acceptance is established by this source set.
D132's four returned amendments remain visible: this mapping addresses the
safety/host return and names the still missing approval/provisioning consumers;
it does not supply the complete signed corpus or revised full appliance edition.

Keep the original empty production manifest's **83 ASCII bytes, no final LF**:
`{"schema":"waitron-a951-routing-v1","revision":"proposal-2026-10-23.1","routes":[]}`.
SHA-256 remains `271fefd892b2c0f10ffab42f8e4a832a163b244733285f08d5a0ea1dfab1b012`.
D136 accepts routing edition `proposal-2026-10-23.2`, full digest
`974c4e98eb7d583d82ad1c573f9dcec01c63b2cc4f6630d38aeda22775d198d0`;
that changes neither manifest bytes nor its revision. E must record the matching
routing disposition. This mapping creates no new Waitron location concept.
A951 still serves one venue with no location parameter.

G2 needs actual A947 current authority/freshness/withdrawal and compatible
A1018/D88 mapping. G3 is unchanged opt-in, test-only staff v1. G4 needs independent
public-upstream identity, issuer, trust and mTLS. G5 movement/replacement stays
refused. G6 keeps routing plus flow-scoped A980/D101 processing, access,
destinations and retention, including staff metadata; a local receipt grants no
export permission. G7 needs exact executable/host/image/DNS/issuer/device/origin
receipts for each affected path. `.local` stays independent. No writer, fiscal,
publication/pause, provider, deployment or customer-product authority follows.
P's 24 October A1018 update records owner design approval: M2 handles all AEAT
after takeover; M1 returns fiscal originals/outcomes only. Formats, compatible
A947 changes, separate A1018 build authority and physical proof remain open.

## 2. Complete G1 acceptance matrix

Read each row as an inherited requirement mapped to future consumers. Rows do
not report execution or accept the complete appliance. A/H exact field tables,
closed enums and byte grammars are incorporated unchanged at the pins above.
Missing dependencies are named in section 6; G7 evidence is named in X §§8–9.

| Boundary and exact source section | Required mapping, preserved bounds and future owner |
| --- | --- |
| Closed actions/authentication: A §2; C/D123, D132 | T1/T5 use exactly POST `/api/installations/` plus `appliance-fetch`, `appliance-report`, `appliance-report-status`, `appliance-establish`, `appliance-recover`, `appliance-reconnect`, `appliance-trust`. No query, redirect, compression, browser Origin, cookie or bearer credential. Configured exact HTTPS origin and identity encoding only. Machine bytes stay `J(["waitron-cloud-machine-v1",origin,action,installationId,operationId,issuedAt,lease,body])`; lease/body remain strings, signed by stored installation Ed25519 key. Verify stored registration/key, live control lease's origin/installation/venue/environment/public key, revocation and 60,000 ms proof window; lease ≤3,600,000 ms. Neither is transport/writer approval. C's existing allowlist has no appliance actions; T1/T5 integration and AP consumers remain missing. |
| Canonical domains/types: A §§1–3, 4, 5, 7 | T1 implements exact compact ordered printable-ASCII JSON J, no BOM/whitespace/LF, literal strings except `\"`/`\\`, no alternative escapes, duplicate/unknown/missing keys, surplus elements, coercion or noncanonical number spelling. Unsigned safe N=0..9007199254740991, U=1..9007199254740991; H=32 lower hex, D=64; I restricted ASCII 1–64; canonical lowercase UUID; T Unix-ms N. E has exactly ordered payload/signature, round-trip unpadded base64url, decoded Ed25519 signature 64 bytes/86 characters. Sign decoded payload bytes. Domains remain machine above; ordered `waitron-a951-response-v1`, `waitron-a951-grant-v1`, `waitron-a951-trust-v1` arrays exactly A §3; digest prefixes `waitron-a951-request-body-v1`+LF+body, `waitron-a951-content-v1`+LF+J(C), `waitron-a951-report-v1`+LF+J(Report). Certificate projection hashes its exact A §5 array without extra prefix. All closed success/refusal/report/status schemas remain A §§2/7/8. |
| Trust/root/rotation: A §3 | T1/T2/verifier verify offline A951 root provisioned locally for exact origin/environment; replies cannot replace root/TLS trust. keyId is SHA-256 of canonical Ed25519 SPKI DER; public DER base64url ≤128 characters. Separate machine, response, grant, recovery, offline root, lease, staff TLS, public TLS and local WireGuard purposes/custody. Response keys sign ordinary fetch/report/status; recovery keys sign establish/recover/reconnect under response domain; root signs Trust only. Response lifetime ≤60,000 ms, issued ≤wall+30,000 and expiry >wall+30,000. Trust ≤86,400,000 ms, key validity ≤2,592,000,000 ms; eight sorted bundle entries, two active keys/purpose, overlap ≤600,000 ms. Successor precedes overlap; reject predecessor afterwards even on saved bytes. Strictly higher trust revision or exact same-revision bytes only; omission retires, revoked/retired never reintroduced. Lifetime history ≤256 without eviction. Validated durable revocation closes affected paths ≤1,000 ms; unseen partition revocation remains bounded by existing expiries. Sections 4–6 define storage and missing provisioning. |
| Bindings/topology: A §§1/4/6; H Local records | T1/verifier map exact B originId/environment/cloudVenue/installation/localVenue/node/machineIdentity/target/establishmentEpoch/placementEpoch to H B field-for-field. Cloud venue/installation are UUIDs; authenticated UUID node strips four hyphens reversibly into H, already-H unchanged, other spelling blocked. machineIdentity is SHA-256(machine Ed25519 SPKI DER). Exact HTTPS origin registry ≤256 ASCII bytes with no path/query/fragment/userinfo/trailing slash; locally map development/preproduction to test, production to production; fixture constructor separate. B.target is endpoint ID; C.authorityTargetRef is actual G2 target and authorityBindingRef stable scope, not a proof. Cell/gateway/peer/addresses/names/ports/manifest/certificate-policy bindings remain in exact C and its digest. One endpoint/cell/gateway/placement/candidate; no predecessor or roaming. Origin, venue, installation, node, key, target, cell, placement, gateway, endpoint, addresses or peer change refuses wrong_binding/unsupported_topology pending G5. Name/service/policy changes require verified old-generation removal before staging. Epoch ID opaque I, ordered only by separate epochOrdinal; recovery changes establishment epoch only. REG/POL/PEER/KEY/G2 consumers remain missing. |
| Three counters and local floors: A §§1/4/8; H Stage, retry | T1/T2/T5 preserve Cloud installation configuration revision, stable content revision and transport grant sequence independently. Candidate installation revision ≥1; genuine zero never becomes one. Equal content revision requires identical canonical C/digest; changed C requires greater revision, greater revision with same C refuses. Newly minted grant strictly increases across content/recovery epochs; equal only identical saved bytes/deadline, lower refuses. Installation-only change can preserve C but needs higher grant and invalidates staff intent. No gateway sequence substitution. Separate request/report/trust/epoch floors, local resource generation, per-caller helper sequences, observation/custody sequences and scope S/W remain separate. Exhaustion refuses with no wrap/reset; unknown state never means zero. |
| Staff projection/CSR: A §5; C/D123 staff facts | T1/T5 preserve exact projection `J(["waitron-a951-certificate-binding-v1",P,origin,B,authorityTargetRef,authorityBindingRef,hostnameTriple,issuerPolicyRef,keyPurpose])`. Staff triple repeats staff hostname; public triple is publicHost/upstreamSni/upstreamHost. Exclude content digest/counters/transport/time. Local equality additionally checks installation revision, local key generation/SPKI, CSR PEM digest, submit UUID/exact body/predecessor, epoch and stop/reconnect generations. Higher grant/equal C, lease or signing-trust rotation preserves all CSR work; staff identity/policy/key/installation/epoch/authority-scope changes invalidate appropriately. Public-only identity changes preserve staff intent. Stops/expiry/authority loss prevent late install/reload under short apply lock. Staff wire remains submit/status only, `revision` means installation configuration revision; no failed state or historical ID ledger. Exact authorized CN/DNS SAN, valid CSR signature and RSA ≥2,048 bits. CSR/body ≤4,096 JS code units; chain ≤16,384 bytes, not full JSON. Ready eligibility remains last min(30 days,lifetime/3). G3 client response/deadline/poll/renewal/key-rotation policy still missing, public never borrows staff purpose. |
| Ack/status/replay: A §§2/7; H Stage, retry | T2/T5 retain eight complete request results, eight complete report results, one pending report; H independently retains eight complete helper replay results and three fixed caller-role permanent sequence floors. Cache eviction never deletes a floor. Bind request to action/UUID/exact Q digest; same retained bytes recover R, changed identity/bytes conflict, evicted old sequences stale. Report exact bytes/digest saved before send; Cloud records before recorded reply. Lost reply retries same Report/Q/UUID/sequence or fresh signed status. At/below evicted report floor status is unknown, never absent; absent only above floor with no matching pending/committed record under lock. Unknown stays unresolved and cannot cause another apply/report identity. Received/applying never claims applied; inspection/read-back required. Retain verified ack before clearing pending. No network/helper wait under control/apply locks. |
| Latest fetch: A §2 | T2/T5 keep one durable latest-fetch slot independently of eight request results: exact UUID/sequence/request digest, binding/epoch, issuance floors/result. First authenticated epoch fetch has null predecessor; later fetch names exact `[operationId,requestSequence,requestDigest]`. Higher-sequence fetch may atomically supersede only that latest fetch, saving strictly higher grant and all floors before reply. Preserve expired predecessor slot until replacement; no guessed null after loss. Save supersession before send, accept only current correlation; delayed predecessor cannot apply or extend deadline. Cannot supersede report/Permit work. |
| High-water recovery: A §§3/8 | T2/T5 keep root establishment anchor separate from journal/registration. Explicit one-use Permit ≤300,000 ms, exact kind/nonce/UUID/sequence/binding/epoch/generation/S/W/floors. Cloud authenticates machine plus independent AP permission, merges known authenticated maxima, consumes durably before result. Recover uses higher ordinal and named new epoch only, retains grant/counter/local-generation floors and stops, requires higher content revision for changed recovered B. Equal revision/different digest or equal ordinal/different epoch conflicts. Union every authenticated surviving complete trust history with minimum firstSeen, maximum lastSeen/through revision and most restrictive state revoked > retired > active; purpose conflicts refuse. Bind resulting digest in F; current Trust/recovery signature cannot recreate lost tombstones. Missing higher history or total evidence loss remains recovery_required, never re-register/zero/bootstrap. Sections 4–6 map actual consumers, all-store commit and reboot. |
| Helper schema/framing/caller: H Process boundary, Framed IPC, Local records, Response; X §§3–5 | T3 uses H's five exact ops prepare-peer/scoped-rules/inspect/activate/remove and unchanged B/Intent/Evidence/Path/slot/custody-plan/ack/request/response fields, enums and codes. One Unix SOCK_STREAM U32BE(N)+UTF-8 frame/request, mandatory write EOF before effects, one response then close, no ancillary/FD passing/compression/multiplexing/extra bytes. Inspect sequence zero, no replay write. App cannot activate; verifier only. X's restricted native caller/lifetime, service/cgroup/namespace/executable and endpoint/mount checks refine authentication without new H fields. Kernel connector lifetime evidence, no fork/exec/FD export/import escape, manager-owned listener and invocation custody await G7, not UID/PID equality. |
| Ownership/host: H Process boundary, Fixed resource, Generation; X §§2–5/7/8 | Keep app UID 991, verifier 992, staff 993/public 994, helper root:9512 sole CAP_NET_ADMIN, groups 9510/9512; socket root:9510 0660, parent 0750; helper private 0700/files 0600; verifier 992:9512 directory 0750/records 0640. Exact H paths/mount split, host network, separate PID/mount, read-only image/private tmp, no user remapping, app cannot write/replace socket/state. No DB/archive/machine/TLS secrets/runtime socket/host root in helper. Supervisor root-private stores and native roles X §§3/5, no app stop dependency. Random 128-bit ownership nonce before resources; explicit generation 1, later exactly +1 with predecessor full removal digest and fresh absence. Reserved names never prove ownership; collision refuses without touching foreign state. X host profile remains proposed Linux x86_64 Ubuntu 24.04/systemd PID 1/cgroup v2/Docker/AppArmor/WireGuard/nft; actual versions/builds/pins unpopulated. G7 must reconcile current app UID 10001/cap_net_bind_service and clock-service consumers identified by X §2. |
| Exact network allowance: H Fixed resource, Complete network; A §4 | T3 preserves wg-a9510, inet wt_a951_v1/wt_a951_guard_v1, table 51851, priority 31851, protocol 242, MTU 1280, hook priority -150. Outer exact H4 UDP 51821 ↔ pinned E4 UDP 51820, no roaming. Sole gateway G4 source TCP 1024–65535 to box B4 staff 9443/public 9444/probe 9445; only tracked exact reverse tuples with live scope. Peer source G4/32, destination B4/32; only B4→G4 policy/gateway host route. No default/LAN/cross-venue/multicast/peer/box-initiated/NAT/global-forwarding allowance; raw printing/drawer/payment/SSH/admin excluded. IPv4 canonical no leading zeroes, exact /32; refuse IPv6/mapped/fallback/alternative families, inner fragments/ICMP/unlisted protocols. Both-family physical remote-port guards; listeners only B4, no wildcard/LAN/WAN. Enumerate both-family binds/addresses/routes before guards, enforce concurrent exclusion/detection. Every packet both directions including established passes both independent guards. G7 must inventory X's BPF program/maps/hooks individually within H's 16-object closed resource inventory using accepted firewall registry mappings; GUARD16 remains missing, no hidden objects or schema widening. |
| Wall/boot/deadlines: A §§3/6; H Time, Generation; X §§6–7 | T1/T2/T3/T5 use grant ≤600,000 ms; trusted uncertainty ≤30,000 ms subtracted, no grace. At first receipt save boot deadline=m+max(0,expires−wall−30,000), immutable for same authority; replay/re-observation never lengthens. Convert Trust/key/certificate expiry similarly. Key checks wall−30,000 ≥notBefore and wall+30,000<notAfter. Issued may be ≤wall+30,000, expires strictly >wall+30,000. Boot clock includes suspend; unknown trust refuses, forward jumps shorten, backward divergence >1,000 ms closes ≤1,000 ms. Observations age strictly <5,000 ms, observed boot time 0..now; poll ≤1,000 ms; independent helper/supervisor checks ≤100 ms. Supervisor observes plan ≤100 ms, exact-plan armed ack ≤500 ms. Effective per-scope deadline is minimum grant/trust/key/authority/path/certificate/custody/stop/withdrawal; kernel permission ends ≥1,000 ms earlier; no positive reserve means refuse. Closure ≤1,000 ms from complete authenticated stop/withdrawal accepted by helper/supervisor, including listener/accepted sockets, independent of ordinary queue/disk/app progress. X's planned pre-sleep closure/veto and unplanned suspend packet/listener measurements remain G7; a late kill is not elapsed-bound proof. Intact reboot is section 7, damaged state recovery separate. |
| Request/response/decode/rate caps: A §6; H Framed IPC/Response; C/D132 | T1/T3/T5 preserve machine outer ≤16,384 UTF-8 bytes; payload ≤12,000 base64url characters; lease/body each ≤4,096 JS code units AND appliance body ≤4,096 UTF-8 bytes. Complete escaped envelope must fit. Appliance response ≤32,768 bytes, decoded payload ≤16,384, C/Trust payload each ≤4,096, grant payload ≤2,048. Depth 12, 256 total members, arrays 16 except fixed payload arrays/local history 256, ordinary strings 1,024 bytes. H payload request 1..16,384/response 1..8,192; depth 6, 64 total members, arrays 16, strings 1,024 subject to narrower H/I/D fields; resource IDs ≤128 ASCII bytes and objects ≤16. One candidate/peer/interface; shared journal 256 KiB, each safety 64 KiB, no unbounded sidecar. Two ordinary slots+one reserved removal, one serialized effect turn, 10 ordinary requests/sec/caller burst 10, removal bypass. Appliance server 60/IP/min and 30 authenticated installation/min shared with existing machine consumers; local appliance 10/min burst 2, one in flight. Exhaustion refuses before growth, never truncates safety/live evidence. Sections 4–5 size the mapping. |
| Refresh/retry/deadlines: A §§2/6; H Framed IPC; C/D132 | T5 connect/TLS ≤5,000 ms, full response ≤10,000 ms from attempt start, server request-read ≤5,000 ms; no progress extension/automatic POST retry. Healthy 60,000 ms+uniform 0..10,000 jitter constrained by earliest deadline. Retry base min(60000,5000*2^min(attempt,4)), attempt 0 then saturation 16; uniform integer 0..1,000 ms. Integer Retry-After 5..60 seconds only, max(backoff,hint), total≤61,000 ms; invalid hints ignored. Never schedule past safety expiry. 400/401/403/408/409/413/415/429/503 retain actual cause; 401 allows one lease reconciliation, no size/revision workaround. H complete frame≤1,000 ms from accept, effect/read-back≤2,000, response write≤500; safety bypasses effect queue. G3 staff polling/renewal is separate and still unagreed. |
| Removal/read-backs: H Stage/retry/Response; X §§5–7/9 | T2/T3/T5 close independent guard first, persist targeted stops without delaying emergency closure, then clean only confirmed owned resources; both includes probe and peer/routing. Network enumeration covers interface/peer/addresses/routes/policy rules/timed permissions/firewalls/complete guard inventory; observed_blocked differs from verified_removed/unknown; may_have_applied is operation uncertainty. Per-scope listeners ready_verified/closed_verified/pending/unknown remain separate. Command success, lost reply/IPC close/PID exit/cgroup emptiness proves neither combined result. X broker registers before handoff, scope-lock accept/close race, retained shutdown handles, worker no replacement/export, complete cgroup/lifetime retirement, manager watchdog/failure domain need actual G7 proof. Temp closure cannot clear latched stop; scoped certificate failure affects own path, transport failure all three. `.local`/LAN/default routing stay independent. |

## 3. Closure records and helper decisions

The verifier alone derives A §8's exact closure record after authenticating its
source. Keep ordered fields `scope,stopGeneration,withdrawalGeneration,kind,cause,sourceRef`;
scopes staff/public-upstream/probe; kind latched/temporary/unknown; cause
disconnect/revoked/expired/fault/withdrawn. Store three records in that order in
every safety copy. `sourceRef` is D or null exactly as A; unknown has no authority
to reopen. Root ownership and exact-byte digests prevent unprivileged substitution
only. They supply neither Cloud authentication nor privileged-tamper/rollback proof.

| Observation | Classification and affected scopes | Required future transition |
| --- | --- | --- |
| Authenticated local disconnect | latched/disconnect for requested scopes | Only exact AP-reconnect Permit/result may clear targeted latches; ordinary renew/recover cannot. |
| Installation/machine revocation | latched/revoked, all scopes; identity retired | No v1 reconnect or automatic registration; requires separately accepted replacement agreement. |
| Grant/trust expiry or trust-key retirement/revocation | temporary/expired or temporary/revoked; transport signing dependency affects all; purpose-only credential affects own path | Never reuse retired/revoked key. A higher grant under independently accepted active trust plus all fresh checks may revalidate only temporary scopes. |
| Certificate expiry/revocation or failed path/custody | temporary/expired, temporary/revoked or temporary/fault; own path | G3/G4-specific valid new identity and current custody/authority required; no staff/public cross-use. |
| Actual G2 withdrawal/stale authority | temporary/withdrawn or temporary/fault, scopes dependent on that target | Fresh G2 current result at/above its withdrawal floor, same accepted scope, required independently of new grant. Missing G2 adapter stays closed. |
| Damage, missing classification, failed persistence or conflicting evidence | unknown/fault plus recovery hold; conservatively every uncertain scope | Retain every surviving latch/floor; authenticated HIGH WATER recovery, never automatic temporary clear. |

A temporary event cannot overwrite a latched/unknown classification. Keep the
strongest existing classification and all floors; revocation retirement remains
permanent. `sourceRef` names retained decision bytes, not an invented external
approval. A shared event closes all three scopes; staff/public events stay scoped.
Probe is transport-scoped and fixture-only.

Do not collapse transport and purpose readiness into one temporary flag. For each
scope, sourceRef names a compact private `ClosureSources` record with exactly
ordered `version:1,scope,transportTrust:D|null,transportGrant:D|null,authority:D|null,pathIdentity:D|null,custody:D|null,localStop:D|null,uncertainty:D|null`.
Each populated reference names the independently authenticated blocking decision;
its bytes and retained proof are charged to the shared journal. Shared transport
refs can appear in all three records, while staff/public identity and custody refs
remain distinct. A later transport grant can replace only its transport blocker;
it cannot remove a staff certificate refusal, G2 withdrawal or localStop. Clear a
source only after its own current authenticated successor and floor checks; clear
a temporary classification only when every blocker for that scope is resolved.
Retain the localStop until exact reconnect consumption, even while a newer fault
arrives. These are bounded current blocker slots, not an unbounded event history
or an added helper schema. Historical cause bytes survive while referenced by a
current decision, unresolved transition or retained replay result.

H `remove` still takes one stopGeneration strictly above every targeted floor.
Choose `1+max(targeted S)` for the proposed removal, raising only targeted elements
to that value; refuse exhaustion. Record monotone W for the learned withdrawal,
with its source mapping, separately from S. If H's local W advances to fence the
new closure, take each targeted `max(previous local W+1, authenticated source W)`;
retain the source's own floor separately in its referenced decision. Never rename
an A947 source counter into local W. Equal-sequence replay uses H's exact result,
not another increment. `both` advances all atomically within each store. Helper
reason maps disconnect→disconnect, withdrawn/revoked→withdrawn, expired→expired,
fault/unknown→fault. Rich kind/cause stays in private safety, no new H field.

Before clearing temporary closure the helper checks its read-only verifier record
and all-store committed safety decision, exact current B/epoch/generation/Intent,
complete history/trust, S/W, higher immutable grant, accepted G2/path readiness,
trusted time/current boot, ownership and exact new supervisor plan/ack. No targeted
latched/unknown record or hold may exist in any store. The verifier and supervisor
check independently; helper never trusts a `current` string by spelling. Clearing
means removing that temporary reason under a committed decision; it does not lower
S/W or erase retained cause evidence. A new H Path carries current S/W. Non-targeted
scopes keep their own decisions. Closing an independent guard can conservatively
close more scopes during reconciliation; it never grants an omitted scope.

Reconnect consumes only A §8's exact Permit and recovery-purpose signed result.
Recheck local actor/Cloud owner permission, nonce, unexpired ≤300,000 ms Permit,
unchanged nonrevoked binding/epoch/helper generation, expected S/W and all surviving
maxima. For targeted elements next S=expected S+1; others equal, W never lowered.
Persist result and one-use consumption through section 5 before clearing latches.
A larger stop value alone remains stopped. Any later stop/withdrawal invalidates
that decision; no old permit, higher epoch or late helper success can undo it.

## 4. Complete trust history and each 64 KiB safety record

Keep A §3's complete canonical history, not a lossy summary. Its ordered object
is `version,originId,environment,rootKeyId,throughTrustRevision,entries`; version1,
I originId, test/production environment, D root, U through revision. Each sorted
entry remains exactly `[keyId:D,spkiDigest:D,purpose,firstSeenRevision:U,lastSeenRevision:U,state]`,
with immutable purpose response/grant/recovery and active/retired/revoked state.
For this encoding spkiDigest equals keyId. Retain both fields; neither omitted
keys nor cache eviction frees a lifetime slot. Maximum 256 entries is a lifetime
limit, not a sliding window. Verify root-signed bundles before constructing any
transition; independently retain complete copies in app, helper, verifier and
supervisor safety. Root/verifier protection is a local trusted-process assumption,
not a Cloud signature on this history or protection from malicious host root.

This proposal chooses one closed compact safety representation for all four stores.
It uses A's J rules, fields in the order below, no whitespace/LF/extensions/padding.
All D references resolve only in fixed private registries. No caller-chosen path
or extra H request/response member is added.

| Record | Exact ordered fields and types |
| --- | --- |
| Safety envelope | `version:1,store:"application"\|"helper"\|"verifier"\|"supervisor",transaction:Transaction,state:State` |
| Transaction | `version:1,id:H,sequence:U,phase:"prepared"\|"committed",previousStates:[D,D,D,D],nextStateDigest:D,decisionRef:D`; previous states in application/helper/verifier/supervisor order |
| State | `binding:B,floors:F,closures:[Closure,Closure,Closure],history:History,local:Local`; B/F/Closure/History exact A definitions above |
| Local | `generation:U,previousGeneration:U\|null,previousRemoval:D\|null,ownerNonce:H,boot:H,callerFloors:[N,N,N],observationSequence:N,custodySequence:N,grantRef:D\|null,grantExpiresMs:T,grantDeadlineBootMs:T,trustRef:D,rootPolicyRef:D,peerRegistryRef:D,approvalRef:D\|null,permitRef:D\|null,resultRef:D\|null,recoveryHold:boolean` |

Define `Shared(State)` as the exact ordered State above with only
`Local.callerFloors`, `Local.observationSequence` and `Local.custodySequence`
omitted. These three fields are role-local progress, retained in each complete
safety envelope; every other field participates in the shared admission decision.
`nextStateDigest=SHA256(J(Shared(State)))`. F.trustHistoryDigest still hashes
J(History) unchanged. There is no self-hash. A role's committed shared head is
`SHA256(J(["cloud-a951-shared-head-v1",store,transaction.id,transaction.sequence,transaction.nextStateDigest]))`.
`previousStates` names those four prior committed shared heads, in the declared
order, not current full-envelope hashes. Explicit baseline heads come from REG.
Transaction sequence remains distinct from every appliance/helper/source counter.

The helper alone advances its authenticated caller floors and saves exact pending
operation bytes under H's existing replay rules before effects. Verifier and
supervisor likewise own their observation/custody progress. Such a write preserves
Shared(State) and the committed Transaction exactly, merges rather than overwrites
newer role-local progress, and therefore preserves the shared head. It cannot
change grant/time, identity, generation, history, S/W, closures or recovery hold.
A stop or any such shared change invalidates admission and needs a new shared
transaction; classify by changed fields, not by who wrote them. Never pre-consume
an H sequence in a shared prepare: its first real H request must still be accepted,
then exact retries use the saved pending/result identity, never another effect.
CallerFloors order is H application/verifier/supervisor; eviction changes no floor.
Immutable journal records retain exact signed envelopes, original deadlines and
pending/result/proof bytes. A safety digest replaces none of that evidence.

Worst-case compact sizes use all safe integers at 9007199254740991 (16 digits),
all I at 64, H at 32, D at 64, UUID at 36 ASCII bytes, longest enum/null spelling,
all nullable digest/predecessor fields populated, and production environment.
A history entry is **190 bytes** including its brackets, commas and quotes.
256 entries plus 255 commas total 48,895 bytes. History envelope (keys, braces,
array brackets, maximum origin/root/revision/environment) adds 250, giving
**49,145 bytes**. Entries use distinct sorted real IDs; equal-length repetitions
used for size arithmetic do not authorize duplicate IDs.

The following conservative byte ceilings include every field, punctuation and
array delimiter; they leave space within the existing cap, not another store.

| Part | Maximum encoded bytes reserved |
| --- | ---: |
| Complete History, including all 256 entries and envelope | 49,145 |
| B, with all its identity and epoch fields | 1,024 |
| F, including all three counters, request/report/trust/epoch, S/W and digests | 1,024 |
| Three complete closure records | 1,024 |
| Local, including caller floors, owner, deadlines, proof refs and hold | 2,048 |
| Transaction with four predecessor digests and commit metadata | 1,024 |
| Remaining State/Safety keys, delimiters, version and store enum | 512 |
| Total conservative maximum | **55,801** |
| Existing per-record cap / unused space | **65,536 / 9,735** |

These ceilings exceed the field-wise maximum spellings: B 667, F 542, closures 644, Local 1,043,
Transaction 554 and remaining envelope 113 bytes, for a complete maximum-width
spelling of 52,708 bytes. These are sizing bounds, not a valid signed fixture.
Section 8 requires the future serializer to check that arithmetic and real
complete envelopes. No cap
amendment is proposed. Preflight the entire next encoded envelope against 65,536
bytes before Trust adoption, key introduction, stop transition or Permit work.
The 257th lifetime key refuses without dropping a tombstone; duplicate/purpose
conflict refuses even with free bytes. A representation that cannot meet this
bound must return a named successor/bound amendment for bilateral acceptance
before growth. Do not move history to an unbounded sidecar or borrow journal
space to weaken a safety cap. Every independently retained safety file, including
staged safety writes, fits its own 64 KiB limit; its predecessor is retained until
replacement sync completes. Journal/temp metadata is separately charged below.

History reconciliation takes the union of authenticated surviving complete
histories from all stores, with A §3's restrictive merge. A known higher revision
without complete history/verified transition blocks recovery. Same revision with
different history/digest blocks; do not select by arrival or file mtime. A newer
root bundle authenticates its own contents only, not omitted past identities.
The recovery result must bind the locally verified union digest in F; it cannot
supply history. A checksum detects different bytes, not whether those bytes are
fresh or authenticated. All-local-evidence loss therefore remains closed.

## 5. All-store commit, shared journal and crash rules

One proposed coordinator in T2/T5 serializes normal state decisions. Each store
independently enforces monotone floors/stops and verifies the decision before
saving. The app cannot write helper/verifier/supervisor safety; the verifier cannot
forge supervisor receipts. Authoritative closure/history copies require root-owned
backing stores and pinned read-only consumer views; H's UID 992-owned immutable
Intent/Evidence registry is not that root-owned safety boundary. Keep its existing
path/owner/modes unchanged. This proposal assigns protected per-role safety
persistence to T2/POL, using root-private backing directories with 0700 directories
and 0600 files, separate sync receipts and least-access role-specific write seats.
The app's ordinary journal/mirror cannot clear a protected latch. The actual
root-authorized persistence consumer, fixed backing-mount layout and launch
permission checks remain missing POL/G7 inputs; do not claim them from a checksum
or the existing registry. No new H protocol fields carry this state.
X §5's handle-relative no-follow/mount/mode checks,
file sync, rename and parent-directory sync apply to every store. H's verifier
records and all inherited helper fields remain unchanged. No multi-file rename
is treated as an atomic cross-store transaction.

**PP, protected participants (unbuilt prerequisite for T2/T3/T5):** the native
supervisor coordinates; each application/helper/verifier/supervisor participant
owns its own file writes and compare-and-swap. The verifier validates the external
G1/G2 decisions; helper and supervisor independently check their protected views
as H requires. The coordinator cannot use an app assertion or its own checksum
as external approval. App participation acknowledges its store only and grants
no helper activation seat. No role writes another role's safety directory.

Use a separate, supervisor-created private launch channel per registered role,
bound to X's boot, invocation, pinned executable closure and lifetime handles. It is not
H's socket, app-supplied IPC, a new H operation or an exposed network endpoint.
Its fixed request payload is the ordered array
`["cloud-a951-participant-v1",action,node,generation,id,sequence,previousSharedHead,nextStateDigest,decisionRef]`:
action is prepare/commit/abort/status, node/id H, generation/sequence U, and the
three references D. Response is exactly
`["cloud-a951-participant-result-v1",action,id,sequence,state,sharedHead,envelopeRef]`:
state prepared/committed/refused/uncertain, sharedHead/envelopeRef D or null.
Use H's U32BE framing, one request/EOF/response/close, no ancillary data, payload
1..1,024 bytes each direction and H's unchanged 1,000/2,000/500 ms request/effect/
response deadlines. These internal caps are narrower than H's existing bounds.
The coordinator alone sends state requests; participants resolve decisionRef in
fixed protected registries, verify exact source proofs and ownership, and refuse
any missing or unaccepted dependency. No message carries raw state, arbitrary
path, caller sequence reservation or permission to bypass H. Root-provisioned
handle/mount access and isolated participant code require E/G acceptance and X's
G7 proof before native use; no such channel exists in the inspected consumers.

Keep prepared envelopes separate from the still-retained committed record; a
prepared phase is never the current committed shared head. Its eventual commit
rechecks that predecessor and merges progress saved since preparation.
Prepare/commit compare the current committed shared head to previousSharedHead,
retain the exact pending transaction identity, and merge the latest role-local
progress under that participant's short lock. Commit must match the prepared
id/sequence/digests; abort preserves every already durable floor/latch and cannot
undo a committed head. Exact phase retries return saved receipts; changed bytes
at the same identity conflict/refuse, unknown completion stays uncertain. Prepare,
commit and their receipts consume the shared journal budget. No control/apply or
participant lock is held while awaiting another role, H call or network result.
The supervisor's final admission check compares all current committed shared
heads and the exact transaction under the stop/open interlock; a priority stop
invalidates that decision before any later open, regardless of progress writes.

Charge **one aggregate 262,144-byte journal budget** across application, helper,
verifier and supervisor. Count exact retained encoded bytes, framing/index keys,
transaction decisions/markers, old/new journal copies and temporary writes at peak,
all request/report/helper replay results and pending Q/Report, latest-fetch slot,
Trust/current signed evidence, intent/slot/plan/ack, supervisor receipts, full live
handle metadata (even in RAM), loaded-guard inventory, and unfinished retirement
records. No separate allowance per role and no socket observations in safety.
History stays complete in separately capped safety copies. Safety temporary-file
bookkeeping is journal usage; each complete safety copy is separately bounded.

Choose an engineering **16,384-byte reserve inside 262,144** for priority stop,
transaction-abort and retirement bookkeeping; ordinary occupancy including its
peak staged writes cannot exceed 245,760. Before accepting a socket, handoff,
request, renewal or state transition, reserve its full worst-case encoded growth,
including all references and completion/cleanup space. Pin exact entry encodings
and their reservations in the future implementation before accepting traffic.
Eight cached results is a count ceiling, not a promise eight maximally sized
responses plus all other maxima fit together. Refuse new ordinary work before
overflow; never truncate a result, evict live evidence, discard unfinished
retirement or reset a floor. Only unreferenced completed receipts/verified closed
socket entries may retire. Preserve every receipt referenced by current intent,
plan/ack, live registry, unresolved operation or retained replay result (X §5).
Exhausted reserve or failed storage closes immediately and leaves recovery held;
no durable-stop success is reported. G7 must qualify full-budget closure, not
assume disk writes finish within the emergency deadline.

Before first establishment, provision the four explicit closed baseline records
and their heads through REG/POL and the authenticated anchor. History uses the
first verified root bundle; its complete digest/floor is explicit. Never infer a
predecessor head, initial generation or initial floor from an absent file.

1. **Close and prepare.** For any cross-store transition, keep affected independent
   guards closed. Under a short control/apply lock read all four committed heads,
   verified histories and current source floors, calculate union/maxima and a
   deterministic next State. Equal content revision/different digest, equal epoch
   ordinal/different ID, history conflict or unknown ownership refuses. Recheck
   permit/actor/Cloud authority where relevant. Reserve shared peak space, then
   save exact immutable decision bytes and Transaction (version/id/sequence,
   four previous digests, next digest and decisionRef) before releasing the lock.
   Decision records name accepted artifact/source pins, exact signed proof refs,
   intended scopes, Permit consumption and fresh observation correlations.
2. **Prepare all stores.** Each independently verifies decision bytes, accepted
   signatures/local producer lifetime, bindings, history, previous heads and all
   monotone constraints. Save prepared envelope in fixed order supervisor,
   verifier, helper, application, with file/rename/directory-sync receipts. Stops
   close guard/sockets before any disk wait. Prepared state grants no permission
   and cannot clear an old committed latch. Any failure or changed head aborts
   ordinary work closed; never roll a surviving floor back to the old journal.
3. **Commit all stores.** Recheck four heads, latches, current permissions and
   expiry against the captured decision, then release the control/apply lock
   before participant calls. For reconnect require exact consumed Cloud Permit
   result and locally authorized one-use decision; prepare alone does not consume
   the local decision. Save committed envelopes in the same fixed order. Read
   back all four exact next digests/transaction IDs and durable receipts; then
   save completion as id/sequence/nextStateDigest plus four ordered
   `[sharedHead,commitEnvelopeRef]` pairs. Retain those immutable commit receipts
   even as role-local progress advances. Before admission, each current copy must
   retain that exact shared head/Transaction, monotone role-local floors and valid
   pending/result identity; full current envelope hashes need not stay equal to
   the commit-time hashes. All proofs and shared decisions must agree. Collect
   participant responses outside the control/apply lock; each participant uses
   only its own short lock for compare-and-swap and persistence. Missing approval/freshness
   at final commit refuses and needs fresh authorization, not an expired retry.
4. **Journal, effects and report.** Save full candidate/grant and applying phase
   after safety commit, before helper calls. Before each effect, recheck all-store
   completion, generation/S/W/trust/hold and fresh G2/time/path/custody. Prepare
   H's exact Intent/Evidence and plan/ack. H persists the real incoming caller
   floor/pending operation before its effect, with no pre-consumption by PP; the
   unchanged shared head plus current local replay checks authorize that effect.
   Observation/custody progress likewise changes no shared permission. The
   supervisor independently arms only
   the current exact plan. After effects re-read floors/ack and actual owned
   network/listener state, persist applied/uncertain observation, then exact
   Report/digest/Q, then send. Save authenticated recorded ack before clearing
   pending. Cloud separately saves issuance/request/Permit/report floors before
   replying; its storage cannot substitute for a local receipt.
5. **Restart or race.** Start closed and invalidate old handles/acks. Read every
   safety/journal/staged decision and independent Cloud ledger evidence. A partially
   committed decision stays closed; never infer completion from one store or a
   journal's applied flag. Monotone additions may reconcile to union/maxima through
   a new complete transaction. Reconnect latch-clear is usable only with all four
   matching committed states/completion and exact authorized consumption; uncertain
   consumption, expired approval before commit, missing history or conflicting
   higher head requires authenticated recovery/new authorization. Never replay
   effects blindly or allocate a generation/epoch to escape uncertainty.

A concurrent stop closes the independent guard immediately, invalidates the
current decision and writes a higher scoped S/W/closure through the priority
path. It wins over a prepared/committing reconnect, grant or late effect. If any
store has that newer stop, union it into a new transaction and keep all affected
scopes closed; an old completion cannot authorize the changed shared head. The final
open recheck and broker scope lock serialize against that stop. Unknown/failed
write remains a recovery hold with no durable success; manager must prevent
automatic restart/reopen after that failure. G7 must prove the durable failure
handling and restart interlock. If evidence cannot establish that no stop was
lost, intact revalidation is unavailable. Malicious privileged rollback remains
outside X's trust boundary, not a property supplied by this journal scheme.

## 6. Actual consumers and named missing dependencies

The following source checks establish limits, not a working approval protocol:

- At W, `apps/server/src/cloud-api.ts`, `mountCloudApi` uses
  `requireManagementSession` and `authorizeManager(permission:"system.manage")`,
  exact management Origin on POST and permission rechecks; its start/check/
  complete/refresh/revoke and replacement actions supply no A951 Permit consumer.
  Its `isPrimary` check is not G2 current authority. `cloud-installation.ts`
  `Action` contains renew/configuration/report/revoke; `cloud-client.ts` serializes
  installation operations. These do not consume establish/recover/reconnect.
- At C, `packages/registration/src/installation-proof.ts`, `MachineAction` and
  `readMachineClaims` have no appliance action. `packages/account-http/src/installations.ts`
  `installationResponse` routes renew/configuration/report/revoke, authenticates
  machine requests and checks browser session/CSRF separately.
  `packages/registration/src/installations.ts`, `revokeWithSession`, checks current
  session and organisation `is_owner` membership joined to the exact installation's
  venue. That is a revoke consumer, not an A951 establish/recover/reconnect approval.

Every missing row below uses the full inspected pair **W=
`bfb185b60bfe241b713fde536ddf87cbf4bb1ffc`, C=
`b522fa943a15badafbb4e88e9e7c637f2bd58d51`**. Actual resulting executable
consumer pins are **NONE** until E/G publish them. Paths/functions are proposed
responsibilities from P, not manufactured shipped consumers.

| Dependency | Exact required consumer, permission and race checks |
| --- | --- |
| AP-establish (E/G; T1/T2/T5) | Missing local A951 decision producer/consumer beside W cloud-api/cloud-client and Cloud approval/Permit ledger beside C installation handlers/store. Require current management session plus system.manage for exact local venue/node and explicit first-establishment decision, independently current Cloud owner permission for exact venue/installation, authenticated non-browser machine correlation and trusted approval channel. Cloud ledger must prove never previously established. Provision explicit root-owned anchor A §8 before request; active registration or missing files is insufficient. |
| AP-recover (E/G; T1/T2/T5) | Missing same two seats for explicit damaged-state recovery, separate from establishment/reboot. Recheck same live local permission and Cloud owner permission, original machine/endpoint identity, all surviving maxima/history and recovery hold. Cloud consumes exact one-use recovery Permit before signing result; local stores consume after verification. Total-evidence loss cannot be authorized into invented maxima. |
| AP-reconnect (E/G; T1/T2/T5) | Missing same two seats for deliberate reconnect after local stop. Recheck live local system.manage and current Cloud venue/installation owner permission, nonrevoked machine, exact expected S/W/epoch/generation and nonce under commit lock; target next S exactly +1. Late stop/withdrawal/revoked permission invalidates consumption; no automatic refresh or supplied localApprovalRef qualifies. |
| AP-channel/ledger (E/G; T1/T2/T5) | Missing authenticated decision transport and durable one-use storage at both ends, using A §8's exact anchor/Permit/Q/result without new wire fields. Bind actor/permission decision to kind, B, expected/result epoch, nonce, UUID/request sequence, expected generation, floors/S/W, expiry≤300,000 ms and artifact pins. Store exact bytes/digest, permission/revocation snapshot and consumed result; recheck permission and race at use, deny wrong actor/venue/purpose/replay. A digest reference resolves authenticated producer evidence; it is not authorization by itself. Exact channel/issuer implementation and role lifetime checks need E/G agreement before adapter work; this mapping adds no UI/endpoint. |
| REG (E/G; T1/T2/T5) | Missing authenticated registration→local venue/node/endpoint mapping and root-owned establishment anchor provisioning. Existing registration/machine identity is input only. Verify UUID↔H conversion and SPKI digest against actual local identity and Cloud permission; reject any wrong binding/environment/root. No location concept. |
| POL/PEER/KEY (E/G with release engineering; T1/T2/T3/T5) | Missing authenticated origin/root policy and peer-registry provision/update consumers, least-access verifier proof seat, protected per-role root-owned safety persistence/mount consumer from section 5, and purpose-specific response/grant/recovery issuer custody. Root provisioning authenticates local installer and Cloud origin/environment, preserves existing floors/history on replacement, and cannot occur via ordinary reply. Peer registry binds B/cell/gateway/endpoint/addresses/local WireGuard public identity and public peer key; no Cloud private WireGuard key. Keep offline root, online issuers, machine/lease/TLS/CA keys separate; record public policy digests/signoffs, no unrestricted secret mount. Unknown refs remain closed. |
| G2 (Waitron A947 owner/E, Cloud G; T5) | Actual landed A947 consumer full pin, target/identity-scope relationship, currentness/freshness/withdrawal and source-floor mapping missing from this source set. Record source function and result semantics before use. Role boolean, membership, probe, installation active or supplied authorityBindingRef cannot manufacture it. |
| PP (E/G; T2/T3/T5) | Missing protected coordinator/participant consumers in X's native supervisor/helper/verifier and application store seat. Implement section 5's private fixed protocol, authenticated launch lifetimes, per-store shared-head CAS and separate role-local H replay/progress writes. E/G must accept the protected registry/mount realization before these consumers; G7 proves it. Never route prepare/commit through H or let the app reserve a helper sequence. Current full consumer pins remain NONE. |
| GUARD16/G7 (E/G/host reviewer; T3/T14) | Complete X BPF/nft/program/map/hook inventory and H closed resource-kind mapping within 16 objects, exact builds/profiles/units/mounts/loaded pins, caller/worker confinement, durable failure interlock and measured closure absent. Inventory excess requires explicit accepted successor, not collapsing unknown objects into a success label. X §8 pinset is qualification-unpopulated-2026-11-02.1; no entries accepted. |

These permission requirements are this mapping's proposed engineering choice,
using existing local system.manage and Cloud owner boundaries as the check to
preserve. Their extension to A951 is unbuilt and needs E/G agreement. No new owner
product decision or generic build approval is requested by this edition.

## 7. Intact reboot is authenticated revalidation

This proposed mapping refines H's conservative reboot/recovery wording only after
E/G acceptance against H+X. It does not silently reinterpret an existing recovery
result. On every reboot/restart close first, discard old process/socket/cgroup/
namespace/IPC/ack handles, establish actual new H boot identity, enumerate owned
resources and reconcile all four stores. No cached remaining duration authorizes
anything. Unknown predecessor, duplicated generation or ambiguous ownership stays
closed; no adoption by name or make-before-break.

Intact revalidation is allowed only with complete matching committed safety,
history, journal/proof bytes and no latched/unknown closure or recovery hold in
any targeted scope. Authenticate current Trust under provisioned root and a new
response/fetch with exact latest-fetch predecessor, same B/epoch, fresh nonce/
boot and **higher grant sequence**. Establish trusted wall time, rebind absolute
expiries without extending them, obtain fresh independent G2/path/certificate/
custody observations and new exact plan/ack for current invocations. Persist the
new grant/floors/boot decision in all stores before effects. This is authenticated
Cloud grant/response plus independent local proof, not a root-owned checksum.

Preserve pending Report/CSR/submit/predecessor identities and recorded phases;
a same-content grant cannot restage peer or replace CSR. A latched scope remains
closed pending AP-reconnect even when other independent temporary scopes can
revalidate. If complete intact evidence is unavailable, take A §8 HIGH WATER
recover with its separate AP-recover authorization/history union, new epoch and
closed result. Recovery alone cannot clear a latch or supply missing G2/current
trust. If authenticated maxima/history cannot be established, stay closed with
recovery_required; neither path turns lost state into a first installation.

## 8. Representative design vectors and future qualification (UNRUN)

The exact unchanged oracle corpus is **A §9, “Printable canonical vectors and mutation
oracles,” through its END marker**, plus its “Literal-byte verification at
publication” paragraph, at A's full pin/publication and normative digests in
section 1. Keep B0/C0/Q0/M0, report-status/refused literals, duplicate-key rejection
and every mutation/outcome byte there unchanged. C0 is 1,373 bytes, content-domain
digest `0fcd48fe749ccfcf68b234854476788e9cfb16d573c8c8c3079c5c57672ff4b1`;
Q0 is 664 bytes, request-domain digest
`afdc6c9eea98377b6a3128623e8b1b51120c997e4d2d48bcd46632c203a26f79`.
H's “Response schema and literal vectors,” including inspect prefix
`00 00 00 ab`/171 payload bytes and the positive/rejection frames, remains exact
under H's digest. Neither reference replaces a complete signed exchange.

**Complete signed byte corpus still missing:** fully expanded valid machine
lease/body, response, nested grant, root Trust, Permit/result, Report/status,
test-only purpose-separated keys, signatures and hashes. M0 deliberately has an
invalid empty lease; symbolic substitutions/synthetic verifier outcomes cannot
prove authentication. T1 must consume identical complete corpus bytes at both
future executable pins before interoperability qualification.

The following are bounded proposed assertions, all **UNRUN future work**. Use
A/H's existing fixture IDs/addresses; add no new location. For each negative retain
a valid positive, observe intended failure, implement minimal behavior later,
then remove the named guard in an isolated candidate and require that assertion
to fail; restore and rerun the positive. Retain commands/exit statuses/output
hashes with full consumer pins. No test or host experiment is reported here.

| Future consumer | Positive / negative and observable oracle; guard to remove |
| --- | --- |
| T1/T5 content/grant/CSR | A C0 rev 7, installation 3, grant 11 then grant 12 preserves pending submit UUID ending 0040, exact CSR/body/predecessor/key; no peer restage. Signed changed staff name at same rev 7 refuses content_conflict with zero floor/helper/CSR writes. Remove same-revision digest or projection guard independently. |
| T1/T2 trust/sizing | 256 distinct valid-history entries with maximum-width fields plus complete safety envelope fits≤65,536 in every role. 257th refuses before persistence, old bytes/floors retained. Retired key omitted then reintroduced at higher revision refuses; complete surviving copy permits restrictive union, lost higher history refuses. Remove history completeness/tombstone/cap guards separately. Use current-size signed bundles that actually fit 4,096 bytes; eight entries is a ceiling, not permission to overflow. |
| T2/T3/T5 closure | Staff temporary expiry, fresh higher grant/trust/G2 and exact ack can restore staff; public stays independently closed until G4/G6/G7. Repeat with staff latched/disconnect: remains stopped. Shared transport expiry closes staff/public/probe. Remove classification/floor/scoped guard one at a time; verify stale temp decision cannot clear latch. |
| T2/T5 all-store crash/stop | Complete four-store transaction then inspected apply gives one saved report. Crash at every prepare/commit/file-sync/rename/directory-sync boundary and before/after helper/read-back/report/ack: partial commit stays closed, maxima never lower, unknown never reports applied. Stop S=[4,4,4] racing reconnect expected[3,3,3] invalidates it and preserves4. Remove all-store completion/head/CAS/read-back guards separately; no late CSR/reopen. |
| T2/T3/T5 PP/local progress | After a complete shared transaction, a fresh legitimate H mutation saves its caller floor/pending bytes once without changing the shared head; exact retry returns its original result without another effect. New observations/custody sequences preserve shared authorization. Concurrent shared stop changes the head and blocks the late effect. Wrong participant/lifetime, changed phase bytes or pre-reserved H sequence refuses. Remove shared-projection, per-role floor/CAS, phase-correlation and final shared-head checks separately. |
| T1/T2/T5 approval | Inject explicit matching establish/recover/reconnect local system.manage + Cloud owner decisions with exact Permit/nonce/binding/generation/S/W/expiry. Wrong actor, revoked session/owner, other venue/installation, bare localApprovalRef, consumed/expired Permit or late stop refuses before latch-clear/effect. Remove each permission/correlation/one-use guard. Synthetic approval does not fill AP consumers. |
| T2/T5 replay/fetch | Identical retry recovers same result without apply/time extension; eight-result eviction retains floors. Report status below evicted floor is unknown. Higher fetch with exact latest predecessor supersedes expired unanswered fetch once; delayed old response cannot apply. Wrong predecessor/type conflicts. Remove floor/latest-slot/correlation guards separately. |
| T2/T3/T5 reboot/time | Complete same-epoch intact state with fresh signed higher grant/new boot/G2/custody revalidates; previous-boot evidence or damaged/missing safety refuses. Latched scope needs AP-reconnect. Literal clock:100000+(1590000−1000000−30000)=660000; observation deadline105000 yields kernel end104000. Equality-at-expiry, >1,000 ms backward movement, suspend and trust loss close. Remove boot/history/expiry/hold guards separately. |
| T3/T14 host/journal | Exact H tuples and authorized native caller complete valid fixture operations; wrong UID/service/lifetime/namespace/borrowed FD/extra frame refuses with zero requested effects. Fill aggregate journal with referenced receipts/live metadata/unfinished retirements; next accept/renew refuses before 262,144, priority closure still≤1,000 ms. Remove caller/EOF/ownership/budget guards independently. No physical-host proof from a mock. |
| T3/T14 independent closure | X §9 valid scoped listener/TLS positive plus accept-in-flight/stalled worker/helper/verifier/supervisor and stale ack negatives. Measure independent guard, listening-socket absence, every broker/worker accepted-copy shutdown separately within 1,000 ms. Remove each boundary independently with other one permissive. Network success cannot fill listener unknown; missing valid public prerequisite leaves that path UNVERIFIED. |

E's future focused commands remain P T1/T2/T3/T5 suites and T14 qualification,
not a new general implementation plan. T14 must execute X §§8–9's complete matrix,
including fault combinations, both-family/each-direction/established/resumed
packet checks, whole-host suspension limitation, foreign concurrency, resource
retirement and local service/WAN independence. Pin actual hardware, kernel,
manager/runtime, all native/Node/JS/library/image/profile/unit/mount/guard bytes,
trust-policy/provisioning signoffs and both full executable commits. Retain raw
latency samples, maximum and measurement uncertainty against H, never averages
or skipped-proof success. If whole-host sleep cannot preserve elapsed listener
closure, reject that host profile or return an explicit successor bound for
acceptance. No userspace watchdog promise while PID 1/kernel is stopped.

Qualification also needs A/H envelope-bound arithmetic, request escaped-size
negatives, history maximum and aggregate old/new/temp peak allocation, no live
reference eviction, stop with failed/full storage, immutable deadlines, reload
and scope separation. Any changed contract/host/runtime/build/profile/mount bytes
invalidate affected receipts; repeat changed boundaries and cross-boundary races
before accepting a successor pinset. X's 3 November bench assignment is a
remaining dependency, not evidence of execution.

## 9. Proposed E plan-row and focused task amendment

E records the following only after reviewing this edition and its externally
recorded final publication digest. Preserve every historical P/I body and digest.
Record matching E acceptance and scope through E's driver, then return any
engineering amendment with exact successor bytes. G records disposition and both
real resulting consumer pins before connecting affected adapters. None exist here.

**Proposed G1 row text:**

> G1 appliance/helper mapping: use cloud-a951-g1-host-custody-v1 /
> proposal-2026-11-02.1 and its final Cloud publication digest recorded in the
> dated contract response, against exact H digest
> da433f66a7dcb835e99eeb4a7e5c6f01f2bc9c69db369c44a5131247a4ab008f
> and host digest
> 50001abafc7c3edea270821e0a8570f8c722969d62132070a46d9cd3729956d2.
> Matching E/G acceptance covers this documented engineering mapping only.
> Full appliance acceptance remains NONE pending revised edition, AP/REG/POL/
> PEER/KEY consumers and complete signed corpus. Preserve all D132/H bounds,
> 256 lifetime history, each 64 KiB safety and one shared 256 KiB journal. Actual
> A947 G2, staff G3, independent upstream G4, moves G5, routing/privacy G6 and
> host/device G7 stay path-scoped gates; admission CLOSED, original 83-byte
> production manifest unchanged, .local independent.

**Proposed focused task text:**

- **T1:** Carry section 2's complete matrix and exact A/H schemas/domains/oracles
  into the accepted boundary. Record AP-establish/AP-recover/AP-reconnect,
  AP-channel/ledger, REG/POL/PEER/KEY and G2 as missing until actual full consumer
  pins/functions/permission checks are accepted. Return expanded signed corpus
  and revised full appliance edition before affected integration; do not feed
  appliance actions into existing machine/staff/gateway consumers.
- **T2:** Implement this mapping's closed safety envelope/history arithmetic,
  independent four-store floors/classification, PP participants and shared-head/
  role-local progress separation, restrictive union, one-use
  reconnect and all-store transaction reconciliation. Preserve every inherited
  counter/epoch/generation, complete lifetime tombstones, separate recovery hold,
  archive exclusions at export/import and ordinary local CA recovery. No
  missing-file bootstrap, truncation or history eviction.
- **T3:** Preserve H fields/framing/numerical policy exactly. Map rich closures
  privately, check committed proof before temporary-clear/reconnect, and use X's
  caller/service/broker/manager custody without inventing runtime pins. Resolve
  GUARD16 inventory before verified removal; shared journal includes all live
  supervisor metadata/receipts/retirements and emergency reserve. G7 remains
  required before appliance installation/host claims.
- **T5:** Use exact helper Intent/Evidence/Path, latest-fetch supersession,
  independent permanent request/report/helper floors, save-before-effect/report/
  ack order and short locks. Race stop against every commit/open/CSR selection. Prove an initial legitimate
  H mutation after shared commit advances its caller floor once, preserves shared
  completion, and retries only its saved pending/result; a shared stop must still
  invalidate it. No control lock may await participant responses.
  Implement authenticated intact reboot only with complete matching state and
  fresh signed grant/time/G2/custody; damage takes separately authorized HIGH
  WATER recovery and never clears latches by itself. Connect real G2/AP seats
  only after accepted source/permission/freshness/withdrawal review.
- **T14:** Keep every vector in section 8 and X §9 UNRUN until measured at exact
  executable/host pins. Require valid positive, negative, individual guard-removal
  failure and restored positive, plus full-capacity/crash/suspend/connection
  closure evidence. Sign populated pinset/qualification scope through X §8's
  bilaterally accepted release-approval trust policy, not a new runtime token.

No owner decision is reopened here. These representation, reserve, commit and
permission-extension choices await E/G engineering acceptance. If implementation
cannot fit an inherited bound or qualify the stated host limit, return the exact
required successor/amended bound for bilateral review before changing it.
