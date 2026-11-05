import assert from 'node:assert/strict';

const commitSHA = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);

export function resolveRange(event, context, git) {
  const full = reason => ({kind:'full', head:context.sha, reason});
  if (context.full || context.called || ['schedule','workflow_dispatch','workflow_call'].includes(context.eventName)) {
    return full('Full invocation: full suite');
  }
  try {
    if (context.eventName === 'pull_request' || (!context.eventName && event.pull_request)) {
      const {base,head} = event.pull_request;
      assert.ok(commitSHA(base.sha) && commitSHA(head.sha), 'Invalid PR revisions');
      const mergeBase = git('merge-base',base.sha,head.sha).trim();
      assert.ok(commitSHA(mergeBase), 'Invalid merge base');
      return {kind:'pr',base:mergeBase,head:head.sha};
    }
    if (context.eventName !== 'push' || context.ref !== 'refs/heads/main') return full('Main push or unknown diff: full suite');
    assert.ok(!event.forced && !event.deleted && !event.created, 'Unsupported push shape');
    assert.ok(commitSHA(event.before) && commitSHA(event.after) && event.after === context.sha, 'Invalid push revisions');
    for (const sha of [event.before,event.after]) {
      assert.equal(git('rev-parse','--verify',`${sha}^{commit}`).trim(),sha,'Push commit does not resolve exactly');
    }
    git('merge-base','--is-ancestor',event.before,event.after);
    return {kind:'push',base:event.before,head:event.after};
  } catch {
    return full('Cannot verify revision range: full suite');
  }
}
