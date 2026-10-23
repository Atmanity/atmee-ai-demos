// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Avatar } from './useAvatar.ts';
import { useToolNet } from './useToolNet.ts';

afterEach(() => { vi.useRealTimers(); });

function setup() {
  vi.useFakeTimers();
  const avatar = { phase: 'live', event: vi.fn() } as unknown as Avatar;
  const run = vi.fn(async () => 'Done: the next city is up.');
  const hook = renderHook(() => useToolNet({
    match: (text) => (/next/i.test(text) ? { id: 'n', name: 'next_city', arguments: {} } : null),
    run,
    avatar: () => avatar,
  }));
  return { avatar, run, hook };
}

test('a narrated action is done by the page after the wait, while the call is live', async () => {
  const { run, hook } = setup();
  hook.result.current.heard('Next city, please.');
  await vi.advanceTimersByTimeAsync(7000);
  expect(run).toHaveBeenCalledTimes(1);
});

test('a hang-up cancels what the net was waiting to do', async () => {
  const { avatar, run, hook } = setup();
  hook.result.current.heard('Next city, please.');
  (avatar as { phase: string }).phase = 'ended';
  hook.rerender();
  await vi.advanceTimersByTimeAsync(7000);
  expect(run).not.toHaveBeenCalled();
});

test('leaving the page cancels it too', async () => {
  const { run, hook } = setup();
  hook.result.current.heard('Next city, please.');
  hook.unmount();
  await vi.advanceTimersByTimeAsync(7000);
  expect(run).not.toHaveBeenCalled();
});
