import assert from 'node:assert/strict';
import {test} from 'node:test';
import {operationsMetrics} from '../src/metrics.ts';
import type {OperationsSnapshot} from '../src/status.ts';

test('metrics use fixed low-cardinality labels and expose every actionable count',()=>{
 const snapshot:OperationsSnapshot={version:1,checkedAt:'2026-09-26T21:00:00.000Z',state:'degraded',ready:false,components:{
  controlApi:{state:'ready',code:'ready',live:true,ready:true,elapsedMs:12},
  monitoring:{state:'degraded',code:'checks_due',venues:3,due:1,unknown:2,incidents:4,oldestCheckAt:'2026-09-26T20:00:00.000Z'},
  email:{state:'ready',code:'current',counts:{pending:1,processing:2,sent:3,expired:4,cancelled:5,failed:6},backlogged:0,oldestPendingAt:null},
  backups:{state:'ready',code:'current',counts:{pending:7,running:8,failed:0,completed:9},due:1,oldestDueAt:null},
  remoteConfiguration:{state:'ready',code:'current',enabled:10,due:0,running:2,failed:0,oldestDueAt:null},
  gateways:{state:'degraded',code:'probe_failed',expected:11,healthy:8,failed:1,stale:1,missing:1,oldestCheckAt:null},
  storage:{state:'ready',code:'current',expected:12,healthy:12,pending:0,failed:0,stale:0,missing:0,oldestVerifiedAt:null},
  usage:{state:'ready',code:'current',sources:4,stale:0,unknown:0,oldestCaughtUpAt:null},
 }};
 const text=operationsMetrics(snapshot);
 assert.match(text,/^# HELP waitron_cloud_operations_ready /m);
 assert.match(text,/waitron_cloud_operations_ready 0\n/);
 assert.match(text,/waitron_cloud_operations_component_info\{component="gateways",state="degraded",code="probe_failed"\} 1/);
 assert.match(text,/waitron_cloud_operations_email_messages\{status="failed"\} 6/);
 assert.match(text,/waitron_cloud_operations_backup_jobs\{status="running"\} 8/);
 assert.match(text,/waitron_cloud_operations_gateway_checks\{status="missing"\} 1/);
 assert.match(text,/waitron_cloud_operations_storage_checks\{status="healthy"\} 12/);
 assert.match(text,/waitron_cloud_operations_usage_sources\{status="unknown"\} 0/);
 assert.equal(text.endsWith('\n'),true);
 for(const forbidden of ['2026-09-26','private@example.test','12345678-1234-4234-8234-123456789abc','private-bucket','private-hostname'])assert.equal(text.includes(forbidden),false,forbidden);
});
