import {setTimeout as delay} from 'node:timers/promises';

export async function runUntilSelectedVerification({runOnce, admitted, signal,
  wait = async (milliseconds, signal) => {
    try {await delay(milliseconds, undefined, {signal});}
    catch (error) {if (!signal.aborted) throw error;}
  }}) {
  while (!signal.aborted) {
    await runOnce();
    if (signal.aborted) return;
    if (await admitted()) {
      // Keep the fixture alive for its ordinary shutdown without starting an unrelated archive.
      while (!signal.aborted) await wait(1000, signal);
      return;
    }
    await wait(250, signal);
  }
}
