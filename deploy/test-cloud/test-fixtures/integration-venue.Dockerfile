ARG WAITRON_IMAGE
FROM ${WAITRON_IMAGE}
USER root
ARG WITH_STREAM=0
COPY integration-litestream /proof/litestream
RUN if [ "$WITH_STREAM" = 1 ]; then node --input-type=module -e "import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {writeFile,rm,rename,copyFile,chmod} from 'node:fs/promises';import {execFileSync} from 'node:child_process';assert.equal(process.arch,'x64');const response=await fetch('https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-x86_64.tar.gz');assert.equal(response.ok,true);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),'cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d');await writeFile('/tmp/litestream.tgz',bytes);execFileSync('tar',['-xzf','/tmp/litestream.tgz','-C','/usr/local/bin','litestream']);await rm('/tmp/litestream.tgz');await rename('/usr/local/bin/litestream','/usr/local/bin/litestream-native');await copyFile('/proof/litestream','/usr/local/bin/litestream');await chmod('/usr/local/bin/litestream',0o755);assert.equal(execFileSync('litestream',['version'],{encoding:'utf8'}).trim(),'0.5.17');"; fi
COPY integration-venue.mjs /waitron/apps/server/scripts/cloud-test-integration.mjs
COPY integration-control.mjs /proof/integration-control.mjs
COPY integration-free-remote.mjs /proof/integration-free-remote.mjs
COPY integration-paid-remote-client.mjs /proof/integration-paid-remote-client.mjs
COPY integration-venue-request.mjs /proof/integration-venue-request.mjs
COPY integration-verification-state.mjs /proof/integration-verification-state.mjs
COPY integration-recovery-authority.mjs /proof/integration-recovery-authority.mjs
COPY integration-stream.mjs /proof/integration-stream.mjs
COPY integration-transport.mjs /proof/integration-transport.mjs
WORKDIR /waitron/apps/server
RUN --network=none pnpm --dir ../dashboard build
RUN install -d -o 1000 -g 1000 /tmp/cloud-integration-state
USER 1000:1000
ENTRYPOINT ["node", "--import", "tsx", "/waitron/apps/server/scripts/cloud-test-integration.mjs"]
