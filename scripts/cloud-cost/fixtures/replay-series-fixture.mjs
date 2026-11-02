import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// Bind counter readbacks to the selected node and its exact live allocation.
export function standardNextNumber(db,stateRoot){
 const node=readFileSync(join(stateRoot,'trading.env'),'utf8').match(/^WAITRON_NODE_ID=([^\n]+)\n$/)?.[1];
 assert.ok(node,'the replay must retain one node identity');
 const rows=db.prepare(`SELECT s.next_number AS n FROM invoice_series s
  JOIN registro_sif f ON f.node_id=s.node_id
  WHERE s.node_id=? AND s.purpose='standard' AND s.retired_at IS NULL
   AND f.revocado_en IS NULL AND f.id_sistema_informatico='W1'
   AND s.code='R-' || f.numero_instalacion`).all(node);
 assert.equal(rows.length,1,'select the one allocated, live standard series of this node');
 return rows[0].n;
}
