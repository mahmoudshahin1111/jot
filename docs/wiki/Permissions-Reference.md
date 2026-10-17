# Permissions Reference

| Key | Name | Allows |
|---|---|---|
| `users:read` | View users | See everyone in the workspace |
| `users:write` | Manage users | Invite, edit and deactivate accounts |
| `roles:read` | View roles | See roles and who holds them |
| `roles:write` | Manage roles | Create roles, edit permissions, assign members |
| `projects:read` | View projects | Open projects and read everything inside |
| `projects:write` | Manage projects | Create, edit and delete projects and tasks |
| `billing:read` | View billing | See plans and invoices |
| `billing:write` | Manage billing | Change plans and payment methods |
| `reports:read` | View reports | Open dashboards and reports |
| `reports:write` | Create reports | Build reports and export data |
| `activity:read` | View activity | See the workspace history |

## Default roles
| Permission | Owner | Admin | Editor | Analyst | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| `users:read` | ✓ | ✓ | | | |
| `users:write` | ✓ | ✓ | | | |
| `roles:read` | ✓ | ✓ | | | |
| `roles:write` | ✓ | ✓ | | | |
| `projects:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `projects:write` | ✓ | ✓ | ✓ | | |
| `billing:read` | ✓ | ✓ | | | |
| `billing:write` | ✓ | | | | |
| `reports:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports:write` | ✓ | ✓ | ✓ | ✓ | |
| `activity:read` | ✓ | ✓ | | ✓ | |

> Whether tasks use `projects:*` or get their own `tasks:*` keys is still an open decision.

---
[← Docs home](README.md)
