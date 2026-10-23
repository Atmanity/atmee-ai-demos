// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { BackToApps, captionsKey, useCaptionToggle } from './nav.tsx';

const assign = vi.fn();
beforeEach(() => {
  localStorage.clear();
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test('the captions choice starts at the default and is remembered per app', () => {
  const { result } = renderHook(() => useCaptionToggle('demo', false));
  expect(result.current.on).toBe(false);
  act(() => result.current.toggle());
  expect(result.current.on).toBe(true);
  expect(localStorage.getItem(captionsKey('demo'))).toBe('1');
  // A reload reads it back; another app keeps its own default.
  expect(renderHook(() => useCaptionToggle('demo', false)).result.current.on).toBe(true);
  expect(renderHook(() => useCaptionToggle('other', true)).result.current.on).toBe(true);
});

test('a browser that refuses storage still toggles, for the visit', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const { result } = renderHook(() => useCaptionToggle('demo', true));
  expect(result.current.on).toBe(true);
  act(() => result.current.toggle());
  expect(result.current.on).toBe(false);
});

test('without a live call the back link is a plain link home', () => {
  render(<BackToApps avatar={{ phase: 'ended', end: vi.fn() }} />);
  const link = screen.getByRole('link', { name: 'All apps' });
  expect(link.getAttribute('href')).toBe('/');
  // Not prevented: the browser follows it.
  expect(fireEvent.click(link)).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('during a live call leaving asks in the page, and ends the call before going', async () => {
  const order: string[] = [];
  const end = vi.fn(async () => { order.push('end'); });
  assign.mockImplementation(() => order.push('assign'));
  render(<BackToApps avatar={{ phase: 'live', end }} name="Marco" />);
  expect(fireEvent.click(screen.getByRole('link', { name: 'All apps' }))).toBe(false);
  expect(screen.getByRole('dialog').textContent).toContain('End the call with Marco');
  // Staying keeps the call.
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(end).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('link', { name: 'All apps' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End call' })); });
  expect(order).toEqual(['end', 'assign']);
  expect(assign).toHaveBeenCalledWith('/');
});

test('a call that fails to end still leaves', async () => {
  render(<BackToApps avatar={{ phase: 'live', end: vi.fn(async () => { throw new Error('offline'); }) }} />);
  fireEvent.click(screen.getByRole('link', { name: 'All apps' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End call' })); });
  expect(assign).toHaveBeenCalledWith('/');
});
