"""Portable tests of the trusted disk recipe and publication boundary."""
import contextlib
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import sys
import unittest
from unittest.mock import patch
import host
import session


class Images(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).with_name('image.py')
        self.assertTrue(source.is_file(), 'prebuilt disk builder is missing')
        spec = importlib.util.spec_from_file_location('image', source)
        self.image = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.image)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.recipe = self.root/'recipe'
        self.recipe.mkdir()
        for name in ['image.py', 'guest-tools.sh', 'runner-tools.sh']:
            (self.recipe/name).write_text(name)
        self.patches = [patch.object(self.image, 'RECIPE', self.recipe),
                        patch.object(self.image.os, 'geteuid', return_value=os.getuid())]
        # The host checks root ownership; portable fixtures replace only the OS owner.
        original = self.image.metadata
        def metadata(path, mode):
            with patch.object(self.image, 'OWNER', os.getuid()):
                return original(path, mode)
        self.patches.append(patch.object(self.image, 'metadata', metadata))
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def artifact(self):
        directory = self.root/'images'/self.image.fingerprint(host.IMAGE_SHA512)
        directory.mkdir(mode=0o755, parents=True)
        disk = directory/'tools.qcow2'
        disk.write_bytes(b'self-contained fixture')
        digest = directory/'sha512'
        digest.write_text(hashlib.sha512(disk.read_bytes()).hexdigest()+'\n')
        disk.chmod(0o444)
        digest.chmod(0o444)
        return directory, disk, digest

    def test_recipe_invalidates_on_each_installer_builder_and_debian_pin(self):
        key = self.image.fingerprint(host.IMAGE_SHA512)
        for name in ['image.py', 'guest-tools.sh', 'runner-tools.sh']:
            original = (self.recipe/name).read_bytes()
            (self.recipe/name).write_bytes(original+b'changed')
            self.assertNotEqual(self.image.fingerprint(host.IMAGE_SHA512), key)
            (self.recipe/name).write_bytes(original)
        self.assertNotEqual(self.image.fingerprint('a'*128), key)
        (self.recipe/'guest-exec.py').write_text('new execution code')
        self.assertEqual(self.image.fingerprint(host.IMAGE_SHA512), key)

    def test_missing_or_stale_disk_falls_back_without_reading_old_disks(self):
        self.assertIsNone(self.image.select(self.root, host.IMAGE_SHA512))
        self.artifact()
        (self.recipe/'runner-tools.sh').write_text('changed pins')
        self.assertIsNone(self.image.select(self.root, host.IMAGE_SHA512))

    def test_matching_disk_hashes_before_locked_recheck_and_rejects_corruption(self):
        directory, disk, _ = self.artifact()
        chosen = self.image.select(self.root, host.IMAGE_SHA512)
        self.assertEqual(chosen['path'], disk)
        calls = []
        def run(*args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, '{"format":"qcow2"}', '')
        self.image.recheck(chosen, run)
        self.assertEqual(calls, [('qemu-img', 'info', '--output=json', str(disk))])
        disk.chmod(0o644)
        disk.write_bytes(b'corrupted')
        disk.chmod(0o444)
        with self.assertRaisesRegex(ValueError, 'digest'):
            self.image.select(self.root, host.IMAGE_SHA512)

    def test_unsafe_linked_or_writable_artifacts_refuse(self):
        directory, disk, digest = self.artifact()
        for path, mode in [(disk, 0o644), (digest, 0o644), (directory, 0o777), (directory.parent, 0o777)]:
            original = path.stat().st_mode & 0o777
            path.chmod(mode)
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                self.image.select(self.root, host.IMAGE_SHA512)
            path.chmod(original)
        os.link(disk, self.root/'linked')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.image.select(self.root, host.IMAGE_SHA512)
        (self.root/'linked').unlink()
        disk.unlink()
        disk.symlink_to(digest)
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.image.select(self.root, host.IMAGE_SHA512)

    def test_recheck_refuses_replacement_and_external_backing(self):
        _, disk, _ = self.artifact()
        chosen = self.image.select(self.root, host.IMAGE_SHA512)
        for shape in [{'format':'raw'}, {'format':'qcow2','backing-filename':'other'}, {'format':'qcow2','data-file':'other'}, {'format':'qcow2','format-specific':{'data':{'data-file':'other'}}}]:
            with self.assertRaisesRegex(ValueError, 'self-contained'):
                self.image.recheck(chosen, lambda *args: subprocess.CompletedProcess(args,0,json.dumps(shape),''))
        disk.chmod(0o644)
        disk.write_bytes(b'replacement')
        disk.chmod(0o444)
        with self.assertRaisesRegex(ValueError, 'changed'):
            self.image.recheck(chosen, lambda *args: self.fail('changed disk reached qemu'))

    def test_builder_streams_only_installers_checks_sanitizes_publishes_and_cleans(self):
        self.run_builder()

    def test_host_selects_prebuilt_before_lock_and_creates_a_private_overlay(self):
        _, disk, _ = self.artifact()
        (self.root/'turns').mkdir()
        (self.root/'history').mkdir()
        key='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGiUcL7F9BcOzhFJbD97eQj+L6u16A5RylAnj1BrChgC'
        request={'resourceId':'dt-selection-3-1','deadline':int(__import__('time').time()*1000)+60000,'sshPublicKey':key}
        calls=[]
        held=False
        @contextlib.contextmanager
        def locked():
            nonlocal held
            held=True
            try: yield
            finally: held=False
        original=self.image.select
        def select(*args):
            self.assertFalse(held,'image hashing held the global allocation lock')
            return original(*args)
        def run(*argv,**kwargs):
            calls.append(argv)
            if argv[:2]==('qemu-img','info'): self.assertTrue(held)
            return subprocess.CompletedProcess(argv,0,'{"format":"qcow2"}','')
        with patch.dict(sys.modules,{'image':self.image}), patch.object(host,'ROOT',self.root), \
                patch.object(host,'locked',locked),patch.object(host,'capacity',return_value={'cpus':[4]}), \
                patch.object(host,'guest_account'),patch.object(host,'network_policy',return_value='rules'), \
                patch.object(host,'observation',return_value={'absent':True,'running':True}), \
                patch.object(host.os,'chown'),patch.object(host,'run',run), \
                patch.object(host,'image_verified') as base,patch.object(self.image,'select',side_effect=select):
            result=host.create(request)
        base.assert_not_called()
        self.assertEqual(result['preparation'],'prebuilt')
        overlay=next(argv for argv in calls if argv[:2]==('qemu-img','create'))
        self.assertEqual(overlay[overlay.index('-b')+1],str(disk))
        self.assertEqual(overlay[-2],str(self.root/'turns'/request['resourceId']/'disk.qcow2'))

    def test_sibling_build_does_not_invalidate_the_selected_artifact(self):
        self.artifact()
        chosen=self.image.select(self.root,host.IMAGE_SHA512)
        (self.root/'images'/'.building-sibling').mkdir()
        self.image.recheck(chosen,lambda *args:subprocess.CompletedProcess(args,0,'{"format":"qcow2"}',''))

    def test_builder_publishes_readable_directories_under_a_private_umask(self):
        previous=os.umask(0o077)
        try: self.run_builder()
        finally: os.umask(previous)

    def test_failed_builder_never_publishes_and_still_checks_cleanup(self):
        self.run_builder(fail=True)

    def test_sanitation_clears_builder_state_but_refuses_task_credentials(self):
        fixture=self.root/'guest'
        tools=self.root/'bin'
        tools.mkdir()
        for name in ['etc/ssh','var/lib/cloud','var/lib/dbus','var/lib/systemd','var/lib/docker','var/lib/containerd','root/.ssh','home/runner/.ssh']:
            (fixture/name).mkdir(parents=True,exist_ok=True)
        for name in ['etc/machine-id','etc/ssh/ssh_host_ed25519_key','var/lib/dbus/machine-id','var/lib/systemd/random-seed']:
            (fixture/name).write_text('builder-identity')
        systemctl=tools/'systemctl'
        systemctl.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$GUEST/systemctl"\n')
        cloud=tools/'cloud-init'
        cloud.write_text('#!/bin/sh\nif test "$2" = --help; then echo "--logs --seed --machine-id"; fi\n')
        systemctl.chmod(0o755)
        cloud.chmod(0o755)
        script=re.sub(r'/(?:work|opt|root|home|var|tmp|etc)(?=/|\s|$)',lambda m:str(fixture)+m[0],self.image.SANITIZE)
        environment={**os.environ,'PATH':str(tools)+os.pathsep+os.environ['PATH'],'GUEST':str(fixture)}
        credential=fixture/'opt/actions-runner/.credentials'
        credential.parent.mkdir(parents=True)
        credential.write_text('must-not-be-hidden')
        diagnostics=credential.parent/'_diag'
        diagnostics.mkdir()
        log=diagnostics/'Runner_20261110-040000-utc.log'
        log.write_text('builder version diagnostic\n')
        refused=subprocess.run(['bash','-c',script],env=environment,capture_output=True,text=True)
        self.assertNotEqual(refused.returncode,0)
        self.assertIn('credential',refused.stderr)
        self.assertEqual(credential.read_text(),'must-not-be-hidden')
        self.assertTrue((fixture/'root/.ssh').is_dir(),'refusal must precede deletion')
        credential.unlink()
        unexpected=diagnostics/'Worker_task.log'
        unexpected.write_text('unexpected task diagnostic')
        refused=subprocess.run(['bash','-c',script],env=environment,capture_output=True,text=True)
        self.assertNotEqual(refused.returncode,0)
        self.assertTrue(unexpected.is_file())
        self.assertTrue(log.is_file())
        unexpected.unlink()
        log.unlink()
        diagnostics.rmdir()
        other=self.root/'other-diagnostics'
        other.mkdir()
        (other/log.name).write_text('builder version diagnostic\n')
        (other/'Worker_task.log').write_text('must remain')
        diagnostics.symlink_to(other,target_is_directory=True)
        refused=subprocess.run(['bash','-c',script],env=environment,capture_output=True,text=True)
        self.assertNotEqual(refused.returncode,0,'linked diagnostics passed sanitation')
        self.assertEqual((other/'Worker_task.log').read_text(),'must remain')
        diagnostics.unlink()
        diagnostics.mkdir()
        log.write_text('builder version diagnostic\n')
        cleaned=subprocess.run(['bash','-c',script],env=environment,capture_output=True,text=True)
        self.assertEqual(cleaned.returncode,0,cleaned.stderr)
        self.assertIn('builder version diagnostic',cleaned.stdout)
        self.assertFalse(diagnostics.exists())
        for name in ['root/.ssh','home/runner/.ssh','var/lib/docker','var/lib/containerd','var/lib/systemd/random-seed','etc/ssh/ssh_host_ed25519_key']:
            self.assertFalse((fixture/name).exists(),name)
        self.assertEqual((fixture/'etc/machine-id').read_bytes(),b'')
        self.assertIn('stop docker docker.socket containerd systemd-random-seed.service',(fixture/'systemctl').read_text())
        self.assertTrue((fixture/'systemctl').read_text().endswith('--no-block poweroff\n'))
        for name,remove in [
            ('etc/machine-id', 'truncate -s 0 '+str(fixture/'etc/machine-id')),
            ('root/.ssh', str(fixture/'root/.ssh')+' '+str(fixture/'home/runner/.ssh')),
            ('var/lib/docker', 'rm -rf '+str(fixture/'var/lib/docker')+' '+str(fixture/'var/lib/containerd')),
        ]:
            path=fixture/name
            if name=='etc/machine-id':
                path.write_text('retained builder identity')
                mutated=script.replace(remove,':',1)
            else:
                path.mkdir(parents=True,exist_ok=True)
                replacement=str(fixture/'home/runner/.ssh') if name=='root/.ssh' else 'rm -rf '+str(fixture/'var/lib/containerd')
                mutated=script.replace(remove,replacement,1)
            self.assertNotEqual(mutated,script)
            refused=subprocess.run(['bash','-c',mutated],env=environment,capture_output=True,text=True)
            self.assertNotEqual(refused.returncode,0,name+' remained but sanitation succeeded')


    def run_builder(self, fail=False):
        calls = []
        def command(argv, deadline, **kwargs):
            calls.append((argv, kwargs.get('stdin').read() if kwargs.get('stdin') else None))
            if argv[0]=='ssh-keygen':
                Path(argv[-1]+'.pub').write_text('ssh-ed25519 builder-key')
            if fail and argv[-1]=='bash -s':
                raise ValueError('install refused')
            return 0, b''
        def run(*args, **kwargs):
            if args[:2]==('qemu-img','convert'):
                Path(args[-1]).write_bytes(b'flattened')
            return subprocess.CompletedProcess(args, 0, '{"format":"qcow2"}', '')
        def directory(path, mode=0o700):
            path.mkdir(mode=mode, parents=True, exist_ok=True)
        resource = 'dt-builder-2-1'
        with patch.object(host,'locked',contextlib.nullcontext), patch.object(host,'ROOT',self.root), patch.object(host,'_create',return_value={'running':True}) as create, \
                patch.object(host,'directory',directory), patch.object(host,'run',run), \
                patch.object(host,'service_state',return_value={'absent':True}), \
                patch.object(host,'destroy',return_value={'absent':True}) as destroy, \
                patch.object(host,'observation',return_value={'absent':True}) as inspect, \
                patch.object(session,'command',side_effect=command), \
                patch.object(session,'wait_for_guest',return_value=['ssh','fixture']):
            if fail:
                with self.assertRaisesRegex(ValueError,'install refused'):
                    self.image.build(resource)
                self.assertFalse((self.root/'images').exists())
            else:
                result = self.image.build(resource)
                self.assertEqual(result['mode'],'prebuilt')
                create.assert_called_once()
                self.assertTrue(create.call_args.kwargs['fresh'])
                self.assertEqual([data for argv,data in calls if argv[-1]=='bash -s'],[b'guest-tools.sh',b'runner-tools.sh'])
                self.assertEqual(sum(argv[-1]=='bash -s -- --check' for argv,_ in calls),2)
                sanitation=next(argv[-1] for argv,_ in calls if 'cloud-init clean' in argv[-1])
                self.assertTrue(sanitation.rstrip().endswith('systemctl --no-block poweroff'),
                                'shutdown must use the connection whose builder key is being removed')
                for word in ['docker.socket','containerd','/root/.ssh','ssh_host_','machine-id','random-seed','/var/lib/docker','/var/lib/apt/lists','/work','/opt/waitron-disposable','.credentials']:
                    self.assertIn(word,sanitation)
                chosen=self.image.select(self.root,host.IMAGE_SHA512)
                self.assertIsNotNone(chosen)
                before=len(calls)
                self.assertEqual(self.image.build(resource)['mode'],'prebuilt')
                self.assertEqual(len(calls),before,'matching image unnecessarily rebuilt')
            destroy.assert_called_once_with(resource)
            inspect.assert_called_once_with(resource)


unittest.main(verbosity=2)
