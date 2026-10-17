# Roles and Permissions

Go to **Settings → Roles**. A role is a named set of permissions, and every member of a workspace has one role.

## The page
- **Left:** the list of roles, with a filter box. Each role shows its member count.
- **Right:** the selected role, with two tabs: **Permissions** and **Members**.

## Built-in roles
| Role | Type | What it's for |
|---|---|---|
| Owner | System, locked | Full control, including billing. Its permissions can't be changed. |
| Admin | System | Manages people and projects day to day |
| Viewer | System | Read-only access to projects and reports |
| Editor | Custom (example) | Works inside projects and builds reports |
| Analyst | Custom (example) | Reads project data and builds reports |

System roles can't be deleted.

## Create a role
1. Click **Create role**.
2. Enter a **name**, which must be unique, and an optional **description**.
3. Click **Create**. The new role starts with **no permissions** and **no members**.
4. Turn on its permissions, then add members.

## Edit, duplicate, delete
- **Edit role:** change the name or description.
- **Duplicate:** copies the permissions into a new role called "{name} copy". The copy starts with no members.
- **Delete role:** asks you to confirm first. People who had the role stay in the workspace without a role. This can't be undone.

## Permissions tab
A table with two columns:
- **Permission:** the name and a short description
- **Allowed:** a checkbox

When you change a checkbox, a bar appears with **Save changes** and **Discard changes**. Nothing applies until you save.

## Members tab
- **Add members:** pick one or more people. They move from their current role to this one.
- **Remove:** takes the person off this role.

Members of the Owner role can't be changed here.

See [Permissions Reference](Permissions-Reference.md) for every permission.

---
[← Docs home](README.md)
