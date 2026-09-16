// Model-facing status. Full records and native paths remain available through read_task.
export function compactTask(task, { include_config = false } = {}) {
  const view = Object.fromEntries(['task_id', 'run_id', 'state', 'event_cursor'].map((key) => [key, task[key]]));
  for (const key of ['stop_reason', 'error', 'error_code', 'deduplicated']) {
    if (task[key] != null) view[key] = task[key];
  }
  if (task.pending_requests?.length) view.pending_requests = task.pending_requests;
  if (include_config) {
    view.permissions = task.permissions ?? 'default';
    if (task.effective_config) view.effective_config = task.effective_config;
    else if (task.requested_config) view.requested_config = task.requested_config;
  }
  return view;
}

export function compactOutput({ text, next_offset, total_chars, truncated }) {
  return { text, next_offset, total_chars, truncated };
}
