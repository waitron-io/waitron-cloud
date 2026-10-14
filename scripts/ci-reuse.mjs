export function findReuse({sha, repository, branch}, api, tree) {
  try {
    const prs = api(`repos/${repository}/commits/${sha}/pulls?per_page=100`);
    if (!Array.isArray(prs) || prs.length !== 1) return null;
    const pr = prs[0];
    if (pr.state !== 'closed' || !pr.merged_at || pr.merge_commit_sha !== sha ||
        pr.base?.ref !== branch || pr.base.repo?.full_name !== repository || pr.head.repo?.full_name !== repository || !/^[a-f0-9]{40}$/.test(pr.head.sha)) return null;
    const runs = api(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${pr.head.sha}&event=pull_request&per_page=100`).workflow_runs;
    if (!Array.isArray(runs) || !runs.length) return null;
    const run = [...runs].sort((a,b)=>b.id-a.id)[0];
    if (run.head_sha !== pr.head.sha || run.head_branch !== pr.head.ref || run.head_repository?.full_name !== repository ||
        run.event !== 'pull_request' || run.path !== '.github/workflows/ci.yml' || run.status !== 'completed' || run.conclusion !== 'success' || !Number.isSafeInteger(run.id)) return null;
    const {jobs, total_count:count} = api(`repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`);
    if (!Array.isArray(jobs) || jobs.length !== count || !jobs.length ||
        jobs.some(job=>job.status !== 'completed' || !['success','skipped'].includes(job.conclusion)) ||
        ['changes','summary'].some(name=>jobs.filter(job=>job.name===name && job.conclusion==='success').length !== 1)) return null;
    // Cloud cannot enforce up-to-date branches. Tree equality prevents a scoped
    // green head from covering additional main changes introduced by a behind merge.
    const pushedTree = tree(sha);
    if (!/^[a-f0-9]{40}$/.test(pushedTree) || pushedTree !== tree(pr.head.sha)) return null;
    return {sha:pr.head.sha, runId:run.id};
  } catch {
    return null;
  }
}
