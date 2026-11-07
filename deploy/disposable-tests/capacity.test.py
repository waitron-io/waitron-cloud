"""Host admission reserves real memory, execution threads and the disk margin."""
import unittest
import host

G = 1024**3

class Capacity(unittest.TestCase):
    def setUp(self):
        self.assertTrue(callable(getattr(host,'budget',None)), 'Host admission must enforce the agreed resource budget')
        self.assertTrue(callable(getattr(host,'guest_cpus',None)), 'Host admission must reserve complete physical cores')

    def test_four_and_six_fit_unchanged_caps_but_seven_refuses_memory(self):
        for slots in [4, 6]:
            host.budget(slots, memory=125*G, threads=32, disk_total=1800*G, disk_free=1700*G, allocated=0)
        with self.assertRaisesRegex(ValueError, 'memory'):
            host.budget(7, memory=125*G, threads=64, disk_total=1800*G, disk_free=1700*G, allocated=0)

    def test_cpu_reserve_includes_both_siblings_of_four_physical_cores(self):
        topology = {cpu:(0,cpu%16) for cpu in range(32)}
        self.assertEqual(host.guest_cpus(topology), list(range(4,16))+list(range(20,32)))
        with self.assertRaisesRegex(ValueError, 'thread'):
            host.budget(6,memory=256*G,threads=31,disk_total=1800*G,disk_free=1700*G,allocated=0)
        for count in [0, 17, True]:
            with self.assertRaises(ValueError):host.budget(count,memory=256*G,threads=128,disk_total=1800*G,disk_free=1700*G,allocated=0)

    def test_disk_admission_retains_twenty_percent_after_guests_reach_their_maximum(self):
        host.budget(4,memory=125*G,threads=32,disk_total=1000*G,disk_free=456*G,allocated=0)
        with self.assertRaisesRegex(ValueError, 'disk'):
            host.budget(4,memory=125*G,threads=32,disk_total=1000*G,disk_free=455*G,allocated=0)
        # Allocated owned disk bytes already reduced free space and must not be charged twice.
        host.budget(4,memory=125*G,threads=32,disk_total=1000*G,disk_free=328*G,allocated=128*G)

    def test_malformed_or_insufficient_physical_topology_cannot_open_a_guest_pool(self):
        for topology in [{}, {0:(0,0),1:(0,1),2:(0,2),3:(0,3)}, {0:(0,0),1:None}]:
            with self.assertRaises(ValueError):host.guest_cpus(topology)

    def test_short_host_updates_wait_for_the_current_writer_instead_of_rejecting_a_neighbor(self):
        import fcntl,os,subprocess,sys,tempfile,time
        from pathlib import Path
        with tempfile.TemporaryDirectory(prefix='d599-host-lock-') as temporary:
            path=Path(temporary)/'operation.lock'
            with path.open('w') as lock:
                path.chmod(0o600);fcntl.flock(lock,fcntl.LOCK_EX)
                program="""import os,sys,types
from pathlib import Path
import host
host.ROOT=Path(sys.argv[1]);host.directory=lambda path,mode=0o700:path.mkdir(mode=mode,parents=True,exist_ok=True)
original=host.Path;host.Path=lambda value:types.SimpleNamespace(is_char_device=lambda:True) if str(value)=='/dev/kvm' else original(value)
host.os.geteuid=lambda:0
fstat=os.fstat;host.os.fstat=lambda fd:types.SimpleNamespace(st_mode=fstat(fd).st_mode,st_uid=0)
print('attempt',flush=True)
try:
 with host.locked():print('acquired',flush=True)
except BlockingIOError:sys.exit(75)
"""
                child=subprocess.Popen([sys.executable,'-I','-B','-c','import sys;sys.path.insert(0,sys.argv.pop(1));'+program,str(Path(__file__).resolve().parent),temporary],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
                try:
                    self.assertEqual(child.stdout.readline().strip(),'attempt');time.sleep(.15)
                    self.assertIsNone(child.poll(),'A concurrent host update was refused instead of waiting for the short writer')
                finally:
                    fcntl.flock(lock,fcntl.LOCK_UN)
                    try:stdout,stderr=child.communicate(timeout=5)
                    except subprocess.TimeoutExpired:
                        child.kill();child.communicate();raise
                self.assertEqual(child.returncode,0,stderr);self.assertEqual(stdout.strip(),'acquired')

    def test_admission_counts_a_retained_guest_without_an_active_record(self):
        from pathlib import Path
        from unittest.mock import patch
        import os,tempfile,types
        with tempfile.TemporaryDirectory(prefix='d599-quarantine-budget-') as temporary:
            root=Path(temporary);turn=root/'turns/dt-quarantined-4-1';turn.mkdir(parents=True);(turn/'disk.qcow2').write_bytes(b'owned retained disk')
            read_text=Path.read_text;lstat=Path.lstat
            def read(path,*args,**kwargs):
                text=str(path)
                if text=='/proc/meminfo':return 'MemTotal: 131072000 kB\n'
                if text.startswith('/sys/devices/system/cpu/'):
                    cpu=int(text.split('/cpu')[-1].split('/')[0])
                    return '0' if text.endswith('physical_package_id') else str(cpu%16)
                return read_text(path,*args,**kwargs)
            def owned(path):
                value=lstat(path)
                return types.SimpleNamespace(st_mode=value.st_mode,st_uid=0,st_blocks=value.st_blocks) if str(path).startswith(str(root)) else value
            with patch.object(host,'ROOT',root),patch.object(Path,'read_text',read),patch.object(Path,'lstat',owned),patch.object(host.os,'sched_getaffinity',lambda pid:set(range(32)),create=True),patch.object(host.shutil,'disk_usage',lambda path:types.SimpleNamespace(total=1000*G,free=500*G)):
                admitted=host.capacity('dt-proposed-0-1');self.assertEqual(admitted['slots'],2)
                self.assertEqual(admitted['cpus'],list(range(4,16))+list(range(20,32)))
                with patch.object(host.shutil,'disk_usage',lambda path:types.SimpleNamespace(total=1000*G,free=327*G)):
                    with self.assertRaisesRegex(ValueError,'disk'):host.capacity('dt-proposed-0-1')

unittest.main(verbosity=2)
