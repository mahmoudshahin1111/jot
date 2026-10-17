# Activity

Activity is the workspace history. You need the `activity:read` permission to open it.

## What's logged
| Event | Example |
|---|---|
| Workspace created / updated | "Renamed the workspace to …" |
| Role created / updated / deleted | "Created the role Editor" |
| Task created / updated / deleted | "Deleted the task Draft onboarding copy" |
| Member invited | "Invited sara@example.com" |

## Using the page
- **Search** looks in the event descriptions.
- Events are shown newest first, a page at a time. Use the controls at the bottom to change page.
- Each event type has a distinct badge color. Badges stay on one line; on narrow screens, scroll the table horizontally.
- Click an event to open its details:
  - What happened and when
  - **Who** did it, with their name and email
  - A **link** to the role or task it changed
- If the role or task was deleted later, the event shows a **Deleted** badge and no link.

## No access?
Without `activity:read`, Activity disappears from the sidebar, and opening its link shows "You don't have access to Activity". Ask an Owner or Admin to add the permission to your role.

---
[← Docs home](README.md)
