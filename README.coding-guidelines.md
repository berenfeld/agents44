# Agents44 coding guidelines

Follow these rules when changing this repo. Cursor agents must also follow `.cursor/rules/`.

The operator UI is English. Python imports stay at the top of the file.

## User-initiated actions: always give feedback

Any click, submit, or confirm that calls the backend is a **user-initiated action**. The GUI is feedback-based:

1. **In progress** — disable the control and show busy text (`Creating...`, `Deleting...`, `Signing in...`). The user must see that something is happening.
2. **Result** — show whether the backend succeeded or failed. Prefer a **modal** (`NoticeModal` for the outcome, `ConfirmModal` before destructive work).
3. **Never swallow errors** — no empty `catch {}`, no uncaught promise that only hits the console. The user must see the outcome.

Use `NoticeModal` from `frontend/src/components/ui/modal.tsx` for the result of a user-initiated action (success or failure). A red inline label may stay as extra context; it does not replace the modal.

Map API failures with `userFacingApiError` in `frontend/src/api/client.ts`:

- **4xx** — show the backend `error` string (it is written for the operator).
- **5xx / network / unknown** — show **`Unexpected server error`**. Do not show stack traces or raw `"Internal server error"` bodies.

```tsx
try {
  await api.post("/departments", { name });
  setNotice({ title: "Department created", message: `Created ${name}.` });
} catch (err) {
  setNotice({ title: "Could not create department", message: userFacingApiError(err) });
}
```

Page load / polling (health, lists) may use inline empty/error states. Those are not user-initiated mutations.

## Backend: validate first (4xx), then mutate

Do **all** input and pre-condition checks **before** any write (DB row, schema, file, subprocess).

Checks that fail are **expected client errors**: raise `APIClientError("clear operator message", 4xx)`. The JSON body is `{"error": "<message>"}`. That message is what the modal shows.

Then do the operation with **no local try/except**. `@api_endpoint` (`backend/app/errors.py`) owns the transaction for every API request:

- **success** — `db.session.commit()`
- **any exception** — `db.session.rollback()`, then 4xx or 500
- **unhandled exception** — `logger.exception` (full stack trace) and `{"error": "Internal server error"}` (500). The UI shows **Unexpected server error**.

Flask-SQLAlchemy does **not** auto-commit. Do not call `db.session.commit()` / `rollback()` in API views or in services they call. Background jobs (agent runner, scheduler, startup) still commit themselves.

```python
# ✅ GOOD — checks, then work; decorator commits or rolls back
name = validate_department_name(data["name"])
if SystemDepartment.query.filter_by(name=name).first():
    raise APIClientError("Department already exists", 400)
row = SystemDepartment(name=name)
db.session.add(row)
db.session.flush()
create_department_schema(conn, name)
ensure_department_folder(name)
return jsonify(row.to_dict()), 201

# ❌ BAD — try/except in the view, commit-then-fail, swallow and continue
try:
    db.session.commit()
    create_department_schema(conn, name)
except Exception:
    logger.warning("schema failed, continuing")
```

Idempotent SQL (`DROP SCHEMA IF EXISTS`) is allowed. Catching an error and continuing is not.

## No try/except in backend (almost)

Do **not** add `try/except` in API views or services to hide failures.

Allowed:

1. **`@api_endpoint` only** — the common decorator: log, rollback, 4xx/500.
2. **Narrow logic parses** — e.g. `except (ValueError, json.JSONDecodeError)` when converting a string, then raise `APIClientError` or use a documented default. Not “log and keep going” on a mutation.

| Status | When | Frontend modal |
|--------|------|----------------|
| 2xx | Operation finished | Success notice |
| 4xx | Bad input, conflict, not allowed | Backend `error` text |
| 5xx | Unexpected failure after checks | `Unexpected server error` |

## Related files

- `frontend/src/components/ui/modal.tsx` — `NoticeModal`, `ConfirmModal`
- `frontend/src/api/client.ts` — `apiErrorMessage`, `userFacingApiError`
- `backend/app/errors.py` — `APIClientError`, `@api_endpoint` (commit / rollback / stack trace)
