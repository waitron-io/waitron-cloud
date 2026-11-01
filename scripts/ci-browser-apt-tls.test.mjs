import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';

// A raw socket close must not masquerade as a completed TLS response.
for (const mode of ['clean', 'silent', 'abrupt']) test('APT archive fixture finishes TLS shutdown with client mode ' + mode, {timeout: 10000}, async () => {
  const {stdout} = await promisify(execFile)('python3', ['-c', String.raw`
import ast
import functools
import http.server
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading

# Load the actual handler without running package generation or the APT scenarios.
tree = ast.parse(Path('scripts/fixtures/ci-browser-apt.py').read_text())
handler = next(node for node in ast.walk(tree) if isinstance(node, ast.ClassDef) and node.name == 'Handler')
namespace = {'http': http, 'requests': [], 'mode': 'fallback'}
exec(compile(ast.Module(body=[handler], type_ignores=[]), '<archive-handler>', 'exec'), namespace)
finished = threading.Event()
errors = []
coalescing = []
class ObservedHandler(namespace['Handler']):
    def setup(self):
        super().setup()
        coalescing.append(bool(self.connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY)))
class TrackedServer(http.server.ThreadingHTTPServer):
    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            finished.set()
client_mode = sys.argv[1]
with tempfile.TemporaryDirectory(prefix='cloud-apt-tls-') as directory:
    root = Path(directory)
    (root / 'Release').write_bytes(b'signed archive body')
    cert, key = root / 'cert.pem', root / 'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
                    '-keyout', str(key), '-out', str(cert)], check=True, capture_output=True, timeout=5)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    server = TrackedServer(('127.0.0.1', 0),
        functools.partial(ObservedHandler, directory=directory))
    server.handle_error = lambda *_args: errors.append(type(sys.exc_info()[1]).__name__)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = ssl.create_default_context(cafile=str(cert))
        for _ in range(2):
            finished.clear()
            with socket.create_connection(server.server_address, timeout=2) as raw:
                with client.wrap_socket(raw, server_hostname='127.0.0.1', suppress_ragged_eofs=False) as connection:
                    connection.sendall(b'GET /second/Release HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n')
                    response = b''
                    while chunk := connection.recv(4096):
                        response += chunk
                    assert response.split(b'\r\n\r\n', 1)[1] == b'signed archive body', response
                    if client_mode == 'clean':
                        connection.unwrap().close()
                    elif client_mode == 'abrupt':
                        connection.close()
                    assert finished.wait(2), 'server waits indefinitely for the peer shutdown'
                    assert errors == [], errors
        assert namespace['requests'] == ['/second/Release', '/second/Release']
        assert coalescing == [True, True], f'TCP coalescing remains enabled: {coalescing}'
        print('two verified responses and bounded TLS shutdowns')
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        assert not thread.is_alive()
`, mode], {timeout: 9000, maxBuffer: 2 ** 20});
  assert.equal(stdout.trim(), 'two verified responses and bounded TLS shutdowns');
});
