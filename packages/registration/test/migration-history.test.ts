import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { migrationNames } from '../src/migrate.ts';

test('guest menu language migration appends after 065 without replacing earlier migrations',()=>{
  assert.equal(migrationNames.at(58),'059_account_action_proof.sql');assert.equal(migrationNames.at(59),'060_account_email_changes.sql');assert.equal(migrationNames.at(60),'061_connection_action_proof.sql');assert.equal(migrationNames.at(61),'062_billing_method_action_proof.sql');assert.equal(migrationNames.at(62),'063_recovery_action_proof.sql');assert.equal(migrationNames.at(63),'064_cloud_pairing_v2.sql');assert.equal(migrationNames.at(64),'065_guest_menus.sql');assert.equal(migrationNames.at(65),'066_guest_menu_languages.sql');assert.equal(migrationNames.at(66),'067_cloud_actions.sql');assert.equal(migrationNames.at(67),'068_owner_transfer.sql');assert.equal(migrationNames.at(68),'069_billing_tax_details.sql');assert.equal(migrationNames.at(69),'070_stable_remote_names.sql');assert.equal(migrationNames.at(70),'071_owner_recovery.sql');assert.equal(migrationNames.at(71),'072_remote_name_records.sql');assert.equal(migrationNames.at(72),'073_retire_certificate_expiry_incidents.sql');assert.equal(migrationNames.at(73),'074_remote_certificate_orders.sql');assert.equal(migrationNames.at(74),'075_record_moved_incidents.sql');assert.equal(migrationNames.at(75),'076_pairing_venue_name.sql');assert.equal(migrationNames.at(76),'077_venue_display_name.sql');assert.equal(migrationNames.at(77),'078_installation_portal_removal.sql');assert.equal(migrationNames.at(78),'079_setup_pairing.sql');assert.equal(migrationNames.at(79),'080_early_setup_pairing.sql');assert.equal(migrationNames.at(80),'081_relay_staff_notices.sql');assert.equal(migrationNames.at(81),'082_relay_box_notices.sql');assert.equal(migrationNames.at(82),'083_sent_report_bodies.sql');assert.equal(migrationNames.at(-1),'084_venue_snapshot_recovery.sql');
});

test('retained fiscal registry migration keeps its ledger position and original digest', async () => {
  assert.equal(migrationNames[37], '038_fiscal_allocation_registry.sql');
  const sql = await readFile(new URL('../migrations/038_fiscal_allocation_registry.sql', import.meta.url));
  assert.equal(createHash('sha256').update(sql).digest('hex'),
    '8828e2ca25fbff5bcfd61136b2b2d7501a654e3580225fd2ffac7e191f259fee');
});
