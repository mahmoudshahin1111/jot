export const PERMISSIONS = {
  tasks: {
    read: 'tasks.read',
    update: 'tasks.update',
    delete: 'tasks.delete',
  },
  roles: {
    read: 'roles.read',
    create: 'roles.create',
    update: 'roles.update',
    delete: 'roles.delete',
    removeMembers: 'roles.members.remove',
  },
} as const

export type PermissionKey = {
  [Group in keyof typeof PERMISSIONS]: (typeof PERMISSIONS)[Group][keyof (typeof PERMISSIONS)[Group]]
}[keyof typeof PERMISSIONS]
