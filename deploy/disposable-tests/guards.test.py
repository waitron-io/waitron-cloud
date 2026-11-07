"""Portable host policy tests with only OS/service providers replaced."""
import contextlib
import hashlib
import io
import json
import os
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
  # Inventory fixtures stay private regardless of the invoking shell's umask.
  previous_umask=os.umask(0o077);self.addCleanup(os.umask,previous_umask)
  self.temp=tempfile.TemporaryDirectory(prefix='disposable-host-policy-');self.addCleanup(self.temp.cleanup)
  self.host_locked=host.locked;self.root=Path(self.temp.name);self.control=self.root/'control';self.control.mkdir();self.ops=self.root/'operations'
  self.resource='dt-policy-0-1';self.live=set();self.active=False;self.transferred=False;self.order=[]
  self.request={'resourceId':self.resource,'snapshot':hashlib.sha256(b'opaque source').hexdigest(),'argv':['true'],'deadline':int(time.time()*1000)+60000}
  boot=self.root/'boot-id';boot.write_text('11111111-1111-4111-8111-111111111111')
  values=[(host,'locked',contextlib.nullcontext),(host,'capacity',lambda extra=None:{'slots':1,'cpus':list(range(4,16))}),(host,'ROOT',self.root),(startup,'BOOT_ID',boot),(session,'CONTROL',self.control),(session,'OPERATIONS',self.ops),
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

 def test_destroying_one_slot_preserves_other_slots_and_their_egress_policy(self):
  one=self.root/'active-1.json';two=self.root/'active-2.json'
  first={'resourceId':'dt-parallel-1-1','deadline':int(time.time()*1000)+60000}
  neighbor={'resourceId':'dt-parallel-2-1','deadline':first['deadline']}
  one.write_text(json.dumps(first));two.write_text(json.dumps(neighbor));(self.root/'history').mkdir()
  with patch.object(host,'locked',contextlib.nullcontext):
   result=host.destroy(first['resourceId'])
  self.assertTrue(result['absent']);self.assertFalse(one.exists());self.assertEqual(json.loads(two.read_text()),neighbor)
  self.assertTrue((self.root/'history/dt-parallel-1-1.json').is_file())
  with patch.object(host,'run',return_value=subprocess.CompletedProcess([],0,stdout='[]',stderr='')):
   rules=host.network_policy('dt-parallel-2-1')
  self.assertIn('meta skuid 62002 ',rules);self.assertNotIn('meta skuid 62000 ',rules)

 def test_guest_management_uses_the_resource_slot_not_the_default_port(self):
  args=session.guest_ssh(self.control/'dt-parallel-5-1')
  self.assertEqual(args[args.index('-p')+1],'22005');self.assertEqual(args[-1],'root@127.0.0.1')


 def test_image_preparation_creates_only_the_reserved_nonlogin_slot_accounts(self):
  image=self.root/'base-image';image.touch();accounts={};created=[]
  def lookup(uid):
   if uid not in accounts:raise KeyError(uid)
   return accounts[uid]
  def provider(*argv,**kwargs):
   self.assertEqual(argv[0],'useradd');uid=int(argv[argv.index('--uid')+1]);name=argv[-1]
   self.assertEqual(name,'dt-slot-'+str(uid-62000));self.assertEqual(argv[argv.index('--shell')+1],'/usr/sbin/nologin')
   self.assertIn('--no-create-home',argv);created.append(uid)
   accounts[uid]=types.SimpleNamespace(pw_name=name,pw_dir='/nonexistent',pw_shell='/usr/sbin/nologin')
   return subprocess.CompletedProcess(argv,0,stdout='',stderr='')
  with patch.object(host,'locked',contextlib.nullcontext),patch.object(host,'IMAGE',image),patch.object(host,'image_verified',lambda:None),patch.object(host.pwd,'getpwuid',lookup),patch.object(host,'run',provider):
   host.prepare_image()
   self.assertEqual(created,list(range(62000,62016)))
   created.clear();host.prepare_image();self.assertEqual(created,[])
   accounts[62005].pw_name='foreign'
   with self.assertRaisesRegex(ValueError,'unexpected'):host.prepare_image()


 def test_unsafe_budget_refuses_creation_before_any_resource_is_written(self):
  (self.root/'turns').mkdir();(self.root/'history').mkdir()
  key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGiUcL7F9BcOzhFJbD97eQj+L6u16A5RylAnj1BrChgC'
  request={'resourceId':'dt-budget-1-1','deadline':int(time.time()*1000)+60000,'sshPublicKey':key}
  with patch.object(host,'locked',contextlib.nullcontext),patch.object(host,'capacity',create=True,side_effect=ValueError('Insufficient memory')),patch.object(host,'image_verified',lambda:None),patch.object(host,'guest_account',lambda slot:None),patch.object(host,'network_policy',lambda resource:'synthetic'),patch.object(host.os,'chown',lambda *args:None):
   with self.assertRaisesRegex(ValueError,'memory'):host.create(request)
  self.assertFalse((self.root/'active-1.json').exists());self.assertEqual(list((self.root/'turns').iterdir()),[])


 def test_health_accepts_a_free_budget_while_a_different_slot_is_running(self):
  (self.root/'active.json').write_text(json.dumps({'resourceId':self.resource}))
  original=session.Path;output=io.StringIO()
  with patch.object(session,'os',types.SimpleNamespace(geteuid=lambda:0)),patch.object(session,'Path',lambda p:types.SimpleNamespace(is_char_device=lambda:True) if str(p)=='/dev/kvm' else original(p)),patch.object(sys,'argv',['session.py','health']),contextlib.redirect_stdout(output):
   self.assertEqual(session.main(),0)
  self.assertEqual(json.loads(output.getvalue()),{'healthy':True})

 def test_health_owns_the_host_inventory_lock_while_reading_capacity(self):
  import fcntl,stat
  original_path=host.Path;original_fstat=os.fstat;original_lstat=Path.lstat;result=io.StringIO()
  def metadata(path):
   value=original_lstat(path);return types.SimpleNamespace(st_mode=value.st_mode,st_uid=0,st_size=value.st_size,st_blocks=value.st_blocks)
  def measured_capacity():
   with (self.root/'operation.lock').open('r+') as other:
    try:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return {'slots':1,'cpus':[4,5,20,21]}
    self.fail('Health read allocation inventory without the host lock')
  def directory(path,mode=0o700):path.mkdir(mode=mode,parents=True,exist_ok=True)
  fake_path=lambda value:types.SimpleNamespace(is_char_device=lambda:True) if str(value)=='/dev/kvm' else original_path(value)
  with patch.object(host,'locked',self.host_locked),patch.object(host,'directory',directory),patch.object(host.os,'geteuid',lambda:0),patch.object(host.os,'fstat',lambda fd:types.SimpleNamespace(st_mode=original_fstat(fd).st_mode,st_uid=0)),patch.object(host,'Path',fake_path),patch.object(session,'Path',fake_path),patch.object(Path,'lstat',metadata),patch.object(host,'capacity',measured_capacity),patch.object(sys,'argv',['session.py','health']),contextlib.redirect_stdout(result):
   # The fixture has a genuine readiness record; only OS ownership is replaced.
   with (self.root/'operation.lock').open('w'):pass
   (self.root/'operation.lock').chmod(0o600)
   self.assertEqual(session.main(),0)
  self.assertEqual(json.loads(result.getvalue()),{'healthy':True})

 def test_create_applies_the_measured_cpu_pool_to_the_actual_systemd_request(self):
  (self.root/'turns').mkdir();(self.root/'history').mkdir();calls=[]
  key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGiUcL7F9BcOzhFJbD97eQj+L6u16A5RylAnj1BrChgC'
  request={'resourceId':'dt-affinity-1-1','deadline':int(time.time()*1000)+60000,'sshPublicKey':key}
  def provider(*argv,**kwargs):calls.append(argv);return subprocess.CompletedProcess(argv,0,stdout='',stderr='')
  with patch.object(host,'locked',contextlib.nullcontext),patch.object(host,'capacity',lambda extra=None:{'slots':1,'cpus':[4,5,20,21]}),patch.object(host,'image_verified',lambda:None),patch.object(host,'guest_account',lambda slot:None),patch.object(host,'network_policy',lambda resource:'synthetic'),patch.object(host.os,'chown',lambda *args:None),patch.object(host,'run',provider):
   host.create(request)
  service=next(argv for argv in calls if argv[0]=='systemd-run')
  self.assertIn('AllowedCPUs=4,5,20,21',service);self.assertIn('User=62001',service)


unittest.main(verbosity=2)
