"""Completion evidence is separate from SSH/supervisor exit status."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent))
import session
spec=importlib.util.spec_from_file_location('guest',Path(__file__).with_name('guest-exec.py'))
guest=importlib.util.module_from_spec(spec);spec.loader.exec_module(guest)

class Completion(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='disposable-completion-');self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name);self.resource='dt-complete-0-1';self.directory=self.root/self.resource;self.directory.mkdir()
  self.request={'resourceId':self.resource,'snapshot':'a'*64,'argv':[sys.executable,'-c','raise SystemExit(3)'],'deadline':int(time.time()*1000)+60000}
  (self.directory/'request.json').write_text(json.dumps(self.request));(self.directory/'prepared').touch()
  for target,name,value in [(session,'turn_directory',lambda resource:self.directory), (session,'CONTROL',self.root),(session.host,'observation',lambda resource:{'running':True})]:
   old=getattr(target,name);setattr(target,name,value);self.addCleanup(setattr,target,name,old)

 def test_guest_completion_keeps_literal_command_status_in_bound_evidence(self):
  self.assertTrue(callable(getattr(guest,'complete',None)),'A command result needs independent completion evidence')
  for code in [0,3,125,255]:
   path=self.root/('result-'+str(code)+'.json')
   request={'argv':[sys.executable,'-c','raise SystemExit('+str(code)+')'],'deadline':int(time.time()*1000)+5000,'nonce':'b'*32}
   value=guest.complete(request,str(self.root),self.resource,path)
   self.assertEqual(value,{'resourceId':self.resource,'nonce':'b'*32,'code':code})
   self.assertEqual(json.loads(path.read_text()),value)

 def provider(self, channel=0, foreign=False):
  def command(argv,deadline,stdin=None,capture=False,check=True):
   if 'guest-exec.py' in argv[-1]:return channel,None
   self.assertTrue(argv[-1].startswith('cat /run/waitron-disposable/'))
   request=json.loads((self.directory/'command.json').read_text())
   return 0,json.dumps({'resourceId':self.resource,'nonce':('c'*32 if foreign else request.get('nonce','missing')),'code':3}).encode()
  return command

 def test_host_confirms_only_the_exact_guest_completion_and_keeps_it_for_readback(self):
  with patch.object(session,'command',self.provider()):self.assertEqual(session.execute(self.resource),0)
  path=self.directory/'result.json'
  self.assertTrue(path.is_file(),'No trusted host completion was retained')
  self.assertEqual(json.loads(path.read_text()),{'resourceId':self.resource,'code':3})

 def test_lost_execution_channel_never_produces_host_completion(self):
  with patch.object(session,'command',self.provider(channel=255)):
   with self.assertRaisesRegex(ValueError,'channel|completion'):session.execute(self.resource)
  self.assertFalse((self.directory/'result.json').exists())

 def test_replayed_guest_completion_nonce_is_refused(self):
  with patch.object(session,'command',self.provider(foreign=True)):
   with self.assertRaisesRegex(ValueError,'completion|nonce'):session.execute(self.resource)
  self.assertFalse((self.directory/'result.json').exists())

 def test_host_receipt_capture_stops_at_four_kibibytes_before_buffering_a_guest_flood(self):
  with self.assertRaisesRegex(ValueError,'output.*limit'):
   session.command([sys.executable,'-c',"import os;os.write(1,b'x'*1000000)"],int(time.time()*1000)+5000,capture=True)

 def test_guest_deadline_leaves_ten_seconds_for_verified_timeout_readback(self):
  with patch.object(session,'command',self.provider()):session.execute(self.resource)
  self.assertEqual(json.loads((self.directory/'command.json').read_text())['deadline'],self.request['deadline']-10000)

unittest.main(verbosity=2)
