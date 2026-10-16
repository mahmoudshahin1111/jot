export const PERMISSIONS = {
  tasks: {
    read: 'tasks.read',
    create: 'tasks.create',
    update: 'tasks.update',
    delete: 'tasks.delete',
  },
  roles: {
    read: 'roles.read',
    create: 'roles.create',
    duplicate: 'roles.duplicate',
    update: 'roles.update',
    delete: 'roles.delete',
    removeMembers: 'roles.members.remove',
    addMembers: 'roles.members.add',
  },
} as const

export type PermissionKey = {
  [Group in keyof typeof PERMISSIONS]: (typeof PERMISSIONS)[Group][keyof (typeof PERMISSIONS)[Group]]
}[keyof typeof PERMISSIONS]
