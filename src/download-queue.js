import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A single media worker keeps CPU/disk use bounded. Library commits remain independent.
export async function openDownloadQueue(root, run, publish = () => {}, codec = { encode: task => task, decode: task => task }) {
  const file = path.join(root, 'downloads.json');
  let tasks = [], writes = Promise.resolve(), active = null, stopped = false;
  try {
    tasks = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(tasks) || tasks.some(task => !task.id || !['save', 'collection', 'pin'].includes(task.kind) || (!task.payload && !task.encrypted))) throw new Error('Invalid download queue.');
  } catch (error) { if (error.code !== 'ENOENT') throw new Error(`Could not read the download queue. Your files were preserved. ${error.message}`); }
  tasks = tasks.filter(task => task.state !== 'completed');
  for (const task of tasks) if (['queued', 'running'].includes(task.state)) {
    task.state = 'failed'; task.error = 'Interrupted when Papan closed. Retry to continue.';
  }
  const snapshot = () => tasks.map(value => {
    const { payload, encrypted, ...task } = codec.decode(value);
    return structuredClone(task);
  });
  const persist = (data, encoded = false) => {
    const contents = JSON.stringify(encoded ? tasks : tasks.map(task => codec.encode(task, data)), null, 2);
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
    let task = tasks.find(item => item.state === 'queued');
    if (!task) return;
    const decoded = codec.decode(task, true);
    tasks[tasks.indexOf(task)] = decoded; task = decoded;
    const controller = new AbortController();
    active = { id: task.id, controller };
    task.state = 'running'; task.progress = 'starting…'; task.error = '';
    try {
      await persist(); publish(snapshot());
      controller.signal.throwIfAborted();
      task.result = await run(task.kind, structuredClone(task.payload), controller.signal, message => {
        task.progress = String(message).slice(0, 300); publish(snapshot());
      });
      task.state = 'completed'; task.progress = 'saved';
    } catch (error) {
      task.state = controller.signal.aborted ? 'cancelled' : 'failed';
      task.error = controller.signal.aborted ? 'Cancelled. You can retry this task.' : error.message;
    } finally {
      const completed = task.state === 'completed' ? snapshot().find(item => item.id === task.id) : null;
      if (completed) tasks = tasks.filter(item => item !== task);
      // A failed status write must not re-run an operation that already committed.
      tasks = tasks.map(value => codec.encode(value));
      try { await persist(); } catch (error) { task.error = `Queue status could not be saved: ${error.message}`; }
      active = null; publish(completed ? [...snapshot(), completed] : snapshot());
      if (!stopped) void pump();
    }
  }
  await persist();
  return {
    snapshot,
    publish: () => publish(snapshot()),
    async recode(data) {
      await writes;
      const before = tasks;
      tasks = tasks.map(task => codec.encode(task, data));
      try { await persist(data); } catch (error) { tasks = before; throw error; }
      return async () => { tasks = before; await persist(undefined, true); };
    },
    async add(kind, payload, title) {
      if (!['save', 'collection', 'pin'].includes(kind)) throw new Error('Invalid task type.');
      if (tasks.filter(task => ['queued', 'running'].includes(task.state)).length >= 100) throw new Error('The download queue is full. Wait for a task to finish.');
      if (tasks.map(task => codec.decode(task)).filter(task => task.payload).some(task => ['queued', 'running', 'failed', 'cancelled'].includes(task.state) && task.kind === kind &&
          (kind === 'save' ? task.payload.pin.sourceUrl === payload.pin.sourceUrl && task.payload.pin.collectionId === payload.pin.collectionId : task.payload.id === payload.id && (!task.payload.extractPose || !payload.extractPose || task.payload.itemId === payload.itemId)))) {
        throw new Error('This item already has a task. Retry, cancel, or dismiss it from Activity.');
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
      await writes;
      let task = tasks.find(item => item.id === id);
      if (!task || !['failed', 'cancelled'].includes(task.state) || active?.id === id) throw new Error('This task cannot be retried yet.');
      const decoded = codec.decode(task, true);
      tasks[tasks.indexOf(task)] = decoded; task = decoded;
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
