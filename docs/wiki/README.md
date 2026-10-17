# Jot

Jot is a task manager built around **workspaces**. Each workspace has its own tasks, its own members and its own roles, which control what each member can do.

> **Status:** this wiki describes the v1 design. Anything marked *Planned* isn't built yet.

## Start here
| If you want to… | Read |
|---|---|
| Find your way around the app | [Getting Started](Getting-Started.md) |
| Add, track and finish work | [Tasks](Tasks.md) |
| Decide who can do what | [Roles and Permissions](Roles-and-Permissions.md) |
| See what changed and who changed it | [Activity](Activity.md) |
| Look up a permission key | [Permissions Reference](Permissions-Reference.md) |
| Work on the code | [For Developers](For-Developers.md) |
| Get a quick answer | [FAQ](FAQ.md) |

## Key ideas in 30 seconds
- **Workspace:** a separate space for one team or project. The person who creates it becomes its **Owner**.
- **Task:** one piece of work, with a title, a status (To do, In progress, Done) and a description.
- **Role:** a named set of permissions, such as Admin or Editor. Every member has one role.
- **Permission:** one thing a role can do, such as `projects:write`. You turn each one on or off with a checkbox.
- **Activity:** the workspace history. Important actions are logged with who did them and when.
