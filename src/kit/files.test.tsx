// @vitest-environment jsdom
// Tests for handing the host files: when the drop is offered, what goes with
// the files, each file's progress in words, and drops that cannot go.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { FileError, type FileProgress } from '../avatar/files.ts';
import { FileDrop, fileWords } from './files.tsx';
import type { Avatar } from './useAvatar.ts';

afterEach(cleanup);

function fakeAvatar(over: Partial<Avatar> = {}): Avatar {
  return { phase: 'live', filesAccepted: true, sendFiles: vi.fn(async () => []), ...over } as unknown as Avatar;
}
const file = (name: string) => new File(['x'], name);
const pick = (files: File[]) => fireEvent.change(screen.getByLabelText('Share files'), { target: { files } });

test('the drop is offered only while the host takes files in a live call', () => {
  const { rerender } = render(<FileDrop avatar={fakeAvatar({ phase: 'arriving' })} name="Rachel" hint="Drop a menu" />);
  expect(screen.getByRole('button', { name: 'Share files' })).toHaveProperty('disabled', true);
  expect(screen.getByText("Once you're in the call with Rachel.")).toBeTruthy();
  rerender(<FileDrop avatar={fakeAvatar({ filesAccepted: false })} name="Rachel" />);
  expect(screen.getByText("Rachel can't take files in this call.")).toBeTruthy();
  rerender(<FileDrop avatar={fakeAvatar()} name="Rachel" hint="Drop a menu" />);
  expect(screen.getByRole('button', { name: 'Share files' })).toHaveProperty('disabled', false);
  expect(screen.getByText('Drop a menu')).toBeTruthy();
});

test('picked files go to the app first, then to the host with the caption, each followed in words', async () => {
  let report!: (p: FileProgress) => void;
  let finish!: () => void;
  const sendFiles = vi.fn((_files: File[], { onStatus }: { onStatus: (p: FileProgress) => void }) => {
    report = onStatus;
    return new Promise((resolve) => { finish = () => resolve([{ name: 'menu.pdf', status: 'ready' }, { name: 'x.docx', status: 'refused', reason: 'unsupported_type' }]); });
  });
  const onFiles = vi.fn(), onShared = vi.fn();
  render(<FileDrop avatar={fakeAvatar({ sendFiles } as never)} caption={(fs) => `${fs.length} files`} onFiles={onFiles} onShared={onShared} />);
  const files = [file('menu.pdf'), file('x.docx')];
  await act(async () => { pick(files); });
  expect(onFiles).toHaveBeenCalledWith(files);
  expect(sendFiles.mock.calls[0][0]).toEqual(files);
  expect(sendFiles.mock.calls[0][1]).toMatchObject({ caption: '2 files' });
  expect(screen.getAllByText('Sending…')).toHaveLength(2);
  act(() => { report({ index: 0, name: 'menu.pdf', status: 'reading' }); report({ index: 1, name: 'x.docx', status: 'refused', reason: 'unsupported_type' }); });
  expect(screen.getByText('Reading…')).toBeTruthy();
  expect(screen.getByText("Not read: a kind of file that can't be read")).toBeTruthy();
  await act(async () => { report({ index: 0, name: 'menu.pdf', status: 'ready' }); finish(); });
  expect(screen.getByText('Read')).toBeTruthy();
  expect(onShared).toHaveBeenCalledWith(files, [{ name: 'menu.pdf', status: 'ready' }, { name: 'x.docx', status: 'refused', reason: 'unsupported_type' }]);
});

test('a drop of too many files, or one the host turns down, says so and shows nothing as sent', async () => {
  const sendFiles = vi.fn(async () => { throw new FileError('files_unsupported'); });
  render(<FileDrop avatar={fakeAvatar({ sendFiles } as never)} name="Iris" />);
  await act(async () => { pick(Array.from({ length: 11 }, (_, i) => file(`p${i}.png`))); });
  expect(screen.getByRole('alert').textContent).toBe('At most 10 files at a time.');
  expect(sendFiles).not.toHaveBeenCalled();
  await act(async () => { pick([file('plan.pdf')]); });
  expect(screen.getByRole('alert').textContent).toBe("Iris can't take files in this call.");
  expect(screen.queryByLabelText('Shared files')).toBeNull();
});

test('a later drop takes the place of an earlier one, whose late answers no longer show', async () => {
  const reports: ((p: FileProgress) => void)[] = [];
  const sendFiles = vi.fn((_f: File[], { onStatus }: { onStatus: (p: FileProgress) => void }) => { reports.push(onStatus); return new Promise(() => {}); });
  render(<FileDrop avatar={fakeAvatar({ sendFiles } as never)} />);
  await act(async () => { pick([file('first.pdf')]); });
  await act(async () => { pick([file('second.pdf')]); });
  act(() => { reports[0]({ index: 0, name: 'first.pdf', status: 'ready' }); });
  expect(screen.queryByText('first.pdf')).toBeNull();
  expect(screen.getByText('Sending…')).toBeTruthy();
});

test('files dragged onto the area go like picked ones', async () => {
  const sendFiles = vi.fn(async (_files: File[]) => []);
  const { container } = render(<FileDrop avatar={fakeAvatar({ sendFiles } as never)} />);
  const area = container.querySelector('.call-files')!;
  await act(async () => { fireEvent.drop(area, { dataTransfer: { types: ['Files'], files: [file('plan.pdf')] } }); });
  expect(sendFiles.mock.calls[0][0]).toEqual([expect.objectContaining({ name: 'plan.pdf' })]);
  expect(sendFiles).toHaveBeenCalledTimes(1);   // once, not again by the page's own catch
});

test('files dropped elsewhere on the page are shared, or ignored, but never opened by the browser', async () => {
  const sendFiles = vi.fn(async (_files: File[]) => []);
  const { rerender } = render(<FileDrop avatar={fakeAvatar({ sendFiles } as never)} />);
  const dropOnPage = () => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file('plan.pdf')] } });
    document.body.dispatchEvent(event);
    return event;
  };
  let event!: Event;
  await act(async () => { event = dropOnPage(); });
  expect(event.defaultPrevented).toBe(true);
  expect(sendFiles.mock.calls[0][0]).toEqual([expect.objectContaining({ name: 'plan.pdf' })]);
  rerender(<FileDrop avatar={fakeAvatar({ sendFiles, filesAccepted: false } as never)} />);
  await act(async () => { event = dropOnPage(); });
  expect(event.defaultPrevented).toBe(true);
  expect(sendFiles).toHaveBeenCalledTimes(1);
});

test('a refusal reads as what it means', () => {
  expect(fileWords({ name: 'a', status: 'refused', reason: 'too_large' })).toBe('Not read: too large to read');
  expect(fileWords({ name: 'a', status: 'refused', reason: 'something new' })).toBe("Not read: couldn't be read");
  expect(fileWords({ name: 'a', status: 'refused', reason: 'unsafe' })).toBe('Not read: held back for safety');
  expect(fileWords({ name: 'a', status: 'ready' })).toBe('Read');
});
