"""CI uses only a bound request, never a workstation source/package transfer."""
import hashlib, importlib.util, io, json, sys, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch
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
 def test_jit_is_delivered_only_to_listener_environment_and_not_to_argv_or_receipt(self):
  self.assertTrue(callable(getattr(guest,'complete_ci',None)),'CI execution entry point missing')
  output=self.root/'result.json';value={'deadline':int(time.time()*1000)+5000,'nonce':'a'*32,'jitconfig':'synthetic-base64'}
  with patch.object(guest,'execute',return_value=0) as execute:
   guest.complete_ci(value,str(self.root),self.resource,output)
  args=execute.call_args
  self.assertEqual(args.args[0]['argv'],ARGV)
  self.assertNotIn('synthetic-base64',json.dumps(args.args))
  self.assertEqual(args.kwargs['environment']['ACTIONS_RUNNER_INPUT_JITCONFIG'],'synthetic-base64')
  self.assertNotIn('jit',output.read_text())
  with self.assertRaises(ValueError):guest.complete_ci({**value,'jitconfig':'x'*65537},str(self.root),self.resource,self.root/'bad')
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
unittest.main(verbosity=2)
