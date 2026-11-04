import { useCallback, useEffect, useState } from "react";
import { type Doc, docDelete, docPut, docsList, newId } from "../db";
import { formatDue, parseTodo, TODO_COLLECTION, type Todo } from "../todo";

function sortTodos(list: Doc<Todo>[]): Doc<Todo>[] {
  return [...list].sort((a, b) => {
    if (a.data.done !== b.data.done) return a.data.done ? 1 : -1;
    const ad = a.data.due ?? Infinity;
    const bd = b.data.due ?? Infinity;
    return ad !== bd ? ad - bd : b.data.created - a.data.created;
  });
}

export function TodoTab() {
  const [todos, setTodos] = useState<Doc<Todo>[]>([]);
  const [input, setInput] = useState("");
  const preview = input.trim() ? parseTodo(input) : null;

  const refresh = useCallback(async () => {
    try {
      setTodos(sortTodos(await docsList<Todo>(TODO_COLLECTION)));
    } catch {
      // Leave the current list in place.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    if (!preview || !preview.text) return;
    const todo: Todo = { ...preview, done: false, reminded: false, created: Date.now() };
    setInput("");
    await docPut(TODO_COLLECTION, newId(), todo);
    await refresh();
  };

  const toggle = async (t: Doc<Todo>) => {
    await docPut(TODO_COLLECTION, t.id, { ...t.data, done: !t.data.done });
    await refresh();
  };

  const remove = async (t: Doc<Todo>) => {
    await docDelete(TODO_COLLECTION, t.id);
    await refresh();
  };

  const clearDone = async () => {
    await Promise.all(todos.filter((t) => t.data.done).map((t) => docDelete(TODO_COLLECTION, t.id)));
    await refresh();
  };

  const doneCount = todos.filter((t) => t.data.done).length;
  const now = Date.now();

  return (
    <div className="todo">
      <input
        className="field"
        autoFocus
        value={input}
        placeholder='Add a task, e.g. "call mom tomorrow 5pm"'
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <div className="muted hint">
        {preview?.due ? `Due ${formatDue(preview.due, preview.hasTime)}` : "Press Enter to add"}
      </div>
      <ul className="list">
        {todos.map((t) => {
          const overdue = !t.data.done && t.data.due !== null && t.data.due < now;
          return (
            <li key={t.id} className="todo-row">
              <input
                type="checkbox"
                checked={t.data.done}
                onChange={() => toggle(t)}
                aria-label={`Done: ${t.data.text}`}
              />
              <span className={t.data.done ? "done" : ""}>{t.data.text}</span>
              {t.data.due !== null && (
                <span className={overdue ? "due overdue" : "due muted"}>
                  {formatDue(t.data.due, t.data.hasTime)}
                </span>
              )}
              <button className="icon" onClick={() => remove(t)} aria-label="Delete">
                ×
              </button>
            </li>
          );
        })}
        {todos.length === 0 && <li className="muted">Nothing to do.</li>}
      </ul>
      {doneCount > 0 && (
        <button className="btn" onClick={clearDone}>
          Clear {doneCount} done
        </button>
      )}
    </div>
  );
}
