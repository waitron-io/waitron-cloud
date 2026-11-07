"""Portable host policy tests with only OS/service providers replaced."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import types
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import host
import session
import operations
import startup

class Guards(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='disposable-host-policy-');self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.control=self.root/'control';self.control.mkdir();self.ops=self.root/'operations'
  self.resource='dt-policy-0-1';self.live=set();self.active=False;self.transferred=False;self.order=[]
  self.request={'resourceId':self.resource,'snapshot':hashlib.sha256(b'opaque source').hexdigest(),'argv':['true'],'deadline':int(time.time()*1000)+60000}
  boot=self.root/'boot-id';boot.write_text('11111111-1111-4111-8111-111111111111')
  values=[(host,'ROOT',self.root),(startup,'BOOT_ID',boot),(session,'CONTROL',self.control),(session,'OPERATIONS',self.ops),
          (host,'run',self.provider_run),(host,'observation',lambda r:{'resourceId':r,'running':False,'absent':True}),
          (host,'table_present',lambda r:False),
          (host,'service_state',lambda r:{'absent':not self.active,'running':self.active}),
          (session,'turn_directory',lambda r:self.control/r),
          (session,'Path',lambda p:types.SimpleNamespace(read_text=lambda:'boot-fixture') if str(p)=='/proc/sys/kernel/random/boot_id' else Path(p))]
  for target,name,value in values:
   old=getattr(target,name);setattr(target,name,value);self.addCleanup(setattr,target,name,old)
  startup.reconcile()
 def provider_run(self,*argv,**kwargs):
  if argv[0]=='systemd-run':self.live.add(next(a[7:] for a in argv if a.startswith('--unit='))+'.timer')
  elif argv[:2]==('systemctl','stop'):
   if argv[2].endswith('-operation.service'):
    self.assertTrue((self.ops/self.resource/'closed').is_file(),'Closed generation must precede stopping live work')
    self.active=False
   else:
    self.live.discard(argv[2])
    if self.transferred and not self.live:(self.root/'lost-protection').touch()
  return subprocess.CompletedProcess(argv,0,stdout='ActiveState=inactive\n' if argv[:2]==('systemctl','show') else '',stderr='')
 def bundle(self):
  stream=io.BytesIO()
  with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as archive:
   for name,data in [('request.json',json.dumps(self.request).encode()),('source.tar',b'opaque source')]:
    entry=tarfile.TarInfo(name);entry.size=len(data);archive.addfile(entry,io.BytesIO(data))
  stream.seek(0);return stream
 def test_closure_precedes_stopping_and_removing_an_owned_operation(self):
  self.active=True;(self.control/self.resource).mkdir()
  def destroy(resource):
   self.assertFalse(self.active,'Host deletion raced a live operation')
   self.assertTrue((self.ops/resource/'closed').is_file());return {'resourceId':resource,'absent':True}
  with patch.object(host,'destroy',destroy):self.assertTrue(session.destroy(self.resource)['absent'])
  self.assertTrue((self.ops/self.resource/'closed').is_file())
  self.assertFalse((self.control/self.resource).exists())
 def test_closed_generation_worker_never_enters_its_stage(self):
  operations.fence(self.ops,self.resource)
  def stage(*args):(self.root/'stage-ran').touch()
  original=session.Path
  with patch.object(session,'os',types.SimpleNamespace(geteuid=lambda:0)),patch.object(session,'Path',lambda p:types.SimpleNamespace(is_char_device=lambda:True) if str(p)=='/dev/kvm' else original(p)),patch.object(session,'stage',stage),patch.object(sys,'argv',['session.py','_worker','prepare',self.resource]):
   with self.assertRaisesRegex(ValueError,'closed'):session.main()
  self.assertFalse((self.root/'stage-ran').exists())
 def test_transfer_hands_off_between_live_watchdogs_and_returns_bounded_ack(self):
  base={**self.request,'argv':['x'*16384]*3+['']}
  base['argv'][-1]='z'*(65536-len(json.dumps(base).encode()));self.request=base
  self.assertEqual(len(json.dumps(self.request).encode()),65536)
  self.assertEqual(session.request_identity(self.request,self.resource),self.request)
  original=session.receive
  def receive(*args):
   value=original(*args);self.transferred=True;return value
  output=io.StringIO()
  with patch.object(session,'receive',receive),patch.object(sys,'stdin',types.SimpleNamespace(buffer=self.bundle())),contextlib.redirect_stdout(output):session.stage('transfer',self.resource)
  self.assertFalse((self.root/'lost-protection').exists(),'No watchdog remained live during handoff')
  self.assertTrue((self.ops/self.resource/'expiry.json').is_file())
  self.assertLessEqual(len(output.getvalue().encode()),65536,'Transfer ACK exceeded structured-output budget')
  ack=json.loads(output.getvalue());self.assertEqual(ack['resourceId'],self.resource);self.assertNotIn('argv',ack)
 def test_inspection_counts_control_and_operation_presence(self):
  directory=self.control/self.resource;directory.mkdir()
  self.assertFalse(session.inspect(self.resource)['absent'])
  directory.rmdir();self.active=True
  self.assertFalse(session.inspect(self.resource)['absent'])
  self.active=False;self.assertTrue(session.inspect(self.resource)['absent'])
 def test_closed_generation_cannot_arm_another_watchdog(self):
  operations.fence(self.ops,self.resource)
  with self.assertRaisesRegex(ValueError,'closed'):session.arm_expiry(self.resource,self.request['deadline'],'expiry')
  self.assertFalse((self.ops/self.resource/'expiry.json').exists());self.assertEqual(self.live,set())
 def test_stale_destroy_preserves_another_turns_active_record(self):
  root=self.root/'host';root.mkdir();(root/'history').mkdir();(root/'turns').mkdir()
  active=root/'active.json';before={'resourceId':'dt-peer-0-1','deadline':int(time.time()*1000)+60000};active.write_text(json.dumps(before))
  with patch.object(host,'ROOT',root),patch.object(host,'locked',contextlib.nullcontext):
   with self.assertRaisesRegex(ValueError,'Another turn'):host.destroy(self.resource)
  self.assertEqual(json.loads(active.read_text()),before);self.assertEqual(list((root/'history').iterdir()),[])

 def test_old_execution_rpc_is_refused_instead_of_returning_new_rpc_success(self):
  original=session.Path
  with patch.object(session,'os',types.SimpleNamespace(geteuid=lambda:0)),patch.object(session,'Path',lambda p:types.SimpleNamespace(is_char_device=lambda:True) if str(p)=='/dev/kvm' else original(p)),patch.object(session,'supervise',lambda *args:0),patch.object(sys,'argv',['session.py','execute',self.resource]):
   with self.assertRaisesRegex(ValueError,'Unknown turn operation'):session.main()

unittest.main(verbosity=2)
