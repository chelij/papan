import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A single media worker keeps CPU/disk use bounded. Library commits remain independent.
export async function openDownloadQueue(root, run, publish = () => {}) {
  const file = path.join(root, 'downloads.json');
  let tasks = [], writes = Promise.resolve(), active = null, stopped = false;
  try {
    tasks = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(tasks) || tasks.some(task => !task.id || !['save', 'collection', 'pin'].includes(task.kind) || !task.payload)) throw new Error('Invalid download queue.');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read the download queue. Your files were preserved. ${error.message}`); }
  for (const task of tasks) if (['queued', 'running'].includes(task.state)) {
    task.state = 'failed'; task.error = 'Interrupted when Papan closed. Retry to continue.';
  }
  const snapshot = () => tasks.map(({ payload, ...task }) => structuredClone(task));
  const persist = () => {
    const contents = JSON.stringify(tasks, null, 2);
    const next = writes.then(async () => {
      const temporary = `${file}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, contents, { mode: 0o600 }); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }); }
    });
    writes = next.catch(() => {});
    return next;
  };
  async function pump() {
    if (active || stopped) return;
    const task = tasks.find(item => item.state === 'queued');
    if (!task) return;
    const controller = new AbortController();
    active = { id: task.id, controller };
    task.state = 'running'; task.progress = 'starting…'; task.error = '';
    try {
      await persist(); publish(snapshot());
      task.result = await run(task.kind, structuredClone(task.payload), controller.signal, message => {
        task.progress = String(message).slice(0, 300); publish(snapshot());
      });
      task.state = 'completed'; task.progress = 'saved';
    } catch (error) {
      task.state = controller.signal.aborted ? 'cancelled' : 'failed';
      task.error = controller.signal.aborted ? 'Cancelled. You can retry this task.' : error.message;
    } finally {
      // A failed status write must not re-run an operation that already committed.
      try { await persist(); } catch (error) { task.error = `Queue status could not be saved: ${error.message}`; }
      active = null; publish(snapshot());
      if (!stopped) void pump();
    }
  }
  await persist();
  return {
    snapshot,
    async add(kind, payload, title) {
      if (tasks.filter(task => ['queued', 'running'].includes(task.state)).length >= 100) throw new Error('The download queue is full. Wait for a task to finish.');
      if (tasks.some(task => ['queued', 'running', 'failed', 'cancelled'].includes(task.state) && task.kind === kind &&
          (kind === 'save' ? task.payload.pin.sourceUrl === payload.pin.sourceUrl && task.payload.pin.collectionId === payload.pin.collectionId : task.payload.id === payload.id))) {
        throw new Error('This item already has a task. Retry, cancel, or dismiss it from Downloads.');
      }
      const task = { id: randomUUID(), kind, title, payload: structuredClone(payload), state: 'queued', progress: 'waiting', createdAt: new Date().toISOString() };
      tasks.push(task);
      try { await persist(); } catch (error) { tasks = tasks.filter(item => item !== task); throw error; }
      publish(snapshot()); void pump();
      return task.id;
    },
    async cancel(id) {
      const task = tasks.find(item => item.id === id);
      if (!task) throw new Error('Task not found.');
      if (active?.id === id) active.controller.abort();
      else if (task.state === 'queued') { task.state = 'cancelled'; task.error = 'Cancelled. You can retry this task.'; await persist(); publish(snapshot()); }
    },
    async retry(id) {
      const task = tasks.find(item => item.id === id);
      if (!task || !['failed', 'cancelled'].includes(task.state) || active?.id === id) throw new Error('This task cannot be retried yet.');
      const previous = { state: task.state, error: task.error };
      task.state = 'queued'; task.error = ''; task.progress = 'waiting';
      try { await persist(); } catch (error) { Object.assign(task, previous); throw error; }
      publish(snapshot()); void pump();
    },
    async dismiss(id) {
      const task = tasks.find(item => item.id === id);
      if (!task || ['queued', 'running'].includes(task.state)) throw new Error('Cancel this task before dismissing it.');
      const before = tasks; tasks = tasks.filter(item => item.id !== id);
      try { await persist(); } catch (error) { tasks = before; throw error; }
      publish(snapshot());
    },
    stop() { stopped = true; active?.controller.abort(); },
  };
}
