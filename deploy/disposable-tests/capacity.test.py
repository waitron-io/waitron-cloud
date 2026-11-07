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

unittest.main(verbosity=2)
