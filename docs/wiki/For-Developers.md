# For Developers

## Stack
- **Backend:** Supabase (Postgres, Auth, Row Level Security)
- **UI:** React with shadcn components, styled with the **Ember** design system (black and red, Geist fonts)
- **Forms:** React Hook Form + Zod

## Core tables (v1)
| Table | Key columns |
|---|---|
| `workspaces` | `id`, `name`, `owner_id` |
| `workspace_members` | `workspace_id`, `user_id`, `role_id` |
| `roles` | `id`, `workspace_id`, `name`, `description`, `is_system` |
| `role_permissions` | `role_id`, `permission` (e.g. `activity:read`) |
| `tasks` | `id`, `workspace_id`, `title`, `status` (`todo` / `in_progress` / `done`), `description` |
| `activity_events` | `id`, `workspace_id`, `type` (e.g. `task.deleted`), `actor_id`, `description`, `item_kind`, `item_id`, `created_at` |

## Rules to keep
- Every table is scoped by `workspace_id`, and RLS lets a user see only workspaces they belong to.
- Permissions are checked in **RLS**, not only in the UI.
- Creating a workspace makes the creator its Owner.
- The Owner role is locked, and system roles can't be deleted.
- Activity events keep the item name, so they still read correctly after the item is deleted.

## UI conventions (Ember)
- One red primary button per view
- Destructive actions use a red button with a verb ("Delete role")
- Status badges always include a word, never color alone
- Dark theme by default, with a light theme

## Links
- Design file: *(add the shared Claude Design link)*
- Project board: https://github.com/users/mahmoudshahin1111/projects/3

---
[← Docs home](README.md)
