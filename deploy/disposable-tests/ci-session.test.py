"""CI uses only a bound request, never a workstation source/package transfer."""
import hashlib, importlib.util, io, json, os, pwd, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import Mock, patch
import session
spec=importlib.util.spec_from_file_location('guest',Path(__file__).with_name('guest-exec.py'))
guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)
CI={'repositoryId':123,'workflowId':456,'workflowPath':'.github/workflows/disposable-ci-canary.yml',
 'workflowSha':'1'*40,'workflowDigest':'2'*64,'event':'workflow_dispatch','sourceSha':'3'*40,
 'sourceTree':'4'*40,'runId':789,'attempt':1,'jobId':901,'jobKey':'typecheck'}
ARGV=['/opt/actions-runner/bin/Runner.Listener','run']
def request(resource):return {'resourceId':resource,'snapshot':hashlib.sha256(json.dumps(CI,separators=(',',':')).encode()).hexdigest(),
 'argv':ARGV,'deadline':int(time.time()*1000)+60000,'ci':CI}
class CISession(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.resource='dt-ci-0-1'
 def test_ci_accepts_push_schedule_and_retries_for_routing_and_summary_jobs(self):
  for event in ['push','schedule','workflow_dispatch','pull_request']:
   for key in ['server-probe-1','changes-1','ci-1','test-server-stream-1','test-server-merge-1','publish-1','image-smoke-1']:
    with self.subTest(event=event,key=key):
     ci={**CI,'workflowPath':'.github/workflows/ci.yml','event':event,'attempt':2,'jobKey':key}
     value={**request(self.resource),'ci':ci,
      'snapshot':hashlib.sha256(json.dumps(ci,separators=(',',':')).encode()).hexdigest()}
     self.assertEqual(session.request_identity(value,self.resource)['ci'],ci)
 def test_ci_request_is_preserved_and_identity_mismatch_refuses(self):
  value=request(self.resource)
  self.assertEqual(session.request_identity(value,self.resource),value)
  for changes in [{'snapshot':'f'*64},{'argv':['sh']},{'ci':{**CI,'jobId':False}}, {'ci':{**CI,'other':1}}]:
   with self.assertRaises(ValueError):session.request_identity({**value,**changes},self.resource)
 def test_ci_transfer_accepts_only_small_json_and_never_leaves_source_or_secret(self):
  self.assertTrue(callable(getattr(session,'receive_ci',None)),'CI transfer entry point missing')
  value=request(self.resource)
  self.assertEqual(session.receive_ci(self.root,self.resource,io.BytesIO(json.dumps(value).encode())),value)
  self.assertEqual(sorted(p.name for p in (self.root/self.resource).iterdir()),['request.json'])
  for raw in [b'x'*65537,json.dumps({**value,'jitconfig':'secret'}).encode()]:
   with self.assertRaises(ValueError):session.receive_ci(self.root,'dt-ci-0-2',io.BytesIO(raw))
   self.assertFalse((self.root/'dt-ci-0-2').exists())
 def test_ci_preparation_does_not_require_or_install_a_private_source(self):
  directory=self.root/self.resource;directory.mkdir();(directory/'request.json').write_text(json.dumps(request(self.resource)))
  calls=[]
  def command(argv,deadline,stdin=None,capture=False,check=True):
   calls.append(argv);return 0,b'guest-key\n' if argv[0]=='ssh-keyscan' else b''
  def keygen(argv,deadline,stdin=None,capture=False,check=True):
   if argv[0]=='ssh-keygen':(directory/'key.pub').write_text('ssh-ed25519 fake')
   return command(argv,deadline,stdin,capture,check)
  with patch.object(session,'turn_directory',return_value=directory),patch.object(session,'command',side_effect=keygen),patch.object(session.host,'create'):
   session.prepare(self.resource)
  self.assertTrue((directory/'prepared').exists())
  joined='\n'.join(' '.join(argv) for argv in calls)
  self.assertIn('runner-tools.sh',joined)
  for forbidden in ['source.tar','ui.tgz','pnpm install','snapshot.py extract']:self.assertNotIn(forbidden,joined)
 def test_preparation_waits_through_only_ssh_boot_resets_within_the_original_deadline(self):
  for statuses in [[255,0],[2],[255,255]]:
   with self.subTest(statuses=statuses),tempfile.TemporaryDirectory() as temporary:
    directory=Path(temporary)/self.resource;directory.mkdir();value=request(self.resource);(directory/'request.json').write_text(json.dumps(value))
    remaining=list(statuses);readiness=[];now=time.time()
    def command(argv,deadline,stdin=None,capture=False,check=True):
     if argv[0]=='ssh-keygen':(directory/'key.pub').write_text('ssh-ed25519 fake')
     if argv[-1]=='cloud-init status --wait':
      readiness.append(deadline);code=remaining.pop(0)
      if check and code:raise RuntimeError(f'Turn stage failed with status {code}')
      return code,b''
     return 0,b'guest-key\n' if argv[0]=='ssh-keyscan' else b''
    def sleep(_):
     nonlocal now
     now+=0.25 if remaining==[0] else 121
    with patch.object(session,'turn_directory',return_value=directory),patch.object(session,'command',side_effect=command),patch.object(session.host,'create'),patch.object(session.time,'time',side_effect=lambda:now),patch.object(session.time,'sleep',side_effect=sleep):
     if statuses==[255,0]:session.prepare(self.resource);self.assertTrue((directory/'prepared').exists());self.assertEqual(len(readiness),2);self.assertEqual(readiness[0],readiness[1])
     else:
      expected=ValueError if statuses==[2] else TimeoutError
      message='status 2$' if statuses==[2] else 'within120seconds'
      with self.assertRaisesRegex(expected,message):session.prepare(self.resource)
      self.assertFalse((directory/'prepared').exists());self.assertEqual(len(readiness),1)
 def test_jit_is_delivered_only_to_listener_environment_and_not_to_argv_or_receipt(self):
  self.assertTrue(callable(getattr(guest,'complete_ci',None)),'CI execution entry point missing')
  output=self.root/'result.json';value={'deadline':int(time.time()*1000)+5000,'nonce':'a'*32,'jitconfig':'synthetic-base64'}
  account=pwd.struct_passwd(('runner','x',1001,1001,'','/home/runner','/bin/bash'))
  with patch.object(guest,'execute',return_value=0) as execute,patch.object(pwd,'getpwnam',return_value=account),patch.object(os,'getgrouplist',return_value=[1001,999]):
   guest.complete_ci(value,str(self.root),self.resource,output)
  args=execute.call_args
  self.assertEqual(args.args[0]['argv'],ARGV)
  self.assertNotIn('synthetic-base64',json.dumps(args.args))
  self.assertEqual(args.kwargs['environment']['ACTIONS_RUNNER_INPUT_JITCONFIG'],'synthetic-base64')
  self.assertNotIn('jit',output.read_text())
  with self.assertRaises(ValueError):guest.complete_ci({**value,'jitconfig':'x'*65537},str(self.root),self.resource,self.root/'bad')
 def test_ci_listener_runs_with_the_ordinary_account_and_its_environment(self):
  account=pwd.struct_passwd(('runner','x',1001,1001,'','/home/runner','/bin/bash'))
  def lookup(name):
   if name!='runner':raise KeyError(name)
   return account
  child=Mock(pid=2710000);child.wait.return_value=0
  value={'deadline':int(time.time()*1000)+5000,'nonce':'d'*32,'jitconfig':'synthetic-jit'}
  login={'HOME':'/root','USER':'root','LOGNAME':'root','SHELL':'/bin/sh','PATH':'/root/.local/bin:/usr/bin','RUNNER_ALLOW_RUNASROOT':'1',
         'XDG_RUNTIME_DIR':'/run/user/0','XDG_SESSION_ID':'synthetic','XDG_CONFIG_HOME':'/root/.config',
         'SSH_CLIENT':'synthetic','SSH_CONNECTION':'synthetic','SSH_TTY':'/dev/pts/0',
         'DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/0/bus','MAIL':'/var/mail/root','PWD':'/root',
         'LANG':'C.UTF-8','LC_TIME':'C','TZ':'UTC'}
  with patch.object(pwd,'getpwnam',side_effect=lookup),patch.object(os,'getgrouplist',return_value=[1001,999]),patch.object(guest.subprocess,'Popen',return_value=child) as launch,patch.object(guest.os,'killpg'),patch.dict(os.environ,login,clear=True):
   receipt=guest.complete_ci(value,str(self.root),self.resource,self.root/'ordinary-result.json')
  self.assertEqual(launch.call_args.args[0],ARGV)
  options=launch.call_args.kwargs
  self.assertEqual(options.get('user'),1001)
  self.assertEqual(options.get('group'),1001)
  self.assertEqual(options.get('extra_groups'),[1001,999])
  self.assertEqual(options['cwd'],str(self.root))
  environment=options['env']
  self.assertEqual(environment['HOME'],'/home/runner')
  self.assertEqual(environment['USER'],'runner')
  self.assertEqual(environment['LOGNAME'],'runner')
  self.assertEqual(environment.get('PATH'),'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')
  self.assertNotIn('/root',environment['PATH'])
  self.assertNotIn('RUNNER_ALLOW_RUNASROOT',environment)
  for name in ['XDG_RUNTIME_DIR','XDG_SESSION_ID','XDG_CONFIG_HOME','SSH_CLIENT','SSH_CONNECTION','SSH_TTY','DBUS_SESSION_BUS_ADDRESS','MAIL','PWD']:
   self.assertNotIn(name,environment)
  self.assertEqual(environment.get('SHELL'),'/bin/bash')
  self.assertEqual(environment.get('LANG'),'C.UTF-8')
  self.assertEqual(environment.get('LC_TIME'),'C')
  self.assertEqual(environment.get('TZ'),'UTC')
  self.assertEqual(environment['ACTIONS_RUNNER_INPUT_JITCONFIG'],'synthetic-jit')
  self.assertEqual(receipt,{'resourceId':self.resource,'nonce':'d'*32,'code':0})
  self.assertNotIn('synthetic-jit',(self.root/'ordinary-result.json').read_text())
 def test_ci_refuses_root_identity_or_root_groups_before_launch_or_receipt(self):
  value={'deadline':int(time.time()*1000)+5000,'nonce':'e'*32,'jitconfig':'synthetic-jit'}
  for uid,gid,groups in [(0,1001,[1001,999]),(1001,0,[1001,999]),(1001,1001,[1001,0])]:
   with self.subTest(uid=uid,gid=gid,groups=groups):
    account=pwd.struct_passwd(('runner','x',uid,gid,'','/home/runner','/bin/bash'))
    output=self.root/f'unsafe-{uid}-{gid}-{groups[-1]}.json'
    with patch.object(pwd,'getpwnam',return_value=account),patch.object(os,'getgrouplist',return_value=groups),patch.object(guest,'execute',return_value=0) as execute:
     with self.assertRaises(ValueError):guest.complete_ci(value,str(self.root),self.resource,output)
    execute.assert_not_called()
    self.assertFalse(output.exists())
 def test_ci_missing_ordinary_account_refuses_without_a_root_fallback(self):
  value={'deadline':int(time.time()*1000)+5000,'nonce':'f'*32,'jitconfig':'synthetic-jit'}
  output=self.root/'missing-account.json';failure=None
  with patch.object(pwd,'getpwnam',side_effect=KeyError('runner')),patch.object(guest,'execute',return_value=0) as execute:
   try:guest.complete_ci(value,str(self.root),self.resource,output)
   except Exception as error:failure=error
  self.assertIsInstance(failure,ValueError)
  execute.assert_not_called()
  self.assertFalse(output.exists())
 def test_changed_runner_binary_refuses_before_credentials_are_delivered(self):
  directory=self.root/self.resource;directory.mkdir();(directory/'request.json').write_text(json.dumps(request(self.resource)));(directory/'prepared').touch()
  calls=[]
  def command(argv,deadline,stdin=None,capture=False,check=True):
   calls.append(argv)
   if 'sha256sum' in argv[-1]:raise ValueError('Turn stage failed with status 1')
   if '--ci' in argv[-1]:
    payload=json.load(stdin);self.nonce=payload['nonce'];return 0,None
   return 0,json.dumps({'resourceId':self.resource,'nonce':self.nonce,'code':0}).encode()
  with patch.object(session,'turn_directory',return_value=directory),patch.object(session.host,'observation',return_value={'running':True}),patch.object(session,'command',side_effect=command):
   with self.assertRaises(ValueError):session.execute(self.resource,io.BytesIO(b'{"jitconfig":"synthetic"}'))
  self.assertFalse(any('--ci' in argv[-1] for argv in calls))
  self.assertFalse((directory/'result.json').exists())
 def test_memory_only_credential_channel_reaches_a_real_subprocess_without_a_file_descriptor(self):
  marker=self.root/'received'
  code,_=session.command([sys.executable,'-c',"import sys,pathlib;pathlib.Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())",str(marker)],
                         int(time.time()*1000)+5000,stdin=io.BytesIO(b'synthetic-memory-input'))
  self.assertEqual(code,0);self.assertEqual(marker.read_bytes(),b'synthetic-memory-input')
 def test_waitron_measurement_jobs_use_the_same_fixed_executor_and_bound_identity(self):
  for key in ['test-dashboard-1','test-server-24','test-heavy-3','test-till-1','test-till-7','test-ui-1']:
   ci={**CI,'workflowPath':'.github/workflows/ci.yml','jobKey':key}
   value={**request(self.resource),'ci':ci,'snapshot':hashlib.sha256(json.dumps(ci,separators=(',',':')).encode()).hexdigest()}
   self.assertEqual(session.request_identity(value,self.resource)['argv'],ARGV)
  for key in ['publish','test-dashboard-0','test-dashboard-5','test-server-25','test-heavy-4','test-server-01','test-dashboard-1\n','test-till-0','test-till-8','test-till-01','test-till-1\n','test-ui-0','test-ui-2','test-ui','test-setup-2']:
   ci={**CI,'workflowPath':'.github/workflows/ci.yml','jobKey':key}
   value={**request(self.resource),'ci':ci,'snapshot':hashlib.sha256(json.dumps(ci,separators=(',',':')).encode()).hexdigest()}
   with self.assertRaises(ValueError):session.request_identity(value,self.resource)
 def test_new_routed_families_preserve_the_fixed_executor_and_request_identity(self):
  for key in ['lint-1','root-guards-1','bundle-smoke-1','typecheck-1','test-setup-1','test-staffing-1','test-bookings-1','test-media-1',
              'test-payments-stripe-1','test-payments-sumup-1','test-identity-1','test-workforce-1','test-light-a-1','test-light-b-1',
              'test-fiscal-verifactu-1','test-fiscal-verifactu-4','test-provisioning-1','test-provisioning-6','mutation-shared-1','mutation-shared-4',
              'test-venue-service-1','test-venue-service-2','test-venue-service-3','test-venue-service-4','test-adjustments-1']:
   with self.subTest(key=key):
    ci={**CI,'workflowPath':'.github/workflows/ci.yml','event':'pull_request','jobKey':key}
    value={**request(self.resource),'ci':ci,'snapshot':hashlib.sha256(json.dumps(ci,separators=(',',':')).encode()).hexdigest()}
    self.assertEqual(session.request_identity(value,self.resource),value)
 def test_new_routed_families_refuse_extra_shards_and_malformed_keys(self):
  for key in ['lint-2','typecheck-2','test-setup-2','test-fiscal-verifactu-5','test-provisioning-7','mutation-shared-5','test-venue-service-5','test-adjustments-2',
              'test-server-stream-2','mutation-shared-aggregate-2','test-server-merge-2','test-till-merge-2','test-dashboard-merge-2','test-light-a-01','test-bookings-1\n']:
   ci={**CI,'workflowPath':'.github/workflows/ci.yml','jobKey':key}
   value={**request(self.resource),'ci':ci,'snapshot':hashlib.sha256(json.dumps(ci,separators=(',',':')).encode()).hexdigest()}
   with self.assertRaises(ValueError):session.request_identity(value,self.resource)
unittest.main(verbosity=2)
